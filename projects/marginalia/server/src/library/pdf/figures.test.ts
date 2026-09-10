import { describe, expect, it } from "vitest";
import { detectFigureRegions } from "./figures.js";
import { groupLines } from "./lines.js";
import type { RawTextItem } from "./types.js";

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

function item(text: string, x: number, y: number, width = text.length * 6): RawTextItem {
  return { text, x, y, width, height: 10, fontName: "F1" };
}

describe("detectFigureRegions", () => {
  it("finds a large blank region above a caption and matches it to the caption", () => {
    const lines = groupLines([
      item("Preceding paragraph text.", 40, 700),
      // A big gap (image sits here) between the paragraph and the caption.
      item("Figure 1. A diagram of the pipeline.", 40, 300),
      item("Following paragraph text.", 40, 280),
    ]);

    const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

    expect(regions).toHaveLength(1);
    expect(regions[0].side).toBe("above");
    expect(regions[0].caption).toBe("Figure 1. A diagram of the pipeline.");
    expect(regions[0].y1).toBeGreaterThan(regions[0].y0);
  });

  it("recognises Algorithm/Chart/Scheme captions, case-insensitively", () => {
    const lines = groupLines([
      item("algorithm 2. The sorting procedure.", 40, 700),
      item("Following text right below.", 40, 686),
    ]);

    const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

    expect(regions.some((r) => r.caption.toLowerCase().startsWith("algorithm 2"))).toBe(true);
  });

  // M42 §B1: a "Table N" caption belongs to `tables.ts`'s own positive
  // row/cell detection now — this blank-region heuristic must not also fire
  // for it and produce a second, spurious rasterized region.
  it("no longer recognises Table captions — that's tables.ts's job now", () => {
    const lines = groupLines([
      item("Table 2. Results by condition.", 40, 700),
      // A big gap, the same shape a real figure's blank area would have —
      // still must not match, since "Table" is no longer in the pattern.
      item("Following text far below.", 40, 300),
    ]);

    const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

    expect(regions).toHaveLength(0);
  });

  it("does not flag a caption-like line with no adjacent blank area large enough", () => {
    const lines = groupLines([
      item("Ordinary paragraph line one.", 40, 700),
      // "Figure" here reads as a normal sentence reference, tightly packed —
      // no region on either side clears 4% of the page.
      item("As shown in Figure 1 above, results improve.", 40, 686),
      item("Ordinary paragraph line two.", 40, 672),
    ]);

    const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

    expect(regions).toHaveLength(0);
  });

  it("does not flag an ordinary caption-less paragraph", () => {
    const lines = groupLines([
      item("Some regular sentence.", 40, 700),
      item("Another regular sentence far below.", 40, 300),
    ]);

    const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

    expect(regions).toHaveLength(0);
  });

  // M43 §I: a diagram built from vector graphics with text labels inside it
  // leaves no blank gap for the plain adjacent-line test to find — the
  // labels themselves must be swept into the region instead.
  describe("labeled diagram regions (M43 §I)", () => {
    it("sweeps short label lines above a caption into the region", () => {
      const lines = groupLines([
        item("Preceding paragraph text runs here for a while.", 40, 760),
        item("L-Iter", 40, 460),
        item("L-Begin L-Finish", 40, 430),
        item("Inactive L-Divert Active", 40, 400),
        item("O-Remove", 40, 370),
        item("Figure 1. The component lifecycle.", 40, 300),
        item("Following paragraph text runs here for a while.", 40, 280),
      ]);

      const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

      expect(regions).toHaveLength(1);
      expect(regions[0].side).toBe("above");
      // Indices 1-4 are the four label lines; 0 (the preceding paragraph)
      // and 5 (the caption itself) must not be swept in.
      expect(regions[0].startIndex).toBe(1);
      expect(regions[0].endIndex).toBe(5);
    });

    it("excludes the swept label lines' indices from a genuinely blank region", () => {
      const lines = groupLines([
        item("Preceding paragraph text.", 40, 700),
        item("Figure 1. A diagram of the pipeline.", 40, 300),
        item("Following paragraph text.", 40, 280),
      ]);

      const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

      expect(regions).toHaveLength(1);
      expect(regions[0].startIndex).toBe(regions[0].endIndex);
    });

    it("does not sweep ordinary body prose in as if it were labels", () => {
      const lines = groupLines([
        item("A sentence of real prose that just happens to run a bit long here.", 40, 700),
        item("Another full sentence of ordinary prose immediately above the figure.", 40, 686),
        item("Figure 1. A diagram of the pipeline.", 40, 672),
        item("Following paragraph text runs here.", 40, 658),
      ]);

      const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

      // No blank gap and no label-shaped lines either — no region at all.
      expect(regions).toHaveLength(0);
    });
  });
});
