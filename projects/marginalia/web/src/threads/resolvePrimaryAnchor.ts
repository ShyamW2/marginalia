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

/**
 * Found live 2026-09-01: the margin rail and Annotations overview each drew
 * one row per `highlights` entry — the flat, per-anchor shape this module's
 * own `resolveOpenHighlightId` was written to look past. A 4-anchor thread
 * read as four unrelated highlights on both surfaces instead of one
 * annotation. Groups by the same key `resolveOpenHighlightId` already uses
 * for "these belong to one annotation" (`primaryHighlightId ?? id`) —
 * order-preserving (first-seen key wins its position), so a caller that
 * fed sorted input gets sorted groups back.
 */
export function groupHighlightsByThread(highlights: HighlightWithThread[]): HighlightWithThread[][] {
  const order: string[] = [];
  const groups = new Map<string, HighlightWithThread[]>();
  for (const highlight of highlights) {
    const key = highlight.primaryHighlightId ?? highlight.id;
    const existing = groups.get(key);
    if (existing) {
      existing.push(highlight);
    } else {
      groups.set(key, [highlight]);
      order.push(key);
    }
  }
  return order.map((key) => groups.get(key)!);
}

/** The group's representative row for display — the primary anchor when one
 * is present in the group (it's the only member carrying the thread's own
 * `hasAnswer`/messageCount, per D3), falling back to the group's first
 * member for a threadless, ungrouped highlight (a group of one). */
export function groupPrimary(group: HighlightWithThread[]): HighlightWithThread {
  return group.find((h) => h.primaryHighlightId === null) ?? group[0];
}
