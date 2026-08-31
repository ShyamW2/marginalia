import type { HighlightWithThread } from "@marginalia/shared";

/**
 * M35 §D3: resolves a clicked highlight id to the one whose panel should
 * actually open. A highlight is either the primary anchor of its own
 * thread (or has none at all) — in which case it opens itself, unchanged
 * from before this milestone — or it's a non-primary `thread_anchors`
 * member, server-flagged via `primaryHighlightId` (highlights.ts's
 * `listHighlightsWithThreadsForResource`), in which case resolving to the
 * primary is what makes "clicking any linked quote opens the same
 * annotation" true instead of silently starting a second, unrelated thread.
 *
 * Looks the clicked id up in `pool` rather than trusting a stale object a
 * caller might be holding — every call site here reads from either
 * `highlightsRef.current` or a just-fetched array, so this only ever sees
 * current data.
 */
export function resolveOpenHighlightId(pool: HighlightWithThread[], highlightId: string): string {
  const clicked = pool.find((h) => h.id === highlightId);
  return clicked?.primaryHighlightId ?? highlightId;
}
