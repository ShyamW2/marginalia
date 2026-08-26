import { describe, expect, it } from "vitest";
import { isDefinableTerm, normalizeDefineTerm } from "./defineTerm.js";

describe("normalizeDefineTerm", () => {
  it("trims the punctuation a reader drags in from the page", () => {
    // Dragging across a word almost always catches its neighbours' commas,
    // full stops and quotation marks.
    expect(normalizeDefineTerm(" “quixotic,” ")).toBe("quixotic");
    expect(normalizeDefineTerm("ineffable.")).toBe("ineffable");
    expect(normalizeDefineTerm("(sublime)")).toBe("sublime");
  });

  it("keeps the punctuation that is part of the word", () => {
    expect(normalizeDefineTerm("self-evident")).toBe("self-evident");
    expect(normalizeDefineTerm("o'clock")).toBe("o'clock");
  });

  it("collapses the whitespace a selection spanning a line break carries", () => {
    expect(normalizeDefineTerm("point   of\nview")).toBe("point of view");
  });
});

describe("isDefinableTerm", () => {
  it("accepts a word and a lexicalised phrase", () => {
    expect(isDefinableTerm("serendipity")).toBe(true);
    expect(isDefinableTerm("point of view")).toBe(true);
    expect(isDefinableTerm("stream of consciousness")).toBe(true);
  });

  it("rejects a sentence — Define on prose answers badly rather than erroring", () => {
    expect(
      isDefinableTerm(
        "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.",
      ),
    ).toBe(false);
    expect(isDefinableTerm("the whole of the thing considered")).toBe(false);
  });

  it("rejects a long unbroken run that passes the word count but is not a term", () => {
    expect(isDefinableTerm("https://example.com/a/very/long/path/that/is/not/a/word")).toBe(false);
  });

  it("rejects an empty or punctuation-only selection", () => {
    expect(isDefinableTerm("")).toBe(false);
    expect(isDefinableTerm("   ")).toBe(false);
    expect(isDefinableTerm("—,.")).toBe(false);
  });
});
