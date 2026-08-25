import { describe, expect, it } from "vitest";
import { drawCostP90 } from "./drawCost.js";

/**
 * The traces these are written against are the ones decisions.md 2026-08-03
 * (step 4) recorded on real hardware. They are the whole reason the guard
 * moved off the median, so they belong in the suite rather than only in prose.
 */

/** A click/keyboard turn: `SWEEP_OVERSHOOT` 2.2 means roughly half the drawn
 * frames land after the sheet has left the leaf and cost nothing, and the peak
 * frame — the one the reader is looking at — is 27.8ms. */
const KEYBOARD_TURN = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0.9, 1.4, 2.2, 3.6, 5.8, 8.1, 10.4, 12.6, 15.1, 18.3,
  21.7, 24.9, 27.8,
];

/** The same fold held out in a real drag: no dead tail, so the distribution is
 * the fold's actual working cost throughout. */
const HELD_DRAG = Array.from({ length: 104 }, (_, i) => 4 + (i % 17) * 0.55);

describe("drawCostP90", () => {
  it("sees the peak frame the median cannot", () => {
    const sorted = [...KEYBOARD_TURN].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    // The measured numbers, and the reason the guard was blind: the median of
    // this turn is 0.9ms against a 33ms threshold, so it reported ~37x of
    // headroom on a fold whose worst frame has ~1.2x.
    expect(median).toBeCloseTo(0.9, 5);
    expect(drawCostP90(KEYBOARD_TURN)).toBeCloseTo(21.7, 5);
    expect(drawCostP90(KEYBOARD_TURN)).toBeGreaterThan(median * 10);
  });

  it("reads a keyboard turn and a held drag of the same fold within ~2x", () => {
    // The acceptance criterion for the change: today the two differ by 7x,
    // because one is mostly dead frames and the other is not. A guard that
    // cannot recognize the same fold through two input methods cannot be
    // trusted to latch a downgrade for the session.
    const keyboard = drawCostP90(KEYBOARD_TURN);
    const drag = drawCostP90(HELD_DRAG);
    const ratio = Math.max(keyboard, drag) / Math.min(keyboard, drag);
    expect(ratio).toBeLessThan(2);

    // ...where the medians differ by far more, which is the bug.
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
    expect(med(HELD_DRAG) / med(KEYBOARD_TURN)).toBeGreaterThan(7);
  });

  it("is not moved by one frame a garbage collection landed on", () => {
    // The property the median was chosen for in the first place, and which
    // p90 has to keep: a downgrade that never clears must not be decided by a
    // single outlier.
    const clean = Array.from({ length: 40 }, () => 6);
    const withHitch = [...clean.slice(0, 39), 400];
    expect(drawCostP90(withHitch)).toBe(drawCostP90(clean));
  });

  it("reports zero for no samples rather than NaN", () => {
    // A fold that never drew is not a slow fold. The >= 12 sample floor in the
    // hook is what actually guards this, but the statistic must not produce a
    // NaN that compares false against every threshold.
    expect(drawCostP90([])).toBe(0);
  });

  it("returns an actual observed cost, never an interpolation between two", () => {
    // Nearest-rank: the number traced in dev is a frame that really happened,
    // which is what makes the dev line comparable to a profiler's.
    const costs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    expect(costs).toContain(drawCostP90(costs));
  });
});
