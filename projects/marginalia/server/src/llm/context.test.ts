import { describe, expect, it } from "vitest";
import { buildContext, buildDigestContext, buildOffContext, sectionRangeUiLabel, sectionUiLabel } from "./context.js";
import type { ResourceTextSection } from "../library/store.js";
import type { ContextBlock } from "./provider.js";

/** M34 §A: bookContext is now a list of blocks — tests read it joined,
 * same as every non-Anthropic provider does. */
function contextText(blocks: ContextBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

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
      expect(contextText(result.bookContext)).toContain(`--- [section ${section.spineIndex}] ---`);
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
    expect(contextText(first.bookContext)).toBe(contextText(second.bookContext));
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
      contextText(result.bookContext).includes(`--- [section ${s.spineIndex}] ---`),
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

    expect(contextText(result.bookContext)).toContain("--- [section 5] ---");

    const includedIndices = sections
      .filter((s) => contextText(result.bookContext).includes(`--- [section ${s.spineIndex}] ---`))
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

    expect(contextText(result.bookContext)).toContain("--- [section 0: Chapter One] ---");
    expect(contextText(result.bookContext)).toContain("--- [section 1] ---");
    expect(contextText(result.bookContext)).toContain("--- [section 2: Chapter Three] ---");
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
    expect(contextText(result.bookContext)).not.toContain("current position");
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

describe("buildOffContext", () => {
  it("sends only the highlight's section and its immediate neighbors", () => {
    const sections = makeSections(10, 500);
    const result = buildOffContext({
      title: "Test Book",
      author: null,
      sections,
      highlight,
    });
    expect(contextText(result.bookContext)).toContain("--- [section 5] ---");
    expect(contextText(result.bookContext)).toContain("--- [section 4] ---");
    expect(contextText(result.bookContext)).toContain("--- [section 6] ---");
    expect(contextText(result.bookContext)).not.toContain("--- [section 0] ---");
    expect(contextText(result.bookContext)).not.toContain("--- [section 9] ---");
    expect(result.chaptersUsed).toEqual([]);
    expect(result.highlightChapterCovered).toBe(false);
    // M34 §A: tiny and re-centered on every highlight — never worth a cache
    // breakpoint.
    expect(result.bookContext.every((b) => !b.cache)).toBe(true);
  });
});

describe("buildContext caching (M34 §A5)", () => {
  it("marks the single block for caching when the book fits whole", () => {
    const result = buildContext({
      title: "Test Book",
      author: null,
      sections: makeSections(10, 100),
      highlight,
      contextTokens: 100_000,
    });
    expect(result.windowed).toBe(false);
    expect(result.bookContext).toHaveLength(1);
    expect(result.bookContext[0].cache).toBe(true);
  });

  it("leaves the block unmarked when windowing fired — it will never be read back", () => {
    const result = buildContext({
      title: "Big Book",
      author: null,
      sections: makeSections(50, 1000),
      highlight,
      contextTokens: 1000,
    });
    expect(result.windowed).toBe(true);
    expect(result.bookContext).toHaveLength(1);
    expect(result.bookContext[0].cache).toBe(false);
  });
});

describe("buildDigestContext", () => {
  it("is far smaller than the whole book — includes chapter summaries, not full text, outside the neighborhood", () => {
    const sections = makeSections(50, 2000);
    const chapterDigests = sections.map((s) => ({
      spineIndex: s.spineIndex,
      summary: `Summary of chapter ${s.spineIndex}.`,
      themes: ["theme"],
      characters: ["Someone"],
    }));

    const digestResult = buildDigestContext({
      title: "Big Book",
      author: "Author",
      sections,
      highlight,
      bookDigest: { synopsis: "A long book.", cast: [{ name: "Alice", description: "hero" }], themes: ["hope"] },
      chapterDigests,
    });
    const fullResult = buildContext({
      title: "Big Book",
      author: "Author",
      sections,
      highlight,
      contextTokens: 1_000_000, // large enough that Full sends everything
    });

    expect(contextText(digestResult.bookContext).length).toBeLessThan(contextText(fullResult.bookContext).length);
    // A far chapter contributes its summary, never its full text.
    expect(contextText(digestResult.bookContext)).toContain("Summary of chapter 40.");
    expect(contextText(digestResult.bookContext)).not.toContain("--- [section 40 — full text] ---");
    // Only the highlight's own neighborhood gets full text.
    expect(contextText(digestResult.bookContext)).toContain("--- [section 5 — full text] ---");
    expect(digestResult.chaptersUsed).toHaveLength(50);
    expect(digestResult.highlightChapterCovered).toBe(true);
    // M34 §A4: stable material (digest + summaries + thematic) cached first,
    // the highlight-varying pages unmarked and last.
    expect(digestResult.bookContext).toHaveLength(2);
    expect(digestResult.bookContext[0].cache).toBe(true);
    expect(digestResult.bookContext[0].text).toContain("CHAPTER SUMMARIES");
    expect(digestResult.bookContext[1].cache).toBe(false);
    expect(digestResult.bookContext[1].text).toContain("FULL TEXT AROUND THE HIGHLIGHT");
  });

  it("reports the highlight's chapter as uncovered when it has no digest row", () => {
    const sections = makeSections(3, 100);
    const result = buildDigestContext({
      title: "Test Book",
      author: null,
      sections,
      highlight: { ...highlight, spineIndex: 1 },
      bookDigest: null,
      chapterDigests: [{ spineIndex: 0, summary: "s", themes: [], characters: [] }],
    });
    expect(result.highlightChapterCovered).toBe(false);
    expect(contextText(result.bookContext)).toContain("No book-level digest available yet.");
  });

  it("includes the thematic layer alongside the plot digest when provided, and omits the section when absent", () => {
    const sections = makeSections(3, 100);
    const chapterDigests = [{ spineIndex: 0, summary: "s", themes: [], characters: [] }];

    const withThematic = buildDigestContext({
      title: "Test Book",
      author: null,
      sections,
      highlight,
      bookDigest: null,
      chapterDigests,
      thematicChapters: [{ spineIndex: 0, analysis: "This chapter is about autonomy.", themes: ["autonomy"] }],
    });
    expect(contextText(withThematic.bookContext)).toContain("THEMATIC READING");
    expect(contextText(withThematic.bookContext)).toContain("This chapter is about autonomy.");
    // M34 §D: the thematic chapters actually included are reported
    // separately from chaptersUsed's plot-digest chapters.
    expect(withThematic.thematicChaptersUsed).toEqual([0]);

    const withoutThematic = buildDigestContext({
      title: "Test Book",
      author: null,
      sections,
      highlight,
      bookDigest: null,
      chapterDigests,
    });
    expect(contextText(withoutThematic.bookContext)).not.toContain("THEMATIC READING");
    expect(withoutThematic.thematicChaptersUsed).toEqual([]);
  });
});

describe("sectionUiLabel", () => {
  it("numbers by ordinal position in `sections`, not by spineIndex, and includes the title when known", () => {
    const sections = makeSections(3, 10); // spineIndex 0, 1, 2
    expect(sectionUiLabel(sections, 0, undefined)).toBe("S1");
    expect(sectionUiLabel(sections, 2, { "2": "The Storm" })).toBe("S3 · The Storm");
  });

  it("never prints spineIndex — a gap in spine indices doesn't shift the ordinal", () => {
    const sections = [
      { spineIndex: 4, href: "a", text: "x" },
      { spineIndex: 9, href: "b", text: "x" },
    ];
    expect(sectionUiLabel(sections, 9, { "9": "The Trial" })).toBe("S2 · The Trial");
  });
});

describe("sectionRangeUiLabel", () => {
  it("joins two distinct endpoints with an arrow", () => {
    const sections = makeSections(6, 10);
    expect(sectionRangeUiLabel(sections, 3, 4, { "3": "The Trial", "4": "The Verdict" })).toBe(
      "S4 · The Trial → S5 · The Verdict",
    );
  });

  it("collapses to one label when start and end are the same section", () => {
    const sections = makeSections(6, 10);
    expect(sectionRangeUiLabel(sections, 2, 2, { "2": "The Trial" })).toBe("S3 · The Trial");
  });
});
