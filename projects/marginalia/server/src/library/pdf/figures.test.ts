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

  it("recognises Table/Algorithm/Chart/Scheme captions, case-insensitively", () => {
    const lines = groupLines([
      item("table 2. Results by condition.", 40, 700),
      item("Following text right below.", 40, 686),
    ]);

    const regions = detectFigureRegions(lines, PAGE_WIDTH, PAGE_HEIGHT);

    expect(regions.some((r) => r.caption.toLowerCase().startsWith("table 2"))).toBe(true);
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
});
