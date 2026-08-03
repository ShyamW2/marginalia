import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { segmentSentences } from "./segment.js";
import { extractEpub } from "../library/epub.js";
import { WORKSPACE_ROOT } from "../paths.js";

/** Every sentence's own invariant, checked everywhere: the offset round
 * trip AUDIO.md names explicitly, since it's what the reader trusts to
 * resolve a char range back to a DOM range. */
function expectRoundTrip(text: string, sentences: ReturnType<typeof segmentSentences>) {
  for (const s of sentences) {
    expect(text.slice(s.charStart, s.charEnd)).toBe(s.text);
  }
}

describe("segmentSentences", () => {
  it("returns nothing for empty or whitespace-only text", () => {
    expect(segmentSentences("")).toEqual([]);
    expect(segmentSentences("   \n\t  ")).toEqual([]);
  });

  it("does not split on an abbreviation", () => {
    const text = "Dr. Smith arrived early this morning. He looked exhausted afterward.";
    const sentences = segmentSentences(text);
    expect(sentences.map((s) => s.text.trim())).toEqual([
      "Dr. Smith arrived early this morning.",
      "He looked exhausted afterward.",
    ]);
    expectRoundTrip(text, sentences);
  });

  it("does not split on a title before a second abbreviation", () => {
    const text = "She met Mr. and Mrs. Bennet at noon. It was raining.";
    const sentences = segmentSentences(text);
    expect(sentences.map((s) => s.text.trim())).toEqual([
      "She met Mr. and Mrs. Bennet at noon.",
      "It was raining.",
    ]);
    expectRoundTrip(text, sentences);
  });

  it("does not split on a run of initials", () => {
    const text = "It was J. K. Rowling who wrote it. Everyone knew that.";
    const sentences = segmentSentences(text);
    expect(sentences.map((s) => s.text.trim())).toEqual([
      "It was J. K. Rowling who wrote it.",
      "Everyone knew that.",
    ]);
    expectRoundTrip(text, sentences);
  });

  it("does not split on an ellipsis", () => {
    const text = "I dont know... Maybe you are right.";
    const sentences = segmentSentences(text);
    expect(sentences).toHaveLength(1);
    expect(sentences[0].text).toBe(text);
    expectRoundTrip(text, sentences);
  });

  it("does not split on a quoted ellipsis", () => {
    const text = '"Wait..." He hesitated for quite a while before deciding. "Never mind then," she said at last.';
    const sentences = segmentSentences(text);
    // The ellipsis boundary merges away; "she said at last" is a real
    // sentence end and stays its own sentence.
    expect(sentences.map((s) => s.text.trim())).toEqual([
      '"Wait..." He hesitated for quite a while before deciding.',
      '"Never mind then," she said at last.',
    ]);
    expectRoundTrip(text, sentences);
  });

  it("still splits a real sentence end that merely contains an ellipsis mid-sentence", () => {
    const text = 'He paused for a moment. "Well..." she said quietly. "I suppose so, then."';
    const sentences = segmentSentences(text);
    expect(sentences.map((s) => s.text.trim())).toEqual([
      "He paused for a moment.",
      '"Well..." she said quietly.',
      '"I suppose so, then."',
    ]);
    expectRoundTrip(text, sentences);
  });

  it("merges a short sentence into its neighbour", () => {
    const text = '"Yes." She nodded and walked away without another word.';
    const sentences = segmentSentences(text);
    expect(sentences).toHaveLength(1);
    expectRoundTrip(text, sentences);
  });

  it("merges a short trailing sentence backward when it has no next neighbour", () => {
    const text = "She nodded and walked away without another word. Yes.";
    const sentences = segmentSentences(text);
    expect(sentences).toHaveLength(1);
    expectRoundTrip(text, sentences);
  });

  it("hard-splits an over-long sentence at a clause boundary", () => {
    const text =
      "The room was quiet, save for the ticking clock, the distant hum of traffic outside, " +
      "the faint creak of an old house settling into the night, and the soft rustle of pages " +
      "turning as he read on and on, unwilling to stop even as the hour grew late and his eyes " +
      "grew heavy with sleep, and still he did not move, and still the candle burned low, and " +
      "the shadows lengthened across the floor, and the silence deepened around him.";
    expect(text.length).toBeGreaterThan(400);
    const sentences = segmentSentences(text);
    expect(sentences.length).toBeGreaterThan(1);
    for (const s of sentences) expect(s.text.length).toBeLessThanOrEqual(400);
    // Every clause-boundary split lands right after a comma+space, not
    // mid-word.
    for (let i = 0; i < sentences.length - 1; i++) {
      expect(sentences[i].text.trim().endsWith(",")).toBe(true);
    }
    expectRoundTrip(text, sentences);
    // Pieces are contiguous and cover the whole sentence exactly.
    expect(sentences[0].charStart).toBe(0);
    expect(sentences[sentences.length - 1].charEnd).toBe(text.length);
    for (let i = 1; i < sentences.length; i++) {
      expect(sentences[i].charStart).toBe(sentences[i - 1].charEnd);
    }
  });

  it("preserves quotation marks in segment text", () => {
    const text = 'She said, "I will not go." Then she left.';
    const sentences = segmentSentences(text);
    expect(sentences.some((s) => s.text.includes('"I will not go."'))).toBe(true);
    expectRoundTrip(text, sentences);
  });

  describe("against a real fixture chapter", () => {
    const buffer = fs.readFileSync(path.join(WORKSPACE_ROOT, "fixtures", "alice-in-wonderland.epub"));
    const { spine } = extractEpub(buffer);
    // Spine 0 is the cover (no text); pick a real chapter.
    const chapterText = spine[1].text;

    it("round-trips every offset and stays contiguous across a whole chapter", () => {
      expect(chapterText.length).toBeGreaterThan(500);
      const sentences = segmentSentences(chapterText);
      expect(sentences.length).toBeGreaterThan(5);
      expectRoundTrip(chapterText, sentences);
      expect(sentences[0].charStart).toBe(0);
      expect(sentences[sentences.length - 1].charEnd).toBe(chapterText.length);
      for (let i = 1; i < sentences.length; i++) {
        expect(sentences[i].charStart).toBe(sentences[i - 1].charEnd);
      }
      for (const s of sentences) expect(s.text.length).toBeLessThanOrEqual(400);
    });
  });
});
