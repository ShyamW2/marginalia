/**
 * Extracts up to `maxLen` characters of text immediately before and after a
 * Range, using the browser's own Range.toString() text-flattening so the
 * result matches exactly what a later textContent-based search would see
 * (no manual whitespace-normalization heuristics needed).
 *
 * `root` is the element whose flattened text *is* "the section" for offset
 * purposes — `contents.document.body` for `EpubRenderer` (one document per
 * section), a page's own text-layer div for `PdfRenderer` (M40 §D, which has
 * no per-section iframe to isolate against). Generalized from a
 * `document`-only signature for that renderer — see `offsetsForRange` below,
 * added the same day for the same reason.
 */
export function getSelectionContext(
  root: Element,
  range: Range,
  maxLen: number,
): { prefix: string; suffix: string } {
  const doc = root.ownerDocument;

  const beforeRange = doc.createRange();
  beforeRange.setStart(root, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = doc.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEnd(root, root.childNodes.length);

  return {
    prefix: beforeRange.toString().slice(-maxLen),
    suffix: afterRange.toString().slice(0, maxLen),
  };
}

/**
 * Inverse of the above: given a character offset range into `root`'s
 * flattened text (as found by the anchor-resolution text search), builds a
 * live Range over the actual text nodes so a fallback-resolved highlight can
 * be re-anchored to a fresh CFI.
 */
export function rangeFromTextOffsets(
  root: Element,
  start: number,
  end: number,
): Range | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let consumed = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;

  let node = walker.nextNode();
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (startNode === null && consumed + len >= start) {
      startNode = node;
      startOffset = start - consumed;
    }
    if (consumed + len >= end) {
      endNode = node;
      endOffset = end - consumed;
      break;
    }
    consumed += len;
    node = walker.nextNode();
  }

  if (!startNode || !endNode) return null;

  const range = root.ownerDocument.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

/**
 * Inverse of `rangeFromTextOffsets` in the other direction: given a live
 * Range within `root`, returns its start/end as character offsets into
 * `root`'s flattened text. `PdfRenderer` (M40 §D) needs this because it has
 * no CFI fast path — a selection's `Locator` is an offset range or nothing —
 * where `EpubRenderer` has never needed it (a selection there is anchored by
 * `contents.cfiFromRange()` instead, an epub.js primitive with no
 * format-neutral equivalent).
 */
export function offsetsForRange(root: Element, range: Range): { start: number; end: number } {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let consumed = 0;
  let start = 0;
  let end = 0;
  let node = walker.nextNode();
  while (node) {
    if (node === range.startContainer) start = consumed + range.startOffset;
    if (node === range.endContainer) {
      end = consumed + range.endOffset;
      break;
    }
    consumed += node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  return { start, end };
}
