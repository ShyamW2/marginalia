import { Highlight } from "marks-pane";

/**
 * M24.1 B: marks-pane 1.0.9's `Highlight.filteredRanges()` builds rects from
 * `this.range.getClientRects()`, and per CSSOM that set includes the border
 * box of every element *fully contained* in the range — so a range spanning
 * whole `<p>`s gets one full-column slab per paragraph alongside the line
 * boxes. The library's own dedup (`contains()`) keeps whichever rect comes
 * first in browser iteration order, which in practice is the slab, not the
 * tight lines — hence "an additional block highlight over the dialogue"
 * (TASKS.md M24.1 B).
 *
 * Fix: build rects from per-text-node subranges instead of the range as a
 * whole. A Range confined to a single text node never contains a whole
 * element, so `getClientRects()` on it can only ever return line-box
 * fragments — the slab-producing case structurally can't occur.
 *
 * Patched on the shared `marks-pane` module's own prototype (not a local
 * copy) so it takes effect for marks epub.js creates internally through its
 * own `require("marks-pane")` — pnpm dedupes the package to one file on
 * disk (confirmed: `epubjs`'s nested copy and this package's copy are the
 * same `.pnpm/marks-pane@1.0.9` entry), and Vite resolves symlinks to their
 * real path by default, so both import paths land on this one prototype.
 * Verified live: the same annotation that used to paint a slab now paints
 * line boxes only, with no code changes on epub.js's or this app's own
 * annotation call sites.
 */
function textNodeSubranges(range: Range): Range[] {
  const root = range.commonAncestorContainer;
  const doc = (root.nodeType === Node.DOCUMENT_NODE ? root : root.ownerDocument) as Document;
  if (!doc) return [range.cloneRange()];

  // A range that never leaves a single text node has no element to walk into.
  if (root.nodeType === Node.TEXT_NODE) return [range.cloneRange()];

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const subranges: Range[] = [];
  let node = walker.nextNode();
  while (node) {
    if (range.intersectsNode(node)) {
      const sub = doc.createRange();
      sub.selectNodeContents(node);
      if (node === range.startContainer) sub.setStart(node, range.startOffset);
      if (node === range.endContainer) sub.setEnd(node, range.endOffset);
      if (!sub.collapsed) subranges.push(sub);
    }
    node = walker.nextNode();
  }
  return subranges;
}

// Same de-dup marks-pane's own filteredRanges used, kept as a defensive
// second pass — text-node subranges shouldn't produce nested boxes, but
// this costs nothing if a browser quirk ever does.
function contains(outer: DOMRect, inner: DOMRect): boolean {
  return (
    inner.right <= outer.right &&
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  );
}

Highlight.prototype.filteredRanges = function (this: { range: Range }): DOMRect[] {
  const rects = textNodeSubranges(this.range).flatMap((sub) => Array.from(sub.getClientRects()));
  return rects.filter((box) => {
    for (const other of rects) {
      if (other === box) return true;
      if (contains(other, box)) return false;
    }
    return true;
  });
};
