import { EpubCFI } from "epubjs";
import type { Book } from "epubjs";
import type { NavItem } from "epubjs";

export interface TocEntry {
  label: string;
  href: string;
  spineIndex: number | null;
  /** Whole-book percent (0-100) the chapter starts at, or null if it
   * couldn't be resolved (e.g. locations not generated yet). */
  percent: number | null;
  depth: number;
}

function flattenNavItems(items: NavItem[], depth: number): { item: NavItem; depth: number }[] {
  const out: { item: NavItem; depth: number }[] = [];
  for (const item of items) {
    out.push({ item, depth });
    if (item.subitems && item.subitems.length > 0) {
      out.push(...flattenNavItems(item.subitems, depth + 1));
    }
  }
  return out;
}

/**
 * Earliest whole-book percent (per the same `book.locations` the reader's
 * own progress % is computed from — so chapter ticks line up with the
 * position indicator instead of using a different, only-approximate scale)
 * at which each spine index appears, derived by parsing the spine position
 * back out of every generated location's CFI (`EpubCFI(cfi).spinePos`).
 * SPEC-GAP: epub.js exposes no direct "percent at start of spine item N" —
 * this is the boring way to derive one from primitives it does expose.
 */
function chapterStartPercentsBySpineIndex(book: Book): Map<number, number> {
  const bySpine = new Map<number, number>();
  const total = book.locations.length();
  for (let i = 0; i < total; i++) {
    const cfi = book.locations.cfiFromLocation(i);
    const spineIndex = new EpubCFI(cfi).spinePos;
    if (spineIndex < 0) continue;
    const percent = book.locations.percentageFromLocation(i) * 100;
    const existing = bySpine.get(spineIndex);
    if (existing === undefined || percent < existing) {
      bySpine.set(spineIndex, percent);
    }
  }
  return bySpine;
}

/** Flattened (with indent depth) table of contents, each entry resolved to
 * a spine index and a whole-book percent. Entries whose href doesn't match
 * any spine item are dropped (can't be jumped to or plotted). Requires
 * `book.locations.generate()` to have already resolved for `percent` to be
 * populated — spineIndex still resolves without it. */
export function buildToc(book: Book): TocEntry[] {
  const chapterPercents = chapterStartPercentsBySpineIndex(book);
  return flattenNavItems(book.navigation.toc, 0)
    .map(({ item, depth }) => {
      const section = book.spine.get(item.href);
      const spineIndex = section ? section.index : null;
      const percent = spineIndex !== null ? (chapterPercents.get(spineIndex) ?? null) : null;
      return { label: item.label.trim(), href: item.href, spineIndex, percent, depth };
    })
    .filter((entry): entry is TocEntry => entry.spineIndex !== null);
}

/** TOC entries deduped to one per spine index (first occurrence), sorted —
 * the stepping sequence for prev/next chapter, distinct from the full
 * (possibly sub-heading-heavy) list the TOC popover browses. */
export function chapterStops(toc: TocEntry[]): TocEntry[] {
  const seen = new Set<number>();
  const stops: TocEntry[] = [];
  for (const entry of [...toc].sort((a, b) => (a.spineIndex ?? 0) - (b.spineIndex ?? 0))) {
    if (entry.spineIndex === null || seen.has(entry.spineIndex)) continue;
    seen.add(entry.spineIndex);
    stops.push(entry);
  }
  return stops;
}

/** The toc entry governing `spineIndex` right now — the last stop at or
 * before it, per the deduped chapter-stops sequence. */
export function currentChapter(stops: TocEntry[], spineIndex: number | null): TocEntry | null {
  if (spineIndex === null) return null;
  let current: TocEntry | null = null;
  for (const stop of stops) {
    if (stop.spineIndex !== null && stop.spineIndex <= spineIndex) current = stop;
    else break;
  }
  return current;
}

/** The chapter-boundary tick immediately at-or-before a given percent — for
 * the scrub dial's live "chapter name" preview while dragging. */
export function chapterAtPercent(stops: TocEntry[], percent: number): TocEntry | null {
  let current: TocEntry | null = null;
  for (const stop of stops) {
    if (stop.percent !== null && stop.percent <= percent) current = stop;
    else break;
  }
  return current ?? stops[0] ?? null;
}
