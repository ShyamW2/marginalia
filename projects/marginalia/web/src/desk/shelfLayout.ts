import { bookThickness } from "./deskDepthMath.js";

/**
 * Pure geometry for the 3D shelf (M23 §D), kept apart from the R3F component
 * so it is unit-testable without a GPU — the same split as `deskDepthMath.ts`.
 *
 * ## The shelf is a wall standing on the desk's floor
 *
 * The seam's units do not change (settled decision 14a: one world unit is one
 * CSS pixel, origin at the viewport's top-left, +X right, +Y up out of the desk
 * surface). What changes is the camera, which is exactly what a consumer is
 * allowed to bring: the Desk hangs one **above** the plane `y = 0` looking
 * down, and the shelf stands one **in front of** the plane `z = 0` looking
 * along −Z. So on this surface +Y is up the screen and +Z comes toward the
 * viewer, and a DOM point `(x, y)` is world `(x, −y, 0)` — the sign is the
 * whole conversion, because DOM y grows downward and world y grows up.
 *
 * ## The 1:1 plane, and why the spine face sits on it
 *
 * Same construction as the Desk's (`deskDepthMath.ts`): eye at distance `d` on
 * the plane's normal through the viewport's centre, vertical field of view
 * `2·atan((h/2)/d)`, and the plane `z = 0` maps to the viewport 1:1.
 *
 * The books are then placed with their **spine faces on that plane** and their
 * bodies receding away from the viewer. This is strictly better than the Desk's
 * arrangement rather than merely equivalent: on the Desk only the footprint is
 * exact and everything standing above it splays, whereas here the one face a
 * user can see, point at, or click *is* the 1:1 face, and every part that
 * foreshortens is behind it where nothing is aimed. A book's DOM hit target is
 * its spine, exactly, at every scroll offset.
 *
 * ## Why every book stands upright
 *
 * A shelf of slightly-leaning books is more charming and was tried first. It is
 * also the one thing on this surface that breaks the paragraph above: a leaning
 * spine no longer covers the axis-aligned DOM rect that carries its focus ring
 * and its click, worst at the top corners where the lean has the most reach.
 * The variety comes from thickness, height and binding colour instead — three
 * real per-book differences rather than a decorative one that costs the hit
 * target.
 */

export interface ShelfCameraFrame {
  /** Vertical field of view, in **degrees** (three.js's PerspectiveCamera unit). */
  fov: number;
  aspect: number;
  /** In front of the viewport's centre, on the shelf plane's normal. */
  position: readonly [number, number, number];
  /** The viewport's centre, on the shelf plane (z = 0). */
  target: readonly [number, number, number];
  near: number;
  far: number;
}

const MAX_PERSPECTIVE_DISTANCE = 1500;
const MIN_PERSPECTIVE_DISTANCE = 700;
/** Eye distance as a fraction of viewport height — a little further back than
 * the Desk's 0.9, because on a shelf the foreshortened part is a book's whole
 * 200px body rather than its 20px thickness, and a wider lens turns the row's
 * outer books into a fan. */
const DISTANCE_PER_VIEWPORT_HEIGHT = 1.15;

/** How far in front of the shelf the eye sits, for a viewport `height` px tall.
 * Scales with the viewport for the same reason the Desk's does: a fixed
 * distance makes a small window look flat and a large one look extreme. */
export function shelfPerspectiveDistance(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return MIN_PERSPECTIVE_DISTANCE;
  return Math.min(
    MAX_PERSPECTIVE_DISTANCE,
    Math.max(MIN_PERSPECTIVE_DISTANCE, height * DISTANCE_PER_VIEWPORT_HEIGHT),
  );
}

/** The camera that makes the shelf plane (`z = 0`) map to the viewport 1:1 —
 * see this module's header for the derivation. */
export function shelfCameraFrame(width: number, height: number, distance: number): ShelfCameraFrame {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const d = Math.max(1, distance);
  return {
    fov: (2 * Math.atan(h / 2 / d) * 180) / Math.PI,
    aspect: w / h,
    position: [w / 2, -h / 2, d],
    target: [w / 2, -h / 2, 0],
    near: Math.max(1, d / 100),
    far: d + 8000,
  };
}

/**
 * The shelf's camera for a viewport of this size — the frame plus the distance
 * that goes with it.
 *
 * ⚠️ Shared with the opening (M23 §E), which borrows the shelf's camera unchanged
 * so a book clicked on the shelf keeps looking exactly as it did on the
 * overlay's first frame. Unlike the Desk's, this one needs no `up` override:
 * a front-facing camera takes three.js's default.
 */
export function shelfViewFrame(width: number, height: number): ShelfCameraFrame {
  return shelfCameraFrame(width, height, shelfPerspectiveDistance(height));
}

/** A book is fatter on the shelf than on the desk: the desk shows a cover and
 * the shelf shows a *spine*, and 17–30px of thickness is a band too narrow to
 * letter a title on legibly (`spineLayout.ts` would floor every book at its
 * minimum type size). Scaling the shared `bookThickness` rather than inventing
 * a second thickness keeps a book recognisably the same object on both
 * surfaces. */
const SHELF_THICKNESS_SCALE = 2.1;
/** Head-to-tail, before the per-book variation below. Sized so a row of books
 * is the *subject* of the room rather than an ornament sitting in the middle of
 * it — the shelf's whole job is that you can read the spines. */
const BASE_BOOK_HEIGHT = 352;
const HEIGHT_VARIATION = 74;
/** Covers are 2:3 (`BookCover.module.css`), so a book's depth into the shelf
 * follows from its height. */
const COVER_ASPECT = 1.5;
/** Books touch on a real shelf; this is the hair of air that keeps two
 * neighbouring boards from z-fighting where they meet. */
export const SHELF_BOOK_GAP = 2;
/** Clear space at each end of the row, so the first and last books are not
 * jammed against the scroll container's edge. */
export const SHELF_EDGE_PADDING = 56;

export interface ShelfBookSize {
  /** The spine face's width — the book's thickness. */
  width: number;
  /** Head to tail. */
  height: number;
  /** How far the body recedes behind the spine face. */
  depth: number;
}

/**
 * How big a book stands on the shelf. Deterministic per resource id, like
 * `bookThickness` (whose hash it reuses for the thickness and re-mixes for the
 * height), so a book is the same object every session and its neighbours don't
 * resize when one is added or removed.
 */
export function shelfBookSize(resourceId: string): ShelfBookSize {
  let hash = 0;
  for (let i = 0; i < resourceId.length; i += 1) {
    hash = (hash * 131 + resourceId.charCodeAt(i)) >>> 0;
  }
  const height = BASE_BOOK_HEIGHT + (hash % (HEIGHT_VARIATION + 1));
  return {
    width: Math.round(bookThickness(resourceId) * SHELF_THICKNESS_SCALE),
    height,
    depth: Math.round(height / COVER_ASPECT),
  };
}

export interface ShelfSlot extends ShelfBookSize {
  resourceId: string;
  /** px from the strip's left edge to this book's spine-left edge. */
  left: number;
}

export interface ShelfRow {
  slots: ShelfSlot[];
  /** Total width of the strip, in px — what the scroll container scrolls. */
  width: number;
  /** The tallest book, so the row can be tall enough to hold it. */
  tallest: number;
}

/**
 * Lay a row of books left to right in the order given (the library's own
 * order), each standing on the same baseline.
 *
 * `minWidth` is the container's width. It does two things: the strip never
 * collapses below it (so the plank runs the whole width of the room), and a
 * library too short to fill it is **centred** rather than left-aligned. A
 * three-book library pushed against the left edge of a 1400px room reads as a
 * layout bug rather than as a small library, and the row only starts scrolling
 * — where left-alignment is the only sane behaviour — once it outgrows the
 * container anyway.
 */
export function layoutShelf(resourceIds: readonly string[], minWidth = 0): ShelfRow {
  let cursor = SHELF_EDGE_PADDING;
  let tallest = 0;
  const slots = resourceIds.map((resourceId) => {
    const size = shelfBookSize(resourceId);
    const slot: ShelfSlot = { resourceId, left: cursor, ...size };
    cursor += size.width + SHELF_BOOK_GAP;
    tallest = Math.max(tallest, size.height);
    return slot;
  });
  const contentWidth =
    slots.length === 0 ? SHELF_EDGE_PADDING : cursor - SHELF_BOOK_GAP + SHELF_EDGE_PADDING;
  const width = Math.max(minWidth, contentWidth);
  const centring = Math.round((width - contentWidth) / 2);
  return {
    slots: centring > 0 ? slots.map((slot) => ({ ...slot, left: slot.left + centring })) : slots,
    width,
    tallest,
  };
}

/** How high a book rises out of the row while hovered or focused, in px.
 * Shared between the DOM element (which owns the gesture) and the 3D layer
 * (which damps toward it and draws the result), so the two can't drift apart —
 * the same split as the Desk's `BOOK_HOVER_LIFT`. */
export const SHELF_HOVER_LIFT = 26;
