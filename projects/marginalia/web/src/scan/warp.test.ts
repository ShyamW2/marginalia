import { describe, expect, it } from "vitest";
import { computeWarpGeometry, displacementAt, unwarpPoint, warpPoint } from "./warp.js";

describe("computeWarpGeometry", () => {
  it("has zero maxPull at intensity 0 (no warp at all)", () => {
    expect(computeWarpGeometry(800, 260, 0).maxPull).toBe(0);
  });

  it("maxPull grows with intensity", () => {
    const half = computeWarpGeometry(800, 260, 0.5).maxPull;
    const full = computeWarpGeometry(800, 260, 1).maxPull;
    expect(full).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(0);
  });
});

describe("displacementAt", () => {
  it("is zero everywhere at intensity 0", () => {
    const geom = computeWarpGeometry(800, 260, 0);
    expect(displacementAt(0, 0, geom)).toEqual({ dx: 0, dy: 0 });
    expect(displacementAt(800, 260, geom)).toEqual({ dx: 0, dy: 0 });
  });

  it("is zero at the exact center and grows toward the corners", () => {
    const geom = computeWarpGeometry(800, 260, 1);
    const atCenter = displacementAt(geom.cx, geom.cy, geom);
    expect(Math.hypot(atCenter.dx, atCenter.dy)).toBeCloseTo(0, 5);
    const atCorner = displacementAt(0, 0, geom);
    expect(Math.hypot(atCorner.dx, atCorner.dy)).toBeGreaterThan(0);
  });

  it("points toward the center (a pull, not a push)", () => {
    const geom = computeWarpGeometry(800, 260, 1);
    // A point below and to the right of center: the pull should point up-left.
    const p = { x: geom.cx + 300, y: geom.cy + 90 };
    const { dx, dy } = displacementAt(p.x, p.y, geom);
    expect(dx).toBeLessThan(0);
    expect(dy).toBeLessThan(0);
  });

  it("saturates beyond the radius rather than growing without bound", () => {
    const geom = computeWarpGeometry(800, 260, 1);
    const atRadius = displacementAt(geom.cx + geom.r, geom.cy, geom);
    const wayBeyond = displacementAt(geom.cx + geom.r * 5, geom.cy, geom);
    expect(Math.hypot(wayBeyond.dx, wayBeyond.dy)).toBeCloseTo(
      Math.hypot(atRadius.dx, atRadius.dy),
      5,
    );
  });
});

describe("warpPoint", () => {
  it("is the identity at intensity 0", () => {
    const geom = computeWarpGeometry(800, 260, 0);
    expect(warpPoint(123, 45, geom)).toEqual({ x: 123, y: 45 });
  });

  it("leaves the exact center fixed", () => {
    const geom = computeWarpGeometry(800, 260, 1);
    const { x, y } = warpPoint(geom.cx, geom.cy, geom);
    expect(x).toBeCloseTo(geom.cx, 3);
    expect(y).toBeCloseTo(geom.cy, 3);
  });

  it("is self-consistent: the output's pull, sampled backward, lands on the source point", () => {
    const geom = computeWarpGeometry(800, 260, 1);
    const source = { x: 40, y: 30 }; // near a corner, where displacement is largest
    const { x, y } = warpPoint(source.x, source.y, geom);
    const { dx, dy } = displacementAt(x, y, geom);
    expect(x + dx).toBeCloseTo(source.x, 1);
    expect(y + dy).toBeCloseTo(source.y, 1);
  });

  it("moves every point radially outward from center, regardless of quadrant", () => {
    const geom = computeWarpGeometry(800, 260, 1);
    const quadrantPoints = [
      { x: geom.cx + 300, y: geom.cy + 90 },
      { x: geom.cx - 300, y: geom.cy + 90 },
      { x: geom.cx + 300, y: geom.cy - 90 },
      { x: geom.cx - 300, y: geom.cy - 90 },
    ];
    for (const raw of quadrantPoints) {
      const warped = warpPoint(raw.x, raw.y, geom);
      const rawDist = Math.hypot(raw.x - geom.cx, raw.y - geom.cy);
      const warpedDist = Math.hypot(warped.x - geom.cx, warped.y - geom.cy);
      expect(warpedDist).toBeGreaterThan(rawDist);
    }
  });

  it("stays bounded (never flies off to a wildly wrong position)", () => {
    const geom = computeWarpGeometry(800, 260, 1);
    const { x, y } = warpPoint(0, 0, geom);
    expect(Math.abs(x)).toBeLessThan(geom.width);
    expect(Math.abs(y)).toBeLessThan(geom.height);
  });
});

describe("unwarpPoint", () => {
  it("is the identity at intensity 0", () => {
    const geom = computeWarpGeometry(800, 260, 0);
    expect(unwarpPoint(123, 45, geom)).toEqual({ x: 123, y: 45 });
  });

  it("undoes warpPoint — the round trip returns the original point (M18's torch: turning a click back into a raw position)", () => {
    const geom = computeWarpGeometry(800, 260, 1);
    const points = [
      { x: 40, y: 30 },
      { x: 760, y: 230 },
      { x: geom.cx, y: geom.cy },
      { x: 700, y: 20 },
    ];
    for (const source of points) {
      const warped = warpPoint(source.x, source.y, geom);
      const roundTripped = unwarpPoint(warped.x, warped.y, geom);
      expect(roundTripped.x).toBeCloseTo(source.x, 1);
      expect(roundTripped.y).toBeCloseTo(source.y, 1);
    }
  });
});
