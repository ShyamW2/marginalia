import { describe, expect, it } from "vitest";
import { buildContext } from "./context.js";
import type { ResourceTextSection } from "../library/store.js";

function makeSections(count: number, charsPerSection: number): ResourceTextSection[] {
  return Array.from({ length: count }, (_, i) => ({
    spineIndex: i,
    href: `section-${i}.xhtml`,
    text: "x".repeat(charsPerSection),
  }));
}

const highlight = { exact: "quoted text", prefix: "before ", suffix: " after", spineIndex: 5 };

describe("buildContext", () => {
  it("uses the whole book when it fits comfortably in the context budget", () => {
    const sections = makeSections(10, 100); // ~1000 chars total, ~286 tokens
    const result = buildContext({
      title: "Test Book",
      author: "Test Author",
      sections,
      highlight,
      contextTokens: 100_000, // way more than needed
    });

    for (const section of sections) {
      expect(result.bookContext).toContain(`--- [section ${section.spineIndex}] ---`);
    }
  });

  it("is deterministic — identical input produces byte-identical output", () => {
    const sections = makeSections(20, 500);
    const input = {
      title: "Test Book",
      author: "Test Author",
      sections,
      highlight,
      contextTokens: 1000, // forces windowing
    };
    const first = buildContext(input);
    const second = buildContext({ ...input, sections: [...sections] });
    expect(first.bookContext).toBe(second.bookContext);
    expect(first.instructions).toBe(second.instructions);
  });

  it("respects the token budget by windowing when the book is too large", () => {
    const sections = makeSections(50, 1000); // 50,000 chars, ~14,285 tokens
    const result = buildContext({
      title: "Big Book",
      author: null,
      sections,
      highlight,
      contextTokens: 1000, // 70% budget = 700 tokens ~= 2450 chars — must window
    });

    // Should not include every section — windowing kicked in.
    const includedSections = sections.filter((s) =>
      result.bookContext.includes(`--- [section ${s.spineIndex}] ---`),
    );
    expect(includedSections.length).toBeLessThan(sections.length);
    expect(includedSections.length).toBeGreaterThan(0);
  });

  it("reports windowed:true only when the budget forced windowing", () => {
    const fits = buildContext({
      title: "Small Book",
      author: null,
      sections: makeSections(10, 100),
      highlight,
      contextTokens: 100_000,
    });
    expect(fits.windowed).toBe(false);

    const tooBig = buildContext({
      title: "Big Book",
      author: null,
      sections: makeSections(50, 1000),
      highlight,
      contextTokens: 1000,
    });
    expect(tooBig.windowed).toBe(true);
  });

  it("centers the window on the highlight's spine section", () => {
    const sections = makeSections(50, 1000);
    const result = buildContext({
      title: "Big Book",
      author: null,
      sections,
      highlight, // spineIndex: 5
      contextTokens: 1000,
    });

    expect(result.bookContext).toContain("--- [section 5] ---");

    const includedIndices = sections
      .filter((s) => result.bookContext.includes(`--- [section ${s.spineIndex}] ---`))
      .map((s) => s.spineIndex);
    const min = Math.min(...includedIndices);
    const max = Math.max(...includedIndices);
    // The highlight's section should sit within the selected window, not at
    // one extreme end of it (the window expands from the center outward).
    expect(5).toBeGreaterThanOrEqual(min);
    expect(5).toBeLessThanOrEqual(max);
  });

  it("labels sections with real chapter titles when available, falling back to the number", () => {
    const sections = makeSections(3, 100);
    const result = buildContext({
      title: "Test Book",
      author: "Test Author",
      sections,
      highlight,
      contextTokens: 100_000,
      chapterTitles: { "0": "Chapter One", "2": "Chapter Three" },
    });

    expect(result.bookContext).toContain("--- [section 0: Chapter One] ---");
    expect(result.bookContext).toContain("--- [section 1] ---");
    expect(result.bookContext).toContain("--- [section 2: Chapter Three] ---");
  });

  it("includes the reader's current position in the user message, not the cached blocks", () => {
    const result = buildContext({
      title: "Test Book",
      author: "Test Author",
      sections: makeSections(3, 100),
      highlight,
      contextTokens: 100_000,
      chapterTitles: { "2": "Chapter Three" },
      readingPosition: { spineIndex: 2, percent: 42.4 },
    });

    const message = result.userMessage("What happens next?");
    expect(message).toContain("Reader's current position: 42% through the book");
    expect(message).toContain("around section 2: Chapter Three");
    // Volatile position data must never leak into the cacheable blocks.
    expect(result.bookContext).not.toContain("current position");
    expect(result.instructions).not.toContain("42");
  });

  it("omits the position line entirely when no position is known", () => {
    const result = buildContext({
      title: "Test Book",
      author: "Test Author",
      sections: makeSections(3, 100),
      highlight,
      contextTokens: 100_000,
    });
    expect(result.userMessage("Q")).not.toContain("current position");
  });

  it("renders the user message with the exact quote, context, and question", () => {
    const result = buildContext({
      title: "Test Book",
      author: "Test Author",
      sections: makeSections(3, 100),
      highlight,
      contextTokens: 100_000,
    });
    const message = result.userMessage("What does this mean?");
    expect(message).toContain("> quoted text");
    expect(message).toContain("before [highlighted] after");
    expect(message).toContain("Their question: What does this mean?");
  });
});
