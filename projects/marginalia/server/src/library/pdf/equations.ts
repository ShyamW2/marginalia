import type { PdfLine } from "./types.js";

const ITEM_DENSITY_THRESHOLD = 2.5;
const MIN_DISTINCT_FONTS = 3;

function isEquationLine(line: PdfLine): boolean {
  const charCount = line.text.replace(/\s/g, "").length;
  if (charCount === 0) return false;
  const density = line.items.length / charCount;
  return density > ITEM_DENSITY_THRESHOLD && line.fontNames.length >= MIN_DISTINCT_FONTS;
}

export interface EquationBand {
  /** Index range into the lines array, inclusive start, exclusive end. */
  startIndex: number;
  endIndex: number;
  y: number;
  /** Bounding box in PDF user space, for rasterization. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * PDF.md §3.4: a run of lines whose item-count-per-character exceeds ~2.5
 * and whose items span 3+ distinct fontNames is an equation band — detect
 * and rasterize, never reconstruct as text.
 */
export function detectEquationBands(lines: PdfLine[]): EquationBand[] {
  const bands: EquationBand[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isEquationLine(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    let end = i + 1;
    while (end < lines.length && isEquationLine(lines[end])) end++;

    const bandLines = lines.slice(start, end);
    const allItems = bandLines.flatMap((l) => l.items);
    bands.push({
      startIndex: start,
      endIndex: end,
      y: bandLines[0].y,
      x0: Math.min(...allItems.map((it) => it.x)),
      x1: Math.max(...allItems.map((it) => it.x + it.width)),
      y0: Math.min(...allItems.map((it) => it.y)),
      y1: Math.max(...allItems.map((it) => it.y + it.height)),
    });
    i = end;
  }
  return bands;
}
