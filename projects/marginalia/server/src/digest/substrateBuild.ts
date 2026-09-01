// extract() requires zod/v4 schema instances — see llm/provider.ts's comment.
import { z } from "zod/v4";
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Resource } from "@marginalia/shared";
import { LLMError, type LLMProvider } from "../llm/provider.js";
import type { ResourceTextSection } from "../library/store.js";
import { splitIntoChunks } from "./build.js";
import { locateQuoteAnchor } from "./chapterAnchor.js";
import {
  getChapterSubstrate,
  putChapterSubstrate,
  type ChapterSubstrate,
  type SubstrateClaim,
  type SubstratePassage,
} from "./substrateStore.js";

// Same conservative estimate as build.ts/thematicBuild.ts — duplicated
// rather than imported, one constant, not worth the file coupling.
const CHARS_PER_TOKEN = 3.5;
const MAP_BUDGET_FRACTION = 0.25;

/**
 * M37 §A2: "cap it, and scale the cap in code from chapter length (a floor
 * and a ceiling around ~1,500-2,000 tokens for a typical chapter). Same
 * rule as M35 §C3: the model is never asked to decide its own budget."
 *
 * This is a different axis than `MAP_BUDGET_FRACTION` above — that one sizes
 * an *input* chunk against the provider's context window (how much chapter
 * text one call may read). This sizes the substrate's *output*: how much a
 * one-time, brief-blind extraction may keep, forever, per chapter. A short
 * chapter gets the floor rather than being padded to the ceiling; a long
 * chapter is clamped at the ceiling rather than growing without bound —
 * decisions.md 2026-08-31 calls this "a length-scaled cap" precisely because
 * neither bound alone is the rule, the clamp between them is.
 *
 * The model is never told this number and asked to hit it — `extractSubstrate`
 * passes a generous-but-finite schema max (`substrateSchemaCaps`) so a single
 * call can't run away, and `clampSubstrateToBudget` enforces the real budget
 * afterward, the same division of labor `clampToTokenBudget` (dictionary/
 * define.ts) uses for Define's output cap: never trust the model's restraint,
 * enforce on the way out.
 */
const SUBSTRATE_TOKEN_FLOOR = 1500;
const SUBSTRATE_TOKEN_CEILING = 2000;
const SUBSTRATE_BUDGET_FRACTION = 0.15;

// Exported for §C2's eviction, which re-applies this same length-scaled
// budget when a full re-read's quotes push a chapter's substrate over cap —
// the cap is one rule (A2), not two, whether it's enforced at first build or
// on every later append.
export function substrateTokenBudget(chapterChars: number): number {
  const chapterTokens = chapterChars / CHARS_PER_TOKEN;
  const scaled = chapterTokens * SUBSTRATE_BUDGET_FRACTION;
  return Math.round(Math.max(SUBSTRATE_TOKEN_FLOOR, Math.min(SUBSTRATE_TOKEN_CEILING, scaled)));
}

// Rough per-item token costs, used only to turn a token budget into a
// generous schema `.max()` — not the enforcement itself (see
// `clampSubstrateToBudget`). Getting these estimates a little wrong costs
// nothing: an overshoot is trimmed afterward, an undershoot just means the
// schema ceiling was looser than the real budget for that call.
const TOKENS_PER_PASSAGE_ESTIMATE = 45;
const TOKENS_PER_CLAIM_ESTIMATE = 30;
const MIN_PASSAGES_SCHEMA_MAX = 6;
const MIN_CLAIMS_SCHEMA_MAX = 4;

function substrateSchemaCaps(tokenBudget: number): { maxPassages: number; maxClaims: number } {
  return {
    maxPassages: Math.max(MIN_PASSAGES_SCHEMA_MAX, Math.round((tokenBudget * 0.6) / TOKENS_PER_PASSAGE_ESTIMATE)),
    maxClaims: Math.max(MIN_CLAIMS_SCHEMA_MAX, Math.round((tokenBudget * 0.4) / TOKENS_PER_CLAIM_ESTIMATE)),
  };
}

function substrateSchema(maxPassages: number, maxClaims: number) {
  return z.object({
    passages: z.array(z.object({ quote: z.string() })).max(maxPassages),
    claims: z.array(z.object({ claim: z.string(), holder: z.string().nullable().optional() })).max(maxClaims),
  });
}
type SubstrateExtraction = z.infer<ReturnType<typeof substrateSchema>>;

/**
 * M37 §A1: brief-blind on purpose — this pass never sees the reader's brief,
 * so what it keeps has to be useful to *any* brief a reader might set later,
 * not just today's. That's the whole point: §B's brief-driven pass reads
 * this instead of the chapter, so a brief edit no longer re-reads the
 * chapter at all.
 */
function substrateInstructions(maxPassages: number, maxClaims: number): string {
  return (
    `You are building a durable, reusable extract of one book chapter — material future analysis ` +
    `passes will read *instead of* the full chapter text, so it needs to stand on its own regardless ` +
    `of what angle a later reading takes.\n\n` +
    `Respond with a single JSON object with exactly these keys:\n` +
    `{\n` +
    `  "passages": [{"quote": "a passage copied VERBATIM from the chapter — a sentence or two, ` +
    `something a later analysis could quote as evidence"}],\n` +
    `  "claims": [{"claim": "a claim, tension, or position the chapter stakes out or dramatizes", ` +
    `"holder": "who holds this position — a character name, or null if it's the narration's own claim ` +
    `rather than a character's"}]\n` +
    `}\n\n` +
    `Return at most ${maxPassages} passages: the chapter's most quotable, evidentiary moments — not a ` +
    `retelling, a set of passages a later reader would want back. Copy each one exactly; do not ` +
    `paraphrase, summarize, or combine sentences that aren't adjacent in the text.\n\n` +
    `Return at most ${maxClaims} claims: the chapter's actual claims and tensions and who holds which ` +
    `position, not a list of plot events.\n\n` +
    `Return only the JSON object, no other text.`
  );
}

async function extractSubstratePart(
  provider: LLMProvider,
  title: string,
  author: string | null,
  chapterLabel: string,
  partText: string,
  maxPassages: number,
  maxClaims: number,
  signal?: AbortSignal,
): Promise<SubstrateExtraction> {
  const header = author ? `${title} by ${author}` : title;
  return provider.extract({
    instructions: substrateInstructions(maxPassages, maxClaims),
    input: `${header}\n\n${chapterLabel}:\n\n${partText}`,
    schema: substrateSchema(maxPassages, maxClaims),
    signal,
  });
}

function estimateTokens(text: string): number {
  return text.length / CHARS_PER_TOKEN;
}

function clampListToBudget<T>(items: T[], costOf: (item: T) => number, budget: number): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const item of items) {
    const cost = costOf(item);
    if (used + cost > budget) break;
    kept.push(item);
    used += cost;
  }
  return kept;
}

/**
 * M37 §A2's actual enforcement — the schema max above only bounds one call;
 * this bounds the chapter's total substrate regardless of how many calls
 * contributed to it (a split chapter's chunks are concatenated before this
 * runs). Passages get 60% of the budget over claims' 40% because they're
 * §B2's whole reason to exist — the verbatim material a brief-driven pass
 * must still be able to quote from — while claims are prose the brief pass
 * can restate in its own words either way.
 */
export function clampSubstrateToBudget(
  passages: SubstratePassage[],
  claims: SubstrateClaim[],
  tokenBudget: number,
): { passages: SubstratePassage[]; claims: SubstrateClaim[] } {
  const passageBudget = tokenBudget * 0.6;
  const claimBudget = tokenBudget * 0.4;
  return {
    passages: clampListToBudget(
      passages,
      (p) => estimateTokens(p.quote) + estimateTokens(p.prefix) + estimateTokens(p.suffix),
      passageBudget,
    ),
    claims: clampListToBudget(claims, (c) => estimateTokens(c.claim) + estimateTokens(c.holder ?? ""), claimBudget),
  };
}

/**
 * M37 §C2's eviction order: passages two or more briefs independently drew
 * on first, then passages one brief has, then passages no brief has ever
 * selected — §A1's brief-blind leftovers, the first to go. Stable within a
 * tier (`Array.prototype.sort` is a stable sort in Node), so among equally
 * "cared about" passages the ones already earlier in the list — closer to
 * the chapter's own reading order, since that's the order §A1 extracted them
 * in — survive a clamp before later ones do.
 */
function sortPassagesByDrawPriority(passages: SubstratePassage[]): SubstratePassage[] {
  const tier = (p: SubstratePassage) => (p.drawnByBriefHashes.length >= 2 ? 0 : p.drawnByBriefHashes.length === 1 ? 1 : 2);
  return [...passages].sort((a, b) => tier(a) - tier(b));
}

/**
 * M37 §C1/§C2: called after every thematic pass — brief-driven-from-notes or
 * a full re-read alike — with the theme quotes that pass actually surfaced.
 * Two things happen to the chapter's stored substrate:
 *
 *  - A quote that's already a substrate passage gets this brief's hash added
 *    to `drawnByBriefHashes` (a Set in effect; already-present is a no-op).
 *    This is what makes "two or more briefs independently selected it" a
 *    real, measurable signal rather than a guess — it fires for the cheap
 *    "notes" path too, since that path's quotes are, by §B2's construction,
 *    always copied verbatim out of the substrate it read.
 *  - A quote §A1 never kept — only reachable when this pass read the full
 *    chapter rather than the substrate — is appended as a brand new passage,
 *    already credited with this brief's draw. This is the actual "merge
 *    back" §C1 asks for: a brief-blind extractor can miss a passage a real
 *    brief turns out to need, and a full re-read is how the bank learns it.
 *
 * Either way, the result is re-clamped to §A2's own length-scaled cap
 * (`substrateTokenBudget`), evicting by `sortPassagesByDrawPriority` first —
 * append-only would otherwise converge on keeping the whole chapter, which
 * is exactly what the cap exists to prevent.
 *
 * A no-op if this chapter has no substrate row yet, which shouldn't happen
 * in practice (`runThematicDigest` always calls `ensureChapterSubstrate`
 * first, for both modes) — silently doing nothing rather than throwing
 * mirrors `putChapterSubstrate`'s own sibling stores treating "nothing to
 * update yet" as unremarkable.
 */
export function mergeQuotesIntoSubstrate(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
  sectionText: string,
  quotes: string[],
  briefHash: string,
): void {
  const substrate = getChapterSubstrate(db, resourceId, spineIndex);
  if (!substrate) return;

  const passages = substrate.passages.map((p) => ({ ...p, drawnByBriefHashes: [...p.drawnByBriefHashes] }));
  for (const quote of quotes) {
    const anchor = locateQuoteAnchor(sectionText, quote);
    if (!anchor) continue; // defensive: callers only ever pass already-located quotes
    const existing = passages.find((p) => p.quote === anchor.exact);
    if (existing) {
      if (!existing.drawnByBriefHashes.includes(briefHash)) existing.drawnByBriefHashes.push(briefHash);
    } else {
      passages.push({ quote: anchor.exact, prefix: anchor.prefix, suffix: anchor.suffix, drawnByBriefHashes: [briefHash] });
    }
  }

  const tokenBudget = substrateTokenBudget(sectionText.length);
  const passageBudget = tokenBudget * 0.6;
  const evicted = clampListToBudget(
    sortPassagesByDrawPriority(passages),
    (p) => estimateTokens(p.quote) + estimateTokens(p.prefix) + estimateTokens(p.suffix),
    passageBudget,
  );

  putChapterSubstrate(db, {
    resourceId,
    spineIndex,
    passages: evicted,
    claims: substrate.claims,
    sourceHash: substrate.sourceHash,
  });
}

/**
 * M37 §A1/decision 11: the model returns quote text, code locates it. A
 * quote that doesn't locate verbatim in the chapter it was supposedly drawn
 * from is dropped — same "LLM proposes, code disposes" rule
 * `thematicBuild.ts`'s `evidenceFilterThemes` applies to theme quotes, and
 * for the same reason: an unlocatable "verbatim" passage is exactly the
 * ungrounded-anchor problem this whole substrate exists to avoid handing to
 * §B2's brief pass.
 */
function evidenceFilterPassages(quotes: string[], sectionText: string): SubstratePassage[] {
  const passages: SubstratePassage[] = [];
  for (const quote of quotes) {
    const anchor = locateQuoteAnchor(sectionText, quote);
    // §A1's own extraction is brief-blind, so a passage it keeps hasn't been
    // drawn on by any brief yet — §C2's eviction only starts ranking a
    // passage once a real thematic pass has selected it as evidence.
    if (anchor) passages.push({ quote: anchor.exact, prefix: anchor.prefix, suffix: anchor.suffix, drawnByBriefHashes: [] });
  }
  return passages;
}

/**
 * Builds one chapter's substrate from its raw text. Returns null (never
 * throws for this specific case), mirroring `digestChapter`/
 * `digestChapterThematic`, when the chapter still won't fit after one
 * automatic re-split — the caller marks it failed and continues the run.
 */
async function buildChapterSubstrate(
  provider: LLMProvider,
  contextTokens: number,
  title: string,
  author: string | null,
  chapterLabel: string,
  sectionText: string,
  signal?: AbortSignal,
): Promise<{ passages: SubstratePassage[]; claims: SubstrateClaim[] } | null> {
  const inputBudgetChars = contextTokens * MAP_BUDGET_FRACTION * CHARS_PER_TOKEN;
  const outputTokenBudget = substrateTokenBudget(sectionText.length);
  const { maxPassages, maxClaims } = substrateSchemaCaps(outputTokenBudget);

  async function attempt(maxChars: number): Promise<{ passages: SubstratePassage[]; claims: SubstrateClaim[] }> {
    const chunks = splitIntoChunks(sectionText, maxChars);
    const rawQuotes: string[] = [];
    const claims: SubstrateClaim[] = [];
    for (const chunk of chunks) {
      const part = await extractSubstratePart(
        provider,
        title,
        author,
        chapterLabel,
        chunk,
        maxPassages,
        maxClaims,
        signal,
      );
      rawQuotes.push(...part.passages.map((p) => p.quote));
      claims.push(...part.claims.map((c) => ({ claim: c.claim, holder: c.holder ?? null })));
    }
    const passages = evidenceFilterPassages(rawQuotes, sectionText);
    return clampSubstrateToBudget(passages, claims, outputTokenBudget);
  }

  try {
    return await attempt(inputBudgetChars);
  } catch (err) {
    if (!(err instanceof LLMError) || err.code !== "context_too_large") throw err;
    try {
      return await attempt(inputBudgetChars / 2);
    } catch (err2) {
      if (err2 instanceof LLMError && err2.code === "context_too_large") return null;
      throw err2;
    }
  }
}

function hashText(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * M37 §A1: "stored per (resource, chapter), keyed on the section's source
 * hash the way the plot layer already is — not on the brief." Row existence
 * is coverage, the same as `chapter_digests` (resources are immutable on
 * import — decision 5 — so a chapter's hash never has occasion to mismatch
 * an existing row); a chapter already substrated is returned as-is, never
 * rebuilt, regardless of what the resource's current brief is.
 */
export async function ensureChapterSubstrate(
  db: Database.Database,
  provider: LLMProvider,
  contextTokens: number,
  resource: Resource,
  chapterLabel: string,
  section: ResourceTextSection,
  signal?: AbortSignal,
): Promise<ChapterSubstrate | null> {
  const existing = getChapterSubstrate(db, resource.id, section.spineIndex);
  if (existing) return existing;

  const built = await buildChapterSubstrate(
    provider,
    contextTokens,
    resource.title,
    resource.author,
    chapterLabel,
    section.text,
    signal,
  );
  if (!built) return null;

  return putChapterSubstrate(db, {
    resourceId: resource.id,
    spineIndex: section.spineIndex,
    passages: built.passages,
    claims: built.claims,
    sourceHash: hashText(section.text),
  });
}

/**
 * M37 §B1: renders a stored substrate as the text a brief-driven pass reads
 * *instead of* the chapter. §B2: passages are kept quote-first and verbatim,
 * with their located context shown as "prefix…quote…suffix" — the shape the
 * brief pass needs to keep proposing them verbatim rather than paraphrasing
 * the material it's given.
 */
export function serializeSubstrateForPrompt(substrate: ChapterSubstrate): string {
  // Blank-line-separated, not one-per-line: `splitIntoChunks` (build.ts)
  // only ever splits at a `\n{2,}` boundary, so a substrate large enough to
  // need a second call (a small local model's context window, or §C's
  // future append/evict growing a chapter's bank past one call's budget)
  // has to give it paragraph-shaped boundaries to split on, the same as raw
  // chapter text already does.
  const passageLines = substrate.passages.length
    ? substrate.passages
        .map((p, i) => `${i + 1}. "${p.quote}" (in context: "${p.prefix}[${p.quote}]${p.suffix}")`)
        .join("\n\n")
    : "(none extracted)";
  const claimLines = substrate.claims.length
    ? substrate.claims.map((c) => `- ${c.claim}${c.holder ? ` — held by ${c.holder}` : ""}`).join("\n\n")
    : "(none extracted)";
  return (
    `This is not the full chapter text — it is a pre-extracted substrate of the chapter's most ` +
    `evidentiary passages and its claims/tensions, prepared without knowledge of any reading angle. ` +
    `Ground your analysis in it, and draw your quotes only from the verbatim passages below (copy them ` +
    `exactly as given, including their exact wording).\n\n` +
    `Verbatim passages:\n${passageLines}\n\n` +
    `Claims and tensions:\n${claimLines}`
  );
}
