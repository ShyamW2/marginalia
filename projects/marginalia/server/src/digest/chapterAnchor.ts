const ANCHOR_CONTEXT_CHARS = 64;
const FALLBACK_ANCHOR_CHARS = 120;

export interface QuoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  /** Char offset (and length) of `exact` within `sectionText` — M35 §A1/§A4:
   * this is already computed to find the anchor, so it's returned rather
   * than thrown away. Local to the section's own text, matching what
   * `sectionOffsets.ts`'s `LocatedAnchor.offset` means for the same column. */
  offset: number;
  length: number;
}

/**
 * Locates a model-provided quote inside its chapter's raw text and returns
 * the prefix/exact/suffix triple `createHighlight` expects — decision 11
 * ("the model never returns positions... it returns text and code locates
 * it") applied to posed questions: the model gives a verbatim quote, this
 * is the code that turns it into a real anchor.
 *
 * Three tiers, each tried only if the one before it misses:
 *  1. Exact substring (the instructed, expected case).
 *  2. Typographic fold — curly quotes/dashes collapsed to their straight
 *     equivalents (M35 §B1b: a model that transcribes faithfully but tidies
 *     punctuation isn't paraphrasing, and neither of the other tiers folds
 *     this). Every fold below is one character to one character, so an
 *     index found in the folded text is the *same* index in `sectionText` —
 *     no offset bookkeeping needed, which is what keeps this tier
 *     offset-safe.
 *  3. Whitespace-and-quote-tolerant — word-by-word match, on the folded
 *     text, with a separator class wide enough to absorb a collapsed line
 *     break or a dropped internal quotation mark in dialogue.
 *
 * Returns null if the quote genuinely isn't in the text — the caller falls
 * back to anchoring at the chapter's start rather than dropping the
 * question.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Every replacement is exactly one character, so folding never shifts an
// index — the property §B1b's offset-safety depends on.
const TYPOGRAPHIC_FOLDS: [RegExp, string][] = [
  [/[‘’‚‛]/g, "'"], // ‘ ’ ‚ ‛ -> '
  [/[“”„‟]/g, '"'], // “ ” „ ‟ -> "
  [/[–—]/g, "-"], // – — -> -
];

function foldTypography(text: string): string {
  let folded = text;
  for (const [pattern, replacement] of TYPOGRAPHIC_FOLDS) {
    folded = folded.replace(pattern, replacement);
  }
  return folded;
}

export function locateQuoteAnchor(sectionText: string, quote: string): QuoteAnchor | null {
  const trimmed = quote.trim();
  if (trimmed.length === 0) return null;

  function found(index: number, matchLength: number): QuoteAnchor {
    return {
      exact: sectionText.slice(index, index + matchLength),
      prefix: sectionText.slice(Math.max(0, index - ANCHOR_CONTEXT_CHARS), index),
      suffix: sectionText.slice(index + matchLength, index + matchLength + ANCHOR_CONTEXT_CHARS),
      offset: index,
      length: matchLength,
    };
  }

  // Tier 1: exact substring.
  let index = sectionText.indexOf(trimmed);
  if (index !== -1) return found(index, trimmed.length);

  // Tier 2: same-length typographic fold.
  const foldedSectionText = foldTypography(sectionText);
  const foldedTrimmed = foldTypography(trimmed);
  index = foldedSectionText.indexOf(foldedTrimmed);
  if (index !== -1) return found(index, foldedTrimmed.length);

  // Tier 3: whitespace-and-quote-tolerant, on the folded text.
  const words = foldedTrimmed.split(/[\s"']+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = words.map(escapeRegExp).join('[\\s"\']+');
  const match = new RegExp(pattern).exec(foldedSectionText);
  if (!match) return null;
  return found(match.index, match[0].length);
}

/** Chapter-start fallback when the quote can't be located verbatim — still
 * a real, findable anchor (the chapter's own opening text), never dropped. */
export function chapterStartAnchor(sectionText: string): QuoteAnchor {
  const exact = sectionText.slice(0, FALLBACK_ANCHOR_CHARS);
  return {
    exact,
    prefix: "",
    suffix: sectionText.slice(exact.length, exact.length + ANCHOR_CONTEXT_CHARS),
    offset: 0,
    length: exact.length,
  };
}
