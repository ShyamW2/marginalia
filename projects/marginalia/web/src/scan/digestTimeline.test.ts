import { describe, expect, it } from "vitest";
import {
  beamFromChapterRange,
  beamHalfWidthFromDrag,
  beamRange,
  chapterIndexAtFraction,
} from "./digestTimeline.js";

const chapters = [
  { startPercent: 0, lengthPercent: 0.2 },
  { startPercent: 0.2, lengthPercent: 0.3 },
  { startPercent: 0.5, lengthPercent: 0.5 },
];

describe("chapterIndexAtFraction", () => {
  it("finds the chapter containing a fraction", () => {
    expect(chapterIndexAtFraction(chapters, 0.1)).toBe(0);
    expect(chapterIndexAtFraction(chapters, 0.25)).toBe(1);
    expect(chapterIndexAtFraction(chapters, 0.99)).toBe(2);
  });

  it("clamps fractions outside [0, 1] to the first/last chapter", () => {
    expect(chapterIndexAtFraction(chapters, -0.5)).toBe(0);
    expect(chapterIndexAtFraction(chapters, 1.5)).toBe(2);
  });

  it("lands exactly on a boundary in the chapter that starts there", () => {
    expect(chapterIndexAtFraction(chapters, 0.2)).toBe(1);
  });

  it("returns 0 for an empty chapter list rather than throwing", () => {
    expect(chapterIndexAtFraction([], 0.5)).toBe(0);
  });
});

describe("beamHalfWidthFromDrag", () => {
  it("widens when dragging up (currentY < dragStartY)", () => {
    const result = beamHalfWidthFromDrag(0.1, 500, 300);
    expect(result).toBeGreaterThan(0.1);
  });

  it("narrows when dragging down (currentY > dragStartY)", () => {
    const result = beamHalfWidthFromDrag(0.2, 300, 500);
    expect(result).toBeLessThan(0.2);
  });

  it("clamps to the configured min/max", () => {
    expect(beamHalfWidthFromDrag(0.1, 0, 100000)).toBeGreaterThanOrEqual(0.03);
    expect(beamHalfWidthFromDrag(0.1, 100000, 0)).toBeLessThanOrEqual(0.5);
  });
});

describe("beamRange", () => {
  it("clamps to [0, 1]", () => {
    expect(beamRange(0.05, 0.2)).toEqual({ startFraction: 0, endFraction: 0.25 });
    expect(beamRange(0.95, 0.2)).toEqual({ startFraction: 0.75, endFraction: 1 });
  });

  it("is centered normally away from the edges", () => {
    expect(beamRange(0.5, 0.1)).toEqual({ startFraction: 0.4, endFraction: 0.6 });
  });
});

describe("beamFromChapterRange", () => {
  it("spans exactly the selected chapters", () => {
    expect(beamFromChapterRange(chapters, 0, 1)).toEqual({ startFraction: 0, endFraction: 0.5 });
  });

  it("handles startIdx > endIdx the same as the reverse (order-independent)", () => {
    expect(beamFromChapterRange(chapters, 2, 0)).toEqual(beamFromChapterRange(chapters, 0, 2));
  });

  it("falls back to the full domain for an empty chapter list", () => {
    expect(beamFromChapterRange([], 0, 0)).toEqual({ startFraction: 0, endFraction: 1 });
  });
});
