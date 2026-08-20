import type { PageNumberMode } from "@marginalia/shared";
import { formatPageNumber, formatPageNumberCompact } from "./pageNumber.js";
import styles from "./PageNumberDisplay.module.css";

interface PageNumberDisplayProps {
  mode: PageNumberMode;
  bookPage: number | null;
  bookTotal: number | null;
  chapterPage: number | null;
  chapterTotal: number | null;
}

/**
 * M19.6 "page numbers, book-wide and stable" (decisions.md 2026-07-30).
 * Sits in the footer between the prev/next buttons. Renders nothing — not
 * an empty state, just nothing — when the mode is "off" or its data isn't
 * ready yet (locations still generating/loading), so a book that hasn't
 * cached/generated locations reads exactly as it does today.
 *
 * M24.7 §C: both the full ("Page 1 of 800") and compact ("1 / 800") forms
 * are always in the DOM; the foot's own `reader-strip` container query
 * (ReaderView.module.css) toggles which one is visible via plain
 * `display`, so the narrow-pane swap needs no JS breakpoint.
 */
export function PageNumberDisplay({
  mode,
  bookPage,
  bookTotal,
  chapterPage,
  chapterTotal,
}: PageNumberDisplayProps) {
  const full = formatPageNumber(mode, bookPage, bookTotal, chapterPage, chapterTotal);
  const compact = formatPageNumberCompact(mode, bookPage, bookTotal, chapterPage, chapterTotal);
  if (!full || !compact) return null;
  return (
    <span className={styles.pageNumber} aria-live="off">
      <span className={styles.full}>{full}</span>
      <span className={styles.compact}>{compact}</span>
    </span>
  );
}
