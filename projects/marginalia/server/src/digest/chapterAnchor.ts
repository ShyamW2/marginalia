const ANCHOR_CONTEXT_CHARS = 64;
const FALLBACK_ANCHOR_CHARS = 120;

export interface QuoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
}

/**
 * Locates a model-provided quote inside its chapter's raw text and returns
 * the prefix/exact/suffix triple `createHighlight` expects — decision 11
 * ("the model never returns positions... it returns text and code locates
 * it") applied to posed questions: the model gives a verbatim quote, this
 * is the code that turns it into a real anchor.
 *
 * Tries an exact substring match first (the instructed, expected case),
 * then a whitespace-normalized match (the model collapsed a line break or
 * similar). Returns null if the quote genuinely isn't in the text — the
 * caller falls back to anchoring at the chapter's start rather than
 * dropping the question.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function locateQuoteAnchor(sectionText: string, quote: string): QuoteAnchor | null {
  const trimmed = quote.trim();
  if (trimmed.length === 0) return null;

  let index = sectionText.indexOf(trimmed);
  let matchLength = trimmed.length;

  if (index === -1) {
    // Whitespace-normalized fallback (the model collapsed a line break or
    // similar): match word-by-word with `\s+` between them, directly
    // against the original text — no manual index bookkeeping needed.
    const pattern = trimmed.split(/\s+/).map(escapeRegExp).join("\\s+");
    const match = new RegExp(pattern).exec(sectionText);
    if (!match) return null;
    index = match.index;
    matchLength = match[0].length;
  }

  return {
    exact: sectionText.slice(index, index + matchLength),
    prefix: sectionText.slice(Math.max(0, index - ANCHOR_CONTEXT_CHARS), index),
    suffix: sectionText.slice(index + matchLength, index + matchLength + ANCHOR_CONTEXT_CHARS),
  };
}

/** Chapter-start fallback when the quote can't be located verbatim — still
 * a real, findable anchor (the chapter's own opening text), never dropped. */
export function chapterStartAnchor(sectionText: string): QuoteAnchor {
  const exact = sectionText.slice(0, FALLBACK_ANCHOR_CHARS);
  return {
    exact,
    prefix: "",
    suffix: sectionText.slice(exact.length, exact.length + ANCHOR_CONTEXT_CHARS),
  };
}
