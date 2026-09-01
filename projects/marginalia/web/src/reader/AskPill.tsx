import { motion, useReducedMotion } from "motion/react";
import type { HighlightKind } from "@marginalia/shared";
import { HIGHLIGHT_KINDS } from "./highlightKinds.js";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { AudioTransportIcon } from "./AudioTransportIcon.js";
import styles from "./AskPill.module.css";

interface AskPillProps {
  left: number;
  top: number;
  onPickKind: (kind: HighlightKind) => void;
  onAsk: () => void;
  /** M30 C "the Define button": looks the selection up (dictionary first,
   * the book's digest as fallback) and attaches the answer to a new sage
   * highlight. Never opens the thread panel — this is a lookup, not a
   * conversation. */
  onDefine: () => void;
  /** M30 C: whether the selection is short enough to be a term. False
   * disables the button rather than hiding it — a Define that silently
   * vanishes on a long selection reads as a bug, where a disabled one with
   * a reason teaches the rule. See `isDefinableTerm`. */
  definable: boolean;
  /** M22.6 C "'Play from here' joins the selection pill": starts listening
   * at the selected sentence rather than the section's first. */
  onPlayFromHere: () => void;
  /** M30 A: the reader's own names for the four kind slots (settings, not
   * the hardcoded constant) — see highlightKinds.ts's `kindLabelsFromSettings`. */
  labels: Record<HighlightKind, string>;
  /** M35 §G4: turns this selection into the seed quote of a brand-new
   * multi-anchor annotation and enters "select/add highlight" mode, where
   * further selections (or a click on an existing, threadless highlight)
   * keep adding anchors to it. Unlike Ask, this never itself opens a
   * conversation — ReaderView still opens the panel so the reader can see
   * what's been linked, but the point of this button is the *linking*, not
   * a question. */
  onLinkQuote: () => void;
}

/**
 * The selection pill: four kind dots (mark the passage as rose/sage/
 * honey/slate, no thread opened), "Play from here" (starts listening at
 * this sentence), "Define" (M30 C — a capped lookup on a short selection,
 * no thread), and "Ask" (always creates a slate highlight and opens the
 * thread panel — docs/decisions.md 2026-07-19). Pops in with a spring
 * (DESIGN.md: springs for anything the user "touches") — a plain fade under
 * reduced motion.
 */
export function AskPill({
  left,
  top,
  onPickKind,
  onAsk,
  onDefine,
  definable,
  onPlayFromHere,
  labels,
  onLinkQuote,
}: AskPillProps) {
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
            title={labels[kind]}
            aria-label={`Mark as ${labels[kind].toLowerCase()}`}
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
        <Button
          variant="outline"
          size="sm"
          className={styles.defineButton}
          onClick={onDefine}
          disabled={!definable}
          // A disabled button can't be focused, so the tooltip alone is
          // unreachable by keyboard and screen reader — the reason rides on
          // the accessible name too.
          aria-label={definable ? undefined : "Define — select a word or a short phrase"}
          title={
            definable
              ? "Look this up"
              : "Select a word or a short phrase to define"
          }
        >
          Define
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={styles.linkQuoteButton}
          onClick={onLinkQuote}
          title="Build a multi-quote annotation, starting from this passage"
        >
          Link a quote
        </Button>
        <Button variant="solid" size="sm" className={styles.askButton} onClick={onAsk}>
          Ask
        </Button>
      </motion.div>
    </div>
  );
}
