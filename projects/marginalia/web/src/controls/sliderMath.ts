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
 * The nearest detent within its own capture window, or null if none is
 * close enough. The window is a *fraction of the detent's own value*
 * (`captureFraction`), not a fixed absolute distance — a fixed window would
 * be unusably wide at the bottom of a log2 range and unusably narrow at the
 * top (TASKS.md: "a capture window that is a percentage of the current
 * value, so it works at 2048 and at 131072").
 */
export function nearestDetent(
  value: number,
  detents: readonly number[],
  captureFraction: number,
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const detent of detents) {
    const distance = Math.abs(value - detent);
    if (distance > detent * captureFraction) continue;
    if (distance < bestDistance) {
      best = detent;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Drag distance (in the position space above) to a value, clamped and
 * advisory-snapped to the nearest in-window detent.
 */
export function dragToValue(
  startValue: number,
  deltaPx: number,
  pxPerUnit: number,
  scale: SliderScale,
  min: number,
  max: number,
  detents: readonly number[],
  captureFraction: number,
): number {
  const startPosition = valueToPosition(startValue, scale);
  const rawValue = clampValue(positionToValue(startPosition + deltaPx / pxPerUnit, scale), min, max);
  return nearestDetent(rawValue, detents, captureFraction) ?? rawValue;
}
