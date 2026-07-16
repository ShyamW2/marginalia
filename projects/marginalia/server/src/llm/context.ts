import type { ResourceTextSection } from "../library/store.js";

export const READING_COMPANION_INSTRUCTIONS =
  "You are a thoughtful reading companion embedded in the reader's book. " +
  "Answer questions grounded in the book text provided below — quote the " +
  "book directly when referencing it. Be concise but substantive: real " +
  "insight, not padding. If the answer isn't found in the book, say so " +
  "plainly, then answer from general knowledge, clearly marked as such.";

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

export interface ContextBuildInput {
  title: string;
  author: string | null;
  sections: ResourceTextSection[];
  highlight: ContextHighlight;
  contextTokens: number;
}

export interface BuiltContext {
  instructions: string;
  bookContext: string;
  userMessage: (question: string) => string;
}

function renderBookContext(
  title: string,
  author: string | null,
  sections: ResourceTextSection[],
): string {
  const header = author ? `${title} by ${author}` : title;
  const body = sections
    .map((s) => `--- [section ${s.spineIndex}] ---\n${s.text}`)
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

  const sections =
    totalTokens <= budget
      ? sorted
      : selectWindow(sorted, input.highlight.spineIndex, budget);

  const bookContext = renderBookContext(input.title, input.author, sections);

  return {
    instructions: READING_COMPANION_INSTRUCTIONS,
    bookContext,
    userMessage: (question: string) =>
      `The reader highlighted this passage:\n\n> ${input.highlight.exact}\n\n` +
      `(context around it: "...${input.highlight.prefix}[highlighted]${input.highlight.suffix}...")\n\n` +
      `Their question: ${question}`,
  };
}
