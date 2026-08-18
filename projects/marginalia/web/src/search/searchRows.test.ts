import { describe, expect, it } from "vitest";
import type { SearchHit } from "@marginalia/shared";
import {
  buildSearchResultRows,
  buildSectionSpans,
  chapterPageForHit,
  formatHitPage,
  snippetWindow,
} from "./searchRows.js";

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    source: "text",
    spineIndex: 2,
    offset: 100,
    percent: 0.25,
    snippet: "…and the rain fell on the roof, and the sound of it filled the house…",
    anchor: { prefix: "on the ", exact: "roof", suffix: ", and" },
    highlightId: null,
    ...overrides,
  };
}

describe("snippetWindow", () => {
  it("keeps five words either side of the match", () => {
    const window = snippetWindow(
      "one two three four five six SEVEN eight nine ten eleven twelve thirteen",
      "SEVEN",
    );
    expect(window.before).toBe("… two three four five six ");
    expect(window.match).toBe("SEVEN");
    expect(window.after).toBe(" eight nine ten eleven twelve …");
  });

  it("does not invent a space between the match and adjacent punctuation", () => {
    const window = snippetWindow("and the rain fell on the roof, and the sound", "roof");
    expect(window.match).toBe("roof");
    expect(window.after).toBe(", and the sound");
    expect(window.before.endsWith("the ")).toBe(true);
  });

  it("marks the occurrence nearest the middle — the one the server centred on", () => {
    const window = snippetWindow("the cat sat on the mat by the door", "the");
    // Three occurrences; the middle one ("the mat") is the hit's own.
    expect(window.before).toBe("the cat sat on ");
    expect(window.after).toBe(" mat by the door");
  });

  it("drops the server's own ellipses rather than doubling them", () => {
    const window = snippetWindow("…six seven eight NINE ten…", "NINE");
    expect(window.before).toBe("six seven eight ");
    expect(window.after).toBe(" ten");
  });

  it("shows the opening words when the query isn't in the snippet", () => {
    const window = snippetWindow("a note the reader wrote about something else", "gregor");
    expect(window.match).toBe("");
    expect(window.before).toBe("");
    expect(window.after).toBe("a note the reader wrote about something else");
  });

  it("truncates a matchless snippet too", () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    const window = snippetWindow(long, "absent");
    expect(window.after.endsWith(" …")).toBe(true);
    expect(window.after.split(/\s+/).filter((w) => w !== "…")).toHaveLength(10);
  });
});

describe("buildSectionSpans", () => {
  it("accumulates the weights in spine order", () => {
    const spans = buildSectionSpans(
      new Map([
        [2, 0.5],
        [0, 0.2],
        [1, 0.3],
      ]),
    );
    expect(spans.get(0)).toEqual({ start: 0, weight: 0.2 });
    expect(spans.get(1)).toEqual({ start: 0.2, weight: 0.3 });
    expect(spans.get(2)?.weight).toBe(0.5);
    expect(spans.get(2)?.start).toBeCloseTo(0.5, 10);
  });

  it("has no span for a section the weights don't cover", () => {
    expect(buildSectionSpans(new Map([[0, 1]])).get(7)).toBeUndefined();
  });
});

describe("chapterPageForHit", () => {
  const span = { start: 0.2, weight: 0.1 };

  it("maps the fraction of the section before the hit onto its pages", () => {
    expect(chapterPageForHit(0.2, span, 10)).toBe(1);
    expect(chapterPageForHit(0.25, span, 10)).toBe(6);
    expect(chapterPageForHit(0.299, span, 10)).toBe(10);
  });

  it("never runs past the last page of the section", () => {
    expect(chapterPageForHit(0.3, span, 10)).toBe(10);
    expect(chapterPageForHit(0.9, span, 10)).toBe(10);
  });

  it("has no answer until the page map has one", () => {
    expect(chapterPageForHit(0.25, span, null)).toBeNull();
    expect(chapterPageForHit(0.25, null, 10)).toBeNull();
    expect(chapterPageForHit(0.25, { start: 0.2, weight: 0 }, 10)).toBeNull();
  });
});

describe("formatHitPage", () => {
  it("follows the setting", () => {
    expect(formatHitPage("book", 128, 6)).toBe("p. 128");
    expect(formatHitPage("chapter", 128, 6)).toBe("p. 6");
    expect(formatHitPage("off", 128, 6)).toBeNull();
  });

  it("shows nothing rather than the wrong number when the chosen one is missing", () => {
    expect(formatHitPage("book", null, 6)).toBeNull();
    expect(formatHitPage("chapter", 128, null)).toBeNull();
  });
});

describe("buildSearchResultRows", () => {
  const context = {
    query: "roof",
    pageNumberMode: "book" as const,
    chapterLabelFor: (spineIndex: number) => `Chapter ${spineIndex}`,
    pagesInSection: () => 20,
    bookPageFor: (_spineIndex: number, chapterPage: number) => 300 + chapterPage,
    sectionSpan: () => ({ start: 0.2, weight: 0.2 }),
  };

  it("numbers rows by their place in the result set, not by their place in the list", () => {
    const rows = buildSearchResultRows([hit(), hit({ percent: 0.3 })], context);
    expect(rows.map((row) => row.index)).toEqual([0, 1]);
  });

  it("carries chapter, page and percent", () => {
    const [row] = buildSearchResultRows([hit()], context);
    expect(row.chapter).toBe("Chapter 2");
    expect(row.page).toBe("p. 306");
    expect(row.percent).toBe("25%");
    expect(row.match).toBe("roof");
    expect(row.source).toBe("Book text");
  });

  it("labels an annotation hit by where it was found", () => {
    const [row] = buildSearchResultRows(
      [hit({ source: "thread", highlightId: "h1", snippet: "why is the roof always described?" })],
      context,
    );
    expect(row.source).toBe("Your thread");
    expect(row.match).toBe("roof");
  });
});
