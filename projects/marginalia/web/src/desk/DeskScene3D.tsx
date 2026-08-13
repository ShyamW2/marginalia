import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  MathUtils,
  MeshStandardMaterial,
  Vector3,
  type Group,
  type Mesh,
  type PerspectiveCamera,
} from "three";
import type { MotionValue } from "motion/react";
import { Book3D } from "../scene3d/Book3D.js";
import { bookThickness, deskCameraFrame, deskPerspectiveDistance, stackElevation } from "./deskDepthMath.js";
import { GRAIN_TILE_HEIGHT, GRAIN_TILE_WIDTH, makeWoodTexture } from "./woodTexture.js";
import { Turntable3D, type Turntable3DProps } from "./Turntable3D.js";
import { useDeskThemeColors } from "./useDeskThemeColors.js";

// BookObject.module.css/DeskCanvas.tsx's own footprint: 168px cover, 2:3.
const BOOK_WIDTH = 168;
const BOOK_HEIGHT = 252;
// Enough separation that two overlapping books never z-fight, small enough
// that the perspective splay it costs stays under a pixel (deskDepthMath.ts's
// `stackElevation`).
const STACK_STEP = 0.5;
const BASE_ELEVATION = 0.35;
// Exponential-decay rate for the lift, in units of "e-folds per second" —
// MathUtils.damp's own lambda. High enough to feel immediate, low enough that
// the book settles rather than snapping.
const LIFT_LAMBDA = 13;

const UP = new Vector3(0, 1, 0);

export interface DeskBookPlacement {
  resourceId: string;
  /** M23 §D: lettered down the binding, so a book dragged off the optical axis
   * is identifiable by its spine the same way it is on the shelf. */
  title: string;
  rotationDeg: number;
  zOrder: number;
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** Target height above the desk, in px — written by the DOM `BookObject`
   * (hover, drag) and damped toward here, so the 3D object reacts to the same
   * gesture as its hit target without the two needing to share a spring. */
  lift: MotionValue<number>;
}

interface Origin {
  x: number;
  z: number;
}

/**
 * M23 §B: the desk's 3D depth layer, registered into the one shared canvas
 * (`scene3d/Scene3D.tsx`) by `DeskCanvas.tsx`. Renders the same `Book3D`
 * asset §A built, laid flat on a surface seen from above through a real
 * perspective camera — see `deskDepthMath.ts` for the camera's construction,
 * for why its 1:1 desk plane is what keeps drag/drop hit-testing exact, and
 * for the three defects in the faked-tilt version this replaced.
 *
 * This component only ever *reads* book position (via the live `x`/`y` motion
 * values `DeskCanvas.tsx` owns) — it never writes back to the desk's layout
 * state, so no camera or material change here can re-lay-out the desk.
 */
export function DeskScene3D({
  books,
  deskRef,
  turntable,
}: {
  books: DeskBookPlacement[];
  deskRef: RefObject<HTMLElement>;
  /** M23 §C. Optional so the desk's scene stays renderable without it — the
   * turntable is an object standing on this surface, not part of it. */
  turntable?: Turntable3DProps;
}) {
  const originRef = useRef<Origin>({ x: 0, z: 0 });

  useFrame(() => {
    const rect = deskRef.current?.getBoundingClientRect();
    if (rect) {
      originRef.current.x = rect.left;
      originRef.current.z = rect.top;
    }
  });

  const zOrders = useMemo(() => books.map((b) => b.zOrder), [books]);

  return (
    <>
      <DeskCameraRig />
      <DeskSurface deskRef={deskRef} originRef={originRef} />
      {turntable && <Turntable3D {...turntable} />}
      {books.map((book) => (
        <DeskBook3D
          key={book.resourceId}
          book={book}
          originRef={originRef}
          elevation={BASE_ELEVATION + stackElevation(book.zOrder, zOrders, STACK_STEP)}
        />
      ))}
    </>
  );
}

/**
 * A perspective camera hung straight above the viewport's centre, refitted
 * every frame, whose field of view is chosen so the desk plane (`y = 0`) maps
 * to viewport pixels 1:1 — `deskDepthMath.ts`'s `deskCameraFrame` does the
 * arithmetic and carries the derivation.
 *
 * Anchored to the **viewport**, not to the desk element: scrolling a desk
 * taller than the window then slides the surface under a fixed eye, exactly
 * as moving a page around under a desk lamp would, rather than dragging the
 * whole point of view along with it.
 */
function DeskCameraRig() {
  const cameraRef = useRef<PerspectiveCamera>(null!);
  const { size, set, camera: previousCamera } = useThree();

  useEffect(() => {
    const camera = cameraRef.current;
    // R3F's own resize handling overwrites a camera's projection on every
    // size change unless told it is manually managed (`updateCamera` in R3F's
    // source) — without this flag it silently stomped the frustum below, and
    // R3F's *default* camera (never removed from the scene, just no longer
    // the active one) was what actually rendered instead. Caught live at §B's
    // first attempt as a keystoned book shape that had nothing to do with the
    // geometry.
    // Untyped in three.js's own Camera — R3F's own convention, not exposed as
    // a public property.
    (camera as PerspectiveCamera & { manual?: boolean }).manual = true;
    // Screen-down is +Z, so the camera's own up vector points at -Z: this is
    // what makes world (x, 0, z) land on screen pixel (x, z) rather than on
    // its vertical mirror.
    camera.up.set(0, 0, -1);
    set({ camera });
    return () => set({ camera: previousCamera });
    // Runs once: `set`/`previousCamera` come from the R3F store and aren't
    // meant to re-trigger this — the frustum itself is refitted every frame
    // below, independent of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const camera = cameraRef.current;
    const frame = deskCameraFrame(size.width, size.height, deskPerspectiveDistance(size.height));
    camera.fov = frame.fov;
    camera.aspect = frame.aspect;
    camera.near = frame.near;
    camera.far = frame.far;
    camera.position.set(frame.position[0], frame.position[1], frame.position[2]);
    camera.lookAt(frame.target[0], frame.target[1], frame.target[2]);
    camera.updateProjectionMatrix();
  });

  return <perspectiveCamera ref={cameraRef} />;
}

/**
 * The desk's own surface and its raised edge — TASKS.md M23 §B's "a desk that
 * looks like a desk". Sized and positioned from the same container rect every
 * frame as the books above it, so it always exactly covers the desk's real
 * (possibly taller-than-viewport, scrollable) extent rather than just
 * whatever's currently on screen.
 *
 * The surface sits at `y = 0`, which is the plane `DeskCameraRig` maps 1:1 to
 * the viewport: the desk is the one thing in the scene guaranteed to land
 * exactly on its DOM footprint, and everything else gets its depth by
 * standing on it.
 */
function DeskSurface({ deskRef, originRef }: { deskRef: RefObject<HTMLElement>; originRef: MutableRefObject<Origin> }) {
  const planeRef = useRef<Mesh>(null!);
  const edgeRefs = useRef<(Mesh | null)[]>([null, null, null, null]);
  const colors = useDeskThemeColors();

  const surfaceMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.82, metalness: 0 }), []);
  const edgeMaterial = useMemo(() => new MeshStandardMaterial({ roughness: 0.6, metalness: 0 }), []);

  useEffect(() => {
    surfaceMaterial.color.set(colors.surface);
    edgeMaterial.color.set(colors.rim);
    const texture = makeWoodTexture(colors.surface, colors.grain);
    if (texture) {
      // Tint comes from the tile itself, so the material's own colour goes
      // white — multiplying the two would darken the desk on every theme read.
      surfaceMaterial.color.set("#ffffff");
      surfaceMaterial.map = texture;
    } else {
      surfaceMaterial.map = null;
    }
    surfaceMaterial.needsUpdate = true;
    return () => texture?.dispose();
  }, [colors, surfaceMaterial, edgeMaterial]);

  useEffect(() => {
    return () => {
      surfaceMaterial.dispose();
      edgeMaterial.dispose();
    };
  }, [surfaceMaterial, edgeMaterial]);

  useFrame(() => {
    const rect = deskRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const width = rect.width;
    const height = rect.height;
    const centerX = originRef.current.x + width / 2;
    const centerZ = originRef.current.z + height / 2;

    const plane = planeRef.current;
    plane.scale.set(width, height, 1);
    plane.position.set(centerX, 0, centerZ);
    const map = surfaceMaterial.map;
    if (map) {
      // Repeat in world px, not in plane-local UVs — otherwise the grain
      // stretches with the window instead of the desk simply showing more of
      // the same board.
      map.repeat.set(width / GRAIN_TILE_WIDTH, height / GRAIN_TILE_HEIGHT);
    }

    // Four boxes framing the plane's perimeter — top, bottom, left, right, in
    // that order — a shallow lip rather than a hard bevel. Under a perspective
    // camera these are the desk's own depth cue: the near rails show their
    // inner faces, the far ones their outer, and the frame leans outward from
    // the centre exactly as a real tray would.
    const rim = 10;
    const rimHeight = 7;
    const [top, bottom, left, right] = edgeRefs.current;
    top?.scale.set(width + rim * 2, rimHeight, rim);
    top?.position.set(centerX, rimHeight / 2, originRef.current.z - rim / 2);
    bottom?.scale.set(width + rim * 2, rimHeight, rim);
    bottom?.position.set(centerX, rimHeight / 2, originRef.current.z + height + rim / 2);
    left?.scale.set(rim, rimHeight, height);
    left?.position.set(originRef.current.x - rim / 2, rimHeight / 2, centerZ);
    right?.scale.set(rim, rimHeight, height);
    right?.position.set(originRef.current.x + width + rim / 2, rimHeight / 2, centerZ);
  });

  return (
    <>
      <mesh ref={planeRef} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[1, 1]} />
        <primitive object={surfaceMaterial} attach="material" />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            edgeRefs.current[i] = el;
          }}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[1, 1, 1]} />
          <primitive object={edgeMaterial} attach="material" />
        </mesh>
      ))}
    </>
  );
}

/**
 * One book, resting on the desk and followed live off the DOM `BookObject`'s
 * own motion values so it moves in step with an in-progress drag rather than
 * jumping once the drag commits (TASKS.md: "smoothly animated, not stepped").
 *
 * The group's origin is the centre of the book's **footprint** — the face
 * touching the desk — because that footprint is what the perspective camera
 * maps 1:1 onto the DOM hit target (`deskDepthMath.ts`). Everything that gives
 * the book its depth stands above that origin, so no amount of thickness or
 * hover lift can move the object away from the rect you can actually grab.
 */
function DeskBook3D({
  book,
  originRef,
  elevation,
}: {
  book: DeskBookPlacement;
  originRef: MutableRefObject<Origin>;
  elevation: number;
}) {
  const groupRef = useRef<Group>(null!);
  const liftRef = useRef(0);
  const thickness = useMemo(() => bookThickness(book.resourceId), [book.resourceId]);

  useFrame((_state, delta) => {
    const group = groupRef.current;
    const worldX = originRef.current.x + book.x.get() + BOOK_WIDTH / 2;
    const worldZ = originRef.current.z + book.y.get() + BOOK_HEIGHT / 2;

    // Clamped: a backgrounded tab resumes with a delta of whole seconds, and
    // an unclamped damp over that snaps rather than settles.
    liftRef.current = MathUtils.damp(liftRef.current, book.lift.get(), LIFT_LAMBDA, Math.min(delta, 0.05));

    group.position.set(worldX, elevation + liftRef.current, worldZ);
    group.quaternion.identity();
    // Lay the book flat (its local +z, the cover's outward normal, becomes
    // world +y), then yaw it about the world vertical. Negated because the
    // stored rotation is a CSS `rotate()` — positive is *clockwise* on screen,
    // where a positive rotation about +Y is counter-clockwise seen from above.
    // The two disagreeing is a silent bug: the 3D book and its DOM hit target
    // sit at mirrored angles, worst at the corners where the rect is widest.
    group.rotateX(-Math.PI / 2);
    group.rotateOnWorldAxis(UP, MathUtils.degToRad(-book.rotationDeg));
  });

  return (
    <group ref={groupRef}>
      {/* Local-space offset, so it yaws with the book: back half a cover width
          to centre the spine-at-x=0 asset on the group, and up half a
          thickness so the book's underside — not its middle — rests at y = 0.
          Book3D is centred on its own z (see its docstring); skipping this
          buries half the book under the desk, which is what read as "the
          books are cut off" in the faked-tilt version. */}
      <group position={[-BOOK_WIDTH / 2, 0, thickness / 2]}>
        <Book3D
          resourceId={book.resourceId}
          title={book.title}
          width={BOOK_WIDTH}
          height={BOOK_HEIGHT}
          thickness={thickness}
        />
      </group>
    </group>
  );
}
