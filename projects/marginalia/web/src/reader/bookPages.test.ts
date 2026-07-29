import { describe, expect, it } from "vitest";
import {
  computeBookPageInfo,
  getSpreadDivisor,
  toSpreadAdjustedPage,
  toSpreadAdjustedTotal,
} from "./bookPages.js";

describe("toSpreadAdjustedPage / toSpreadAdjustedTotal", () => {
  it("is a no-op at divisor 1 (single-page mode)", () => {
    expect(toSpreadAdjustedPage(7, 1)).toBe(7);
    expect(toSpreadAdjustedTotal(8, 1)).toBe(8);
  });

  it("halves raw single-column numbers at divisor 2 (a real spread)", () => {
    // The exact case from the operator's report: raw "page 5 of 6" is
    // actually the last (and only fully-paired) spread of a 3-spread section.
    expect(toSpreadAdjustedPage(5, 2)).toBe(3);
    expect(toSpreadAdjustedTotal(6, 2)).toBe(3);
    expect(toSpreadAdjustedPage(1, 2)).toBe(1);
    expect(toSpreadAdjustedTotal(2, 2)).toBe(1);
  });
});

describe("getSpreadDivisor", () => {
  it("reads the manager's real layout divisor", () => {
    expect(getSpreadDivisor({ manager: { layout: { divisor: 2 } } })).toBe(2);
  });

  it("falls back to 1 when unavailable", () => {
    expect(getSpreadDivisor({})).toBe(1);
    expect(getSpreadDivisor(undefined)).toBe(1);
    expect(getSpreadDivisor({ manager: { layout: { divisor: 0 } } })).toBe(1);
  });
});

describe("computeBookPageInfo", () => {
  const weights = new Map([
    [0, 0.1],
    [1, 0.4],
    [2, 0.5],
  ]);

  it("returns null before any section weights are known", () => {
    expect(computeBookPageInfo(new Map(), new Map(), 0, 1)).toBeNull();
  });

  it("returns null when the current section isn't in the weight map", () => {
    expect(computeBookPageInfo(weights, new Map(), 5, 1)).toBeNull();
  });

  it("uses real measured pages for visited sections and estimates the rest", () => {
    // Section 0 measured at 10 real pages for weight 0.1 -> 100 pages/unit-weight.
    const real = new Map([[0, 10]]);
    const result = computeBookPageInfo(weights, real, 0, 3);
    expect(result).not.toBeNull();
    // current section offset is 0 (first section), so page = offset + chapterPage
    expect(result?.page).toBe(3);
    // total = 10 (real, section 0) + round(0.4*100) + round(0.5*100) = 10+40+50
    expect(result?.total).toBe(100);
  });

  it("offsets by preceding sections' real or estimated page counts", () => {
    const real = new Map([
      [0, 10],
      [1, 38],
    ]);
    // Calibration now uses both measured sections: (10+38)/(0.1+0.4) = 96/unit-weight.
    const result = computeBookPageInfo(weights, real, 2, 5);
    expect(result?.page).toBe(10 + 38 + 5);
    // total = 10 + 38 + round(0.5*96) = 10+38+48
    expect(result?.total).toBe(10 + 38 + 48);
  });

  it("increments page by exactly 1 across a section boundary once both sections are real-measured", () => {
    const real = new Map([
      [0, 10],
      [1, 16],
    ]);
    const lastPageOfSection0 = computeBookPageInfo(weights, real, 0, 10);
    const firstPageOfSection1 = computeBookPageInfo(weights, real, 1, 1);
    expect(firstPageOfSection1!.page - lastPageOfSection0!.page).toBe(1);
    expect(firstPageOfSection1!.total).toBe(lastPageOfSection0!.total);
  });

  it("floors an unmeasured, zero-weight section to a minimum of 1 page", () => {
    const w = new Map([
      [0, 0],
      [1, 1],
    ]);
    const real = new Map([[1, 20]]);
    const result = computeBookPageInfo(w, real, 1, 1);
    // section 0 unmeasured, weight 0 -> estimate floor of 1 page.
    expect(result?.page).toBe(1 + 1);
    expect(result?.total).toBe(1 + 20);
  });
});
