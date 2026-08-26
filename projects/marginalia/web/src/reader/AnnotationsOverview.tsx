import { motion, useReducedMotion } from "motion/react";
import type { HighlightKind, HighlightWithThread } from "@marginalia/shared";
import { IconButton } from "../controls/IconButton.js";
import styles from "./AnnotationsOverview.module.css";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

interface AnnotationsOverviewProps {
  highlights: HighlightWithThread[];
  unanchoredIds: Set<string>;
  onJumpTo: (highlight: HighlightWithThread) => void;
  onDelete: (highlight: HighlightWithThread) => void;
  onClose: () => void;
  /** M30 A: the reader's own names for the four kind slots — see
   * highlightKinds.ts's `kindLabelsFromSettings`. */
  labels: Record<HighlightKind, string>;
}

/**
 * Reader revisit affordance (M7, DESIGN.md): every thread in the book in
 * one scrollable list, jump-to on click — the answer to "wait, where were
 * all my questions again?" without hunting margin-rail dots one page at a
 * time. Unanchored highlights (CFI + text-search both failed to relocate
 * them) surface here too, clearly marked, since they can't be jumped to but
 * still need to be findable — typically to just delete them.
 */
export function AnnotationsOverview({
  highlights,
  unanchoredIds,
  onJumpTo,
  onDelete,
  onClose,
  labels,
}: AnnotationsOverviewProps) {
  const reducedMotion = useReducedMotion();
  const unanchoredCount = highlights.filter((h) => unanchoredIds.has(h.id)).length;

  return (
    <motion.div
      className={styles.panel}
      role="dialog"
      aria-label="Annotations in this book"
      initial={{ opacity: 0, x: reducedMotion ? 0 : -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: reducedMotion ? 0 : -12 }}
      transition={
        reducedMotion
          ? { duration: 0.12 }
          : { type: "spring", stiffness: 420, damping: 34 }
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>
          Annotations{highlights.length > 0 ? ` (${highlights.length})` : ""}
        </span>
        <IconButton icon="×" label="Close" size="sm" className={styles.closeButton} onClick={onClose} />
      </div>

      {unanchoredCount > 0 && (
        <div className={styles.unanchoredNotice}>
          {unanchoredCount} highlight{unanchoredCount === 1 ? "" : "s"} couldn't be
          relocated in this text and can't be jumped to — delete or leave them.
        </div>
      )}

      {highlights.length === 0 ? (
        <div className={styles.empty}>No highlights yet in this book.</div>
      ) : (
        <ul className={styles.list}>
          {highlights.map((highlight) => {
            const unanchored = unanchoredIds.has(highlight.id);
            const hasThread = highlight.thread !== null;
            const hasAnswer = highlight.thread?.hasAnswer ?? false;
            const hasNote = highlight.note.trim().length > 0;
            const baseStatus = unanchored
              ? "Unanchored"
              : hasAnswer
                ? "Answered"
                : hasThread
                  ? "Awaiting answer"
                  : labels[highlight.kind];
            // M13: a note reads as annotated here too, distinguishable from
            // (and stackable with) the thread status.
            const status = hasNote && !unanchored ? `${baseStatus} \u00b7 Note` : baseStatus;

            return (
              <li key={highlight.id} className={styles.item}>
                <button
                  type="button"
                  className={`${styles.entry} ${styles[highlight.kind]} ${
                    unanchored ? styles.unanchored : ""
                  }`}
                  disabled={unanchored}
                  onClick={() => onJumpTo(highlight)}
                >
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.entryBody}>
                    <span className={styles.quote}>&ldquo;{truncate(highlight.exact, 90)}&rdquo;</span>
                    <span className={styles.status}>{status}</span>
                  </span>
                </button>
                <IconButton
                  icon="×"
                  label="Delete highlight"
                  size="sm"
                  className={styles.deleteButton}
                  onClick={() => onDelete(highlight)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
