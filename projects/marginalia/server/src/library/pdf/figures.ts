import type { PdfLine } from "./types.js";

const CAPTION_REGEX = /^(Fig(ure)?|Table|Algorithm|Chart|Scheme)\.?\s*\d+/i;
const MIN_AREA_FRACTION = 0.04;

export interface FigureRegion {
  /** Index into the page's ordered `PdfLine[]` of the caption line. */
  captionLineIndex: number;
  caption: string;
  /** Which side of the caption the blank region — and so the image — sits on. */
  side: "above" | "below";
  /** Bounding box in PDF user space, for rasterization (§3.5). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * PDF.md §3.5: a figure region is a whitespace-bounded rectangle, area
 * > 4% of the page, whose nearest line above or below matches the caption
 * pattern. SPEC-GAP: the region's horizontal extent is approximated as the
 * full page width rather than the caption's own column — cheap, and the
 * cost is a rasterized crop that's sometimes wider than the true figure,
 * never a text-substrate error (the image never enters `resource_text`,
 * only the caption does). Narrowing it to the true column needs column
 * membership threaded through from columns.ts, which nothing else here
 * needs — see docs/marginalia/NOTES.md "M39".
 */
export function detectFigureRegions(
  lines: PdfLine[],
  pageWidth: number,
  pageHeight: number,
): FigureRegion[] {
  const regions: FigureRegion[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.text.trim();
    if (!CAPTION_REGEX.test(trimmed)) return;

    const above = lines[index - 1];
    const below = lines[index + 1];
    const gapAbove = above ? above.y - (line.y + line.fontSize) : pageHeight - (line.y + line.fontSize);
    const gapBelow = below ? line.y - below.y : line.y;

    const side: "above" | "below" = gapAbove >= gapBelow ? "above" : "below";
    const gap = side === "above" ? gapAbove : gapBelow;
    const area = Math.max(gap, 0) * pageWidth;
    if (area < pageWidth * pageHeight * MIN_AREA_FRACTION) return;

    const y1 = side === "above" ? line.y + line.fontSize + gap : line.y + line.fontSize;
    const y0 = side === "above" ? line.y + line.fontSize : line.y + line.fontSize - gap;

    regions.push({
      captionLineIndex: index,
      caption: trimmed,
      side,
      x0: 0,
      x1: pageWidth,
      y0: Math.max(y0, 0),
      y1: Math.min(y1, pageHeight),
    });
  });

  return regions;
}
