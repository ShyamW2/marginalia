/**
 * Extracts up to `maxLen` characters of text immediately before and after a
 * Range, using the browser's own Range.toString() text-flattening so the
 * result matches exactly what a later textContent-based search would see
 * (no manual whitespace-normalization heuristics needed).
 */
export function getSelectionContext(
  doc: Document,
  range: Range,
  maxLen: number,
): { prefix: string; suffix: string } {
  const body = doc.body;

  const beforeRange = doc.createRange();
  beforeRange.setStart(body, 0);
  beforeRange.setEnd(range.startContainer, range.startOffset);

  const afterRange = doc.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.setEnd(body, body.childNodes.length);

  return {
    prefix: beforeRange.toString().slice(-maxLen),
    suffix: afterRange.toString().slice(0, maxLen),
  };
}

/**
 * Inverse of the above: given a character offset range into `doc.body`'s
 * flattened text (as found by the anchor-resolution text search), builds a
 * live Range over the actual text nodes so a fallback-resolved highlight can
 * be re-anchored to a fresh CFI.
 */
export function rangeFromTextOffsets(
  doc: Document,
  start: number,
  end: number,
): Range | null {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);

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

  const range = doc.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}
