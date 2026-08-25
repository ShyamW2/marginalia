/**
 * M20 "the paper fold": the geometry and canvas drawing behind the page
 * curl.
 *
 * decisions.md 2026-07-20 specified a **flat** fold — the sheet creased
 * about the perpendicular bisector of corner→pointer, mirrored, dimmed.
 * That shipped, and it reads as a folded napkin rather than as Apple Books:
 * paper does not crease when you peel it, it *rolls*. 2026-08-01 amends the
 * ruling to the **rolled sheet** below (see decisions.md); the bisector
 * survives as this model's degenerate case at zero arc length, which is why
 * the whole file is still one closed-form construction and not a mesh.
 *
 * ## The model
 *
 * Work in the **fold frame**: `peelDir` is the unit vector from the grabbed
 * corner `C` toward the pointer `P`, `creaseDir` is perpendicular to it, and
 * a page point's only interesting coordinate is
 *
 *     w(q) = (creasePoint - q) · peelDir
 *
 * — its signed distance from the crease, positive on the corner's side. The
 * sheet is then, in order of `w`:
 *
 *   - `w <= 0`     flat, undisturbed, lying on the leaf.
 *   - `0 < w <= arc`  **the roll**: the sheet leaves the page tangentially
 *     and curves through a half turn. Its curvature *ramps* (see
 *     `ROLL_EASE`) rather than being constant — a real peeled page starts
 *     bending gently and tightens as it comes over, and the ramp is what
 *     gives the curl the tight lip that reads as paper rather than as an
 *     inflated tube.
 *   - `w > arc`    **the tail**: flat again, upside down, floating
 *     `tailHeight` above the leaf — the mirrored back of the sheet lying
 *     over the page you are turning to.
 *
 * Because `w` is the only input, the whole deformation is a **shift along
 * `peelDir` that depends on `w` alone**. Every band of constant `w` stays a
 * straight line parallel to the crease, so each band paints as one
 * `drawImage` through one affine transform — no mesh, no WebGL, and the
 * flat page and the tail (by far the most pixels, and the only text you
 * actually read) are each a *single* undistorted blit.
 *
 * Coordinate system throughout: **leaf-local CSS pixels**, origin at the
 * top-left of whichever leaf is turning (the whole stage in single-page
 * mode, one half of it in spread mode — see readerGeometry.ts's
 * `nearLeafRect`). The caller positions the canvas element at that leaf's
 * screen rect; nothing in here knows about the spread split.
 */

export interface Point {
  x: number;
  y: number;
}

export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** Grabbing an edge at its middle, rather than pinching a corner: the whole
 * edge lifts and the crease stays parallel to the spine. The geometry below
 * does not care where the sheet is anchored — only that there *is* an anchor
 * point the pointer drags — so this is an anchoring change, not a second
 * model. */
export interface EdgeAnchor {
  edge: "left" | "right";
}

/** What the sheet is held by: a corner (the dog-ear pinch) or the middle of
 * an edge (the flat-handed peel). */
export type FoldAnchor = Corner | EdgeAnchor;

export function isEdgeAnchor(anchor: FoldAnchor): anchor is EdgeAnchor {
  return typeof anchor !== "string";
}

/** The anchor's point on the leaf — the point that must land exactly under
 * the pointer, whichever kind of anchor it is. */
export function anchorPoint(anchor: FoldAnchor, width: number, height: number): Point {
  if (isEdgeAnchor(anchor)) {
    return { x: anchor.edge === "left" ? 0 : width, y: height / 2 };
  }
  return cornerPoint(anchor, width, height);
}

/** Where the anchor sweeps *to* on a full flip: the far corner for a pinch,
 * the middle of the far edge for an edge peel. */
export function oppositeAnchorPoint(
  anchor: FoldAnchor,
  width: number,
  height: number,
): Point {
  if (isEdgeAnchor(anchor)) {
    return { x: anchor.edge === "left" ? width : 0, y: height / 2 };
  }
  return cornerPoint(oppositeCorner(anchor), width, height);
}

/**
 * The pointer as the *fold* sees it, which for an edge peel is not where the
 * cursor is.
 *
 * A crease parallel to the spine means `peelDir` is horizontal, and
 * `peelDir` is the direction anchor→pointer — so the fold pointer's `y` is
 * pinned to the anchor's. The cursor keeps moving freely (the drag's
 * progress still tracks the real distance); it is only the sheet that
 * refuses to tilt, the way an edge lifted with a flat hand does. Corner
 * pinches are unconstrained and pass through untouched.
 */
export function constrainFoldPointer(
  anchor: FoldAnchor,
  pointer: Point,
  width: number,
  height: number,
): Point {
  if (!isEdgeAnchor(anchor)) return pointer;
  return { x: pointer.x, y: anchorPoint(anchor, width, height).y };
}

/** How much of an edge, centred on its middle, peels as a whole edge rather
 * than snapping to the nearer corner. A third: enough that "I grabbed the
 * middle" is reliably the middle, narrow enough that the corners keep the
 * generous targets the M11 zone shape gives them. */
const EDGE_ANCHOR_BAND = 1 / 3;

/**
 * What a grab at `grabY` on this edge is holding. Inside the middle band the
 * sheet is held by the edge (crease parallel to the spine, the whole edge
 * lifting); outside it, by the nearer corner, exactly as before.
 */
export function anchorForGrab(
  edge: "left" | "right",
  grabY: number,
  leafHeight: number,
): FoldAnchor {
  const t = leafHeight > 0 ? grabY / leafHeight : 0.5;
  if (Math.abs(t - 0.5) < EDGE_ANCHOR_BAND / 2) return { edge };
  return nearestCorner(edge, grabY, leafHeight);
}

/** The corner Apple Books' own page-turn animation grabs by default, absent
 * a real pointer — the bottom of the edge, matching how you'd naturally
 * dog-ear a physical page. */
export function defaultCornerForDirection(direction: "prev" | "next"): Corner {
  return direction === "next" ? "bottomRight" : "bottomLeft";
}

export function cornerPoint(corner: Corner, width: number, height: number): Point {
  return {
    x: corner === "topLeft" || corner === "bottomLeft" ? 0 : width,
    y: corner === "topLeft" || corner === "topRight" ? 0 : height,
  };
}

export function oppositeCorner(corner: Corner): Corner {
  switch (corner) {
    case "topLeft":
      return "bottomRight";
    case "topRight":
      return "bottomLeft";
    case "bottomLeft":
      return "topRight";
    case "bottomRight":
      return "topLeft";
  }
}

/** Which corner is nearest a grab point inside a leaf of the given size —
 * used to anchor a real drag (M20 "grab anywhere in the outer band": the
 * fold anchors to whichever corner is nearest the grab point, not the
 * whole edge). `edge` fixes the left/right half of the choice (which side
 * of the leaf the grab surface lives on); only top-vs-bottom is decided by
 * the grab point's height. */
export function nearestCorner(
  edge: "left" | "right",
  grabY: number,
  leafHeight: number,
): Corner {
  const top = grabY < leafHeight / 2;
  if (edge === "left") return top ? "topLeft" : "bottomLeft";
  return top ? "topRight" : "bottomRight";
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// ---------------------------------------------------------------------------
// The roll profile
// ---------------------------------------------------------------------------

/**
 * The roll's shape, as the exponent in `phi(s) = PI * s^ROLL_EASE` — the
 * tangent angle after a fraction `s` of the roll's arc.
 *
 * At 1 the curvature is constant — a plain cylinder, which reads as an
 * inflated tube: the sheet comes back to exactly where it left the page, so
 * the lip is as fat as the roll's whole footprint. Above 1 the sheet leaves
 * the page almost straight and does its turning late, which is what real
 * paper does, and the lip draws in tighter and crisper the higher it goes.
 * 2.2 is the middle of that range.
 *
 * What it does *not* buy, and this is worth stating because it looks like it
 * should: seeing the page's own text squeeze into the curl, which Apple
 * Books does and this does not. Orthographically the tail always covers that
 * band — the tail projects from the roll's far end back *across* the crease,
 * so whatever front-facing sheet the roll leaves showing ends up underneath
 * it. Only a real perspective camera lifts the tail's near edge clear of it,
 * and that means a mesh warp. Deliberately out of scope; see decisions.md
 * 2026-08-01.
 */
const ROLL_EASE = 2.2;

/** Resolution of the precomputed roll profile, and the ceiling on how many
 * bands one half of the roll may be drawn as. The *actual* band count is
 * chosen per frame from the roll's size on screen — see `bandCount`. */
const ROLL_SAMPLES = 40;

interface RollSample {
  /** Arc length from the crease, as a fraction of the roll's total. */
  s: number;
  /** Tangent angle: 0 flat-and-outbound, PI/2 edge-on, PI flat-and-inbound. */
  phi: number;
  /** Projected offset from the crease toward the corner, per unit arc. */
  o: number;
  /** Height above the leaf, per unit arc. */
  z: number;
}

/** The roll's shape, normalized to unit arc length. Fixed at module load —
 * `ROLL_EASE` is a constant, so scaling this by the frame's arc length is
 * the whole per-frame geometry cost. */
const ROLL_PROFILE: readonly RollSample[] = buildRollProfile();

function buildRollProfile(): RollSample[] {
  const phiAt = (s: number) => Math.PI * Math.pow(s, ROLL_EASE);

  const out: RollSample[] = [{ s: 0, phi: 0, o: 0, z: 0 }];
  const step = 1 / ROLL_SAMPLES;
  let o = 0;
  let z = 0;
  for (let i = 1; i <= ROLL_SAMPLES; i++) {
    // Midpoint rule: second-order accurate, so 40 samples put the roll's
    // endpoint within a fraction of a pixel of the exact integral.
    const phiMid = phiAt((i - 0.5) * step);
    o += Math.cos(phiMid) * step;
    z += Math.sin(phiMid) * step;
    out.push({ s: i * step, phi: phiAt(i * step), o, z });
  }
  return out;
}

/** Where the roll ends, per unit arc length: `o` is how far short of the
 * crease the sheet comes back (the width of the visible front-facing band,
 * and the offset of the tail), `z` how high it floats. */
const ROLL_END = ROLL_PROFILE[ROLL_PROFILE.length - 1]!;

/** The roll's outermost projected offset, per unit arc — the silhouette the
 * page beneath is revealed past. */
const ROLL_PEAK_O = ROLL_PROFILE.reduce((m, p) => Math.max(m, p.o), 0);

/** Index of the sample at that peak: the boundary between the front-facing
 * half of the roll and the back-facing half, and therefore the point where
 * the paint order flips from "still the page" to "the back of the sheet". */
const ROLL_PEAK_INDEX = ROLL_PROFILE.reduce(
  (best, p, i) => (p.o >= ROLL_PROFILE[best]!.o ? i : best),
  0,
);

/**
 * The roll's arc length for a leaf of this size, before the drag-distance
 * clamp in `computeFold`. Proportional to the leaf's short side so the curl
 * keeps the same visual weight at every window size and in both spread
 * modes. The *projected* roll is `ROLL_PEAK_O` (~0.58) of this, so 0.26 puts
 * the curl's footprint at ~15% of the leaf's short side: chunky enough to
 * read as a rolled sheet at a glance, short of the beach-towel look a wider
 * one takes on.
 */
export function curlArcLength(leafWidth: number, leafHeight: number): number {
  return Math.min(leafWidth, leafHeight) * 0.26;
}

// ---------------------------------------------------------------------------
// Fold geometry
// ---------------------------------------------------------------------------

/** A full page turn drags the corner well past the opposite one — short of
 * that, the fold would stall short of a full flip. The crease sits at
 * `creaseToCorner` from the grabbed corner, and the last point of the leaf
 * to flip sides is the *opposite* corner (every other corner's projection
 * onto C→P is strictly smaller), so the leaf is only fully covered once the
 * crease clears the diagonal. The roll pays for part of that distance, so
 * the pointer needs a shade under 2x the diagonal; 2.2x keeps the safety
 * margin the flat fold needed (found live at 1.6x: a thin flat corner that
 * visibly never finished folding away) and holds for every roll size.
 *
 * The same factor covers an edge anchor: the crease is then parallel to the
 * spine and the last points to flip are the two far corners, whose
 * projection onto the (horizontal) peel direction is exactly the sweep's own
 * target — the corner case's inequality with a tie instead of a strict
 * margin. */
const SWEEP_OVERSHOOT = 2.2;

/** Synthetic pointer path for a programmatic turn (click/keyboard — no real
 * pointer to sample): sweeps diagonally from the anchor corner, through the
 * opposite corner, and on past the far edge as `progress` goes 0 → 1, so
 * the fold completes into a full flip rather than stalling at a half-fold. */
export function syntheticFoldPointer(
  anchor: FoldAnchor,
  width: number,
  height: number,
  progress: number,
): Point {
  const from = anchorPoint(anchor, width, height);
  const to = oppositeAnchorPoint(anchor, width, height);
  // A zero-length C→P vector makes the fold direction undefined; a touch
  // above zero keeps the roll infinitesimal instead of undefined at
  // progress 0, so the very first frame is well-defined without a special
  // case downstream.
  const t = Math.max(progress, 0.001) * SWEEP_OVERSHOOT;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Sutherland-Hodgman clip of a convex polygon against one half-plane: the
 * line through `linePoint` with normal `normal`, keeping the side where
 * `dot(p - linePoint, normal) <= 0`. */
function clipHalfPlane(poly: Point[], linePoint: Point, normal: Point): Point[] {
  if (poly.length === 0) return [];
  const side = (p: Point) => (p.x - linePoint.x) * normal.x + (p.y - linePoint.y) * normal.y;
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i]!;
    const next = poly[(i + 1) % poly.length]!;
    const currSide = side(curr);
    const nextSide = side(next);
    if (currSide <= 0) out.push(curr);
    if ((currSide < 0 && nextSide > 0) || (currSide > 0 && nextSide < 0)) {
      const t = currSide / (currSide - nextSide);
      out.push({ x: curr.x + (next.x - curr.x) * t, y: curr.y + (next.y - curr.y) * t });
    }
  }
  return out;
}

export interface FoldGeometry {
  /** Unit vector from the grabbed corner toward the pointer — the direction
   * the sheet peels, and the axis the entire deformation runs along. */
  peelDir: Point;
  /** Unit vector along the crease. Chosen so that `[-peelDir, creaseDir]` is
   * a rotation (not a reflection), which is what lets the paint routine
   * express the fold frame as a plain `ctx.rotate`. */
  creaseDir: Point;
  /** A point on the crease — the line the sheet lifts off along. Unlike the
   * flat fold this is *not* the midpoint of corner→pointer: the roll eats
   * arc length, so the crease sits `arc * (1 + rollEndO) / 2` further from
   * the corner than the bisector would. */
  creasePoint: Point;
  /** Distance from the grabbed corner to the crease, along `peelDir`. */
  creaseToCorner: number;
  /** Arc length of the rolled section, in leaf px. Zero-ish at the very
   * start of a drag (there is not yet enough peeled sheet to roll), rising
   * to `curlArcLength`. */
  arc: number;
  /** Projected offset of the roll's outermost silhouette from the crease,
   * toward the corner. The live page beneath is revealed past this. */
  peakOffset: number;
  /** Projected offset of the roll's far end — where the tail begins, and
   * the width of the band of front-facing sheet the roll leaves visible. */
  tailOffset: number;
  /** How high the tail floats above the leaf. Drives the cast shadow. */
  tailHeight: number;
  /** The flat, undisturbed remainder of the leaf, in leaf coordinates —
   * drawn as-is. Empty once the fold has swept the whole page. */
  restPolygon: Point[];
  /** The tail's footprint *after* deformation — where the mirrored back of
   * the sheet paints. */
  tailPolygon: Point[];
  /** The roll's footprint, near enough for a cast shadow: the leaf clipped
   * to the front-facing half of the roll, mapped through the linear
   * approximation of that half. The exact silhouette is the union of the
   * strips the paint routine draws, and is not worth reconstructing for a
   * blurred shadow. */
  rollPolygon: Point[];
}

/**
 * The full fold geometry for an anchor `C` grabbed toward pointer `P` on a
 * `width` x `height` leaf. `arcTarget` is the roll's arc length in px
 * (`curlArcLength`); it is clamped down early in a drag, when the sheet has
 * not been peeled far enough to accommodate the roll.
 *
 * The anchor is a corner (the pinch) or the middle of an edge (the flat
 * peel) — nothing below distinguishes them, because the model only ever
 * asks the anchor for a *point*. An edge anchor reads as an edge lifting
 * flat because the caller pins the pointer's `y` to the anchor's
 * (`constrainFoldPointer`), which makes `peelDir` horizontal and therefore
 * the crease parallel to the spine.
 *
 * Returns `null` when `C` and `P` coincide — no drag yet, nothing to draw.
 */
export function computeFold(
  anchor: FoldAnchor,
  pointer: Point,
  width: number,
  height: number,
  arcTarget: number = curlArcLength(width, height),
): FoldGeometry | null {
  const c = anchorPoint(anchor, width, height);
  const dx = pointer.x - c.x;
  const dy = pointer.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.01) return null;

  const peelDir: Point = { x: dx / d, y: dy / d };
  // Deliberately (n.y, -n.x) and not (-n.y, n.x): with this handedness the
  // basis [-peelDir, creaseDir] has determinant +1, so the paint routine can
  // enter the fold frame with a rotation rather than a reflection.
  const creaseDir: Point = { x: peelDir.y, y: -peelDir.x };

  // The corner has to land exactly on the pointer, which fixes where the
  // crease goes. Following the sheet from the crease: `arc` of it is rolled
  // and comes back to `arc * ROLL_END.o` short of the crease, then the tail
  // runs flat back across it. Writing `a` for the crease-to-corner distance,
  // the corner's projected offset is `arc*ROLL_END.o - (a - arc)`, and the
  // pointer sits at `a - d`; equating them gives the line below. At
  // `arc = 0` it collapses to `a = d/2` — the old perpendicular bisector.
  const arc = Math.min(arcTarget, d / (1 - ROLL_END.o));
  const creaseToCorner = (d + arc * (1 + ROLL_END.o)) / 2;
  const creasePoint: Point = {
    x: c.x + peelDir.x * creaseToCorner,
    y: c.y + peelDir.y * creaseToCorner,
  };

  const pageRect: Point[] = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  const peakOffset = arc * ROLL_PEAK_O;
  const tailOffset = arc * ROLL_END.o;
  const tailHeight = arc * ROLL_END.z;

  // w(q) = (creasePoint - q) . peelDir, so "w <= 0" is the half-plane with
  // normal -peelDir and "w >= k" the one with normal +peelDir through the
  // point k along -peelDir from the crease.
  const negPeel: Point = { x: -peelDir.x, y: -peelDir.y };
  const restPolygon = clipHalfPlane(pageRect, creasePoint, negPeel);

  const tailSource = clipHalfPlane(pageRect, offsetAlong(creasePoint, negPeel, arc), peelDir);
  // Tail shift: w -> tailOffset - (w - arc), i.e. alpha = -1 (the mirroring)
  // with beta = arc * (1 + ROLL_END.o).
  const tailPolygon = tailSource.map((p) =>
    shiftByW(p, creasePoint, peelDir, -1, arc * (1 + ROLL_END.o)),
  );

  const peakW = arc * ROLL_PROFILE[ROLL_PEAK_INDEX]!.s;
  const rollSource = clipHalfPlane(
    clipHalfPlane(pageRect, creasePoint, peelDir),
    offsetAlong(creasePoint, negPeel, peakW),
    negPeel,
  );
  const rollAlpha = peakW > 0.001 ? peakOffset / peakW : 1;
  const rollPolygon = rollSource.map((p) => shiftByW(p, creasePoint, peelDir, rollAlpha, 0));

  return {
    peelDir,
    creaseDir,
    creasePoint,
    creaseToCorner,
    arc,
    peakOffset,
    tailOffset,
    tailHeight,
    restPolygon,
    tailPolygon,
    rollPolygon,
  };
}

// ---------------------------------------------------------------------------
// The cone — M27, "over the spine"
// ---------------------------------------------------------------------------

/**
 * Which leaf edge is the **spine**: the edge opposite the grab.
 *
 * The gutter in spread mode, the card's other edge in single-page — one rule
 * for both, which is what lets the two modes keep one model (PAGE_CURL.md
 * §2d, answering its own older "single-page has no spine" bullet: a single
 * page is still bound, it merely has no facing leaf to land on).
 */
export function spineEdgeForAnchor(anchor: FoldAnchor): "left" | "right" {
  if (isEdgeAnchor(anchor)) return anchor.edge === "left" ? "right" : "left";
  return anchor === "topLeft" || anchor === "bottomLeft" ? "right" : "left";
}

/**
 * Synthetic pointer path for a programmatic turn of a **bound** sheet — the
 * hinge's counterpart to `syntheticFoldPointer`, which a bound sheet cannot
 * follow.
 *
 * `syntheticFoldPointer` sweeps diagonally through the opposite corner and
 * 2.2x past it, because that is what the flat model needs to cover the leaf.
 * A hinged sheet cannot go there: the anchor would have to leave the lens
 * `constrainToSpineHinge` describes long before the end, and the drag stalls
 * against the clamp with the leaf two-thirds uncovered. That overshoot is an
 * artefact of the flat crease and retires with it.
 *
 * A hinge covers the leaf a different way — by turning through the binding
 * rather than sliding past the far corner — so the path is simply **the anchor
 * to its own mirror across the spine**, which is the fully-turned position and
 * sits exactly on the lens's far tip. Every point of it is reachable, so
 * nothing is clamped, and the leaf is covered but for the spine edge itself,
 * which never lifts.
 *
 * ⚠️ **This is the plain path, not necessarily the handsome one.** A straight
 * pull square across is the far field, so a turn animated along it is the
 * cylinder from end to end and never shows the fan the cone exists for. A real
 * thumb pulls up and across, which is what puts the apex a leaf-length off the
 * end and fans the curl. Which path a click turn takes is the renderer's call
 * and a look question; this is the one with the coverage proof attached.
 */
export function syntheticHingePointer(
  anchor: FoldAnchor,
  width: number,
  height: number,
  progress: number,
): Point {
  const from = anchorPoint(anchor, width, height);
  const spineX = spineEdgeForAnchor(anchor) === "left" ? 0 : width;
  // Same floor as the flat sweep: a zero-length C->P leaves the fold direction
  // undefined, and a touch above zero keeps the first frame well-defined.
  const t = Math.max(progress, 0.001);
  return { x: from.x + 2 * (spineX - from.x) * t, y: from.y };
}

/**
 * A sheet bound at the spine and pulled by its outer corner, as a **cone**
 * with its apex on the spine line (decisions.md 2026-08-03 step 4).
 *
 * Paper is inextensible, so a deformed sheet is developable — a cylinder, a
 * cone, or a tangent developable. The spine edge cannot lift, so the lift has
 * to fall to zero along the binding, which parallel rulings cannot do; the
 * rulings must fan from a point on the spine. That is a cone, and `pageFold`'s
 * flat-crease model has no way to express one: it depends on `w`, the distance
 * from a straight crease, and *only* on `w`, which is exactly what makes every
 * band of constant `w` a straight line parallel to the crease.
 *
 * **The cone is the same roll, wrapped.** Work in polar coordinates about the
 * apex. Rulings are the rays; they are inextensible, so a point keeps its
 * radius `r` and only its *angle* changes. At radius `r` the roll's arc length
 * is `r * arcAngle` and the distance past the crease is `r * (φ - creaseAngle)`
 * — both scale with `r`, so the profile fraction, and therefore the angular
 * map, is **the same on every ruling**. That is precisely what a cone is, and
 * it is why this reuses `ROLL_PROFILE` untouched rather than needing a second
 * profile. The lift, by contrast, scales with `r`: zero at the apex, growing
 * outward, which is the physical requirement the whole ruling rests on.
 *
 * **The roll is the far-field limit.** Push the apex away along the spine and
 * the rays become parallel, the angles become proportional to distance from
 * the spine, and this collapses to the flat-crease roll — which at zero arc is
 * the 2026-07-20 bisector. Each model has been a degenerate case of its
 * successor and this one continues that.
 */
export interface ConeFold {
  /** On the spine line, and outside the leaf's own span of it — so that every
   * point of the spine edge lies on one ray from here and is therefore
   * undeformed. */
  apex: Point;
  /** Unit vector from the apex along the spine, into the leaf. Angles are
   * measured from this, so the spine edge is exactly angle 0. */
  spineDir: Point;
  /** +1 or -1: which way angles increase to reach the leaf. Lets everything
   * below be written for positive angles regardless of which edge is the
   * spine. */
  winding: number;
  /** The crease ray's angle from `spineDir`. The sheet is flat below this. */
  creaseAngle: number;
  /** The roll's angular extent past the crease. The *physical* arc at radius
   * `r` is `r * arcAngle`, so the curl is naturally tight near the spine and
   * broad at the outer edge — the thing a bound page does and a cylinder
   * cannot. */
  arcAngle: number;
  /** Distance from the apex to the grabbed anchor. The anchor rides this
   * circle: a bound sheet's corner cannot change its distance from the apex,
   * which is why the apex is solved from the drag rather than given. */
  anchorRadius: number;
}

/** Angle of `v` measured from `spineDir`, in the winding direction. Always in
 * `[0, 2π)`, and inside the leaf it is well under π. */
function coneAngle(cone: ConeFold, v: Point): number {
  const along = v.x * cone.spineDir.x + v.y * cone.spineDir.y;
  const across = (v.x * cone.spineDir.y - v.y * cone.spineDir.x) * -cone.winding;
  return Math.atan2(across, along);
}

/**
 * The cone's angular map: where a ruling at angle `creaseAngle + psi` ends up,
 * expressed as an offset from the crease. The exact analogue of the flat
 * model's `w -> o`, one dimension down.
 *
 * Identical on every ruling, which is what makes the surface a cone.
 */
function coneAngularOffset(cone: ConeFold, psi: number): number {
  const { arcAngle } = cone;
  if (psi <= 0 || arcAngle <= 0) return psi; // flat: undisturbed
  if (psi >= arcAngle) return arcAngle * ROLL_END.o - (psi - arcAngle); // the tail
  return arcAngle * rollOffsetAt(psi / arcAngle);
}

/**
 * Where a leaf point ends up on the cone, projected orthographically — the
 * cone's `deformPoint`.
 *
 * Radius is preserved (rulings are inextensible) and only the angle moves, so
 * this is a pure angular remap about the apex. Points on the spine have angle
 * 0, hence `psi = -creaseAngle < 0`, hence the flat branch and no movement at
 * all: **the spine edge is fixed by construction rather than by a clamp.**
 */
export function deformPointOnCone(cone: ConeFold, p: Point): Point {
  const v = { x: p.x - cone.apex.x, y: p.y - cone.apex.y };
  const r = Math.hypot(v.x, v.y);
  if (r < 1e-9) return { x: p.x, y: p.y };
  const phi = coneAngle(cone, v);
  const turned = cone.creaseAngle + coneAngularOffset(cone, phi - cone.creaseAngle);
  const cos = Math.cos(turned);
  const sin = Math.sin(turned) * cone.winding;
  // Rebuild the point on its (rotated) ruling, same radius.
  return {
    x: cone.apex.x + r * (cone.spineDir.x * cos - cone.spineDir.y * sin),
    y: cone.apex.y + r * (cone.spineDir.y * cos + cone.spineDir.x * sin),
  };
}

/**
 * How far off the page a leaf point is lifted, in leaf px.
 *
 * **Scales with distance from the apex**, which is the whole physical point:
 * zero along the spine, most at the outer corner. The flat model's `tailHeight`
 * is this quantity made constant, which is exactly what would tear a bound
 * sheet off its binding.
 */
export function coneLiftAt(cone: ConeFold, p: Point): number {
  const v = { x: p.x - cone.apex.x, y: p.y - cone.apex.y };
  const r = Math.hypot(v.x, v.y);
  if (r < 1e-9 || cone.arcAngle <= 0) return 0;
  const psi = coneAngle(cone, v) - cone.creaseAngle;
  if (psi <= 0) return 0;
  const arcLength = r * cone.arcAngle;
  if (psi >= cone.arcAngle) return arcLength * ROLL_END.z;
  const at = Math.max(0, Math.min(1, psi / cone.arcAngle)) * ROLL_SAMPLES;
  const i = Math.min(ROLL_SAMPLES - 1, Math.floor(at));
  const t = at - i;
  return arcLength * (ROLL_PROFILE[i]!.z + (ROLL_PROFILE[i + 1]!.z - ROLL_PROFILE[i]!.z) * t);
}

/**
 * How far down the spine the apex may run before it is simply **held** there,
 * as a multiple of the leaf's diagonal.
 *
 * A drag square out from the edge has its apex at infinity: the rulings are
 * parallel, the crease genuinely is parallel to the spine, and the surface is
 * the cylinder the flat model already ships. That case cannot be *represented*
 * with a finite apex — but it can be approximated far below anything visible,
 * and the alternative (handing the drag back to `computeFold` for the far
 * field, as this did when it was written) hands the spine back to a model that
 * lets it move, which is precisely what the hinge exists to stop. So the apex
 * is held at a distance rather than sent to another model, and
 * `computeConeFold` answers every drag.
 *
 * The multiple is measured rather than picked, and it is pinned between two
 * errors that pull opposite ways:
 *
 * - **Too near and the far field is not flat enough.** A cone at apex distance
 *   `R` sits about `1.9 * diagonal / R` px from the flat model of the same
 *   drag. Worse — because the apex runs off *either* end depending on which
 *   side of the anchor the pointer passes, a drag crossing exactly square-on
 *   swaps one held apex for the other, and the two differ by about
 *   `1.0e6 / R` px. That swap is the binding one.
 * - **Too far and the arithmetic goes.** Every leaf point is rebuilt as
 *   `apex + r * direction` with `r ~ R`, so leaf coordinates come out of a
 *   cancellation and quantise to `ulp(R)` — at `R = 1e12` that is already
 *   1e-4 px of drift on the spine edge itself.
 *
 * A million diagonals lands both at ~1e-3 px and ~1e-7 px respectively, which
 * is three decades of margin on each side. (Readings in NOTES.md.) A renderer
 * that hands the apex to a **float32** shader gets none of this: quantisation
 * there is tens of pixels. Deform in float64 and upload positions.
 */
const FAR_APEX_DIAGONALS = 1e6;

/**
 * Where the perpendicular bisector of `c -> p` crosses the spine line: the
 * only apex on the spine for which the cone can put the anchor under the
 * pointer at all (see `computeConeFold`).
 *
 * Returns `±Infinity` when the two run parallel — the apex at infinity, whose
 * *sign* still says which way down the spine it went, which is why this
 * returns an infinity rather than `null`.
 */
function bisectorApexY(c: Point, p: Point, spineX: number): number {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const midX = (c.x + p.x) / 2;
  const midY = (c.y + p.y) / 2;
  const num = (spineX - midX) * dx;
  // A drag whose midpoint lands *on* the spine with no vertical component is
  // the exact mirror position — every point of the spine is equidistant and
  // the apex is undetermined. It is a rigid half-turn about the binding, i.e.
  // the far field, so answer with the far field.
  if (dy === 0) return num === 0 ? Infinity : midY - num * Infinity;
  return midY - num / dy;
}

/**
 * The pointer as a **bound** sheet can honour it — the hinge's counterpart to
 * `constrainFoldPointer`, and the reason the spine edge can be promised at
 * *every* drag depth rather than at the depths that happen to work.
 *
 * The apex has to lie on the spine line and **outside the leaf's own span of
 * it**: an apex partway along the binding would put the two halves of the
 * spine edge on opposite rays from it, and a sheet cannot fan around a point
 * in the middle of its own binding without tearing. That constraint on the
 * apex turns out to be *exactly* a constraint on the drag, and a physical one:
 *
 *     the anchor's distance to each of the two spine corners can only shrink
 *
 * — because `apexY = 0` is precisely the locus `|P - S0| = |C - S0|`, and
 * `apexY = height` the same about `S1`. The two circles through the anchor
 * bound the legal region and the **lens** they cut out is where both distances
 * have shrunk; no pointer inside it produces an apex on the binding, for
 * corner and edge anchors alike (argued, then checked exhaustively). For a
 * corner pinch the first radius *is* the leaf's width and the second its
 * diagonal, so the rule reads: **the grabbed corner can never get further from
 * its own gutter corner than the page is wide, nor further from the other one
 * than the page is diagonal** — which is only "the bottom edge is that much
 * paper and no more". It is the clamp physical page-turn implementations have
 * always carried, arrived at from the geometry rather than from a fudge.
 *
 * A pointer outside the lens is not refused but **followed as far as the paper
 * goes**: the anchor travels along the drag's own direction and stops where
 * that ray leaves the lens. Two circles through the anchor make a convex lens
 * with the anchor on its boundary, so that exit point is unique, closed-form,
 * and moves continuously with the pointer — which the nearest-point projection
 * does *not*, because a lens is a thin sliver and the nearest point of it flips
 * end for end as a drag sweeps past. Pulling *outward*, away from the spine,
 * leaves the anchor exactly where it is: there is no more sheet to give.
 */
export function constrainToSpineHinge(
  anchor: FoldAnchor,
  pointer: Point,
  width: number,
  height: number,
): Point {
  const c = anchorPoint(anchor, width, height);
  const spineX = spineEdgeForAnchor(anchor) === "left" ? 0 : width;
  const dx = pointer.x - c.x;
  const dy = pointer.y - c.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return { x: c.x, y: c.y };

  // The anchor lies *on* both circles by construction, which collapses each
  // quadratic to a single root: |c + t*d - s|^2 <= |c - s|^2 reduces to
  // t * (2 (c-s).d + t |d|^2) <= 0, so the ray leaves that circle at
  // t = -2 (c-s).d / |d|^2 and nowhere else.
  let t = 1;
  for (const cornerY of [0, height]) {
    const ex = c.x - spineX;
    const ey = c.y - cornerY;
    t = Math.min(t, Math.max(0, (-2 * (ex * dx + ey * dy)) / len2));
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * Solve the cone for a drag: apex, crease and arc such that **the grabbed
 * anchor lands under the pointer, as far as a bound sheet can reach it**.
 *
 * ⚠️ **The apex is an output, not an input, and that is a real finding rather
 * than a shortcut.** TASKS.md describes the geometry as gaining "apex distance
 * along the spine", which reads as a free parameter. It cannot be one at the
 * same time as the anchor landing under the pointer: rulings are inextensible,
 * so the anchor keeps its distance from the apex and can only travel along
 * that circle. Fixing the apex therefore confines the anchor to one arc, and
 * an arbitrary pointer is not on it. Solving the apex instead — it is the
 * point on the spine equidistant from anchor and pointer, i.e. where their
 * perpendicular bisector crosses the spine line — satisfies both. See NOTES.md
 * "M27 — the apex cannot be both given and consistent".
 *
 * ⚠️ **And a pointer is not always reachable**, which is the second half of
 * the same finding. The solved apex is only a legal one while it stays off the
 * leaf's own span of the binding, and `constrainToSpineHinge` (above) is that
 * constraint read as a limit on the drag. Inside it the anchor lands exactly
 * under the pointer, as before; outside it the anchor lands on the pointer's
 * *bearing* about the apex and no further, which is what a bound page does.
 *
 * This always answers a drag that has moved at all — there is no far-field
 * hand-off to `computeFold` any more, because that hand-off returned the spine
 * to a model that lets it move. See `FAR_APEX_DIAGONALS`.
 */
export function computeConeFold(
  anchor: FoldAnchor,
  pointer: Point,
  width: number,
  height: number,
  arcTarget: number = curlArcLength(width, height),
): ConeFold | null {
  const c = anchorPoint(anchor, width, height);
  const reached = constrainToSpineHinge(anchor, pointer, width, height);
  const travel = Math.hypot(reached.x - c.x, reached.y - c.y);
  if (travel < 0.01) return null;

  const spineX = spineEdgeForAnchor(anchor) === "left" ? 0 : width;
  const far = FAR_APEX_DIAGONALS * Math.hypot(width, height);
  let apexY = Math.min(height + far, Math.max(-far, bisectorApexY(c, reached, spineX)));
  // The clamp above already put the apex off the binding's own span; this
  // snaps it through the rounding at the two ends, so that a pointer sitting
  // exactly on the boundary circle cannot land a hair inside and flip the fan
  // end for end.
  if (apexY > 0 && apexY < height) apexY = apexY * 2 >= height ? height : 0;
  const apex: Point = { x: spineX, y: apexY };
  const spineDir: Point = { x: 0, y: apexY <= 0 ? 1 : -1 };

  const toAnchor = { x: c.x - apex.x, y: c.y - apex.y };
  const anchorRadius = Math.hypot(toAnchor.x, toAnchor.y);
  if (anchorRadius < 1e-6) return null;
  // Winding: whichever sense puts the leaf at positive angles.
  const cross = toAnchor.x * spineDir.y - toAnchor.y * spineDir.x;
  const winding = cross >= 0 ? -1 : 1;

  const probe: ConeFold = {
    apex,
    spineDir,
    winding,
    creaseAngle: 0,
    arcAngle: 0,
    anchorRadius,
  };
  const anchorAngle = coneAngle(probe, toAnchor);
  const pointerAngle = coneAngle(probe, { x: reached.x - apex.x, y: reached.y - apex.y });
  // The angular sweep the anchor has to make. Same role as `d` in the flat
  // model, one dimension down.
  const sweep = anchorAngle - pointerAngle;
  // Not an epsilon: a held-far apex makes an honest sweep as small as it likes
  // (a 250px drag at a million diagonals sweeps 3e-7 rad), so "has this drag
  // moved" is `travel` above and this only rejects a sheet asked to peel
  // backwards — which `constrainToSpineHinge` has already turned into no drag
  // at all.
  if (!(sweep > 0)) return null;

  // The roll's angular extent, so that its *physical* arc at the anchor is the
  // same `arcTarget` the flat model uses there — and clamped by the sweep the
  // same way, so a shallow drag rolls less rather than overshooting.
  const arcAngle = Math.min(arcTarget / anchorRadius, sweep / (1 - ROLL_END.o));
  // ...and the crease, from the same algebra as `creaseToCorner`: the anchor
  // sits at `arcAngle * ROLL_END.o - (psi - arcAngle)` once it is out on the
  // tail, and must land at `anchorAngle - sweep`.
  const creaseToAnchor = (sweep + arcAngle * (1 + ROLL_END.o)) / 2;

  return {
    apex,
    spineDir,
    winding,
    // The crease cannot run past the binding: there is no more sheet to roll
    // once it reaches it, and a crease at a negative angle would put the spine
    // edge itself on the rolled side and lift it off the book. A drag that
    // asks for one has simply finished the turn, and the fold saturates there
    // rather than tearing.
    creaseAngle: Math.max(0, anchorAngle - creaseToAnchor),
    arcAngle,
    anchorRadius,
  };
}

function offsetAlong(from: Point, dir: Point, distance: number): Point {
  return { x: from.x + dir.x * distance, y: from.y + dir.y * distance };
}

/**
 * Where a single leaf point ends up once the sheet is peeled — the model
 * stated as a function, and the definition every other piece of geometry
 * here has to agree with.
 *
 * The paint routine deliberately does *not* go through this: it works in
 * whole bands, which is the entire reason a rolled sheet fits in canvas 2D
 * at 60fps. But "the grabbed corner lands exactly under the pointer" is the
 * property a drag lives or dies by, and it is stated here rather than
 * trusted to fall out of the band algebra.
 */
export function deformPoint(fold: FoldGeometry, p: Point): Point {
  const { creasePoint, peelDir, arc } = fold;
  const w = (creasePoint.x - p.x) * peelDir.x + (creasePoint.y - p.y) * peelDir.y;
  let o: number;
  if (w <= 0 || arc <= 0) {
    o = w; // flat: undisturbed
  } else if (w >= arc) {
    o = fold.tailOffset - (w - arc); // the tail, mirrored back across the crease
  } else {
    // On the roll: interpolate the normalized profile at this arc fraction.
    o = arc * rollOffsetAt(w / arc);
  }
  const shift = w - o;
  return { x: p.x + peelDir.x * shift, y: p.y + peelDir.y * shift };
}

/** Applies one band's affine (`w -> alpha*w + beta`, everything along the
 * crease untouched) to a single point. The paint routine does the same thing
 * to whole bitmaps via `enterBandFrame`; this is the version used to build
 * polygons. */
function shiftByW(p: Point, creasePoint: Point, peelDir: Point, alpha: number, beta: number): Point {
  const w = (creasePoint.x - p.x) * peelDir.x + (creasePoint.y - p.y) * peelDir.y;
  const shift = w - (alpha * w + beta);
  return { x: p.x + peelDir.x * shift, y: p.y + peelDir.y * shift };
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

export type Rgb = readonly [number, number, number];

/**
 * The rectangle of the snapshot bitmap that is *this leaf*, in the bitmap's
 * own pixels.
 *
 * The snapshot covers the whole stage, which in spread mode is **two** pages
 * (epub.js renders a spread as two columns in one iframe — M12), while the
 * fold only ever peels the near leaf. Without this the turning sheet paints
 * both pages squeezed into one leaf's width — a bug the flat fold shipped
 * with and that nothing caught, because until 2026-08-02 every snapshot the
 * fold was ever handed was blank (NOTES.md 2026-08-01 and 2026-08-02).
 */
export interface LeafSource {
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the slice is the entire bitmap — single-page mode, and the
   * case `drawLeaf` has a faster path for. */
  whole: boolean;
}

/** The near leaf's slice of a stage-wide snapshot. `leafX`/`leafWidth` are
 * CSS px within a stage `stageWidth` CSS px across (readerGeometry.ts's
 * `nearLeafRect`); the bitmap may be at any scale, so the split is done in
 * fractions rather than pixels. */
export function leafSourceRect(
  bitmapWidth: number,
  bitmapHeight: number,
  leafX: number,
  leafWidth: number,
  stageWidth: number,
): LeafSource {
  if (stageWidth <= 0 || bitmapWidth <= 0) {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, bitmapWidth),
      height: Math.max(1, bitmapHeight),
      whole: true,
    };
  }
  const x = (leafX / stageWidth) * bitmapWidth;
  const width = Math.max(1, (leafWidth / stageWidth) * bitmapWidth);
  return {
    x,
    y: 0,
    width,
    height: bitmapHeight,
    whole: x <= 0.5 && width >= bitmapWidth - 0.5,
  };
}

/**
 * One printed side of the turning sheet: a bitmap, the slice of it that is
 * this leaf, and whether that slice has to be flipped to sit in leaf-local
 * coordinates.
 *
 * **`flipX` is what makes the back the leaf's real other side** (M27,
 * decisions.md 2026-08-03 "sign-off"). A leaf is one sheet printed on both
 * faces, and the two faces do not share a coordinate frame: the spine edge
 * that is leaf-local `x = 0` on the front is `x = width` on the back, because
 * turning the leaf over swaps which side of the spread it is on. So the back
 * page's own bitmap — the post-advance card's *other* half — is registered
 * onto the sheet mirrored about the leaf's vertical centre line.
 *
 * That is a *registration* flip, and it is not the same thing as the tail's
 * `alpha = -1`. The tail mirrors about the **crease**, in the peel direction,
 * because that is what folding a sheet toward you does to it; that stays
 * exactly as it was and is why this milestone touches no geometry. This flip
 * is about the spine and would be there even for a sheet lying flat.
 */
export interface LeafFace {
  image: CanvasImageSource;
  source: LeafSource;
  /** Set on a back face, clear on a front one. See above — this is the
   * spine-side registration, never the fold's own mirroring. */
  flipX: boolean;
}

/**
 * The two sides of the turning sheet.
 *
 * `back` is **null until the post-advance capture lands**, and that is a
 * designed state rather than a failure: the capture is raced against the
 * fold instead of blocking the grab (see `usePageTurnAnimation`). With no
 * back, the fold falls back to the pre-M27 rendering — the front's own
 * bitmap, mirrored by the tail's `alpha = -1` and washed down to a
 * `SHOW_THROUGH` ghost.
 *
 * **That wash is part of faking a back, and a real one must not get it.** It
 * exists to turn the front's mirrored print into something that reads as the
 * *other* side of the sheet: knock the text down to a ghost, take the surface
 * to the page's own background colour. A real back capture already is the
 * other side of the sheet — it carries its own paper and its own print — so
 * washing it would ghost the very text this milestone went and fetched.
 */
export interface SheetFaces {
  front: LeafFace;
  back: LeafFace | null;
}

/** Light direction in the fold's own (offset, height) plane: mostly from the
 * reader, tipped a little toward the corner side so the roll's root sits in
 * shadow and its far side comes back into the light. */
const LIGHT_O = 0.28;
const LIGHT_Z = 0.96;

/** How much of the sheet's colour survives where nothing faces the light.
 * High on purpose: this is paper in a lit room, not a matte sphere in a
 * void, and a page-turn that plunges half the page into darkness reads as a
 * bug rather than as depth. */
const AMBIENT = 0.66;

/** How much of the printed page shows through the back of the sheet, when
 * the back is the front standing in for it. Real book paper is opaque enough
 * that you read the ghost, not the text. */
const SHOW_THROUGH = 0.2;

/**
 * How far a **real** back is taken toward the sheet's lit paper colour
 * (M27). Not the same quantity as `SHOW_THROUGH` despite sharing the fill:
 * that one hides text that should not be legible, this one is the lift that
 * makes the surface read as the underside of a sheet held up to the light.
 *
 * It cannot be zero, and the reason is the dark themes. `backOfSheet`'s lift
 * scales with `1 - lum`, so in `ink` it is doing most of the work of saying
 * "this is a lifted object" — drop the fill entirely and the tail becomes a
 * near-black triangle with the page's own light text on it, which reads as a
 * hole in the page rather than as paper. Judged in the harness against real
 * back-page content in all three reading themes; see NOTES.md "M27 — the
 * back, re-judged".
 */
const BACK_LIFT = 0.34;

/**
 * Cast shadow strength and softness (CSS px at dpr 1). Two shadows, thrown
 * *outward on both sides* of the lifted sheet rather than in one direction:
 * they are the gap under a sheet held off the page, which darkens all round
 * it, not a hard key light. One directional shadow would have to pick a side
 * and would leave the other edge of the flap sitting flat on the page.
 */
const TAIL_SHADOW_ALPHA = 0.34;
const TAIL_SHADOW_BLUR = 15;
const ROLL_SHADOW_ALPHA = 0.28;
const ROLL_SHADOW_BLUR = 12;

/** Normalizing constant: a sheet lying flat, front or back, gets exactly 1
 * and is therefore painted untouched. Only *curvature* shades anything, so
 * the flat page and the flat tail keep the snapshot's own colour instead of
 * picking up a uniform tint — which is what let the first pass turn a dark
 * reading theme into an indistinguishable smudge. */
const LIGHT_NORM = AMBIENT + (1 - AMBIENT) * LIGHT_Z;

/**
 * Sheen along the roll's leading edge, where the sheet turns edge-on to the
 * reader — the soft highlight a curled page catches at a grazing angle.
 *
 * On white stock this is a small gloss the curl reads better for. On a dark
 * reading theme it is doing the whole job: the diffuse term *darkens* the
 * leading edge, which is a crisp crease on paper and nothing at all on near
 * black, so the depth cue has to invert. Hence the scale by how dark the
 * page is — the darker the theme, the more of the roll is drawn in light
 * rather than in shadow.
 */
function sheenScale(paper: Rgb): number {
  const lum = (0.2126 * paper[0] + 0.7152 * paper[1] + 0.0722 * paper[2]) / 255;
  return 0.1 + 0.75 * (1 - lum);
}

function sheenAt(phi: number): number {
  return Math.pow(Math.max(0, Math.sin(phi)), 6);
}

/** Lambert term for a sheet whose tangent has turned through `phi`, seen
 * from the front (`back` false) or from behind. */
function lightAt(phi: number, back: boolean): number {
  // Front-face normal of the rolling sheet, in (offset, height): at phi 0 it
  // points straight at the reader, at PI/2 it points back toward the crease.
  const nO = -Math.sin(phi);
  const nZ = Math.cos(phi);
  const dot = back ? -(nO * LIGHT_O + nZ * LIGHT_Z) : nO * LIGHT_O + nZ * LIGHT_Z;
  return (AMBIENT + (1 - AMBIENT) * Math.max(0, dot)) / LIGHT_NORM;
}

/**
 * The colour of the back of the sheet, given the page's own paper.
 *
 * The back of a real page is the same stock as the front, so on white paper
 * it barely differs and the fold is read entirely from its shadow. On a dark
 * reading theme that fails outright: a near-black flap over a near-black
 * page, with a black shadow between them, is invisible. Paper does not go
 * darker than its own ink, so the lift scales with how dark the theme is —
 * a token 5% on white stock, most of the way to a mid grey on a dark theme,
 * where it is the only thing separating the sheet from the page under it.
 */
function backOfSheet(paper: Rgb): Rgb {
  const lum = (0.2126 * paper[0] + 0.7152 * paper[1] + 0.0722 * paper[2]) / 255;
  const lift = 0.05 + 0.38 * (1 - lum);
  return [
    Math.round(paper[0] + (255 - paper[0]) * lift),
    Math.round(paper[1] + (255 - paper[1]) * lift),
    Math.round(paper[2] + (255 - paper[2]) * lift),
  ];
}

/** A shading factor as something canvas can paint: darkening is black,
 * brightening is white, both at the matching alpha. */
function shadeColor(factor: number): string {
  return factor < 1
    ? `rgba(0, 0, 0, ${(1 - factor).toFixed(4)})`
    : `rgba(255, 255, 255, ${(factor - 1).toFixed(4)})`;
}

/** Paints one face's slice of the snapshot over the leaf's own rect. Every
 * band of the fold is this same blit under a different transform and clip —
 * the transform is what deforms the sheet, never the blit.
 *
 * A back face additionally flips about the leaf's vertical centre line; see
 * `LeafFace.flipX` for why that is a property of the sheet rather than of
 * the fold. The flip is inside the `flipX` branch rather than unconditional
 * because this is the hot call — ~25 of them a frame — and the front face
 * must not pay a save/restore for something only the back needs. */
function drawLeaf(
  ctx: CanvasRenderingContext2D,
  face: LeafFace,
  width: number,
  height: number,
): void {
  const { image, source } = face;
  if (face.flipX) {
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  if (source.whole) {
    // Measurably cheaper: the source-rect overload gives up the fast blit
    // path, and this is the hot call. Single-page mode is the whole bitmap
    // and has no reason to pay for it.
    ctx.drawImage(image, 0, 0, width, height);
  } else {
    ctx.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, width, height);
  }
  if (face.flipX) ctx.restore();
}

/** Axis-aligned bounds of one or more polygons, clamped to the leaf and
 * rounded outward. Every `source-atop` pass below fills through this rather
 * than through the whole leaf: a composite over the full canvas is millions
 * of pixels a frame for a wash that only ever lands on the curl. */
function unionBounds(
  polys: Point[][],
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (minX > maxX) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.max(0, Math.floor(minX) - 1);
  const y = Math.max(0, Math.floor(minY) - 1);
  return {
    x,
    y,
    width: Math.min(width, Math.ceil(maxX) + 1) - x,
    height: Math.min(height, Math.ceil(maxY) + 1) - y,
  };
}

/** No-op on a degenerate polygon: `bandPolygon` clips to the leaf and can
 * legitimately come back empty when a band falls entirely off it. */
function tracePolygon(ctx: CanvasRenderingContext2D, poly: Point[]): boolean {
  if (poly.length < 3) return false;
  ctx.beginPath();
  ctx.moveTo(poly[0]!.x, poly[0]!.y);
  for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]!.x, poly[i]!.y);
  ctx.closePath();
  return true;
}

/** The world-space point at projected offset `o` from the crease and `v`
 * along it. */
function foldPoint(fold: FoldGeometry, o: number, v: number): Point {
  return {
    x: fold.creasePoint.x - fold.peelDir.x * o + fold.creaseDir.x * v,
    y: fold.creasePoint.y - fold.peelDir.y * o + fold.creaseDir.y * v,
  };
}

/**
 * The strip of the leaf lying between two projected offsets, clipped to the
 * leaf itself. Used both as a clip region and as the target for the shading
 * gradients.
 *
 * The clip to the leaf is not cosmetic — it is the difference between each
 * band rasterizing its own thin sliver and rasterizing the bounding box of a
 * strip drawn long enough to cross the leaf at any angle, which for a
 * diagonal fold is most of the page. With ~20 bands a frame, that is the
 * whole per-frame budget.
 */
function bandPolygon(
  fold: FoldGeometry,
  o1: number,
  o2: number,
  width: number,
  height: number,
): Point[] {
  const reach = width + height;
  let poly: Point[] = [
    foldPoint(fold, o1, -reach),
    foldPoint(fold, o2, -reach),
    foldPoint(fold, o2, reach),
    foldPoint(fold, o1, reach),
  ];
  const edges: [Point, Point][] = [
    [{ x: 0, y: 0 }, { x: 0, y: -1 }],
    [{ x: 0, y: 0 }, { x: -1, y: 0 }],
    [{ x: width, y: height }, { x: 0, y: 1 }],
    [{ x: width, y: height }, { x: 1, y: 0 }],
  ];
  for (const [point, normal] of edges) poly = clipHalfPlane(poly, point, normal);
  return poly;
}

/**
 * Sets the transform so that drawing the leaf's bitmap at its natural
 * position paints the band whose page coordinate `w` maps to
 * `alpha * w + beta`. A negative `alpha` mirrors the band, which is what
 * makes the far half of the roll and the whole tail show the back of the
 * sheet without a separate mirrored bitmap.
 */
function enterBandFrame(
  ctx: CanvasRenderingContext2D,
  fold: FoldGeometry,
  alpha: number,
  beta: number,
): void {
  // The fold frame's first axis is -peelDir (offsets grow toward the grabbed
  // corner) and its second is creaseDir; by construction that pair is a
  // rotation, so entering it is one `rotate`.
  const theta = Math.atan2(-fold.peelDir.y, -fold.peelDir.x);
  ctx.translate(fold.creasePoint.x, fold.creasePoint.y);
  ctx.rotate(theta);
  ctx.translate(beta, 0);
  ctx.scale(Math.abs(alpha) < 1e-4 ? (alpha < 0 ? -1e-4 : 1e-4) : alpha, 1);
  ctx.rotate(-theta);
  ctx.translate(-fold.creasePoint.x, -fold.creasePoint.y);
}

/** Fills `poly`'s blurred shadow *only* — the polygon itself is traced far
 * off-canvas and dragged back into place by the shadow offset, so no solid
 * silhouette is ever painted. Offsets and blur are canvas-space (device)
 * quantities, hence the explicit `dpr`. */
function castShadow(
  ctx: CanvasRenderingContext2D,
  poly: Point[],
  dx: number,
  dy: number,
  blur: number,
  alpha: number,
  dpr: number,
): void {
  const AWAY = 1e5;
  ctx.save();
  ctx.shadowColor = `rgba(0, 0, 0, ${alpha})`;
  ctx.shadowBlur = blur * dpr;
  ctx.shadowOffsetX = (AWAY + dx) * dpr;
  ctx.shadowOffsetY = dy * dpr;
  ctx.fillStyle = "#000";
  if (tracePolygon(ctx, poly.map((p) => ({ x: p.x - AWAY, y: p.y })))) ctx.fill();
  ctx.restore();
}

/**
 * Paints one frame of the fold. `ctx` is the visible canvas and `layerCtx` a
 * scratch canvas of the same size; both are assumed to be `width` x `height`
 * CSS px at `dpr` device pixels per CSS px, with the transform reset and the
 * pixels cleared. `paper` is the departing leaf's background colour
 * (`samplePaperColor`) — the material the back of the sheet is made of, so
 * the fold works in any reading theme without knowing which one is on.
 *
 * `faces` carries the sheet's two printed sides (M27). Everything
 * front-facing — the flat rest of the leaf and the near half of the roll —
 * is drawn from `faces.front`; the two back-facing regions, the roll's far
 * half and the tail, are drawn from `faces.back`. Handing the same face in
 * twice with `flipX: false` reproduces the pre-M27 mirror exactly, which is
 * what the fold paints while the back's own capture is still in flight.
 *
 * The scratch layer exists because the back of the sheet is a *material*:
 * its paper wash and its lighting have to apply to the back-facing pixels
 * and nothing else. Compositing those with `source-atop` directly on the
 * visible canvas would wash the front-facing band of the roll too, since the
 * two overlap in projected offset by construction.
 */
export function drawPageFold(
  ctx: CanvasRenderingContext2D,
  layerCtx: CanvasRenderingContext2D,
  faces: SheetFaces,
  fold: FoldGeometry,
  width: number,
  height: number,
  dpr: number,
  paper: Rgb,
): void {
  const { front } = faces;
  // With no back yet, both sides are the front — which, washed below, is
  // exactly what the fold painted before M27.
  const backFace = faces.back ?? front;
  const washBack = faces.back === null;
  const back = backOfSheet(paper);
  const backCss = `rgb(${back[0]}, ${back[1]}, ${back[2]})`;
  const sheen = sheenScale(paper);

  ctx.save();
  ctx.scale(dpr, dpr);

  // 1. The flat remainder of the leaf, undeformed and unshaded — the text
  //    the reader is still reading, at full fidelity and one blit.
  if (fold.restPolygon.length >= 3) {
    ctx.save();
    tracePolygon(ctx, fold.restPolygon);
    ctx.clip();
    drawLeaf(ctx, front, width, height);
    ctx.restore();
  }

  // 2. The roll's shadow, thrown past its silhouette onto the page revealed
  //    beyond it, and the tail's, thrown past its far edge onto the page it
  //    floats over. Both go down before the sheet itself, so the sheet covers
  //    its own core and only the halo survives.
  const rollSlip = fold.arc * 0.12;
  const tailSlip = Math.min(fold.tailHeight * 0.5, 16);
  castShadow(
    ctx,
    fold.rollPolygon,
    -fold.peelDir.x * rollSlip,
    -fold.peelDir.y * rollSlip,
    ROLL_SHADOW_BLUR,
    ROLL_SHADOW_ALPHA,
    dpr,
  );
  castShadow(
    ctx,
    fold.tailPolygon,
    fold.peelDir.x * tailSlip,
    fold.peelDir.y * tailSlip,
    TAIL_SHADOW_BLUR,
    TAIL_SHADOW_ALPHA,
    dpr,
  );

  // 3. The near half of the roll: still the page, still the right way round,
  //    but curving away and foreshortened. The tail covers nearly all of it
  //    (see ROLL_EASE) — what survives is the slivers at the roll's ends,
  //    where the leaf runs out before the far half of the roll reaches, and
  //    without them the curl ends in a hard corner instead of tapering.
  const frontBand = bandPolygon(fold, 0, fold.peakOffset, width, height);
  if (fold.arc > 0.5 && frontBand.length >= 3) {
    ctx.save();
    tracePolygon(ctx, frontBand);
    ctx.clip();
    paintRollBand(
      ctx,
      front,
      fold,
      0,
      ROLL_PEAK_INDEX,
      bandCount(fold.peakOffset, dpr, HIDDEN_PX_PER_BAND),
      width,
      height,
    );
    // Lighting for the whole half in one gradient: the offset coordinate is
    // monotonic across it, so a ramp along -peelDir reproduces lightAt().
    const grad = ctx.createLinearGradient(
      fold.creasePoint.x,
      fold.creasePoint.y,
      foldPoint(fold, fold.peakOffset, 0).x,
      foldPoint(fold, fold.peakOffset, 0).y,
    );
    for (let i = 0; i <= ROLL_PEAK_INDEX; i++) {
      const sample = ROLL_PROFILE[i]!;
      grad.addColorStop(Math.min(1, sample.o / ROLL_PEAK_O), shadeColor(lightAt(sample.phi, false)));
    }
    const bounds = unionBounds([frontBand], width, height);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = grad;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    ctx.restore();
  }

  // 4. The back of the sheet — the far half of the roll and the tail — on
  //    its own layer, so the paper wash and its lighting land on back-facing
  //    pixels only.
  layerCtx.save();
  layerCtx.scale(dpr, dpr);

  const lipBand = bandPolygon(fold, fold.tailOffset, fold.peakOffset, width, height);
  if (fold.arc > 0.5 && lipBand.length >= 3) {
    layerCtx.save();
    tracePolygon(layerCtx, lipBand);
    layerCtx.clip();
    paintRollBand(
      layerCtx,
      backFace,
      fold,
      ROLL_PEAK_INDEX,
      ROLL_SAMPLES,
      bandCount(fold.peakOffset - fold.tailOffset, dpr, LIP_PX_PER_BAND),
      width,
      height,
    );
    layerCtx.restore();
  }
  if (fold.tailPolygon.length >= 3) {
    layerCtx.save();
    tracePolygon(layerCtx, fold.tailPolygon);
    layerCtx.clip();
    enterBandFrame(layerCtx, fold, -1, fold.arc * (1 + ROLL_END.o));
    drawLeaf(layerCtx, backFace, width, height);
    layerCtx.restore();
  }

  // Paper wash: take the back of the sheet toward the page's own lit
  // background colour, whatever the theme. Nearly all the way for a stand-in
  // back, where it also knocks the mirrored text down to a ghost; only
  // `BACK_LIFT` of the way for a real one, where the text is supposed to be
  // there and the fill is purely the lift. See `SheetFaces`.
  const backBounds = unionBounds([lipBand, fold.tailPolygon], width, height);
  layerCtx.globalCompositeOperation = "source-atop";
  const wash = washBack ? 1 - SHOW_THROUGH : BACK_LIFT;
  layerCtx.globalAlpha = wash;
  layerCtx.fillStyle = backCss;
  layerCtx.fillRect(backBounds.x, backBounds.y, backBounds.width, backBounds.height);
  layerCtx.globalAlpha = 1;

  // Lighting across the back: bright where the roll turns to face the reader
  // again, falling off along the tail as it recedes from the crease.
  const backGrad = layerCtx.createLinearGradient(
    foldPoint(fold, fold.peakOffset, 0).x,
    foldPoint(fold, fold.peakOffset, 0).y,
    foldPoint(fold, -fold.creaseToCorner, 0).x,
    foldPoint(fold, -fold.creaseToCorner, 0).y,
  );
  const backSpan = fold.peakOffset + fold.creaseToCorner;
  if (backSpan > 0.001) {
    for (let i = ROLL_PEAK_INDEX; i < ROLL_PROFILE.length; i++) {
      const sample = ROLL_PROFILE[i]!;
      const at = (fold.peakOffset - sample.o * fold.arc) / backSpan;
      backGrad.addColorStop(
        Math.min(1, Math.max(0, at)),
        shadeColor(lightAt(sample.phi, true) + sheenAt(sample.phi) * sheen),
      );
    }
    // The tail is flat and back-facing all the way out; it only loses light
    // to distance, which keeps the far edge from looking like cut paper.
    backGrad.addColorStop(1, shadeColor(lightAt(Math.PI, true) - 0.07));
  }
  layerCtx.fillStyle = backGrad;
  layerCtx.fillRect(backBounds.x, backBounds.y, backBounds.width, backBounds.height);
  layerCtx.restore();

  // Stamp the back of the sheet down — again only over the region it can
  // possibly occupy. The layer is in device pixels; `ctx` is not.
  if (backBounds.width > 0 && backBounds.height > 0) {
    ctx.drawImage(
      layerCtx.canvas,
      backBounds.x * dpr,
      backBounds.y * dpr,
      backBounds.width * dpr,
      backBounds.height * dpr,
      backBounds.x,
      backBounds.y,
      backBounds.width,
      backBounds.height,
    );
  }
  ctx.restore();
}

/**
 * The roll's projected offset at a fraction of its arc, per unit arc length.
 * Multiply by the roll's own arc to get leaf px.
 *
 * Shared by the flat-crease model and the cone (M27), and that sharing is the
 * point rather than a convenience: the cone is the same roll wrapped about an
 * apex, so if the two ever read different profiles the "the roll is the cone's
 * far-field limit" property quietly stops being true.
 */
function rollOffsetAt(fraction: number): number {
  const at = Math.max(0, Math.min(1, fraction)) * ROLL_SAMPLES;
  const i = Math.min(ROLL_SAMPLES - 1, Math.floor(at));
  const t = at - i;
  return ROLL_PROFILE[i]!.o + (ROLL_PROFILE[i + 1]!.o - ROLL_PROFILE[i]!.o) * t;
}

/** The roll profile at a fractional index — the bands are spaced by how
 * many device pixels they cover, not by the profile's own sampling. */
function profileAt(index: number): RollSample {
  const i = Math.max(0, Math.min(ROLL_SAMPLES - 1, Math.floor(index)));
  const t = Math.max(0, Math.min(1, index - i));
  const a = ROLL_PROFILE[i]!;
  const b = ROLL_PROFILE[i + 1]!;
  return {
    s: a.s + (b.s - a.s) * t,
    phi: a.phi + (b.phi - a.phi) * t,
    o: a.o + (b.o - a.o) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Draws the roll between two profile indices as a run of clipped bands, each
 * band's affine mapping its slice of page-space `w` linearly onto its slice
 * of projected offset. Clips are widened half a pixel each way so
 * consecutive bands overlap rather than leaving seams where the roll
 * compresses hardest.
 *
 * `bands` is chosen by the caller from how many device pixels the run
 * actually covers, because the two halves of the roll are not worth the same
 * money: the far half is the visible lip and wants a band every couple of
 * pixels, while the near half is overdrawn by the tail everywhere except the
 * slivers at the roll's ends, and a handful of bands there is
 * indistinguishable from forty.
 */
function paintRollBand(
  ctx: CanvasRenderingContext2D,
  face: LeafFace,
  fold: FoldGeometry,
  from: number,
  to: number,
  bands: number,
  width: number,
  height: number,
): void {
  for (let k = 0; k < bands; k++) {
    const a = profileAt(from + ((to - from) * k) / bands);
    const b = profileAt(from + ((to - from) * (k + 1)) / bands);
    const w1 = a.s * fold.arc;
    const w2 = b.s * fold.arc;
    const o1 = a.o * fold.arc;
    const o2 = b.o * fold.arc;
    if (Math.abs(w2 - w1) < 1e-6) continue;
    const alpha = (o2 - o1) / (w2 - w1);
    const beta = o1 - alpha * w1;
    const band = bandPolygon(
      fold,
      Math.min(o1, o2) - 0.5,
      Math.max(o1, o2) + 0.5,
      width,
      height,
    );
    ctx.save();
    if (!tracePolygon(ctx, band)) {
      ctx.restore();
      continue;
    }
    ctx.clip();
    enterBandFrame(ctx, fold, alpha, beta);
    drawLeaf(ctx, face, width, height);
    ctx.restore();
  }
}

/** Bands to spend on a run of the roll covering `offsetSpan` CSS px, at one
 * band per `perBand` device px. The floor keeps a tiny roll from collapsing
 * into a single flat facet; the ceiling is the profile's own resolution. */
function bandCount(offsetSpan: number, dpr: number, perBand: number): number {
  return Math.max(3, Math.min(ROLL_SAMPLES, Math.round((offsetSpan * dpr) / perBand)));
}

/**
 * Device pixels per band on the roll's visible lip, and on its overdrawn near
 * half. Both were chosen by measuring: the bands are ~4x the cost of
 * everything else in the frame put together, and tightening the lip below 8px
 * a band is not distinguishable in a side-by-side render — the lip's shading
 * is a gradient, independent of the banding, so the bands only ever quantize
 * the ghost of the page showing through the back of the sheet.
 */
const LIP_PX_PER_BAND = 8;
const HIDDEN_PX_PER_BAND = 40;

// ---------------------------------------------------------------------------
// The sheet's material
// ---------------------------------------------------------------------------

/**
 * The page's background colour, read back from the snapshot itself rather
 * than from the reading theme. The fold paints whatever bitmap it is handed
 * and has no idea which theme produced it (NOTES.md M20 flagged exactly this
 * gap after the first pass), so the back of the sheet asks the bitmap.
 *
 * Downscaling to 8x8 and taking the per-channel median is the cheap trick
 * that works here: a page of text is overwhelmingly background, so the
 * median tile *is* the background, and a running head or a highlight can't
 * drag it.
 */
export function samplePaperColor(image: CanvasImageSource, fallback: Rgb = [250, 249, 245]): Rgb {
  try {
    const probe = document.createElement("canvas");
    probe.width = 8;
    probe.height = 8;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    if (!probeCtx) return fallback;
    probeCtx.drawImage(image, 0, 0, 8, 8);
    const { data } = probeCtx.getImageData(0, 0, 8, 8);
    const channels: number[][] = [[], [], []];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 8) continue; // transparent tiles say nothing about the paper
      channels[0]!.push(data[i]!);
      channels[1]!.push(data[i + 1]!);
      channels[2]!.push(data[i + 2]!);
    }
    if (channels[0]!.length === 0) return fallback;
    const median = (xs: number[]) => {
      xs.sort((p, q) => p - q);
      return xs[Math.floor(xs.length / 2)]!;
    };
    return [median(channels[0]!), median(channels[1]!), median(channels[2]!)];
  } catch {
    // A tainted canvas would throw on getImageData. The snapshot is a
    // same-origin data URL so this should not happen, but a fold that
    // silently uses default paper beats a fold that throws mid-turn.
    return fallback;
  }
}
