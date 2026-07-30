import { describe, expect, it } from "vitest";
import {
  chapterPageFromGeometry,
  decideTurn,
  spreadCount,
  spreadIndex,
  type TurnGeometry,
} from "./pageTurn.js";

/** A section of `pages` page views, sitting on page view `at` (0-based). */
function geometry(at: number, pages: number, error = 0): TurnGeometry {
  const delta = 1025;
  return {
    delta,
    clientWidth: delta,
    scrollWidth: pages * delta,
    scrollLeft: at * delta + error,
  };
}

describe("spreadIndex / spreadCount", () => {
  it("counts page views and locates the current one", () => {
    expect(spreadCount(geometry(0, 4))).toBe(4);
    expect(spreadIndex(geometry(2, 4))).toBe(2);
  });

  it("is unmoved by the sub-pixel scroll error a fractional zoom produces", () => {
    // +0.5555px per turn, measured live at a 0.9 device-scale factor.
    expect(spreadIndex(geometry(2, 4, 1.1111))).toBe(2);
    expect(spreadIndex(geometry(2, 4, -1.1111))).toBe(2);
  });

  it("clamps to the section", () => {
    expect(spreadIndex(geometry(9, 4))).toBe(3);
    expect(spreadIndex(geometry(-1, 4))).toBe(0);
  });

  it("survives a zero delta rather than dividing by it", () => {
    const g = { delta: 0, clientWidth: 0, scrollWidth: 0, scrollLeft: 0 };
    expect(spreadCount(g)).toBe(1);
    expect(spreadIndex(g)).toBe(0);
  });
});

describe("chapterPageFromGeometry", () => {
  it("reads 1-based, and reaches the total on the last page view", () => {
    expect(chapterPageFromGeometry(geometry(0, 4))).toEqual({ page: 1, total: 4 });
    expect(chapterPageFromGeometry(geometry(3, 4))).toEqual({ page: 4, total: 4 });
  });

  it("does not lose a page to a negative sub-pixel error", () => {
    // epub.js's own Math.floor(start / pageWidth) reports 3 of 4 here.
    expect(chapterPageFromGeometry(geometry(3, 4, -0.6))).toEqual({
      page: 4,
      total: 4,
    });
  });
});

describe("decideTurn", () => {
  it("scrolls to the next page view inside the section", () => {
    expect(decideTurn("next", geometry(0, 4))).toEqual({ kind: "scroll", offset: 1025 });
    expect(decideTurn("next", geometry(1, 4))).toEqual({ kind: "scroll", offset: 2050 });
  });

  it("reaches the last page view of the section — the page that was skipped", () => {
    // The exact case measured live: page view 2 of 0..3, where epub.js's
    // `left <= scrollWidth` is an exact equality and lost to a +1.11px error.
    expect(decideTurn("next", geometry(2, 4, 1.1111))).toEqual({
      kind: "scroll",
      offset: 3075,
    });
  });

  it("advances the section only from the last page view", () => {
    expect(decideTurn("next", geometry(3, 4))).toEqual({ kind: "section" });
    expect(decideTurn("next", geometry(3, 4, 1.1111))).toEqual({ kind: "section" });
    expect(decideTurn("next", geometry(3, 4, -1.1111))).toEqual({ kind: "section" });
  });

  it("advances the section from a single-page-view section", () => {
    expect(decideTurn("next", geometry(0, 1))).toEqual({ kind: "section" });
  });

  it("steps back a page view, then into the previous section", () => {
    expect(decideTurn("prev", geometry(2, 4))).toEqual({ kind: "scroll", offset: 1025 });
    expect(decideTurn("prev", geometry(1, 4))).toEqual({ kind: "scroll", offset: 0 });
    expect(decideTurn("prev", geometry(0, 4))).toEqual({ kind: "section" });
    // A positive error at the first page view must not eat the turn: epub.js's
    // own `left > 0` test scrolls to a clamped 0 and does nothing visible.
    expect(decideTurn("prev", geometry(0, 4, 0.6))).toEqual({ kind: "section" });
  });

  it("tolerates a half-pixel content width in spread mode", () => {
    // An odd container width makes delta / 2 (a column) fractional, so the
    // expanded content width lands half a pixel short of a whole page view.
    const g = { delta: 1025, clientWidth: 1025, scrollWidth: 4100 - 0.5, scrollLeft: 2050 };
    expect(decideTurn("next", g)).toEqual({ kind: "scroll", offset: 3075 });
  });
});
