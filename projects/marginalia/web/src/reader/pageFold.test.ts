import { describe, expect, it } from "vitest";
import {
  anchorForGrab,
  anchorPoint,
  computeFold,
  constrainFoldPointer,
  cornerPoint,
  curlArcLength,
  defaultCornerForDirection,
  deformPoint,
  leafSourceRect,
  lerpPoint,
  nearestCorner,
  oppositeCorner,
  samplePaperColor,
  syntheticFoldPointer,
  type Corner,
  type FoldAnchor,
  type Point,
} from "./pageFold.js";

const CORNERS: readonly Corner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
const ANCHORS: readonly FoldAnchor[] = [...CORNERS, { edge: "left" }, { edge: "right" }];

function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

describe("cornerPoint / oppositeCorner", () => {
  it("places each corner at the matching page-rect vertex", () => {
    expect(cornerPoint("topLeft", 100, 200)).toEqual({ x: 0, y: 0 });
    expect(cornerPoint("topRight", 100, 200)).toEqual({ x: 100, y: 0 });
    expect(cornerPoint("bottomLeft", 100, 200)).toEqual({ x: 0, y: 200 });
    expect(cornerPoint("bottomRight", 100, 200)).toEqual({ x: 100, y: 200 });
  });

  it("is its own involution", () => {
    for (const corner of CORNERS) {
      expect(oppositeCorner(oppositeCorner(corner))).toBe(corner);
    }
  });
});

describe("defaultCornerForDirection", () => {
  it("grabs the bottom corner of the turning edge", () => {
    expect(defaultCornerForDirection("next")).toBe("bottomRight");
    expect(defaultCornerForDirection("prev")).toBe("bottomLeft");
  });
});

describe("nearestCorner", () => {
  it("picks the top corner above the vertical midpoint", () => {
    expect(nearestCorner("left", 0, 400)).toBe("topLeft");
    expect(nearestCorner("left", 199, 400)).toBe("topLeft");
    expect(nearestCorner("right", 0, 400)).toBe("topRight");
  });

  it("picks the bottom corner at or below the vertical midpoint", () => {
    expect(nearestCorner("left", 200, 400)).toBe("bottomLeft");
    expect(nearestCorner("left", 400, 400)).toBe("bottomLeft");
    expect(nearestCorner("right", 300, 400)).toBe("bottomRight");
  });
});

describe("anchorForGrab / anchorPoint / constrainFoldPointer", () => {
  it("holds the edge itself when grabbed in its middle third", () => {
    expect(anchorForGrab("right", 200, 400)).toEqual({ edge: "right" });
    expect(anchorForGrab("right", 150, 400)).toEqual({ edge: "right" });
    expect(anchorForGrab("left", 250, 400)).toEqual({ edge: "left" });
  });

  it("falls back to the nearer corner outside that band", () => {
    expect(anchorForGrab("right", 0, 400)).toBe("topRight");
    expect(anchorForGrab("right", 130, 400)).toBe("topRight");
    expect(anchorForGrab("left", 280, 400)).toBe("bottomLeft");
    expect(anchorForGrab("left", 400, 400)).toBe("bottomLeft");
  });

  it("anchors an edge peel at the middle of that edge", () => {
    expect(anchorPoint({ edge: "left" }, 200, 400)).toEqual({ x: 0, y: 200 });
    expect(anchorPoint({ edge: "right" }, 200, 400)).toEqual({ x: 200, y: 200 });
    expect(anchorPoint("bottomRight", 200, 400)).toEqual({ x: 200, y: 400 });
  });

  it("pins an edge peel's fold pointer to the anchor's height, and leaves a pinch alone", () => {
    // This is the whole mechanism behind "the crease stays parallel to the
    // spine": peelDir is anchor→pointer, so equal heights make it horizontal.
    expect(constrainFoldPointer({ edge: "right" }, { x: 40, y: 30 }, 200, 400)).toEqual({
      x: 40,
      y: 200,
    });
    expect(constrainFoldPointer("bottomRight", { x: 40, y: 30 }, 200, 400)).toEqual({
      x: 40,
      y: 30,
    });
  });
});

describe("lerpPoint", () => {
  it("interpolates linearly between two points", () => {
    expect(lerpPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0)).toEqual({ x: 0, y: 0 });
    expect(lerpPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 1)).toEqual({ x: 10, y: 20 });
    expect(lerpPoint({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });
});

describe("curlArcLength", () => {
  it("scales with the leaf's short side, so the curl keeps its weight at any size", () => {
    expect(curlArcLength(400, 600)).toBeCloseTo(curlArcLength(400, 900), 6);
    expect(curlArcLength(800, 600)).toBeCloseTo(curlArcLength(400, 600) * 1.5, 6);
  });
});

describe("syntheticFoldPointer", () => {
  it("starts near the anchor corner just above progress 0", () => {
    const p = syntheticFoldPointer("bottomRight", 200, 300, 0);
    // Overshoot factor applies to a tiny non-zero t, so this stays close to
    // (200, 300) without landing exactly on it (which would make the fold
    // direction undefined).
    expect(p.x).toBeCloseTo(200, -1);
    expect(p.y).toBeCloseTo(300, -1);
  });

  it("sweeps past the opposite corner by progress 1, for a full flip", () => {
    const p = syntheticFoldPointer("bottomRight", 200, 300, 1);
    // Opposite corner of bottomRight on a 200x300 leaf is (0, 0); overshoot
    // pushes well past it.
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeLessThan(0);
  });

  it("moves monotonically further from the anchor corner as progress rises", () => {
    const corner = cornerPoint("bottomLeft", 200, 300);
    const dist = (progress: number) => {
      const p = syntheticFoldPointer("bottomLeft", 200, 300, progress);
      return Math.hypot(p.x - corner.x, p.y - corner.y);
    };
    expect(dist(0.2)).toBeLessThan(dist(0.5));
    expect(dist(0.5)).toBeLessThan(dist(0.9));
  });

  it("fully covers the leaf by progress 1 — no sliver of the old page survives", () => {
    // Found live under the flat fold: an undersized overshoot left the crease
    // short of the *opposite* corner (the last point of the rect to flip
    // sides), so a thin triangular sliver of the departing page stayed
    // visibly flat through the entire turn, however far progress climbed.
    // Pinned here for every corner and a few aspect ratios. The rolled sheet
    // moves the crease *further* from the corner than the flat fold did, so
    // it clears the diagonal sooner, but that is a reason to keep the check,
    // not to drop it. Edge anchors are in the sweep too: their crease is
    // parallel to the spine, so the last points to flip are the two far
    // corners rather than one, and the same overshoot has to clear them.
    for (const anchor of ANCHORS) {
      for (const [width, height] of [
        [200, 300],
        [300, 200],
        [500, 500],
      ] as const) {
        const pointer = syntheticFoldPointer(anchor, width, height, 1);
        const fold = computeFold(anchor, pointer, width, height);
        expect(fold?.restPolygon ?? []).toHaveLength(0);
      }
    }
  });
});

describe("computeFold", () => {
  it("returns null when the pointer coincides with the corner (no drag yet)", () => {
    expect(computeFold("bottomRight", { x: 200, y: 300 }, 200, 300)).toBeNull();
  });

  it("lands the grabbed corner exactly under the pointer", () => {
    // The property a drag lives or dies by: whatever the roll does with the
    // arc length in between, the corner you grabbed has to stay under your
    // finger. Checked for every corner, both a shallow and a deep drag, and
    // a roll big enough to matter.
    for (const corner of CORNERS) {
      const c = cornerPoint(corner, 480, 720);
      for (const pointer of [
        { x: 300, y: 500 },
        { x: 40, y: 120 },
        { x: 470, y: 30 },
      ]) {
        const fold = computeFold(corner, pointer, 480, 720)!;
        const landed = deformPoint(fold, c);
        expect(landed.x).toBeCloseTo(pointer.x, 4);
        expect(landed.y).toBeCloseTo(pointer.y, 4);
      }
    }
  });

  it("lands an edge-peel's anchor exactly under the pointer too", () => {
    // Same property, stated for the other kind of grab: the anchor moved off
    // the corner, and nothing else about the model did.
    for (const anchor of [{ edge: "left" as const }, { edge: "right" as const }]) {
      const a = anchorPoint(anchor, 480, 720);
      for (const raw of [
        { x: 300, y: 500 },
        { x: 40, y: 120 },
        { x: 470, y: 30 },
      ]) {
        const pointer = constrainFoldPointer(anchor, raw, 480, 720);
        const fold = computeFold(anchor, pointer, 480, 720)!;
        const landed = deformPoint(fold, a);
        expect(landed.x).toBeCloseTo(pointer.x, 4);
        expect(landed.y).toBeCloseTo(pointer.y, 4);
      }
    }
  });

  it("keeps an edge peel's crease parallel to the spine, however the pointer wanders", () => {
    // The point of the edge anchor: lifting the middle of an edge lifts the
    // whole edge, so the crease is vertical (parallel to the spine) whatever
    // the cursor's own height is doing.
    for (const raw of [
      { x: 300, y: 0 },
      { x: 120, y: 719 },
      { x: 40, y: 360 },
    ]) {
      const pointer = constrainFoldPointer({ edge: "right" }, raw, 480, 720);
      const fold = computeFold({ edge: "right" }, pointer, 480, 720)!;
      expect(Math.abs(fold.peelDir.y)).toBeCloseTo(0, 6);
      expect(Math.abs(fold.creaseDir.x)).toBeCloseTo(0, 6);
      // ...and the crease is a vertical line, so every point on it shares an x.
      expect(fold.creasePoint.y).toBeCloseTo(360, 6);
    }
  });

  it("degenerates to the old perpendicular-bisector fold at zero arc length", () => {
    // decisions.md 2026-07-20 specified the flat fold and 2026-08-01 replaced
    // it with the roll. The flat fold is this model with arc 0, and pinning
    // that keeps the amendment honest: the crease sits on the bisector and
    // the sheet is a plain mirror image.
    const corner = cornerPoint("bottomRight", 500, 400);
    const pointer = { x: 120, y: 260 };
    const fold = computeFold("bottomRight", pointer, 500, 400, 0)!;
    expect(fold.arc).toBe(0);
    expect(fold.creaseToCorner).toBeCloseTo(Math.hypot(500 - 120, 400 - 260) / 2, 6);
    const toCorner = Math.hypot(fold.creasePoint.x - corner.x, fold.creasePoint.y - corner.y);
    const toPointer = Math.hypot(fold.creasePoint.x - pointer.x, fold.creasePoint.y - pointer.y);
    expect(toCorner).toBeCloseTo(toPointer, 6);
    // Mirror image: a fold about a line is an isometry, so the flap keeps its
    // area exactly.
    const source = polygonArea([
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 400 },
      { x: 0, y: 400 },
    ]);
    expect(polygonArea(fold.restPolygon) + polygonArea(fold.tailPolygon)).toBeCloseTo(source, 4);
  });

  it("pushes the crease past the bisector by exactly the arc the roll consumes", () => {
    // The roll has to be paid for out of the peeled sheet: arc length that
    // goes round the curl is arc length the flat tail does not get, which is
    // the whole reason the crease is no longer the midpoint.
    const pointer = { x: 120, y: 260 };
    const flat = computeFold("bottomRight", pointer, 500, 400, 0)!;
    const rolled = computeFold("bottomRight", pointer, 500, 400, 60)!;
    expect(rolled.arc).toBe(60);
    expect(rolled.creaseToCorner).toBeGreaterThan(flat.creaseToCorner);
    // tailOffset is the roll's own contribution, so the shift is derivable
    // from the geometry rather than from the profile constants.
    const shift = (rolled.arc + rolled.tailOffset) / 2;
    expect(rolled.creaseToCorner - flat.creaseToCorner).toBeCloseTo(shift, 6);
  });

  it("clamps the roll to what has actually been peeled, early in a drag", () => {
    // A 4px drag cannot support a 60px roll: there is not enough lifted sheet
    // to wrap. Without the clamp the crease would run ahead of the pointer
    // and the fold would pop into existence at full size.
    const barely = computeFold("bottomRight", { x: 497, y: 400 }, 500, 400, 60)!;
    expect(barely.arc).toBeLessThan(60);
    expect(barely.arc).toBeGreaterThan(0);
    expect(barely.creaseToCorner).toBeLessThan(60);
    const opened = computeFold("bottomRight", { x: 200, y: 400 }, 500, 400, 60)!;
    expect(opened.arc).toBe(60);
  });

  it("orders the roll's offsets: crease, tail edge, then the silhouette", () => {
    const fold = computeFold("bottomRight", { x: 250, y: 200 }, 500, 400)!;
    expect(fold.tailOffset).toBeGreaterThan(0);
    expect(fold.peakOffset).toBeGreaterThan(fold.tailOffset);
    expect(fold.tailHeight).toBeGreaterThan(0);
    expect(fold.tailPolygon.length).toBeGreaterThanOrEqual(3);
    expect(fold.rollPolygon.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps peelDir and creaseDir a right-handed orthonormal pair", () => {
    // The paint routine enters the fold frame with a single `ctx.rotate`,
    // which is only valid because [-peelDir, creaseDir] is a rotation and not
    // a reflection. Flipping creaseDir's sign would mirror every band.
    const fold = computeFold("topLeft", { x: 310, y: 190 }, 500, 400)!;
    expect(Math.hypot(fold.peelDir.x, fold.peelDir.y)).toBeCloseTo(1, 9);
    expect(Math.hypot(fold.creaseDir.x, fold.creaseDir.y)).toBeCloseTo(1, 9);
    expect(fold.peelDir.x * fold.creaseDir.x + fold.peelDir.y * fold.creaseDir.y).toBeCloseTo(0, 9);
    const det = -fold.peelDir.x * fold.creaseDir.y - fold.creaseDir.x * -fold.peelDir.y;
    expect(det).toBeCloseTo(1, 9);
  });

  it("empties restPolygon once the pointer sweeps past the far edge (a full flip)", () => {
    const fold = computeFold("bottomRight", { x: -400, y: -400 }, 200, 200)!;
    expect(fold.restPolygon).toHaveLength(0);
  });
});

describe("leafSourceRect", () => {
  it("takes the whole bitmap in single-page mode, and says so", () => {
    // The `whole` flag is not cosmetic: it picks the cheap `drawImage`
    // overload for the ~10 blits a frame single-page reading actually does.
    expect(leafSourceRect(1200, 900, 0, 600, 600)).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 900,
      whole: true,
    });
  });

  it("takes only the turning leaf's half of a spread snapshot", () => {
    // The bug this exists for: the snapshot covers the stage, which in spread
    // mode is two pages in one epub.js iframe, and the fold peels one leaf.
    // Blitting the whole bitmap into the leaf's rect paints *both* pages
    // squeezed to half width on the sheet that turns.
    const stage = 1000;
    const leafWidth = (stage - 64) / 2; // SPREAD_GUTTER
    const right = leafSourceRect(2000, 1400, stage - leafWidth, leafWidth, stage);
    expect(right.x).toBeCloseTo(2 * (stage - leafWidth), 6);
    expect(right.width).toBeCloseTo(2 * leafWidth, 6);
    expect(right.height).toBe(1400);
    expect(right.whole).toBe(false);
    const left = leafSourceRect(2000, 1400, 0, leafWidth, stage);
    expect(left.whole).toBe(false);
    expect(left.x).toBe(0);
    expect(left.width).toBeCloseTo(2 * leafWidth, 6);
    // The two leaves must not overlap, or the fold shows the wrong page.
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1e-6);
  });

  it("survives a zero-width stage rather than producing a degenerate blit", () => {
    const rect = leafSourceRect(800, 600, 0, 0, 0);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe("samplePaperColor", () => {
  it("falls back to paper rather than throwing when the canvas cannot be read", () => {
    // jsdom has no 2D context, which is the same shape of failure as a
    // tainted canvas in the browser: a fold that quietly uses default paper
    // beats one that throws mid-turn.
    const image = document.createElement("canvas");
    expect(samplePaperColor(image, [10, 20, 30])).toEqual([10, 20, 30]);
  });
});
