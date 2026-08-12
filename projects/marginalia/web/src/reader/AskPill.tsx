import { motion, useReducedMotion } from "motion/react";
import type { HighlightKind } from "@marginalia/shared";
import { HIGHLIGHT_KINDS, KIND_LABELS } from "./highlightKinds.js";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { AudioTransportIcon } from "./AudioTransportIcon.js";
import styles from "./AskPill.module.css";

interface AskPillProps {
  left: number;
  top: number;
  onPickKind: (kind: HighlightKind) => void;
  onAsk: () => void;
  /** M22.6 C "'Play from here' joins the selection pill": starts listening
   * at the selected sentence rather than the section's first. */
  onPlayFromHere: () => void;
}

/**
 * The selection pill: four kind dots (mark the passage as rose/sage/
 * honey/slate, no thread opened), "Play from here" (starts listening at
 * this sentence), and "Ask" (always creates a slate highlight and opens the
 * thread panel — docs/decisions.md 2026-07-19). Pops in with a spring
 * (DESIGN.md: springs for anything the user "touches") — a plain fade under
 * reduced motion.
 */
export function AskPill({ left, top, onPickKind, onAsk, onPlayFromHere }: AskPillProps) {
  const reducedMotion = useReducedMotion();

  return (
    <div className={styles.pillPosition} style={{ left, top }}>
      <motion.div
        className={styles.pill}
        role="group"
        aria-label="Mark this passage"
        initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.85, y: reducedMotion ? 0 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.9, y: reducedMotion ? 0 : 4 }}
        transition={
          reducedMotion
            ? { duration: 0.12 }
            : { type: "spring", stiffness: 500, damping: 30 }
        }
        // Selecting text again while the pill is visible shouldn't be
        // interrupted by the pill stealing focus/collapsing the selection.
        onMouseDown={(event) => event.preventDefault()}
      >
        {HIGHLIGHT_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={`${styles.dot} ${styles[kind]}`}
            title={KIND_LABELS[kind]}
            aria-label={`Mark as ${KIND_LABELS[kind].toLowerCase()}`}
            onClick={() => onPickKind(kind)}
          />
        ))}
        <IconButton
          icon={<AudioTransportIcon kind="play-from" size={14} />}
          label="Play from here"
          size="sm"
          className={styles.playFromButton}
          onClick={onPlayFromHere}
        />
        <Button variant="solid" size="sm" className={styles.askButton} onClick={onAsk}>
          Ask
        </Button>
      </motion.div>
    </div>
  );
}
