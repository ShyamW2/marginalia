import type { PageNumberMode } from "@marginalia/shared";

/**
 * M19.6 "page numbers, book-wide and stable" (decisions.md 2026-07-30,
 * amended 2026-07-30 later after operator verification). "book" now reads
 * off `bookPages.ts`'s click-accurate, spread-adjusted count (already
 * 1-based) rather than a character-location index — see that module's own
 * comment for why. "chapter" reads `location.start.displayed`, also already
 * spread-adjusted by the caller. Both are null while their data isn't ready
 * yet (weights/locations still loading, or "off").
 */
export function formatPageNumber(
  mode: PageNumberMode,
  bookPage: number | null,
  bookTotal: number | null,
  chapterPage: number | null,
  chapterTotal: number | null,
): string | null {
  if (mode === "off") return null;
  if (mode === "book") {
    if (bookPage === null || bookTotal === null) return null;
    return `Page ${bookPage} of ${bookTotal}`;
  }
  if (chapterPage === null || chapterTotal === null) return null;
  return `Page ${chapterPage} of ${chapterTotal}`;
}
