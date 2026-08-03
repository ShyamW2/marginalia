/**
 * Sentence segmentation (AUDIO.md, binding): "the unit of everything". Sync
 * is sentence-level by construction — one audio segment per sentence — so
 * this file's char offsets are exactly what the reader resolves back to a
 * DOM range (`web/src/reader/anchorResolution.ts`) and what
 * `annotations/position.ts` already uses as its coordinate system: offsets
 * into `resource_text`'s own string, nothing derived or re-encoded.
 *
 * `Intl.Segmenter`'s sentence granularity implements Unicode's generic
 * sentence-break rules (UAX #29), which have no idea "Mr." is an
 * abbreviation or that "..." rarely ends a sentence in prose — it breaks
 * after any ATerm followed by an uppercase-looking word. Those false
 * breaks are the whole reason this file exists rather than a one-line
 * `Intl.Segmenter` call; `mergeFalseBoundaries` repairs them by construction
 * before anything else looks at the sentence list.
 */

export interface Sentence {
  charStart: number;
  charEnd: number;
  /** Invariant: always `text.slice(charStart, charEnd)` — never a rebuilt
   * or trimmed string, so the offset round-trip holds no matter how many
   * merge/split passes produced it. */
  text: string;
}

// Case-insensitive; checked against the trailing word before a `.`, stripped
// of the period itself. Not exhaustive — the boring, common set a reader
// actually hits; anything missed just costs one avoidable sentence break,
// never a wrong one (SPEC-GAP, see NOTES.md).
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "mx", "dr", "st", "prof", "sr", "jr", "rev", "hon",
  "capt", "col", "gen", "lt", "sgt", "maj", "cmdr", "adm",
  "vs", "etc", "eg", "ie", "no", "vol", "fig", "approx", "dept", "univ",
  "inc", "ltd", "co", "corp", "mt", "ft", "jan", "feb", "mar", "apr", "jun",
  "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** Below this many non-whitespace chars, a sentence is too small to render
 * on its own (AUDIO.md: "a lone 'Yes.' is a wasteful synthesis call and a
 * jumpy highlight") and folds into a neighbour. */
const MIN_SENTENCE_LENGTH = 15;
/** Above this many chars, a sentence is hard-split at a clause boundary so
 * no single segment "takes forever to render" (AUDIO.md). */
const MAX_SENTENCE_LENGTH = 400;

const TRAILING_WORD_BEFORE_PERIOD = /([A-Za-z]+)\.[\s]*["'”’)\]]*$/;
const TRAILING_ELLIPSIS = /(?:\.\s?\.\s?\.|…)[\s]*["'”’)\]]*$/;

function endsWithFalseBoundary(text: string): boolean {
  const trimmed = text.trimEnd();
  if (TRAILING_ELLIPSIS.test(trimmed)) return true;
  const match = trimmed.match(TRAILING_WORD_BEFORE_PERIOD);
  if (!match) return false;
  const word = match[1];
  if (ABBREVIATIONS.has(word.toLowerCase())) return true;
  // A single capital letter before the period is an initial ("J.", "K.") —
  // multi-initial names ("J.K. Rowling") cascade: this merges "J." into
  // "K.", then the combined "...K." tail matches the same rule again and
  // merges into "Rowling...".
  if (word.length === 1 && word === word.toUpperCase()) return true;
  return false;
}

/** Intl.Segmenter's raw boundaries, repaired: a boundary right after an
 * abbreviation, initial, or ellipsis is not a real sentence end, so the two
 * pieces it split apart get glued back into one — by re-slicing the source
 * text, never by concatenating the pieces' own strings. */
function mergeFalseBoundaries(sentences: Sentence[], text: string): Sentence[] {
  const result: Sentence[] = [];
  for (const s of sentences) {
    const prev = result[result.length - 1];
    if (prev && endsWithFalseBoundary(prev.text)) {
      result[result.length - 1] = {
        charStart: prev.charStart,
        charEnd: s.charEnd,
        text: text.slice(prev.charStart, s.charEnd),
      };
    } else {
      result.push({ ...s });
    }
  }
  return result;
}

/** Folds any sentence under `MIN_SENTENCE_LENGTH` (by trimmed length, so
 * whitespace-only artifacts don't skew it) into a neighbour — forward into
 * the next sentence where one exists, otherwise back into the previous.
 * Forward-merging happens by mutating the *next* slot in place so a run of
 * several short sentences in a row cascades into one merge rather than
 * leaving pairs too short. */
function mergeShortSentences(sentences: Sentence[], text: string): Sentence[] {
  const working = sentences.map((s) => ({ ...s }));
  const result: Sentence[] = [];
  for (let i = 0; i < working.length; i++) {
    const s = working[i];
    const isShort = s.text.trim().length < MIN_SENTENCE_LENGTH;
    if (isShort && i + 1 < working.length) {
      working[i + 1] = {
        charStart: s.charStart,
        charEnd: working[i + 1].charEnd,
        text: text.slice(s.charStart, working[i + 1].charEnd),
      };
      continue;
    }
    if (isShort && result.length > 0) {
      const last = result[result.length - 1];
      result[result.length - 1] = {
        charStart: last.charStart,
        charEnd: s.charEnd,
        text: text.slice(last.charStart, s.charEnd),
      };
      continue;
    }
    result.push(s);
  }
  return result;
}

const CLAUSE_BREAK_CHARS = new Set([",", ";", ":", "—"]); // — = em dash

/** Scans backward from `windowEnd` for the nearest clause punctuation
 * followed by whitespace, so a hard split lands somewhere a listener would
 * naturally pause rather than mid-clause. Returns the offset right after
 * that whitespace (where the next piece should start), or null if none
 * exists in range. */
function findClauseBreak(text: string, floor: number, windowEnd: number): number | null {
  for (let i = windowEnd; i > floor; i--) {
    if (CLAUSE_BREAK_CHARS.has(text[i - 1]) && /\s/.test(text[i] ?? "")) {
      return i + 1;
    }
  }
  return null;
}

function findWordBreak(text: string, floor: number, windowEnd: number): number | null {
  for (let i = windowEnd; i > floor; i--) {
    if (/\s/.test(text[i - 1])) return i;
  }
  return null;
}

/** Hard-splits one over-long sentence into pieces at or under
 * `MAX_SENTENCE_LENGTH`, preferring a clause boundary, then a word
 * boundary, and only cutting mid-word as a last resort (a run of 400+
 * non-whitespace chars with no clause or word break at all — effectively
 * never in real prose). */
function splitLongSentence(s: Sentence, text: string): Sentence[] {
  if (s.text.length <= MAX_SENTENCE_LENGTH) return [s];

  const pieces: Sentence[] = [];
  let start = s.charStart;
  while (s.charEnd - start > MAX_SENTENCE_LENGTH) {
    const windowEnd = start + MAX_SENTENCE_LENGTH;
    // Never search below `start` itself, and never produce a zero-length
    // piece — floor stops both.
    const floor = start;
    const splitAt =
      findClauseBreak(text, floor, windowEnd) ?? findWordBreak(text, floor, windowEnd) ?? windowEnd;
    pieces.push({ charStart: start, charEnd: splitAt, text: text.slice(start, splitAt) });
    start = splitAt;
  }
  pieces.push({ charStart: start, charEnd: s.charEnd, text: text.slice(start, s.charEnd) });
  return pieces;
}

/**
 * Segments one spine section's `resource_text` into sentences, char offsets
 * into that exact string. Empty/whitespace-only input returns no sentences
 * rather than one empty one — nothing to synthesize.
 */
export function segmentSentences(text: string): Sentence[] {
  if (text.trim().length === 0) return [];

  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const raw: Sentence[] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    raw.push({ charStart: index, charEnd: index + segment.length, text: segment });
  }

  const repaired = mergeFalseBoundaries(raw, text);
  const rightSized = mergeShortSentences(repaired, text);
  return rightSized.flatMap((s) => splitLongSentence(s, text));
}
