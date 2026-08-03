// extract() requires zod/v4 schema instances — see llm/provider.ts's comment.
import { z } from "zod/v4";
import type Database from "better-sqlite3";
import type { Resource } from "@marginalia/shared";
import { LLMError, type LLMProvider } from "../llm/provider.js";
import { sectionLabel } from "../llm/context.js";
import type { ResourceTextSection } from "../library/store.js";
import { splitIntoChunks } from "./build.js";
import {
  getBrief,
  getThematicRun,
  hashBrief,
  listThematicDigests,
  putThematicDigest,
  putThematicRun,
  type ThematicRun,
} from "./thematicStore.js";

// Same conservative estimate as build.ts — duplicated rather than imported,
// one constant, not worth the file coupling (build.ts's own comment on this).
const CHARS_PER_TOKEN = 3.5;
const MAP_BUDGET_FRACTION = 0.25;
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
const RATE_LIMIT_JITTER_MS = 30_000;

// Questions carry a verbatim `quote` alongside their `text` — decision 11
// ("the model never returns positions... it returns text and code
// locates it"): the quote is what lets a click-through create a real,
// text-anchored highlight instead of guessing a chapter-start position.
const ThematicQuestionSchema = z.object({
  text: z.string(),
  quote: z.string(),
});
const ThematicPartSchema = z.object({
  analysis: z.string(),
  themes: z.array(z.string()).max(8),
  questions: z.array(ThematicQuestionSchema).max(3),
});
type ThematicPart = z.infer<typeof ThematicPartSchema>;

/** Injected with the reader's brief (if any) and instructed to read the
 * chapter *through* it — and, per decisions.md 2026-07-29 (later)'s
 * instruction fix, to reason past the book's edges when the brief invites
 * it rather than hedging every applied thought as "outside the text". */
function thematicInstructions(briefText: string): string {
  const briefBlock = briefText.trim()
    ? `The reader has set this standing angle for their reading — analyse the chapter *through* it, not just alongside it:\n"${briefText.trim()}"\n\n`
    : "The reader hasn't set a standing angle yet — analyse the chapter's themes on their own terms.\n\n";

  return (
    `You are the thematic layer of a book digest: not what happens (that's covered elsewhere), ` +
    `but what the chapter is *about* — its ideas, tensions, and what a thoughtful reader might ` +
    `take from it.\n\n${briefBlock}` +
    `Ground everything in the chapter's actual text, but don't hedge or apologise when a theme ` +
    `invites reasoning past the page — draw the connection plainly, the way a sharp conversation ` +
    `about the book would.\n\n` +
    `Respond with a single JSON object with exactly these keys:\n` +
    `{\n` +
    `  "analysis": "a paragraph or two on what this chapter is about thematically, through the reader's angle if one was given",\n` +
    `  "themes": ["short theme or motif names, at most 8"],\n` +
    `  "questions": [{"text": "a specific question this chapter raises", "quote": "a short passage copied VERBATIM from the chapter that the question is about"}]\n` +
    `}\n\n` +
    `"questions" should have 2-3 entries, each with its own grounding quote copied exactly ` +
    `from the chapter text — do not paraphrase the quote.\n\n` +
    `Return only the JSON object, no other text.`
  );
}

const THEMATIC_MERGE_INSTRUCTIONS = `You are merging several partial thematic analyses of ONE book chapter (it was too long to
analyse in a single pass, so it was split into consecutive parts) into one coherent thematic
digest for the whole chapter.

Respond with a single JSON object with exactly these keys:
{
  "analysis": "a paragraph or two combining the parts into one coherent thematic reading",
  "themes": ["short theme or motif names, at most 8, deduplicated"],
  "questions": [{"text": "...", "quote": "..."}]
}

"questions" should keep the 2-3 best questions from the parts (deduplicated), each with its
original verbatim quote unchanged — never paraphrase or invent a quote at merge time.

Return only the JSON object, no other text.`;

async function extractThematicPart(
  provider: LLMProvider,
  briefText: string,
  title: string,
  author: string | null,
  chapterLabel: string,
  partText: string,
  partIndex: number,
  partCount: number,
  signal?: AbortSignal,
): Promise<ThematicPart> {
  const header = author ? `${title} by ${author}` : title;
  const partSuffix = partCount > 1 ? ` (part ${partIndex + 1} of ${partCount})` : "";
  return provider.extract({
    instructions: thematicInstructions(briefText),
    input: `${header}\n\n${chapterLabel}${partSuffix}:\n\n${partText}`,
    schema: ThematicPartSchema,
    signal,
  });
}

async function mergeThematicParts(
  provider: LLMProvider,
  chapterLabel: string,
  parts: ThematicPart[],
  signal?: AbortSignal,
): Promise<ThematicPart> {
  const input = parts
    .map(
      (p, i) =>
        `Part ${i + 1} analysis: ${p.analysis}\nThemes: ${p.themes.join(", ")}\n` +
        `Questions: ${p.questions.map((q) => `"${q.text}" (quote: "${q.quote}")`).join(" / ")}`,
    )
    .join("\n\n");
  return provider.extract({
    instructions: THEMATIC_MERGE_INSTRUCTIONS,
    input: `${chapterLabel} — ${parts.length} parts to merge:\n\n${input}`,
    schema: ThematicPartSchema,
    signal,
  });
}

/** Thematic analysis of one chapter, operating on the raw chapter text —
 * deliberately not on the plot layer's summary, so the two passes stay
 * fully independent calls (decisions.md: "do not build them as one call").
 * Returns null, never throws, when the chapter still won't fit after one
 * re-split, mirroring build.ts's digestChapter. */
async function digestChapterThematic(
  provider: LLMProvider,
  contextTokens: number,
  briefText: string,
  title: string,
  author: string | null,
  chapterLabel: string,
  text: string,
  signal?: AbortSignal,
): Promise<ThematicPart | null> {
  const budgetChars = contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;

  async function attempt(maxChars: number): Promise<ThematicPart> {
    const chunks = splitIntoChunks(text, maxChars);
    const parts: ThematicPart[] = [];
    for (let i = 0; i < chunks.length; i++) {
      parts.push(
        await extractThematicPart(
          provider,
          briefText,
          title,
          author,
          chapterLabel,
          chunks[i],
          i,
          chunks.length,
          signal,
        ),
      );
    }
    return chunks.length === 1 ? parts[0] : mergeThematicParts(provider, chapterLabel, parts, signal);
  }

  try {
    return await attempt(budgetChars);
  } catch (err) {
    if (!(err instanceof LLMError) || err.code !== "context_too_large") throw err;
    try {
      return await attempt(budgetChars / 2);
    } catch (err2) {
      if (err2 instanceof LLMError && err2.code === "context_too_large") return null;
      throw err2;
    }
  }
}

/**
 * Runs (or resumes) a thematic pass over [spineStart, spineEnd] under the
 * resource's *current* brief. Chapters already covered under this exact
 * brief are skipped (idempotent re-runs are free); chapters covered under a
 * stale brief are regenerated. No book-level reduce — the thematic layer is
 * per-chapter only (decisions.md doesn't ask for a book-level thematic
 * synopsis, and one would immediately raise the same spoiler question the
 * plot layer's book digest already has to solve).
 */
export async function runThematicDigest(
  db: Database.Database,
  provider: LLMProvider,
  resource: Resource,
  sections: ResourceTextSection[],
  spineStart: number,
  spineEnd: number,
  signal?: AbortSignal,
  onProgress?: (current: number, total: number, message: string | null) => void,
): Promise<ThematicRun> {
  const contextTokens = provider.capabilities().contextTokens;
  const brief = getBrief(db, resource.id);
  const briefHash = hashBrief(brief.text);

  const priorRun = getThematicRun(db, resource.id);
  const failedSpineIndices = new Set<number>(
    priorRun &&
      priorRun.spineStart === spineStart &&
      priorRun.spineEnd === spineEnd &&
      priorRun.briefHash === briefHash
      ? priorRun.failedSpineIndices
      : [],
  );

  const persistRun = (status: ThematicRun["status"], resumesAt: string | null, lastError: string | null) =>
    putThematicRun(db, {
      resourceId: resource.id,
      spineStart,
      spineEnd,
      briefHash,
      status,
      failedSpineIndices: [...failedSpineIndices],
      resumesAt,
      lastError,
    });

  persistRun("running", null, null);

  const coveredUnderBrief = new Set(
    listThematicDigests(db, resource.id)
      .filter((t) => t.briefHash === briefHash)
      .map((t) => t.spineIndex),
  );
  const pending = sections
    .filter((s) => s.spineIndex >= spineStart && s.spineIndex <= spineEnd)
    .filter((s) => !coveredUnderBrief.has(s.spineIndex))
    .sort((a, b) => a.spineIndex - b.spineIndex);

  const total = Math.max(pending.length, 1);
  let current = 0;
  onProgress?.(current, total, null);

  for (const section of pending) {
    if (signal?.aborted) return persistRun("failed", null, "Cancelled");

    const chapterLabel = sectionLabel(section.spineIndex, resource.metadata.chapterTitles);
    try {
      const part = await digestChapterThematic(
        provider,
        contextTokens,
        brief.text,
        resource.title,
        resource.author,
        chapterLabel,
        section.text,
        signal,
      );
      if (part === null) {
        failedSpineIndices.add(section.spineIndex);
        current++;
        onProgress?.(current, total, chapterLabel);
        continue;
      }
      putThematicDigest(db, {
        resourceId: resource.id,
        spineIndex: section.spineIndex,
        briefHash,
        briefText: brief.text,
        analysis: part.analysis,
        themes: part.themes,
        questions: part.questions,
      });
      failedSpineIndices.delete(section.spineIndex);
      current++;
      onProgress?.(current, total, chapterLabel);
    } catch (err) {
      if (err instanceof LLMError && err.code === "rate_limit") {
        const resumesAt = new Date(
          Date.now() + RATE_LIMIT_BACKOFF_MS + Math.random() * RATE_LIMIT_JITTER_MS,
        ).toISOString();
        return persistRun("paused_rate_limit", resumesAt, err.message);
      }
      persistRun("failed", null, signal?.aborted ? "Cancelled" : err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  onProgress?.(total, total, null);
  return persistRun("completed", null, null);
}
