import { describe, expect, it } from "vitest";
import { detectTableRegions } from "./tables.js";
import { groupLines } from "./lines.js";
import type { RawTextItem } from "./types.js";

function item(text: string, x: number, y: number, opts: Partial<RawTextItem> = {}): RawTextItem {
  return { text, x, y, width: text.length * 6, height: 10, fontName: "F1", ...opts };
}

/** Two widely-separated cells on the same y — the exact shape NOTES.md's
 *  root cause 4 found live: `groupLines` joins them into one line of prose
 *  with a single space, losing all trace of the column break except the
 *  underlying items' own x-positions. */
function rowItems(y: number, leftCell: string, rightCell: string): RawTextItem[] {
  return [item(leftCell, 40, y, { width: 150 }), item(rightCell, 320, y, { width: 200 })];
}

describe("detectTableRegions", () => {
  it("identifies the row/cell lines following a Table caption as one region", () => {
    const lines = groupLines([
      item("Preceding paragraph text.", 40, 720),
      item("Table 1 Knowledge and Skill Base: Elements and Indicators", 40, 700),
      ...rowItems(680, "ELEMENT OF COMPETENCY", "INDICATORS OF ATTAINMENT"),
      ...rowItems(660, "1.1 Comprehensive theory based understanding", "a) Engages with the engineering discipline"),
      ...rowItems(640, "1.2 Technical and engineering knowledge", "b) Applies established codes of practice"),
      item("Following paragraph text, back to ordinary prose.", 40, 600),
    ]);

    const regions = detectTableRegions(lines);

    expect(regions).toHaveLength(1);
    expect(regions[0].caption).toBe("Table 1 Knowledge and Skill Base: Elements and Indicators");
    // Three row lines (header + two data rows), none of them the caption.
    expect(regions[0].endIndex - regions[0].startIndex).toBe(3);
    expect(regions[0].y1).toBeGreaterThan(regions[0].y0);
  });

  it("tolerates a short run of non-row lines within a table — a wrapped cell continuation", () => {
    const lines = groupLines([
      item("Table 1. A short table.", 40, 700),
      ...rowItems(680, "1.1 Element label", "a) Indicator text starts here"),
      // The element label wraps onto its own line, no second cell on it —
      // real shape confirmed live (NOTES.md "M39 — the real gate,
      // finally") — but the table isn't over yet.
      item("continuing the element label", 52, 668),
      item("still the element label", 52, 656),
      ...rowItems(640, "1.2 Next element label", "b) More indicator text"),
    ]);

    const regions = detectTableRegions(lines);

    expect(regions).toHaveLength(1);
    // All four lines between the caption and the end — both row lines and
    // the two tolerated wrap lines in between — belong to the table.
    expect(regions[0].endIndex - regions[0].startIndex).toBe(4);
  });

  it("stops the row span once a run of non-row lines exceeds the tolerance", () => {
    const lines = groupLines([
      item("Table 1. A short table.", 40, 700),
      ...rowItems(680, "Left cell text here", "Right cell text here"),
      item("Ordinary prose paragraph resumes here, no wide gap at all.", 40, 660),
      item("And continues for a second ordinary sentence.", 40, 646),
      item("And a third ordinary sentence, still no table shape.", 40, 632),
      item("And a fourth — well past the tolerated wrap length.", 40, 618),
      ...rowItems(600, "Would-be row after the break", "should not be included"),
    ]);

    const regions = detectTableRegions(lines);

    expect(regions).toHaveLength(1);
    expect(regions[0].endIndex - regions[0].startIndex).toBe(1);
  });

  it("does not flag a Table caption with no table-shaped lines following it", () => {
    const lines = groupLines([
      item("Table 1 shows the results discussed below.", 40, 700),
      item("A completely ordinary sentence continues here.", 40, 686),
      item("And another ordinary sentence right after it.", 40, 672),
    ]);

    const regions = detectTableRegions(lines);

    expect(regions).toHaveLength(0);
  });

  it("does not flag an ordinary paragraph with wide gaps but no Table caption", () => {
    const lines = groupLines([...rowItems(700, "Left text", "Right text"), ...rowItems(680, "More left", "More right")]);

    const regions = detectTableRegions(lines);

    expect(regions).toHaveLength(0);
  });

  it("is case-insensitive and tolerates a missing period", () => {
    const lines = groupLines([item("table 3 Results", 40, 700), ...rowItems(680, "Left cell", "Right cell")]);

    const regions = detectTableRegions(lines);

    expect(regions).toHaveLength(1);
  });
});
