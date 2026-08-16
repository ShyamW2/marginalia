import { bookParts, openSpread } from "../scene3d/bookGeometry.js";
import type { OpeningPose, OpeningSurface } from "../scene3d/openingPose.js";

/**
 * Pure geometry and timing for the opening (M23 §E), kept apart from the R3F
 * component so it is unit-testable without a GPU — the same split as
 * `desk/deskDepthMath.ts` and `desk/shelfLayout.ts`.
 *
 * ## Why the camera never moves
 *
 * The book you clicked is the book that opens: one object, continuously, from
 * the surface it was lying on to the reading pane. The cheapest way to break
 * that is to hand the sequence a camera of its own — the book would then jump
 * on the first frame, and no amount of easing afterwards puts it back.
 *
 * So the opening **borrows the source surface's camera unchanged**
 * (`deskCameraFrame` or `shelfCameraFrame`, both pure functions of the viewport,
 * so reproducing the exact camera the user was just looking through costs
 * nothing) and moves only the book. That turns out to cost nothing at the other
 * end either, because both cameras are the same construction: each has a plane
 * that maps to the viewport **1:1**, and a cover facing the camera lies in that
 * plane. The Desk's is `y = 0` seen from above, the shelf's is `z = 0` seen from
 * the front — different planes, identical arithmetic.
 *
 * This module therefore works entirely in **stage px**: x right, y *down*
 * (DOM's direction), z toward the camera off the 1:1 plane. `BookOpening3D.tsx`
 * converts to world coordinates exactly once, by rotating the whole frame onto
 * the Desk's plane or leaving it on the shelf's, and negating y. Everything
 * below is the same arithmetic for both entry points, which is what TASKS.md
 * means by "the shelf and desk openings share the open/land phases in code, not
 * by copy".
 *
 * ## The anchor, and why the recentring is its own term
 *
 * The book's pose is anchored on the centre of its **closed** bounding box —
 * the thing that is continuous with where it sat on the desk or the shelf. But
 * an open spread is centred on its *crease*, which is at the hinge, a half-cover
 * to the left. `recentre` is that difference, applied as a separate translation
 * once the cover is meaningfully open.
 *
 * ⚠️ Keeping it separate is deliberate and is decisions.md 2026-08-12 ruling 7:
 * the hinge must not slide **within the book's own coordinates** (M22.5 §F's
 * ≤2px criterion, rescoped rather than dropped), while the scene recentring it
 * *on screen* is a second, explicit term. A moving spine on screen is not a
 * regression here; a moving spine in book coordinates still is.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Travel, open and recentre, off the Desk. 380ms in the first cut, 760ms after
 * M23 §E's "the whole sequence slows down", and 1900ms after the first operator
 * review of 2026-08-14: at 760ms the travel was a flick and the cover snapped,
 * and neither is a thing you can *watch*.
 *
 * 1650ms after the *second* review that day — "can speed up the animation of
 * book travelling to centre of screen (maybe 20-30% faster)". The 250ms comes
 * off the **approach alone**: `DESK_PHASES`' travel/turn/roll are scaled by
 * 0.75 and the open and recentre are shifted earlier by exactly what that saves,
 * keeping their own durations to the millisecond. The open was never the part
 * that felt slow, and shortening the clock without re-cutting the phases would
 * have shortened it too.
 *
 * Lengthening is explicitly permitted (decisions.md 2026-08-12 ruling 8)
 * because the overlay is `pointer-events: none` throughout, so DESIGN.md's
 * ~400ms bound — which governs *input blocking* — is not in play. What used to
 * make a long sequence expensive was the reader arriving underneath it; since
 * the opening now **holds the room it left** (`Scene3D.tsx`'s
 * `useScene3DHold`), the time is spent on the desk you clicked from rather
 * than over a room you have not reached yet.
 */
export const DESK_SEQUENCE_MS = 1650;
/**
 * The shelf's clock. Longer than the Desk's by exactly the pull-out and the
 * turn that precede it: a book on the shelf has to come out of the row and
 * show its cover before it can do anything the Desk's book does, and those two
 * moves were running in ~100ms of a shared travel — "almost instantaneous", and
 * the whole reason the shelf's opening read as a jump.
 *
 * ⚠️ Everything from the cover facing the camera onward is the **Desk's own
 * sequence, unscaled** — `SHELF_PHASES` is `DESK_PHASES` mapped into the tail
 * of this longer clock (see the table there). "One opening, two approaches"
 * means the approach differs and nothing after it does.
 */
export const SHELF_SEQUENCE_MS = 2250;
/** How long the sequence runs, for a book coming off this surface. */
export function openSequenceMs(surface: OpeningSurface): number {
  return surface === "shelf" ? SHELF_SEQUENCE_MS : DESK_SEQUENCE_MS;
}
/**
 * The spread's move onto the reading pane, after the `contentReady` hold.
 * 340ms until the same review: this is the beat where a book stops being an
 * object and becomes the page you read, and at 340ms it was over before the
 * eye had followed it.
 */
export const LANDING_MS = 850;

/**
 * The handoff: the last beat, in which the book *becomes* the room.
 *
 * ⚠️ **It starts after the landing, not with it** (2026-08-14). The reader room
 * used to be revealed on the landing's first frame and faded up across its whole
 * 850ms, which meant the room arrived while the book was still a small object
 * mid-flight — the operator's screenshot of a fully-drawn reader with a
 * postage-stamp book floating over its middle: "the reading pane opens
 * prematurely (before the book zooms into the reading pane)".
 *
 * So the order is now strictly: the spread lands on the pane, *then* the two
 * pictures of that same page cross over. By the time this runs, the printed
 * spread and the live pane are the same rect (`landingStep`) showing the same
 * bitmap (`pageSnapshot`), so what actually crossfades is only what genuinely
 * differs — the desk and the room behind them, and the book's own boards and
 * shadow around the edge. That is what makes it "almost subtle" rather than a
 * dissolve between two different things.
 */
export const HANDOFF_MS = 380;

/**
 * How much of the landing's own settle the handoff overlaps. Small and
 * deliberate: the landing's tail is sub-pixel easing, and waiting for it to
 * *finish* before starting the crossfade leaves a visible dead beat where
 * nothing at all is happening.
 */
export const HANDOFF_LEAD_MS = 90;

/** When the handoff starts, measured from the first frame of the landing. */
export const HANDOFF_DELAY_MS = LANDING_MS - HANDOFF_LEAD_MS;

/**
 * How long the room the book came from takes to leave, measured from the first
 * frame of the landing (`Scene3D.tsx`'s `useScene3DLayerFade`).
 *
 * ⚠️ **The room leaves during the zoom, not at the end of it** (2026-08-14, the
 * operator's second review): the desk was held at full opacity for the whole
 * landing and then removed with the canvas at the handoff, so the last thing
 * before the reader was a fully-drawn desk behind an almost-open reading pane —
 * "it looks weird ... then it awkwardly disappears as we reach reader view", off
 * the shelf as well as the desk. Holding the room is still right (it is the room
 * the book is *leaving*); holding it undimmed to the last frame is not.
 *
 * ⚠️ **Exactly the landing, on the landing's own curve** — and the first attempt
 * at this got both halves wrong (the operator's fourth review, same day: "we've
 * now lost the zoom"). It ran for `HANDOFF_DELAY_MS` on a cubic *ease-out*,
 * which puts the room at a third of its opacity 230ms in and effectively gone by
 * 470ms of an 850ms landing — so the half of the zoom where the spread actually
 * gets big had nothing left behind it, and a cream spread growing on a cream
 * page is not a zoom anybody can see. The room is the thing that gives the
 * growth a scale to be read against, so it has to still be *going* while the
 * growth is happening, not already gone.
 *
 * ⚠️ **Neither the whole landing, though — the operator cut the window on
 * 2026-08-16**: "have it start to fade when the book opened, and has zoomed 10%
 * of the way, and the fade completed by 60% of the way in. So it looks smooth."
 * The room ran the landing's full 850ms, which put its last visible frames under
 * the moment the spread is arriving on the pane; the ask is for the desk to be
 * *gone* by then, so the final 40% of the growth happens over nothing but the
 * reader's own paper. Both numbers are fractions of `LANDING_MS`, so the two
 * clocks cannot drift apart if the landing is retimed again.
 *
 * The curve stays the cubic ease-in-out `FadingLayer` and `LANDING_EASE` both
 * use, which is what makes "the background fades out whilst the pages zoom in"
 * one gesture rather than two that happen to overlap.
 */
export const ROOM_FADE_MS = LANDING_MS * 0.5;

/** How long the room holds at full opacity once the landing starts. The spread
 * gets the first tenth of its growth against the room it is leaving — a zoom
 * needs something to be read against, and a desk that starts dissolving on the
 * same frame the book starts moving gives it nothing. See `ROOM_FADE_MS`. */
export const ROOM_FADE_DELAY_MS = LANDING_MS * 0.1;

/**
 * The landing's own easing, shared with the room fade above.
 *
 * ⚠️ **Cubic ease-in-out, because the growth has to be *in* the beat.** This was
 * `[0.32, 0, 0.2, 1]` — a standard UI decelerate, which is ~85% of the way to
 * full size in the first third and spends the remaining ~550ms on sub-pixel
 * settle. That is the right curve for a panel arriving and the wrong one for a
 * zoom you are meant to watch: it front-loads the motion into the same window
 * the room is leaving in, and then holds still for half a second. Here the
 * middle of the beat is where the spread is actually growing.
 */
export const LANDING_EASE: [number, number, number, number] = [0.65, 0, 0.35, 1];

/** How far the book floats toward the camera once it reaches centre — off the
 * desk, or out into the room. Perspective magnifies it slightly, which is the
 * point: the book comes *to* you. It returns to the 1:1 plane during the
 * landing, where exactness starts to matter. */
const FLOAT_Z = 80;
/** The shelf's pull: the book leaves the row toward the viewer before it turns,
 * so the turn happens in clear air rather than through its neighbours. */
const SHELF_PULL_Z = 150;
/** The desk's arc: the travel bows up off the surface rather than skating
 * across it. */
const DESK_ARC_Z = 150;

interface Range {
  from: number;
  to: number;
}

interface Phases {
  /** The shelf's move out of the row, before it goes anywhere else. A no-op on
   * the Desk, where the pull distance is zero (there is nothing to come out
   * of), so the range there is only kept non-degenerate. */
  pull: Range;
  travel: Range;
  roll: Range;
  turn: Range;
  open: Range;
  recentre: Range;
}

// One normalized clock per surface, with overlapping ranges rather than
// sequential phases — the book turns while it is still travelling and starts
// opening before it has quite arrived, which is what makes a two-second move
// read as one gesture instead of four.
//
// ⚠️ These are **fractions of that surface's own duration**, and the two
// durations differ (see `SHELF_SEQUENCE_MS`). Read them in ms before comparing
// them to each other.
//
//   travel  0 →  741ms   the book bows up off the desk and crosses to centre
//   turn  143 →  656ms
//   open  550 → 1386ms   836ms — the same open as before the speed-up
//   recentre 741 → 1538ms
const DESK_PHASES: Phases = {
  pull: { from: 0, to: 0.259 },
  travel: { from: 0, to: 0.449 },
  roll: { from: 0, to: 0.294 },
  turn: { from: 0.087, to: 0.397 },
  open: { from: 0.333, to: 0.84 },
  recentre: { from: 0.449, to: 0.932 },
};

// The shelf's approach — out of the row, then round to face you — followed by
// the Desk's sequence verbatim. The tail is `DESK_PHASES` mapped through
// `0.2667 + r × 0.7333`, which is what makes 0.2667 → 1 of this clock exactly
// the 1650ms the Desk's whole clock is: 600ms of approach, then the same open.
// The approach kept its own milliseconds through the 2026-08-14 speed-up — it
// was already the part the operator had asked to be able to *track* — so only
// the mapped tail moved.
//
//   pull    0 →  475ms   the spine leaves the row, straight toward the viewer
//   turn  300 →  875ms   and turns in clear air, well past the neighbours
//   travel  600 → 1341ms   the cover, now facing you, crosses to the centre
//   open   1150 → 1986ms
//
// The pull and the turn overlap on purpose (the book starts round before it
// has quite finished coming out) and each is *itself* past the 400ms the
// operator asked to be able to *track*, where the previous build ran them in
// roughly a tenth of that as a side effect of one bezier control point.
const SHELF_PHASES: Phases = {
  pull: { from: 0, to: 0.211 },
  turn: { from: 0.133, to: 0.389 },
  travel: { from: 0.267, to: 0.596 },
  roll: { from: 0, to: 0.3 },
  open: { from: 0.511, to: 0.883 },
  recentre: { from: 0.596, to: 0.949 },
};

function phasesFor(surface: OpeningSurface): Phases {
  return surface === "shelf" ? SHELF_PHASES : DESK_PHASES;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Where `t` sits within `range`, clamped to its ends. */
export function segment(t: number, range: Range): number {
  if (range.to <= range.from) return t >= range.to ? 1 : 0;
  return clamp01((t - range.from) / (range.to - range.from));
}

/** Cubic ease-in-out. Every term below uses the same one, so overlapping ranges
 * accelerate and settle together rather than beating against each other. */
export function easeInOut(t: number): number {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function quadBezier(p0: Vec3, control: Vec3, p1: Vec3, t: number): Vec3 {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  return {
    x: a * p0.x + b * control.x + c * p1.x,
    y: a * p0.y + b * control.y + c * p1.y,
    z: a * p0.z + b * control.z + c * p1.z,
  };
}

export interface OpeningStep {
  /** The closed bounding box's centre, in stage px. */
  position: Vec3;
  scale: Vec3;
  /** Radians about the stage vertical. */
  yaw: number;
  /** Radians about the camera axis. */
  roll: number;
  /** 0 = closed, 1 = the front board flat open at 180°. */
  openProgress: number;
  /** The crease-vs-bbox offset, in the book's own units — see this module's
   * header for why it is a separate term. */
  recentre: number;
}

/** How far the scene must slide, in the book's own units, to put the crease
 * where the closed book's centre was. */
export function recentreDistance(pose: OpeningPose): number {
  return pose.width / 2 - bookParts(pose.width, pose.height, pose.thickness).bulge;
}

/**
 * The book's pose at time `t ∈ [0,1]` through the travel/open/recentre
 * sequence. `t = 0` reproduces `pose` exactly — that identity is the whole of
 * object permanence, and is asserted in this module's tests rather than
 * trusted.
 */
export function openingStep(t: number, pose: OpeningPose, viewport: { width: number; height: number }): OpeningStep {
  const phases = phasesFor(pose.surface);
  const start: Vec3 = { x: pose.centerX, y: pose.centerY, z: pose.centerZ };
  const end: Vec3 = { x: viewport.width / 2, y: viewport.height / 2, z: FLOAT_Z };

  // ⚠️ **The shelf's pull-out is its own phase, not a control point.** It used
  // to be one — the travel bezier simply bowed toward the viewer — and that is
  // why "the book comes out of the shelf and turns" was over in about a tenth
  // of a second: a control point is not a *duration*, so the move out of the
  // row was whatever fraction of the travel the curve happened to spend near
  // its start. Pulling first and travelling second gives that move a clock of
  // its own (`SHELF_PHASES.pull`), and the travel then starts from wherever the
  // pull has got to, which is what keeps the two continuous at every t.
  const pulled: Vec3 =
    pose.surface === "shelf" ? { x: start.x, y: start.y, z: SHELF_PULL_Z } : start;
  const origin = lerpVec(start, pulled, easeInOut(segment(t, phases.pull)));

  // Out in front all the way across on the shelf, so the book never dives back
  // through the row it just left. The Desk's bows *up* over the midpoint
  // instead: there is nothing to come out of, and a flat slide across the
  // surface reads as a panel moving rather than an object being picked up.
  const control: Vec3 =
    pose.surface === "shelf"
      ? { x: (origin.x + end.x) / 2, y: (origin.y + end.y) / 2, z: SHELF_PULL_Z }
      : {
          x: (origin.x + end.x) / 2,
          y: (origin.y + end.y) / 2,
          z: Math.max(origin.z, end.z) + DESK_ARC_Z,
        };

  return {
    position: quadBezier(origin, control, end, easeInOut(segment(t, phases.travel))),
    scale: { x: 1, y: 1, z: 1 },
    yaw: lerp(pose.yaw, 0, easeInOut(segment(t, phases.turn))),
    roll: lerp(pose.roll, 0, easeInOut(segment(t, phases.roll))),
    openProgress: easeInOut(segment(t, phases.open)),
    recentre: recentreDistance(pose) * easeInOut(segment(t, phases.recentre)),
  };
}

/**
 * How much of the spread's aspect mismatch with the reading pane is taken out
 * while the book is held open, and the floor on what that may do to the book.
 *
 * ⚠️ **A screen is not a book, and printing one on the other stretches type.**
 * A spread is a shade wider than it is tall (two 2:3 boards → about 1.33); a
 * reading pane is far wider than that (measured 1.94 on a 1440px window). Laying
 * the pane's picture across the spread therefore stretches it vertically by the
 * ratio of the two — half again, at those numbers — and the operator saw it:
 * "it already looks slightly vertically stretched, maybe we can reduce the
 * vertical stretch a tad" (2026-08-16).
 *
 * It cannot be fixed in the texture. Cropping to the right aspect would have to
 * cut the *sides* off each page, and a landing that ends on a cropped picture
 * breaks the one property the final crossfade rests on — that the spread and the
 * pane are the same picture. So the correction is geometric: the open book
 * flattens **toward** the pane's proportions, which is also the thing it is
 * about to become.
 *
 * Partial, and floored, on purpose. A full correction (`1`) would square the
 * book off into a letterbox before it had gone anywhere, which is a different
 * object rather than a slightly relieved one; `0.5` with a floor of `0.82`
 * takes out about a fifth of the stretch at the measured aspects and leaves the
 * book recognisably a book. "A tad" is the whole brief.
 */
export const SPREAD_FLATTEN = 0.5;
export const SPREAD_FLATTEN_FLOOR = 0.82;

/**
 * The spread's own aspect (width ÷ height) when the front board lies flat.
 * Board-sized, not rect-sized — see `openSpread`.
 */
export function spreadAspect(pose: OpeningPose): number {
  const spread = openSpread(pose.width, pose.height, pose.thickness);
  return spread.height > 0 ? spread.width / spread.height : 1;
}

/**
 * `step`, shortened toward the proportions of a pane of aspect `paneAspect`, `t`
 * of the way (0 = untouched, 1 = the full `SPREAD_FLATTEN`). Height only: making
 * the book *wider* would take the spread off the sides of a narrow window, and
 * shortening it walks toward the same aspect from the safe direction.
 *
 * A pane narrower than the spread returns `step` unchanged — there is no stretch
 * to relieve, and stretching the book *taller* to meet it is not what was asked.
 */
export function flattenTowardPane(
  step: OpeningStep,
  pose: OpeningPose,
  paneAspect: number | null,
  t: number,
): OpeningStep {
  if (!paneAspect || paneAspect <= 0) return step;
  const full = spreadAspect(pose) / paneAspect;
  if (full >= 1) return step;
  const target = Math.max(SPREAD_FLATTEN_FLOOR, 1 + SPREAD_FLATTEN * (full - 1));
  const factor = lerp(1, target, easeInOut(clamp01(t)));
  return { ...step, scale: { ...step.scale, y: step.scale.y * factor } };
}

/**
 * The pose that puts the open spread exactly on `stage` — the live reading
 * pane's rect.
 *
 * Exact, not approximate, because the spread ends on the camera's 1:1 plane:
 * the group's z is set so the *paper* (not the book's mid-plane) lands at
 * z = 0, where a stage pixel is a world unit and perspective magnification is
 * 1.000. Skipping that correction leaves the paper ~10 scaled px proud of the
 * plane, which at these camera distances is a few percent of magnification and
 * tens of px of overshoot on a wide pane — the difference between "matches the
 * reading pane within a few px" and "close enough to eyeball".
 */
export function landingStep(pose: OpeningPose, stage: Rect): OpeningStep {
  const spread = openSpread(pose.width, pose.height, pose.thickness);
  const scaleX = spread.width > 0 ? stage.width / spread.width : 1;
  const scaleY = spread.height > 0 ? stage.height / spread.height : 1;
  // Depth follows the horizontal scale: the spread is flat by now, so the only
  // thing z-scale changes is how thick the board's own edge reads.
  const scaleZ = scaleX;
  return {
    position: {
      x: stage.x + stage.width / 2,
      y: stage.y + stage.height / 2,
      z: -spread.paperZ * scaleZ,
    },
    scale: { x: scaleX, y: scaleY, z: scaleZ },
    yaw: 0,
    roll: 0,
    openProgress: 1,
    recentre: recentreDistance(pose),
  };
}

/** Position and scale only: by the time the landing runs, rotation is zero, the
 * cover is flat and the recentring is complete in both endpoints, so lerping
 * them would be lerping a value against itself. */
export function lerpToLanding(from: OpeningStep, to: OpeningStep, t: number): OpeningStep {
  const u = easeInOut(t);
  return {
    ...to,
    position: {
      x: lerp(from.position.x, to.position.x, u),
      y: lerp(from.position.y, to.position.y, u),
      z: lerp(from.position.z, to.position.z, u),
    },
    scale: {
      x: lerp(from.scale.x, to.scale.x, u),
      y: lerp(from.scale.y, to.scale.y, u),
      z: lerp(from.scale.z, to.scale.z, u),
    },
  };
}

/**
 * Where the open spread's paper actually is on screen, in stage px, for a given
 * step. Not used by the scene: it is how "the spread is twice the cover's width
 * and its crease is the hinge" and "the final rect matches the reader pane" get
 * *measured* in tests rather than asserted in a comment (TASKS.md M23 §E:
 * "measured, not eyeballed").
 *
 * Only meaningful once `openProgress` is 1; a half-open cover is not a rect.
 */
export function spreadRect(step: OpeningStep, pose: OpeningPose): Rect {
  const spread = openSpread(pose.width, pose.height, pose.thickness);
  // The scene graph is: pose group (position, rotation, scale) → book group
  // offset by `recentre - width/2` → the book in its own coordinates.
  const offset = step.recentre - pose.width / 2;
  const left = step.position.x + step.scale.x * (spread.left + offset);
  const right = step.position.x + step.scale.x * (spread.right + offset);
  // The book's own +y is up, and stage y runs down, so the book's head is the
  // rect's top.
  const top = step.position.y - step.scale.y * (spread.height / 2);
  return { x: left, y: top, width: right - left, height: step.scale.y * spread.height };
}

/** Where the crease lands on screen, in stage px. */
export function creaseX(step: OpeningStep, pose: OpeningPose): number {
  const spread = openSpread(pose.width, pose.height, pose.thickness);
  return step.position.x + step.scale.x * (spread.creaseX + step.recentre - pose.width / 2);
}
