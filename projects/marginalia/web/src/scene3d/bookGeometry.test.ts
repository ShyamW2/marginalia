import { describe, expect, it } from "vitest";
import { spineArc, spineBulge } from "./bookGeometry.js";

/**
 * Where `CylinderGeometry` puts the vertex at angle `theta`, in the x/z plane
 * its own source uses (`x = r·sin θ`, `z = r·cos θ`), offset by where the arc's
 * centre sits on the book's x axis. Written out here rather than imported so
 * the test pins the contract with three.js, not three.js's arithmetic with
 * itself: if that convention ever changes, this fails and `Book3D.tsx`'s
 * placement is wrong.
 */
function arcPoint(arc: ReturnType<typeof spineArc>, t: number): { x: number; z: number } {
  const theta = arc.thetaStart + arc.thetaLength * t;
  return { x: arc.centerX + arc.radius * Math.sin(theta), z: arc.radius * Math.cos(theta) };
}

describe("spineArc", () => {
  it("puts its apex on the book's own left bound, so nothing hangs outside the footprint", () => {
    // The whole footprint invariant rests on this: on the Desk, x ∈ [0, width]
    // is the DOM hit target (deskDepthMath.ts).
    for (const [thickness, bulge] of [
      [22, 7.5],
      [17, 6.8],
      [30, 7.5],
      [12, 6],
    ]) {
      const apex = arcPoint(spineArc(thickness, bulge), 0.5);
      expect(apex.x).toBeCloseTo(0, 6);
      expect(apex.z).toBeCloseTo(0, 6);
    }
  });

  it("lands its ends exactly on the boards' outer corners", () => {
    const thickness = 22;
    const bulge = 7.5;
    const arc = spineArc(thickness, bulge);
    const start = arcPoint(arc, 0);
    const end = arcPoint(arc, 1);
    for (const point of [start, end]) {
      expect(point.x).toBeCloseTo(bulge, 6);
      expect(Math.abs(point.z)).toBeCloseTo(thickness / 2, 6);
    }
    // Ends on opposite faces of the book, not doubled up on one.
    expect(Math.sign(start.z)).toBe(-Math.sign(end.z));
  });

  it("never reaches past the boards it joins", () => {
    const thickness = 22;
    const bulge = 7.5;
    const arc = spineArc(thickness, bulge);
    for (let i = 0; i <= 40; i += 1) {
      const point = arcPoint(arc, i / 40);
      // Inside the footprint, and inside the book's own thickness — the two
      // claims Book3D's docstring makes about what a book's bounds are.
      expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      expect(point.x).toBeLessThanOrEqual(bulge + 1e-9);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(thickness / 2 + 1e-9);
    }
  });

  it("degenerates to a true half-round at a bulge of half the thickness, and clamps past it", () => {
    const halfRound = spineArc(22, 11);
    expect(halfRound.radius).toBeCloseTo(11, 6);
    expect(halfRound.thetaLength).toBeCloseTo(Math.PI, 6);
    // A deeper bulge cannot reach the corners without bending back; clamped
    // rather than producing a NaN radius or an arc that swallows the covers.
    expect(spineArc(22, 40)).toEqual(halfRound);
  });

  it("survives degenerate inputs without NaN", () => {
    for (const arc of [spineArc(0, 0), spineArc(-5, -5), spineArc(20, 0)]) {
      expect(Number.isFinite(arc.radius)).toBe(true);
      expect(Number.isFinite(arc.centerX)).toBe(true);
      expect(Number.isFinite(arc.thetaStart)).toBe(true);
      expect(Number.isFinite(arc.thetaLength)).toBe(true);
    }
  });
});

describe("spineBulge", () => {
  it("keeps the covers within a few percent of their source aspect", () => {
    // The Desk's own footprint, across deskDepthMath's whole thickness range.
    for (const thickness of [17, 22, 30]) {
      const lost = spineBulge(168, thickness) / 168;
      expect(lost).toBeGreaterThan(0.02);
      expect(lost).toBeLessThan(0.05);
    }
  });

  it("stays a shallow back, never deeper than the arc can join", () => {
    for (const thickness of [8, 17, 22, 30, 60]) {
      expect(spineBulge(168, thickness)).toBeLessThanOrEqual(thickness / 2);
    }
  });
});
