import type { PdfBlock, PdfOutlineEntry, PdfPageContent } from "./types.js";
import { blocksToText } from "./lines.js";

const SINGLE_SECTION_PAGE_LIMIT = 40;
const FIXED_GROUP_SIZE = 10;
const HEADING_FONT_RATIO = 1.15;
const HEADING_MAX_CHARS = 120;

const SECTION_NAME_LINE =
  /^\s*(?:[\dIVXLC]+\.?\d*\.?\s+)?(Abstract|Introduction|Related Work|Methods?|Results|Discussion|Conclusions?|References|Appendix)\s*:?\s*$/i;

export interface PdfSection {
  spineIndex: number;
  href: string;
  title: string;
  text: string;
  blocks: PdfBlock[];
}

interface SectionBoundary {
  pageIndex: number;
  /** Index into that page's `blocks` — where this section begins. */
  blockIndex: number;
  title: string | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** The document's modal (most common) body font size, across every line on
 *  every page — headings are detected relative to this. */
function modalBodyFontSize(pages: PdfPageContent[]): number {
  const sizes: number[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.kind === "line") sizes.push(Math.round(block.line.fontSize));
    }
  }
  if (sizes.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const size of sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
  let modal = sizes[0];
  let modalCount = -1;
  for (const [size, count] of counts) {
    if (count > modalCount) {
      modalCount = count;
      modal = size;
    }
  }
  return modal;
}

function isHeadingLine(text: string, fontSize: number, bodySize: number): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (fontSize >= bodySize * HEADING_FONT_RATIO && trimmed.length < HEADING_MAX_CHARS) return true;
  // Secondary signal only, never sufficient alone (PDF.md §4): a line that
  // both looks like a section name AND is short AND is at least body-sized
  // (so a body-sized sentence merely mentioning "the introduction" doesn't
  // qualify — this still requires two independent signals to fire).
  return fontSize >= bodySize && trimmed.length < 60 && SECTION_NAME_LINE.test(trimmed);
}

/** Rung 2: a line is a heading when its font size exceeds the document's
 *  modal body size by ≥15% and it is under ~120 characters (PDF.md §4).
 *  A long title commonly wraps across several lines, and every one of
 *  those wrapped lines independently qualifies — found live generating an
 *  EPUB from the M39 §A8 gate's own two-column fixture, where a two-line
 *  title produced two one-line "sections" instead of one. A run of
 *  consecutive heading-qualifying lines is coalesced into a single
 *  boundary, its title the run's lines joined with a space. */
function detectHeadingBoundaries(pages: PdfPageContent[]): SectionBoundary[] {
  const bodySize = modalBodyFontSize(pages);
  const boundaries: SectionBoundary[] = [];
  for (const page of pages) {
    let i = 0;
    while (i < page.blocks.length) {
      const block = page.blocks[i];
      if (block.kind !== "line" || !isHeadingLine(block.line.text, block.line.fontSize, bodySize)) {
        i++;
        continue;
      }
      const titleParts = [block.line.text.trim()];
      let j = i + 1;
      while (j < page.blocks.length) {
        const next = page.blocks[j];
        if (next.kind !== "line" || !isHeadingLine(next.line.text, next.line.fontSize, bodySize)) break;
        titleParts.push(next.line.text.trim());
        j++;
      }
      boundaries.push({ pageIndex: page.pageIndex, blockIndex: i, title: titleParts.join(" ") });
      i = j;
    }
  }
  return boundaries;
}

/** Rung 1: resolves each outline entry to a page + block index. ⚠️ Outline
 *  destinations are page-anchored; a section beginning one-third down a
 *  page must split that page's text at the heading, not round to the page
 *  boundary (PDF.md §4 ⚠️) — so when the entry has a resolvable y, this
 *  finds the first line at or below it rather than defaulting to block 0.
 *  An entry with no resolvable y (e.g. a `/Fit` destination — see NOTES.md
 *  "M39 §A", bug 2) rounds to the page boundary as an honest degradation:
 *  there is nothing else to split on. */
function resolveOutlineBoundaries(pages: PdfPageContent[], outline: PdfOutlineEntry[]): SectionBoundary[] {
  const pageByIndex = new Map(pages.map((p) => [p.pageIndex, p]));
  const boundaries: SectionBoundary[] = [];

  for (const entry of outline) {
    if (entry.pageIndex === null) continue;
    const page = pageByIndex.get(entry.pageIndex);
    if (!page) continue;

    let blockIndex = 0;
    if (entry.y !== null) {
      const found = page.blocks.findIndex((b) => b.kind === "line" && b.line.y <= (entry.y as number));
      if (found >= 0) blockIndex = found;
    }
    boundaries.push({ pageIndex: entry.pageIndex, blockIndex, title: entry.title.trim() || null });
  }
  return boundaries;
}

function dedupeAndSort(boundaries: SectionBoundary[]): SectionBoundary[] {
  const sorted = [...boundaries].sort((a, b) => a.pageIndex - b.pageIndex || a.blockIndex - b.blockIndex);
  const deduped: SectionBoundary[] = [];
  for (const b of sorted) {
    const last = deduped[deduped.length - 1];
    if (last && last.pageIndex === b.pageIndex && last.blockIndex === b.blockIndex) continue;
    deduped.push(b);
  }
  return deduped;
}

/** PDF.md §4's fallback ladder: outline → detected headings → one section
 *  under 40 pages → fixed 10-page groups otherwise. Always returns at
 *  least one boundary at the document's very start, so no leading content
 *  (front matter before the first heading/outline entry) is ever dropped. */
function detectBoundaries(pages: PdfPageContent[], outline: PdfOutlineEntry[]): SectionBoundary[] {
  if (pages.length === 0) return [];

  let boundaries: SectionBoundary[];
  const outlineBoundaries = resolveOutlineBoundaries(pages, outline);
  if (outlineBoundaries.length > 0) {
    boundaries = outlineBoundaries;
  } else {
    const headingBoundaries = detectHeadingBoundaries(pages);
    if (headingBoundaries.length > 0) {
      boundaries = headingBoundaries;
    } else if (pages.length < SINGLE_SECTION_PAGE_LIMIT) {
      return [{ pageIndex: pages[0].pageIndex, blockIndex: 0, title: null }];
    } else {
      boundaries = [];
      for (let start = 0; start < pages.length; start += FIXED_GROUP_SIZE) {
        const end = Math.min(start + FIXED_GROUP_SIZE, pages.length) - 1;
        const label = start === end ? `Page ${start + 1}` : `Pages ${start + 1}–${end + 1}`;
        boundaries.push({ pageIndex: pages[start].pageIndex, blockIndex: 0, title: label });
      }
      return dedupeAndSort(boundaries);
    }
  }

  const deduped = dedupeAndSort(boundaries);
  const first = deduped[0];
  if (!first || first.pageIndex !== pages[0].pageIndex || first.blockIndex !== 0) {
    deduped.unshift({ pageIndex: pages[0].pageIndex, blockIndex: 0, title: null });
  }
  return deduped;
}

/** Slices a `boundary..nextBoundary` span of blocks out of `pages`, which
 *  may cross page boundaries. */
function blocksInRange(
  pages: PdfPageContent[],
  start: SectionBoundary,
  end: SectionBoundary | undefined,
): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  for (const page of pages) {
    if (page.pageIndex < start.pageIndex) continue;
    if (end && page.pageIndex > end.pageIndex) break;

    const from = page.pageIndex === start.pageIndex ? start.blockIndex : 0;
    const to = end && page.pageIndex === end.pageIndex ? end.blockIndex : page.blocks.length;
    blocks.push(...page.blocks.slice(from, to));
  }
  return blocks;
}

function padIndex(n: number): string {
  return String(n).padStart(3, "0");
}

/** Turns the page-level extraction into the document's spine: one
 *  `PdfSection` per detected boundary, each with its own href
 *  (`section-000.xhtml`, …) and assembled text. The spine unit is a
 *  section, never a page (PDF.md §4 — the single most consequential
 *  extraction decision in this arc). */
export function buildSections(pages: PdfPageContent[], outline: PdfOutlineEntry[]): PdfSection[] {
  const boundaries = detectBoundaries(pages, outline);
  return boundaries.map((boundary, index) => {
    const blocks = blocksInRange(pages, boundary, boundaries[index + 1]);
    return {
      spineIndex: index,
      href: `section-${padIndex(index)}.xhtml`,
      title: boundary.title ?? `Section ${index + 1}`,
      text: blocksToText(blocks),
      blocks,
    };
  });
}
