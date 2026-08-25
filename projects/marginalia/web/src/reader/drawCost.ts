/**
 * How a fold's cost is summarized into the one number the M10 low-fps
 * downgrade decides on.
 *
 * Its own module, small as it is, because the number has been wrong twice and
 * both times the bug was in *which statistic* was taken rather than in the
 * measuring: first the mean frame interval over the canvas's whole mount,
 * which was reading vsync (decisions.md 2026-08-03 "later still"), then the
 * median draw cost, which reads the fold's own dead tail (2026-08-03 step 4).
 * A statistic that decides a one-way switch deserves to be testable on its
 * own, against the traces those entries recorded.
 */

/**
 * The p90 of a set of drawn-frame costs, by nearest-rank on the sorted
 * samples.
 *
 * **Why p90 and not the median.** `SWEEP_OVERSHOOT` is 2.2, so about half of
 * a click or keyboard turn's frames happen after the sheet has left the leaf
 * and cost essentially nothing. Instrumented on a real keyboard turn (spread
 * leaf 649x771, dpr 2): eleven of twenty-five drawn frames cost ~0, the median
 * is 0.9ms — and *the frame the reader is actually looking at costs 27.8ms*.
 * The same fold dragged by hand reports a 7.4ms median. So a median reads one
 * fold as 7x cheaper turned by key than dragged, and 25x cheaper than its own
 * worst frame; the guard was calibrated on the cheap case and could not notice
 * a stutter the operator could see.
 *
 * p90 on that curve is 12.6ms: high enough to see the peak, still robust to
 * the single frame a garbage collection lands on. The threshold's meaning
 * becomes "one frame in ten eats a whole 30fps frame", which is what a reader
 * experiences as a stutter — the median's meaning, "the typical frame", never
 * was.
 */
export function drawCostP90(costs: readonly number[]): number {
  if (costs.length === 0) return 0;
  const sorted = [...costs].sort((a, b) => a - b);
  // Nearest-rank, clamped: with the >= 12 sample floor the guard applies on
  // top of this, the rank is never so small that the choice of interpolation
  // rule could move the answer across the threshold.
  const rank = Math.ceil(0.9 * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}
