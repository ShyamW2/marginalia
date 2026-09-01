import { motion, useReducedMotion } from "motion/react";
import type { HighlightWithThread } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import styles from "./Glossary.module.css";

/** M36 B1: the three orders a glossary can read in. "Reading order" is
 * today's default and is *not* the same axis as "chronological" — see the
 * note on `sortGlossaryEntries` below. */
export type GlossarySortMode = "reading" | "alpha" | "chrono";

interface GlossaryProps {
  /** Every highlight in the book. Filtering happens here on purpose — see
   * the note on `glossaryEntries` below. */
  highlights: HighlightWithThread[];
  unanchoredIds: Set<string>;
  sort: GlossarySortMode;
  onSortChange: (mode: GlossarySortMode) => void;
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
/**
 * M36 A1: the predicate itself, exported — `AnnotationsOverview` imports
 * this rather than growing a second copy, so the glossary's inclusion rule
 * and the annotations list's exclusion rule are structurally the same test
 * and cannot drift apart. M36 A4 (decided 2026-08-31): a definition
 * highlight the reader has *also* written a note on still stays glossary-only
 * — this is deliberately the *whole* test, with no "…unless it has a note"
 * clause, which would put the same word back in both lists.
 */
export function isGlossaryEntry(h: HighlightWithThread): boolean {
  // Kind *and* definition: a sage highlight without a definition is an
  // ordinary mark the reader made, and belongs in Annotations, not here.
  return h.kind === "sage" && h.definition.trim().length > 0;
}

export function glossaryEntries(
  highlights: HighlightWithThread[],
): HighlightWithThread[] {
  return highlights.filter(isGlossaryEntry);
}

/**
 * M36 B: reading order is already the order the server returns highlights
 * in (`spineIndex, createdAt`), so it's a passthrough, not a sort. A–Z reads
 * the headword; chronological is *when the reader looked the word up*,
 * which — B2 — is a genuinely different axis from reading order: on a
 * reread, lookups happen in a different order than the words appear.
 */
export function sortGlossaryEntries(
  entries: HighlightWithThread[],
  mode: GlossarySortMode,
): HighlightWithThread[] {
  if (mode === "reading") return entries;
  const sorted = [...entries];
  if (mode === "alpha") {
    sorted.sort((a, b) => a.exact.localeCompare(b.exact, undefined, { sensitivity: "base" }));
  } else {
    sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return sorted;
}

const SORT_OPTIONS: { mode: GlossarySortMode; label: string }[] = [
  { mode: "reading", label: "Reading order" },
  { mode: "alpha", label: "A–Z" },
  { mode: "chrono", label: "When looked up" },
];

/**
 * The glossary instrument (settled decision 13: an instrument you put *on*
 * the Book, never a fourth room), sitting alongside the annotations overview
 * and built to the same shape so the two read as siblings.
 */
export function Glossary({
  highlights,
  unanchoredIds,
  sort,
  onSortChange,
  onJumpTo,
  onClose,
}: GlossaryProps) {
  const reducedMotion = useReducedMotion();
  const entries = sortGlossaryEntries(glossaryEntries(highlights), sort);

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

      {entries.length > 1 && (
        <div className={styles.sortRow} role="group" aria-label="Sort the glossary">
          {SORT_OPTIONS.map((option) => (
            <Button
              key={option.mode}
              variant="ghost"
              size="sm"
              pressed={sort === option.mode}
              onClick={() => onSortChange(option.mode)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}

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
