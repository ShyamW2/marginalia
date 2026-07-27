import { describe, expect, it } from "vitest";
import { clampPanelOffset, panelTiltDeg } from "./panelGeometry.js";

describe("panelTiltDeg", () => {
  it("is deterministic for the same highlight id", () => {
    expect(panelTiltDeg("highlight-1")).toBe(panelTiltDeg("highlight-1"));
  });

  it("stays within the 0.5-1.5 degree magnitude in either direction", () => {
    for (const id of ["a", "b", "c", "some-uuid-1234", "another-one"]) {
      const tilt = panelTiltDeg(id);
      expect(Math.abs(tilt)).toBeGreaterThanOrEqual(0.5);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("clampPanelOffset", () => {
  const stageRect = { left: 0, right: 800, top: 0, bottom: 600 };

  it("leaves the offset unchanged when the panel is fully inside the stage", () => {
    const panelRect = { left: 100, right: 300, top: 100, bottom: 300 };
    expect(clampPanelOffset(panelRect, stageRect, 10, -5)).toEqual({ dx: 10, dy: -5 });
  });

  it("pulls the offset back when the panel overflows the right/bottom edge", () => {
    const panelRect = { left: 700, right: 900, top: 500, bottom: 700 };
    const result = clampPanelOffset(panelRect, stageRect, 50, 50);
    // 100px overflow right, 100px overflow bottom
    expect(result).toEqual({ dx: -50, dy: -50 });
  });

  it("pulls the offset back when the panel overflows the left/top edge", () => {
    const panelRect = { left: -20, right: 100, top: -30, bottom: 100 };
    const result = clampPanelOffset(panelRect, stageRect, -10, -10);
    expect(result).toEqual({ dx: 10, dy: 20 });
  });
});
