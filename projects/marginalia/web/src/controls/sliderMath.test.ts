import { describe, expect, it } from "vitest";
import { clampValue, dragToValue, nearestDetent, positionToValue, quantize, valueToPosition } from "./sliderMath.js";

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
    expect(nearestDetent(2060, octaves, { fraction: 0.03 })).toBe(2048);
    expect(nearestDetent(2130, octaves, { fraction: 0.03 })).toBeNull();
  });

  it("the same relative window is proportionally wider at the top of the range", () => {
    // 131072 * 0.03 = ~3932 — an absolute distance that would fail at 2048
    // works here, proving the window scales with the detent's own value.
    expect(nearestDetent(128000, octaves, { fraction: 0.03 })).toBe(131072);
  });

  it("returns null with no detents nearby", () => {
    expect(nearestDetent(6000, octaves, { fraction: 0.03 })).toBeNull();
  });

  it("picks the closer of two candidate windows", () => {
    // Exactly between 4096 and 8192; window is generous enough that both
    // are technically in range at 0.5 fraction — closer one wins.
    expect(nearestDetent(6144, octaves, { fraction: 0.5 })).toBe(4096);
  });

  it("an absolute window holds the same width at both ends of a linear range", () => {
    // The response-length ask: ±25 either side of every 500. A fraction
    // can't be both 5% at 500 and 0.25% at 10,000 — an absolute window can.
    const detents500 = [500, 1000, 1500, 2000, 9000, 9500, 10000];
    expect(nearestDetent(524, detents500, { absolute: 25 })).toBe(500);
    expect(nearestDetent(526, detents500, { absolute: 25 })).toBeNull();
    expect(nearestDetent(9976, detents500, { absolute: 25 })).toBe(10000);
    expect(nearestDetent(9974, detents500, { absolute: 25 })).toBeNull();
  });
});

describe("quantize", () => {
  it("rounds to the nearest multiple of step", () => {
    expect(quantize(5000.6, 1)).toBe(5001);
    expect(quantize(0.813, 0.01)).toBeCloseTo(0.81);
  });

  it("leaves zero exactly zero — no floor introduced", () => {
    expect(quantize(0, 0.01)).toBe(0);
  });

  it("passes the value through unchanged with no step", () => {
    expect(quantize(1234.5, undefined)).toBe(1234.5);
  });
});

describe("dragToValue", () => {
  it("linear: matches the reader's progress dial's 6px-per-percent feel", () => {
    // 60px at 6px/percent = +10.
    expect(dragToValue(50, 60, 6, "linear", 0, 100, [], { fraction: 0 })).toBe(60);
    // Clamps at the top.
    expect(dragToValue(95, 600, 6, "linear", 0, 100, [], { fraction: 0 })).toBe(100);
    // Clamps at the bottom.
    expect(dragToValue(5, -600, 6, "linear", 0, 100, [], { fraction: 0 })).toBe(0);
  });

  it("log2: a fixed pixel distance is one octave regardless of starting value", () => {
    const pxPerOctave = 120;
    expect(dragToValue(1024, pxPerOctave, pxPerOctave, "log2", 1024, 200_000, [], { fraction: 0 })).toBeCloseTo(
      2048,
    );
    expect(
      dragToValue(65536, pxPerOctave, pxPerOctave, "log2", 1024, 200_000, [], { fraction: 0 }),
    ).toBeCloseTo(131072);
  });

  it("log2: snaps to an in-window detent while dragging", () => {
    const octaves = [1024, 2048, 4096, 8192];
    const pxPerOctave = 120;
    // Drag from 1024 by slightly less than a full octave — lands near 2048,
    // inside its capture window, so the detent wins over the raw value.
    const value = dragToValue(
      1024,
      pxPerOctave * 0.98,
      pxPerOctave,
      "log2",
      1024,
      200_000,
      octaves,
      { fraction: 0.03 },
    );
    expect(value).toBe(2048);
  });

  it("log2: a drag between detents is not force-snapped", () => {
    const octaves = [1024, 2048, 4096, 8192];
    const pxPerOctave = 120;
    // Halfway between 1024 and 2048 in log2-space — well outside either
    // detent's 3% window.
    const value = dragToValue(
      1024,
      pxPerOctave * 0.5,
      pxPerOctave,
      "log2",
      1024,
      200_000,
      octaves,
      { fraction: 0.03 },
    );
    expect(value).not.toBe(1024);
    expect(value).not.toBe(2048);
    expect(value).toBeCloseTo(1024 * Math.sqrt(2));
  });

  it("quantises to step before detent capture, so a float drag still commits an int", () => {
    // 61.4px at 0.08px/token ~= 767.5 tokens raw — step 1 rounds it to a
    // whole token before anything else sees it (the response-length bug).
    const value = dragToValue(5000, 61.4, 0.08, "linear", 250, 10_000, [], { absolute: 25 }, 1);
    expect(Number.isInteger(value)).toBe(true);
  });

  it("an absolute detent window holds ±25 at both 500 and 10,000", () => {
    const detents = [500, 1000, 9500, 10000];
    // +24 from 500 (linear, 1px/unit) — inside the window.
    expect(dragToValue(500, 24, 1, "linear", 250, 10_000, detents, { absolute: 25 })).toBe(500);
    // +24 from 10000 clamps to 10000 — still the detent itself.
    expect(dragToValue(9976, 24, 1, "linear", 250, 10_000, detents, { absolute: 25 })).toBe(10000);
  });
});
