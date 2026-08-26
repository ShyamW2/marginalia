import {
  ROLL_SAMPLE_COUNT,
  clipHalfPlane,
  sampleConeAt,
  type ConeFold,
  type Point,
} from "./pageFold.js";

/**
 * M27 "over the spine": the hinged sheet as a **mesh**, ready for the one 3D
 * seam to draw.
 *
 * `pageFold.ts` says why this file has to exist — a cone's rulings are not
 * parallel, so no band of it is a straight line under one affine, so canvas
 * 2D cannot express it (PAGE_CURL.md §2d). This turns the same solved cone
 * into triangles. It knows nothing about three.js: it produces plain typed
 * arrays and `PageFold3D.tsx` hands them to a `BufferGeometry`.
 *
 * ## Why the tessellation is a fan and not a grid
 *
 * The obvious mesh is a regular grid over the leaf, and it is the wrong one
 * twice over. The deformation depends on `psi` — the fan angle past the crease
 * — **and on nothing else**, exactly as the flat model depends on `w` alone.
 * Two consequences fall straight out:
 *
 * - **Along a ruling the surface is straight.** At fixed `psi` the position is
 *   `apex + r * direction` and the lift is `r * arcAngle * z`, both *linear* in
 *   `r`. So two vertices per ruling are not an approximation — they are exact,
 *   and a grid spends its whole budget subdividing a straight line.
 * - **Across `psi` the curvature is all in the roll**, which can be a hundredth
 *   of the leaf's angular span (and in the far field is a *ten-millionth* of
 *   it). A uniform grid resolving the roll's lip would need tens of thousands
 *   of vertices, and would still miss it whenever the apex ran far away.
 *
 * So the leaf is cut into **wedges between rulings**, at the roll's own
 * sample resolution, with the flat page and the tail taking one wedge each
 * because they are flat. That is roughly two hundred vertices for a fold the
 * grid would have spent thirty thousand on, and it is the same decomposition
 * `drawPageFold` already uses — bands between parallel creases, one dimension
 * poorer.
 *
 * ## Why the deformation is on the CPU
 *
 * It could be a vertex shader, and it must not be: the apex is held up to a
 * million leaf-diagonals down the spine (`FAR_APEX_DIAGONALS`), and **float32
 * cannot hold a leaf coordinate measured from there** — a `1e9` origin
 * quantises to tens of pixels. Deforming in float64 and uploading positions
 * sidesteps that entirely, and it is affordable precisely because the fan
 * needs so few vertices.
 */

/** Vertex attributes for one frame of the fold, in the Scene3D seam's units:
 * **one unit is one CSS pixel**, X right, Y up out of the page, Z down the
 * screen, origin at the turning leaf's top-left. The caller places that origin
 * in the world; nothing here knows where the leaf is on screen. */
export interface FoldMesh {
  vertexCount: number;
  /** xyz per vertex. */
  position: Float32Array;
  /** The leaf-space point each vertex came from, in leaf px — everything a
   * texture lookup needs, without this file having to know which slice of
   * which bitmap the leaf is. */
  source: Float32Array;
  /** The sheet's tangent angle per vertex (`ConeSample.phi`): what
   * `sheetShadingAt` turns into the paper's own light and sheen. */
  phi: Float32Array;
  /** Triangles, wound so that the sheet's **printed side** faces `+Y` where it
   * lies flat on the page. The tail therefore comes out back-facing on its
   * own, which is what lets one draw with `FrontSide` and one with `BackSide`
   * put the right page on each side of the sheet. */
  index: Uint32Array;
  /** The lifted sheet's footprint on the page under it, as two convex
   * polygons in leaf px (xy pairs) — the roll's and the tail's, matching the
   * two shadows `drawPageFold` throws. Empty while nothing is lifted. */
  rollShadow: Float32Array;
  tailShadow: Float32Array;
}

/** A leaf-space polygon, and the wedge of fan angle it was cut from. */
interface Wedge {
  poly: Point[];
  psiLow: number;
  psiHigh: number;
}

/**
 * The direction in which fan angle *increases* at `psi` — the outward normal
 * of the half-plane "everything at a larger angle than this ruling".
 *
 * It is the derivative of the ruling direction with respect to the angle, and
 * writing it analytically rather than differencing two rulings matters in the
 * far field, where neighbouring rulings are `1e-9` radians apart and a
 * difference would be all rounding.
 */
function fanNormal(cone: ConeFold, psi: number): Point {
  const a = cone.creaseAngle + psi;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const w = cone.winding;
  return {
    x: -cone.spineDir.x * sin - cone.spineDir.y * cos * w,
    y: -cone.spineDir.y * sin + cone.spineDir.x * cos * w,
  };
}

/**
 * Where the fan is cut, in ascending angle: the leaf's own extremes, the
 * crease, the tail's start, and the roll's own sample points in between.
 *
 * Nothing is spent on the flat page or the tail — they are planar, so one
 * wedge covers each exactly.
 */
function fanCuts(cone: ConeFold, psiMin: number, psiMax: number): number[] {
  const cuts = [psiMin, psiMax];
  const push = (psi: number) => {
    if (psi > psiMin && psi < psiMax) cuts.push(psi);
  };
  push(0);
  if (cone.arcAngle > 0) {
    for (let i = 1; i < ROLL_SAMPLE_COUNT; i++) push((cone.arcAngle * i) / ROLL_SAMPLE_COUNT);
    push(cone.arcAngle);
  }
  cuts.sort((a, b) => a - b);
  // Neighbours can collide when the leaf's own span cuts across a sample.
  return cuts.filter((psi, i) => i === 0 || psi - cuts[i - 1]! > 0);
}

/** Twice the signed area of a leaf-space polygon; the sign is the winding. */
function signedArea2(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Cut the leaf into wedges of fan angle. Every wedge is convex (a rectangle
 * clipped by two half-planes), and adjacent wedges share their ruling edge
 * exactly, so the mesh is watertight without any vertex welding.
 */
function cutWedges(cone: ConeFold, width: number, height: number): Wedge[] {
  const rect: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  let psiMin = Infinity;
  let psiMax = -Infinity;
  for (const corner of rect) {
    const { psi } = sampleConeAt(cone, corner);
    psiMin = Math.min(psiMin, psi);
    psiMax = Math.max(psiMax, psi);
  }
  if (!Number.isFinite(psiMin) || !(psiMax > psiMin)) return [];

  const cuts = fanCuts(cone, psiMin, psiMax);
  const wedges: Wedge[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const low = cuts[i]!;
    const high = cuts[i + 1]!;
    const below = fanNormal(cone, low);
    const above = fanNormal(cone, high);
    // `clipHalfPlane` keeps `dot(p - linePoint, normal) <= 0`, so the "at least
    // `low`" side needs the normal reversed and the "at most `high`" side does
    // not. Both lines pass through the apex, which is what makes them rulings.
    const poly = clipHalfPlane(
      clipHalfPlane(rect, cone.apex, { x: -below.x, y: -below.y }),
      cone.apex,
      above,
    );
    if (poly.length >= 3) wedges.push({ poly, psiLow: low, psiHigh: high });
  }
  return wedges;
}

/** Deform a wedge's polygon and lay it out as a triangle fan, appending to the
 * buffers. Returns the deformed polygon, which the shadows are built from. */
function emitWedge(
  cone: ConeFold,
  poly: Point[],
  out: { position: number[]; source: number[]; phi: number[]; index: number[] },
): Point[] {
  const base = out.phi.length;
  const deformed: Point[] = [];
  for (const p of poly) {
    const { at, lift, phi } = sampleConeAt(cone, p);
    out.position.push(at.x, lift, at.y);
    out.source.push(p.x, p.y);
    out.phi.push(phi);
    deformed.push(at);
  }
  // Wound so the flat sheet faces +Y. In leaf space y runs *down* the screen
  // and the seam's +Y comes up out of it, so a polygon that is
  // counter-clockwise on screen is clockwise about the up axis — hence the
  // reversal, and hence reading the winding rather than assuming it (the
  // clipper preserves the rect's, but a wedge that clips to a sliver need not
  // be trusted to).
  const flip = signedArea2(poly) > 0;
  for (let i = 1; i + 1 < poly.length; i++) {
    if (flip) out.index.push(base, base + i + 1, base + i);
    else out.index.push(base, base + i, base + i + 1);
  }
  return deformed;
}

function flatten(polys: Point[][]): Float32Array {
  const out: number[] = [];
  for (const poly of polys) for (const p of poly) out.push(p.x, p.y);
  return new Float32Array(out);
}

/**
 * Build one frame's mesh for a solved cone.
 *
 * Returns `null` for a cone that covers no part of the leaf, which is not a
 * failure — it is a drag that has not moved the sheet, and the caller draws
 * nothing rather than an empty mesh.
 */
export function buildFoldMesh(cone: ConeFold, width: number, height: number): FoldMesh | null {
  const wedges = cutWedges(cone, width, height);
  if (wedges.length === 0) return null;

  const out = { position: [] as number[], source: [] as number[], phi: [] as number[], index: [] as number[] };
  const rollShadow: Point[][] = [];
  const tailShadow: Point[][] = [];
  for (const wedge of wedges) {
    const deformed = emitWedge(cone, wedge.poly, out);
    // Shadow footprints, at the same fidelity `drawPageFold` gives them:
    // "near enough for a blurred shadow", which a convex piece per wedge
    // comfortably is. Only lifted sheet throws one.
    if (wedge.psiHigh <= 0) continue;
    (wedge.psiLow >= cone.arcAngle ? tailShadow : rollShadow).push(deformed);
  }
  if (out.phi.length === 0) return null;

  return {
    vertexCount: out.phi.length,
    position: new Float32Array(out.position),
    source: new Float32Array(out.source),
    phi: new Float32Array(out.phi),
    index: new Uint32Array(out.index),
    rollShadow: flatten(rollShadow),
    tailShadow: flatten(tailShadow),
  };
}
