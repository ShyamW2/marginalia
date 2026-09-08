import type { PdfLine } from "./types.js";

const CAPTION_REGEX = /^Table\.?\s*\d+/i;
// A genuine table row's cells sit far enough apart that the gap between
// them, in PDF user-space units, clears an ordinary inter-word gap for the
// line's own font size — the exact mechanism NOTES.md's root cause 4 found
// live: `joinLineItems` (lines.ts) collapses any gap at or above 0.15×
// height into a single space, so a genuine two-cell row ("1.1 Comprehensive
// theory based…" | "a) Engages with the engineering discipline…") reads as
// one line of ordinary prose — only the underlying items' x-positions still
// carry the column break. Calibrated against a real table (NOTES.md "M39 —
// the real gate, finally"): its column gap measured ~1.7× the row's own
// font size, against ~0 for every ordinary single-item prose line in the
// same document.
const MIN_CELL_GAP_RATIO = 1.5;
// A single logical row commonly wraps its own cell text across several
// physical lines, and not every one of those carries a second cell (a
// column-1 label continuing alone, say) — so it doesn't itself look
// tabular by the gap test above. Tolerate up to this many consecutive
// non-qualifying lines within a table before concluding the table has
// actually ended and real prose (or an unrelated bulleted list) has
// resumed; calibrated against the same real table, whose longest such wrap
// was 3 lines.
const MAX_NONQUALIFYING_RUN = 3;

function looksLikeTableRow(line: PdfLine): boolean {
  if (line.items.length < 2) return false;
  const sorted = [...line.items].sort((a, b) => a.x - b.x);
  const threshold = MIN_CELL_GAP_RATIO * (line.fontSize || 10);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
    if (gap >= threshold) return true;
  }
  return false;
}

export interface TableRegion {
  /** Index into the page's ordered `PdfLine[]` of the caption line. */
  captionLineIndex: number;
  caption: string;
  /** Index range into the page's lines — inclusive start, exclusive end —
   *  of the table's own row/cell lines. Never includes the caption line
   *  itself. */
  startIndex: number;
  endIndex: number;
  /** Bounding box in PDF user space, for rasterization (§3.5). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * PDF.md §3.5 (amended M42): a table caption's `Table\s*\d+` line is
 * followed by a run of table-row-shaped lines — the block span between the
 * caption and the next *real* non-table content. "Real" tolerates short
 * (≤ `MAX_NONQUALIFYING_RUN`) gaps of non-row-shaped lines within that run
 * (a wrapped column-1 label, say), since a multi-row table like the real
 * one this was calibrated against interleaves several such wraps between
 * its genuinely cell-joined rows — stopping at the *first* non-qualifying
 * line, tried first, left every row after the first one still garbled in
 * `resource_text` (NOTES.md "M39 — the real gate, finally", root cause 4).
 * A caption with no table-shaped line at all following it (the table
 * itself couldn't be positively identified) yields no region — an honest
 * degrade, same as `detectFigureRegions` finding no adjacent blank area.
 */
export function detectTableRegions(lines: PdfLine[]): TableRegion[] {
  const regions: TableRegion[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.text.trim();
    if (!CAPTION_REGEX.test(trimmed)) return;

    // `anchor` is the last position known to be part of the table — the
    // caption itself, until a qualifying row line moves it forward. A
    // table's header row commonly has no internal gap of its own (its
    // cells sit close together even though the data rows below don't —
    // confirmed live against a real table), so the leading run up to the
    // first genuine row gets the same tolerance as a run between two rows.
    let lastQualifying = -1;
    let anchor = index;
    let i = index + 1;
    while (i < lines.length) {
      if (CAPTION_REGEX.test(lines[i].text.trim())) break; // the next table's own caption
      if (looksLikeTableRow(lines[i])) {
        lastQualifying = i;
        anchor = i;
      } else if (i - anchor > MAX_NONQUALIFYING_RUN) {
        break;
      }
      i++;
    }
    if (lastQualifying < 0) return;

    const rowIndices = Array.from({ length: lastQualifying - index }, (_, k) => index + 1 + k);
    const rowLines = rowIndices.map((idx) => lines[idx]);
    const allItems = rowLines.flatMap((l) => l.items);
    regions.push({
      captionLineIndex: index,
      caption: trimmed,
      startIndex: rowIndices[0],
      endIndex: rowIndices[rowIndices.length - 1] + 1,
      x0: Math.min(...allItems.map((it) => it.x)),
      x1: Math.max(...allItems.map((it) => it.x + it.width)),
      y0: Math.min(...allItems.map((it) => it.y)),
      y1: Math.max(...allItems.map((it) => it.y + it.height)),
    });
  });

  return regions;
}
