/**
 * The book-wide page number and total: one map of pages-per-section, built
 * once per layout and then held still.
 *
 * ## What was wrong
 *
 * The first version of this recomputed everything on every relocate: sections
 * already visited contributed their measured page count, sections not yet
 * visited were estimated as `weight * (measuredPages / measuredWeight)`, and
 * that ratio was re-derived from scratch each time. So *every* new section
 * measurement moved *every* estimate — including the estimates for sections
 * behind the reader (front matter, chapters skipped past via the TOC), which
 * is what the current page number is offset by. Both numbers therefore moved
 * whenever a chapter boundary was crossed.
 *
 * Verified live, 2026-07-30, reading forward through Kafka on the Shore at a
 * device-scale factor of 1 (so with no page skip in play at all):
 *
 *     turn 11  Page 34 of 246
 *     turn 12  Page 36 of 255     PAGE_JUMP +2   TOTAL_MOVED +9
 *
 * — the operator's "52 -> 54, then when I go back to '52' it's counted as 53",
 * and their "total page count changes when entering a new chapter", from one
 * cause.
 *
 * ## What this does instead
 *
 * The map is calibrated once and then only ever refined in place:
 *
 * - Every section gets a page count at build time: its real measurement if we
 *   have one, otherwise `weight * pagesPerWeight` from the calibrating
 *   section. The sum is the book total, and the total is what we hold fixed.
 * - Measuring a section replaces its estimate with the real number, and the
 *   difference is absorbed by the sections *after* it that are still
 *   estimates. Nothing behind the reader ever moves, so a page number is
 *   stable across going back and forward, and consecutive turns are +1.
 * - When the remaining estimates cannot absorb the difference (near the end of
 *   the book, where there is little left to borrow from), the total moves by
 *   the leftover rather than lying. That is the one case where the operator
 *   can still see the total change, and it moves monotonically.
 *
 * The trade-off, taken deliberately: the total is only as good as its
 * calibration, and it no longer converges on the truth as the book is read.
 * The operator asked for "next always means +1" and a total that holds still
 * over a total that is eventually exact.
 */

export interface BookPageResult {
  page: number;
  total: number;
}

export interface BookPageMap {
  /** Pages per spine index under the current layout. */
  pages: Map<number, number>;
  /** Spine indices whose entry is a real measurement rather than an estimate. */
  measured: Set<number>;
  /** Spine indices in reading order — the order offsets are summed in. */
  order: number[];
  /** Book-wide total, held fixed as sections are measured. */
  total: number;
}

/**
 * The calibrating section must hold at least this share of the book's text and
 * must have measured at least MIN_CALIBRATION_PAGES pages. The weights are
 * `lengthPercent` from the Scan, which despite the name is a *fraction* of the
 * whole book (`text.length / totalLength`, summing to 1), so this is half a
 * percent. Both guards exist because a short section is a
 * bad estimator of pages-per-weight in the same direction: it is one page
 * whatever happens, floored by having any text at all, so calibrating from a
 * cover or a two-line interlude puts the ratio out by an order of magnitude and
 * fixes a nonsense total.
 *
 * The consequence, taken deliberately: opening a book *into* such a section
 * shows no book-wide page number for the turn or two before a real chapter is
 * reached (the percentage readout carries on regardless). That is quieter than
 * the alternative — showing a provisional number and then correcting it, which
 * is the jump this whole module exists to remove. In practice the reader's
 * position is restored into a chapter and the map is built on the first
 * relocate.
 */
const MIN_CALIBRATION_WEIGHT = 0.005;
const MIN_CALIBRATION_PAGES = 2;

function estimate(weight: number, pagesPerWeight: number): number {
  return Math.max(1, Math.round(weight * pagesPerWeight));
}

/**
 * Builds the map from one real measurement plus the per-section text weights
 * (`lengthPercent`, already computed server-side for the Scan). Returns null
 * when the measurement can't calibrate anything — no weights, or the measured
 * section has no weight of its own to divide by.
 */
export function buildBookPageMap(
  weightBySpineIndex: ReadonlyMap<number, number>,
  measuredIndex: number,
  measuredPages: number,
): BookPageMap | null {
  const measuredWeight = weightBySpineIndex.get(measuredIndex);
  if (!measuredWeight || measuredWeight < MIN_CALIBRATION_WEIGHT) return null;
  if (measuredPages < MIN_CALIBRATION_PAGES) return null;

  const pagesPerWeight = measuredPages / measuredWeight;
  const order = [...weightBySpineIndex.keys()].sort((a, b) => a - b);
  const pages = new Map<number, number>();
  let total = 0;
  for (const index of order) {
    const value =
      index === measuredIndex
        ? measuredPages
        : estimate(weightBySpineIndex.get(index) ?? 0, pagesPerWeight);
    pages.set(index, value);
    total += value;
  }

  return { pages, measured: new Set([measuredIndex]), order, total };
}

/**
 * Records a section's real page count. Returns the same map object mutated in
 * place — it is read on every relocate and rebuilt on every layout change, so
 * there is nothing to gain from copying it.
 */
export function recordMeasuredPages(
  map: BookPageMap,
  index: number,
  measuredPages: number,
): BookPageMap {
  if (measuredPages <= 0) return map;
  if (map.measured.has(index) && map.pages.get(index) === measuredPages) {
    return map;
  }

  const previous = map.pages.get(index) ?? measuredPages;
  map.pages.set(index, measuredPages);
  map.measured.add(index);

  let surplus = measuredPages - previous;
  if (surplus === 0) return map;

  // Absorb it into the estimates that are still ahead of this section: they
  // are numbers the reader has not been shown, so moving them costs nothing,
  // and it keeps the total — which the reader *is* looking at — still.
  const absorbers = map.order.filter(
    (i) => i > index && !map.measured.has(i),
  );
  const absorbable = absorbers.reduce(
    (sum, i) => sum + ((map.pages.get(i) ?? 1) - 1),
    0,
  );

  if (surplus > 0 && absorbable > 0) {
    // Take pages away, proportionally to how many each has spare.
    let taken = 0;
    const want = Math.min(surplus, absorbable);
    for (const i of absorbers) {
      const spare = (map.pages.get(i) ?? 1) - 1;
      if (spare <= 0) continue;
      const share = Math.min(
        spare,
        Math.round((want * spare) / absorbable),
        want - taken,
      );
      if (share <= 0) continue;
      map.pages.set(i, (map.pages.get(i) ?? 1) - share);
      taken += share;
    }
    // Rounding can leave a page or two behind; hand them to whoever has spare.
    for (const i of absorbers) {
      if (taken >= want) break;
      const spare = (map.pages.get(i) ?? 1) - 1;
      if (spare <= 0) continue;
      const share = Math.min(spare, want - taken);
      map.pages.set(i, (map.pages.get(i) ?? 1) - share);
      taken += share;
    }
    surplus -= taken;
  } else if (surplus < 0 && absorbers.length > 0) {
    // Give pages back — no floor to respect in this direction, so the largest
    // remaining estimate takes them and the total holds exactly.
    const biggest = absorbers.reduce((best, i) =>
      (map.pages.get(i) ?? 1) > (map.pages.get(best) ?? 1) ? i : best,
    );
    map.pages.set(biggest, (map.pages.get(biggest) ?? 1) - surplus);
    surplus = 0;
  }

  // Whatever could not be absorbed is a real change to the length of the book.
  map.total += surplus;
  return map;
}

/**
 * The book-wide page number for a position: every preceding section's pages,
 * plus the page within this one. Null when this section isn't in the map at
 * all — e.g. a non-linear spine item the Scan's text extraction skipped.
 */
export function lookupBookPage(
  map: BookPageMap,
  index: number,
  chapterPage: number,
): BookPageResult | null {
  let offset = 0;
  let found = false;
  for (const i of map.order) {
    if (i === index) {
      found = true;
      break;
    }
    offset += map.pages.get(i) ?? 1;
  }
  if (!found) return null;
  const page = offset + chapterPage;
  return { page, total: Math.max(map.total, page) };
}
