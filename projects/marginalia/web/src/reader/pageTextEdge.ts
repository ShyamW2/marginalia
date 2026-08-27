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

/**
 * "Is there a glyph under this point?" — the ink/paper test the M31 pointer
 * contract is built on (DESIGN.md, "How ink is detected").
 *
 * ⚠️ `caretRangeAt` above **snaps to the nearest caret and never returns null
 * in a margin**, so asking it alone answers "where would a caret go", not "is
 * there ink here": a press 200px out in the outer margin still resolves to the
 * end of the nearest line. The test is one step further — take that caret,
 * extend it by one character, and ask whether the point actually falls inside
 * the resulting line box.
 *
 * Both directions are probed, and that is not belt-and-braces. A point in the
 * space *between two words* can snap to the caret after the space, whose
 * forward character is the next word's first glyph — a rect that starts to the
 * right of the point. Forward-only would call the inter-word gap "paper" and
 * turn the page under a reader trying to select. The backward probe is the
 * space's own rect, which contains the point.
 */
export function pointIsOverInk(doc: Document, x: number, y: number): boolean {
  const caret = caretRangeAt(doc, x, y);
  if (!caret) return false;
  for (const probe of oneCharacterProbes(caret)) {
    const rects = probe.getClientRects();
    for (let i = 0; i < rects.length; i += 1) {
      const r = rects[i];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
  }
  return false;
}

/** The character just after the caret and the one just before it, as ranges —
 * whichever of the two exist. A caret at the very start or end of its own node
 * only has one; a caret with neither (an empty node) has none, and a point
 * over an empty node is paper by definition. */
function oneCharacterProbes(caret: Range): Range[] {
  const node = caret.startContainer;
  const offset = caret.startOffset;
  // nodeType compared numerically rather than against Node.TEXT_NODE so this
  // stays unit-testable against a fake document (there is no global `Node`).
  const length =
    node.nodeType === 3 ? (node as Text).data.length : node.childNodes.length;
  const probes: Range[] = [];
  if (offset < length) {
    const forward = caret.cloneRange();
    try {
      forward.setEnd(node, offset + 1);
      probes.push(forward);
    } catch {
      /* a node that refuses the offset contributes no probe */
    }
  }
  if (offset > 0) {
    const back = caret.cloneRange();
    try {
      back.setStart(node, offset - 1);
      probes.push(back);
    } catch {
      /* as above */
    }
  }
  return probes;
}
