import styles from "./DwellRing.module.css";

interface DwellRingProps {
  x: number;
  y: number;
  durationMs: number;
  refused: boolean;
}

/**
 * M19.6 "highlight across a page boundary" (decisions.md 2026-07-30 later):
 * the filling-ring cursor decoration shown while a drag-selection dwells at
 * the page edge. An SVG stroke-dashoffset sweep, driven by a CSS
 * `@keyframes` (DwellRing.module.css) rather than an animated custom
 * property — stroke-dashoffset is a standard animatable property, so it
 * needs no `@property` registration for smooth interpolation the way a
 * conic-gradient custom property would. `key`'d by the caller on every new
 * dwell so the animation restarts from empty each time; `refused` swaps to
 * a static, fully-filled red ring instead — the section-boundary case never
 * lets the sweep animation finish on its own.
 */
export function DwellRing({ x, y, durationMs, refused }: DwellRingProps) {
  return (
    <div
      className={`${styles.dwellRing} ${refused ? styles.dwellRingRefused : ""}`}
      style={{ left: x, top: y }}
      aria-hidden="true"
    >
      <svg width="28" height="28" viewBox="0 0 28 28">
        <circle className={styles.track} cx="14" cy="14" r="11" />
        <circle
          className={`${styles.sweep} ${refused ? "" : styles.sweepAnimating}`}
          cx="14"
          cy="14"
          r="11"
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </svg>
    </div>
  );
}
