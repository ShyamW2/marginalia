import { detectEquationBands, type EquationBand } from "./equations.js";
import { detectFigureRegions, type FigureRegion } from "./figures.js";
import { detectTableRegions, type TableRegion } from "./tables.js";
import type { PdfBlock, PdfLine } from "./types.js";

/**
 * Turns a page's grouped lines into the final `PdfBlock[]` reading order:
 * an equation band's lines are removed from the text stream and replaced
 * by one `equation` block (§3.4 — nothing it covered enters `resource_text`);
 * a figure's caption line stays as a `line` block (the caption always
 * enters `resource_text`, §3.5), with one `figure` block inserted on
 * whichever side its blank region was found. A table (§3.5, amended M42) is
 * the same rule applied to its row/cell lines instead of a blank region:
 * they're removed from the text stream entirely and replaced by one `table`
 * block inserted right after its caption line.
 *
 * Pure and synchronous — rasterization is async (`rasterize.ts`) and
 * resolved by the caller (`extract.ts`) into
 * `equationImages`/`figureImages`/`tableImages`, keyed by the
 * band/region's index in the arrays `detectEquationBands`/
 * `detectFigureRegions`/`detectTableRegions` returned for these same
 * `lines`.
 */
export function buildPageBlocks(
  lines: PdfLine[],
  pageIndex: number,
  pageWidth: number,
  pageHeight: number,
  equationImages: (Buffer | null)[],
  figureImages: (Buffer | null)[],
  tableImages: (Buffer | null)[] = [],
): PdfBlock[] {
  const equationBands = detectEquationBands(lines);
  const figureRegions = detectFigureRegions(lines, pageWidth, pageHeight);
  const tableRegions = detectTableRegions(lines);

  const figuresByLineIndex = new Map<number, { region: FigureRegion; image: Buffer | null }[]>();
  figureRegions.forEach((region, i) => {
    const list = figuresByLineIndex.get(region.captionLineIndex) ?? [];
    list.push({ region, image: figureImages[i] ?? null });
    figuresByLineIndex.set(region.captionLineIndex, list);
  });

  const tableAtCaption = new Map<number, { region: TableRegion; image: Buffer | null }>();
  tableRegions.forEach((region, i) => {
    tableAtCaption.set(region.captionLineIndex, { region, image: tableImages[i] ?? null });
  });
  // §3.5's rule, applied to a table's row/cell lines (M42 §B2): nothing but
  // the caption enters `resource_text` — the row lines aren't reduced to a
  // block at all, unlike an equation band's interior (below), which keeps a
  // marker line stripped of text. Both approaches leave zero text; the
  // difference is bookkeeping only.
  const tableRowSkip = new Set<number>();
  tableRegions.forEach((region) => {
    for (let i = region.startIndex; i < region.endIndex; i++) tableRowSkip.add(i);
  });

  const equationAt = new Map<number, { band: EquationBand; image: Buffer | null }>();
  equationBands.forEach((band, i) => {
    equationAt.set(band.startIndex, { band, image: equationImages[i] ?? null });
  });
  const skipUntil = new Set<number>();
  equationBands.forEach((band) => {
    for (let i = band.startIndex + 1; i < band.endIndex; i++) skipUntil.add(i);
  });

  const blocks: PdfBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (skipUntil.has(i) || tableRowSkip.has(i)) continue;

    const equation = equationAt.get(i);
    if (equation) {
      blocks.push({ kind: "equation", image: equation.image, y: equation.band.y, page: pageIndex });
      continue;
    }

    const figuresAbove = (figuresByLineIndex.get(i) ?? []).filter((f) => f.region.side === "above");
    for (const f of figuresAbove) {
      blocks.push({ kind: "figure", image: f.image, caption: f.region.caption, y: f.region.y1, page: pageIndex });
    }

    blocks.push({ kind: "line", line: lines[i] });

    const figuresBelow = (figuresByLineIndex.get(i) ?? []).filter((f) => f.region.side === "below");
    for (const f of figuresBelow) {
      blocks.push({ kind: "figure", image: f.image, caption: f.region.caption, y: f.region.y0, page: pageIndex });
    }

    const table = tableAtCaption.get(i);
    if (table) {
      blocks.push({ kind: "table", image: table.image, caption: table.region.caption, y: table.region.y0, page: pageIndex });
    }
  }

  return blocks;
}

export { detectEquationBands, detectFigureRegions, detectTableRegions };
