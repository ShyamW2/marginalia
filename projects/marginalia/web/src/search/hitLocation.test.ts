import { describe, expect, it } from "vitest";
import type { SearchHit } from "@marginalia/shared";
import { locateTextHits, type SectionHit } from "./hitLocation.js";

/**
 * Builds the section hits the server would have produced for `query` in
 * `serverText` — the same scan `annotations/search.ts` runs, so a test never
 * has to hand-write offsets and contexts that the two sides must agree on.
 */
function serverHits(serverText: string, query: string, startIndex = 0): SectionHit[] {
  const hits: SectionHit[] = [];
  const haystack = serverText.toLowerCase();
  const needle = query.toLowerCase();
  for (let from = 0; ; ) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) break;
    const end = start + query.length;
    const hit: SearchHit = {
      source: "text",
      spineIndex: 0,
      offset: start,
      percent: 0.5,
      snippet: serverText.slice(Math.max(0, start - 20), end + 20),
      anchor: {
        prefix: serverText.slice(Math.max(0, start - 64), start),
        exact: serverText.slice(start, end),
        suffix: serverText.slice(end, end + 64),
      },
      highlightId: null,
    };
    hits.push({ index: startIndex + hits.length, hit });
    from = end;
  }
  return hits;
}

describe("locateTextHits", () => {
  const text =
    "The roof was steep. Rain ran off the roof and into the yard, and the roof " +
    "creaked all night, and by morning the roof had held.";

  it("gives every occurrence its own position — the bug: they all collapsed onto the first", () => {
    const hits = serverHits(text, "roof");
    expect(hits).toHaveLength(4);

    const located = locateTextHits(text, hits, "word");
    const starts = hits.map(({ index }) => located.get(index)?.start);
    expect(new Set(starts).size).toBe(4);
    expect(starts).toEqual(hits.map(({ hit }) => hit.offset));
  });

  it("keeps the pairing when the live text differs in whitespace only", () => {
    // Live DOM text against server-extracted `resource_text`: same words,
    // different line breaks — which is exactly when byte-for-byte
    // prefix+exact+suffix matching failed and everything fell back to
    // "the first occurrence".
    const hits = serverHits(text, "roof");
    const live = text.replace(/ /g, "\n  ");
    const located = locateTextHits(live, hits, "word");
    expect(located.size).toBe(4);
    expect(new Set([...located.values()].map((m) => m.start)).size).toBe(4);
    for (const match of located.values()) {
      expect(live.slice(match.start, match.end)).toBe("roof");
    }
  });

  it("steps over an occurrence the live text has and the result set doesn't", () => {
    const hits = serverHits(text, "roof");
    // A drop cap, a footnote marker, a running header — anything the live
    // DOM carries that `resource_text` never had.
    const live = `A note about the roof appears first. ${text}`;
    const located = locateTextHits(live, hits, "word");
    expect(located.size).toBe(4);
    // Every hit lands in the body, past the interloper.
    for (const match of located.values()) {
      expect(match.start).toBeGreaterThan(30);
    }
  });

  it("leaves a hit unlocated rather than putting a mark where it isn't", () => {
    const hits = serverHits(text, "roof");
    // The live section only contains the first two occurrences, in a
    // different context for the rest.
    const live = "The roof was steep. Rain ran off the roof and into the yard.";
    const located = locateTextHits(live, hits, "word");
    expect(located.size).toBe(2);
    expect(located.has(hits[2].index)).toBe(false);
    expect(located.has(hits[3].index)).toBe(false);
  });

  it("keys results by the hit's index in the whole result set, not by section position", () => {
    const hits = serverHits(text, "roof", 17);
    const located = locateTextHits(text, hits, "word");
    expect([...located.keys()]).toEqual([17, 18, 19, 20]);
  });

  it("finds nothing to locate when there are no hits", () => {
    expect(locateTextHits(text, [], "word").size).toBe(0);
  });

  it("uses the matching rule the hits were produced with", () => {
    const roofs = "The roof and the roofs and the roof again.";
    const wordHits = serverHits(roofs, "roof").filter(
      // The server's word-mode scan would not have produced the "roofs" one.
      ({ hit }) => roofs[hit.offset + 4] !== "s",
    );
    const located = locateTextHits(roofs, wordHits, "word");
    expect(located.size).toBe(2);
    for (const match of located.values()) {
      expect(roofs.slice(match.start, match.end + 1)).not.toBe("roofs");
    }
  });
});
