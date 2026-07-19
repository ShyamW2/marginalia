import type { HighlightImportance } from "@marginalia/shared";

/**
 * Small fetch helpers for the two per-highlight attributes M9 adds
 * (importance stars, freeform tags) — shared by the reader's thread panel
 * and the scan's hover ghost readout, DESIGN.md's two prescribed editing
 * surfaces for the same data.
 */

export async function fetchHighlightTags(highlightId: string): Promise<string[]> {
  try {
    const res = await fetch(`/api/highlights/${highlightId}/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { tags: string[] };
    return data.tags;
  } catch {
    return [];
  }
}

export async function updateHighlightTags(
  highlightId: string,
  tags: string[],
): Promise<string[]> {
  try {
    const res = await fetch(`/api/highlights/${highlightId}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) return tags;
    const data = (await res.json()) as { tags: string[] };
    return data.tags;
  } catch {
    return tags;
  }
}

export async function updateHighlightImportance(
  highlightId: string,
  importance: HighlightImportance,
): Promise<void> {
  try {
    await fetch(`/api/highlights/${highlightId}/importance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ importance }),
    });
  } catch {
    // best-effort — a failed star/unstar just doesn't persist this time
  }
}
