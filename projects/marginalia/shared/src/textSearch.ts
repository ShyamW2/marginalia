/**
 * The search matching rule (TASKS.md M24.1 C, third item).
 *
 * Shared because it has to be the same rule in three places or the result
 * set stops being one result set: the server produces hits with it
 * (annotations/search.ts), the reader re-finds those hits in the live
 * rendered DOM with it (web/src/search/hitLocation.ts), and the count the
 * find bar shows is the count both agree on.
 *
 * ## Why whole-word is the default
 *
 * The rule used to be a raw substring scan, which is why searching "the"
 * blanketed a paragraph: it matches *other*, *there*, *father* — dozens of
 * three-character marks per paragraph, abutting into a slab. Whole-word is
 * what a reader means by "find this word"; substring stays available as an
 * explicit choice (finding a stem, or a fragment you half-remember), and
 * whichever is on is said in the UI rather than inferred from the results.
 */

import type { SearchMatchMode } from "./schemas.js";
import type { TextMatch } from "./anchorText.js";

export type { SearchMatchMode };

/**
 * What counts as part of a word for the boundary test: letters, digits and
 * the underscore, in any script (`\p{L}` rather than `[a-z]`, so "Gregor's"
 * and "Kafka" behave the same way as "façade" and "東京").
 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR.test(char);
}

/**
 * Whether an occurrence at [start, end) stands as a whole word.
 *
 * The boundary is only demanded on a side where the *query itself* ends in a
 * word character. Searching for `"don't"` or `"—"` or `"§4"` should not be
 * made impossible by the punctuation the reader typed: a query edge that
 * isn't a word character has no word boundary to respect.
 */
function isWholeWord(text: string, query: string, start: number, end: number): boolean {
  if (isWordChar(query[0]) && isWordChar(text[start - 1])) return false;
  if (isWordChar(query[query.length - 1]) && isWordChar(text[end])) return false;
  return true;
}

/**
 * Every non-overlapping, case-insensitive occurrence of `query` in `text`
 * under `mode`, in document order.
 *
 * Case-insensitivity is `toLowerCase` on both sides rather than a regex: the
 * offsets returned must index the *original* string, and a locale-aware case
 * fold that changes length would break that. (Both sides are folded the same
 * way, so the lengths stay aligned for every script this reader has met.)
 */
export function findAllOccurrences(
  text: string,
  query: string,
  mode: SearchMatchMode,
): TextMatch[] {
  if (query.length === 0) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const matches: TextMatch[] = [];
  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) break;
    const end = start + query.length;
    if (mode === "substring" || isWholeWord(haystack, needle, start, end)) {
      matches.push({ start, end });
    }
    // Advance past this occurrence either way — a rejected one is not a
    // starting point for a second, overlapping attempt.
    from = end;
  }
  return matches;
}

/** Whether `query` appears in `text` at all under `mode` — the same rule the
 * occurrence scan applies, for the places that only need a yes/no (a note's
 * body, a thread message). */
export function containsMatch(text: string, query: string, mode: SearchMatchMode): boolean {
  return findAllOccurrences(text, query, mode).length > 0;
}
