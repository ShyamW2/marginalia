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

export interface BookParts {
  /** How far the round back stands proud of the boards (`spineBulge`). */
  bulge: number;
  /** A board's width — the *cover*, which is the book's footprint less the
   * bulge the round back takes out of it. */
  boardWidth: number;
  boardThickness: number;
  /** The page block, between the two boards. */
  blockThickness: number;
  pageInset: number;
  pageWidth: number;
  pageHeight: number;
}

/**
 * Every derived dimension of the shared book asset, in one place.
 *
 * Extracted from `Book3D.tsx` at M23 §E, where a second consumer needs them:
 * the opening has to know where the crease falls and how wide the spread ends
 * up in order to land it on the reading pane *measurably* rather than by eye.
 * Two components deriving the same numbers from the same three inputs is
 * exactly the drift this file exists to prevent.
 */
export function bookParts(width: number, height: number, thickness: number): BookParts {
  const bulge = spineBulge(width, thickness);
  const boardThickness = Math.max(thickness * 0.09, 0.008 * width);
  const blockThickness = Math.max(thickness - boardThickness * 2, thickness * 0.35);
  const boardWidth = width - bulge;
  // Pages sit a hair inside the boards on the three cut edges and flush at the
  // spine — the overhang is most of what makes a closed book read as a bound
  // object rather than a slab.
  const pageInset = width * 0.022;
  return {
    bulge,
    boardWidth,
    boardThickness,
    blockThickness,
    pageInset,
    pageWidth: boardWidth - pageInset,
    pageHeight: height - pageInset * 2,
  };
}

/**
 * How far a printed page floats above the board it is printed on, in the book's
 * own units. Enough to win the depth test against the page block and the
 * board's inner face without being a visible gap: on a 22px-thick desk book
 * this is a hundredth of the thickness, and it scales with nothing because the
 * surfaces it clears do not move.
 *
 * Lives here rather than in `Book3D.tsx` because `openSpread` has to know it:
 * the landing puts the *paper* on the camera's 1:1 plane, and the paper is one
 * of these above the board.
 */
export const PAGE_LIFT = 0.25;

export interface OpenSpread {
  /** The crease, in the book's own x — the hinge the front board turns about. */
  creaseX: number;
  /** The spread's outer bounds in the book's own x. */
  left: number;
  right: number;
  /** `right - left`, which is exactly **two boards** wide. */
  width: number;
  /** Head to tail — the boards' own height. */
  height: number;
  /**
   * Where the spread's paper sits on the book's z once it is open.
   *
   * ⚠️ **The two halves are coplanar, and have to be** (2026-08-14). They were
   * not: the right page lay on the page block's top face at `blockThickness/2`
   * while the left lay on the swung-open front board at `thickness/2` — a board
   * thickness higher, because a board is thicker than a page. Two pages on two
   * planes under a *perspective* camera are two pages at two magnifications, and
   * the operator saw it exactly as it behaves: "when it opens the left page and
   * right page aren't equal in size", worst while the book is floating out at
   * `FLOAT_Z` and far from the optical axis. Splitting the difference (this used
   * to be the midpoint of the two) halves the error without removing it, because
   * the error is a *separation*, not an offset.
   *
   * So the printed pages both float `PAGE_LIFT` above the **open front board's**
   * face — the higher of the two — and the right one clears the page block by a
   * board thickness rather than resting on it. `Book3D.tsx` places them; this is
   * the plane it places them on, and the plane the landing puts on the camera's
   * 1:1 plane.
   */
  paperZ: number;
}

/**
 * The spread a book of these dimensions reveals when its front board is opened
 * a full 180° about the hinge — M23 §E, and TASKS.md's "the spread is twice the
 * cover's width, creased at the hinge".
 *
 * ⚠️ **Twice the cover, not twice the footprint.** The board spans
 * `[bulge, width]`, because the round back takes its bulge *out* of the covers
 * rather than hanging outside the book's footprint (`spineBulge`'s docstring,
 * and the 1:1-plane invariant it protects). So the open spread runs from
 * `bulge − boardWidth` to `width` — 2 × boardWidth exactly, centred on the
 * hinge at `x = bulge`, which is ~4.5% narrower than 2 × the DOM cover rect.
 * The crease being the spread's own centre is the property the landing depends
 * on, and it is exact.
 */
export function openSpread(width: number, height: number, thickness: number): OpenSpread {
  const parts = bookParts(width, height, thickness);
  return {
    creaseX: parts.bulge,
    left: parts.bulge - parts.boardWidth,
    right: parts.bulge + parts.boardWidth,
    width: parts.boardWidth * 2,
    height,
    paperZ: thickness / 2 + PAGE_LIFT,
  };
}
