// extract() requires zod/v4 schema instances — see llm/provider.ts's comment.
import { z } from "zod/v4";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Resource } from "@marginalia/shared";
import { LLMError, type LLMProvider } from "../llm/provider.js";
import { sectionLabel, sectionUiLabel } from "../llm/context.js";
import type { ResourceTextSection } from "../library/store.js";
import {
  getBookDigestSnapshot,
  getDigestRun,
  listChapterDigests,
  putBookDigest,
  putBookDigestSnapshot,
  putChapterDigest,
  putDigestRun,
  type BookDocumentFields,
  type ChapterDocumentFields,
  type DigestRun,
} from "./store.js";
import { getLookahead } from "./lookahead.js";
import { visibleChapterDigests } from "./visibility.js";

// Same conservative estimate as llm/context.ts and llm/usage.ts — duplicated
// rather than imported, one constant, not worth the file coupling.
const CHARS_PER_TOKEN = 3.5;
// Cap each map call's input at ~25% of the provider's context window, per
// decisions.md 2026-07-28 (later) — leaves headroom for instructions and
// output, and is small enough that even a modest local-model context window
// still gets a useful chunk per call.
const MAP_BUDGET_FRACTION = 0.25;
const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
const RATE_LIMIT_JITTER_MS = 30_000;
// M29 (decisions.md 2026-08-22): a plain "network" LLMError — a stalled/reset connection
// to a local endpoint (e.g. Ollama evicting and reloading a model between calls) — used to
// have no retry at all, unlike rate_limit's pause/resume. Short, in-process, exponential
// backoff: transient enough to self-heal within a few tens of seconds without needing a
// client to be watching (the rate-limit pause/resume is driven by the Scan staying open;
// this one isn't, on purpose, since digesting "in the background while reading" means
// nobody is watching the Scan).
const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_BASE_MS = 10_000;

/**
 * Retries `fn` on a network-class LLMError with short exponential backoff
 * (10s/20s/40s), giving a transient connection blip a chance to self-heal
 * without the caller needing to watch for it. Any other error — including a
 * genuine cancellation (`signal.aborted`) — passes straight through
 * unretried, same as before this existed.
 */
export async function withNetworkRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof LLMError && err.code === "network" && !signal?.aborted;
      if (!retryable || attempt >= NETWORK_RETRY_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_BASE_MS * 2 ** attempt));
    }
  }
}

const ChapterPartSchema = z.object({
  summary: z.string(),
  themes: z.array(z.string()).max(8),
  characters: z.array(z.string()).max(20),
  // M18 "chapter labels on the coverage tiles": a few words, not a
  // sentence — the scan's coverage tile needs to fit it in a small hover
  // readout. Spoiler-gating happens in routes/digest.ts, not here; this
  // schema doesn't know about the reader's bookmark.
  title: z.string(),
});
type ChapterPart = z.infer<typeof ChapterPartSchema>;

// M22 (AUDIO.md "Casting", amended 2026-07-28): this reduce step is pass 1
// of the audio cast scan, not a second scanner — its `cast` output is
// AUDIO.md's `CastSchema` shape verbatim, enriched from what the map step
// already recorded per chapter (`characters: string[]`, name-only).
const BookReduceCastMemberSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).max(10),
  gender: z.enum(["female", "male", "unknown"]),
  ageHint: z.enum(["child", "young", "adult", "old", "unknown"]),
  description: z.string(),
  lineCountHint: z.enum(["many", "few"]),
});
const BookReduceSchema = z.object({
  synopsis: z.string(),
  cast: z.array(BookReduceCastMemberSchema).max(20),
  narratorGender: z.enum(["female", "male", "unknown"]),
  themes: z.array(z.string()).max(12),
});
type BookReduce = z.infer<typeof BookReduceSchema>;

// M39 §D2 (PDF.md §5, settled decision 18): a `document`-kind resource's
// own prompt/schema pair — "characters"/"cast" produce noise for a paper,
// so this asks for the fields a paper's own shape actually has instead.
// Selects nothing else: the chunking/hierarchical-reduce machinery below is
// shared verbatim with the `prose` path.
const DocumentPartSchema = z.object({
  summary: z.string(),
  contributions: z.array(z.string()).max(8),
  methods: z.string(),
  findings: z.array(z.string()).max(8),
  limitations: z.string(),
  themes: z.array(z.string()).max(8),
  title: z.string(),
});
type DocumentPart = z.infer<typeof DocumentPartSchema>;

const DocumentReduceSchema = z.object({
  synopsis: z.string(),
  keyClaims: z.array(z.string()).max(12),
  methods: z.string(),
  themes: z.array(z.string()).max(12),
});
type DocumentReduce = z.infer<typeof DocumentReduceSchema>;

const CHAPTER_PART_INSTRUCTIONS = `You are building a compact digest of a book, one chapter at a time, for a
reader who wants a grounded summary without re-reading the whole book.

Respond with a single JSON object with exactly these keys:
{
  "summary": "a few sentences summarizing what happens in this chapter/part",
  "themes": ["short theme or motif names, at most 8"],
  "characters": ["character names who appear, at most 20"],
  "title": "a short, specific, descriptive title for this chapter/part (a few words, not a full sentence)"
}

Return only the JSON object, no other text.`;

const CHAPTER_MERGE_INSTRUCTIONS = `You are merging several partial summaries of ONE book chapter (it was too
long to summarize in a single pass, so it was split into consecutive parts)
into one coherent chapter digest.

Respond with a single JSON object with exactly these keys:
{
  "summary": "a few sentences summarizing the whole chapter, combining the parts",
  "themes": ["short theme or motif names, at most 8, deduplicated"],
  "characters": ["character names who appear, at most 20, deduplicated"],
  "title": "a short, specific, descriptive title for the whole chapter (a few words, not a full sentence)"
}

Return only the JSON object, no other text.`;

const BOOK_REDUCE_INSTRUCTIONS = `You are producing a book-level digest from a set of chapter (or chapter-
group) summaries. This digest also drives an audio narration feature that
assigns a distinct voice to each character, so the cast needs enough detail
for that — not just a one-line description.

Respond with a single JSON object with exactly these keys:
{
  "synopsis": "a few paragraphs summarizing the book as a whole, in reading order",
  "cast": [ { "name": "...", "aliases": ["..."], "gender": "...", "ageHint": "...", "description": "...", "lineCountHint": "..." } ],
  "narratorGender": "the implied gender of the narrating voice — female | male | unknown",
  "themes": ["short theme names for the book overall, at most 12, deduplicated"]
}

"cast" holds at most 20 people, most prominent (many lines) first. Each entry:
- "name": canonical character name as it appears in the book
- "aliases": other names or titles this character is called, e.g. "Mr. Samsa" — NOT generic references like "he" or "the father"
- "gender": "female" | "male" | "unknown"
- "ageHint": "child" | "young" | "adult" | "old" | "unknown"
- "description": one line describing them
- "lineCountHint": "many" (a major character with a lot of dialogue) or "few"

Return only the JSON object, no other text.`;

const DOCUMENT_PART_INSTRUCTIONS = `You are building a compact digest of a scientific/technical document, one
section at a time, for a reader who wants a grounded summary without
re-reading the whole thing. This is a paper or report, not a story — do not
invent characters or a narrative.

Respond with a single JSON object with exactly these keys:
{
  "summary": "a few sentences summarizing what this section covers",
  "contributions": ["what this section contributes or claims, at most 8"],
  "methods": "a few sentences on the method(s) used in this section, or empty if none",
  "findings": ["concrete results or findings stated in this section, at most 8"],
  "limitations": "a few sentences on limitations/caveats stated in this section, or empty if none",
  "themes": ["short theme or topic names, at most 8"],
  "title": "a short, specific, descriptive title for this section (a few words, not a full sentence)"
}

Return only the JSON object, no other text.`;

const DOCUMENT_MERGE_INSTRUCTIONS = `You are merging several partial summaries of ONE section of a scientific/
technical document (it was too long to summarize in a single pass, so it
was split into consecutive parts) into one coherent section digest.

Respond with a single JSON object with exactly these keys:
{
  "summary": "a few sentences summarizing the whole section, combining the parts",
  "contributions": ["contributions/claims, at most 8, deduplicated"],
  "methods": "a few sentences on the method(s), combining the parts, or empty if none",
  "findings": ["findings, at most 8, deduplicated"],
  "limitations": "a few sentences on limitations, combining the parts, or empty if none",
  "themes": ["short theme or topic names, at most 8, deduplicated"],
  "title": "a short, specific, descriptive title for the whole section (a few words, not a full sentence)"
}

Return only the JSON object, no other text.`;

const DOCUMENT_REDUCE_INSTRUCTIONS = `You are producing a document-level digest from a set of section summaries
of one scientific/technical document (a paper or report — not a story; do
not invent characters, a cast or a narrator).

Respond with a single JSON object with exactly these keys:
{
  "synopsis": "a few paragraphs summarizing the document as a whole, in reading order",
  "keyClaims": ["the document's main claims/contributions overall, at most 12, deduplicated"],
  "methods": "a few sentences summarizing the method(s) used across the document",
  "themes": ["short theme/topic names for the document overall, at most 12, deduplicated"]
}

Return only the JSON object, no other text.`;

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Splits chapter text into chunks under `maxChars`, breaking at paragraph
 * boundaries with a small overlap (the previous chunk's last paragraph is
 * repeated as the next chunk's first) so a summary made from one chunk
 * doesn't lose context right at the seam. A single paragraph longer than
 * `maxChars` is left as its own oversized chunk — the caller's
 * context_too_large handling, not this function, is what deals with a
 * genuine overflow.
 */
export function splitIntoChunks(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return [text];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const p of paragraphs) {
    if (currentLen + p.length > maxChars && current.length > 0) {
      chunks.push(current.join("\n\n"));
      const overlap = current[current.length - 1];
      current = [overlap, p];
      currentLen = overlap.length + p.length;
    } else {
      current.push(p);
      currentLen += p.length;
    }
  }
  if (current.length > 0) chunks.push(current.join("\n\n"));
  return chunks.length > 0 ? chunks : [text];
}

async function extractChapterPart(
  provider: LLMProvider,
  title: string,
  author: string | null,
  chapterLabel: string,
  partText: string,
  partIndex: number,
  partCount: number,
  signal?: AbortSignal,
): Promise<ChapterPart> {
  const header = author ? `${title} by ${author}` : title;
  const partSuffix = partCount > 1 ? ` (part ${partIndex + 1} of ${partCount})` : "";
  return provider.extract({
    instructions: CHAPTER_PART_INSTRUCTIONS,
    input: `${header}\n\n${chapterLabel}${partSuffix}:\n\n${partText}`,
    schema: ChapterPartSchema,
    signal,
  });
}

async function mergeChapterParts(
  provider: LLMProvider,
  chapterLabel: string,
  parts: ChapterPart[],
  signal?: AbortSignal,
): Promise<ChapterPart> {
  const input = parts
    .map(
      (p, i) =>
        `Part ${i + 1} title: ${p.title}\nPart ${i + 1} summary: ${p.summary}\nThemes: ${p.themes.join(", ")}\nCharacters: ${p.characters.join(", ")}`,
    )
    .join("\n\n");
  return provider.extract({
    instructions: CHAPTER_MERGE_INSTRUCTIONS,
    input: `${chapterLabel} — ${parts.length} parts to merge:\n\n${input}`,
    schema: ChapterPartSchema,
    signal,
  });
}

/**
 * Digests one chapter. Returns null (never throws for this specific case)
 * when the chapter still won't fit after one automatic re-split — the
 * caller marks it failed and continues the run, per decisions.md 2026-07-28
 * (later). Any other LLMError (rate_limit, auth, network, ...) propagates
 * so the caller can pause/abort the whole run instead of silently losing it.
 */
async function digestChapter(
  provider: LLMProvider,
  contextTokens: number,
  title: string,
  author: string | null,
  chapterLabel: string,
  text: string,
  signal?: AbortSignal,
): Promise<ChapterPart | null> {
  const budgetChars = contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;

  async function attempt(maxChars: number): Promise<ChapterPart> {
    const chunks = splitIntoChunks(text, maxChars);
    const parts: ChapterPart[] = [];
    for (let i = 0; i < chunks.length; i++) {
      parts.push(
        await extractChapterPart(provider, title, author, chapterLabel, chunks[i], i, chunks.length, signal),
      );
    }
    return chunks.length === 1 ? parts[0] : mergeChapterParts(provider, chapterLabel, parts, signal);
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

// M39 §D2: the `document`-kind mirrors of `extractChapterPart`/
// `mergeChapterParts`/`digestChapter` above — same chunking, retry and
// re-split behaviour, a different prompt/schema pair.
async function extractDocumentPart(
  provider: LLMProvider,
  title: string,
  author: string | null,
  sectionLabelText: string,
  partText: string,
  partIndex: number,
  partCount: number,
  signal?: AbortSignal,
): Promise<DocumentPart> {
  const header = author ? `${title} by ${author}` : title;
  const partSuffix = partCount > 1 ? ` (part ${partIndex + 1} of ${partCount})` : "";
  return provider.extract({
    instructions: DOCUMENT_PART_INSTRUCTIONS,
    input: `${header}\n\n${sectionLabelText}${partSuffix}:\n\n${partText}`,
    schema: DocumentPartSchema,
    signal,
  });
}

async function mergeDocumentParts(
  provider: LLMProvider,
  sectionLabelText: string,
  parts: DocumentPart[],
  signal?: AbortSignal,
): Promise<DocumentPart> {
  const input = parts
    .map(
      (p, i) =>
        `Part ${i + 1} title: ${p.title}\nPart ${i + 1} summary: ${p.summary}\n` +
        `Contributions: ${p.contributions.join(", ")}\nMethods: ${p.methods}\n` +
        `Findings: ${p.findings.join(", ")}\nLimitations: ${p.limitations}\nThemes: ${p.themes.join(", ")}`,
    )
    .join("\n\n");
  return provider.extract({
    instructions: DOCUMENT_MERGE_INSTRUCTIONS,
    input: `${sectionLabelText} — ${parts.length} parts to merge:\n\n${input}`,
    schema: DocumentPartSchema,
    signal,
  });
}

async function digestDocumentSection(
  provider: LLMProvider,
  contextTokens: number,
  title: string,
  author: string | null,
  sectionLabelText: string,
  text: string,
  signal?: AbortSignal,
): Promise<DocumentPart | null> {
  const budgetChars = contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;

  async function attempt(maxChars: number): Promise<DocumentPart> {
    const chunks = splitIntoChunks(text, maxChars);
    const parts: DocumentPart[] = [];
    for (let i = 0; i < chunks.length; i++) {
      parts.push(
        await extractDocumentPart(provider, title, author, sectionLabelText, chunks[i], i, chunks.length, signal),
      );
    }
    return chunks.length === 1 ? parts[0] : mergeDocumentParts(provider, sectionLabelText, parts, signal);
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

async function reduceBatch(
  provider: LLMProvider,
  title: string,
  author: string | null,
  chapters: { spineIndex: number; summary: string; themes: string[]; characters: string[] }[],
  signal?: AbortSignal,
): Promise<BookReduce> {
  const header = author ? `${title} by ${author}` : title;
  const input = chapters
    .map(
      (c) =>
        `Chapter ${c.spineIndex}: ${c.summary}\nThemes: ${c.themes.join(", ")}\nCharacters: ${c.characters.join(", ")}`,
    )
    .join("\n\n");
  return provider.extract({
    instructions: BOOK_REDUCE_INSTRUCTIONS,
    input: `${header}\n\n${input}`,
    schema: BookReduceSchema,
    signal,
  });
}

/**
 * Hierarchical reduce (decisions.md 2026-07-28 later: "reduce
 * hierarchically in batches" if the reduce input itself exceeds budget).
 * Regenerates from every chapter row passed in — always consistent with
 * whatever chapters currently exist, never a stale merge of an earlier run.
 */
export async function reduceBookDigest(
  provider: LLMProvider,
  contextTokens: number,
  title: string,
  author: string | null,
  chapters: { spineIndex: number; summary: string; themes: string[]; characters: string[] }[],
  signal?: AbortSignal,
): Promise<BookReduce> {
  const budgetChars = contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;
  const totalChars = chapters.reduce((sum, c) => sum + c.summary.length, 0);

  if (chapters.length <= 1 || totalChars <= budgetChars) {
    return reduceBatch(provider, title, author, chapters, signal);
  }

  const batches: (typeof chapters)[] = [];
  let current: typeof chapters = [];
  let currentLen = 0;
  for (const c of chapters) {
    if (currentLen + c.summary.length > budgetChars && current.length > 0) {
      batches.push(current);
      current = [c];
      currentLen = c.summary.length;
    } else {
      current.push(c);
      currentLen += c.summary.length;
    }
  }
  if (current.length > 0) batches.push(current);

  const intermediate: typeof chapters = [];
  for (const batch of batches) {
    const result = await reduceBatch(provider, title, author, batch, signal);
    intermediate.push({
      spineIndex: batch[0].spineIndex,
      summary: result.synopsis,
      themes: result.themes,
      characters: result.cast.map((c) => c.name),
    });
  }
  return reduceBookDigest(provider, contextTokens, title, author, intermediate, signal);
}

// M39 §D2: the `document`-kind mirror of `reduceBatch`/`reduceBookDigest`
// above — same hierarchical-batching shape, a different prompt/schema pair,
// and no "Characters:" line (a section's own `characters` field is always
// empty for a document, per `runDigest` below). An intermediate batch's
// `keyClaims`/`methods` don't carry forward into the next reduction level —
// the same lossy compression the prose path already accepts for its own
// `cast` at that stage, and it only ever triggers for a document long
// enough to exceed one reduce call's budget.
async function reduceDocumentBatch(
  provider: LLMProvider,
  title: string,
  author: string | null,
  sections: { spineIndex: number; summary: string; themes: string[] }[],
  signal?: AbortSignal,
): Promise<DocumentReduce> {
  const header = author ? `${title} by ${author}` : title;
  const input = sections
    .map((s) => `Section ${s.spineIndex}: ${s.summary}\nThemes: ${s.themes.join(", ")}`)
    .join("\n\n");
  return provider.extract({
    instructions: DOCUMENT_REDUCE_INSTRUCTIONS,
    input: `${header}\n\n${input}`,
    schema: DocumentReduceSchema,
    signal,
  });
}

export async function reduceDocumentDigest(
  provider: LLMProvider,
  contextTokens: number,
  title: string,
  author: string | null,
  sections: { spineIndex: number; summary: string; themes: string[] }[],
  signal?: AbortSignal,
): Promise<DocumentReduce> {
  const budgetChars = contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;
  const totalChars = sections.reduce((sum, s) => sum + s.summary.length, 0);

  if (sections.length <= 1 || totalChars <= budgetChars) {
    return reduceDocumentBatch(provider, title, author, sections, signal);
  }

  const batches: (typeof sections)[] = [];
  let current: typeof sections = [];
  let currentLen = 0;
  for (const s of sections) {
    if (currentLen + s.summary.length > budgetChars && current.length > 0) {
      batches.push(current);
      current = [s];
      currentLen = s.summary.length;
    } else {
      current.push(s);
      currentLen += s.summary.length;
    }
  }
  if (current.length > 0) batches.push(current);

  const intermediate: typeof sections = [];
  for (const batch of batches) {
    const result = await reduceDocumentBatch(provider, title, author, batch, signal);
    intermediate.push({ spineIndex: batch[0].spineIndex, summary: result.synopsis, themes: result.themes });
  }
  return reduceDocumentDigest(provider, contextTokens, title, author, intermediate, signal);
}

export interface DigestPreflight {
  chapterCount: number;
  estimatedInputTokens: number;
  estimatedCalls: number;
}

/** No LLM call — a cheap estimate from section lengths, for the pre-flight
 * shown before committing to a run (decisions.md 2026-07-28 later). */
export function estimateDigestRun(
  sections: ResourceTextSection[],
  spineStart: number,
  spineEnd: number,
  contextTokens: number,
): DigestPreflight {
  const inRange = sections.filter((s) => s.spineIndex >= spineStart && s.spineIndex <= spineEnd);
  const budgetChars = contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;
  let estimatedInputTokens = 0;
  let estimatedCalls = 0;
  for (const section of inRange) {
    const chunkCount = Math.max(1, Math.ceil(section.text.length / budgetChars));
    estimatedCalls += chunkCount + (chunkCount > 1 ? 1 : 0); // + 1 merge call if split
    estimatedInputTokens += Math.round(section.text.length / CHARS_PER_TOKEN);
  }
  estimatedCalls += 1; // the final reduce call
  return { chapterCount: inRange.length, estimatedInputTokens, estimatedCalls };
}

/**
 * Runs (or resumes) a digest over [spineStart, spineEnd]. Sequential by
 * design (decisions.md 2026-07-28 later: "never a parallel blast" —
 * concurrency stays at 1). A rate-limit error pauses the run rather than
 * failing it: already-committed chapters are never re-processed or re-paid
 * for, since resumability comes from coverage (which chapters already have
 * rows), not a cursor. The reduce step always regenerates from every
 * currently available chapter row, so the book digest is always consistent
 * with its parts even after a partial/paused run.
 */
export async function runDigest(
  db: Database.Database,
  provider: LLMProvider,
  resource: Resource,
  sections: ResourceTextSection[],
  spineStart: number,
  spineEnd: number,
  /** M20.6 job registry: aborts the in-flight `extract()` call and stops the
   * loop from starting the next chapter. Already-committed chapters (and the
   * source-hash cache) are what makes a cancelled-then-resumed run free of
   * duplicate work, not a cursor. */
  signal?: AbortSignal,
  onProgress?: (current: number, total: number, message: string | null) => void,
): Promise<DigestRun> {
  const contextTokens = provider.capabilities().contextTokens;
  const priorRun = getDigestRun(db, resource.id);
  const failedSpineIndices = new Set<number>(
    priorRun && priorRun.spineStart === spineStart && priorRun.spineEnd === spineEnd
      ? priorRun.failedSpineIndices
      : [],
  );

  const persistRun = (status: DigestRun["status"], resumesAt: string | null, lastError: string | null) =>
    putDigestRun(db, {
      resourceId: resource.id,
      spineStart,
      spineEnd,
      status,
      failedSpineIndices: [...failedSpineIndices],
      resumesAt,
      lastError,
    });

  persistRun("running", null, null);

  const covered = new Set(listChapterDigests(db, resource.id).map((c) => c.spineIndex));
  const pending = sections
    .filter((s) => s.spineIndex >= spineStart && s.spineIndex <= spineEnd)
    .filter((s) => !covered.has(s.spineIndex))
    .sort((a, b) => a.spineIndex - b.spineIndex);

  // +1 for the final reduce step, so the progress bar doesn't sit at 100%
  // while the (sometimes slower, whole-book) reduce call is still running.
  const total = pending.length + 1;
  let current = 0;
  onProgress?.(current, total, null);

  for (const section of pending) {
    // Cooperative stop between chapters — the in-flight call itself is what
    // `signal` passed to digestChapter() actually aborts; this is what keeps
    // a cancelled run from starting one more chapter after that.
    if (signal?.aborted) return persistRun("failed", null, "Cancelled");

    // The prompt-facing label (raw, 0-based spineIndex) stays separate from
    // the UI-facing one (M20.5's `S<n>`, decisions.md 2026-08-12 ruling 2:
    // "sectionLabel is for model prompts and may never reach a surface").
    const chapterLabel = sectionLabel(section.spineIndex, resource.metadata.chapterTitles);
    const chapterUiLabel = sectionUiLabel(sections, section.spineIndex, resource.metadata.chapterTitles);
    // Reported before the await, not after — the model audio/render.ts:221
    // already follows: `current` still names how many chapters are *done*,
    // so the label of the one now starting is what's current while it's the
    // slow part in flight, instead of the previous chapter's label sitting
    // there stale for the whole call (decisions.md 2026-08-12 ruling 2).
    onProgress?.(current, total, chapterUiLabel);
    try {
      // M39 §D2/settled decision 18: `kind` selects a prompt/schema pair
      // and nothing else — everything else in this loop (chunking, retry,
      // progress, failure tracking, coverage) is shared verbatim.
      if (resource.kind === "document") {
        const part = await withNetworkRetry(
          () =>
            digestDocumentSection(
              provider,
              contextTokens,
              resource.title,
              resource.author,
              chapterLabel,
              section.text,
              signal,
            ),
          signal,
        );
        if (part === null) {
          failedSpineIndices.add(section.spineIndex);
          current++;
          continue;
        }
        const documentFields: ChapterDocumentFields = {
          contributions: part.contributions,
          methods: part.methods,
          findings: part.findings,
          limitations: part.limitations,
        };
        putChapterDigest(db, {
          resourceId: resource.id,
          spineIndex: section.spineIndex,
          summary: part.summary,
          themes: part.themes,
          characters: [],
          title: part.title,
          documentFields,
          sourceHash: hashText(section.text),
        });
        failedSpineIndices.delete(section.spineIndex);
        current++;
        continue;
      }

      const part = await withNetworkRetry(
        () =>
          digestChapter(
            provider,
            contextTokens,
            resource.title,
            resource.author,
            chapterLabel,
            section.text,
            signal,
          ),
        signal,
      );
      if (part === null) {
        failedSpineIndices.add(section.spineIndex);
        current++;
        continue;
      }
      putChapterDigest(db, {
        resourceId: resource.id,
        spineIndex: section.spineIndex,
        summary: part.summary,
        themes: part.themes,
        characters: part.characters,
        title: part.title,
        documentFields: null,
        sourceHash: hashText(section.text),
      });
      failedSpineIndices.delete(section.spineIndex);
      current++;
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

  const allChapters = listChapterDigests(db, resource.id);
  if (allChapters.length > 0) {
    // The `total = pending.length + 1`'s "+1" is this call — named, so it
    // doesn't read as the previous chapter's label left standing while the
    // slowest part of the run is what's actually in flight (decisions.md
    // 2026-08-12 ruling 2).
    onProgress?.(current, total, "Composing the book digest");
    try {
      // M39 §D2/§D3: a `document` book reduce asks for `keyClaims`/`methods`,
      // never `cast`/`narratorGender` — stored as an empty cast so audio
      // falls back to M21 single-voice narration with no new audio path
      // (settled decision 18).
      if (resource.kind === "document") {
        const reduced = await withNetworkRetry(
          () => reduceDocumentDigest(provider, contextTokens, resource.title, resource.author, allChapters, signal),
          signal,
        );
        const documentFields: BookDocumentFields = { keyClaims: reduced.keyClaims, methods: reduced.methods };
        putBookDigest(db, {
          resourceId: resource.id,
          synopsis: reduced.synopsis,
          cast: [],
          narratorGender: "unknown",
          themes: reduced.themes,
          documentFields,
        });
      } else {
        const reduced = await withNetworkRetry(
          () => reduceBookDigest(provider, contextTokens, resource.title, resource.author, allChapters, signal),
          signal,
        );
        putBookDigest(db, {
          resourceId: resource.id,
          synopsis: reduced.synopsis,
          cast: reduced.cast,
          narratorGender: reduced.narratorGender,
          themes: reduced.themes,
          documentFields: null,
        });
      }
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

/**
 * M19.5 "spoiler-safe digest display" (decisions.md 2026-07-29 later):
 * book-level synopsis/cast/themes are a reduce over every digested chapter,
 * so they inherently spoil — this maintains the *safe* variant, reduced
 * only from chapters up to the reader's bookmark. Regenerates only when the
 * "frontier" (the furthest digested chapter within the bookmark) has
 * advanced past what the cached snapshot already covers — a page turn with
 * no new digest coverage inside that range is a no-op, satisfying "the lazy
 * regeneration does not fire on every page turn". Best-effort: a missing
 * provider just means the safe synopsis doesn't update this time, not an
 * error surfaced to the reader.
 */
export async function maybeRefreshBookDigestSnapshot(
  db: Database.Database,
  provider: LLMProvider | null,
  resource: Resource,
  bookmarkSpineIndex: number,
): Promise<void> {
  // M34 §B1: routed through the shared mask — with lookahead on for this
  // book, the "safe" snapshot simply becomes the full reduce, same as it
  // already would be once the reader finishes the book and the bookmark
  // reaches the end.
  const noMask = getLookahead(db, resource.id);
  const chaptersInBookmark = visibleChapterDigests(db, resource.id, { bookmarkSpineIndex, noMask });
  if (chaptersInBookmark.length === 0) return;

  const frontier = Math.max(...chaptersInBookmark.map((c) => c.spineIndex));
  const existing = getBookDigestSnapshot(db, resource.id);
  if (existing && existing.upToSpineIndex >= frontier) return;
  if (!provider) return;

  // M39 §D2: this snapshot must use the same prompt/schema pair `runDigest`
  // used to build the chapters it's reducing — calling the `prose` reduce
  // against a `document` resource would silently ask a paper's own chapters
  // for a cast/narrator every time GET /:id/digest opens.
  if (resource.kind === "document") {
    const reduced = await reduceDocumentDigest(
      provider,
      provider.capabilities().contextTokens,
      resource.title,
      resource.author,
      chaptersInBookmark,
    );
    putBookDigestSnapshot(db, {
      resourceId: resource.id,
      upToSpineIndex: frontier,
      synopsis: reduced.synopsis,
      cast: [],
      narratorGender: "unknown",
      themes: reduced.themes,
    });
    return;
  }

  const reduced = await reduceBookDigest(
    provider,
    provider.capabilities().contextTokens,
    resource.title,
    resource.author,
    chaptersInBookmark,
  );
  putBookDigestSnapshot(db, {
    resourceId: resource.id,
    upToSpineIndex: frontier,
    synopsis: reduced.synopsis,
    cast: reduced.cast,
    narratorGender: reduced.narratorGender,
    themes: reduced.themes,
  });
}

// M29 (decisions.md 2026-08-22): resourceIds with a refresh currently in
// flight — guards refreshBookDigestSnapshotInBackground against stacking up
// duplicate concurrent LLM calls when "open digest" fires the same refresh
// on every request before the first one has landed.
const snapshotRefreshInFlight = new Set<string>();

/**
 * Fire-and-forget wrapper around `maybeRefreshBookDigestSnapshot` — this is
 * what the actual "open digest" route calls, per M29: the GET route used to
 * `await` the refresh inline with no try/catch, so a slow or failing local
 * model blocked (or 500'd) the entire page load despite the refresh being
 * documented as "best-effort, silent". Genuinely making it silent means
 * genuinely not blocking on it: the caller gets whatever snapshot already
 * exists immediately, and this updates it in the background for the next
 * open/poll. Errors are swallowed here (logged only) — a failed refresh is
 * never worse than the stale snapshot the reader was already seeing.
 */
export function refreshBookDigestSnapshotInBackground(
  db: Database.Database,
  provider: LLMProvider | null,
  resource: Resource,
  bookmarkSpineIndex: number,
): void {
  if (!provider || snapshotRefreshInFlight.has(resource.id)) return;
  snapshotRefreshInFlight.add(resource.id);
  maybeRefreshBookDigestSnapshot(db, provider, resource, bookmarkSpineIndex)
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[digest] background snapshot refresh failed:", err instanceof Error ? err.message : err);
    })
    .finally(() => snapshotRefreshInFlight.delete(resource.id));
}
