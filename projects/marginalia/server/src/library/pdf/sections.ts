import type { PdfBlock, PdfOutlineEntry, PdfPageContent } from "./types.js";
import { blocksToText } from "./lines.js";

const SINGLE_SECTION_PAGE_LIMIT = 40;
const FIXED_GROUP_SIZE = 10;
const HEADING_FONT_RATIO = 1.15;
const HEADING_MAX_CHARS = 120;
// M42 §A1: a title reasonably wraps 2–3 lines, not thirty — caps
// `detectHeadingBoundaries`'s consecutive-heading-line coalescing so a page
// whose entire body legitimately clears the heading threshold (see
// `PAGE_LOCAL_BODY_SIZE_MIN_LINES` below) can't be swallowed into one run-on
// title (NOTES.md "M39 — the real gate, finally", root cause 1).
const HEADING_RUN_MAX_LINES = 3;
// M42 §A1: below this many lines, a page's own font-size sample is too small
// to trust as its local body size (a title-only page would "confirm" its own
// heading as the body) — fall back to the document-wide modal instead.
const PAGE_LOCAL_BODY_SIZE_MIN_LINES = 5;

const SECTION_NAME_LINE =
  /^\s*(?:[\dIVXLC]+\.?\d*\.?\s+)?(Abstract|Introduction|Related Work|Methods?|Results|Discussion|Conclusions?|References|Appendix)\s*:?\s*$/i;

/** M42 §C4: a depth-2+ heading that stays inline in its parent chapter's
 *  text rather than starting a new spine section — still independently
 *  reachable from the chapter picker, via an in-section jump target rather
 *  than a spine index (PDF.md §4 amended). `offset` is a character offset
 *  into this section's own canonical `text` (decision 11: a `Locator`
 *  offset computed by locating text, not a number the model or the PDF's
 *  own destinations handed back), where this heading's own line begins —
 *  honest, not byte-exact (it skips the paragraph-join separator, not
 *  hand-verified against the source PDF's own layout). */
export interface PdfSubheading {
  title: string;
  depth: number;
  offset: number;
}

export interface PdfSection {
  spineIndex: number;
  href: string;
  title: string;
  text: string;
  blocks: PdfBlock[];
  subheadings: PdfSubheading[];
}

const GENERIC_SECTION_TITLE = /^(Section \d+|Pages? \d+(–\d+)?)$/;

/** M42 §A3: the "first detected heading/section title" a placeholder or
 *  absent PDF metadata title falls back to — never one of `buildSections`'
 *  own synthesized placeholders (`Section N`, `Page(s) N…`, from a
 *  boundary with no real title), which carry no information about the
 *  document itself. */
export function firstMeaningfulSectionTitle(sections: PdfSection[]): string | null {
  const first = sections[0];
  if (!first || GENERIC_SECTION_TITLE.test(first.title)) return null;
  return first.title;
}

interface SectionBoundary {
  pageIndex: number;
  /** Index into that page's `blocks` — where this section begins. */
  blockIndex: number;
  title: string | null;
  /** M42 §C1/§C2: 1-indexed, matching `PdfOutlineEntry.depth`. Only a
   *  depth-1 boundary starts a new `PdfSection`; deeper ones become inline
   *  subheadings of whichever depth-1 section is open when they occur. */
  depth: number;
}

/** M42 §C2: for the detected-headings fallback (no real outline), depth
 *  comes from the heading text's own numbering — `1` is depth 1, `1.1`
 *  depth 2, `1.2.1` depth 3, and so on. An unnumbered heading (a paper's
 *  bare "Abstract"/"Conclusion") stays depth 1, ungrouped — same as before
 *  this existed. */
const NUMBERING_DEPTH = /^(\d+(?:\.\d+)*)\.?\s/;
function depthFromNumbering(title: string): number {
  const match = NUMBERING_DEPTH.exec(title.trim());
  return match ? match[1].split(".").length : 1;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function lineFontSizes(pages: PdfPageContent[]): number[] {
  const sizes: number[] = [];
  for (const page of pages) {
    for (const block of page.blocks) {
      if (block.kind === "line") sizes.push(Math.round(block.line.fontSize));
    }
  }
  return sizes;
}

function modalOf(sizes: number[]): number {
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

/** The document's modal (most common) body font size, across every line on
 *  every page — the fallback used for a page too short to trust its own
 *  local estimate (see `pageBodyFontSize`). */
function modalBodyFontSize(pages: PdfPageContent[]): number {
  return modalOf(lineFontSizes(pages));
}

/** M42 §A1: a real document can legitimately have more than one body size
 *  across different page types (dense prose vs. a bulleted/tabular page) —
 *  confirmed live (NOTES.md "M39 — the real gate, finally", root cause 1),
 *  where a page set entirely in 12pt/18pt against a 9pt document-wide modal
 *  had every one of its ~30 lines misread as heading-qualifying. Judging a
 *  page's headings against *its own* modal size, not the whole document's,
 *  fixes that at the source — but only once the page carries enough lines
 *  to make that estimate meaningful; a short/title-only page falls back to
 *  the document-wide size instead of "confirming" its own heading as body. */
function pageBodyFontSize(page: PdfPageContent, documentBodySize: number): number {
  const sizes = lineFontSizes([page]);
  if (sizes.length < PAGE_LOCAL_BODY_SIZE_MIN_LINES) return documentBodySize;
  return modalOf(sizes);
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

/** M42 §B3: a figure/table/equation caption is real, larger-than-body text
 *  by design (§3.5) — it must never be misread as a section heading of its
 *  own (a "bare caption-only section"). A caption line always sits directly
 *  beside the raster block it captions in `buildPageBlocks`' output, so
 *  that adjacency — not a second guess at what a caption looks like — is
 *  the check. */
function isCaptionLine(blocks: PdfBlock[], index: number): boolean {
  const prev = blocks[index - 1];
  const next = blocks[index + 1];
  return (prev?.kind === "figure" || prev?.kind === "table") || (next?.kind === "figure" || next?.kind === "table");
}

/** Rung 2: a line is a heading when its font size exceeds its page's own
 *  modal body size by ≥15% and it is under ~120 characters (PDF.md §4).
 *  A long title commonly wraps across several lines, and every one of
 *  those wrapped lines independently qualifies — found live generating an
 *  EPUB from the M39 §A8 gate's own two-column fixture, where a two-line
 *  title produced two one-line "sections" instead of one. A run of
 *  consecutive heading-qualifying lines is coalesced into a single
 *  boundary (capped at `HEADING_RUN_MAX_LINES` — M42 §A1: a title
 *  reasonably wraps 2–3 lines, not thirty), its title the run's lines
 *  joined with a space. */
function detectHeadingBoundaries(pages: PdfPageContent[]): SectionBoundary[] {
  const documentBodySize = modalBodyFontSize(pages);
  const boundaries: SectionBoundary[] = [];
  for (const page of pages) {
    const bodySize = pageBodyFontSize(page, documentBodySize);
    let i = 0;
    while (i < page.blocks.length) {
      const block = page.blocks[i];
      if (
        block.kind !== "line" ||
        isCaptionLine(page.blocks, i) ||
        !isHeadingLine(block.line.text, block.line.fontSize, bodySize)
      ) {
        i++;
        continue;
      }
      const titleParts = [block.line.text.trim()];
      let j = i + 1;
      while (j < page.blocks.length && titleParts.length < HEADING_RUN_MAX_LINES) {
        const next = page.blocks[j];
        if (
          next.kind !== "line" ||
          isCaptionLine(page.blocks, j) ||
          !isHeadingLine(next.line.text, next.line.fontSize, bodySize)
        ) {
          break;
        }
        titleParts.push(next.line.text.trim());
        j++;
      }
      const title = titleParts.join(" ");
      boundaries.push({ pageIndex: page.pageIndex, blockIndex: i, title, depth: depthFromNumbering(title) });
      i = j;
    }
  }
  return boundaries;
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Rung 1: resolves each outline entry to a page + block index.
 *
 *  M42 §A2, revised after a live regression (NOTES.md "M42 — outline y
 *  unreliable across a whole document", 2026-09-07): the first version of
 *  this fix only re-resolved an entry via text search when its raw
 *  `(pageIndex, blockIndex)` *collided* with an earlier one, trusting the
 *  destination y otherwise. A real paper broke that assumption completely —
 *  all 64 outline entries shared the exact same `y`, which corresponded to
 *  *none* of their true positions (not "near the right place, just tied
 *  with a neighbour" — a generic anchor, likely a hyperref/LaTeX-template
 *  quirk, unrelated to any heading's real position). Trusting y whenever it
 *  merely happened not to collide with another entry on the same page was
 *  therefore not a safe signal on its own: an isolated (non-colliding)
 *  entry could be just as wrong, silently, with no collision to flag it.
 *
 *  So an entry's own heading **text** is now the primary signal: search the
 *  destination page's lines, in document order after wherever the previous
 *  entry on that same page was placed, for the first one whose text starts
 *  with this entry's title (case/punctuation-insensitively — the same
 *  search rung 2's detected-heading fallback would find independently).
 *  The destination y is now only a fallback for when that text can't be
 *  found at all (an entry whose title doesn't literally appear — e.g. it
 *  was blank, or formatted too differently from the outline string) —
 *  ⚠️ outline destinations are still page-anchored even in that fallback,
 *  so a section beginning one-third down a page still splits there, not at
 *  the page boundary (PDF.md §4 ⚠️). An entry with neither a text match nor
 *  a resolvable y (e.g. a `/Fit` destination — NOTES.md "M39 §A", bug 2)
 *  rounds to the page boundary as an honest degradation. */
function resolveOutlineBoundaries(pages: PdfPageContent[], outline: PdfOutlineEntry[]): SectionBoundary[] {
  const pageByIndex = new Map(pages.map((p) => [p.pageIndex, p]));
  const searchFloor = new Map<number, number>();
  const boundaries: SectionBoundary[] = [];

  for (const entry of outline) {
    if (entry.pageIndex === null) continue;
    const page = pageByIndex.get(entry.pageIndex);
    if (!page) continue;

    const title = entry.title.trim() || null;
    const floor = searchFloor.get(entry.pageIndex) ?? -1;
    const normalizedTitle = title ? normalizeForMatch(title) : "";

    let blockIndex: number | null = null;
    if (normalizedTitle) {
      const found = page.blocks.findIndex(
        (b, idx) => idx > floor && b.kind === "line" && normalizeForMatch(b.line.text).startsWith(normalizedTitle),
      );
      if (found >= 0) blockIndex = found;
    }

    if (blockIndex === null) {
      blockIndex = 0;
      if (entry.y !== null) {
        const found = page.blocks.findIndex((b, idx) => idx > floor && b.kind === "line" && b.line.y <= (entry.y as number));
        if (found >= 0) blockIndex = found;
      }
    }

    searchFloor.set(entry.pageIndex, blockIndex);
    boundaries.push({ pageIndex: entry.pageIndex, blockIndex, title, depth: entry.depth });
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
 *  (front matter before the first heading/outline entry) is ever dropped.
 *
 *  M42 §C3: the boundaries a rung returns are no longer all spine-starting
 *  — only its depth-1 ones are (`buildSectionsWithPageIndex` below splits
 *  the two apart); a depth-2+ boundary stays inline in its parent section.
 *  ⚠️ A rung that produces boundaries with *no* depth-1 entry at all — "a
 *  document whose entire outline sits at depth 2+ under one nominal root"
 *  (PDF.md §4 ⚠️) — is treated as if it produced none, falling through to
 *  the next rung, rather than trusting a possibly-malformed depth signal
 *  into a spine with zero real chapters. SPEC-GAP: this catches *zero*
 *  depth-1 boundaries; a single nominal root that itself resolves to depth
 *  1 (one wrapping bookmark around the whole real outline) still passes
 *  this guard and collapses the document into one section — not confirmed
 *  live against a real PDF, unlike the shapes this milestone's other fixes
 *  were, so not guessed at further here. */
function detectBoundaries(pages: PdfPageContent[], outline: PdfOutlineEntry[]): SectionBoundary[] {
  if (pages.length === 0) return [];

  let boundaries: SectionBoundary[];
  const outlineBoundaries = resolveOutlineBoundaries(pages, outline);
  if (outlineBoundaries.some((b) => b.depth === 1)) {
    boundaries = outlineBoundaries;
  } else {
    const headingBoundaries = detectHeadingBoundaries(pages);
    if (headingBoundaries.some((b) => b.depth === 1)) {
      boundaries = headingBoundaries;
    } else if (pages.length < SINGLE_SECTION_PAGE_LIMIT) {
      return [{ pageIndex: pages[0].pageIndex, blockIndex: 0, title: null, depth: 1 }];
    } else {
      boundaries = [];
      for (let start = 0; start < pages.length; start += FIXED_GROUP_SIZE) {
        const end = Math.min(start + FIXED_GROUP_SIZE, pages.length) - 1;
        const label = start === end ? `Page ${start + 1}` : `Pages ${start + 1}–${end + 1}`;
        boundaries.push({ pageIndex: pages[start].pageIndex, blockIndex: 0, title: label, depth: 1 });
      }
      return dedupeAndSort(boundaries);
    }
  }

  const deduped = dedupeAndSort(boundaries);
  const first = deduped[0];
  if (!first || first.depth !== 1 || first.pageIndex !== pages[0].pageIndex || first.blockIndex !== 0) {
    deduped.unshift({ pageIndex: pages[0].pageIndex, blockIndex: 0, title: null, depth: 1 });
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

/** M42 §C4: every depth-2+ boundary that falls within `[start, end)` — the
 *  same range `blocksInRange` slices a spine section's own blocks from —
 *  becomes one of that section's `PdfSubheading`s, in document order. The
 *  offset is found by searching `sectionText` (the section's own already-
 *  assembled `blocksToText` output) for the boundary's own rendered line
 *  text, forward from wherever the previous subheading was found — not
 *  reconstructed from a prefix slice's own `blocksToText` call, which can
 *  legitimately paragraph-break differently than the full text does
 *  (`paragraphsInSegment`'s gap/indent judgment is relative to its own
 *  sample's median line spacing, found live to disagree with the full
 *  section's when the boundary line sits inside a segment of uniform
 *  spacing — NOTES.md "M42 — subheading offsets"). A boundary whose own
 *  line can't be found in the section's assembled blocks, or whose text
 *  doesn't turn up in `sectionText` at all, is skipped rather than
 *  crashing extraction or recording an honest-degrade wrong position. */
function subheadingsInSection(
  pageByIndex: Map<number, PdfPageContent>,
  sectionBlocks: PdfBlock[],
  sectionText: string,
  start: SectionBoundary,
  end: SectionBoundary | undefined,
  subBoundaries: SectionBoundary[],
): PdfSubheading[] {
  const subheadings: PdfSubheading[] = [];
  let searchFrom = 0;
  for (const boundary of subBoundaries) {
    if (boundary.pageIndex < start.pageIndex) continue;
    if (boundary.pageIndex === start.pageIndex && boundary.blockIndex < start.blockIndex) continue;
    if (end) {
      if (boundary.pageIndex > end.pageIndex) continue;
      if (boundary.pageIndex === end.pageIndex && boundary.blockIndex >= end.blockIndex) continue;
    }

    const block = pageByIndex.get(boundary.pageIndex)?.blocks[boundary.blockIndex];
    if (!block || block.kind !== "line" || sectionBlocks.indexOf(block) < 0) continue;

    const needle = block.line.text.replace(/\s+/g, " ").trim();
    if (!needle) continue;
    const offset = sectionText.indexOf(needle, searchFrom);
    if (offset < 0) continue;

    // `needle` (the rendered line's own text), not `boundary.title` (which,
    // for a rung-1 outline entry, may differ from what's actually on the
    // page in ways too subtle to see — an encoding/whitespace difference,
    // not a real content change) — found live, M42 §C4: generateEpub.ts's
    // own anchor-matching needs the *same* string this offset was found
    // with, or the id it emits and the offset recorded here silently part
    // ways, and no subheading anchor resolves to anything at all.
    subheadings.push({ title: needle, depth: boundary.depth, offset });
    searchFrom = offset + needle.length;
  }
  return subheadings;
}

/** Turns the page-level extraction into the document's spine: one
 *  `PdfSection` per detected boundary, each with its own href
 *  (`section-000.xhtml`, …) and assembled text. The spine unit is a
 *  section, never a page (PDF.md §4 — the single most consequential
 *  extraction decision in this arc). */
export function buildSections(pages: PdfPageContent[], outline: PdfOutlineEntry[]): PdfSection[] {
  return buildSectionsWithPageIndex(pages, outline).sections;
}

/**
 * M41 §A2: `buildSections` plus a page→section map (index = page index,
 * value = section index) for the native pane's "highlights are shared
 * between reflow and native" — nothing needed this before a second renderer
 * existed to ask (NOTES.md, M40 §D's own SPEC-GAP). A page that begins
 * mid-section (the same "outline destinations are page-anchored" trap §4
 * warns about) is assigned to the section active at the *top* of the page —
 * honest, not byte-exact, for the handful of pages that straddle a
 * boundary; a highlight made in the sliver below the heading on that page
 * anchors to the earlier section instead of the true one.
 */
export function buildSectionsWithPageIndex(
  pages: PdfPageContent[],
  outline: PdfOutlineEntry[],
): { sections: PdfSection[]; pageSectionIndex: number[] } {
  const boundaries = detectBoundaries(pages, outline);
  // M42 §C3: only a depth-1 boundary starts a new `PdfSection` — the spine
  // itself, everything below keyed off `spineBoundaries` exactly as
  // `boundaries` was before depth existed. A depth-2+ boundary never
  // fragments the spine; it becomes an inline `PdfSubheading` of whichever
  // depth-1 section it falls inside (`subheadingsInSection`).
  const spineBoundaries = boundaries.filter((b) => b.depth === 1);
  const subBoundaries = boundaries.filter((b) => b.depth > 1);
  const pageByIndex = new Map(pages.map((p) => [p.pageIndex, p]));

  const sections = spineBoundaries.map((boundary, index) => {
    const nextBoundary = spineBoundaries[index + 1];
    const blocks = blocksInRange(pages, boundary, nextBoundary);
    const text = blocksToText(blocks);
    return {
      spineIndex: index,
      href: `section-${padIndex(index)}.xhtml`,
      title: boundary.title ?? `Section ${index + 1}`,
      text,
      blocks,
      subheadings: subheadingsInSection(pageByIndex, blocks, text, boundary, nextBoundary, subBoundaries),
    };
  });

  // A boundary that starts partway down a page (`blockIndex > 0` — PDF.md
  // §4's "outline destinations are page-anchored" trap) doesn't hand that
  // page to the new section until the *next* page — only a boundary sitting
  // at a page's very top (`blockIndex === 0`) does. Comparing `pageIndex`
  // alone can't tell those apart, since both shapes share the same page.
  const effectiveStartPage = (boundary: SectionBoundary): number =>
    boundary.blockIndex > 0 ? boundary.pageIndex + 1 : boundary.pageIndex;

  const pageSectionIndex: number[] = [];
  let boundaryCursor = 0;
  for (const page of pages) {
    while (
      boundaryCursor + 1 < spineBoundaries.length &&
      effectiveStartPage(spineBoundaries[boundaryCursor + 1]) <= page.pageIndex
    ) {
      boundaryCursor++;
    }
    pageSectionIndex[page.pageIndex] = boundaryCursor;
  }

  return { sections, pageSectionIndex };
}
