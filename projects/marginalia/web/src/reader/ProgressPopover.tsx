import { motion, useReducedMotion } from "motion/react";
import styles from "./ProgressPopover.module.css";

interface ProgressPopoverProps {
  percent: number | null;
  page: number | null;
  totalPages: number | null;
  chapterLabel: string | null;
}

/**
 * M12 (decisions.md 2026-07-20: "the % readout is an instrument, not a
 * label"). A plain click on the progress readout reveals this — the same
 * position expressed three ways, instrument-panel style. Drag instead shows
 * the slider's own drag dial (`SliderDial`, M22.5).
 */
export function ProgressPopover({ percent, page, totalPages, chapterLabel }: ProgressPopoverProps) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      className={styles.panel}
      role="status"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
      transition={{ duration: reducedMotion ? 0.001 : 0.14, ease: "easeOut" }}
    >
      <div className={styles.row}>
        <span className={styles.label}>Position</span>
        <span className={styles.value}>{percent !== null ? `${percent}%` : "—"}</span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Page</span>
        <span className={styles.value}>
          {page !== null && totalPages !== null ? `${page} of ${totalPages}` : "—"}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>Chapter</span>
        <span className={styles.value}>{chapterLabel ?? "—"}</span>
      </div>
    </motion.div>
  );
}
