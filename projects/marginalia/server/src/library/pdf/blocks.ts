import { detectEquationBands, type EquationBand } from "./equations.js";
import { detectFigureRegions, type FigureRegion } from "./figures.js";
import type { PdfBlock, PdfLine } from "./types.js";

/**
 * Turns a page's grouped lines into the final `PdfBlock[]` reading order:
 * an equation band's lines are removed from the text stream and replaced
 * by one `equation` block (§3.4 — nothing it covered enters `resource_text`);
 * a figure's caption line stays as a `line` block (the caption always
 * enters `resource_text`, §3.5), with one `figure` block inserted on
 * whichever side its blank region was found.
 *
 * Pure and synchronous — rasterization is async (`rasterize.ts`) and
 * resolved by the caller (`extract.ts`) into `equationImages`/`figureImages`,
 * keyed by the band/region's index in the arrays `detectEquationBands`/
 * `detectFigureRegions` returned for these same `lines`.
 */
export function buildPageBlocks(
  lines: PdfLine[],
  pageWidth: number,
  pageHeight: number,
  equationImages: (Buffer | null)[],
  figureImages: (Buffer | null)[],
): PdfBlock[] {
  const equationBands = detectEquationBands(lines);
  const figureRegions = detectFigureRegions(lines, pageWidth, pageHeight);

  const figuresByLineIndex = new Map<number, { region: FigureRegion; image: Buffer | null }[]>();
  figureRegions.forEach((region, i) => {
    const list = figuresByLineIndex.get(region.captionLineIndex) ?? [];
    list.push({ region, image: figureImages[i] ?? null });
    figuresByLineIndex.set(region.captionLineIndex, list);
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
    if (skipUntil.has(i)) continue;

    const equation = equationAt.get(i);
    if (equation) {
      blocks.push({ kind: "equation", image: equation.image, y: equation.band.y });
      continue;
    }

    const figuresAbove = (figuresByLineIndex.get(i) ?? []).filter((f) => f.region.side === "above");
    for (const f of figuresAbove) {
      blocks.push({ kind: "figure", image: f.image, caption: f.region.caption, y: f.region.y1 });
    }

    blocks.push({ kind: "line", line: lines[i] });

    const figuresBelow = (figuresByLineIndex.get(i) ?? []).filter((f) => f.region.side === "below");
    for (const f of figuresBelow) {
      blocks.push({ kind: "figure", image: f.image, caption: f.region.caption, y: f.region.y0 });
    }
  }

  return blocks;
}

export { detectEquationBands, detectFigureRegions };
