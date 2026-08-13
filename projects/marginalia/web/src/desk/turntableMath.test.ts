import { describe, expect, it } from "vitest";
import {
  angleForStylusRadius,
  angularVelocity,
  isOverPlatter,
  PLATTER_RPM,
  spinUp,
  stylusPosition,
  stylusRadius,
  tonearmAngle,
  turntableLayout,
} from "./turntableMath.js";

/** The tool's own rect at the size `ListeningTool.module.css`'s `.is3D` gives
 * it, plus two other proportions, because the whole point of solving the arm's
 * angles rather than choosing them is that they hold at any size. */
const SIZES: readonly [number, number][] = [
  [152, 132],
  [110, 110],
  [240, 150],
];

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height };
}

describe("isOverPlatter", () => {
  const tool = rect(32, 700, 152, 132);

  it("takes a book whose centre is on the deck", () => {
    // A 168×252 book centred on the tool.
    expect(isOverPlatter(rect(32 + 76 - 84, 700 + 66 - 126, 168, 252), tool)).toBe(true);
  });

  it("ignores a book that merely overlaps a corner", () => {
    // Touching the tool's top-left corner, centre far away — the failure the
    // rectangle test would have had, and the reason this target is a circle.
    expect(isOverPlatter(rect(32 - 160, 700 - 244, 168, 252), tool)).toBe(false);
  });

  it("is measured from the book's centre, not the cursor or the corner", () => {
    const inscribed = Math.min(tool.width, tool.height) / 2;
    const toolCx = tool.left + tool.width / 2;
    const toolCy = tool.top + tool.height / 2;
    // Just inside and just outside the accepting radius, along a diagonal.
    const at = (distance: number) => {
      const offset = distance / Math.SQRT2;
      return rect(toolCx + offset - 84, toolCy + offset - 126, 168, 252);
    };
    expect(isOverPlatter(at(inscribed + 20), tool)).toBe(true);
    expect(isOverPlatter(at(inscribed + 40), tool)).toBe(false);
  });

  it("still answers for the 2D tool, which is a much smaller button", () => {
    // The SVG presentation (reduced motion, lost context). The gesture is a
    // DOM gesture and must work in both — just over a tighter target.
    const small = rect(32, 760, 62, 74);
    const cx = small.left + small.width / 2;
    const cy = small.top + small.height / 2;
    expect(isOverPlatter(rect(cx - 84, cy - 126, 168, 252), small)).toBe(true);
    expect(isOverPlatter(rect(cx - 84 + 90, cy - 126, 168, 252), small)).toBe(false);
  });
});

describe("the platter", () => {
  it("turns at 33⅓ rpm", () => {
    expect(PLATTER_RPM).toBeCloseTo(33.3333, 3);
    // One revolution takes 1.8s.
    expect((2 * Math.PI) / angularVelocity(PLATTER_RPM)).toBeCloseTo(1.8, 6);
  });

  it("runs up toward speed and coasts down to a stop, never overshooting", () => {
    const target = angularVelocity(PLATTER_RPM);
    let speed = 0;
    // ~6.7s of frames: long enough that an exponential approach has arrived.
    for (let i = 0; i < 400; i += 1) {
      const next = spinUp(speed, target, 1 / 60);
      expect(next).toBeGreaterThan(speed);
      expect(next).toBeLessThanOrEqual(target);
      speed = next;
    }
    expect(speed).toBeCloseTo(target, 3);

    for (let i = 0; i < 200; i += 1) {
      const next = spinUp(speed, 0, 1 / 60);
      expect(next).toBeLessThan(speed);
      expect(next).toBeGreaterThanOrEqual(0);
      speed = next;
    }
    expect(speed).toBeLessThan(0.01);
  });

  it("takes a moment to get there — a platter has mass", () => {
    const target = angularVelocity(PLATTER_RPM);
    // One frame in, it is nowhere near speed.
    expect(spinUp(0, target, 1 / 60)).toBeLessThan(target * 0.1);
    // Half a second in, it is well on its way but not yet there.
    let speed = 0;
    for (let i = 0; i < 30; i += 1) speed = spinUp(speed, target, 1 / 60);
    expect(speed).toBeGreaterThan(target * 0.5);
    expect(speed).toBeLessThan(target * 0.95);
  });
});

describe("the tonearm", () => {
  it("parks clear of the record and plays in its outer third, at every deck size", () => {
    for (const [width, height] of SIZES) {
      const layout = turntableLayout(width, height);
      const r = layout.platterRadius;
      // Parked: off the record entirely. An arm resting on a stopped record is
      // the one thing every owner of one is trained not to do.
      expect(stylusRadius(layout, layout.parkedAngle)).toBeGreaterThan(r);
      // Playing: in the outer third of the groove area, where a side starts.
      const playing = stylusRadius(layout, layout.playingAngle);
      expect(playing).toBeGreaterThan(r * 0.7);
      expect(playing).toBeLessThan(r);
      // Run-out: inside that, and still not at the spindle.
      const runout = stylusRadius(layout, layout.runoutAngle);
      expect(runout).toBeLessThan(playing);
      expect(runout).toBeGreaterThan(r * 0.4);
    }
  });

  it("stays on its own side of the deck rather than swinging across the record", () => {
    // The other root of the same equation reaches the same radius by crossing
    // the platter from behind, which looks like a broken machine. Both the
    // parked and playing positions must sit on the post's side of the spindle.
    for (const [width, height] of SIZES) {
      const layout = turntableLayout(width, height);
      for (const angle of [layout.parkedAngle, layout.playingAngle, layout.runoutAngle]) {
        const { z } = stylusPosition(layout, angle);
        expect(z).toBeGreaterThan(layout.postZ);
      }
    }
  });

  it("sweeps park → play in one direction, without doubling back", () => {
    for (const [width, height] of SIZES) {
      const layout = turntableLayout(width, height);
      let previous = stylusRadius(layout, tonearmAngle(layout, 0, 0));
      for (let i = 1; i <= 20; i += 1) {
        const radius = stylusRadius(layout, tonearmAngle(layout, i / 20, 0));
        expect(radius).toBeLessThan(previous);
        previous = radius;
      }
    }
  });

  it("creeps inward while playing, and never reaches the run-out in a sitting", () => {
    const layout = turntableLayout(152, 132);
    const start = stylusRadius(layout, tonearmAngle(layout, 1, 0));
    const later = stylusRadius(layout, tonearmAngle(layout, 1, 120));
    const muchLater = stylusRadius(layout, tonearmAngle(layout, 1, 100_000));
    expect(later).toBeLessThan(start);
    expect(muchLater).toBeLessThan(later);
    // Capped at the run-out, not past it: an arm that walks off the record
    // while a book is still being read would be telling the truth about
    // nothing.
    expect(muchLater).toBeGreaterThanOrEqual(stylusRadius(layout, layout.runoutAngle) - 1e-9);
  });

  it("does not creep at all while parked", () => {
    const layout = turntableLayout(152, 132);
    expect(tonearmAngle(layout, 0, 0)).toBeCloseTo(layout.parkedAngle, 9);
    expect(tonearmAngle(layout, 0, 5000)).toBeCloseTo(layout.parkedAngle, 9);
  });

  it("answers with the nearest reachable angle rather than NaN for an impossible target", () => {
    const layout = turntableLayout(152, 132);
    for (const target of [0, 1e6, -5]) {
      const angle = angleForStylusRadius(layout, target);
      expect(Number.isFinite(angle)).toBe(true);
      expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI);
    }
  });
});

