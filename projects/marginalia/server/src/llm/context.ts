import type { ResourceTextSection } from "../library/store.js";

// M19.5 "let thematic questions be thematic" (decisions.md 2026-07-29
// later): the old instructions treated anything outside the book as a
// fallback to be "clearly marked", which made every applied or thematic
// question come back hedged. Factual/plot questions still stay tightly
// grounded — only the interpretive/applied kind get license to reason past
// the page. Both rules are stated explicitly and separately: fixing one by
// blending it into the other silently breaks the acceptance test for the
// one not being fixed.
export const READING_COMPANION_INSTRUCTIONS =
  "You are a thoughtful reading companion embedded in the reader's book. " +
  "Answer questions grounded in the book text provided below — quote the " +
  "book directly when referencing it. Be concise but substantive: real " +
  "insight, not padding.\n\n" +
  "Two kinds of questions call for different postures. A factual question " +
  "about the plot, characters, or events stays tightly grounded: if the " +
  "answer isn't found in the book, say so plainly, then answer from " +
  "general knowledge, clearly marked as such. A thematic, interpretive, or " +
  "applied question (\"what does this say about X\", \"how does this apply " +
  "to my life\") calls for grounded extrapolation instead: reason outward " +
  "from the book's ideas with the same confidence you'd bring to a real " +
  "conversation about it — anchor the connection in the text, but don't " +
  "hedge or apologize for reasoning past the page.\n\n" +
  "The reader may not have finished the book yet. When their current " +
  "reading position is given with a question, do not reveal or hint at " +
  "plot developments beyond that position — even if the answer is in the " +
  "text provided — unless they explicitly ask for spoilers or ask about " +
  "the book as a whole.";

// chars/token is a conservative estimate (SPEC); no tokenizer round-trip.
const CHARS_PER_TOKEN = 3.5;
// Use the whole book unless it would eat more than 70% of the provider's
// context budget — leaves room for instructions, history, and the answer.
const WHOLE_BOOK_BUDGET_FRACTION = 0.7;

function estimateTokens(chars: number): number {
  return chars / CHARS_PER_TOKEN;
}

export interface ContextHighlight {
  exact: string;
  prefix: string;
  suffix: string;
  spineIndex: number;
}

export interface ContextReadingPosition {
  spineIndex: number | null;
  percent: number | null;
}

export interface ContextBuildInput {
  title: string;
  author: string | null;
  sections: ResourceTextSection[];
  highlight: ContextHighlight;
  contextTokens: number;
  /** M17: spineIndex (stringified) -> chapter title, from the EPUB's own
   * NCX (`resource.metadata.chapterTitles`, populated at import by M15's
   * `extractChapterTitles`). A section with no entry falls back to its
   * plain number — most books have front/back matter the NCX doesn't name. */
  chapterTitles?: Record<string, string>;
  /** M17 "don't spoil": the reader's current furthest position, client-
   * resolved (see migrations.ts v7). Rides in the per-question user
   * message, never the cached bookContext/instructions blocks, since it
   * changes on every question — putting it ahead of the cache breakpoint
   * would invalidate the cache it's meant to coexist with. Absent/null
   * means "no known position", so the answer goes unrestricted. */
  readingPosition?: ContextReadingPosition | null;
}

export interface BuiltContext {
  instructions: string;
  bookContext: string;
  userMessage: (question: string) => string;
  /** M17 "surface silent windowing": true when `selectWindow` dropped
   * distant sections to fit the budget — the book was too long to send
   * whole. Callers use this to attach a `contextNote` to the answer. */
  windowed: boolean;
}

/** Human-readable note attached to an answer that was grounded in a window
 * of the book rather than the whole text (decisions.md 2026-07-28 later:
 * "surface it" — quietly, once, not as an error). */
export const WINDOWED_CONTEXT_NOTE =
  "This book is long enough that the full text doesn't fit in one request — " +
  "this answer is grounded in the chapters around your highlight, not the " +
  "whole book.";

/** Exported for the digest builder (digest/build.ts) — chapter labeling
 * should read identically whether it's grounding a thread answer or a
 * digest map call. */
export function sectionLabel(
  spineIndex: number,
  chapterTitles: Record<string, string> | undefined,
): string {
  const title = chapterTitles?.[String(spineIndex)];
  return title ? `section ${spineIndex}: ${title}` : `section ${spineIndex}`;
}

function renderBookContext(
  title: string,
  author: string | null,
  sections: ResourceTextSection[],
  chapterTitles: Record<string, string> | undefined,
): string {
  const header = author ? `${title} by ${author}` : title;
  const body = sections
    .map((s) => `--- [${sectionLabel(s.spineIndex, chapterTitles)}] ---\n${s.text}`)
    .join("\n\n");
  return `${header}\n\n${body}`;
}

/**
 * Picks the window of spine sections to send: the highlight's own section,
 * expanding alternately left/right (falling back to whichever side still has
 * sections once the other is exhausted) until the token budget is spent.
 * Deterministic for a given book + budget — required for cache stability.
 */
function selectWindow(
  sections: ResourceTextSection[],
  centerSpineIndex: number,
  budgetTokens: number,
): ResourceTextSection[] {
  const sorted = [...sections].sort((a, b) => a.spineIndex - b.spineIndex);
  if (sorted.length === 0) return sorted;

  const centerIdx = sorted.findIndex((s) => s.spineIndex === centerSpineIndex);
  const start = centerIdx === -1 ? 0 : centerIdx;

  const selectedIndices = new Set<number>([start]);
  let usedTokens = estimateTokens(sorted[start].text.length);

  let left = start - 1;
  let right = start + 1;
  let preferLeft = true;

  while (usedTokens < budgetTokens && (left >= 0 || right < sorted.length)) {
    let pick: number | undefined;
    if (preferLeft && left >= 0) {
      pick = left--;
    } else if (!preferLeft && right < sorted.length) {
      pick = right++;
    } else if (left >= 0) {
      pick = left--;
    } else if (right < sorted.length) {
      pick = right++;
    }
    if (pick === undefined) break;
    selectedIndices.add(pick);
    usedTokens += estimateTokens(sorted[pick].text.length);
    preferLeft = !preferLeft;
  }

  return sorted.filter((_, idx) => selectedIndices.has(idx));
}

function standardUserMessage(
  highlight: ContextHighlight,
  positionLine: string | null,
  question: string,
): string {
  return (
    `The reader highlighted this passage:\n\n> ${highlight.exact}\n\n` +
    `(context around it: "...${highlight.prefix}[highlighted]${highlight.suffix}...")\n\n` +
    (positionLine ? `${positionLine}\n\n` : "") +
    `Their question: ${question}`
  );
}

/** Builds the (deterministic, cacheable) book context + user message for a question. */
export function buildContext(input: ContextBuildInput): BuiltContext {
  const sorted = [...input.sections].sort((a, b) => a.spineIndex - b.spineIndex);
  const totalTokens = estimateTokens(
    sorted.reduce((sum, s) => sum + s.text.length, 0),
  );
  const budget = input.contextTokens * WHOLE_BOOK_BUDGET_FRACTION;

  const windowed = totalTokens > budget;
  const sections = windowed
    ? selectWindow(sorted, input.highlight.spineIndex, budget)
    : sorted;

  const bookContext = renderBookContext(
    input.title,
    input.author,
    sections,
    input.chapterTitles,
  );

  const positionLine = renderPositionLine(input.readingPosition, input.chapterTitles);

  return {
    instructions: READING_COMPANION_INSTRUCTIONS,
    bookContext,
    userMessage: (question: string) => standardUserMessage(input.highlight, positionLine, question),
    windowed,
  };
}

/** Renders the volatile "where the reader currently is" line for the user
 * message — never the cached blocks, see ContextBuildInput.readingPosition. */
function renderPositionLine(
  position: ContextReadingPosition | null | undefined,
  chapterTitles: Record<string, string> | undefined,
): string | null {
  if (!position || (position.percent === null && position.spineIndex === null)) {
    return null;
  }
  const parts: string[] = [];
  if (position.percent !== null) parts.push(`${Math.round(position.percent)}% through the book`);
  if (position.spineIndex !== null) {
    parts.push(`around ${sectionLabel(position.spineIndex, chapterTitles)}`);
  }
  return `Reader's current position: ${parts.join(", ")}.`;
}

// ---------------------------------------------------------------------------
// M17 "the context ladder" (decisions.md 2026-07-28 later): Off (passage +
// surrounding pages), Digest (digest of covering chapters + surrounding
// pages), Full (buildContext above, today's behavior — the default until a
// book has a digest).
// ---------------------------------------------------------------------------

// How many spine sections on each side of the highlight's own section count
// as "surrounding pages" for the Off/Digest rungs. Deliberately small — the
// whole point of these rungs is to cost a fraction of Full.
const SURROUNDING_PAGES_RADIUS = 1;

function surroundingSections(
  sections: ResourceTextSection[],
  centerSpineIndex: number,
): ResourceTextSection[] {
  const sorted = [...sections].sort((a, b) => a.spineIndex - b.spineIndex);
  const centerIdx = sorted.findIndex((s) => s.spineIndex === centerSpineIndex);
  if (centerIdx === -1) return sorted.length > 0 ? [sorted[0]] : [];
  const start = Math.max(0, centerIdx - SURROUNDING_PAGES_RADIUS);
  const end = Math.min(sorted.length - 1, centerIdx + SURROUNDING_PAGES_RADIUS);
  return sorted.slice(start, end + 1);
}

export interface LadderContextInput {
  title: string;
  author: string | null;
  sections: ResourceTextSection[];
  highlight: ContextHighlight;
  chapterTitles?: Record<string, string>;
  readingPosition?: ContextReadingPosition | null;
}

export interface BuiltLadderContext extends BuiltContext {
  /** Spine indices of chapter digests actually included (Digest rung only —
   * always [] for Off). Used for the "answer transparency" record. */
  chaptersUsed: number[];
  /** False when the highlight's own chapter has no digest row — decisions.md:
   * "the UI says so rather than silently answering from less." */
  highlightChapterCovered: boolean;
}

/** Off rung: cheapest — just the passage's own section and its immediate
 * neighbors, no digest, no whole book. */
export function buildOffContext(input: LadderContextInput): BuiltLadderContext {
  const pages = surroundingSections(input.sections, input.highlight.spineIndex);
  const bookContext = renderBookContext(input.title, input.author, pages, input.chapterTitles);
  const positionLine = renderPositionLine(input.readingPosition, input.chapterTitles);
  return {
    instructions: READING_COMPANION_INSTRUCTIONS,
    bookContext,
    userMessage: (question) => standardUserMessage(input.highlight, positionLine, question),
    windowed: false,
    chaptersUsed: [],
    highlightChapterCovered: false,
  };
}

export interface DigestBookSummary {
  synopsis: string;
  cast: { name: string; description: string }[];
  themes: string[];
}

export interface DigestChapterSummary {
  spineIndex: number;
  summary: string;
  themes: string[];
  characters: string[];
}

export interface DigestThematicSummary {
  spineIndex: number;
  analysis: string;
  themes: string[];
}

export interface DigestContextInput extends LadderContextInput {
  bookDigest: DigestBookSummary | null;
  chapterDigests: DigestChapterSummary[];
  /** M19.5 "the thematic layer ships as context when the question calls
   * for it" (decisions.md 2026-07-29 later): rather than classifying the
   * question first (fragile, and against decision 11's "code disposes"
   * spirit), the thematic analysis simply rides alongside the plot digest
   * whenever it exists — READING_COMPANION_INSTRUCTIONS already tells the
   * model which kind of question calls for which posture, so a factual
   * question ignores it and a thematic one draws on it. Callers pass only
   * chapters whose analysis matches the resource's *current* brief — a
   * stale one (from a brief the reader has since changed) never silently
   * grounds a live answer. */
  thematicChapters?: DigestThematicSummary[];
}

/** Digest rung: the book-level digest (synopsis/cast/themes) plus every
 * chapter's compact summary — never full text for chapters outside the
 * highlight's neighborhood — plus full text of the pages right around the
 * highlight. This is the token saving: a summary of the whole book instead
 * of the whole book. Only chapters that actually have a digest row
 * contribute (decisions.md 2026-07-28 later). */
export function buildDigestContext(input: DigestContextInput): BuiltLadderContext {
  const header = input.author ? `${input.title} by ${input.author}` : input.title;

  const bookPart = input.bookDigest
    ? `Synopsis: ${input.bookDigest.synopsis}\n\n` +
      `Cast: ${input.bookDigest.cast.map((c) => `${c.name} (${c.description})`).join("; ") || "none listed"}\n\n` +
      `Book-level themes: ${input.bookDigest.themes.join(", ") || "none listed"}`
    : "No book-level digest available yet.";

  const sortedDigests = [...input.chapterDigests].sort((a, b) => a.spineIndex - b.spineIndex);
  const chapterDigestText = sortedDigests
    .map((c) => {
      const meta: string[] = [];
      if (c.themes.length > 0) meta.push(`Themes: ${c.themes.join(", ")}`);
      if (c.characters.length > 0) meta.push(`Characters: ${c.characters.join(", ")}`);
      return (
        `--- [${sectionLabel(c.spineIndex, input.chapterTitles)} digest] ---\n${c.summary}` +
        (meta.length > 0 ? `\n${meta.join(" · ")}` : "")
      );
    })
    .join("\n\n");

  const pages = surroundingSections(input.sections, input.highlight.spineIndex);
  const pagesText = pages
    .map((s) => `--- [${sectionLabel(s.spineIndex, input.chapterTitles)} — full text] ---\n${s.text}`)
    .join("\n\n");

  const sortedThematic = [...(input.thematicChapters ?? [])].sort((a, b) => a.spineIndex - b.spineIndex);
  const thematicText = sortedThematic
    .map((t) => {
      const themesLine = t.themes.length > 0 ? `\nThemes: ${t.themes.join(", ")}` : "";
      return `--- [${sectionLabel(t.spineIndex, input.chapterTitles)} thematic reading] ---\n${t.analysis}${themesLine}`;
    })
    .join("\n\n");

  const bookContext =
    `${header}\n\n` +
    `BOOK DIGEST\n${bookPart}\n\n` +
    `CHAPTER SUMMARIES\n${chapterDigestText || "(no chapters digested yet)"}\n\n` +
    (thematicText ? `THEMATIC READING (the reader's own angle on these chapters)\n${thematicText}\n\n` : "") +
    `FULL TEXT AROUND THE HIGHLIGHT\n${pagesText}`;

  const positionLine = renderPositionLine(input.readingPosition, input.chapterTitles);
  const highlightChapterCovered = sortedDigests.some(
    (c) => c.spineIndex === input.highlight.spineIndex,
  );

  return {
    instructions: READING_COMPANION_INSTRUCTIONS,
    bookContext,
    userMessage: (question) => standardUserMessage(input.highlight, positionLine, question),
    windowed: false,
    chaptersUsed: sortedDigests.map((c) => c.spineIndex),
    highlightChapterCovered,
  };
}
