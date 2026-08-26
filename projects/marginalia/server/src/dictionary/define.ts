import type Database from "better-sqlite3";
import type { Definition, DefineStreamEvent, Highlight, ProviderRole, Resource } from "@marginalia/shared";
import { findAllOccurrences, isDefinableTerm, normalizeDefineTerm } from "@marginalia/shared";
import { sectionLabel } from "../llm/context.js";
import { getProvider, LLMError } from "../llm/provider.js";
import { getRoleProfileRaw } from "../settings/providers.js";
import { getBookDigest, listChapterDigests } from "../digest/store.js";
import { getResourceTextSections } from "../library/store.js";
import { getDictionary } from "./wordnet.js";

/**
 * M30 C, "Define": dictionary first, the book's own digest as fallback,
 * hard-capped. The reasoning is settled in decisions.md 2026-08-24 ("Define:
 * a dictionary first, the digest as fallback — capped") and must not be
 * re-decided here. What this file owes that entry:
 *
 *  1. **The dictionary is a real dictionary**, not a model told to act like
 *     one — bundled, offline, free, and answering with every provider
 *     disconnected. See `wordnet.ts`. Settled decision 10 makes a dictionary
 *     *API* a third named cloud exception, which M30 does not authorise.
 *  2. **The fallback is the digest rung, never the whole book** (settled
 *     decision 8 as amended for M17), because the case it exists for is "a
 *     term this book has developed", and that is precisely what the digest
 *     and the surrounding pages carry.
 *
 *     ⚠️ M30 E feedback (2026-08-27): the fallback used to fire automatically
 *     on a dictionary miss. Operator feedback on the shipped M30 C: a reader
 *     who reaches for Define mid-sentence didn't necessarily ask for a
 *     100+-second reasoning-model call — that decision belongs to them, not
 *     to a miss. `defineHighlight` below now stops at the dictionary and
 *     returns `reason: "dictionary_miss"` when a provider *is* configured
 *     (still `"no_provider"` when one isn't — there's nothing to offer
 *     deepening with). The digest-rung call itself moved to
 *     `deepenDefinition`, run only once the reader explicitly asks, and
 *     narrating its real stages as it goes (never a fabricated
 *     chain-of-thought — see its own comment).
 *  3. **Under 100 output tokens, enforced twice — both times on our side.**
 *     The cap is a product constraint: a definition that runs long has
 *     stopped being a definition and started being a thread, which the reader
 *     can already open by asking. The stream stops once enough *visible* text
 *     has arrived, and `clampToTokenBudget` trims what did. ⚠️ It is
 *     deliberately **not** enforced as a provider output ceiling — see the
 *     measurements below for what that costs.
 *  4. **Both paths are designed states on failure** — never a spinner that
 *     never resolves, never a crash.
 */

/** M30 C's "<100 output token cap", as a **product** constraint on the
 * definition the reader sees. Enforced on the way out, by us. */
export const DEFINE_MAX_OUTPUT_TOKENS = 90;

/*
 * ⚠️ Why the cap is NOT passed to the provider as a max-output-tokens limit,
 * measured live on 2026-08-26 against a local `qwen3.5-hermes` via Ollama.
 *
 * Asking a **reasoning model** for few output tokens does not buy a short
 * answer; it buys **silence**. The model spends its whole budget on thinking
 * tokens — which arrive in `reasoning_content`, a field `openaiCompat.ts`
 * does not read — and never reaches the visible answer. Measured, same
 * prompt and the same ~1,100-token context every time:
 *
 *     ceiling  tokens used  visible answer
 *        90            90   "" (empty)
 *      1024          1024   "" (empty)
 *      2000          2000   "" (empty) — in SIX of six repeat trials, and
 *                           2,000 is the operator's own query-role setting
 *      4000          3524   a correct one-sentence definition
 *      8192          1487   a correct one-sentence definition
 *
 * Instruction wording made no difference (three long-prompt and three
 * short-prompt trials at 2,000 all returned empty): it is a budget problem,
 * not a prompt problem. This model's reasoning alone needs 1,500–3,500 tokens
 * on this grounding.
 *
 * A ceiling that turns "define this" into "no definition found" on a whole
 * class of models is a bug, not a constraint — and note that the **reader's
 * own configured ceiling** does it just as effectively as ours would.
 *
 * So Define asks the provider for a floor of headroom instead — and it is
 * allowed to, uniquely, because **it caps the reader-visible answer itself**.
 * The role's response ceiling exists to bound the answer a reader reads; on a
 * reasoning model it silently bounds thinking instead. Define's visible
 * output is <100 tokens whatever the provider is given, enforced twice below:
 * the stream stops once enough visible text has arrived, and
 * `clampToTokenBudget` trims what did. No other caller may raise this — see
 * the rule on `getProvider`'s override.
 *
 * The cost saving M30 C wanted is real and lives where cost actually is: the
 * grounding below is ~1.1k input tokens, against the ~30k the unscoped digest
 * rung was shipping.
 *
 * The price is latency — a reasoning model takes 100–140s to think its way to
 * a one-sentence definition, and the headroom is why. That is survivable only
 * because the dictionary is the *primary* path and answers in 1–4ms, and
 * because the card never blocks the page while it waits.
 */
const DEFINE_PROVIDER_MAX_TOKENS = 8_192;

/** llm/context.ts's own conservative estimate, reused for the outbound clamp.
 * Deliberately the same number rather than a stricter one — a clamp tighter
 * than the provider's own cap would cut off answers that obeyed it. */
const CHARS_PER_TOKEN = 3.5;

const DEFINE_INSTRUCTIONS =
  "You are defining a single term for a reader who met it in this book and " +
  "does not know it. Answer with the definition only: one or two sentences, " +
  "no preamble, no restating of the term, no quotation from the text, no " +
  "follow-up question. If the book gives the term a particular sense, define " +
  "that sense. If the term is ordinary English that this book merely uses, " +
  "define it plainly. If you genuinely cannot tell what it means, reply with " +
  "exactly: NO DEFINITION";

/** The model's own way of saying it doesn't know — routed to the same
 * designed empty state as a dictionary miss rather than rendered as a
 * definition (settled decision 2's spirit: the model proposes, code
 * disposes). */
const NO_DEFINITION_SENTINEL = "NO DEFINITION";

/**
 * Trims to whole sentences within the token budget rather than cutting
 * mid-word. A definition ending in "…of the" reads as a bug even when the
 * cap did its job; ending one sentence early reads as brevity.
 */
export function clampToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const window = trimmed.slice(0, maxChars);
  const lastSentenceEnd = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    // A terminator that lands exactly on the boundary has no trailing space.
    /[.!?]$/u.test(window) ? window.length - 1 : -1,
  );
  if (lastSentenceEnd > 0) return window.slice(0, lastSentenceEnd + 1).trim();

  // No sentence boundary at all — fall back to a word boundary, and say so
  // with an ellipsis rather than pretending the sentence ended.
  const lastSpace = window.lastIndexOf(" ");
  return `${(lastSpace > 0 ? window.slice(0, lastSpace) : window).trim()}…`;
}

/** WordNet returns senses; a reader wants a dictionary entry. Numbered only
 * when there is more than one, so the common single-sense case stays a plain
 * sentence. */
export function renderDictionarySenses(
  senses: { partOfSpeech: string; definition: string }[],
): string {
  if (senses.length === 1) {
    return `(${senses[0].partOfSpeech}) ${senses[0].definition}`;
  }
  return senses
    .map((s, i) => `${i + 1}. (${s.partOfSpeech}) ${s.definition}`)
    .join("\n");
}

/**
 * How much of each part of the grounding Define may spend, in characters.
 *
 * ⚠️ These exist because of what was found driving this live on a real book
 * (East of Eden, 2026-08-26). Define originally reused `buildDigestContext`
 * wholesale, and on that book it produced a **107,000-character** context —
 * of which 96,811 characters were the three whole surrounding *sections* the
 * digest rung ships for a thread. Against a 32k-token local model the
 * request simply came back empty, so the term the book actually coins
 * ("timshel") got the designed empty state instead of the answer M30 C's
 * acceptance criteria call for.
 *
 * The rung is still the digest rung — the book digest and the chapter
 * digests are exactly what decision 8's M17 amendment names. What changed is
 * the *passage* component: a thread asks "what does this passage mean", so it
 * wants the pages around the highlight; a definition asks "what does this
 * word mean here", so it wants **the places the word is actually used**.
 * That is both the cheaper context and the more relevant one, which is what
 * lets Define carry a <100-token cap without the call being wasteful.
 */
const CHAPTER_DIGEST_BUDGET_CHARS = 6_000;
const OCCURRENCE_BUDGET_CHARS = 6_000;
/** Characters either side of an occurrence — roughly a sentence and its
 * neighbours, which is what shows a word being *used* rather than merely
 * appearing. */
const OCCURRENCE_WINDOW_CHARS = 320;
const MAX_OCCURRENCES = 6;

/**
 * Every place the term is used in the book, as short quoted windows in
 * reading order, within a fixed character budget. Deliberately unaware of
 * the reader's position: a definition is not spoiler-gated the way a
 * thematic question is (routes/digest.ts:375) — the reader is holding the
 * word in front of them, so where else it appears is not a reveal.
 */
export function occurrenceWindows(
  sections: { spineIndex: number; text: string }[],
  term: string,
  chapterTitles: Record<string, string> | undefined,
): string[] {
  const windows: string[] = [];
  let spent = 0;
  for (const section of sections) {
    // Whole-word: defining "run" should not be grounded on "brunt".
    for (const match of findAllOccurrences(section.text, term, "word")) {
      if (windows.length >= MAX_OCCURRENCES || spent >= OCCURRENCE_BUDGET_CHARS) {
        return windows;
      }
      const start = Math.max(0, match.start - OCCURRENCE_WINDOW_CHARS);
      const end = Math.min(section.text.length, match.end + OCCURRENCE_WINDOW_CHARS);
      const quoted = section.text.slice(start, end).replace(/\s+/gu, " ").trim();
      windows.push(`--- [${sectionLabel(section.spineIndex, chapterTitles)}] ---\n…${quoted}…`);
      spent += quoted.length;
    }
  }
  return windows;
}

/**
 * The digest rung, scoped to what a definition needs. Not a fourth rung on
 * the ladder and not exported into `llm/context.ts`: the three rungs there
 * answer *questions about a passage*, and adding a fourth shape to that file
 * for the one caller that asks about a word would make every reader of it
 * check which kind it was looking at.
 */
function buildDefineContext(
  db: Database.Database,
  resource: Resource,
  highlight: Highlight,
  term: string,
): string {
  const chapterTitles = resource.metadata.chapterTitles;
  const header = resource.author ? `${resource.title} by ${resource.author}` : resource.title;

  const digest = getBookDigest(db, resource.id);
  const bookPart = digest
    ? `Synopsis: ${digest.synopsis}\n\n` +
      `Cast: ${digest.cast.map((c) => `${c.name} (${c.description})`).join("; ") || "none listed"}\n\n` +
      `Book-level themes: ${digest.themes.join(", ") || "none listed"}`
    : "No book-level digest available yet.";

  // The term's own chapter first, then outward — a budget that ran out
  // should spend what it had on the chapter the reader is in.
  const chapters = [...listChapterDigests(db, resource.id)].sort(
    (a, b) =>
      Math.abs(a.spineIndex - highlight.spineIndex) -
      Math.abs(b.spineIndex - highlight.spineIndex),
  );
  const kept: typeof chapters = [];
  let chapterSpend = 0;
  for (const chapter of chapters) {
    if (chapterSpend + chapter.summary.length > CHAPTER_DIGEST_BUDGET_CHARS) break;
    kept.push(chapter);
    chapterSpend += chapter.summary.length;
  }
  const chapterText = kept
    .sort((a, b) => a.spineIndex - b.spineIndex)
    .map((c) => `--- [${sectionLabel(c.spineIndex, chapterTitles)} digest] ---\n${c.summary}`)
    .join("\n\n");

  const sections = getResourceTextSections(db, resource.id);
  const windows = occurrenceWindows(sections, term, chapterTitles);

  return (
    `${header}\n\n` +
    `BOOK DIGEST\n${bookPart}\n\n` +
    `CHAPTER SUMMARIES\n${chapterText || "(no chapters digested yet)"}\n\n` +
    `WHERE THIS BOOK USES "${term}"\n` +
    (windows.length > 0
      ? windows.join("\n\n")
      : `(the term does not appear elsewhere in the text; the reader selected it at ` +
        `${sectionLabel(highlight.spineIndex, chapterTitles)})`)
  );
}

const NOT_A_TERM: Definition = {
  headword: "",
  definition: "",
  source: "",
  attribution: "",
  reason: "not_a_term",
};

/**
 * Resolves one Define from the dictionary alone. Never throws: every
 * failure — an unusable selection, a dictionary miss — comes back as a
 * `Definition` with `source: ""` and a `reason` the UI can render.
 *
 * M30 E feedback: this used to fall through to the digest rung
 * automatically on a miss. It no longer does — `reason: "dictionary_miss"`
 * tells the reader there's a deeper search available (`deepenDefinition`
 * below) and lets *them* decide whether a 100+-second call is worth it,
 * rather than the miss deciding for them. `no_provider` is unchanged: with
 * nothing configured there is nothing to offer deepening with.
 */
export async function defineHighlight(
  db: Database.Database,
  resource: Resource,
  highlight: Highlight,
): Promise<Definition> {
  const term = normalizeDefineTerm(highlight.exact);
  if (!isDefinableTerm(highlight.exact)) return NOT_A_TERM;

  // --- Path 1: the bundled dictionary. Offline, instant, free.
  const dictionary = getDictionary();
  if (dictionary) {
    const entry = await dictionary.lookup(term);
    if (entry) {
      return {
        headword: entry.headword,
        definition: renderDictionarySenses(entry.senses),
        source: "dictionary",
        attribution: dictionary.attribution,
        reason: "",
      };
    }
  }

  // A dictionary miss with no query provider configured has nothing to
  // deepen with — same designed empty state as before M30 E.
  const provider = getProvider(db, "query", "define", resource.id, undefined, DEFINE_PROVIDER_MAX_TOKENS);
  if (!provider) {
    return { headword: term, definition: "", source: "", attribution: "", reason: "no_provider" };
  }
  return { headword: term, definition: "", source: "", attribution: "", reason: "dictionary_miss" };
}

/** `deepenDefinition`'s narration, alongside the real work it names. Never a
 * fabricated chain-of-thought (settled decision 2's spirit: the model
 * proposes, code disposes) — every line here corresponds to a real,
 * deterministic step this function actually takes, in the order it takes
 * them, before the model is asked anything at all. */
function stepEvent(step: string): DefineStreamEvent {
  return { step };
}

/**
 * The digest-rung fallback (M30 C's "Path 2"), run only when the reader
 * explicitly asks for it (M30 E feedback — see `defineHighlight`'s
 * comment). An async generator rather than a plain promise so the route can
 * forward each stage to the reader as it happens: which occurrences of the
 * term it found, then the model composing the answer live, matching what
 * `deepenDefinition`'s narration promises rather than a bare spinner.
 *
 * Still never throws to the caller — the last event this yields is always
 * either `{done, definition}` (a real answer or `reason: "not_found"`, the
 * same designed-failure states `defineHighlight` always had) or `{error}`
 * for a genuinely unexpected failure the route couldn't have prevented.
 */
export async function* deepenDefinition(
  db: Database.Database,
  resource: Resource,
  highlight: Highlight,
  role: ProviderRole,
): AsyncGenerator<DefineStreamEvent> {
  const term = normalizeDefineTerm(highlight.exact);

  const provider = getProvider(db, role, "define", resource.id, undefined, DEFINE_PROVIDER_MAX_TOKENS);
  if (!provider) {
    yield {
      done: true,
      definition: { headword: term, definition: "", source: "", attribution: "", reason: "no_provider" },
    };
    return;
  }
  // Cosmetic only (the narration names who's answering) — a role with a
  // profile assigned but the profile since deleted is the one gap
  // `getProvider` above already tolerates by resolving null, which this
  // can't hit once `provider` is non-null.
  const profileLabel = getRoleProfileRaw(db, role)?.name ?? "the model";

  try {
    yield stepEvent(`Searching "${resource.title}" for "${term}"…`);
    const sections = getResourceTextSections(db, resource.id);
    const windows = occurrenceWindows(sections, term, resource.metadata.chapterTitles);
    yield stepEvent(
      windows.length > 0
        ? `Reading context around ${windows.length} occurrence${windows.length === 1 ? "" : "s"}…`
        : `No other occurrences found — reading the book's digest instead…`,
    );
    const bookContext = buildDefineContext(db, resource, highlight, term);

    yield stepEvent(`Asking ${profileLabel} for a definition…`);
    let answer = "";
    for await (const chunk of provider.stream({
      instructions: DEFINE_INSTRUCTIONS,
      bookContext,
      messages: [{ role: "user", content: `Define this term as it is used here: "${term}"` }],
    })) {
      answer += chunk.text;
      if (chunk.text) yield { text: chunk.text };
      // The cap that actually holds, and the only one measured in *visible*
      // text. The slack lets clampToTokenBudget below find a real sentence
      // boundary to cut at rather than always ending mid-thought.
      if (answer.length > DEFINE_MAX_OUTPUT_TOKENS * CHARS_PER_TOKEN * 1.5) break;
    }

    const cleaned = clampToTokenBudget(answer, DEFINE_MAX_OUTPUT_TOKENS);
    if (!cleaned || cleaned.toUpperCase().startsWith(NO_DEFINITION_SENTINEL)) {
      yield {
        done: true,
        definition: { headword: term, definition: "", source: "", attribution: "", reason: "not_found" },
      };
      return;
    }
    yield {
      done: true,
      definition: { headword: term, definition: cleaned, source: "digest", attribution: resource.title, reason: "" },
    };
  } catch (err) {
    // A provider failure is a miss, not a crash — the reader gets the same
    // designed empty state a dictionary miss shows. The real error is
    // logged rather than shown (same reasoning as threads.ts's
    // ERROR_MESSAGES).
    console.error(
      "[define] digest-rung lookup failed:",
      err instanceof LLMError ? `${err.code}: ${err.message}` : err,
    );
    yield {
      done: true,
      definition: { headword: term, definition: "", source: "", attribution: "", reason: "not_found" },
    };
  }
}
