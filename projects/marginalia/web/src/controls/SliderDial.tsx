import { motion, useReducedMotion } from "motion/react";
import { valueToPosition, type SliderScale } from "./sliderMath.js";
import styles from "./SliderDial.module.css";

const TRACK_WIDTH = 260;

export interface SliderDialTick {
  value: number;
  label?: string;
}

interface SliderDialProps {
  /** Live preview value while dragging. */
  value: number;
  min: number;
  max: number;
  scale: SliderScale;
  /** Pixels of drag per value-unit (linear) or per octave (log2) — must
   * match the slider's own `dragPxPerUnit`, or the ruler drifts against
   * the pointer. */
  dragPxPerUnit: number;
  formatValue: (value: number) => string;
  ariaLabel: string;
  /** Ruler marks — usually the slider's own detents. */
  ticks?: readonly number[];
  /** Labelled marks a consumer wants on top of `ticks` (the reader's
   * chapter stops). */
  extraTicks?: readonly SliderDialTick[];
  hint?: string;
}

/**
 * The shared drag dial (M22.5, decisions.md 2026-08-04 "the slider's
 * resting form is the % dial, everywhere"): every `Slider` shows this while
 * dragging, centred beneath the control. Generalised from the reader's M12
 * `%` scrub — the best slider in the app, and the only one not built on
 * `Slider`'s own rendering until now.
 *
 * Ticks are laid out in the slider's own **position space** via
 * `valueToPosition`, not in raw value space — a linear ruler under a log2
 * slider is wrong at both ends of the range.
 */
export function SliderDial({
  value,
  min,
  max,
  scale,
  dragPxPerUnit,
  formatValue,
  ariaLabel,
  ticks = [],
  extraTicks = [],
  hint = "Release to set · Esc to cancel",
}: SliderDialProps) {
  const reducedMotion = useReducedMotion();
  const centerPosition = valueToPosition(value, scale);
  const windowRadius = TRACK_WIDTH / 2 / dragPxPerUnit;
  const lo = centerPosition - windowRadius;
  const hi = centerPosition + windowRadius;

  function offsetFor(v: number): number {
    return TRACK_WIDTH / 2 + (valueToPosition(v, scale) - centerPosition) * dragPxPerUnit;
  }

  function inWindow(v: number): boolean {
    const p = valueToPosition(v, scale);
    return p >= lo && p <= hi;
  }

  return (
    <div className={styles.anchor}>
      <motion.div
        className={styles.dial}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatValue(value)}
        initial={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
        transition={{ duration: reducedMotion ? 0.001 : 0.12, ease: "easeOut" }}
      >
        <div className={styles.track} aria-hidden="true">
          {ticks.filter(inWindow).map((t) => (
            <span key={t} className={styles.tick} style={{ left: offsetFor(t) }} />
          ))}
          {extraTicks
            .filter((t) => inWindow(t.value))
            .map((t) => (
              <span
                key={`${t.value}-${t.label ?? ""}`}
                className={styles.chapterTick}
                style={{ left: offsetFor(t.value) }}
                title={t.label}
              />
            ))}
          <div className={styles.needle} />
        </div>
        <div className={styles.readout}>{formatValue(value)}</div>
        <div className={styles.hint}>{hint}</div>
      </motion.div>
    </div>
  );
}
