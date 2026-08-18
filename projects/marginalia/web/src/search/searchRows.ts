import type { PageNumberMode, SearchHit } from "@marginalia/shared";
import { searchHitSourceLabel } from "./findCursor.js";

/**
 * The result card's rows (TASKS.md M24.1 D). Pure display derivation: every
 * number a row shows is read from something that already exists — the hit's
 * own `percent`, the reader footer's page map (bookPages.ts), the TOC — and
 * nothing here re-locates, re-orders or re-counts anything. `index` is the
 * hit's place in the *one* ordered result set (decisions.md 2026-08-14), so
 * a row click and a `‹ ›` step to the same number are the same act.
 */
export interface SearchResultRow {
  index: number;
  /** The ±5-word window around the match, split so the match itself can be
   * marked without the row re-searching the text a second time. */
  before: string;
  match: string;
  after: string;
  source: string;
  chapter: string | null;
  page: string | null;
  percent: string;
}

/** ±5 words, per the task. */
export const SNIPPET_WORDS = 5;

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.length > 0);
}

/**
 * The occurrence of `query` nearest the middle of `snippet` — the server
 * builds a snippet by taking ±80 characters *around the match* (search.ts
 * `snippetAround`), so the central occurrence is the one the hit is about
 * whenever the query happens to appear more than once inside the window.
 */
function centralOccurrence(snippet: string, query: string): number {
  const haystack = snippet.toLowerCase();
  const needle = query.toLowerCase();
  if (needle.length === 0) return -1;
  const middle = (snippet.length - needle.length) / 2;
  let best = -1;
  for (let from = 0; ; ) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    if (best === -1 || Math.abs(at - middle) < Math.abs(best - middle)) best = at;
    from = at + needle.length;
  }
  return best;
}

export interface SnippetWindow {
  before: string;
  match: string;
  after: string;
}

/**
 * A hit's snippet cut down to `words` words either side of the match.
 *
 * Words are re-joined with single spaces (a row is one line of chrome, not a
 * reproduction of the book's own spacing), but the gap *immediately* beside
 * the match is preserved as-is — otherwise a match followed by punctuation
 * renders as "roof , and" instead of "roof, and".
 *
 * A snippet the query can't be found in is not an error: an annotation hit's
 * snippet is the note or thread message the query matched in, and the query
 * may have been normalized away (or the snippet may be the highlight's own
 * quote). Those show their opening words with no marked match rather than
 * showing nothing.
 */
export function snippetWindow(snippet: string, query: string, words = SNIPPET_WORDS): SnippetWindow {
  const base = snippet.replace(/^…\s*/, "").replace(/\s*…$/, "");
  const at = centralOccurrence(base, query);
  if (at === -1) {
    const all = splitWords(base);
    const head = all.slice(0, words * 2);
    return {
      before: "",
      match: "",
      after: head.join(" ") + (all.length > head.length ? " …" : ""),
    };
  }

  const rawBefore = base.slice(0, at);
  const rawAfter = base.slice(at + query.length);
  const beforeWords = splitWords(rawBefore);
  const afterWords = splitWords(rawAfter);
  const beforeKept = beforeWords.slice(-words);
  const afterKept = afterWords.slice(0, words);

  const gapBefore = /\s$/.test(rawBefore) ? " " : "";
  const gapAfter = /^\s/.test(rawAfter) ? " " : "";
  const leadingEllipsis = beforeWords.length > beforeKept.length ? "… " : "";
  const trailingEllipsis = afterWords.length > afterKept.length ? " …" : "";

  return {
    before: leadingEllipsis + beforeKept.join(" ") + (beforeKept.length > 0 ? gapBefore : ""),
    match: base.slice(at, at + query.length),
    after: (afterKept.length > 0 ? gapAfter : "") + afterKept.join(" ") + trailingEllipsis,
  };
}

/**
 * Which page of its own section a hit falls on, from the fraction of the
 * section that precedes it. The fraction comes from the two numbers the hit
 * and the Scan already carry — the hit's whole-book `percent` and the
 * section's own span of the book — so this needs no second position model.
 * Null whenever the page map hasn't calibrated that section yet, which is
 * the same "no page number rather than a provisional one" the footer itself
 * takes (bookPages.ts).
 */
export function chapterPageForHit(
  percent: number,
  span: { start: number; weight: number } | null,
  pagesInSection: number | null,
): number | null {
  if (!span || span.weight <= 0 || !pagesInSection || pagesInSection <= 0) return null;
  const fraction = Math.min(1, Math.max(0, (percent - span.start) / span.weight));
  // The epsilon is not precision theatre: `percent` and `span` are both
  // quotients, so a hit sitting exactly on a page boundary lands a whisker
  // either side of it depending on the arithmetic, and `floor` turns that
  // whisker into a whole page. Absorbing it makes the boundary case land on
  // the later page every time instead of at random.
  return Math.min(pagesInSection, Math.floor(fraction * pagesInSection + 1e-9) + 1);
}

/**
 * "Page numbering follows the setting" (TASKS.md M24.1 D) — the same
 * `pageNumberMode` the reader footer reads, read once by the reader and
 * passed in here, never re-derived. Compact ("p. 34") rather than the
 * footer's own "Page 34 of 246": a row is a list entry beside a chapter and
 * a percent, and the total is already on screen in the footer.
 */
export function formatHitPage(
  mode: PageNumberMode,
  bookPage: number | null,
  chapterPage: number | null,
): string | null {
  if (mode === "off") return null;
  const page = mode === "book" ? bookPage : chapterPage;
  return page === null ? null : `p. ${page}`;
}

export interface SectionSpan {
  /** Fraction of the book before this section starts. */
  start: number;
  /** Fraction of the book this section holds. */
  weight: number;
}

/**
 * Section weights (the Scan's `lengthPercent`, a fraction of the whole book
 * despite the name) turned into a start-and-length span per section, by
 * accumulating them in spine order. The same numbers bookPages.ts estimates
 * from — one weight set, two uses, not a second position model.
 */
export function buildSectionSpans(
  weights: ReadonlyMap<number, number>,
): Map<number, SectionSpan> {
  const spans = new Map<number, SectionSpan>();
  let start = 0;
  for (const spineIndex of [...weights.keys()].sort((a, b) => a - b)) {
    const weight = weights.get(spineIndex) ?? 0;
    spans.set(spineIndex, { start, weight });
    start += weight;
  }
  return spans;
}

export interface SearchRowContext {
  query: string;
  pageNumberMode: PageNumberMode;
  /** The TOC chapter governing a section (toc.ts `currentChapter`). */
  chapterLabelFor: (spineIndex: number) => string | null;
  /** Pages in a section under the current layout, per the reader's own page
   * map — an estimate for sections not yet visited, exactly as the footer's
   * own total is. */
  pagesInSection: (spineIndex: number) => number | null;
  /** The book-wide page for a (section, page-within-section) pair —
   * bookPages.ts `lookupBookPage`, not a second sum. */
  bookPageFor: (spineIndex: number, chapterPage: number) => number | null;
  /** Where a section starts, and how much of the book it holds, as fractions
   * of the whole (the Scan's `lengthPercent` weights, which despite the name
   * sum to 1). */
  sectionSpan: (spineIndex: number) => { start: number; weight: number } | null;
}

export function buildSearchResultRows(
  hits: SearchHit[],
  context: SearchRowContext,
): SearchResultRow[] {
  return hits.map((hit, index) => {
    const chapterPage = chapterPageForHit(
      hit.percent,
      context.sectionSpan(hit.spineIndex),
      context.pagesInSection(hit.spineIndex),
    );
    const bookPage = chapterPage === null ? null : context.bookPageFor(hit.spineIndex, chapterPage);
    return {
      index,
      ...snippetWindow(hit.snippet, context.query),
      source: searchHitSourceLabel(hit.source),
      chapter: context.chapterLabelFor(hit.spineIndex),
      page: formatHitPage(context.pageNumberMode, bookPage, chapterPage),
      percent: `${Math.round(hit.percent * 100)}%`,
    };
  });
}
