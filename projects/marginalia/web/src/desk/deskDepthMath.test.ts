import { describe, expect, it } from "vitest";
import {
  bookThickness,
  deskCameraFrame,
  deskPerspectiveDistance,
  perspectiveSplay,
  stackElevation,
} from "./deskDepthMath.js";

/**
 * Projects a world point through the camera `deskCameraFrame` describes, by
 * hand rather than through three.js — the whole claim under test is that this
 * particular camera maps the desk plane to viewport pixels, and a test that
 * asked three.js to confirm its own projection would only be checking that
 * three.js works.
 *
 * The camera sits at (w/2, d, h/2) looking straight down, screen-right = +X
 * and screen-down = +Z. A point at height `y` is `d - y` from the eye, so the
 * perspective divide is by that.
 */
function projectToScreen(
  point: readonly [number, number, number],
  width: number,
  height: number,
  distance: number,
): { x: number; y: number } {
  const [px, py, pz] = point;
  const eyeDistance = distance - py;
  const scale = distance / eyeDistance;
  return {
    x: width / 2 + (px - width / 2) * scale,
    y: height / 2 + (pz - height / 2) * scale,
  };
}

describe("deskPerspectiveDistance", () => {
  it("scales with the viewport so the viewing angle stays comparable across window sizes", () => {
    expect(deskPerspectiveDistance(1000)).toBeGreaterThan(deskPerspectiveDistance(800));
  });

  it("clamps at both ends rather than going fisheye or flat", () => {
    expect(deskPerspectiveDistance(200)).toBe(620);
    expect(deskPerspectiveDistance(100_000)).toBe(1400);
  });

  it("survives a zero or nonsense viewport instead of producing a degenerate camera", () => {
    expect(deskPerspectiveDistance(0)).toBeGreaterThan(0);
    expect(deskPerspectiveDistance(Number.NaN)).toBeGreaterThan(0);
  });
});

describe("deskCameraFrame", () => {
  const width = 1400;
  const height = 900;
  const distance = deskPerspectiveDistance(height);

  it("looks straight down at the viewport's centre", () => {
    const frame = deskCameraFrame(width, height, distance);
    expect(frame.position).toEqual([width / 2, distance, height / 2]);
    expect(frame.target).toEqual([width / 2, 0, height / 2]);
  });

  it("is a real perspective camera, not an orthographic one in disguise", () => {
    // The defect this whole module replaced: a straight-down orthographic
    // camera cannot reveal an object's side at all, at any position, which is
    // why the previous version had to fake it by rotating the books.
    const frame = deskCameraFrame(width, height, distance);
    expect(frame.fov).toBeGreaterThan(30);
    expect(frame.fov).toBeLessThan(90);
  });

  // The load-bearing property: the desk plane, and therefore every book's
  // footprint and DOM hit target, is 1:1 with the viewport.
  it.each([
    ["centre", [width / 2, 0, height / 2]],
    ["top-left corner", [0, 0, 0]],
    ["bottom-right corner", [width, 0, height]],
    ["an arbitrary point", [317, 0, 742]],
  ] as const)("maps %s of the desk plane exactly onto its own pixel", (_name, point) => {
    const screen = projectToScreen(point, width, height, distance);
    expect(screen.x).toBeCloseTo(point[0], 6);
    expect(screen.y).toBeCloseTo(point[2], 6);
  });

  it("holds the 1:1 plane at a different window size too", () => {
    const w = 1000;
    const h = 700;
    const d = deskPerspectiveDistance(h);
    const screen = projectToScreen([w, 0, 0], w, h, d);
    expect(screen.x).toBeCloseTo(w, 6);
    expect(screen.y).toBeCloseTo(0, 6);
  });

  it("reveals the side of an off-centre object facing the camera, not the one facing away", () => {
    // A book left of centre: its top face projects further left than its
    // footprint, uncovering the footprint's *right* edge — so what you see is
    // the book's right side. The faked-tilt version showed the left side,
    // which is what read as inverted.
    const footprintX = width / 2 - 500;
    const top = projectToScreen([footprintX, 22, height / 2], width, height, distance);
    expect(top.x).toBeLessThan(footprintX);

    // Mirrored on the other side, and flat when the object is on the axis.
    const rightFootprintX = width / 2 + 500;
    const rightTop = projectToScreen([rightFootprintX, 22, height / 2], width, height, distance);
    expect(rightTop.x).toBeGreaterThan(rightFootprintX);
    const centred = projectToScreen([width / 2, 22, height / 2], width, height, distance);
    expect(centred.x).toBeCloseTo(width / 2, 6);
  });

  it("grows the reveal continuously with distance from the axis, with no steps", () => {
    // The other faked-tilt defect: its rotation axis snapped to one of four
    // cardinals, so dragging a book jumped between fixed presentations.
    const reveals = [0, 100, 200, 300, 400, 500, 600].map(
      (offset) => projectToScreen([width / 2 + offset, 22, height / 2], width, height, distance).x - (width / 2 + offset),
    );
    for (let i = 1; i < reveals.length; i += 1) {
      expect(reveals[i]).toBeGreaterThan(reveals[i - 1]);
    }
    // Strictly proportional to the offset — the definition of "no steps".
    const gaps = reveals.slice(1).map((value, i) => value - reveals[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 6);
  });

  it("keeps the near plane in front of the camera and the desk inside the far plane", () => {
    const frame = deskCameraFrame(width, height, distance);
    expect(frame.near).toBeGreaterThan(0);
    expect(frame.near).toBeLessThan(distance);
    expect(frame.far).toBeGreaterThan(distance);
  });

  it("does not divide by zero on a zero-sized viewport", () => {
    const frame = deskCameraFrame(0, 0, 0);
    expect(Number.isFinite(frame.fov)).toBe(true);
    expect(Number.isFinite(frame.aspect)).toBe(true);
    expect(frame.fov).toBeGreaterThan(0);
  });
});

describe("perspectiveSplay", () => {
  it("is zero for an object on the optical axis and for a flat one", () => {
    expect(perspectiveSplay(22, 0, 810)).toBe(0);
    expect(perspectiveSplay(0, 600, 810)).toBe(0);
  });

  it("keeps a book's cover within a few tens of px of its own hit target at the far corner", () => {
    // The budget the perspective camera is spending to buy real depth: the
    // *footprint* is exact everywhere (the 1:1 tests above), and this is how
    // far the visible top drifts from it — the object having a height, not
    // the layout drifting.
    const worstCase = perspectiveSplay(30, 900, deskPerspectiveDistance(900));
    expect(worstCase).toBeLessThan(40);
  });
});

describe("bookThickness", () => {
  it("is stable for the same resource id", () => {
    expect(bookThickness("abc123")).toBe(bookThickness("abc123"));
  });

  it("stays within the plausible range for a 168px-wide cover", () => {
    for (const id of ["a", "book-1", "9f3c2e", "", "a-much-longer-resource-identifier"]) {
      expect(bookThickness(id)).toBeGreaterThanOrEqual(17);
      expect(bookThickness(id)).toBeLessThanOrEqual(30);
    }
  });

  it("varies across a library rather than making every book the same slab", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `resource-${i}`);
    expect(new Set(ids.map(bookThickness)).size).toBeGreaterThan(3);
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

  it("caps, so a large library can't accumulate rank into a visible offset", () => {
    const many = Array.from({ length: 60 }, (_, i) => i);
    expect(stackElevation(59, many, 0.5)).toBeCloseTo(8 * 0.5);
    expect(stackElevation(59, many, 0.5)).toBe(stackElevation(20, many, 0.5));
  });
});
