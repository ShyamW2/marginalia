import { describe, expect, it } from "vitest";
import { chapterStartAnchor, locateQuoteAnchor } from "./chapterAnchor.js";

describe("locateQuoteAnchor", () => {
  it("finds an exact verbatim quote and captures surrounding context", () => {
    const text = "It was the best of times, it was the worst of times, it was the age of wisdom.";
    const anchor = locateQuoteAnchor(text, "the worst of times");
    expect(anchor).not.toBeNull();
    expect(anchor?.exact).toBe("the worst of times");
    expect(anchor?.prefix.endsWith("of times, it was ")).toBe(true);
    expect(anchor?.suffix.startsWith(", it was the age")).toBe(true);
    expect(anchor?.offset).toBe(text.indexOf("the worst of times"));
    expect(anchor?.length).toBe("the worst of times".length);
  });

  it("finds a quote even when the model collapsed whitespace differently", () => {
    const text = "Line one.\n\nLine two continues\nacross a break.";
    const anchor = locateQuoteAnchor(text, "Line two continues across a break.");
    expect(anchor).not.toBeNull();
    expect(anchor?.exact.replace(/\s+/g, " ")).toBe("Line two continues across a break.");
  });

  it("returns null when the quote isn't in the text at all", () => {
    expect(locateQuoteAnchor("Some chapter text.", "a sentence that never appears")).toBeNull();
  });

  it("returns null for an empty or whitespace-only quote", () => {
    expect(locateQuoteAnchor("Some chapter text.", "   ")).toBeNull();
  });

  // M35 §B1b: the model transcribed faithfully and tidied the punctuation —
  // neither the exact nor the whitespace-tolerant tier folds a curly quote.
  it("finds a quote whose curly apostrophe the book renders straight", () => {
    const text = "“Charles won't be going,” said Cyrus, his voice flat.";
    const anchor = locateQuoteAnchor(text, "“Charles won’t be going,” said Cyrus");
    expect(anchor).not.toBeNull();
    // Offset-safe: the returned `exact` is a slice of the *original* text,
    // so it carries the book's own straight apostrophe, not the model's curly one.
    expect(anchor?.exact).toBe("“Charles won't be going,” said Cyrus");
    expect(text.slice(anchor!.offset, anchor!.offset + anchor!.length)).toBe(anchor?.exact);
  });

  it("folds an em dash to a straight hyphen while staying offset-safe", () => {
    const text = 'She said, "I told him — Seventeen, he said." and left the room.';
    const anchor = locateQuoteAnchor(text, "I told him - Seventeen, he said.");
    expect(anchor).not.toBeNull();
    // Recovered from the original text, so the book's own em dash survives.
    expect(anchor?.exact).toBe("I told him — Seventeen, he said.");
  });

  it("finds a quote across a dropped internal quotation mark", () => {
    const text = "The sign read \"beware\" of the dog and little else.";
    const anchor = locateQuoteAnchor(text, "beware of the dog");
    expect(anchor).not.toBeNull();
    expect(anchor?.exact).toBe('beware" of the dog');
  });

  it("returns an offset that locates the real passage, not a guess", () => {
    const text = "Some text before. ‘It was mercy,’ she said quietly. More text after.";
    const anchor = locateQuoteAnchor(text, "'It was mercy,' she said quietly.");
    expect(anchor).not.toBeNull();
    expect(text.slice(anchor!.offset, anchor!.offset + anchor!.length)).toBe(anchor?.exact);
  });
});

describe("chapterStartAnchor", () => {
  it("anchors at the chapter's own opening text, never empty", () => {
    const anchor = chapterStartAnchor("The chapter begins here and continues for a while.");
    expect(anchor.exact.length).toBeGreaterThan(0);
    expect(anchor.prefix).toBe("");
    expect(anchor.offset).toBe(0);
    expect(anchor.length).toBe(anchor.exact.length);
  });
});
