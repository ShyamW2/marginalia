import { describe, expect, it } from "vitest";
import {
  SHELF_BOOK_GAP,
  SHELF_EDGE_PADDING,
  layoutShelf,
  shelfBookSize,
  shelfCameraFrame,
  shelfPerspectiveDistance,
} from "./shelfLayout.js";

/** Where world point `(x, y, z)` lands on screen, under a camera built by
 * `shelfCameraFrame`. Written out longhand rather than driven through three.js
 * so the test proves the *frame*, not the library. */
function project(
  point: readonly [number, number, number],
  frame: ReturnType<typeof shelfCameraFrame>,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const [ex, ey, ez] = frame.position;
  const halfHeight = Math.tan((frame.fov * Math.PI) / 360);
  // Camera looks along −Z with +Y up, so view space is a pure translation.
  const vx = point[0] - ex;
  const vy = point[1] - ey;
  const distance = ez - point[2];
  const ndcX = vx / (distance * halfHeight * frame.aspect);
  const ndcY = vy / (distance * halfHeight);
  return {
    x: (ndcX + 1) * 0.5 * viewport.width,
    y: (1 - ndcY) * 0.5 * viewport.height,
  };
}

describe("shelfCameraFrame", () => {
  const viewport = { width: 1400, height: 900 };
  const frame = shelfCameraFrame(viewport.width, viewport.height, shelfPerspectiveDistance(viewport.height));

  it("maps the shelf plane to the viewport 1:1, corners included", () => {
    // A DOM point (x, y) is world (x, −y, 0) — this is the mapping every
    // consumer of this surface relies on to place 3D content from a DOM rect.
    for (const [domX, domY] of [
      [0, 0],
      [1400, 900],
      [0, 900],
      [1400, 0],
      [700, 450],
      [37, 812],
    ]) {
      const screen = project([domX, -domY, 0], frame, viewport);
      expect(screen.x).toBeCloseTo(domX, 6);
      expect(screen.y).toBeCloseTo(domY, 6);
    }
  });

  it("puts the eye in front of the plane, looking at it square on", () => {
    expect(frame.position[2]).toBeGreaterThan(0);
    expect(frame.target[2]).toBe(0);
    expect(frame.position[0]).toBe(frame.target[0]);
    expect(frame.position[1]).toBe(frame.target[1]);
  });

  it("shrinks what stands behind the plane, which is the whole depth cue", () => {
    // The far edge of a book's body, 200px back and off the optical axis.
    const front = project([1200, -450, 0], frame, viewport);
    const back = project([1200, -450, -200], frame, viewport);
    expect(back.x).toBeLessThan(front.x);
    expect(back.x).toBeGreaterThan(viewport.width / 2);
  });

  it("keeps the near plane in front of everything and the far plane past the deepest book", () => {
    expect(frame.near).toBeLessThan(frame.position[2] - 400);
    expect(frame.far).toBeGreaterThan(frame.position[2] + 400);
  });
});

describe("shelfPerspectiveDistance", () => {
  it("scales with the viewport but stays inside its band", () => {
    expect(shelfPerspectiveDistance(400)).toBe(700);
    expect(shelfPerspectiveDistance(900)).toBeCloseTo(1035);
    expect(shelfPerspectiveDistance(4000)).toBe(1500);
  });

  it("survives a zero-height viewport (a room measured before it lays out)", () => {
    expect(shelfPerspectiveDistance(0)).toBe(700);
    expect(shelfPerspectiveDistance(Number.NaN)).toBe(700);
  });
});

describe("shelfBookSize", () => {
  it("is deterministic, so a shelf doesn't reshuffle its own books between sessions", () => {
    expect(shelfBookSize("abc")).toEqual(shelfBookSize("abc"));
  });

  it("letters onto a band wide enough to read — wider than the desk's own thickness", () => {
    for (const id of ["abc", "def", "ghi", "a-much-longer-resource-id-0123456789"]) {
      expect(shelfBookSize(id).width).toBeGreaterThanOrEqual(34);
    }
  });

  it("varies height across the library, and keeps covers 2:3", () => {
    const sizes = ["abc", "def", "ghi", "jkl", "mno"].map(shelfBookSize);
    expect(new Set(sizes.map((s) => s.height)).size).toBeGreaterThan(1);
    for (const size of sizes) expect(size.depth).toBeCloseTo(size.height / 1.5, 0);
  });
});

describe("layoutShelf", () => {
  it("stands books left to right, touching, in the order given", () => {
    const { slots } = layoutShelf(["a", "b", "c"]);
    expect(slots.map((s) => s.resourceId)).toEqual(["a", "b", "c"]);
    expect(slots[0].left).toBe(SHELF_EDGE_PADDING);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].left).toBe(slots[i - 1].left + slots[i - 1].width + SHELF_BOOK_GAP);
    }
  });

  it("does not move a book because its neighbours changed size", () => {
    // Removing the *last* book must leave the others exactly where they were —
    // otherwise the shelf reshuffles under the cursor on every library change.
    const before = layoutShelf(["a", "b", "c"]);
    const after = layoutShelf(["a", "b"]);
    expect(after.slots).toEqual(before.slots.slice(0, 2));
  });

  it("centres a library too short to fill the room", () => {
    const row = layoutShelf(["a", "b"], 1400);
    const first = row.slots[0];
    const last = row.slots[row.slots.length - 1];
    expect(first.left).toBeGreaterThan(SHELF_EDGE_PADDING);
    // Within a px: the centring offset is rounded so books land on whole
    // pixels, which an odd remainder splits unevenly between the two margins.
    expect(Math.abs(first.left - (1400 - (last.left + last.width)))).toBeLessThanOrEqual(1);
  });

  it("left-aligns once the row outgrows the room, because that is when it scrolls", () => {
    const many = Array.from({ length: 40 }, (_, i) => `book-${i}`);
    expect(layoutShelf(many, 600).slots[0].left).toBe(SHELF_EDGE_PADDING);
  });

  it("pads both ends of the row", () => {
    const { slots, width } = layoutShelf(["a", "b"]);
    const last = slots[slots.length - 1];
    expect(width - (last.left + last.width)).toBe(SHELF_EDGE_PADDING);
  });

  it("fills its container rather than huddling when the library is short", () => {
    expect(layoutShelf(["a"], 1400).width).toBe(1400);
    expect(layoutShelf([], 1400).width).toBe(1400);
  });

  it("reports the tallest book, which is what the row has to be tall enough for", () => {
    const row = layoutShelf(["a", "b", "c"]);
    expect(row.tallest).toBe(Math.max(...row.slots.map((s) => s.height)));
  });

  it("handles an empty library", () => {
    expect(layoutShelf([]).slots).toEqual([]);
  });
});
