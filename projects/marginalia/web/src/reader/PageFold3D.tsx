import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  NoColorSpace,
  ShaderMaterial,
  Vector3,
  type Group,
} from "three";
import { useScene3DLayer } from "../scene3d/Scene3D.js";
import { CameraRig } from "../scene3d/CameraRig.js";
import { DESK_CAMERA_UP, deskViewFrame } from "../desk/deskDepthMath.js";
import { buildFoldMesh, type FoldMesh } from "./foldMesh.js";
import {
  backOfSheetPaper,
  computeConeFold,
  curlArcLength,
  leafSourceRect,
  samplePaperColor,
  sheetShadingAt,
  type FoldAnchor,
  type LeafSource,
  type Point,
  type Rgb,
} from "./pageFold.js";
import { drawCostP90 } from "./drawCost.js";

/**
 * M27 "over the spine": the hinged fold drawn as a mesh on the one 3D seam.
 *
 * This is the renderer `PageCurl.tsx` is being replaced by, and the reason the
 * milestone needed WebGL at all — a cone's rulings are not parallel, so canvas
 * 2D cannot express one (PAGE_CURL.md §2d). What it draws is
 * `foldMesh.ts`'s triangles; what it draws them *with* is the seam already
 * standing (`scene3d/Scene3D.tsx`), not a second canvas. Settled decision 14
 * is explicit that the fold and the 3D substrate must not become two ad-hoc
 * call sites, and everything the fold would otherwise have had to build for
 * itself — one canvas, the pixel-for-pixel unit convention, a lost context
 * degrading to the 2D presentation — the seam already owns.
 *
 * ## Three things it inherits rather than decides
 *
 * - **The camera is the Desk's.** `deskViewFrame` hangs a real perspective
 *   camera above the viewport's centre such that the plane `y = 0` maps to it
 *   1:1 — world `(x, 0, z)` is screen pixel `(x, z)`. That is exactly what a
 *   page lying on a page needs, so the fold borrows the construction rather
 *   than bringing a fourth camera. The leaf lies at `y = 0` and therefore lines
 *   up with its own DOM rect; only what *lifts* off it splays, which is the
 *   whole point of having a lens.
 * - **A lost context is not its business.** `useScene3DAvailable()` goes false
 *   and the caller falls back down the ladder to the slide, through the
 *   gesture's one existing exit (PAGE_CURL.md §9). There is no escape hatch
 *   here.
 * - **The paper's shading is the one that was tuned**, not a lighting rig.
 *   `sheetShadingAt` and `backOfSheetPaper` come from `pageFold.ts`, judged
 *   against real pages in three reading themes; this reads them per *vertex*
 *   where `drawPageFold` read them per *band*, and that is the only difference.
 *   Hence unlit materials, and hence `NoColorSpace` below.
 */

/** One layer id: only one page can be turning at a time. */
const FOLD_LAYER_ID = "page-fold";

/** Ceiling on one frame's mesh. The fan is a couple of hundred vertices by
 * construction (`foldMesh.ts`), so this is a guard against a future
 * tessellation quietly outgrowing its buffers, not a budget anyone is near. */
const MAX_VERTICES = 1024;

/** How high above the page the shadow is laid, in px. Enough to win the depth
 * test against the page plane, small enough that the perspective camera cannot
 * separate it from the page it belongs to. */
const SHADOW_LIFT = 0.05;

/**
 * Contact falloff: the gap under a lifted sheet is darkest where the sheet is
 * nearly touching and opens up as it rises, reaching half strength once the
 * sheet is `SHADOW_FALLOFF_PX` off the page.
 *
 * ⚠️ **A proposal, not a settled look.** `drawPageFold` throws two
 * constant-alpha shadows and softens them with `shadowBlur`, which has no cheap
 * WebGL equivalent — a blur means a render target and a second pass. This
 * trades the blur for a falloff that is at least physical, and it is the
 * *gradient* doing the softening rather than a blur radius. It owes a
 * side-by-side against the 2D shadow in the harness on a real compositor
 * before it is called done — see TASKS.md's Verify.
 */
const SHADOW_FALLOFF_PX = 90;
const SHADOW_ALPHA = 0.4;

export interface PageFold3DProps {
  /** The departing **card**'s bitmap: the page snapshot composited over the
   * reader margin (cardSnapshot.ts), exactly as `PageCurl` takes it. */
  image: HTMLCanvasElement;
  anchor: FoldAnchor;
  /** The turning leaf's own size in CSS px — the whole card in single-page
   * mode, one half of it in spread mode. */
  leafWidth: number;
  leafHeight: number;
  /** The turning leaf's x-offset within the card. */
  leafX: number;
  /** The whole card's width in CSS px, so the fold knows which slice of the
   * bitmap is the leaf that turns. */
  stageWidth: number;
  /** The turning leaf's top-left in **viewport** CSS px. Read once per frame,
   * so it must be cheap — a cached rect, not a fresh `getBoundingClientRect`. */
  getOrigin: () => Point;
  /** The live fold pointer in leaf-local coordinates, read once per frame. */
  getPointer: () => Point;
  /** The back of the turning sheet, once its capture lands mid-fold. See
   * `PageCurl`'s own `getBack` for why this is a function. */
  getBack?: () => { image: HTMLCanvasElement; leafX: number } | null;
  /** The p90 cost of building and uploading one frame, reported on unmount —
   * the same statistic, in the same unit, as the 2D painter's, so the low-fps
   * rung means the same thing for both renderers. */
  onDrawCost?: (p90DrawMs: number, samples: number) => void;
}

/**
 * Registers the fold with the shared canvas for as long as it is mounted.
 * Renders no DOM of its own: the sheet is drawn on the seam's canvas, and the
 * page underneath stays live DOM — which is the M20 acceptance criterion the
 * step 4 entry retired, since the sheet now lands *on* the facing leaf and
 * throws a shadow across it.
 */
export function PageFold3D(props: PageFold3DProps) {
  const { image, anchor, leafWidth, leafHeight, leafX, stageWidth } = props;
  // The three getters are deliberately not dependencies, exactly as in
  // `PageCurl`: they change identity every render and everything else here is
  // fixed for the lifetime of one turn. Re-registering the layer mid-fold
  // would restart the gesture under the reader's finger.
  const latest = useRef(props);
  latest.current = props;
  const node = useMemo(
    () => (
      <FoldLayer
        image={image}
        anchor={anchor}
        leafWidth={leafWidth}
        leafHeight={leafHeight}
        leafX={leafX}
        stageWidth={stageWidth}
        latest={latest}
      />
    ),
    [image, anchor, leafWidth, leafHeight, leafX, stageWidth],
  );
  useScene3DLayer(FOLD_LAYER_ID, node);
  return null;
}

const VERTEX_SHADER = `
attribute vec2 uvFront;
attribute vec2 uvBack;
attribute vec2 light;
attribute float sheen;
varying vec2 vUvFront;
varying vec2 vUvBack;
varying vec2 vLight;
varying float vSheen;
void main() {
  vUvFront = uvFront;
  vUvBack = uvBack;
  vLight = light;
  vSheen = sheen;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Written straight to `gl_FragColor` with no colour-space include, against
// textures declared `NoColorSpace`: the card bitmap's bytes reach the screen
// unconverted, the way canvas 2D delivered them. Anything else would shift the
// reading surface's paper colour on the frame the fold starts.
const FRAGMENT_SHADER = `
uniform sampler2D frontMap;
uniform sampler2D backMap;
uniform vec3 backPaper;
uniform float backWash;
varying vec2 vUvFront;
varying vec2 vUvBack;
varying vec2 vLight;
varying float vSheen;
void main() {
  vec3 rgb;
  float lit;
  if (gl_FrontFacing) {
    rgb = texture2D(frontMap, vUvFront).rgb;
    lit = vLight.x;
  } else {
    rgb = mix(texture2D(backMap, vUvBack).rgb, backPaper, backWash);
    lit = vLight.y;
  }
  gl_FragColor = vec4(clamp(mix(rgb * lit, vec3(1.0), vSheen), 0.0, 1.0), 1.0);
}
`;

const SHADOW_VERTEX_SHADER = `
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHADOW_FRAGMENT_SHADER = `
varying float vAlpha;
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, vAlpha);
}
`;

interface FoldLayerProps {
  image: HTMLCanvasElement;
  anchor: FoldAnchor;
  leafWidth: number;
  leafHeight: number;
  leafX: number;
  stageWidth: number;
  latest: { current: PageFold3DProps };
}

/** Lives *inside* the shared `<Canvas>`, which is why it is a separate
 * component: `useFrame` and every three.js object below only exist there. */
function FoldLayer({ image, anchor, leafWidth, leafHeight, leafX, stageWidth, latest }: FoldLayerProps) {
  const groupRef = useRef<Group>(null);
  const paper = useMemo<Rgb>(() => samplePaperColor(image), [image]);
  const arc = useMemo(() => curlArcLength(leafWidth, leafHeight), [leafWidth, leafHeight]);
  const frontSource = useMemo(
    () => leafSourceRect(image.width, image.height, leafX, leafWidth, stageWidth),
    [image, leafX, leafWidth, stageWidth],
  );

  const frontTexture = useMemo(() => makeTexture(image), [image]);
  const backTexture = useRef(frontTexture);
  // Until the real back's capture lands, the sheet's other side is the front
  // mirrored — the pre-M27 stand-in, kept as a designed transitional state.
  const backUv = useRef<UvMap>(
    uvMap(frontSource, image.width, image.height, leafWidth, leafHeight, true),
  );
  const backImage = useRef<HTMLCanvasElement | null>(null);

  const sheet = useMemo(() => makeSheet(), []);
  const shadow = useMemo(() => makeShadow(), []);
  const costs = useRef<number[]>([]);

  useEffect(() => {
    sheet.material.uniforms.frontMap!.value = frontTexture;
    sheet.material.uniforms.backMap!.value = frontTexture;
    return () => {
      sheet.geometry.dispose();
      sheet.material.dispose();
      shadow.geometry.dispose();
      shadow.material.dispose();
      frontTexture.dispose();
      if (backTexture.current !== frontTexture) backTexture.current.dispose();
    };
  }, [sheet, shadow, frontTexture]);

  // The p90 of the frames that actually built a mesh, in the same unit and by
  // the same statistic as `PageCurl`'s — see `drawCostP90`, and M27's "the new
  // renderer reports the same honest cost unit".
  const onDrawCostRef = useRef(latest.current.onDrawCost);
  onDrawCostRef.current = latest.current.onDrawCost;
  useEffect(
    () => () => {
      if (costs.current.length > 0) {
        onDrawCostRef.current?.(drawCostP90(costs.current), costs.current.length);
      }
    },
    [],
  );

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const props = latest.current;

    const supplied = props.getBack?.() ?? null;
    if (supplied && supplied.image !== backImage.current) {
      backImage.current = supplied.image;
      if (backTexture.current !== frontTexture) backTexture.current.dispose();
      backTexture.current = makeTexture(supplied.image);
      backUv.current = uvMap(
        leafSourceRect(supplied.image.width, supplied.image.height, supplied.leafX, leafWidth, stageWidth),
        supplied.image.width,
        supplied.image.height,
        leafWidth,
        leafHeight,
        true,
      );
      sheet.material.uniforms.backMap!.value = backTexture.current;
    }
    const realBack = backImage.current !== null;
    const { color, wash } = backOfSheetPaper(paper, realBack);
    sheet.material.uniforms.backPaper!.value.set(color[0] / 255, color[1] / 255, color[2] / 255);
    sheet.material.uniforms.backWash!.value = wash;

    const startedAt = performance.now();
    const cone = computeConeFold(anchor, props.getPointer(), leafWidth, leafHeight, arc);
    const mesh = cone ? buildFoldMesh(cone, leafWidth, leafHeight) : null;
    if (!mesh || mesh.vertexCount > MAX_VERTICES) {
      group.visible = false;
      return;
    }
    const origin = props.getOrigin();
    group.position.set(origin.x, 0, origin.y);
    group.visible = true;
    writeSheet(
      sheet.geometry,
      mesh,
      paper,
      uvMap(frontSource, image.width, image.height, leafWidth, leafHeight, false),
      backUv.current,
    );
    writeShadow(shadow.geometry, mesh);
    costs.current.push(performance.now() - startedAt);
  });

  return (
    <>
      <CameraRig fit={deskViewFrame} up={DESK_CAMERA_UP} />
      <group ref={groupRef} visible={false}>
        <mesh geometry={shadow.geometry} material={shadow.material} renderOrder={0} />
        <mesh geometry={sheet.geometry} material={sheet.material} renderOrder={1} />
      </group>
    </>
  );
}

function makeTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace;
  // ⚠️ three's default is `flipY = true`, which uploads the bitmap upside down
  // so that `v = 0` is its *bottom* row. Every other coordinate in the fold —
  // `LeafSource`, the leaf's own px, the card bitmap's — runs downward from the
  // top, and `uvMap` computes `v` that way. Leaving the default on flips the
  // sheet vertically, which compounds with the back face's `u` mirroring into a
  // clean 180° rotation and reads as "the back page is wrong" rather than as a
  // texture setting.
  texture.flipY = false;
  return texture;
}

/** Buffers are allocated once at `MAX_VERTICES` and refilled in place; the
 * vertex count moves every frame, and reallocating attributes at 60fps is the
 * one part of this that would actually cost something. `setDrawRange` is what
 * makes the unused tail invisible. */
function makeSheet() {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(MAX_VERTICES * 3), 3));
  geometry.setAttribute("uvFront", new BufferAttribute(new Float32Array(MAX_VERTICES * 2), 2));
  geometry.setAttribute("uvBack", new BufferAttribute(new Float32Array(MAX_VERTICES * 2), 2));
  geometry.setAttribute("light", new BufferAttribute(new Float32Array(MAX_VERTICES * 2), 2));
  geometry.setAttribute("sheen", new BufferAttribute(new Float32Array(MAX_VERTICES), 1));
  geometry.setIndex(new BufferAttribute(new Uint32Array(MAX_VERTICES * 6), 1));
  const material = new ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    // One draw, and the sheet's two sides chosen per fragment by
    // `gl_FrontFacing` — the tail comes out back-facing on its own because it
    // has turned through PI, so nothing has to sort front from back.
    side: DoubleSide,
    uniforms: {
      frontMap: { value: null },
      backMap: { value: null },
      backPaper: { value: new Vector3() },
      backWash: { value: 0 },
    },
  });
  return { geometry, material };
}

function makeShadow() {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(MAX_VERTICES * 3), 3));
  geometry.setAttribute("alpha", new BufferAttribute(new Float32Array(MAX_VERTICES), 1));
  const material = new ShaderMaterial({
    vertexShader: SHADOW_VERTEX_SHADER,
    fragmentShader: SHADOW_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });
  return { geometry, material };
}

/**
 * Leaf-local px straight to texture coordinates: `u = ox + x * kx`.
 *
 * `LeafSource` is a *pixel* rect inside the card bitmap (single-page mode
 * takes the whole thing, spread mode one half), so this folds that slice, the
 * bitmap's own size and the sheet's mirroring into four numbers computed once
 * a turn rather than per vertex. `flipY` is left at three's default and `v`
 * runs downward, matching how the bitmap is addressed everywhere else here.
 */
export interface UvMap {
  ox: number;
  kx: number;
  oy: number;
  ky: number;
  /** The back of a sheet is reversed, so its `u` is read from the far side. */
  mirrorAt: number;
}

export function uvMap(
  source: LeafSource,
  bitmapWidth: number,
  bitmapHeight: number,
  leafWidth: number,
  leafHeight: number,
  mirrored: boolean,
): UvMap {
  const kx = source.width / Math.max(1, leafWidth) / bitmapWidth;
  return {
    ox: source.x / bitmapWidth,
    kx: mirrored ? -kx : kx,
    oy: source.y / bitmapHeight,
    ky: source.height / Math.max(1, leafHeight) / bitmapHeight,
    mirrorAt: mirrored ? leafWidth : 0,
  };
}

function writeSheet(
  geometry: BufferGeometry,
  mesh: FoldMesh,
  paper: Rgb,
  front: UvMap,
  back: UvMap,
) {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const uvFront = geometry.getAttribute("uvFront") as BufferAttribute;
  const uvBack = geometry.getAttribute("uvBack") as BufferAttribute;
  const light = geometry.getAttribute("light") as BufferAttribute;
  const sheen = geometry.getAttribute("sheen") as BufferAttribute;
  const index = geometry.getIndex() as BufferAttribute;
  const uvFrontArray = uvFront.array as Float32Array;
  const uvBackArray = uvBack.array as Float32Array;
  const lightArray = light.array as Float32Array;
  const sheenArray = sheen.array as Float32Array;

  (position.array as Float32Array).set(mesh.position.subarray(0, mesh.vertexCount * 3));
  for (let i = 0; i < mesh.vertexCount; i++) {
    const sx = mesh.source[i * 2]!;
    const sy = mesh.source[i * 2 + 1]!;
    uvFrontArray[i * 2] = front.ox + (sx - front.mirrorAt) * front.kx;
    uvFrontArray[i * 2 + 1] = front.oy + sy * front.ky;
    uvBackArray[i * 2] = back.ox + (sx - back.mirrorAt) * back.kx;
    uvBackArray[i * 2 + 1] = back.oy + sy * back.ky;
    const phi = mesh.phi[i]!;
    // Two lookups because the sheet's two sides face opposite ways and only
    // one of them is lit at a time; the sheen is a property of the *edge*
    // turning toward the reader and is the same from either side.
    lightArray[i * 2] = sheetShadingAt(phi, false, paper).light;
    const behind = sheetShadingAt(phi, true, paper);
    lightArray[i * 2 + 1] = behind.light;
    sheenArray[i] = behind.sheen;
  }
  (index.array as Uint32Array).set(mesh.index);
  geometry.setDrawRange(0, mesh.index.length);
  position.needsUpdate = true;
  uvFront.needsUpdate = true;
  uvBack.needsUpdate = true;
  light.needsUpdate = true;
  sheen.needsUpdate = true;
  index.needsUpdate = true;
}

/** The lifted sheet's footprint, laid flat just above the page it darkens.
 * Alpha falls off with how far the sheet above it has risen — see
 * `SHADOW_FALLOFF_PX`, which is where this shadow's softness comes from in the
 * absence of a blur. */
function writeShadow(geometry: BufferGeometry, mesh: FoldMesh) {
  const position = geometry.getAttribute("position") as BufferAttribute;
  const alpha = geometry.getAttribute("alpha") as BufferAttribute;
  const out = position.array as Float32Array;
  const alphas = alpha.array as Float32Array;
  let vertices = 0;
  for (const polygon of [mesh.rollShadow, mesh.tailShadow]) {
    const points = polygon.length / 3;
    for (let i = 1; i + 1 < points; i++) {
      for (const k of [0, i, i + 1]) {
        if (vertices >= MAX_VERTICES) break;
        out[vertices * 3] = polygon[k * 3]!;
        out[vertices * 3 + 1] = SHADOW_LIFT;
        out[vertices * 3 + 2] = polygon[k * 3 + 1]!;
        alphas[vertices] = SHADOW_ALPHA / (1 + polygon[k * 3 + 2]! / SHADOW_FALLOFF_PX);
        vertices++;
      }
    }
  }
  geometry.setDrawRange(0, vertices);
  position.needsUpdate = true;
  alpha.needsUpdate = true;
}
