/**
 * Pure geometry and targeting for the Desk's turntable (M23 §C), kept apart
 * from the R3F component so it is unit-testable without a GPU — the same split
 * as `deskDepthMath.ts` and `scene3d/bookGeometry.ts`.
 *
 * Everything here is in the seam's units: one world unit is one CSS pixel
 * (`scene3d/Scene3D.tsx`), and the turntable's footprint is the *DOM button's*
 * own rect. That is the same discipline the books follow — the object you can
 * see is the object you can hit — and it is why the drop test below takes
 * rects rather than scene coordinates: the gesture is a DOM gesture, and it
 * must give the same answer whether the 3D layer is drawing or not.
 *
 * ## Why the tonearm's angles are solved rather than chosen
 *
 * The deck is laid out in *ratios* of its rect, so it follows the button
 * whatever size a stylesheet gives it. That makes a hand-picked pair of arm
 * angles a latent bug: they are only right for the proportions they were eyed
 * at, and at any other size the stylus quietly ends up parked on the record or
 * playing off the edge of it. So the angles are derived from where the arm's
 * post actually is — "put the stylus this far from the spindle" — and the tests
 * assert *that*, in units anyone can check: parked is clear of the record,
 * playing is in its outer third.
 */

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** How far outside the platter a book still counts as landing on it, in px.
 * Generous, because a 168px-wide book dropped by its own centre is a coarse
 * instrument, and the failure mode of being too strict (the drop silently does
 * nothing) is worse than the failure mode of being too loose (a book near the
 * corner starts playing, which is one Back away). */
export const DROP_MARGIN = 26;

/**
 * Whether releasing `book` here drops it on the turntable.
 *
 * A **circle**, not the button's rectangle: the platter is what the user is
 * aiming at, and a rectangular target would accept a corner the deck visibly
 * does not occupy. The radius is the tool's inscribed circle plus `margin`,
 * measured against the book's own centre — the book, not the cursor, is the
 * thing being placed, and the cursor sits wherever the book happened to be
 * grabbed.
 */
export function isOverPlatter(book: RectLike, tool: RectLike, margin = DROP_MARGIN): boolean {
  const dx = book.left + book.width / 2 - (tool.left + tool.width / 2);
  const dy = book.top + book.height / 2 - (tool.top + tool.height / 2);
  const radius = Math.min(tool.width, tool.height) / 2 + margin;
  return dx * dx + dy * dy <= radius * radius;
}

/** A record's own speed. The platter turns at the rate the thing it stands in
 * for turns at, rather than at whatever looked good. */
export const PLATTER_RPM = 100 / 3;

/** Radians per second at `rpm`. */
export function angularVelocity(rpm: number): number {
  return (rpm * 2 * Math.PI) / 60;
}

/**
 * The platter's speed one frame later, running up toward `target` or coasting
 * down to a stop. Exponential, like `MathUtils.damp` — a platter with mass
 * neither starts nor stops instantly, and the run-up is most of what makes the
 * deck read as a machine rather than as a spinning texture.
 *
 * ⚠️ `delta` is clamped by the caller (a backgrounded tab resumes with a delta
 * of whole seconds); this only promises monotonic approach.
 */
export function spinUp(current: number, target: number, delta: number, lambda = 2.4): number {
  return target + (current - target) * Math.exp(-lambda * Math.max(0, delta));
}

// ---------------------------------------------------------------- the layout

/** Cabinet height, in px. Tall enough that the top-down camera sees its sides
 * in the desk's corner (where the tool lives, so where the splay is largest),
 * low enough that it never competes with a book for foreground. */
export const PLINTH_HEIGHT = 13;
/** The record's radius, against the tool's shorter side. */
const PLATTER_RADIUS_RATIO = 0.34;
/** The platter sits left of centre and the arm to its right — the layout of
 * every deck ever built, and what makes this read as one from above rather
 * than as a disc on a slab. Set back from the front edge as well, to leave the
 * cabinet a clear front panel: that strip is where the control's own text
 * label sits, and the label is DOM painted over the canvas, so a record that
 * reached it would have the words lying across the grooves. */
const PLATTER_X_RATIO = -0.13;
const PLATTER_Z_RATIO = -0.06;
/** Clearance between the record's edge and the arm's post. */
const POST_CLEARANCE = 12;
/** How far behind the platter's centre the post sits, against the radius. */
const POST_BACK_RATIO = 0.62;
/** The arm, against the radius: long enough to reach past the spindle. */
const ARM_LENGTH_RATIO = 1.05;
/** Where the stylus parks and where it plays, against the radius. Parked is
 * outside the record on purpose — an arm resting *on* a stopped record is the
 * one thing every owner of one is trained not to do. */
const PARKED_RADIUS_RATIO = 1.3;
const PLAYING_RADIUS_RATIO = 0.86;
/** The innermost the groove creep is allowed to track to. */
const RUNOUT_RADIUS_RATIO = 0.6;

export interface TurntableLayout {
  /** Centre of the record, relative to the tool rect's own centre. */
  platterX: number;
  platterZ: number;
  platterRadius: number;
  /** The tonearm's pivot, in the same frame. */
  postX: number;
  postZ: number;
  armLength: number;
  parkedAngle: number;
  playingAngle: number;
  runoutAngle: number;
}

/**
 * The whole deck, sized from the tool's rect. Every consumer reads this rather
 * than re-deriving proportions, so the drawn object and anything reasoning
 * about it (the tests, a future drop cue) cannot disagree.
 */
export function turntableLayout(width: number, height: number): TurntableLayout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const platterRadius = Math.min(w, h) * PLATTER_RADIUS_RATIO;
  const platterX = w * PLATTER_X_RATIO;
  const platterZ = h * PLATTER_Z_RATIO;
  const postX = platterX + platterRadius + POST_CLEARANCE;
  const postZ = platterZ - platterRadius * POST_BACK_RATIO;
  const armLength = platterRadius * ARM_LENGTH_RATIO;
  const base = { platterX, platterZ, platterRadius, postX, postZ, armLength };
  return {
    ...base,
    parkedAngle: angleForStylusRadius(base, platterRadius * PARKED_RADIUS_RATIO),
    playingAngle: angleForStylusRadius(base, platterRadius * PLAYING_RADIUS_RATIO),
    runoutAngle: angleForStylusRadius(base, platterRadius * RUNOUT_RADIUS_RATIO),
  };
}

type ArmGeometry = Pick<
  TurntableLayout,
  "platterX" | "platterZ" | "platterRadius" | "postX" | "postZ" | "armLength"
>;

/**
 * Where the stylus lands when the arm is rotated `angle` radians about the
 * deck's vertical.
 *
 * The arm is modelled pointing along **−x** at angle 0, and three.js's
 * `rotation.y` maps a local `(x, z)` to `(x·cos + z·sin, −x·sin + z·cos)` —
 * so the arm's direction is `(−cos, sin)`. Written here rather than in the
 * component because the solver below is the inverse of exactly this, and the
 * two have to be the same function or the arm points somewhere the tests say
 * it doesn't.
 */
export function stylusPosition(layout: ArmGeometry, angle: number): { x: number; z: number } {
  return {
    x: layout.postX - layout.armLength * Math.cos(angle),
    z: layout.postZ + layout.armLength * Math.sin(angle),
  };
}

/** How far the stylus is from the spindle at `angle` — the number a record
 * owner actually thinks in ("it's in the outer groove", "it's parked"). */
export function stylusRadius(layout: ArmGeometry, angle: number): number {
  const { x, z } = stylusPosition(layout, angle);
  return Math.hypot(x - layout.platterX, z - layout.platterZ);
}

/**
 * The arm angle that puts the stylus `target` from the spindle.
 *
 * With `p` the post relative to the platter's centre and `L` the arm,
 * `|p + L·d(θ)|² = target²` expands to `−p.x·cos θ + p.z·sin θ = k`, one
 * linear combination of a sine and a cosine, so `θ = φ ± acos(k/R)` for
 * `R = |p|`, `φ = atan2(p.z, −p.x)`.
 *
 * Of the two roots we always take `φ − acos(…)`: the pair are mirror images
 * about the arm's closest approach to the spindle, and that branch is the one
 * that keeps the arm on its own side of the deck. The other sweeps it *across*
 * the record from behind, which reaches the same radius while looking like a
 * broken machine. Taking the same branch every time is also what makes park →
 * play → run-out a single monotonic sweep rather than a jump between sides.
 */
export function angleForStylusRadius(layout: ArmGeometry, target: number): number {
  const px = layout.postX - layout.platterX;
  const pz = layout.postZ - layout.platterZ;
  const reach = Math.hypot(px, pz);
  if (reach === 0 || layout.armLength === 0) return 0;
  const k = (target * target - reach * reach - layout.armLength * layout.armLength) / (2 * layout.armLength);
  // Clamped: a target the arm simply cannot reach (shorter than |reach − L| or
  // longer than reach + L) has no solution, and the nearest reachable angle is
  // a better answer than a NaN rotation that blanks the whole scene.
  const cos = Math.min(1, Math.max(-1, k / reach));
  const phi = Math.atan2(pz, -px);
  return wrapAngle(phi - Math.acos(cos));
}

/** Into (−π, π], so the component never spins the arm the long way round. */
function wrapAngle(angle: number): number {
  const wrapped = ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return wrapped;
}

/**
 * Where the arm sits for a given `engagement` (0 = parked, 1 = playing), plus
 * the slow inward creep of tracking a groove. The creep is deliberately small
 * and capped well short of the run-out: it is the difference between an arm
 * that is *playing* a record and an arm that is merely pointing at one, and a
 * deck that visibly reaches the end of a side while a book is still being read
 * would be telling the truth about nothing.
 */
export function tonearmAngle(layout: TurntableLayout, engagement: number, elapsedSeconds: number): number {
  const settled = Math.min(1, Math.max(0, engagement));
  const swept = layout.parkedAngle + (layout.playingAngle - layout.parkedAngle) * settled;
  const creepSpan = layout.runoutAngle - layout.playingAngle;
  const creep = creepSpan * settled * Math.min(1, Math.max(0, elapsedSeconds) / 900);
  return swept + creep;
}
