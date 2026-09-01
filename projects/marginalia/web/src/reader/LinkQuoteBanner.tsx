import { motion, useReducedMotion } from "motion/react";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import styles from "./LinkQuoteBanner.module.css";

interface LinkQuoteBannerProps {
  /** True from the selection-popup entry ("Link a quote"), building a
   * brand-new annotation — an existing, threadless highlight may be clicked
   * to link it. False from an already-open annotation's "Add additional
   * quotes" — only fresh selections are accepted there (decisions.md
   * 2026-09-01 evening: the ground rule is enforced server-side, but this is
   * what keeps the two entry points from reading as the same tool). */
  allowExistingHighlightClick: boolean;
  /** Set once a selection or an eligible highlight click is waiting on the
   * reader to confirm it before it's actually linked. */
  pendingExact: string | null;
  /** A refusal or failure to show inline — cleared on the next action. */
  error: string | null;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onExit: () => void;
}

/**
 * M35 §G4's mode banner — same pebble-over-the-page pattern `FindBar` already
 * established (a direct child of `.stage`, centred, `pointer-events: none`
 * on the wrapper so the page underneath stays clickable/turnable, `auto` on
 * the pebble itself). Reused rather than a floating popover anchored to
 * wherever the reader clicked or selected, because a mark click carries no
 * pointer coordinates to anchor to (`markClicked` only hands back the CFI
 * range and the mark's own data) and a single fixed location is one thing to
 * build and test rather than two.
 */
export function LinkQuoteBanner({
  allowExistingHighlightClick,
  pendingExact,
  error,
  onConfirm,
  onCancelConfirm,
  onExit,
}: LinkQuoteBannerProps) {
  const reducedMotion = Boolean(useReducedMotion());

  return (
    <div className={styles.pebbleAnchor}>
      <motion.div
        className={styles.pebble}
        role="status"
        initial={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
        transition={{ duration: reducedMotion ? 0.001 : 0.14, ease: "easeOut" }}
      >
        {pendingExact ? (
          <>
            <span className={styles.label}>Add &ldquo;{pendingExact}&rdquo; to this annotation?</span>
            <Button variant="solid" size="sm" onClick={onConfirm}>
              Add
            </Button>
            <Button variant="outline" size="sm" onClick={onCancelConfirm}>
              Cancel
            </Button>
          </>
        ) : (
          <span className={styles.label}>
            Select/add highlight —{" "}
            {allowExistingHighlightClick
              ? "click an existing highlight or select new text to add it here."
              : "select new text to add it here."}
          </span>
        )}
        <IconButton icon="×" label="Stop linking quotes" size="sm" onClick={onExit} />
      </motion.div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
