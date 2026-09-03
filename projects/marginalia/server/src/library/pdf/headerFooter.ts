import type { RawTextItem } from "./types.js";

export interface PageItems {
  pageIndex: number;
  width: number;
  height: number;
  items: RawTextItem[];
}

const BAND_FRACTION = 0.07;
const MIN_REPEAT_PAGES = 3;

/** Digit-stripped, trimmed, collapsed-whitespace form used to compare band
 *  text across pages — so "Page 12" and "Page 47" normalise together. */
function normalize(text: string): string {
  return text
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inBand(item: RawTextItem, pageHeight: number): boolean {
  const top = item.y >= pageHeight * (1 - BAND_FRACTION);
  const bottom = item.y <= pageHeight * BAND_FRACTION;
  return top || bottom;
}

/**
 * PDF.md §3.1: drop an item only when it is both in the top/bottom ~7% band
 * AND its (digit-stripped) text repeats on 3+ pages. Position alone would
 * eat a paper's title and its first heading on page 1.
 */
export function stripRunningHeadersFooters(pages: PageItems[]): PageItems[] {
  const pagesByNormalizedText = new Map<string, Set<number>>();

  for (const page of pages) {
    for (const item of page.items) {
      if (!inBand(item, page.height)) continue;
      const key = normalize(item.text);
      if (!key) continue;
      let pageSet = pagesByNormalizedText.get(key);
      if (!pageSet) {
        pageSet = new Set();
        pagesByNormalizedText.set(key, pageSet);
      }
      pageSet.add(page.pageIndex);
    }
  }

  const repeated = new Set(
    [...pagesByNormalizedText.entries()]
      .filter(([, pageSet]) => pageSet.size >= MIN_REPEAT_PAGES)
      .map(([key]) => key),
  );

  return pages.map((page) => ({
    ...page,
    items: page.items.filter((item) => {
      if (!inBand(item, page.height)) return true;
      return !repeated.has(normalize(item.text));
    }),
  }));
}
