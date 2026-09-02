import type { ChapterAnchorResult, ChapterQuestion, ThematicStatus } from "@marginalia/shared";

/** `?reveal=0,3,5` — spine indices explicitly revealed this session, same
 * client-tracked (never persisted) shape the server's `parseRevealedIndices`
 * (routes/digest.ts) expects. */
export function revealParams(revealed: Set<number>): URLSearchParams {
  const params = new URLSearchParams();
  if (revealed.size > 0) params.set("reveal", [...revealed].join(","));
  return params;
}

/** M38 §C2: the reading pane's own hover notice needs the brief's text
 * without paying for a full `ThematicStatus` fetch (every chapter's
 * analysis) just to reach its `.brief.text` field — this hits the same
 * lightweight GET the Digest page's save button already round-trips
 * through. */
export async function fetchBrief(resourceId: string): Promise<string> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/brief`);
    if (!res.ok) return "";
    const body = (await res.json()) as { text: string };
    return body.text;
  } catch {
    return "";
  }
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
 *
 * M35 §B2: the quote doesn't always win. When it can't be located, the
 * server seeds a chapter-level question instead of pinning a highlight to
 * the chapter's opening — `text` (the posed question's own wording, not the
 * quote) travels along so the server has something to seed it with.
 */
export async function createChapterAnchor(
  resourceId: string,
  spineIndex: number,
  quote: string,
  text: string,
): Promise<ChapterAnchorResult | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/chapter-anchor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spineIndex, quote, text }),
    });
    if (!res.ok) return null;
    return (await res.json()) as ChapterAnchorResult;
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

/** M32 B: creates the chapter's own question on first write. M36 C1: a
 * second, *different* question about the same chapter is refused by the
 * server (409) rather than silently replacing the first — the caller must
 * tell the reader, not just retry or drop it. */
export type UpsertChapterQuestionResult =
  | { ok: true; question: ChapterQuestion }
  | { ok: false; reason: "conflict"; existing: ChapterQuestion }
  | { ok: false; reason: "error" };

export async function upsertChapterQuestion(
  resourceId: string,
  spineIndex: number,
  question: string,
): Promise<UpsertChapterQuestionResult> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/chapter-questions/${spineIndex}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (res.status === 409) {
      const data = (await res.json()) as { existing: ChapterQuestion };
      return { ok: false, reason: "conflict", existing: data.existing };
    }
    if (!res.ok) return { ok: false, reason: "error" };
    return { ok: true, question: (await res.json()) as ChapterQuestion };
  } catch {
    return { ok: false, reason: "error" };
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
