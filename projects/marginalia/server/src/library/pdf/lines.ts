import type { PdfBlock, PdfLine, RawTextItem } from "./types.js";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Joins a line's items left to right: a single space, unless the gap is
 *  under ~0.15 × font size (kerned runs arriving as separate items), in
 *  which case they join with none. */
function joinLineItems(items: RawTextItem[]): string {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = "";
  let prevEnd: number | null = null;
  for (const item of sorted) {
    if (prevEnd !== null) {
      const gap = item.x - prevEnd;
      if (gap >= 0.15 * item.height) text += " ";
    }
    text += item.text;
    prevEnd = item.x + item.width;
  }
  return text;
}

/**
 * PDF.md §3.3: groups items already in reading order (columns.ts's output)
 * into lines — items whose y differ by less than 0.5 × the page's median
 * line height belong to the same line. Assumes the input is already
 * partitioned into reading order (single column, or column-then-column with
 * full-width bands) so a "new line" and "y increased instead of decreased"
 * coincide at every column/band boundary.
 */
export function groupLines(items: RawTextItem[]): PdfLine[] {
  if (items.length === 0) return [];

  const lineHeightMedian = median(items.map((item) => item.height)) || 1;
  const threshold = 0.5 * lineHeightMedian;

  const lines: RawTextItem[][] = [];
  let current: RawTextItem[] = [];
  let currentY = items[0].y;

  for (const item of items) {
    if (current.length > 0 && Math.abs(item.y - currentY) > threshold) {
      lines.push(current);
      current = [];
    }
    current.push(item);
    // Track the line's reference y as its first item's y, so a slow drift
    // across many items on a slightly slanted line doesn't accumulate.
    if (current.length === 1) currentY = item.y;
  }
  if (current.length > 0) lines.push(current);

  return lines.map((lineItems) => {
    const sorted = [...lineItems].sort((a, b) => a.x - b.x);
    return {
      items: sorted,
      text: joinLineItems(sorted),
      y: sorted[0].y,
      leftEdge: sorted[0].x,
      fontSize: median(sorted.map((i) => i.height)) || 0,
      fontNames: [...new Set(sorted.map((i) => i.fontName))],
    };
  });
}

const HYPHEN_END = /-$/;
const STARTS_LOWERCASE = /^[a-z]/;

function modalLeftEdgeOf(lines: PdfLine[]): number {
  const buckets = new Map<number, number>();
  for (const line of lines) {
    const bucket = Math.round(line.leftEdge / 3) * 3;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  let modalLeftEdge = lines[0].leftEdge;
  let modalCount = -1;
  for (const [edge, count] of buckets) {
    if (count > modalCount) {
      modalCount = count;
      modalLeftEdge = edge;
    }
  }
  return modalLeftEdge;
}

/** A backward y-jump — a column/band boundary (columns.ts threads column 2
 *  back to the top of the page, a new full-width band restarts too) —
 *  always splits the flow. Splitting first, before the indent/gap checks
 *  below run, matters: those checks are relative to *this* segment's own
 *  modal left edge and line spacing, not the whole page's. A two-column
 *  page has two legitimate left edges; comparing column 2's lines against
 *  column 1's modal edge previously flagged every line in column 2 as
 *  "indented", breaking it into one paragraph per line (found live at the
 *  M39 §A8 gate — see NOTES.md). */
function splitAtBackwardJumps(lines: PdfLine[]): PdfLine[][] {
  const segments: PdfLine[][] = [];
  let current: PdfLine[] = [];
  for (const line of lines) {
    const prev = current[current.length - 1];
    if (prev && prev.y - line.y <= 0) {
      segments.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/** Paragraphs within one segment (no backward y-jumps) — a vertical gap
 *  > 1.4 × the segment's median line spacing, or an indent beyond ~1em of
 *  the segment's own modal left edge, starts a new paragraph. A line
 *  ending in `-` immediately followed by a lowercase-initial line
 *  de-hyphenates; never before a capital or a digit. */
function paragraphsInSegment(lines: PdfLine[]): string[] {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  const lineSpacingMedian = median(gaps) || 1;
  const modalLeftEdge = modalLeftEdgeOf(lines);

  const paragraphs: string[] = [];
  let current = lines[0].text;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];
    const gap = prev.y - line.y;
    const emGuess = prev.fontSize || 10;
    const indented = line.leftEdge > modalLeftEdge + emGuess;
    const prevEndsHyphen = HYPHEN_END.test(prev.text);
    const dehyphenate = prevEndsHyphen && STARTS_LOWERCASE.test(line.text);
    // A hyphenated word continuation is never a paragraph break, even if
    // the wrap happened to land past the gap/indent thresholds.
    const newParagraph = !dehyphenate && (gap > 1.4 * lineSpacingMedian || indented);

    if (newParagraph) {
      paragraphs.push(current);
      current = line.text;
    } else if (dehyphenate) {
      current = current.replace(HYPHEN_END, "") + line.text;
    } else {
      current += " " + line.text;
    }
  }
  paragraphs.push(current);
  return paragraphs;
}

/** PDF.md §3.3: turns grouped lines into paragraph text (see
 *  `splitAtBackwardJumps` and `paragraphsInSegment` for the two rules that
 *  build it — a backward y-jump always breaks, everything else is judged
 *  relative to its own segment). */
export function linesToText(lines: PdfLine[]): string {
  if (lines.length === 0) return "";

  const paragraphs = splitAtBackwardJumps(lines).flatMap(paragraphsInSegment);

  return paragraphs
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
}

/** A page's blocks reduced to prose: `line` blocks go through `linesToText`;
 *  `equation`/`figure` blocks contribute nothing (§3.4/§3.5 — the picture,
 *  never a text reconstruction, and a figure's caption is already its own
 *  `line` block in the surrounding flow). */
export function blocksToText(blocks: PdfBlock[]): string {
  const lines = blocks.filter((b): b is { kind: "line"; line: PdfLine } => b.kind === "line").map((b) => b.line);
  return linesToText(lines);
}
