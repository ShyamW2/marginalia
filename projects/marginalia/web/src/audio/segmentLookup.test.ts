import { describe, expect, it } from "vitest";
import type { AudioSegment } from "@marginalia/shared";
import { resolveSegmentIndexForOffset } from "./segmentLookup.js";

function segment(n: number, text: string): AudioSegment {
  return { n, charStart: 0, charEnd: text.length, durationMs: 0, voiceId: "v", speakerId: null, text };
}

describe("resolveSegmentIndexForOffset", () => {
  const sentenceA = "Alice was beginning to get very tired of sitting by her sister.";
  const sentenceB = "She had peeped into the book her sister was reading.";
  const sentenceC = "Once or twice she had peeped into the book.";
  const sectionText = `${sentenceA} ${sentenceB} ${sentenceC}`;
  const segments = [segment(0, sentenceA), segment(1, sentenceB), segment(2, sentenceC)];

  it("resolves an offset inside the second sentence to segment 1", () => {
    const targetStart = sectionText.indexOf("book her sister");
    expect(resolveSegmentIndexForOffset(sectionText, targetStart, segments)).toBe(1);
  });

  it("resolves an offset inside the last sentence to its segment", () => {
    const targetStart = sectionText.indexOf("Once or twice");
    expect(resolveSegmentIndexForOffset(sectionText, targetStart, segments)).toBe(2);
  });

  it("resolves an offset before the first known segment to 0", () => {
    expect(resolveSegmentIndexForOffset(sectionText, 0, segments)).toBe(0);
  });

  it("falls back to the last known segment when the section is only partially rendered", () => {
    const partiallyRendered = [segment(0, sentenceA)];
    const targetStart = sectionText.indexOf("Once or twice"); // in sentence C, not yet rendered
    expect(resolveSegmentIndexForOffset(sectionText, targetStart, partiallyRendered)).toBe(0);
  });

  it("resolves to 0 when nothing has rendered yet", () => {
    const targetStart = sectionText.indexOf("Once or twice");
    expect(resolveSegmentIndexForOffset(sectionText, targetStart, [])).toBe(0);
  });

  it("advances the search cursor so a repeated sentence doesn't re-match an earlier segment", () => {
    const repeated = "Yes. Yes.";
    const withRepeat = [segment(0, "Yes."), segment(1, "Yes.")];
    const targetStart = repeated.lastIndexOf("Yes.");
    expect(resolveSegmentIndexForOffset(repeated, targetStart, withRepeat)).toBe(1);
  });

  // Confirmed live (M22.6 C): server-extracted segment text is word-wrapped
  // with real embedded newlines that the live DOM's own text never shares —
  // a plain `indexOf` search silently fails on segment 1 here and every
  // lookup collapses to segment 0, regardless of the actual selection.
  it("matches a segment whose own text has mid-sentence line wraps the DOM text doesn't share", () => {
    const domSectionText =
      "CHAPTER VI. Pig and Pepper For a minute or two she stood looking at the house, and wondering what to do next, when suddenly a footman in livery came running out of the wood. It was opened by another footman in livery.";
    const wrappedSegments = [
      segment(0, "CHAPTER VI.\n\nPig and Pepper\n"),
      segment(
        1,
        "\nFor a minute or two she stood looking at the house, and wondering what to do\nnext, when suddenly a footman in livery came running out of the wood. ",
      ),
      segment(2, "It was opened by another footman in\nlivery."),
    ];
    const targetStart = domSectionText.indexOf("It was opened");
    expect(resolveSegmentIndexForOffset(domSectionText, targetStart, wrappedSegments)).toBe(2);
  });
});
