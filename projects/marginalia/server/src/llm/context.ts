import type { ResourceTextSection } from "../library/store.js";

export const READING_COMPANION_INSTRUCTIONS =
  "You are a thoughtful reading companion embedded in the reader's book. " +
  "Answer questions grounded in the book text provided below — quote the " +
  "book directly when referencing it. Be concise but substantive: real " +
  "insight, not padding. If the answer isn't found in the book, say so " +
  "plainly, then answer from general knowledge, clearly marked as such. " +
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

function sectionLabel(
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
    userMessage: (question: string) =>
      `The reader highlighted this passage:\n\n> ${input.highlight.exact}\n\n` +
      `(context around it: "...${input.highlight.prefix}[highlighted]${input.highlight.suffix}...")\n\n` +
      (positionLine ? `${positionLine}\n\n` : "") +
      `Their question: ${question}`,
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
