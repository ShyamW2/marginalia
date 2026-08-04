/**
 * Pure position math for `Slider` (M19.7 — DESIGN.md "The control system").
 * Kept apart from the DOM/pointer wiring in Slider.tsx so the geometry is
 * unit-testable without a browser.
 *
 * Both scales are driven through one internal "position" space `p`:
 * `linear` — `p` is the value itself. `log2` — `p` is `log2(value)`, so a
 * fixed pixel distance always means "one octave" regardless of where in the
 * range the drag started, which is what makes a log2 slider feel uniform at
 * 2048 and at 131072 alike (TASKS.md's own acceptance bar).
 */
export type SliderScale = "linear" | "log2";

export function valueToPosition(value: number, scale: SliderScale): number {
  return scale === "log2" ? Math.log2(Math.max(value, Number.EPSILON)) : value;
}

export function positionToValue(position: number, scale: SliderScale): number {
  return scale === "log2" ? 2 ** position : position;
}

export function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A detent's capture window, either a *fraction of the detent's own value*
 * (right for a log2 range — a fixed window would be unusably wide at the
 * bottom and unusably narrow at the top) or a fixed *absolute* amount
 * (right for a linear range with an ask like "±25 either side of every
 * 500" — one fraction cannot be both 5% at 500 and 0.25% at 10,000).
 */
export type DetentCapture = { fraction: number } | { absolute: number };

function captureWindow(detent: number, capture: DetentCapture): number {
  return "absolute" in capture ? capture.absolute : detent * capture.fraction;
}

/**
 * The nearest detent within its own capture window, or null if none is
 * close enough.
 */
export function nearestDetent(
  value: number,
  detents: readonly number[],
  capture: DetentCapture,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const detent of detents) {
    const distance = Math.abs(value - detent);
    if (distance > captureWindow(detent, capture)) continue;
    if (distance < bestDistance) {
      best = detent;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Rounds to the nearest multiple of `step`, or returns `value` unchanged
 * when no step is given. A slider may not commit a value its own consumer
 * will reject (e.g. a `.int()`-validated field fed a drag's raw float).
 */
export function quantize(value: number, step: number | undefined): number {
  if (!step) return value;
  return Math.round(value / step) * step;
}

/**
 * Drag distance (in the position space above) to a value: clamped,
 * quantised to `step`, then advisory-snapped to the nearest in-window
 * detent.
 */
export function dragToValue(
  startValue: number,
  deltaPx: number,
  pxPerUnit: number,
  scale: SliderScale,
  min: number,
  max: number,
  detents: readonly number[],
  capture: DetentCapture,
  step?: number,
): number {
  const startPosition = valueToPosition(startValue, scale);
  const rawValue = clampValue(positionToValue(startPosition + deltaPx / pxPerUnit, scale), min, max);
  const quantized = quantize(rawValue, step);
  return nearestDetent(quantized, detents, capture) ?? quantized;
}
