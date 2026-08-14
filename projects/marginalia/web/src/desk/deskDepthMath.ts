/**
 * Pure geometry for the Desk's 3D depth, kept apart from the R3F component so
 * it's unit-testable without a GPU (the same split as `controls/sliderMath.ts`).
 *
 * ## Why a real perspective camera, and how it stays honest about position
 *
 * The first cut of M23 §B used a straight-down **orthographic** camera mapping
 * world units to viewport pixels 1:1, and faked depth by rotating each book
 * proportional to its distance from the viewport's centre (`bookTilt`, since
 * deleted). The reasoning was TASKS.md's warning that "a projected 3D surface
 * is where hit-testing breaks". It was the wrong trade, and the operator caught
 * all three of its symptoms live:
 *
 * 1. **It tilted the wrong way.** Rotating a book about its own centre lifts
 *    the far edge and buries the near one, so an off-centre book showed the
 *    side face pointing *away* from the camera. A real lens shows you the face
 *    pointing *toward* it — a book at the left of the desk reveals its right
 *    side, not its left.
 * 2. **It cut the books in half.** The same rotation about the centre sank the
 *    other half of the book below the desk plane, which then occluded it — a
 *    clean straight edge across the cover, always on the side facing the
 *    screen's centre.
 * 3. **It snapped.** The tilt axis had to be snapped to whichever of the book's
 *    own edges dominated the offset (a diagonal axis reveals a *tapering*
 *    sliver of the side face, which reads as a warped wedge), so the reveal
 *    jumped between four fixed presentations as a book was dragged instead of
 *    tracking continuously.
 *
 * All three are artefacts of faking foreshortening rather than having any. A
 * perspective camera has none of them: the reveal is whatever the projection
 * says it is, continuously, in the correct direction, with the book sitting
 * flat *on* the desk and never intersecting it.
 *
 * ## The 1:1 plane
 *
 * The hit-testing worry the orthographic camera was avoiding is answered
 * exactly, not traded away. Put the camera straight above the viewport's
 * centre at distance `d`, with a vertical field of view of
 * `2·atan((h/2) / d)` and aspect `w/h`, and the plane `y = 0` maps to the
 * viewport **1:1**: world (x, 0, z) lands on screen pixel (x, z), for every
 * x and z, corner included. This is the same construction CSS `perspective:
 * <d>px` uses, which is why it composes with DOM coordinates so cleanly.
 *
 * So a book's *footprint* — its bottom face, resting at y = 0 — is exactly its
 * DOM `BookObject` rect, at every desk position, and drag/drop hit-testing is
 * unaffected. Only what stands *above* y = 0 splays outward with distance from
 * the optical axis, which is precisely the depth cue the milestone asked for.
 * The visible top of a 22px-thick book sits at most `22·offset/d` px (≈25px in
 * a far corner) from its own footprint — that is not drift, it is the object
 * having a real height.
 */

export interface DeskCameraFrame {
  /** Vertical field of view, in **degrees** (three.js's PerspectiveCamera unit). */
  fov: number;
  aspect: number;
  /** Straight above the viewport's centre, on the desk plane's normal. */
  position: readonly [number, number, number];
  /** The viewport's centre, on the desk plane (y = 0). */
  target: readonly [number, number, number];
  near: number;
  far: number;
}

/** Widest usable eye distance: past this the desk is nearly orthographic and
 * books stop reading as objects. */
const MAX_PERSPECTIVE_DISTANCE = 1400;
/** Narrowest: below this the splay at the corners is caricature, and a tall
 * object near the edge starts to lean across its neighbours. */
const MIN_PERSPECTIVE_DISTANCE = 620;
/** Eye distance as a fraction of viewport height. Lower = wider field of view
 * = more of each book's sides revealed. 0.9 puts a 900px-tall window at ~54°,
 * comfortably wider than CSS's conventional ~1000px perspective and short of
 * the fisheye the corners get below ~45°. */
const DISTANCE_PER_VIEWPORT_HEIGHT = 0.9;

/**
 * How far above the desk the eye sits, for a viewport `height` px tall.
 * Scaling with the viewport (rather than fixing it) keeps the *angle* a book
 * near the edge is seen at roughly constant across window sizes — a fixed
 * distance would make a small window look flat and a large one look extreme.
 */
export function deskPerspectiveDistance(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return MIN_PERSPECTIVE_DISTANCE;
  return Math.min(
    MAX_PERSPECTIVE_DISTANCE,
    Math.max(MIN_PERSPECTIVE_DISTANCE, height * DISTANCE_PER_VIEWPORT_HEIGHT),
  );
}

/**
 * The camera that makes the desk plane (`y = 0`) map to the viewport 1:1 —
 * see this module's header for the derivation and for why that mapping is the
 * whole basis of DOM/3D agreement on the Desk.
 */
export function deskCameraFrame(width: number, height: number, distance: number): DeskCameraFrame {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const d = Math.max(1, distance);
  return {
    fov: (2 * Math.atan(h / 2 / d) * 180) / Math.PI,
    aspect: w / h,
    position: [w / 2, d, h / 2],
    target: [w / 2, 0, h / 2],
    near: Math.max(1, d / 100),
    far: d + 8000,
  };
}

/**
 * The Desk's camera for a viewport of this size — the frame plus the distance
 * that goes with it, which is the only form any consumer actually wants.
 *
 * ⚠️ Shared with the opening (M23 §E), which borrows the Desk's camera unchanged
 * so a book clicked on the Desk keeps looking exactly as it did on the overlay's
 * first frame. Two surfaces constructing "the Desk's camera" separately is the
 * drift this exists to prevent.
 */
export function deskViewFrame(width: number, height: number): DeskCameraFrame {
  return deskCameraFrame(width, height, deskPerspectiveDistance(height));
}

/** The camera's up vector on this surface. Screen-down is +Z here, so up points
 * at −Z — that is what makes world `(x, 0, z)` land on screen pixel `(x, z)`
 * rather than on its vertical mirror. */
export const DESK_CAMERA_UP = [0, 0, -1] as const;

/**
 * How far the top of an object of height `objectHeight` is displaced from its
 * own footprint, for a footprint `offset` px from the optical axis under
 * `deskCameraFrame`'s camera. Not used by the scene — it is how the "does the
 * cover still land on its hit target" claim above is checked in a test rather
 * than asserted in a comment.
 */
export function perspectiveSplay(objectHeight: number, offset: number, distance: number): number {
  if (distance <= objectHeight) return Infinity;
  return (objectHeight * Math.abs(offset)) / (distance - objectHeight);
}

/** Thinnest and thickest a book on the desk is allowed to be, in px, against
 * the 168px cover width `BookCover.module.css` fixes. A trade paperback runs
 * about 0.10–0.18 of its width thick. */
const MIN_BOOK_THICKNESS = 17;
const MAX_BOOK_THICKNESS = 30;

/**
 * A book's thickness, in px. Deterministic per resource id (so a book is the
 * same object every session, and the same object in every 3D surface) but
 * varied across the library, because a desk of identically-thick books reads
 * as a set of tiles rather than a set of objects. The library carries no page
 * or word count to derive a *true* thickness from — SPEC-GAP, NOTES.md; if one
 * ever lands, this is the single place that changes.
 */
export function bookThickness(resourceId: string): number {
  let hash = 0;
  for (let i = 0; i < resourceId.length; i += 1) {
    hash = (hash * 31 + resourceId.charCodeAt(i)) >>> 0;
  }
  const span = MAX_BOOK_THICKNESS - MIN_BOOK_THICKNESS;
  return MIN_BOOK_THICKNESS + (hash % (span + 1));
}

/** How high a book floats above the desk while hovered, and while dragged, in
 * px. Shared between the DOM `BookObject` (which owns the gesture and writes
 * the target) and `DeskScene3D` (which damps toward it and draws the result),
 * so the two can't drift apart. */
export const BOOK_HOVER_LIFT = 7;
export const BOOK_DRAG_LIFT = 34;

/** How far off the desk a book rests before any hover lift or stacking — enough
 * that a book never z-fights the surface it is lying on. Shared with the
 * opening (M23 §E), which starts its sequence at exactly the height the Desk
 * was drawing the book at. */
export const BOOK_BASE_ELEVATION = 0.35;

/** A book's stacking rank (0 = lowest) among the given z-orders, translated
 * into a small world-unit lift so overlapping books don't z-fight — the
 * *rank*, not the raw `zOrder`, because `zOrder` only ever grows across an
 * app session (`DeskCanvas.tsx`'s `zCounter`) and would otherwise push
 * elevation arbitrarily high for a book brought to front many times.
 *
 * Capped: under a perspective camera, elevation is no longer free — a book
 * lifted off the desk splays away from its own footprint (and its DOM hit
 * target) by `perspectiveSplay`. A handful of px of separation is all
 * z-fighting needs, and `maxRank` keeps a large library from accumulating it
 * into a visible offset. */
export function stackElevation(
  zOrder: number,
  allZOrders: readonly number[],
  step: number,
  maxRank = 8,
): number {
  const sorted = [...new Set(allZOrders)].sort((a, b) => a - b);
  const rank = sorted.indexOf(zOrder);
  return rank < 0 ? 0 : Math.min(rank, maxRank) * step;
}
