import { describe, expect, it } from "vitest";
import { containsMatch, findAllOccurrences } from "./textSearch.js";

function matched(text: string, query: string, mode: "word" | "substring"): string[] {
  return findAllOccurrences(text, query, mode).map((m) => text.slice(m.start, m.end));
}

describe("findAllOccurrences", () => {
  it("finds every occurrence, in document order", () => {
    const text = "the cat sat on the mat";
    expect(findAllOccurrences(text, "the", "word")).toEqual([
      { start: 0, end: 3 },
      { start: 15, end: 18 },
    ]);
  });

  it("is case-insensitive but reports the text's own casing", () => {
    expect(matched("The THE the", "the", "word")).toEqual(["The", "THE", "the"]);
  });

  it("whole-word mode is why 'the' stops blanketing a paragraph", () => {
    // The reported case (TASKS.md M24.1 C): substring matched *other*,
    // *there* and *father* as well, which is what produced dozens of
    // three-character rects per paragraph.
    const text = "there, the other father said the truth";
    expect(matched(text, "the", "word")).toEqual(["the", "the"]);
    expect(matched(text, "the", "substring")).toHaveLength(5);
  });

  it("treats a boundary as a boundary in any script", () => {
    expect(matched("façade façades", "façade", "word")).toEqual(["façade"]);
    expect(matched("東京 東京都", "東京", "word")).toEqual(["東京"]);
  });

  it("does not demand a boundary the query itself doesn't have", () => {
    // A query ending in punctuation has no word edge to respect there.
    expect(matched("he said 'the' loudly", "'the'", "word")).toEqual(["'the'"]);
    expect(matched("a — b", "—", "word")).toEqual(["—"]);
  });

  it("counts digits and underscores as part of a word", () => {
    expect(matched("§4 §41", "§4", "word")).toEqual(["§4"]);
    expect(matched("id_1 id_12", "id_1", "word")).toEqual(["id_1"]);
  });

  it("finds nothing for an empty query", () => {
    expect(findAllOccurrences("anything", "", "word")).toEqual([]);
    expect(findAllOccurrences("anything", "", "substring")).toEqual([]);
  });

  it("returns non-overlapping occurrences", () => {
    expect(findAllOccurrences("aaaa", "aa", "substring")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});

describe("containsMatch", () => {
  it("answers with the same rule the scan applies", () => {
    expect(containsMatch("a father figure", "the", "word")).toBe(false);
    expect(containsMatch("a father figure", "the", "substring")).toBe(true);
    expect(containsMatch("the father", "the", "word")).toBe(true);
  });
});
