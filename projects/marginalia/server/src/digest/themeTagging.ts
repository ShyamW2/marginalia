// extract() requires zod/v4 schema instances — see llm/provider.ts's comment.
import { z } from "zod/v4";
import type Database from "better-sqlite3";
import type { Highlight } from "@marginalia/shared";
import type { LLMProvider } from "../llm/provider.js";
import { getHighlightById } from "../annotations/highlights.js";
import { getThreadByHighlightId, listMessagesForThread } from "../annotations/threads.js";
import { listUntaggedHighlightIds, setThemesForHighlight } from "../annotations/highlightThemes.js";
import { listThemeVocabulary } from "./thematicStore.js";

const TagSchema = z.object({
  themes: z.array(z.string()),
});

function instructions(vocabulary: string[]): string {
  return (
    `You are tagging one reader's highlight (and, if present, their conversation about it) ` +
    `with themes from this book's fixed vocabulary. Pick zero or more themes from this exact ` +
    `list that the highlight genuinely relates to — do not invent new themes, do not include ` +
    `one that's only a loose association:\n\n${vocabulary.join(", ")}\n\n` +
    `Respond with a single JSON object: {"themes": ["...", "..."]}, using only themes from the ` +
    `list above (empty array if none apply). Return only the JSON object, no other text.`
  );
}

function buildTaggingInput(highlight: Highlight, threadText: string): string {
  const parts = [`Highlight: "${highlight.exact}"`];
  if (highlight.note.trim()) parts.push(`Reader's note: ${highlight.note.trim()}`);
  if (threadText.trim()) parts.push(`Discussion:\n${threadText.trim()}`);
  return parts.join("\n\n");
}

/**
 * Tags one highlight against the given vocabulary. "LLM proposes, code
 * disposes" (decision 2): the model's returned strings are filtered against
 * the actual vocabulary before anything is persisted — a hallucinated or
 * slightly-reworded theme name is dropped rather than silently growing the
 * vocabulary out from under the scan's filter UI.
 */
export async function tagHighlightThemes(
  provider: LLMProvider,
  highlight: Highlight,
  threadText: string,
  vocabulary: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  if (vocabulary.length === 0) return [];
  const result = await provider.extract({
    instructions: instructions(vocabulary),
    input: buildTaggingInput(highlight, threadText),
    schema: TagSchema,
    signal,
  });
  const allowed = new Set(vocabulary);
  return result.themes.filter((t) => allowed.has(t));
}

/**
 * Tags every untagged highlight in a resource (decisions.md 2026-07-29
 * later: "themes are tagged onto highlights... by an extract pass against
 * the thematic layer's vocabulary" — the M19.5 "semantic scan" task, and
 * the un-parking of the 2026-07-19 "LLM note supplementation" backlog
 * item). Scope cut, documented in NOTES.md: first-time tagging only — a
 * highlight already tagged is never re-tagged even if the book's theme
 * vocabulary has since grown (e.g. a later thematic run adds new themes).
 * Re-tagging against a moving vocabulary is a real feature but not this
 * pass's job; each highlight is tagged once, idempotently skipped after.
 * Sequential and best-effort per highlight — a mid-run LLMError propagates
 * to the caller, but every highlight tagged before the failure is already
 * persisted (setThemesForHighlight commits per-highlight), so a retry only
 * ever processes what's left.
 */
export async function runThemeTagging(
  db: Database.Database,
  provider: LLMProvider,
  resourceId: string,
  signal?: AbortSignal,
  onProgress?: (current: number, total: number, message: string | null) => void,
): Promise<number> {
  const vocabulary = listThemeVocabulary(db, resourceId);
  if (vocabulary.length === 0) return 0;

  const untaggedIds = listUntaggedHighlightIds(db, resourceId);
  const total = Math.max(untaggedIds.length, 1);
  let tagged = 0;
  onProgress?.(0, total, null);
  for (const id of untaggedIds) {
    if (signal?.aborted) break;
    const highlight = getHighlightById(db, id);
    if (!highlight) continue;
    const thread = getThreadByHighlightId(db, id);
    const threadText = thread
      ? listMessagesForThread(db, thread.id)
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n")
      : "";
    const themes = await tagHighlightThemes(provider, highlight, threadText, vocabulary, signal);
    setThemesForHighlight(db, id, themes);
    tagged++;
    onProgress?.(tagged, total, `Tagged ${tagged} of ${untaggedIds.length}`);
  }
  return tagged;
}
