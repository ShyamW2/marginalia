import { describe, expect, it } from "vitest";
import {
  anchorPoint,
  computeConeFold,
  computeFold,
  coneLiftAt,
  curlArcLength,
  deformPoint,
  deformPointOnCone,
  spineEdgeForAnchor,
  type Corner,
  type FoldAnchor,
  type Point,
} from "./pageFold.js";

/**
 * M27, "the geometry grows an apex". The cone is the model over-the-spine
 * needs and the flat-crease roll cannot express — see `ConeFold` for the
 * proof it rests on. The renderer is still the flat one; these pin the pure
 * geometry ahead of it.
 */

const W = 600;
const H = 800;
const CORNERS: readonly Corner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

/** Drag depths well past the point where a tail exists, plus one shallow one. */
const DEPTHS = [0.15, 0.35, 0.6, 0.85];

/** A pointer dragged from `anchor` toward the opposite corner at `t` of the way. */
function draggedPointer(anchor: FoldAnchor, t: number): Point {
  const c = anchorPoint(anchor, W, H);
  // Aim at the opposite corner, which is the natural peel path.
  const to = { x: W - c.x, y: H - c.y };
  return { x: c.x + (to.x - c.x) * t, y: c.y + (to.y - c.y) * t };
}

function spineX(anchor: FoldAnchor): number {
  return spineEdgeForAnchor(anchor) === "left" ? 0 : W;
}

describe("spineEdgeForAnchor", () => {
  it("is always the edge opposite the grab, for corners and edges alike", () => {
    // One rule for both page modes — PAGE_CURL.md §2d. A single page is still
    // bound; it merely has no facing leaf to land on.
    expect(spineEdgeForAnchor("bottomRight")).toBe("left");
    expect(spineEdgeForAnchor("topRight")).toBe("left");
    expect(spineEdgeForAnchor("bottomLeft")).toBe("right");
    expect(spineEdgeForAnchor("topLeft")).toBe("right");
    expect(spineEdgeForAnchor({ edge: "right" })).toBe("left");
    expect(spineEdgeForAnchor({ edge: "left" })).toBe("right");
  });
});

describe("computeConeFold — the three invariants a bound sheet owes", () => {
  it("lands the grabbed anchor exactly under the pointer", () => {
    // The property a drag lives or dies by, carried over from the flat model.
    // Under a cone it is what *forces* the apex to be solved rather than given.
    for (const corner of CORNERS) {
      for (const t of DEPTHS) {
        const pointer = draggedPointer(corner, t);
        const cone = computeConeFold(corner, pointer, W, H);
        if (!cone) continue; // far field, covered by the flat model
        const landed = deformPointOnCone(cone, anchorPoint(corner, W, H));
        expect(landed.x).toBeCloseTo(pointer.x, 6);
        expect(landed.y).toBeCloseTo(pointer.y, 6);
      }
    }
  });

  it("never moves the spine edge, at any drag depth or anchor", () => {
    // The reason the whole model had to change: a cylinder lifts uniformly and
    // would tear a bound sheet off its binding. Here the spine is angle 0, so
    // it is fixed by construction rather than by a clamp.
    for (const corner of CORNERS) {
      for (const t of DEPTHS) {
        const cone = computeConeFold(corner, draggedPointer(corner, t), W, H);
        if (!cone) continue;
        const x = spineX(corner);
        for (const y of [0, H * 0.25, H * 0.5, H * 0.75, H]) {
          const moved = deformPointOnCone(cone, { x, y });
          expect(moved.x).toBeCloseTo(x, 6);
          expect(moved.y).toBeCloseTo(y, 6);
          // ...and it is not merely projecting back onto itself: it is flat.
          expect(coneLiftAt(cone, { x, y })).toBeCloseTo(0, 9);
        }
      }
    }
  });

  it("lifts nothing at the spine and most at the outer corner", () => {
    // The physical requirement the cone exists to satisfy. A cylinder's lift
    // is constant across the sheet; this one has to fall to zero at the
    // binding and grow with distance from the apex.
    const corner: Corner = "bottomRight";
    const cone = computeConeFold(corner, draggedPointer(corner, 0.6), W, H);
    expect(cone).not.toBeNull();
    const atSpine = coneLiftAt(cone!, { x: 0, y: H / 2 });
    const atOuter = coneLiftAt(cone!, anchorPoint(corner, W, H));
    expect(atSpine).toBeCloseTo(0, 9);
    expect(atOuter).toBeGreaterThan(0);
  });

  it("covers the whole leaf once the sweep has run past it", () => {
    // "The leaf is still fully covered by progress 1": no point of the leaf is
    // left lying flat once the anchor has swept beyond the far edge.
    const corner: Corner = "bottomRight";
    const c = anchorPoint(corner, W, H);
    const opposite = { x: 0, y: 0 };
    // The same overshoot the synthetic sweep uses to finish a flip.
    const pointer = {
      x: c.x + (opposite.x - c.x) * 2.2,
      y: c.y + (opposite.y - c.y) * 2.2,
    };
    const cone = computeConeFold(corner, pointer, W, H);
    expect(cone).not.toBeNull();
    // Every leaf point except the spine edge itself is past the crease.
    for (const x of [W * 0.05, W * 0.5, W]) {
      for (const y of [0, H * 0.5, H]) {
        expect(coneLiftAt(cone!, { x, y })).toBeGreaterThan(0);
      }
    }
  });
});

describe("computeConeFold — the far field is the flat-crease roll", () => {
  it("hands back null for a square pull, whose crease really is parallel to the spine", () => {
    // Not a failure: a straight pull out from the edge has its apex at
    // infinity, and the correct model for it is the one already shipped.
    const cone = computeConeFold({ edge: "right" }, { x: W - 300, y: H / 2 }, W, H);
    expect(cone).toBeNull();
  });

  it("converges on the flat model as the apex is pushed away along the spine", () => {
    // "Every existing property survives as the far-field degenerate case."
    // Drag an edge peel with a shrinking vertical component: the apex runs off
    // down the spine and the cone's answer approaches the flat model's.
    const anchor: FoldAnchor = { edge: "right" };
    const c = anchorPoint(anchor, W, H);
    const arc = curlArcLength(W, H);
    const probe = { x: W * 0.45, y: H * 0.5 };

    // Convergence is fast enough to reach the floating-point noise floor, so
    // "strictly decreasing" stops being meaningful once it is there.
    const NOISE = 1e-9;
    let previous = Infinity;
    for (const tilt of [40, 10, 2.5, 0.6]) {
      const pointer = { x: c.x - 300, y: c.y + tilt };
      const cone = computeConeFold(anchor, pointer, W, H, arc);
      expect(cone).not.toBeNull();
      const flat = computeFold(anchor, pointer, W, H, arc);
      expect(flat).not.toBeNull();

      const viaCone = deformPointOnCone(cone!, probe);
      const viaFlat = deformPoint(flat!, probe);
      const gap = Math.hypot(viaCone.x - viaFlat.x, viaCone.y - viaFlat.y);
      // Monotone convergence, not merely "small at the end".
      expect(gap).toBeLessThan(Math.max(previous, NOISE));
      previous = gap;
    }
    expect(previous).toBeLessThan(NOISE);
  });

  it("keeps an edge peel's crease parallel to the spine only in the far-field limit", () => {
    // ⚠️ This test changed meaning in M27 rather than being deleted. Under a
    // hinge the crease converges on the apex, so it is *not* parallel to the
    // spine — the flat model's version of this property is now a statement
    // about the limit. Measured as the spread in how far two points on the
    // same crease-side sit from the spine after deformation.
    const anchor: FoldAnchor = { edge: "right" };
    const c = anchorPoint(anchor, W, H);
    const spread = (tilt: number) => {
      const cone = computeConeFold(anchor, { x: c.x - 300, y: c.y + tilt }, W, H);
      if (!cone) return 0;
      const a = deformPointOnCone(cone, { x: W * 0.5, y: H * 0.2 });
      const b = deformPointOnCone(cone, { x: W * 0.5, y: H * 0.8 });
      return Math.abs(a.x - b.x);
    };
    // A pronounced hinge fans visibly; a nearly-square pull does not.
    expect(spread(120)).toBeGreaterThan(spread(3));
    expect(spread(0.5)).toBeLessThan(1);
  });
});
