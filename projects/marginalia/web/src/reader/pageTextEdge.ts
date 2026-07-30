/**
 * "Has this drag-selection actually reached the end of the page?"
 *
 * M19.6 operator feedback round 4, on the highlight-across-a-page-boundary
 * dwell: sitting in the turn zone was the whole condition, so a selection
 * dragged down the middle of a paragraph — nowhere near the end of the page —
 * would cross the zone and turn the page anyway, which reads as a stray swipe
 * rather than as continuing the highlight. The turn should only be offered once
 * the cursor is genuinely *past the last word on the page*: further right than
 * it, or below the last line.
 *
 * Rather than reconstruct column boxes and line boxes, this asks the layout
 * engine where the caret would go. The caret nearest the page's bottom-right
 * corner is the last text position on the page; if the caret nearest the
 * cursor is at or after it, the cursor is past the page's text. Mid-paragraph
 * the cursor's caret is the end of *that* line, which is well before the end of
 * the page, so the gesture correctly refuses. The mirror holds for "prev"
 * against the page's top-left corner.
 */

interface Point {
  x: number;
  y: number;
}

/** The visible page, in the iframe document's own client coordinates. */
export interface PageBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Keeps the probe a hair inside the page rather than on its boundary. */
const PROBE_INSET_PX = 2;

/** `caretRangeFromPoint` is not in the DOM lib — it never made it to standard. */
interface CaretDocument {
  caretRangeFromPoint?(x: number, y: number): Range | null;
  caretPositionFromPoint?(
    x: number,
    y: number,
  ): { offsetNode: Node; offset: number } | null;
}

/**
 * A collapsed range at the caret nearest a point. `caretRangeFromPoint` is
 * Chromium/WebKit; `caretPositionFromPoint` is the standard one Firefox ships.
 * Null when neither is available or the point resolves to nothing.
 */
export function caretRangeAt(doc: Document, x: number, y: number): Range | null {
  const d = doc as unknown as CaretDocument;
  if (typeof d.caretRangeFromPoint === "function") {
    return d.caretRangeFromPoint(x, y);
  }
  if (typeof d.caretPositionFromPoint === "function") {
    const position = d.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = doc.createRange();
    try {
      range.setStart(position.offsetNode, position.offset);
    } catch {
      return null;
    }
    range.collapse(true);
    return range;
  }
  return null;
}

export function cursorPastPageText(
  zone: "prev" | "next",
  doc: Document,
  cursor: Point,
  page: PageBox,
): boolean {
  const cursorCaret = caretRangeAt(doc, cursor.x, cursor.y);
  const edgeCaret =
    zone === "next"
      ? caretRangeAt(doc, page.right - PROBE_INSET_PX, page.bottom - PROBE_INSET_PX)
      : caretRangeAt(doc, page.left + PROBE_INSET_PX, page.top + PROBE_INSET_PX);

  // No caret to compare against — an engine without either API, or a page with
  // no text on it at all. Allow the turn rather than making the gesture
  // silently impossible; the dwell still has to be held out at the edge.
  if (!cursorCaret || !edgeCaret) return true;

  const order = cursorCaret.compareBoundaryPoints(Range.START_TO_START, edgeCaret);
  return zone === "next" ? order >= 0 : order <= 0;
}
