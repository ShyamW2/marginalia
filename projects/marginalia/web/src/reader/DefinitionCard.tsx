import { motion, useReducedMotion } from "motion/react";
import type { Definition } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import styles from "./DefinitionCard.module.css";

export interface DefinitionCardState {
  left: number;
  top: number;
  /** The word as the reader selected it — shown while the lookup is still
   * running, before there's a resolved headword to show instead. */
  term: string;
  /** The highlight Define marked; null only in the instant before the
   * highlight POST resolves. */
  highlightId: string | null;
  /** null while the lookup is in flight. */
  result: Definition | null;
}

interface DefinitionCardProps {
  state: DefinitionCardState;
  onClose: () => void;
  /** M30 C: "It does not open the thread panel unless the reader asks" —
   * this is the asking. Escalates the same sage highlight into a real
   * conversation rather than starting a second one. */
  onAsk: () => void;
}

/** The two empty states say different things because they ask the reader for
 * different things: one is "this word isn't in the dictionary", the other is
 * "you haven't connected a provider". Collapsing them into one message would
 * send a reader to Settings for a word that simply isn't a word. */
function emptyMessage(reason: Definition["reason"]): string {
  switch (reason) {
    case "no_provider":
      return "No definition found. The dictionary doesn't have this one, and no LLM provider is connected to fall back to.";
    case "not_a_term":
      return "That's too long to define. Select a word or a short phrase.";
    default:
      return "No definition found — neither the dictionary nor this book's digest could place it.";
  }
}

/**
 * M30 C: where a Define lands. Deliberately *not* the thread panel — this is
 * a lookup, and a lookup that opened a conversation surface would make the
 * reader close a conversation they never started. It shows one answer, says
 * where the answer came from, and offers the one escalation ("Ask about
 * this") that turns it into the thread it declined to be.
 *
 * Every state here is designed, per M30 C's "no spinner and never a crash":
 * a lookup in flight, a dictionary hit, a digest hit, and each of the two
 * distinct ways of finding nothing.
 */
export function DefinitionCard({ state, onClose, onAsk }: DefinitionCardProps) {
  const reducedMotion = useReducedMotion();
  const { result } = state;
  const found = result !== null && result.definition.length > 0;
  // The dictionary's headword can differ from what was selected once
  // morphology has run ("running" -> "run"); showing the selection instead
  // would quietly define a different word than the one on screen.
  const heading = found ? result.headword || state.term : state.term;

  return (
    <div className={styles.cardPosition} style={{ left: state.left, top: state.top }}>
      <motion.div
        className={styles.card}
        role="dialog"
        aria-label={`Definition of ${heading}`}
        initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.9, y: reducedMotion ? 0 : 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.94, y: reducedMotion ? 0 : 4 }}
        transition={
          reducedMotion
            ? { duration: 0.12 }
            : { type: "spring", stiffness: 460, damping: 32 }
        }
      >
        <div className={styles.header}>
          <span className={styles.headword}>{heading}</span>
          <IconButton icon="×" label="Close" size="sm" className={styles.close} onClick={onClose} />
        </div>

        {result === null ? (
          // Not a spinner over the text (CLAUDE.md: "reading comes first").
          // A dictionary hit resolves in single-digit milliseconds, so this
          // is only ever seen on the digest-rung fallback.
          <p className={styles.looking}>Looking up…</p>
        ) : found ? (
          <>
            <p className={styles.definition}>{result.definition}</p>
            <div className={styles.footer}>
              <span className={styles.attribution}>
                {result.source === "dictionary"
                  ? result.attribution
                  : `From the digest of ${result.attribution}`}
              </span>
              <Button variant="ghost" size="sm" onClick={onAsk} className={styles.askMore}>
                Ask about this
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className={styles.empty}>{emptyMessage(result.reason)}</p>
            {result.reason !== "not_a_term" && (
              <div className={styles.footer}>
                <span className={styles.attribution} />
                <Button variant="ghost" size="sm" onClick={onAsk} className={styles.askMore}>
                  Ask about this
                </Button>
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}
