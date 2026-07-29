import type { PageNumberMode } from "@marginalia/shared";

/**
 * M19.6 "page numbers, book-wide and stable" (decisions.md 2026-07-30).
 * "book" reads off `book.locations` — a location index is book-wide and
 * stable across font size, margin and spread mode (epub.js splits by
 * character count, not layout) — "chapter" reads the `location.start.displayed`
 * epub.js already computes per spine section. Both are 0-based internally;
 * this formats the 1-based reader-facing string, or null while the needed
 * data isn't available yet (locations still generating/loading, or "off").
 */
export function formatPageNumber(
  mode: PageNumberMode,
  bookLocationIndex: number | null,
  bookLocationTotal: number | null,
  chapterPage: number | null,
  chapterTotal: number | null,
): string | null {
  if (mode === "off") return null;
  if (mode === "book") {
    if (bookLocationIndex === null || bookLocationTotal === null) return null;
    return `Page ${bookLocationIndex + 1} of ${bookLocationTotal + 1}`;
  }
  if (chapterPage === null || chapterTotal === null) return null;
  return `Page ${chapterPage} of ${chapterTotal}`;
}
