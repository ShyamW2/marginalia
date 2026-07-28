import { describe, expect, it } from "vitest";
import { clampPan, fractionToView, MAX_ZOOM, MIN_ZOOM, panByViewFraction, zoomIn, zoomOut } from "./zoom.js";

describe("clampPan", () => {
  it("clamps to 0 at zoom 1 (the whole domain is always visible)", () => {
    expect(clampPan(0.4, 1)).toBe(0);
    expect(clampPan(-1, 1)).toBe(0);
  });

  it("clamps so the view never runs past the domain's right edge", () => {
    expect(clampPan(0.9, 2)).toBeCloseTo(0.5, 5); // view width 0.5, max pan 0.5
  });

  it("clamps negative pan to 0", () => {
    expect(clampPan(-0.2, 3)).toBe(0);
  });
});

describe("zoomIn/zoomOut", () => {
  it("zoomIn increases zoom, bounded by MAX_ZOOM", () => {
    let state = { zoom: 1, pan: 0 };
    for (let i = 0; i < 20; i++) state = zoomIn(state);
    expect(state.zoom).toBe(MAX_ZOOM);
  });

  it("zoomOut decreases zoom back to exactly MIN_ZOOM/pan 0, no float residue", () => {
    let state = zoomIn({ zoom: 1, pan: 0 });
    for (let i = 0; i < 20; i++) state = zoomOut(state);
    expect(state).toEqual({ zoom: MIN_ZOOM, pan: 0 });
  });

  it("keeps the view's center fixed across a zoom-in/zoom-out round trip", () => {
    const start = { zoom: 2, pan: 0.3 };
    const center = start.pan + 0.5 / start.zoom;
    const zoomedIn = zoomIn(start);
    const centerAfter = zoomedIn.pan + 0.5 / zoomedIn.zoom;
    expect(centerAfter).toBeCloseTo(center, 5);
  });
});

describe("panByViewFraction", () => {
  it("does nothing at zoom 1 (pan is always clamped to 0)", () => {
    const result = panByViewFraction({ zoom: 1, pan: 0 }, 1);
    expect(result.pan).toBe(0);
  });

  it("moves by a fraction of the current view width, not the whole domain", () => {
    const state = { zoom: 4, pan: 0.1 }; // view width 0.25
    const result = panByViewFraction(state, 0.5); // half a view-width
    expect(result.pan).toBeCloseTo(0.1 + 0.125, 5);
  });

  it("stays within bounds when panning past the edge", () => {
    const result = panByViewFraction({ zoom: 4, pan: 0.7 }, 1);
    expect(result.pan).toBeCloseTo(0.75, 5); // clamp for zoom 4 is 1 - 0.25
  });
});

describe("fractionToView", () => {
  it("is the identity at zoom 1, pan 0", () => {
    expect(fractionToView(0.42, { zoom: 1, pan: 0 })).toBeCloseTo(0.42, 5);
  });

  it("maps the visible window's edges to 0 and 1", () => {
    const state = { zoom: 2, pan: 0.25 }; // view is [0.25, 0.75]
    expect(fractionToView(0.25, state)).toBeCloseTo(0, 5);
    expect(fractionToView(0.75, state)).toBeCloseTo(1, 5);
  });

  it("maps content outside the view to outside [0, 1]", () => {
    const state = { zoom: 2, pan: 0.25 };
    expect(fractionToView(0.9, state)).toBeGreaterThan(1);
    expect(fractionToView(0.1, state)).toBeLessThan(0);
  });
});
