import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { TocEntry } from "./toc.js";
import { ChevronIcon } from "./ChevronIcon.js";
import styles from "./ChapterNav.module.css";

interface ChapterNavProps {
  /** Full nested list (subitems included, `depth` for indent) for browsing. */
  toc: TocEntry[];
  /** Deduped one-per-spine-index list — governs prev/next and the label. */
  chapterStops: TocEntry[];
  currentChapter: TocEntry | null;
  onSelect: (entry: TocEntry) => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
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
  onSelect,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: ChapterNavProps) {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();

  function handleSelect(entry: TocEntry) {
    onSelect(entry);
    setOpen(false);
  }

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.arrowButton}
        aria-label="Previous chapter"
        disabled={!hasPrev}
        onClick={onPrev}
      >
        <ChevronIcon direction="left" size={14} />
      </button>
      <button
        type="button"
        className={styles.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {currentChapter?.label || "Contents"}
      </button>
      <button
        type="button"
        className={styles.arrowButton}
        aria-label="Next chapter"
        disabled={!hasNext}
        onClick={onNext}
      >
        <ChevronIcon direction="right" size={14} />
      </button>
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
                  {entry.label || "(untitled)"}
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
