import { describe, expect, it } from "vitest";
import { clampZoomScale, computeFitScale, MAX_ZOOM_SCALE, MIN_ZOOM_SCALE, shouldShowSpread, wheelZoomTarget } from "./pdfLayout.js";

describe("shouldShowSpread", () => {
  it("is content-driven, not a fixed pixel breakpoint — a landscape slide needs a much wider container than a portrait paper before a spread pays off", () => {
    const portraitNaturalWidth = 612; // US letter, points
    const landscapeNaturalWidth = 960; // a typical slide-deck width, points

    // A container wide enough for the portrait paper's spread isn't
    // automatically wide enough for the landscape one's.
    const containerWidth = portraitNaturalWidth * 2 * 0.7; // comfortably above MIN_SPREAD_SCALE for portrait
    expect(shouldShowSpread(containerWidth, portraitNaturalWidth)).toBe(true);
    expect(shouldShowSpread(containerWidth, landscapeNaturalWidth)).toBe(false);
  });

  it("returns false for a zero or negative natural width or container width, rather than dividing by zero/Infinity", () => {
    expect(shouldShowSpread(1000, 0)).toBe(false);
    expect(shouldShowSpread(1000, -10)).toBe(false);
    expect(shouldShowSpread(0, 612)).toBe(false);
    expect(shouldShowSpread(-10, 612)).toBe(false);
  });
});

describe("computeFitScale", () => {
  it("fit-width ignores container height entirely", () => {
    const withTallHeight = computeFitScale("fit-width", 1000, 5000, 500, 700, 1);
    const withShortHeight = computeFitScale("fit-width", 1000, 100, 500, 700, 1);
    expect(withTallHeight).toBe(withShortHeight);
    expect(withTallHeight).toBe(2); // 1000 / (500 * 1)
  });

  it("fit-page is min(widthScale, heightScale), always <= fit-width for the same inputs", () => {
    const fitWidth = computeFitScale("fit-width", 1000, 400, 500, 700, 1);
    const fitPage = computeFitScale("fit-page", 1000, 400, 500, 700, 1);
    expect(fitPage).toBeLessThanOrEqual(fitWidth);
    expect(fitPage).toBeCloseTo(400 / 700); // height is the binding constraint here
  });

  it("halves the effective per-page width budget for a 2-up spread", () => {
    const single = computeFitScale("fit-width", 1000, 400, 500, 700, 1);
    const spread = computeFitScale("fit-width", 1000, 400, 500, 700, 2);
    expect(spread).toBeCloseTo(single / 2);
  });
});

describe("clampZoomScale", () => {
  it("clamps both ends and is idempotent", () => {
    expect(clampZoomScale(0.01)).toBeGreaterThan(0.01);
    expect(clampZoomScale(100)).toBeLessThan(100);
    const clamped = clampZoomScale(1.5);
    expect(clampZoomScale(clamped)).toBe(clamped);
  });
});

// M42 §D1.
describe("wheelZoomTarget", () => {
  it("zooms in for a negative deltaY (scroll up / pinch open) and out for a positive one", () => {
    expect(wheelZoomTarget(1, -100)).toBeGreaterThan(1);
    expect(wheelZoomTarget(1, 100)).toBeLessThan(1);
  });

  it("a zero delta is a no-op", () => {
    expect(wheelZoomTarget(1.3, 0)).toBeCloseTo(1.3);
  });

  it("is symmetric — zooming in then out by the same delta returns to the start", () => {
    const zoomedIn = wheelZoomTarget(1, -50);
    expect(wheelZoomTarget(zoomedIn, 50)).toBeCloseTo(1);
  });

  it("clamps to the same range as clampZoomScale, however large the delta", () => {
    expect(wheelZoomTarget(1, -100000)).toBe(MAX_ZOOM_SCALE);
    expect(wheelZoomTarget(1, 100000)).toBe(MIN_ZOOM_SCALE);
  });
});
