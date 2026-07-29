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
});

describe("chapterStartAnchor", () => {
  it("anchors at the chapter's own opening text, never empty", () => {
    const anchor = chapterStartAnchor("The chapter begins here and continues for a while.");
    expect(anchor.exact.length).toBeGreaterThan(0);
    expect(anchor.prefix).toBe("");
  });
});
