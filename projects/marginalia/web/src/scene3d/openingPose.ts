/**
 * M23 §E: what the reader needs to know about the book that was just clicked,
 * so the opening can *continue* that object rather than start a new one.
 *
 * `controls/overlayOrigin.ts` already bridges a click-time rect to an overlay
 * that mounts later through routing, and this is the same bridge with a
 * bigger payload — a rect is enough to fly a flat panel from, and not enough
 * to keep a 3D object permanent. The two are set together and read together;
 * a pose without an origin (or the reverse) just means the surface that
 * navigated wasn't a 3D one, and the opening falls back to its 2D
 * presentation.
 *
 * ## The coordinates
 *
 * Everything here is in **stage px** — the surface's own 1:1 plane, in
 * viewport pixels: `x` right, `y` **down** (DOM's direction, not the world's),
 * `z` toward the camera off that plane. That is the one form both source
 * surfaces can state a pose in without either of them knowing which camera the
 * opening will use: the Desk's 1:1 plane is `y = 0` seen from above and the
 * shelf's is `z = 0` seen from the front, and `reader/openingGeometry.ts`
 * converts once, at the end, for whichever it is (settled decision 14a —
 * consumers share the units and bring their own camera).
 *
 * Deliberately free of three.js types: this is written by `desk/BookObject.tsx`
 * and `desk/ShelfView.tsx`, which are DOM components.
 */

export type OpeningSurface = "desk" | "shelf";

export interface OpeningPose {
  /** Which surface the book was on — chooses the opening's camera, and
   * whether there is a pull-out-of-the-shelf move before the travel. */
  surface: OpeningSurface;
  /** `Book3D`'s own three dimensions, as that surface draws them. The shelf
   * draws a book fatter and taller than the Desk does; the opening keeps
   * whichever it was handed and resizes with a group scale, never by
   * re-authoring the asset (which would repaint its spine texture per frame). */
  width: number;
  height: number;
  thickness: number;
  /** The centre of the book's closed bounding box, in stage px. */
  centerX: number;
  centerY: number;
  centerZ: number;
  /** Radians about the stage's vertical axis. 0 = cover toward the camera
   * (the Desk); π/2 = spine toward the camera (the shelf). */
  yaw: number;
  /** Radians about the camera axis — the Desk's CSS `rotate()`, negated
   * (a CSS rotation is clockwise on screen; a positive rotation about the
   * axis pointing at the viewer is counter-clockwise). */
  roll: number;
}

/** The same window `overlayOrigin.ts` uses, for the same reason: an old click
 * must never leak into an unrelated later open, and the read stays
 * non-destructive so React 18 StrictMode's double-invoked mount initializers
 * can't consume it before the real one runs. */
const STALE_AFTER_MS = 3000;

let pending: { pose: OpeningPose; capturedAt: number } | null = null;

export function setPendingOpeningPose(pose: OpeningPose): void {
  pending = { pose, capturedAt: Date.now() };
}

export function readPendingOpeningPose(): OpeningPose | null {
  if (!pending) return null;
  if (Date.now() - pending.capturedAt > STALE_AFTER_MS) return null;
  return pending.pose;
}
