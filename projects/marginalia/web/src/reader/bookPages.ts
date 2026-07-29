/**
 * M19.6 operator feedback (decisions.md 2026-07-30 later, amending the
 * original "page numbers, book-wide and stable" entry): a book-wide page
 * count that increments by exactly 1 on every `turnPage()` call, and a
 * percentage derived from that same count (Apple-Books style) — replacing
 * the character-location-based "book" mode, whose count could jump by
 * several pages per turn because a rendered page's character span isn't
 * constant. The operator explicitly prefers "next always means +1" over
 * "the number is perfectly layout-stable", and accepted that the total may
 * shift as more of the book is visited.
 *
 * Sections already visited **under the current layout** contribute their
 * real, spread-adjusted page count (epub.js's own `displayed.total`, via
 * toSpreadAdjustedTotal below). Sections not yet visited are estimated from
 * their share of the book's text — `lengthPercent`, already computed
 * server-side for the Scan (annotations/scan.ts) — calibrated by a
 * pages-per-weight-unit ratio derived from whatever has actually been
 * measured so far. The estimate self-corrects as the reader progresses.
 */

export interface BookPageResult {
  page: number;
  total: number;
}

export function computeBookPageInfo(
  weightBySpineIndex: ReadonlyMap<number, number>,
  realPagesBySpineIndex: ReadonlyMap<number, number>,
  currentSpineIndex: number,
  currentChapterPage: number,
): BookPageResult | null {
  if (weightBySpineIndex.size === 0) return null;

  let knownPages = 0;
  let knownWeight = 0;
  for (const [index, pages] of realPagesBySpineIndex) {
    const weight = weightBySpineIndex.get(index);
    if (weight === undefined) continue;
    knownPages += pages;
    knownWeight += weight;
  }
  const pagesPerWeight = knownWeight > 0 ? knownPages / knownWeight : null;

  const orderedIndices = [...weightBySpineIndex.keys()].sort((a, b) => a - b);
  let cumulative = 0;
  let offsetBeforeCurrent: number | null = null;

  for (const index of orderedIndices) {
    if (index === currentSpineIndex) offsetBeforeCurrent = cumulative;
    const weight = weightBySpineIndex.get(index) ?? 0;
    const sectionPages =
      realPagesBySpineIndex.get(index) ??
      (pagesPerWeight !== null ? Math.max(1, Math.round(weight * pagesPerWeight)) : 1);
    cumulative += sectionPages;
  }

  // The current section isn't in the weight map — e.g. a non-linear spine
  // item the Scan's text extraction skipped. Nothing sane to offset from.
  if (offsetBeforeCurrent === null) return null;

  return { page: offsetBeforeCurrent + currentChapterPage, total: cumulative };
}

/**
 * epub.js's own per-section `displayed.page`/`displayed.total` are single-
 * *column* indices — `layout.count()` reports `pages = spreads * divisor`,
 * so a two-page spread's total is always twice the number of real page-
 * views (see epub.js's `layout.js`/`managers/default/index.js`). Reading
 * the manager's own `divisor` (2 whenever a spread is actually showing, 1
 * otherwise) converts back to "one spread = one page", which is also what
 * fixes the display reaching e.g. "page 7 of 8" one page early — the true
 * last spread already reports `displayed.page === displayed.total - 1`
 * (an odd column index against an always-even total) by construction, not
 * because a page was skipped.
 */
export function getSpreadDivisor(rendition: unknown): number {
  const manager = (rendition as { manager?: { layout?: { divisor?: number } } } | undefined)
    ?.manager;
  const divisor = manager?.layout?.divisor;
  return divisor && divisor > 0 ? divisor : 1;
}

export function toSpreadAdjustedPage(rawPage: number, divisor: number): number {
  return Math.ceil(rawPage / divisor);
}

export function toSpreadAdjustedTotal(rawTotal: number, divisor: number): number {
  return Math.max(1, Math.round(rawTotal / divisor));
}
