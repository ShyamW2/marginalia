import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWordNetDictionary, getDictionary } from "./wordnet.js";

/**
 * A miniature WordNet in the real on-disk format. The binary search only
 * works because `index.POS` is ASCII-sorted behind a two-space licence
 * header, so the fixture reproduces both — a fixture that skipped the header
 * would pass while the real dataset failed.
 */
async function writeFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "marginalia-wordnet-"));
  const dict = path.join(dir, "dict");
  await fs.mkdir(dict);

  // `offset lex_filenum ss_type w_cnt word lex_id p_cnt | gloss`. Offsets in
  // the index must be the real byte positions of these lines, so the file is
  // assembled first and the offsets measured from it.
  const nounGlosses = [
    "01 n 01 aardvark 0 000 | a burrowing mammal  ",
    "01 n 01 ax 0 000 | an edge tool; \"he swung the ax\"  ",
    "01 n 01 quiddity 0 000 | the essence of a thing; the whatness  ",
    "01 n 01 zymurgy 0 000 | the chemistry of fermentation  ",
  ];
  let dataNoun = "  1 This software and database is being provided to you.\n";
  const offsets: number[] = [];
  for (const gloss of nounGlosses) {
    const offset = Buffer.byteLength(dataNoun, "latin1");
    offsets.push(offset);
    dataNoun += `${String(offset).padStart(8, "0")} ${gloss}\n`;
  }
  await fs.writeFile(path.join(dict, "data.noun"), dataNoun, "latin1");

  // `lemma pos synset_cnt p_cnt sense_cnt tagsense_cnt offset` — sorted.
  const indexNoun =
    "  1 This software and database is being provided to you.\n" +
    `aardvark n 1 0 1 0 ${String(offsets[0]).padStart(8, "0")}  \n` +
    `ax n 1 0 1 0 ${String(offsets[1]).padStart(8, "0")}  \n` +
    `quiddity n 1 0 1 0 ${String(offsets[2]).padStart(8, "0")}  \n` +
    `zymurgy n 1 0 1 0 ${String(offsets[3]).padStart(8, "0")}  \n`;
  await fs.writeFile(path.join(dict, "index.noun"), indexNoun, "latin1");

  // The other three POS files must exist — lookup walks all four.
  for (const pos of ["verb", "adj", "adv"]) {
    await fs.writeFile(path.join(dict, `index.${pos}`), "  1 header\n", "latin1");
    await fs.writeFile(path.join(dict, `data.${pos}`), "  1 header\n", "latin1");
  }
  return dict;
}

describe("WordNet dictionary", () => {
  it("finds the first, middle and last entries, and misses cleanly", async () => {
    const dict = createWordNetDictionary(await writeFixture());

    // The binary search's three interesting positions: the entry directly
    // after the licence header, one in the middle, and the final line.
    expect((await dict.lookup("aardvark"))?.senses[0].definition).toBe(
      "a burrowing mammal",
    );
    expect((await dict.lookup("quiddity"))?.senses[0].definition).toBe(
      "the essence of a thing; the whatness",
    );
    expect((await dict.lookup("zymurgy"))?.senses[0].definition).toBe(
      "the chemistry of fermentation",
    );

    // A miss is null, never a throw — it is the normal path into Define's
    // digest fallback.
    expect(await dict.lookup("aaaaaa")).toBeNull(); // sorts before everything
    expect(await dict.lookup("mmmmmm")).toBeNull(); // sorts in the middle
    expect(await dict.lookup("zzzzzz")).toBeNull(); // sorts after everything
    expect(await dict.lookup("")).toBeNull();
  });

  it("strips the dataset's usage examples out of the definition", async () => {
    const dict = createWordNetDictionary(await writeFixture());
    // data.noun's "ax" gloss carries a quoted example; a definition that
    // shipped it would read like a database row, not a dictionary entry.
    expect((await dict.lookup("ax"))?.senses[0].definition).toBe("an edge tool");
  });

  it("resolves regular inflections back to the headword", async () => {
    const dict = getDictionary();
    if (!dict) return; // dataset absent — getDictionary()'s designed null
    // "axes" is not an index entry; the noun rule "s" -> "" recovers it, and
    // the returned headword says so rather than echoing what was selected.
    const found = await dict.lookup("axes");
    expect(found?.headword).toBe("ax");
  });

  it("prefers an exact headword in a later part of speech over an earlier one's guess", async () => {
    const dict = getDictionary();
    if (!dict) return;
    // "studied" is a real adjective *and* an inflection of the verb "study".
    // Nouns and verbs are searched before adjectives, so only the two-pass
    // exact-forms-first order gets this right.
    const found = await dict.lookup("studied");
    expect(found?.headword).toBe("studied");
    expect(found?.senses[0].partOfSpeech).toBe("adjective");
  });

  it("looks up a multi-word headword and a plain word from the real dataset", async () => {
    const dict = getDictionary();
    if (!dict) return;
    expect((await dict.lookup("point of view"))?.headword).toBe("point of view");
    expect((await dict.lookup("serendipity"))?.senses[0].definition).toContain(
      "good luck",
    );
  });
});
