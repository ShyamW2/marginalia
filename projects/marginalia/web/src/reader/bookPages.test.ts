import { describe, expect, it } from "vitest";
import {
  buildBookPageMap,
  lookupBookPage,
  recordMeasuredPages,
  type BookPageMap,
} from "./bookPages.js";

// Three sections, 10% / 40% / 50% of the book's text. `lengthPercent` is a
// fraction of the whole book, not a percentage — see bookPages.ts.
const weights = new Map([
  [0, 0.1],
  [1, 0.4],
  [2, 0.5],
]);

function build(): BookPageMap {
  // Section 1 measured at 40 pages for weight 0.4 -> 100 pages per unit weight.
  const map = buildBookPageMap(weights, 1, 40);
  if (!map) throw new Error("expected a map");
  return map;
}

describe("buildBookPageMap", () => {
  it("returns null without a weight to calibrate against", () => {
    expect(buildBookPageMap(new Map(), 0, 10)).toBeNull();
    expect(buildBookPageMap(weights, 5, 10)).toBeNull();
    expect(buildBookPageMap(new Map([[0, 0]]), 0, 10)).toBeNull();
  });

  it("refuses to calibrate off a section too small to learn anything from", () => {
    // A cover or a two-line interlude: one page whatever its length, so its
    // pages-per-weight is meaningless. Waiting is quieter than correcting.
    expect(buildBookPageMap(new Map([[0, 0.002], [1, 0.4]]), 0, 1)).toBeNull();
    expect(buildBookPageMap(weights, 1, 1)).toBeNull();
    // Two pages and half a percent of the book is enough.
    expect(buildBookPageMap(new Map([[0, 0.005], [1, 0.4]]), 0, 2)).not.toBeNull();
  });

  it("estimates every section from the calibrating measurement", () => {
    const map = build();
    expect(map.pages.get(0)).toBe(10);
    expect(map.pages.get(1)).toBe(40);
    expect(map.pages.get(2)).toBe(50);
    expect(map.total).toBe(100);
  });

  it("floors a zero-weight section at one page", () => {
    const map = buildBookPageMap(new Map([[0, 0], [1, 0.4]]), 1, 40);
    expect(map?.pages.get(0)).toBe(1);
    expect(map?.total).toBe(41);
  });
});

describe("lookupBookPage", () => {
  it("offsets by every preceding section", () => {
    const map = build();
    expect(lookupBookPage(map, 0, 3)).toEqual({ page: 3, total: 100 });
    expect(lookupBookPage(map, 1, 1)).toEqual({ page: 11, total: 100 });
    expect(lookupBookPage(map, 2, 5)).toEqual({ page: 55, total: 100 });
  });

  it("returns null for a section outside the map", () => {
    expect(lookupBookPage(build(), 7, 1)).toBeNull();
  });

  it("never reports a page past the total", () => {
    const map = build();
    expect(lookupBookPage(map, 2, 60)?.total).toBe(110);
  });
});

describe("recordMeasuredPages", () => {
  it("holds the total still by absorbing into later estimates", () => {
    const map = build();
    // Section 2 is really 44 pages, not the estimated 50.
    recordMeasuredPages(map, 2, 44);
    expect(map.pages.get(2)).toBe(44);
    // Nothing after it to absorb into, so the book is genuinely 6 shorter.
    expect(map.total).toBe(94);
  });

  it("does not move the total when a later estimate can absorb", () => {
    const map = build();
    recordMeasuredPages(map, 0, 16); // 6 more than estimated
    expect(map.pages.get(0)).toBe(16);
    expect(map.total).toBe(100);
    // Section 1 was already measured, so section 2 gives up the 6.
    expect(map.pages.get(2)).toBe(44);
    expect(map.pages.get(1)).toBe(40);
  });

  it("never moves a page number behind the reader", () => {
    const map = build();
    const before = lookupBookPage(map, 1, 7)!;
    recordMeasuredPages(map, 2, 61); // a later section, measured
    expect(lookupBookPage(map, 1, 7)!.page).toBe(before.page);
  });

  it("is +1 across a section boundary, in both directions", () => {
    const map = build();
    recordMeasuredPages(map, 0, 10);
    const lastOf0 = lookupBookPage(map, 0, 10)!;
    const firstOf1 = lookupBookPage(map, 1, 1)!;
    expect(firstOf1.page - lastOf0.page).toBe(1);
    expect(firstOf1.total).toBe(lastOf0.total);

    // And going back gives the number it gave before — the operator's
    // "52 -> 54, then back to '52' is counted as 53".
    recordMeasuredPages(map, 1, 40);
    expect(lookupBookPage(map, 0, 10)).toEqual(lastOf0);
  });

  it("grows the total only by what the tail cannot absorb", () => {
    const map = build();
    // Section 2 is estimated at 50, so it can give up at most 49.
    recordMeasuredPages(map, 0, 70); // 60 more than estimated
    expect(map.pages.get(2)).toBe(1);
    expect(map.total).toBe(100 + 11);
  });

  it("never re-calibrates, however far off the total turns out to be", () => {
    // The whole point: measuring a section is allowed to correct that section
    // and nothing else. A ratio derived from later sections would be a better
    // ratio, and using it would move every number the reader has already seen.
    const map = build();
    recordMeasuredPages(map, 0, 4); // section 0 is a quarter of its estimate
    // Section 2 keeps the estimate it was built with, plus the 6 it absorbed.
    expect(map.pages.get(2)).toBe(56);
    expect(map.total).toBe(100);
  });

  it("ignores a re-measurement of the same section at the same value", () => {
    const map = build();
    const total = map.total;
    recordMeasuredPages(map, 1, 40);
    expect(map.total).toBe(total);
  });
});
