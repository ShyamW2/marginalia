import { motion, useReducedMotion } from "motion/react";
import type { TocEntry } from "./toc.js";
import styles from "./ScrubDial.module.css";

/** Pixels of ruler movement per whole percentage point — shared with the
 * pointer-drag math in ReaderView so the ticks track the mouse 1:1. */
export const DIAL_PX_PER_PERCENT = 6;

const TRACK_WIDTH = 260;
const MINOR_TICK_STEP = 2;

interface ScrubDialProps {
  /** Live preview position while dragging, not the committed reading position. */
  previewPercent: number;
  chapterLabel: string | null;
  chapterStops: TocEntry[];
}

/**
 * M12 scrub dial (decisions.md 2026-07-20): a retro-camera zoom-ring —
 * the percent ruler slides under a fixed center needle as the pointer (or
 * arrow keys) move, rather than a marker sliding along a fixed ruler. Purely
 * visual/decorative: ReaderView owns all the actual position state and only
 * touches the book on commit.
 */
export function ScrubDial({ previewPercent, chapterLabel, chapterStops }: ScrubDialProps) {
  const reducedMotion = useReducedMotion();
  const halfWindow = TRACK_WIDTH / 2 / DIAL_PX_PER_PERCENT + MINOR_TICK_STEP;
  const lo = previewPercent - halfWindow;
  const hi = previewPercent + halfWindow;

  const minorTicks: number[] = [];
  const start = Math.ceil(lo / MINOR_TICK_STEP) * MINOR_TICK_STEP;
  for (let p = start; p <= hi; p += MINOR_TICK_STEP) {
    if (p >= 0 && p <= 100) minorTicks.push(p);
  }

  function offsetFor(percent: number): number {
    return TRACK_WIDTH / 2 + (percent - previewPercent) * DIAL_PX_PER_PERCENT;
  }

  return (
    <motion.div
      className={styles.dial}
      role="slider"
      aria-label="Position in book"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(previewPercent)}
      aria-valuetext={`${Math.round(previewPercent)}%${chapterLabel ? `, ${chapterLabel}` : ""}`}
      initial={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
      transition={{ duration: reducedMotion ? 0.001 : 0.12, ease: "easeOut" }}
    >
      <div className={styles.track} aria-hidden="true">
        {minorTicks.map((p) => (
          <span key={p} className={styles.tick} style={{ left: offsetFor(p) }} />
        ))}
        {chapterStops.map(
          (stop) =>
            stop.percent !== null &&
            stop.percent >= lo &&
            stop.percent <= hi && (
              <span
                key={`${stop.href}-${stop.percent}`}
                className={styles.chapterTick}
                style={{ left: offsetFor(stop.percent) }}
                title={stop.label}
              />
            ),
        )}
        <div className={styles.needle} />
      </div>
      <div className={styles.readout}>
        {Math.round(previewPercent)}%{chapterLabel ? ` · ${chapterLabel}` : ""}
      </div>
      <div className={styles.hint}>Release to jump · Esc to cancel</div>
    </motion.div>
  );
}
