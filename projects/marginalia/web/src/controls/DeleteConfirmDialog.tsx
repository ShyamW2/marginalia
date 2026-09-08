import type { ReactNode } from "react";
import { useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "./Button.js";
import { useDialogA11y } from "./useDialogA11y.js";
import styles from "./DeleteConfirmDialog.module.css";

interface DeleteConfirmDialogProps {
  /** Names what's being lost rather than asking a generic "are you sure?" —
   * the acceptance criterion for the first call site (M30 E1) this was
   * built for, and every one since. */
  message: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * M30 E1: "the hazard is more urgent than the feature" (decisions.md
 * 2026-08-24) — `deleteHighlight` cascades to a whole thread with no undo,
 * so this is the one gate every delete call site (margin rail, annotations
 * overview, M30 E2's thread panel, and — M42 — deleting a book from the
 * library) now passes through whenever there's real content to lose.
 *
 * A real modal (this component's first use): a backdrop, not another
 * anchored instrument, because whatever it's about can be scrolled out of
 * view (the margin rail) or off to the side (the annotations overview, the
 * library grid) by the time the reader answers it.
 */
export function DeleteConfirmDialog({ message, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(panelRef, onCancel);

  return (
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.08 : 0.15 }}
      onClick={onCancel}
    >
      <motion.div
        ref={panelRef}
        className={styles.panel}
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirm delete"
        tabIndex={-1}
        initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.96 }}
        transition={reducedMotion ? { duration: 0.08 } : { type: "spring", stiffness: 480, damping: 34 }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
