import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { Dictionary, DictionaryEntry, DictionarySense } from "./engine.js";

/**
 * WordNet 3.1 behind the `Dictionary` seam (M30 C). The dataset ships in
 * `node_modules/wordnet-db` — files on disk, no network, no service, works
 * with every provider disconnected. That last property is the whole point:
 * the reader reaching for Define is mid-sentence, not mid-research.
 *
 * ⚠️ Why this parses the raw dataset instead of using a WordNet library.
 * `wordnet-db` is *only* the data (its own `index.js` exports a path and
 * nothing else); the libraries that read it bring a callback-era API and a
 * full in-memory index. We need one operation — exact-headword lookup — and
 * WordNet's own file format was designed for exactly that: `index.POS` is
 * sorted in ASCII order, so a **binary search over the file on disk** answers
 * in ~20 reads with no index in memory, which is what WordNet's own reference
 * implementation does. 27MB of dataset costs no resident memory at all.
 *
 * Format, so the parsing below is readable without the manpage:
 *   index.POS  `lemma pos synset_cnt p_cnt [ptr…] sense_cnt tagsense_cnt offset…`
 *   data.POS   `offset lex_filenum ss_type w_cnt word lex_id … | gloss`
 * Both files open with a ~29-line licence header whose lines begin with two
 * spaces — ASCII order puts those before every real entry, so the search
 * skips them without needing to know they exist.
 */

const require = createRequire(import.meta.url);

/** WordNet's single-letter POS codes, in Morphy's own search order, mapped
 * to the words we render. `adj`/`adv` files use `a`/`r` internally. */
const PARTS_OF_SPEECH = [
  { code: "noun", label: "noun" },
  { code: "verb", label: "verb" },
  { code: "adj", label: "adjective" },
  { code: "adv", label: "adverb" },
] as const;

type PosCode = (typeof PARTS_OF_SPEECH)[number]["code"];

/**
 * Morphy's *regular* detachment rules — the suffix strippings that turn an
 * inflected form back into a headword.
 *
 * ⚠️ Deliberately incomplete, and the gap is designed for. Real Morphy also
 * consults per-POS exception lists (`noun.exc`, `verb.exc`, …) for the
 * irregulars — "went" → "go", "mice" → "mouse". **`wordnet-db` does not ship
 * those files**, so irregular inflections miss here. That is survivable
 * precisely because a miss is not a failure: it falls through to Define's
 * digest rung, which handles an unrecognised form fine. Recorded rather than
 * papered over — see NOTES.md.
 *
 * The `ier`/`iest`/`ied` → `y` rules are ours, not Morphy's: WordNet handles
 * "happier" and "carried" through the exception lists we do not have, and
 * these three recover most of that class regularly. An extra candidate that
 * is not a real headword costs one missed binary search, so over-generating
 * is the safe direction to err in.
 */
const DETACHMENT_RULES: Record<PosCode, [string, string][]> = {
  noun: [
    ["ses", "s"], ["xes", "x"], ["zes", "z"], ["ches", "ch"], ["shes", "sh"],
    ["men", "man"], ["ies", "y"], ["s", ""],
  ],
  verb: [
    ["ies", "y"], ["ied", "y"], ["es", "e"], ["es", ""], ["ed", "e"], ["ed", ""],
    ["ing", "e"], ["ing", ""], ["s", ""],
  ],
  adj: [["ier", "y"], ["iest", "y"], ["er", ""], ["est", ""], ["er", "e"], ["est", "e"]],
  adv: [],
};

/** Candidate headwords for `lemma` under one POS, the word itself first —
 * `lookup` relies on that ordering to run every exact form before any
 * detachment (see the two passes there). */
function morphyCandidates(lemma: string, pos: PosCode): string[] {
  const candidates = [lemma];
  for (const [suffix, replacement] of DETACHMENT_RULES[pos]) {
    if (lemma.length > suffix.length && lemma.endsWith(suffix)) {
      candidates.push(lemma.slice(0, -suffix.length) + replacement);
    }
  }
  return [...new Set(candidates)];
}

/**
 * A WordNet gloss is `definition[; further definition]; "an example"; "another"`.
 * The quoted tails are usage examples, not part of the definition — dropping
 * them is what makes the result read like a dictionary entry rather than a
 * database row.
 */
function definitionFromGloss(gloss: string): string {
  return gloss
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('"'))
    .join("; ");
}

/** WordNet stores multi-word headwords with underscores for spaces. */
function toLemmaKey(term: string): string {
  return term.toLowerCase().replace(/\s+/gu, "_");
}

function fromLemmaKey(key: string): string {
  return key.replace(/_/gu, " ");
}

/** The line containing `offset`, read as latin1 so byte offsets and string
 * indices stay 1:1 — the whole binary search below depends on that. */
async function readLineAt(
  handle: FileHandle,
  start: number,
  size: number,
): Promise<string> {
  const CHUNK = 4096;
  let text = "";
  let cursor = start;
  while (cursor < size) {
    const length = Math.min(CHUNK, size - cursor);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, cursor);
    const chunk = buffer.toString("latin1");
    const newline = chunk.indexOf("\n");
    if (newline >= 0) return text + chunk.slice(0, newline);
    text += chunk;
    cursor += length;
  }
  return text;
}

/** Scans back from `position` to the first byte after the previous newline,
 * never going below `floor` (which the caller guarantees is a line start). */
async function startOfLineContaining(
  handle: FileHandle,
  position: number,
  floor: number,
): Promise<number> {
  const CHUNK = 4096;
  let cursor = position;
  while (cursor > floor) {
    const start = Math.max(floor, cursor - CHUNK);
    const length = cursor - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const newline = buffer.toString("latin1").lastIndexOf("\n");
    if (newline >= 0) return start + newline + 1;
    cursor = start;
  }
  return floor;
}

/**
 * Binary search for the line whose first field is exactly `key`.
 *
 * Terminates because each branch moves a bound strictly past `mid`: a lemma
 * sorting before the key pushes `lo` to the *next* line's start (> mid), and
 * one sorting after pulls `hi` down to this line's start (<= mid < hi). The
 * invariant held throughout is "if the key is in this file, its line starts
 * within [lo, hi)".
 */
async function findIndexLine(
  handle: FileHandle,
  size: number,
  key: string,
): Promise<string | null> {
  let lo = 0;
  let hi = size;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const start = await startOfLineContaining(handle, mid, lo);
    const line = await readLineAt(handle, start, size);
    const lemma = line.slice(0, line.indexOf(" "));
    if (lemma === key) return line;
    if (lemma < key) lo = start + line.length + 1;
    else hi = start;
  }
  return null;
}

const MAX_SENSES = 3;

class WordNetDictionary implements Dictionary {
  readonly id = "wordnet" as const;
  readonly attribution = "WordNet 3.1";

  private readonly dictPath: string;
  /** Opened once and kept — a lookup is a handful of reads on an already-open
   * handle, which is what makes Define feel instant rather than "loading". */
  private handles = new Map<string, { handle: FileHandle; size: number }>();

  constructor(dictPath: string) {
    this.dictPath = dictPath;
  }

  private async open(file: string): Promise<{ handle: FileHandle; size: number }> {
    const existing = this.handles.get(file);
    if (existing) return existing;
    const full = path.join(this.dictPath, file);
    const handle = await fs.open(full, "r");
    const { size } = await handle.stat();
    const opened = { handle, size };
    this.handles.set(file, opened);
    return opened;
  }

  async lookup(term: string): Promise<DictionaryEntry | null> {
    const key = toLemmaKey(term);
    if (!key) return null;

    // Two passes, and the order matters: the *exact* selected form is tried
    // across every part of speech before any detachment is tried at all.
    // One pass per POS would let an earlier POS's guess beat a later POS's
    // real headword — "studied" would resolve to the verb "study" rather
    // than the adjective it plainly is on the page.
    for (const { code, label } of PARTS_OF_SPEECH) {
      const senses = await this.sensesFor(key, code, label);
      if (senses.length > 0) return { headword: fromLemmaKey(key), senses };
    }
    for (const { code, label } of PARTS_OF_SPEECH) {
      for (const candidate of morphyCandidates(key, code).slice(1)) {
        const senses = await this.sensesFor(candidate, code, label);
        if (senses.length > 0) {
          return { headword: fromLemmaKey(candidate), senses };
        }
      }
    }
    return null;
  }

  private async sensesFor(
    lemma: string,
    pos: PosCode,
    label: string,
  ): Promise<DictionarySense[]> {
    const index = await this.open(`index.${pos}`);
    const line = await findIndexLine(index.handle, index.size, lemma);
    if (!line) return [];

    // `lemma pos synset_cnt p_cnt [ptr…] sense_cnt tagsense_cnt offset…` —
    // the pointer-symbol block is variable-length, so the offsets are read
    // from the end (the last `sense_cnt` fields) rather than by counting
    // forward past it.
    const fields = line.trim().split(/\s+/u);
    const senseCount = Number(fields[2]);
    if (!Number.isInteger(senseCount) || senseCount <= 0) return [];
    const offsets = fields.slice(-senseCount);

    const data = await this.open(`data.${pos}`);
    const senses: DictionarySense[] = [];
    // Capped: WordNet gives "run" 57 senses, and a wall of them is not a
    // definition. Three is what a print dictionary shows before the reader
    // has to want more.
    for (const offset of offsets.slice(0, MAX_SENSES)) {
      const at = Number(offset);
      if (!Number.isInteger(at) || at < 0 || at >= data.size) continue;
      const dataLine = await readLineAt(data.handle, at, data.size);
      const bar = dataLine.indexOf("|");
      if (bar < 0) continue;
      const definition = definitionFromGloss(dataLine.slice(bar + 1));
      if (definition) senses.push({ partOfSpeech: label, definition });
    }
    return senses;
  }

  /** Test/shutdown hook — the singleton below never closes in normal use. */
  async close(): Promise<void> {
    for (const { handle } of this.handles.values()) await handle.close();
    this.handles.clear();
  }
}

let dictionary: Dictionary | null | undefined;

/**
 * The process-wide dictionary, or **null when the dataset isn't present**.
 * Null is a designed state, not a crash: `wordnet-db` is an ordinary
 * dependency, but a partial install shouldn't take the reader down — Define
 * simply falls through to its digest rung, and with no provider either, to
 * the "no definition found" state M30 C requires.
 */
export function getDictionary(): Dictionary | null {
  if (dictionary !== undefined) return dictionary;
  try {
    const dictPath = require("wordnet-db").path as string;
    dictionary = new WordNetDictionary(dictPath);
  } catch {
    dictionary = null;
  }
  return dictionary;
}

/** Testing seam: builds an instance against an explicit dataset directory. */
export function createWordNetDictionary(dictPath: string): Dictionary {
  return new WordNetDictionary(dictPath);
}
