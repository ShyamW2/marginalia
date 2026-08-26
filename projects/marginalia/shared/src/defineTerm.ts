/**
 * M30 C: the one rule that decides whether a selection is a *term* — short
 * enough that "define this" is a fully determined question (CLAUDE.md's
 * product discipline, as bounded for the Define button).
 *
 * ⚠️ Decided once, here, and shared by both sides on purpose. The reader UI
 * uses it to enable/disable the pill's Define button; the server uses it to
 * reject a Define request outright. If the two disagreed, the button would
 * offer a lookup the server refuses — so there is one rule and one file.
 *
 * The threshold is a product constraint, not a technical one: **Define on a
 * paragraph produces a bad answer rather than an error**, which is the worse
 * failure of the two. A dictionary headword is one word; the longest things
 * that still behave like headwords are lexicalised phrases — WordNet's own
 * collocations ("point of view", "stream of consciousness") top out around
 * four words. Past that a selection is prose, and the honest response is to
 * not offer the button at all.
 */

/** Lexicalised phrases exist ("point of view"); sentences do not qualify. */
export const DEFINE_MAX_WORDS = 4;
/** Backstop for the pathological single "word" — a URL, a hash, a run-on
 * with no spaces — that would pass the word count but is plainly not a term.
 * WordNet's longest single-word lemma is 29 characters. */
export const DEFINE_MAX_CHARS = 48;

/**
 * The canonical form of a selected term: whitespace collapsed, and the
 * punctuation a reader inevitably drags in from the page (a trailing comma,
 * a full stop, the closing half of a quotation) trimmed off the ends.
 * Interior punctuation is kept — hyphens and apostrophes are part of real
 * headwords ("self-evident", "o'clock").
 */
export function normalizeDefineTerm(selection: string): string {
  return selection
    .replace(/\s+/gu, " ")
    .trim()
    // Unicode-aware: strips ""'',.;:!?()[]{}"«»— and friends from both ends
    // without touching a hyphen or apostrophe *inside* the word.
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");
}

/**
 * True when a selection is short enough to be a term. Callers should pass
 * the raw selection — normalization happens here so both sides agree on the
 * *same* string being measured.
 */
export function isDefinableTerm(selection: string): boolean {
  const term = normalizeDefineTerm(selection);
  if (term.length === 0) return false;
  if (term.length > DEFINE_MAX_CHARS) return false;
  return term.split(" ").length <= DEFINE_MAX_WORDS;
}
