import { findAllOccurrences, type SearchHit, type SearchMatchMode, type TextMatch } from "@marginalia/shared";

/**
 * Where each of a section's text hits actually is, in the *live* rendered
 * DOM's own text (TASKS.md M24.1 C, "a hit is painted where it actually is").
 *
 * ## The bug this exists to kill
 *
 * A hit used to be re-found with `findAnchorInText(sectionText, hit.anchor)`,
 * which is the highlight fallback: prefix+exact+suffix, then **exact alone**
 * — `text.indexOf(exact)`, the *first* occurrence in the section. That is
 * right for a highlight (there is one of it, and the forgiving fallback is
 * the whole point) and wrong for a search hit, because a search hit's `exact`
 * is the query and the query is exactly the string that occurs many times.
 * The moment prefix+exact+suffix failed to match byte-for-byte — which live
 * DOM text against server-extracted `resource_text` regularly won't —
 * *every* hit in the section collapsed onto occurrence #1. Dedupe by CFI then
 * reduced them to a single mark, and stepping to hits 2, 7, 8, 9 landed on
 * the same spot.
 *
 * ## What it does instead
 *
 * The server produced one hit per occurrence, in order, under a known
 * matching rule. So the reader scans the live text for occurrences under
 * *the same rule* and pairs them up in order — the hit's identity is its
 * **position in the sequence**, not its content, which is the one thing that
 * cannot be ambiguous when every occurrence has identical content.
 *
 * When the two counts agree, that pairing is the answer. When they don't
 * (the live DOM and `resource_text` disagree about what text exists at all —
 * a footnote marker, a hidden label, a drop cap split across elements), the
 * pairing walks forward using each hit's own prefix/suffix context as the
 * tiebreak, and a hit whose context can't be found is left **unlocated**
 * rather than guessed at. A missing mark is a small loss; a mark on a
 * passage that is not a hit is the other half of the bug report.
 */
export interface SectionHit {
  /** The hit's index in the whole ordered result set — what `‹ ›` steps and
   * what the result card's rows are numbered by. */
  index: number;
  hit: SearchHit;
}

/** How much context either side counts toward a candidate's score. Short
 * enough to survive the live/extracted text differences that caused the
 * count disagreement in the first place, long enough to tell two occurrences
 * of a common word apart. */
const CONTEXT_COMPARE_LEN = 24;

/**
 * How much agreement (out of `CONTEXT_COMPARE_LEN * 2`) an occurrence needs
 * before it is accepted as a hit's own. Deliberately a *score*, not an
 * equality test: the two texts differ — that is why the counts disagreed —
 * so demanding they match exactly would drop legitimate hits near whatever
 * the live DOM added. Ten characters of agreed context is far more than two
 * neighbouring occurrences of a common word share by accident, and far less
 * than a footnote marker or a stray heading can destroy.
 */
const MIN_CONTEXT_SCORE = 10;

/** How far ahead to look for a hit's occurrence. Bounds the work on a
 * section with hundreds of occurrences, and reflects what the disagreement
 * actually is: a handful of extra occurrences, not a reordering. */
const CANDIDATE_LOOKAHEAD = 8;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase();
}

/** How many characters two strings share, reading backwards from their ends. */
function commonTailLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length, CONTEXT_COMPARE_LEN);
  let shared = 0;
  while (shared < limit && a[a.length - 1 - shared] === b[b.length - 1 - shared]) shared++;
  return shared;
}

/** How many characters two strings share, reading forwards from their starts. */
function commonHeadLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length, CONTEXT_COMPARE_LEN);
  let shared = 0;
  while (shared < limit && a[shared] === b[shared]) shared++;
  return shared;
}

/**
 * How well an occurrence's live surroundings agree with a hit's own recorded
 * context. A side with nothing to compare (a hit at the very start of a
 * section has no prefix) scores its full weight rather than penalising the
 * hit for the section's edge.
 */
function contextScore(liveText: string, occurrence: TextMatch, hit: SearchHit): number {
  const livePrefix = normalize(
    liveText.slice(Math.max(0, occurrence.start - CONTEXT_COMPARE_LEN * 2), occurrence.start),
  );
  const liveSuffix = normalize(liveText.slice(occurrence.end, occurrence.end + CONTEXT_COMPARE_LEN * 2));
  const anchorPrefix = normalize(hit.anchor.prefix);
  const anchorSuffix = normalize(hit.anchor.suffix);

  const prefixScore =
    anchorPrefix.length === 0 || livePrefix.length === 0
      ? CONTEXT_COMPARE_LEN
      : commonTailLength(anchorPrefix, livePrefix);
  const suffixScore =
    anchorSuffix.length === 0 || liveSuffix.length === 0
      ? CONTEXT_COMPARE_LEN
      : commonHeadLength(anchorSuffix, liveSuffix);
  return prefixScore + suffixScore;
}

/**
 * Pairs a section's text hits (in result-set order) with occurrences in the
 * live rendered text, keyed by the hit's index in the result set.
 *
 * The needle is taken from a hit's own `anchor.exact` rather than from the
 * live find-bar query: the two can differ for a keystroke while a debounced
 * request is in flight, and pairing a result set against a *different*
 * query's occurrences would mis-place every mark. `exact` is the text the
 * server matched, so it always describes the set being painted.
 */
export function locateTextHits(
  liveText: string,
  hits: SectionHit[],
  mode: SearchMatchMode,
): Map<number, TextMatch> {
  const located = new Map<number, TextMatch>();
  const needle = hits[0]?.hit.anchor.exact ?? "";
  if (hits.length === 0 || needle.length === 0) return located;

  const occurrences = findAllOccurrences(liveText, needle, mode);

  if (occurrences.length === hits.length) {
    // The live text holds exactly what the server found: the k-th hit is the
    // k-th occurrence, and no content comparison can improve on that.
    hits.forEach(({ index }, k) => located.set(index, occurrences[k]));
    return located;
  }

  // Counts disagree. Both sequences are still in document order, so walk
  // them together: each hit takes the best-agreeing occurrence within a
  // short lookahead, so an occurrence the server never produced a hit for is
  // stepped over rather than absorbed, and a hit the live text no longer
  // holds takes nothing at all.
  let cursor = 0;
  for (const { index, hit } of hits) {
    let best = -1;
    let bestScore = MIN_CONTEXT_SCORE - 1;
    const limit = Math.min(occurrences.length, cursor + CANDIDATE_LOOKAHEAD);
    for (let k = cursor; k < limit; k++) {
      const score = contextScore(liveText, occurrences[k], hit);
      if (score > bestScore) {
        best = k;
        bestScore = score;
      }
    }
    if (best === -1) continue; // unlocated: no mark, rather than a mark in the wrong place
    located.set(index, occurrences[best]);
    cursor = best + 1;
  }
  return located;
}
