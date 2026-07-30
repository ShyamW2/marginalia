import { describe, expect, it } from "vitest";
import { clampValue, dragToValue, nearestDetent, positionToValue, valueToPosition } from "./sliderMath.js";

describe("valueToPosition / positionToValue", () => {
  it("linear is the identity", () => {
    expect(valueToPosition(42, "linear")).toBe(42);
    expect(positionToValue(42, "linear")).toBe(42);
  });

  it("log2 round-trips through log2/2^x", () => {
    expect(valueToPosition(1024, "log2")).toBeCloseTo(10);
    expect(positionToValue(17, "log2")).toBeCloseTo(131072);
  });
});

describe("clampValue", () => {
  it("clamps into range", () => {
    expect(clampValue(-5, 0, 100)).toBe(0);
    expect(clampValue(500, 0, 100)).toBe(100);
    expect(clampValue(50, 0, 100)).toBe(50);
  });
});

describe("nearestDetent", () => {
  const octaves = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072];

  it("finds a detent within its percentage window, at the bottom of the range", () => {
    // 2048 * 0.03 = ~61.4 — 2060 is well inside, 2130 is not.
    expect(nearestDetent(2060, octaves, 0.03)).toBe(2048);
    expect(nearestDetent(2130, octaves, 0.03)).toBeNull();
  });

  it("the same relative window is proportionally wider at the top of the range", () => {
    // 131072 * 0.03 = ~3932 — an absolute distance that would fail at 2048
    // works here, proving the window scales with the detent's own value.
    expect(nearestDetent(128000, octaves, 0.03)).toBe(131072);
  });

  it("returns null with no detents nearby", () => {
    expect(nearestDetent(6000, octaves, 0.03)).toBeNull();
  });

  it("picks the closer of two candidate windows", () => {
    // Exactly between 4096 and 8192; window is generous enough that both
    // are technically in range at 0.5 fraction — closer one wins.
    expect(nearestDetent(6144, octaves, 0.5)).toBe(4096);
  });
});

describe("dragToValue", () => {
  it("linear: matches the reader's existing DIAL_PX_PER_PERCENT feel", () => {
    // 60px at 6px/percent = +10.
    expect(dragToValue(50, 60, 6, "linear", 0, 100, [], 0)).toBe(60);
    // Clamps at the top.
    expect(dragToValue(95, 600, 6, "linear", 0, 100, [], 0)).toBe(100);
    // Clamps at the bottom.
    expect(dragToValue(5, -600, 6, "linear", 0, 100, [], 0)).toBe(0);
  });

  it("log2: a fixed pixel distance is one octave regardless of starting value", () => {
    const pxPerOctave = 120;
    expect(dragToValue(1024, pxPerOctave, pxPerOctave, "log2", 1024, 200_000, [], 0)).toBeCloseTo(2048);
    expect(dragToValue(65536, pxPerOctave, pxPerOctave, "log2", 1024, 200_000, [], 0)).toBeCloseTo(131072);
  });

  it("log2: snaps to an in-window detent while dragging", () => {
    const octaves = [1024, 2048, 4096, 8192];
    const pxPerOctave = 120;
    // Drag from 1024 by slightly less than a full octave — lands near 2048,
    // inside its capture window, so the detent wins over the raw value.
    const value = dragToValue(1024, pxPerOctave * 0.98, pxPerOctave, "log2", 1024, 200_000, octaves, 0.03);
    expect(value).toBe(2048);
  });

  it("log2: a drag between detents is not force-snapped", () => {
    const octaves = [1024, 2048, 4096, 8192];
    const pxPerOctave = 120;
    // Halfway between 1024 and 2048 in log2-space — well outside either
    // detent's 3% window.
    const value = dragToValue(1024, pxPerOctave * 0.5, pxPerOctave, "log2", 1024, 200_000, octaves, 0.03);
    expect(value).not.toBe(1024);
    expect(value).not.toBe(2048);
    expect(value).toBeCloseTo(1024 * Math.sqrt(2));
  });
});
