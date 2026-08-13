/**
 * Pure geometry for the shared book asset (`Book3D.tsx`), kept apart from the
 * component so it is unit-testable without a GPU — the same split as
 * `desk/deskDepthMath.ts` and `controls/sliderMath.ts`.
 *
 * ## Why the back is round
 *
 * The first cut of the book built its spine as a **box** spanning the full
 * thickness at `x = 0`, with the boards and the page block also starting at
 * `x = 0`. Four solids then shared the plane `x = 0` with the *same* outward
 * normal, and two more shared `z = ±thickness/2`. Coplanar same-facing polygons
 * are a depth-buffer tie: which one wins is decided by float noise, so it
 * changes with every sub-pixel of camera movement. The operator saw it exactly
 * as it behaves — a binder that "fizzles" while a book is dragged, showing the
 * cream of the page block through the brown of the spine.
 *
 * Nudging the pieces apart by an epsilon would have papered over it. The real
 * fix is that a bound book *has no flat spine*: the back is a curve running
 * from one board's outer corner, around the hinge, to the other's. Modelling
 * that curve removes the shared planes entirely rather than tuning the tie —
 * and it is what the object actually looks like.
 *
 * ⚠️ Coincident faces with **opposite** normals are fine and are still used
 * (the page block's faces against the boards' inner faces): backface culling
 * draws exactly one of the pair. Only same-facing coincidence fights.
 */

export interface SpineArc {
  /** Radius of the circular back, in the book's own units. */
  radius: number;
  /** Where the arc's centre sits on the book's x axis. Inside the body, since
   * the arc is a shallow segment of a large circle rather than a half-round. */
  centerX: number;
  /** `CylinderGeometry`'s thetaStart, radians. Its vertices run
   * `(sin θ, ·, cos θ)·r`, so this frame is the caller's x/z, not a screen one. */
  thetaStart: number;
  /** `CylinderGeometry`'s thetaLength, radians — the arc actually drawn. */
  thetaLength: number;
}

/**
 * The round back of a book `thickness` units thick whose spine stands `bulge`
 * units proud of the boards' outer edges.
 *
 * In the book's local frame (`Book3D.tsx`'s docstring): the arc's apex touches
 * `x = 0, z = 0` — the spine's outermost point, and the book's own left bound —
 * and its two ends land exactly on the boards' outer corners at
 * `x = bulge, z = ±thickness/2`, so the curve meets the covers with no step and
 * no overlap.
 *
 * A circle centred at `(c, 0)` through the origin has radius `c`; requiring it
 * to also pass through `(b, ±t/2)` gives `b² − 2bc + t²/4 = 0`, so
 * `c = (b² + t²/4) / 2b`. `bulge = thickness/2` is the deepest meaningful case
 * (a true half-round back, `c = t/2`) and is clamped to, because past it the
 * circle would have to bend back on itself to reach the corners.
 */
export function spineArc(thickness: number, bulge: number): SpineArc {
  const t = Math.max(1e-6, thickness);
  const b = Math.min(Math.max(1e-6, bulge), t / 2);
  const radius = (b * b + (t * t) / 4) / (2 * b);
  // Half the angle the arc subtends, measured from the apex. The endpoint sits
  // `t/2` off the axis through apex and centre, at distance `radius` from it.
  const half = Math.asin(Math.min(1, t / 2 / radius));
  // The apex points along −x, which is θ = −π/2 in CylinderGeometry's frame.
  return { radius, centerX: radius, thetaStart: -Math.PI / 2 - half, thetaLength: 2 * half };
}

/**
 * How far the round back stands proud of the boards, for a book `width` wide
 * and `thickness` thick. Proportional to thickness (a fatter book has a fatter
 * back) but capped against the *cover* width, because this is the one dimension
 * the covers give up: they span `[bulge, width]`, not `[0, width]`, so the
 * whole object still fills exactly the footprint its DOM hit target claims
 * (`desk/deskDepthMath.ts`'s 1:1 plane). At the cap the cover carries ~4.5% less
 * width than the source image's 2:3 — under the threshold where the squeeze is
 * visible, and the alternative (a spine hanging outside the footprint) breaks an
 * invariant to save it.
 */
export function spineBulge(width: number, thickness: number): number {
  return Math.min(Math.max(thickness, 0) * 0.4, Math.max(width, 0) * 0.045);
}
