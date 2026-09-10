import type { PdfLine } from "./types.js";

// M42 §B1: "Table" moved to `tables.ts`'s own positive row/cell detection —
// this blank-region heuristic assumes a figure's picture, which a table's
// dense row text never has; letting "Table N" also fire here produced an
// often-spurious rasterized region right next to the table (NOTES.md "M39 —
// the real gate, finally", root cause 4).
const CAPTION_REGEX = /^(Fig(ure)?|Algorithm|Chart|Scheme)\.?\s*\d+/i;
const MIN_AREA_FRACTION = 0.04;
// M43 §I: a diagram built from vector graphics (boxes, arrows) commonly
// carries its own text labels ("L-Iter", "Inactive L-Divert Active", …)
// positioned inside it — `getTextContent()` still emits those as ordinary
// lines, so the single-adjacent-line gap test below sees no blank space at
// all and drops the whole region, real diagram included. A label line is
// short; real body prose is not — tolerate a run of short lines outward
// from the caption as still "the figure's own whitespace", so the labels
// get swept into the crop instead of leaking into `resource_text` as a
// flat, disconnected word list.
const LABEL_MAX_CHARS = 30;
const FIGURE_MAX_REGION_FRACTION = 0.4;

export interface FigureRegion {
  /** Index into the page's ordered `PdfLine[]` of the caption line. */
  captionLineIndex: number;
  caption: string;
  /** Which side of the caption the blank region — and so the image — sits on. */
  side: "above" | "below";
  /** Index range into the page's lines — inclusive start, exclusive end —
   *  of label lines swept into the region (M43 §I). Empty (`startIndex ===
   *  endIndex`) for a genuinely blank region, the pre-M43 case. Never
   *  includes the caption line itself. */
  startIndex: number;
  endIndex: number;
  /** Bounding box in PDF user space, for rasterization (§3.5). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * PDF.md §3.5 (amended M43 §I): a figure region is a rectangle, area > 4%
 * of the page, bounded by whitespace *or* a run of short, label-shaped
 * lines (a diagram's own captions-within-the-diagram), whose nearest line
 * above or below matches the caption pattern. SPEC-GAP: the region's
 * horizontal extent is approximated as the full page width rather than the
 * caption's own column — cheap, and the cost is a rasterized crop that's
 * sometimes wider than the true figure, never a text-substrate error (the
 * image never enters `resource_text`, only the caption does). Narrowing it
 * to the true column needs column membership threaded through from
 * columns.ts, which nothing else here needs — see docs/marginalia/NOTES.md
 * "M39".
 */
export function detectFigureRegions(lines: PdfLine[], pageWidth: number, pageHeight: number): FigureRegion[] {
  const regions: FigureRegion[] = [];
  const maxRegionHeight = pageHeight * FIGURE_MAX_REGION_FRACTION;

  const isLabelLike = (line: PdfLine): boolean => {
    const trimmed = line.text.trim();
    return trimmed.length > 0 && trimmed.length <= LABEL_MAX_CHARS && !CAPTION_REGEX.test(trimmed);
  };

  /** Walks outward from the caption, away from the body-text side,
   *  absorbing label-shaped lines until real prose, another caption, or
   *  `maxRegionHeight` stops it. Returns the swept line-index range (empty
   *  when nothing qualifies) and how far the walk reached in PDF y. */
  const sweepLabels = (
    captionIndex: number,
    direction: 1 | -1,
    startY: number,
  ): { startIndex: number; endIndex: number; farY: number } => {
    let idx = captionIndex + direction;
    let farY = startY;
    let sweptCount = 0;
    while (idx >= 0 && idx < lines.length) {
      const candidate = lines[idx];
      if (Math.abs(farY - candidate.y) > maxRegionHeight) break;
      if (!isLabelLike(candidate)) break;
      farY = candidate.y;
      sweptCount++;
      idx += direction;
    }
    if (sweptCount === 0) return { startIndex: captionIndex, endIndex: captionIndex, farY: startY };
    return direction === 1
      ? { startIndex: captionIndex + 1, endIndex: captionIndex + 1 + sweptCount, farY }
      : { startIndex: captionIndex - sweptCount, endIndex: captionIndex, farY };
  };

  lines.forEach((line, index) => {
    const trimmed = line.text.trim();
    if (!CAPTION_REGEX.test(trimmed)) return;

    const above = lines[index - 1];
    const below = lines[index + 1];
    const gapAbove = above ? above.y - (line.y + line.fontSize) : pageHeight - (line.y + line.fontSize);
    const gapBelow = below ? line.y - below.y : line.y;

    // Run the label-sweep on both sides regardless of which wins the plain
    // blank-gap test — a labeled diagram has little to no blank gap on its
    // own side, so the gap test alone can't pick the side by itself.
    const aboveSweep = sweepLabels(index, -1, line.y + line.fontSize);
    const belowSweep = sweepLabels(index, 1, line.y);
    // `farY` is the farthest swept line's own y — for "above" that's a
    // larger y than the caption's top edge (PDF y grows upward), for
    // "below" a smaller y than the caption's own baseline. Same sign
    // convention as `gapAbove`/`gapBelow` just above, extended from the one
    // adjacent line to the sweep's full reach.
    const sweptGapAbove = aboveSweep.endIndex > aboveSweep.startIndex ? aboveSweep.farY - (line.y + line.fontSize) : 0;
    const sweptGapBelow = belowSweep.endIndex > belowSweep.startIndex ? line.y - belowSweep.farY : 0;

    const effectiveGapAbove = Math.max(gapAbove, sweptGapAbove);
    const effectiveGapBelow = Math.max(gapBelow, sweptGapBelow);

    const side: "above" | "below" = effectiveGapAbove >= effectiveGapBelow ? "above" : "below";
    const gap = side === "above" ? effectiveGapAbove : effectiveGapBelow;
    const area = Math.max(gap, 0) * pageWidth;
    if (area < pageWidth * pageHeight * MIN_AREA_FRACTION) return;

    const sweep = side === "above" ? aboveSweep : belowSweep;
    const y1 = side === "above" ? line.y + line.fontSize + gap : line.y + line.fontSize;
    const y0 = side === "above" ? line.y + line.fontSize : line.y + line.fontSize - gap;

    regions.push({
      captionLineIndex: index,
      caption: trimmed,
      side,
      startIndex: sweep.startIndex,
      endIndex: sweep.endIndex,
      x0: 0,
      x1: pageWidth,
      y0: Math.max(y0, 0),
      y1: Math.min(y1, pageHeight),
    });
  });

  return regions;
}
