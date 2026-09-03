import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { TocEntry } from "./renderer/epub/toc.js";
import { ChevronIcon } from "./ChevronIcon.js";
import { IconButton } from "../controls/IconButton.js";
import styles from "./ChapterNav.module.css";

interface ChapterNavProps {
  /** Full nested list (subitems included, `depth` for indent) for browsing. */
  toc: TocEntry[];
  /** Deduped one-per-spine-index list — governs prev/next and the label. */
  chapterStops: TocEntry[];
  currentChapter: TocEntry | null;
  /** spineIndex -> the scan/digest's section ordinal (M20.5, TASKS.md
   * "S<n> is the only number that appears in any UI") — null until
   * ReaderView's own fetch resolves, in which case entries show their plain
   * title/label with no number rather than blocking on it. */
  chapterNumbers: Map<number, number> | null;
  onSelect: (entry: TocEntry) => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** M22.5: a short, fixed cap on the label's width instead of the prev/next
   * buttons' own size — set once ReaderView's own measurement finds no room
   * beside the reading column for the actions cluster (the same squeeze
   * that pushes this whole row up against the fixed nav cluster). */
  compact?: boolean;
}

/** "S<n> · title", falling back to just the title/label when there's no
 * chapter-number mapping yet (or this entry's spineIndex isn't in it) — the
 * same section must show the same S number here as it does in the digest,
 * the scan axis, and the range dials (TASKS.md M20.5 acceptance). */
function withSectionNumber(entry: TocEntry, chapterNumbers: Map<number, number> | null): string {
  const label = entry.label || "(untitled)";
  const n = entry.spineIndex !== null ? chapterNumbers?.get(entry.spineIndex) : undefined;
  return n !== undefined ? `S${n} · ${label}` : label;
}

/**
 * M12 "jump up and down the book" (TASKS.md): prev/next chapter arrows plus
 * a table-of-contents popover, all anchored to one compact cluster in the
 * reader's top row. `[`/`]` keyboard shortcuts for prev/next live in
 * ReaderView's existing keydown handler; this component is itself a plain
 * Tab-reachable button, so the TOC is reachable without a pointer too.
 */
export function ChapterNav({
  toc,
  chapterStops,
  currentChapter,
  chapterNumbers,
  onSelect,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  compact = false,
}: ChapterNavProps) {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  function handleSelect(entry: TocEntry) {
    onSelect(entry);
    setOpen(false);
  }

  return (
    <div className={styles.wrap}>
      <IconButton
        icon={<ChevronIcon direction="left" size={14} />}
        label="Previous chapter"
        size="sm"
        disabled={!hasPrev}
        onClick={onPrev}
      />
      <button
        type="button"
        className={compact ? `${styles.label} ${styles.labelCompact}` : styles.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {currentChapter ? withSectionNumber(currentChapter, chapterNumbers) : "Contents"}
      </button>
      <IconButton
        icon={<ChevronIcon direction="right" size={14} />}
        label="Next chapter"
        size="sm"
        disabled={!hasNext}
        onClick={onNext}
      />
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.tocPanel}
            role="listbox"
            aria-label="Table of contents"
            initial={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
            transition={{ duration: reducedMotion ? 0.001 : 0.14, ease: "easeOut" }}
          >
            {toc.length === 0 ? (
              <div className={styles.tocEmpty}>This book has no table of contents.</div>
            ) : (
              toc.map((entry) => (
                <button
                  key={`${entry.href}-${entry.label}`}
                  type="button"
                  role="option"
                  aria-selected={
                    chapterStops.some((s) => s.href === entry.href) &&
                    currentChapter?.href === entry.href
                  }
                  className={`${styles.tocEntry} ${
                    currentChapter?.href === entry.href ? styles.tocEntryActive : ""
                  }`}
                  style={{ paddingLeft: `${0.5 + entry.depth * 0.9}rem` }}
                  onClick={() => handleSelect(entry)}
                >
                  {withSectionNumber(entry, chapterNumbers)}
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
