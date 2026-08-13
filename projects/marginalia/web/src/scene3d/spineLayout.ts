/**
 * How a title is set on a spine. Pure, and kept apart from the canvas that
 * paints it (`spineTexture.ts`) so the fitting rules are unit-testable without
 * a DOM — the same split as `bookGeometry.ts` and `coverPalette.ts`.
 *
 * A spine is a very long, very narrow measure: type is sized by the *width* of
 * the band (which caps how tall a line can be) and truncated by its *length*.
 * Both constraints are real and they pull in opposite directions, which is why
 * this is arithmetic with a test rather than two constants in a paint routine.
 */

/** Fraction of the spine's width the cap height is allowed to take. The rest
 * is the margin either side; below about a third the lettering reads as a
 * scratch, above about a half it crowds the cloth. */
const TYPE_TO_SPINE_WIDTH = 0.44;
/** Never smaller than legible, never larger than a title has any business
 * being — a very fat book would otherwise letter its spine like a poster. */
const MIN_FONT_PX = 7;
const MAX_FONT_PX = 26;
/** Head and tail margins, as a fraction of the spine's length. The head margin
 * is larger because the head rule sits in it. */
const HEAD_MARGIN = 0.11;
const TAIL_MARGIN = 0.06;

export interface SpineType {
  /** Font size, in the same px the caller measures in. */
  fontPx: number;
  /** The title as it should actually be painted — truncated with an ellipsis
   * if the full one cannot fit the band. */
  text: string;
  truncated: boolean;
  /** Where the lettering starts and ends along the spine, in px from the head. */
  start: number;
  end: number;
}

/**
 * Set `title` on a spine `lengthPx` long and `widthPx` across.
 *
 * `measure` reports the rendered width of a string at a font size — the canvas
 * passes its own `ctx.measureText`, and a test passes a stub. Taking it as an
 * argument is what keeps this module free of the DOM without having to
 * hard-code an average glyph width and hope.
 */
export function fitSpineTitle(
  title: string,
  lengthPx: number,
  widthPx: number,
  measure: (text: string, fontPx: number) => number,
): SpineType {
  const fontPx = Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, widthPx * TYPE_TO_SPINE_WIDTH));
  const start = lengthPx * HEAD_MARGIN;
  const end = lengthPx * (1 - TAIL_MARGIN);
  const available = Math.max(0, end - start);
  const clean = title.trim().replace(/\s+/g, " ");

  if (measure(clean, fontPx) <= available) {
    return { fontPx, text: clean, truncated: false, start, end };
  }

  // Binary search the longest prefix that still fits with its ellipsis. Linear
  // trimming is fine for a title but this also runs for every book on a shelf
  // at mount, and `measure` is the expensive part.
  let low = 0;
  let high = clean.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${clean.slice(0, mid).trimEnd()}…`, fontPx) <= available) low = mid;
    else high = mid - 1;
  }
  return { fontPx, text: `${clean.slice(0, low).trimEnd()}…`, truncated: true, start, end };
}
