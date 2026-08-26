import { motion, useReducedMotion } from "motion/react";
import type { HighlightWithThread } from "@marginalia/shared";
import { IconButton } from "../controls/IconButton.js";
import styles from "./Glossary.module.css";

interface GlossaryProps {
  /** Every highlight in the book. Filtering happens here on purpose — see
   * the note on `glossaryEntries` below. */
  highlights: HighlightWithThread[];
  unanchoredIds: Set<string>;
  onJumpTo: (highlight: HighlightWithThread) => void;
  onClose: () => void;
}

/**
 * M30 D: this book's glossary is a **filtered view over `highlights`**, not a
 * table (settled in M30's task list and in the migration-26 comment). A
 * `glossary` table would be a second source of truth for something the
 * highlights already hold, and would go stale the instant a definition
 * highlight was deleted. Filtering in the component means the glossary is
 * always exactly as current as the reader's marks — deleting a definition
 * removes it here with no cleanup step anywhere.
 *
 * "In reading order" is `spineIndex, createdAt` — which is the order the
 * server already returns highlights in, so this preserves it rather than
 * re-sorting.
 */
export function glossaryEntries(
  highlights: HighlightWithThread[],
): HighlightWithThread[] {
  // Kind *and* definition: a sage highlight without a definition is an
  // ordinary mark the reader made, and belongs in Annotations, not here.
  return highlights.filter((h) => h.kind === "sage" && h.definition.trim().length > 0);
}

/**
 * The glossary instrument (settled decision 13: an instrument you put *on*
 * the Book, never a fourth room), sitting alongside the annotations overview
 * and built to the same shape so the two read as siblings.
 */
export function Glossary({ highlights, unanchoredIds, onJumpTo, onClose }: GlossaryProps) {
  const reducedMotion = useReducedMotion();
  const entries = glossaryEntries(highlights);

  return (
    <motion.div
      className={styles.panel}
      role="dialog"
      aria-label="Glossary for this book"
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
          Glossary{entries.length > 0 ? ` (${entries.length})` : ""}
        </span>
        <IconButton icon="×" label="Close" size="sm" onClick={onClose} />
      </div>

      {entries.length === 0 ? (
        <div className={styles.empty}>
          Nothing defined yet. Select a word and press <strong>Define</strong> to look it
          up — it lands here.
        </div>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => {
            const unanchored = unanchoredIds.has(entry.id);
            return (
              <li key={entry.id} className={styles.item}>
                <button
                  type="button"
                  className={`${styles.entry} ${unanchored ? styles.unanchored : ""}`}
                  // Jump-to-passage is the whole point of a per-book
                  // glossary over a dictionary: it is a list of words *with
                  // the place you met them*. An entry whose anchor was lost
                  // keeps its definition and loses only the jump.
                  disabled={unanchored}
                  onClick={() => onJumpTo(entry)}
                  title={unanchored ? "This passage couldn't be relocated in the text" : undefined}
                >
                  <span className={styles.term}>{entry.exact}</span>
                  <span className={styles.definition}>{entry.definition}</span>
                  <span className={styles.source}>
                    {entry.definitionSource === "dictionary" ? "Dictionary" : "From the digest"}
                    {unanchored ? " · passage not found" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
