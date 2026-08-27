import type { ChapterQuestion, ThematicStatus } from "@marginalia/shared";

/** `?reveal=0,3,5` — spine indices explicitly revealed this session, same
 * client-tracked (never persisted) shape the server's `parseRevealedIndices`
 * (routes/digest.ts) expects. */
export function revealParams(revealed: Set<number>): URLSearchParams {
  const params = new URLSearchParams();
  if (revealed.size > 0) params.set("reveal", [...revealed].join(","));
  return params;
}

export async function fetchThematicStatus(
  resourceId: string,
  revealed: Set<number>,
): Promise<ThematicStatus | null> {
  try {
    const qs = revealParams(revealed).toString();
    const res = await fetch(`/api/resources/${resourceId}/thematic${qs ? `?${qs}` : ""}`);
    if (!res.ok) return null;
    return (await res.json()) as ThematicStatus;
  } catch {
    return null;
  }
}

/**
 * Turns a posed question's verbatim quote into a real, clickable highlight
 * (decision 11: the model returns text, code locates it) — shared by the
 * Digest page's question chips and the reader's own chapter-end affordance
 * (M32 A), both of which just want "open a thread for this question" without
 * caring how the anchor was made.
 */
export async function createChapterAnchor(
  resourceId: string,
  spineIndex: number,
  quote: string,
): Promise<{ id: string } | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/chapter-anchor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spineIndex, quote }),
    });
    if (!res.ok) return null;
    return (await res.json()) as { id: string };
  } catch {
    return null;
  }
}

export async function fetchChapterQuestions(resourceId: string): Promise<ChapterQuestion[]> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/chapter-questions`);
    if (!res.ok) return [];
    const data = (await res.json()) as { questions: ChapterQuestion[] };
    return data.questions;
  } catch {
    return [];
  }
}

/** M32 B: creates the chapter's own question on first write, or replaces its
 * text on any later one — one row per chapter, no LLM involved. */
export async function upsertChapterQuestion(
  resourceId: string,
  spineIndex: number,
  question: string,
): Promise<ChapterQuestion | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/chapter-questions/${spineIndex}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ChapterQuestion;
  } catch {
    return null;
  }
}

/** M32 B: the answer-space, autosaved — same debounced pattern as a
 * highlight's own note (highlightMeta.ts:updateHighlightNote). */
export async function updateChapterQuestionNote(
  resourceId: string,
  spineIndex: number,
  note: string,
): Promise<void> {
  try {
    await fetch(`/api/resources/${resourceId}/chapter-questions/${spineIndex}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
  } catch {
    // best-effort — the next debounce tick (or the next open) tries again
  }
}
