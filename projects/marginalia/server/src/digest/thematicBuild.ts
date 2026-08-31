// extract() requires zod/v4 schema instances — see llm/provider.ts's comment.
import { z } from "zod/v4";
import type Database from "better-sqlite3";
import type { Resource } from "@marginalia/shared";
import { LLMError, type LLMProvider } from "../llm/provider.js";
import { sectionLabel } from "../llm/context.js";
import type { ResourceTextSection } from "../library/store.js";
import { splitIntoChunks, withNetworkRetry } from "./build.js";
import { locateQuoteAnchor } from "./chapterAnchor.js";
import { persistThematicHighlights } from "./thematicHighlights.js";
import { runThemeDistillation } from "./themeDistillation.js";
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
// M35 §C2: `theme` optionally names which of this part's own themes the
// question is evidence for — validated against that part's surviving theme
// names in `extractThematicPart` (never trusted as-is; a name that doesn't
// match is nulled out, not invented into a new theme).
const ThematicQuestionSchema = z.object({
  text: z.string(),
  quote: z.string(),
  theme: z.string().nullable().optional(),
});

// M35 §C1: a theme is no longer a bare name — it carries 1-3 verbatim
// quotes, the same decision-11 shape as a question's own `quote`. §C3b: the
// name itself is capped short (a backstop; the prompt wording in
// `thematicInstructions` is what actually gets a name rather than a thesis).
const ThematicThemeSchema = z.object({
  name: z.string().max(60),
  quotes: z.array(z.string()).min(1).max(3),
});
type ThematicTheme = z.infer<typeof ThematicThemeSchema>;

// Named rather than inline because M34 §0b's log reports each count against
// its ceiling: "does the model ever come in under the maximum it's given?"
// is one of the two questions decisions.md 2026-08-31 left to measurement,
// and a bare "themes=8" doesn't answer it.
// M35 §C3: raised 8 -> 12 per the 2026-08-31 measurement note ("before
// writing more prose about what the counts mean, raise MAX_THEMES to 12 and
// re-run one chapter of each book") — the ceiling was binding on East of
// Eden's chapters at 8, on two very different models, so 8 was measuring the
// cap rather than the chapter.
const MAX_THEMES = 12;
const MAX_QUESTIONS = 3;
const ThematicPartSchema = z.object({
  analysis: z.string(),
  themes: z.array(ThematicThemeSchema).max(MAX_THEMES),
  questions: z.array(ThematicQuestionSchema).max(MAX_QUESTIONS),
});
type ThematicPart = z.infer<typeof ThematicPartSchema>;

// M35 §B3: the merge step is asked for `analysis` and `themes` only — no
// `questions` key, so there's no free-text quote for the model to
// paraphrase or invent. Code assembles the merged questions itself, from
// the parts' own (already-verbatim) quotes. §C1 extends the same reasoning
// to theme quotes: the merge call still receives no chapter text, so it
// stays name-only here too — `attachMergedThemeQuotes` reattaches each
// merged name's quotes from the part that proposed it.
const ThematicMergeSchema = z.object({
  analysis: z.string(),
  themes: z.array(z.string()).max(MAX_THEMES),
});

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
    `  "themes": [{"name": "a 2-4 word theme or motif name, e.g. \\"Fate versus free will\\" — a label, not a sentence", "quotes": ["1-3 short passages copied VERBATIM from the chapter that best evidence this theme"]}],\n` +
    `  "questions": [{"text": "a specific question this chapter raises", "quote": "a short passage copied VERBATIM from the chapter that the question is about", "theme": "the name of the theme above this question is evidence for, or null"}]\n` +
    `}\n\n` +
    `Return at most ${MAX_THEMES} themes. Each theme name must be a short noun phrase naming the ` +
    `idea, not a thesis or sentence describing it.\n\n` +
    `"questions" should have 2-3 entries, each with its own grounding quote copied exactly ` +
    `from the chapter text — do not paraphrase the quote.\n\n` +
    `Return only the JSON object, no other text.`
  );
}

// M35 §B3: this used to also ask for "questions" and instruct the model, in
// English, not to paraphrase their quotes — settled decision 2 applied
// where it wasn't: the merge call receives no chapter text, so it has no
// way to verify a quote either, and asking it not to paraphrase doesn't
// stop it from doing so (the measured cause of every merge-corrupted
// quote). Code picks the surviving questions instead — see
// `selectMergedQuestions` — so the model is only ever asked for the two
// things it can't get verifiably wrong: combined prose and deduplicated
// theme names.
const THEMATIC_MERGE_INSTRUCTIONS = `You are merging several partial thematic analyses of ONE book chapter (it was too long to
analyse in a single pass, so it was split into consecutive parts) into one coherent thematic
digest for the whole chapter.

Respond with a single JSON object with exactly these keys:
{
  "analysis": "a paragraph or two combining the parts into one coherent thematic reading",
  "themes": ["short theme or motif names, at most ${MAX_THEMES}, deduplicated"]
}

Return only the JSON object, no other text.`;

/**
 * M35 §B3: "code selects which questions survive — one per part, up to
 * MAX_QUESTIONS — carrying each original `quote` string through untouched."
 * One question per part (its first, since each part's own extraction
 * already ranks its own best 2-3) rather than "the best N overall," because
 * ranking across parts would need to read the chapter text this function
 * never receives — the same reason the merge call itself doesn't score them.
 * A part with no questions simply contributes none.
 */
function selectMergedQuestions(parts: ThematicPart[]): ThematicPart["questions"] {
  const selected: ThematicPart["questions"] = [];
  for (const part of parts) {
    if (selected.length >= MAX_QUESTIONS) break;
    const [first] = part.questions;
    if (first) selected.push(first);
  }
  return selected;
}

/**
 * M35 §C3: "require a locatable verbatim quote per theme, and let code drop
 * the ones that fail." A quote that doesn't locate in the text it was
 * supposedly drawn from is dropped from its theme (not the whole part —
 * `locateQuoteAnchor`'s own typographic fold already forgives the common
 * case); a theme left with zero locatable quotes is dropped entirely, since
 * an unevidenced theme is exactly what §C3 says should not survive. Applied
 * per-part, against that part's own text — a theme proposed for part 2 is
 * evidenced by part 2, never by the whole chapter.
 */
function evidenceFilterThemes(themes: ThematicTheme[], partText: string): ThematicTheme[] {
  return themes
    .map((theme) => ({
      ...theme,
      quotes: theme.quotes.filter((quote) => locateQuoteAnchor(partText, quote) !== null),
    }))
    .filter((theme) => theme.quotes.length > 0);
}

/**
 * M35 §C2: a question's optional `theme` names one of *this part's own*
 * themes — "LLM proposes, code disposes" (decision 2) applied the same way
 * `themeTagging.ts` applies it to its vocabulary: a name that doesn't match
 * a theme that survived `evidenceFilterThemes` is nulled out rather than
 * trusted or left to invent a theme of its own.
 */
function validateQuestionThemes(part: ThematicPart): ThematicPart {
  const themeNames = new Set(part.themes.map((t) => t.name));
  return {
    ...part,
    questions: part.questions.map((q) => ({
      ...q,
      theme: q.theme && themeNames.has(q.theme) ? q.theme : null,
    })),
  };
}

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
  const result = await provider.extract({
    instructions: thematicInstructions(briefText),
    input: `${header}\n\n${chapterLabel}${partSuffix}:\n\n${partText}`,
    schema: ThematicPartSchema,
    signal,
  });
  return validateQuestionThemes({ ...result, themes: evidenceFilterThemes(result.themes, partText) });
}

/**
 * M35 §C1/§C3: the merge model returns deduplicated theme *names* only (see
 * `ThematicMergeSchema`'s comment) — quotes are reattached in code from
 * whichever part first proposed a matching name, the same "first in part
 * order" shape `selectMergedQuestions` already uses for questions below. A
 * merged name reworded enough that no part matches it keeps the model's
 * wording but starts with zero quotes, which is then dropped by the same
 * rule §C3 uses everywhere else — a renamed-but-unevidenced theme isn't a
 * special case, it's just another theme with no locatable quote.
 */
function attachMergedThemeQuotes(mergedNames: string[], parts: ThematicPart[]): ThematicTheme[] {
  const byName = new Map<string, ThematicTheme>();
  for (const part of parts) {
    for (const theme of part.themes) {
      const key = theme.name.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, theme);
    }
  }
  return mergedNames
    .map((name) => {
      const match = byName.get(name.trim().toLowerCase());
      return match ? { name, quotes: match.quotes } : { name, quotes: [] };
    })
    .filter((theme) => theme.quotes.length > 0);
}

async function mergeThematicParts(
  provider: LLMProvider,
  chapterLabel: string,
  parts: ThematicPart[],
  signal?: AbortSignal,
): Promise<ThematicPart> {
  const input = parts
    .map((p, i) => `Part ${i + 1} analysis: ${p.analysis}\nThemes: ${p.themes.map((t) => t.name).join(", ")}`)
    .join("\n\n");
  const merged = await provider.extract({
    instructions: THEMATIC_MERGE_INSTRUCTIONS,
    input: `${chapterLabel} — ${parts.length} parts to merge:\n\n${input}`,
    schema: ThematicMergeSchema,
    signal,
  });
  return {
    ...merged,
    themes: attachMergedThemeQuotes(merged.themes, parts),
    // §C2's `theme` reference is carried through untouched, same as the
    // question's own `quote` — it still names a *part*-level theme name,
    // which may not equal the merge's (possibly reworded) merged name. That
    // stitching is §C5's job when a question and a theme are wired into the
    // same highlight/thread; this only guarantees the reference was real.
    questions: selectMergedQuestions(parts),
  };
}

/** One chapter's thematic result plus the one fact about *how* it was
 * produced that M34 §0c needs: whether the chapter fit in a single call.
 * A chapter that split used to have its questions rewritten by
 * `mergeThematicParts`, which is handed the parts' text and never the
 * chapter's — the measured cause of a quote that doesn't locate, and the
 * thing that made the failure rate provider-dependent rather than
 * model-quality-dependent. M35 §B3 fixed the mechanism (the merge no longer
 * touches quotes at all); `partCount` stays, because whether a chapter split
 * is still the fact that makes a rewrite bug — the model's, not the
 * merge's — diagnosable after the fact. */
interface ThematicChapterResult {
  part: ThematicPart | null;
  /** Chunks the final successful attempt used. 1 = no split, no merge. */
  partCount: number;
}

/** Thematic analysis of one chapter, operating on the raw chapter text —
 * deliberately not on the plot layer's summary, so the two passes stay
 * fully independent calls (decisions.md: "do not build them as one call").
 * Returns a null `part`, never throws, when the chapter still won't fit
 * after one re-split, mirroring build.ts's digestChapter. */
async function digestChapterThematic(
  provider: LLMProvider,
  contextTokens: number,
  briefText: string,
  title: string,
  author: string | null,
  chapterLabel: string,
  text: string,
  signal?: AbortSignal,
): Promise<ThematicChapterResult> {
  const budgetChars = contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;
  let partCount = 0;

  async function attempt(maxChars: number): Promise<ThematicPart> {
    const chunks = splitIntoChunks(text, maxChars);
    partCount = chunks.length;
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
    return { part: await attempt(budgetChars), partCount };
  } catch (err) {
    if (!(err instanceof LLMError) || err.code !== "context_too_large") throw err;
    try {
      return { part: await attempt(budgetChars / 2), partCount };
    } catch (err2) {
      if (err2 instanceof LLMError && err2.code === "context_too_large") return { part: null, partCount };
      throw err2;
    }
  }
}

/**
 * M34 §0b: one line per chapter to the server log, no storage and no UI.
 *
 * It answers three questions that were being argued rather than measured
 * (decisions.md 2026-08-31): does a chapter split on this operator's digest
 * role; does the model ever come in under the theme/question ceiling it is
 * given; and how often does a question's verbatim quote actually locate in
 * the chapter text. The third is the one M35 §B is sized by — and it is read
 * *together with* `parts`, because the hypothesis is that a quote fails when
 * it has passed through a merge that never saw the chapter.
 *
 * Deliberately cheap: `locateQuoteAnchor` is the same function the
 * chapter-anchor route runs on click, so this measures the real path rather
 * than a proxy for it.
 */
function logThematicShape(
  chapterLabel: string,
  spineIndex: number,
  text: string,
  result: ThematicChapterResult,
): void {
  const head = `[thematic:shape] spine=${spineIndex} chars=${text.length} parts=${result.partCount}`;
  if (!result.part) {
    // eslint-disable-next-line no-console
    console.log(`${head} result=too_large ${JSON.stringify(chapterLabel)}`);
    return;
  }
  const { themes, questions } = result.part;
  const located = questions.filter((q) => locateQuoteAnchor(text, q.quote) !== null).length;
  // eslint-disable-next-line no-console
  console.log(
    `${head} analysis=${result.part.analysis.length} themes=${themes.length}/${MAX_THEMES} ` +
      `questions=${questions.length}/${MAX_QUESTIONS} quotes_located=${located}/${questions.length} ` +
      JSON.stringify(chapterLabel),
  );
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
      const result = await withNetworkRetry(
        () =>
          digestChapterThematic(
            provider,
            contextTokens,
            brief.text,
            resource.title,
            resource.author,
            chapterLabel,
            section.text,
            signal,
          ),
        signal,
      );
      logThematicShape(chapterLabel, section.spineIndex, section.text, result);
      const part = result.part;
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
      // M35 §C5/§D6: the evidenced themes become real, anchored highlights
      // now that the chapter's own thematic row is committed — same section
      // text the themes' quotes were evidence-filtered against.
      persistThematicHighlights(db, resource.id, section.spineIndex, section.text, part.themes);
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

  // M34 §C0: chain distillation onto the end of a run that actually added or
  // changed thematic rows — §C0a/§C3's ranking has no book-level vocabulary
  // to rank against without it. Thematic rows are already committed by this
  // point, so this is best-effort exactly like `maybeRefreshBookDigestSnapshot`:
  // a failed distillation logs and leaves the run `completed` rather than
  // failing it. Idempotent by design (`replaceBookThemes` is a wholesale
  // replace), so re-running it here on every thematic run is safe.
  if (pending.length > 0) {
    try {
      await runThemeDistillation(db, provider, resource, signal);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[thematic] distillation after run failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  onProgress?.(total, total, null);
  return persistRun("completed", null, null);
}
