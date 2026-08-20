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
function pickPageTotal(
  mode: PageNumberMode,
  bookPage: number | null,
  bookTotal: number | null,
  chapterPage: number | null,
  chapterTotal: number | null,
): [page: number, total: number] | null {
  if (mode === "off") return null;
  const page = mode === "book" ? bookPage : chapterPage;
  const total = mode === "book" ? bookTotal : chapterTotal;
  if (page === null || total === null) return null;
  return [page, total];
}

export function formatPageNumber(
  mode: PageNumberMode,
  bookPage: number | null,
  bookTotal: number | null,
  chapterPage: number | null,
  chapterTotal: number | null,
): string | null {
  const pt = pickPageTotal(mode, bookPage, bookTotal, chapterPage, chapterTotal);
  return pt ? `Page ${pt[0]} of ${pt[1]}` : null;
}

/** M24.7 §C: the foot's narrow-pane form (READER_REDESIGN.md §3, "Foot
 * shows `1 / 11` + `%` only") — `PageNumberDisplay` renders both and lets a
 * container query pick between them, so the swap needs no JS breakpoint. */
export function formatPageNumberCompact(
  mode: PageNumberMode,
  bookPage: number | null,
  bookTotal: number | null,
  chapterPage: number | null,
  chapterTotal: number | null,
): string | null {
  const pt = pickPageTotal(mode, bookPage, bookTotal, chapterPage, chapterTotal);
  return pt ? `${pt[0]} / ${pt[1]}` : null;
}
