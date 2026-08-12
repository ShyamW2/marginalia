/**
 * Pure geometry for M23 §B's "real depth" desk book, kept apart from the R3F
 * component so it's unit-testable without a GPU (the same split as
 * `controls/sliderMath.ts`).
 *
 * The desk uses an orthographic camera that maps world units to viewport
 * pixels 1:1 (`DeskScene3D.tsx`'s `DeskCameraRig`) — deliberately, so a
 * book's DOM hit target and its 3D render always agree on where it is, at
 * every desk position including the corners (TASKS.md M23 §B's own warning:
 * "a projected 3D surface is where hit-testing breaks"). An orthographic,
 * straight-down camera can never reveal a book's side on its own, though —
 * there's no foreshortening to earn it. `bookTilt` fakes that reveal by
 * rotating the book mesh itself, proportional to its distance from the
 * camera's optical axis (the current viewport's centre), instead of moving
 * the camera off axis. SPEC-GAP: TASKS.md describes the effect a real
 * perspective camera would produce ("as a real object seen from above
 * would be") but doesn't mandate literal perspective — see NOTES.md.
 */

export interface BookTilt {
  /** World-space horizontal axis (already unit length) to rotate around. */
  axis: readonly [number, number, number];
  /** Radians, always >= 0. */
  angle: number;
}

const ZERO_TILT: BookTilt = { axis: [1, 0, 0], angle: 0 };

/**
 * `angle` grows linearly from 0 at the pivot to `maxAngle` at `falloff`
 * world units away, then clamps — so a book dragged past the falloff radius
 * keeps revealing the same amount of side rather than tilting indefinitely.
 *
 * `axis` is snapped to one of the book's own two edges — world Z (rolls
 * around the book's height edge, revealing its left/right side) or world X
 * (pitches around its width edge, revealing its top/bottom side) — whichever
 * is more aligned with the book's offset from the pivot, rather than the
 * free diagonal `[-nz, 0, nx]` an earlier version used. That diagonal axis
 * looked correct in isolation but, caught live, rendered every off-centre
 * book as a warped wedge instead of a book: a box tilted around an axis
 * that isn't parallel to one of its own edges reveals a *non-uniform* sliver
 * of its side face (wider at one corner than the other), and that sliver's
 * silhouette — unioned with the top face's own (still perfectly clean)
 * parallelogram — is what read as a taper. Tilting around an axis flush
 * with an edge reveals a uniform-width sliver instead, which stays a clean
 * rectangle no matter the angle. The cost is a hard axis snap at the
 * diagonal rather than a smooth blend; a real book's spine doesn't
 * physically allow a diagonal reveal either, so this reads as intentional
 * rather than a glitch.
 */
export function bookTilt(
  worldX: number,
  worldZ: number,
  pivotX: number,
  pivotZ: number,
  maxAngle: number,
  falloff: number,
): BookTilt {
  const dx = worldX - pivotX;
  const dz = worldZ - pivotZ;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6 || falloff <= 0) return ZERO_TILT;
  const angle = Math.min(1, dist / falloff) * maxAngle;
  const axis: readonly [number, number, number] =
    Math.abs(dx) >= Math.abs(dz) ? [0, 0, dx >= 0 ? 1 : -1] : [dz >= 0 ? -1 : 1, 0, 0];
  return { axis, angle };
}

/** A book's stacking rank (0 = lowest) among the given z-orders, translated
 * into a small world-unit lift so overlapping books don't z-fight — the
 * *rank*, not the raw `zOrder`, because `zOrder` only ever grows across an
 * app session (`DeskCanvas.tsx`'s `zCounter`) and would otherwise push
 * elevation arbitrarily high for a book brought to front many times. */
export function stackElevation(zOrder: number, allZOrders: readonly number[], step: number): number {
  const sorted = [...new Set(allZOrders)].sort((a, b) => a - b);
  const rank = sorted.indexOf(zOrder);
  return rank < 0 ? 0 : rank * step;
}
