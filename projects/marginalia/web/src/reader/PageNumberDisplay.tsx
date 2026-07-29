import type { PageNumberMode } from "@marginalia/shared";
import { formatPageNumber } from "./pageNumber.js";
import styles from "./PageNumberDisplay.module.css";

interface PageNumberDisplayProps {
  mode: PageNumberMode;
  bookLocationIndex: number | null;
  bookLocationTotal: number | null;
  chapterPage: number | null;
  chapterTotal: number | null;
}

/**
 * M19.6 "page numbers, book-wide and stable" (decisions.md 2026-07-30).
 * Sits in the footer between the prev/next buttons. Renders nothing — not
 * an empty state, just nothing — when the mode is "off" or its data isn't
 * ready yet (locations still generating/loading), so a book that hasn't
 * cached/generated locations reads exactly as it does today.
 */
export function PageNumberDisplay({
  mode,
  bookLocationIndex,
  bookLocationTotal,
  chapterPage,
  chapterTotal,
}: PageNumberDisplayProps) {
  const text = formatPageNumber(mode, bookLocationIndex, bookLocationTotal, chapterPage, chapterTotal);
  if (!text) return null;
  return (
    <span className={styles.pageNumber} aria-live="off">
      {text}
    </span>
  );
}
