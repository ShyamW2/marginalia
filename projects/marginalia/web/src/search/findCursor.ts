import type { SearchHit, SearchHitSource } from "@marginalia/shared";

/** A hit's source, legible (TASKS.md M24 C: "the source of each hit legible
 * in the results") — the Scan's own vocabulary for what "text"/"highlight"/
 * "note"/"thread" mean to a reader, not the wire format's identifiers. */
const SEARCH_HIT_SOURCE_LABELS: Record<SearchHitSource, string> = {
  text: "Book text",
  highlight: "Your highlight",
  note: "Your note",
  thread: "Your thread",
};

export function searchHitSourceLabel(source: SearchHitSource): string {
  return SEARCH_HIT_SOURCE_LABELS[source];
}

/**
 * Steps the find cursor to the next/previous hit, wrapping at either end —
 * "‹ › steps through that one set on whichever surface you are on"
 * (decisions.md 2026-08-14, M24 design pass). `-1` in (nothing selected yet)
 * lands on the first hit going forward or the last one going backward, so a
 * fresh search's first Enter/›always lands somewhere real.
 */
export function stepFindCursor(
  currentIndex: number,
  total: number,
  direction: "next" | "prev",
): number {
  if (total === 0) return -1;
  if (currentIndex < 0) return direction === "next" ? 0 : total - 1;
  const delta = direction === "next" ? 1 : -1;
  return (currentIndex + delta + total) % total;
}

/**
 * Which of `hits` belong to the section currently on screen, in the ordered
 * result set's own index — the reader only ever shows one spread at a time,
 * so only its own hits get a painted mark (TASKS.md M24 A: "matches in the
 * current spread paint in place").
 */
export function hitsForSection(
  hits: SearchHit[],
  spineIndex: number,
): { hit: SearchHit; index: number }[] {
  return hits
    .map((hit, index) => ({ hit, index }))
    .filter(({ hit }) => hit.spineIndex === spineIndex);
}
