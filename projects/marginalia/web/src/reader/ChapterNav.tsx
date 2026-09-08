import { useEffect, useState } from "react";
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

interface ChapterGroup {
  chapter: TocEntry;
  /** M42 §C4: this chapter's own depth-2+ subheadings — a real chapter
   * from `flattenNavItems`/`PdfRenderer.getToc()` is always depth 0, so
   * grouping on that boundary works identically for both renderers. */
  children: TocEntry[];
}

function groupByChapter(toc: TocEntry[]): ChapterGroup[] {
  const groups: ChapterGroup[] = [];
  for (const entry of toc) {
    if (entry.depth === 0) {
      groups.push({ chapter: entry, children: [] });
    } else {
      groups[groups.length - 1]?.children.push(entry);
    }
  }
  return groups;
}

function groupKey(entry: TocEntry): string {
  return `${entry.href}-${entry.label}`;
}

/**
 * M12 "jump up and down the book" (TASKS.md): prev/next chapter arrows plus
 * a table-of-contents popover, all anchored to one compact cluster in the
 * reader's top row. `[`/`]` keyboard shortcuts for prev/next live in
 * ReaderView's existing keydown handler; this component is itself a plain
 * Tab-reachable button, so the TOC is reachable without a pointer too.
 *
 * M42 §C4: a chapter with subheadings (a depth-2+ heading that stays inline
 * in its own text rather than fragmenting the spine) gets a down-arrow that
 * expands them beneath it, each independently clickable — jumping within
 * the same chapter/section rather than to a different one.
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const reducedMotion = useReducedMotion();

  // The current chapter's own subheadings start visible rather than
  // requiring an extra click right after opening the popover on the
  // chapter you're already reading.
  useEffect(() => {
    if (!open || !currentChapter) return;
    const key = groupKey(currentChapter);
    setExpanded((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, [open, currentChapter]);

  function handleSelect(entry: TocEntry) {
    onSelect(entry);
    setOpen(false);
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const groups = groupByChapter(toc);

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
            {groups.length === 0 ? (
              <div className={styles.tocEmpty}>This book has no table of contents.</div>
            ) : (
              groups.map((group) => {
                const key = groupKey(group.chapter);
                const isActive = currentChapter?.href === group.chapter.href;
                const hasChildren = group.children.length > 0;
                const isExpanded = expanded.has(key);
                return (
                  <div key={key}>
                    <div className={styles.tocRow}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={chapterStops.some((s) => s.href === group.chapter.href) && isActive}
                        className={`${styles.tocEntry} ${isActive ? styles.tocEntryActive : ""}`}
                        onClick={() => handleSelect(group.chapter)}
                      >
                        {withSectionNumber(group.chapter, chapterNumbers)}
                      </button>
                      {hasChildren && (
                        <IconButton
                          icon={
                            <span className={`${styles.tocExpand} ${isExpanded ? styles.tocExpandOpen : ""}`}>
                              <ChevronIcon direction="right" size={12} />
                            </span>
                          }
                          label={isExpanded ? "Collapse subsections" : "Expand subsections"}
                          size="sm"
                          onClick={() => toggleExpanded(key)}
                        />
                      )}
                    </div>
                    {hasChildren && isExpanded && (
                      <div className={styles.tocChildren}>
                        {group.children.map((child) => (
                          <button
                            key={`${groupKey(child)}-${child.offset ?? ""}`}
                            type="button"
                            role="option"
                            aria-selected={false}
                            className={styles.tocEntry}
                            style={{ paddingLeft: `${0.5 + child.depth * 0.9}rem` }}
                            onClick={() => handleSelect(child)}
                          >
                            {withSectionNumber(child, chapterNumbers)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
