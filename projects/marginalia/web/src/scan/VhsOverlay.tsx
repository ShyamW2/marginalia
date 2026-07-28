import styles from "./VhsOverlay.module.css";

interface VhsOverlayProps {
  /** 0-1 — caller (ScanPage) resolves the persisted CRT setting and skips
   * rendering this entirely at 0 or under reduced motion, same as the warp
   * filter it shares a gate with. */
  intensity: number;
}

/**
 * M18 "VHS treatment, visual only" (decisions.md 2026-07-28: no audio —
 * DESIGN.md's "no sound in v1.5" holds). Drifting tracking lines and
 * coloured chroma noise; the third effect ("occasional signal wobble") is
 * a brief transform+brightness pulse on the warp wrapper itself
 * (ScanPage.module.css `.wobbling`) rather than living here, since a wobble
 * has to move the *whole* face, not an empty layer stacked on top of it.
 */
export function VhsOverlay({ intensity }: VhsOverlayProps) {
  return (
    <div className={styles.overlay} style={{ opacity: 0.4 + intensity * 0.6 }} aria-hidden="true">
      <div className={styles.trackingLines} />
      <div className={styles.chromaNoise} style={{ opacity: 0.05 + intensity * 0.05 }} />
    </div>
  );
}
