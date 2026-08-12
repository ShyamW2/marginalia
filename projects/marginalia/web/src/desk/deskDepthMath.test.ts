import { describe, expect, it } from "vitest";
import { bookTilt, stackElevation } from "./deskDepthMath.js";

describe("bookTilt", () => {
  it("is flat at the pivot", () => {
    expect(bookTilt(500, 500, 500, 500, Math.PI / 6, 400).angle).toBe(0);
  });

  it("reaches maxAngle exactly at the falloff distance", () => {
    const result = bookTilt(900, 500, 500, 500, Math.PI / 6, 400);
    expect(result.angle).toBeCloseTo(Math.PI / 6);
  });

  it("clamps past the falloff distance instead of continuing to grow", () => {
    const atFalloff = bookTilt(900, 500, 500, 500, Math.PI / 6, 400).angle;
    const wayPast = bookTilt(5000, 500, 500, 500, Math.PI / 6, 400).angle;
    expect(wayPast).toBeCloseTo(atFalloff);
  });

  it("grows linearly with distance below the falloff", () => {
    const half = bookTilt(700, 500, 500, 500, Math.PI / 6, 400).angle; // 200/400
    expect(half).toBeCloseTo((Math.PI / 6) / 2);
  });

  it("axis stays horizontal and snapped to exactly one of the book's own edges", () => {
    // Snapped rather than a free diagonal (see the function's own doc comment
    // for why a diagonal axis reveals a tapering, wedge-shaped sliver of the
    // book's side instead of a uniform one) — every axis is one of the four
    // cardinals, never a blend of both.
    const { axis } = bookTilt(900, 640, 500, 500, Math.PI / 6, 400);
    expect(axis[1]).toBe(0); // horizontal — never tilts around a vertical axis
    const nonZeroAxes = axis.filter((component) => component !== 0);
    expect(nonZeroAxes).toHaveLength(1);
    expect(Math.abs(nonZeroAxes[0])).toBe(1);
  });

  it("a book straight off the +X side of the pivot tilts about +Z", () => {
    const { axis } = bookTilt(900, 500, 500, 500, Math.PI / 6, 400);
    expect(axis[0]).toBeCloseTo(0);
    expect(axis[2]).toBeCloseTo(1);
  });

  it("a book straight off the +Z side of the pivot tilts about -X", () => {
    const { axis } = bookTilt(500, 900, 500, 500, Math.PI / 6, 400);
    expect(axis[0]).toBeCloseTo(-1);
    expect(axis[2]).toBeCloseTo(0);
  });

  it("picks the dominant offset axis rather than blending both", () => {
    // dx (400) dominates dz (50) — snaps to the width-edge-aligned axis
    // ([0,0,±1]) entirely, not a diagonal weighted toward it.
    const { axis } = bookTilt(900, 550, 500, 500, Math.PI / 6, 400);
    expect(axis).toEqual([0, 0, 1]);
  });

  it("treats a non-positive falloff as always flat rather than dividing by zero", () => {
    expect(bookTilt(900, 500, 500, 500, Math.PI / 6, 0).angle).toBe(0);
    expect(Number.isFinite(bookTilt(900, 500, 500, 500, Math.PI / 6, 0).angle)).toBe(true);
  });
});

describe("stackElevation", () => {
  it("is zero for the lowest z-order in the set", () => {
    expect(stackElevation(5, [5, 9, 20], 0.5)).toBe(0);
  });

  it("steps up by rank, not by the raw z-order gap", () => {
    // z-orders 5, 9, 20 — ranks 0, 1, 2 — regardless of the size of the gaps.
    expect(stackElevation(9, [5, 9, 20], 0.5)).toBeCloseTo(0.5);
    expect(stackElevation(20, [5, 9, 20], 0.5)).toBeCloseTo(1.0);
  });

  it("de-duplicates repeated z-orders before ranking", () => {
    expect(stackElevation(9, [5, 5, 9, 9, 20], 0.5)).toBeCloseTo(0.5);
  });

  it("is zero for a z-order not present in the set", () => {
    expect(stackElevation(999, [5, 9, 20], 0.5)).toBe(0);
  });
});
