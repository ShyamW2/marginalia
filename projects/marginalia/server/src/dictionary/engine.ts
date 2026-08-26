/**
 * The dictionary seam (M30 C, decisions.md 2026-08-24 "Define: a dictionary
 * first, the digest as fallback — capped").
 *
 * Same contract style as `LLMProvider` (settled decision 1) and `TTSEngine`
 * (settled decision 9): the rest of the server only ever sees these types,
 * never anything dataset-specific — no WordNet byte offsets, no synset
 * pointers, no `index.noun`. A second dataset later is a new file that
 * implements this interface, not a new call site.
 *
 * ⚠️ The seam exists to keep one specific door shut. Settled decision 10
 * enumerates cloud dependencies one at a time, and a dictionary *API* would
 * be a third named exception — not authorised by M30. A `Dictionary` is
 * therefore local by construction: `lookup` reads bundled files and nothing
 * else. If a future implementation ever wants the network, that is a
 * decisions.md entry before it is a class.
 */

/** One sense of a term. WordNet's `gloss`, split the way a reader reads it. */
export interface DictionarySense {
  /** "noun" | "verb" | "adjective" | "adverb" — spelled out, not WordNet's
   * single-letter codes, because this string is rendered to the reader. */
  partOfSpeech: string;
  /** The definition itself, with the dataset's usage examples stripped out. */
  definition: string;
}

export interface DictionaryEntry {
  /** The headword actually found — may differ from what was selected once
   * morphology has run ("running" → "run"). Shown to the reader precisely
   * *because* it can differ: a definition of a word they didn't select is
   * confusing unless the substitution is visible. */
  headword: string;
  senses: DictionarySense[];
}

export interface Dictionary {
  readonly id: "wordnet";
  /** Human-facing attribution, rendered next to the definition. A reader
   * should always be able to see which of Define's two paths answered. */
  readonly attribution: string;
  /**
   * Returns every sense of `term`, or null when the dataset has no entry —
   * a miss, not an error. A miss is the *normal* path into the digest
   * fallback, so it must never throw.
   */
  lookup(term: string): Promise<DictionaryEntry | null>;
}
