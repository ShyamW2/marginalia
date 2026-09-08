import { describe, expect, it } from "vitest";
import { buildSections, buildSectionsWithPageIndex, firstMeaningfulSectionTitle } from "./sections.js";
import type { PdfBlock, PdfLine, PdfOutlineEntry, PdfPageContent } from "./types.js";

function line(text: string, y: number, fontSize = 10): PdfLine {
  return {
    items: [{ text, x: 50, y, width: text.length * 6, height: fontSize, fontName: "F1" }],
    text,
    y,
    leftEdge: 50,
    fontSize,
    fontNames: ["F1"],
  };
}

function page(pageIndex: number, lines: PdfLine[], width = 600, height = 800): PdfPageContent {
  return { pageIndex, width, height, blocks: lines.map((l) => ({ kind: "line" as const, line: l })) };
}

describe("buildSections", () => {
  it("uses the outline when present, and stops there", () => {
    const pages: PdfPageContent[] = [
      page(0, [line("Front matter.", 700)]),
      page(1, [line("Chapter One", 750, 16), line("Body of chapter one.", 700)]),
      page(2, [line("Chapter Two", 750, 16), line("Body of chapter two.", 700)]),
    ];
    const outline: PdfOutlineEntry[] = [
      { title: "Chapter One", pageIndex: 1, y: 760, depth: 1 },
      { title: "Chapter Two", pageIndex: 2, y: 760, depth: 1 },
    ];

    const sections = buildSections(pages, outline);

    expect(sections.map((s) => s.title)).toEqual(["Section 1", "Chapter One", "Chapter Two"]);
    expect(sections[0].text).toContain("Front matter");
    expect(sections[1].text).toContain("Body of chapter one");
    expect(sections[2].text).toContain("Body of chapter two");
    sections.forEach((s, i) => {
      expect(s.spineIndex).toBe(i);
      expect(s.href).toBe(`section-${String(i).padStart(3, "0")}.xhtml`);
    });
  });

  it("splits a page at the heading's own position rather than rounding to the page boundary", () => {
    // The outline resolves to y=400, partway down a page whose first line
    // is well above that (y=700) — the split must happen at the heading
    // line, not include everything from the top of the page.
    const pages: PdfPageContent[] = [
      page(0, [
        line("End of the previous chapter.", 700),
        line("still previous chapter text", 680),
        line("Chapter Two", 400, 16),
        line("Body of chapter two starts here.", 380),
      ]),
    ];
    const outline: PdfOutlineEntry[] = [{ title: "Chapter Two", pageIndex: 0, y: 400, depth: 1 }];

    const sections = buildSections(pages, outline);

    expect(sections).toHaveLength(2);
    expect(sections[0].text).toContain("End of the previous chapter");
    expect(sections[0].text).not.toContain("Chapter Two");
    expect(sections[1].text).toContain("Body of chapter two starts here");
    expect(sections[1].text).not.toContain("previous chapter");
  });

  it("falls back to detected headings when there is no outline", () => {
    // Several body-sized lines per heading, so the body size is the clear
    // majority (mode) rather than tying with the heading size 1:1.
    const pages: PdfPageContent[] = [
      page(0, [
        line("Introduction", 750, 18), // 18 vs body 10 -> well over 1.15x
        line("This paper studies something interesting.", 700),
        line("It continues for another line here.", 686),
        line("And a third line of body text.", 672),
        line("Method", 500, 18),
        line("We used a method.", 470),
        line("The method had several steps.", 456),
        line("Each step is described below.", 442),
      ]),
    ];

    const sections = buildSections(pages, []);

    expect(sections.map((s) => s.title)).toEqual(["Introduction", "Method"]);
    expect(sections[0].text).toContain("This paper studies something interesting");
    expect(sections[1].text).toContain("We used a method");
  });

  it("does not treat body-sized text as a heading just because it is short", () => {
    const pages: PdfPageContent[] = [page(0, [line("Yes.", 700, 10), line("No.", 686, 10)])];

    const sections = buildSections(pages, []);

    // No outline, no real headings (both lines are body-sized) -> single section.
    expect(sections).toHaveLength(1);
  });

  it("collapses a whole document under 40 pages into one section when there is no outline and no headings", () => {
    const pages: PdfPageContent[] = Array.from({ length: 12 }, (_, i) =>
      page(i, [line(`Page ${i} paragraph text goes here.`, 700)]),
    );

    const sections = buildSections(pages, []);

    expect(sections).toHaveLength(1);
    expect(sections[0].text).toContain("Page 0 paragraph");
    expect(sections[0].text).toContain("Page 11 paragraph");
  });

  it("falls back to fixed 10-page groups at 40+ pages with no outline and no headings", () => {
    const pages: PdfPageContent[] = Array.from({ length: 45 }, (_, i) =>
      page(i, [line(`Page ${i} body text.`, 700)]),
    );

    const sections = buildSections(pages, []);

    expect(sections).toHaveLength(5); // 0-9, 10-19, 20-29, 30-39, 40-44
    expect(sections[0].title).toBe("Pages 1–10");
    expect(sections[4].title).toBe("Pages 41–45");
    expect(sections[0].text).toContain("Page 0 body");
    expect(sections[0].text).toContain("Page 9 body");
    expect(sections[1].text).toContain("Page 10 body");
  });

  it("never drops leading content that comes before the first outline entry", () => {
    const pages: PdfPageContent[] = [
      page(0, [line("Half-title page.", 700)]),
      page(1, [line("Chapter One", 750, 16), line("Real content.", 700)]),
    ];
    const outline: PdfOutlineEntry[] = [{ title: "Chapter One", pageIndex: 1, y: 760, depth: 1 }];

    const sections = buildSections(pages, outline);

    expect(sections).toHaveLength(2);
    expect(sections[0].text).toContain("Half-title page");
  });
});

// M41 §A2 (PDF.md §4/§7.5): "highlights are shared between reflow and
// native" needs a page->section table built from the same boundaries as the
// spine itself, so the two can never disagree about where a section starts.
describe("buildSectionsWithPageIndex", () => {
  it("assigns every page to the section active at its own top", () => {
    const pages: PdfPageContent[] = [
      page(0, [line("Front matter.", 700)]),
      page(1, [line("Chapter One", 750, 16), line("Body of chapter one.", 700)]),
      page(2, [line("Still chapter one.", 700)]),
      page(3, [line("Chapter Two", 750, 16), line("Body of chapter two.", 700)]),
    ];
    const outline: PdfOutlineEntry[] = [
      { title: "Chapter One", pageIndex: 1, y: 760, depth: 1 },
      { title: "Chapter Two", pageIndex: 3, y: 760, depth: 1 },
    ];

    const { sections, pageSectionIndex } = buildSectionsWithPageIndex(pages, outline);

    expect(sections.map((s) => s.title)).toEqual(["Section 1", "Chapter One", "Chapter Two"]);
    expect(pageSectionIndex).toEqual([0, 1, 1, 2]);
  });

  it("assigns a page split by a mid-page heading to the section active at its top, honestly", () => {
    // Page 0 straddles the Chapter Two boundary (heading at y=400, partway
    // down) — PDF.md §4's own "outline destinations are page-anchored" trap.
    // The page is assigned to the *earlier* section (the one active at the
    // page's top), not the later one the heading introduces.
    const pages: PdfPageContent[] = [
      page(0, [
        line("End of the previous chapter.", 700),
        line("Chapter Two", 400, 16),
        line("Body of chapter two starts here.", 380),
      ]),
      page(1, [line("More of chapter two.", 700)]),
    ];
    const outline: PdfOutlineEntry[] = [{ title: "Chapter Two", pageIndex: 0, y: 400, depth: 1 }];

    const { pageSectionIndex } = buildSectionsWithPageIndex(pages, outline);

    expect(pageSectionIndex).toEqual([0, 1]);
  });

  it("matches buildSections's own spine exactly (a thin wrapper, not a second implementation)", () => {
    const pages: PdfPageContent[] = Array.from({ length: 12 }, (_, i) =>
      page(i, [line(`Page ${i} paragraph text goes here.`, 700)]),
    );

    expect(buildSectionsWithPageIndex(pages, []).sections).toEqual(buildSections(pages, []));
  });
});

// M42 §A1 (PDF.md §4 amended, NOTES.md "M39 — the real gate, finally", root
// cause 1): a page set entirely in a legitimately larger body size than the
// document's global modal must not have every one of its lines misread as
// heading-qualifying and swallowed into one run-on title.
describe("detectHeadingBoundaries — page-local body size and run cap (M42 §A1)", () => {
  it("judges a page's headings against its own modal size, not the document's", () => {
    const proseLines = Array.from({ length: 6 }, (_, i) => line(`Ordinary 9pt prose line ${i}.`, 700 - i * 14, 9));
    const listPage = [
      line("1. KNOWLEDGE AND SKILL BASE", 760, 18),
      ...Array.from({ length: 6 }, (_, i) => line(`1.${i + 1}. A competency element line here.`, 700 - i * 14, 12)),
    ];
    const pages: PdfPageContent[] = [page(0, proseLines), page(1, listPage)];

    const sections = buildSections(pages, []);

    // Only the single 18pt line starts a new section — the six 12pt lines,
    // judged against page 1's own local modal (12), never individually
    // clear the heading threshold and stay ordinary body text.
    expect(sections).toHaveLength(2);
    expect(sections[1].title).toBe("1. KNOWLEDGE AND SKILL BASE");
    for (let i = 1; i <= 6; i++) {
      expect(sections[1].text).toContain(`1.${i}. A competency element line here.`);
    }
  });

  it("caps a coalesced heading run at a few lines rather than absorbing an unbounded number", () => {
    const titleLines = Array.from({ length: 5 }, (_, i) => line(`Title Part ${i + 1}`, 780 - i * 20, 16));
    const bodyLines = Array.from({ length: 7 }, (_, i) => line(`Ordinary 10pt body line ${i}.`, 660 - i * 14, 10));
    const pages: PdfPageContent[] = [page(0, [...titleLines, ...bodyLines])];

    const sections = buildSections(pages, []);

    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("Title Part 1 Title Part 2 Title Part 3");
    expect(sections[1].title).toBe("Title Part 4 Title Part 5");
  });
});

// M42 §A2 (PDF.md §4, NOTES.md "M39 — the real gate, finally", root cause
// 2): outline destinations that collide on the exact same (page, y) — a
// real LaTeX/hyperref quirk — must be disambiguated, never silently dropped.
describe("resolveOutlineBoundaries — colliding destinations (M42 §A2)", () => {
  it("recovers all four distinct sections when their destinations collide on one y", () => {
    const pages: PdfPageContent[] = [
      page(0, [
        line("1. Introduction", 500),
        line("Some intro text.", 480),
        line("1.1 Dimensions of Composability", 460),
        line("Discussion of dimensions.", 440),
        line("1.2 Motivating Examples", 420),
        line("Discussion of examples.", 400),
        line("1.2.1 Plugin Systems", 380),
        line("code and can be removed freely.", 360),
      ]),
    ];
    // All four outline entries resolve to the same page and the same y —
    // the exact collision confirmed live on a real paper's hyperref output.
    const outline: PdfOutlineEntry[] = [
      { title: "1. Introduction", pageIndex: 0, y: 500, depth: 1 },
      { title: "1.1 Dimensions of Composability", pageIndex: 0, y: 500, depth: 1 },
      { title: "1.2 Motivating Examples", pageIndex: 0, y: 500, depth: 1 },
      { title: "1.2.1 Plugin Systems", pageIndex: 0, y: 500, depth: 1 },
    ];

    const sections = buildSections(pages, outline);

    expect(sections.map((s) => s.title)).toEqual([
      "1. Introduction",
      "1.1 Dimensions of Composability",
      "1.2 Motivating Examples",
      "1.2.1 Plugin Systems",
    ]);
    expect(sections[0].text).toContain("Some intro text.");
    expect(sections[0].text).not.toContain("Discussion of dimensions");
    expect(sections[1].text).toContain("Discussion of dimensions.");
    expect(sections[2].text).toContain("Discussion of examples.");
    expect(sections[3].text).toContain("code and can be removed freely.");
  });

  // M42 §A2, revised (NOTES.md "M42 — outline y unreliable across a whole
  // document"): every entry in a real 64-entry outline shared one y that
  // matched none of their true positions — not a collision between a few
  // neighbours, an isolated entry with no collision partner was just as
  // wrong. A single stray, non-colliding heading whose y is nowhere near
  // its own true position must still resolve via text search, not be
  // trusted just because nothing else happened to land on the same spot.
  it("re-resolves an isolated (non-colliding) heading via text search when its y doesn't match its own position", () => {
    const pages: PdfPageContent[] = [
      page(0, [
        line("1. Introduction", 700),
        line("Real introduction body text starts here.", 680),
        line("2. Background", 500),
        line("Real background body text starts here.", 480),
      ]),
    ];
    // Both destinations share one meaningless y near the bottom of the
    // page — resolving to the last line via the old y<=target rule would
    // land on "Real background body text starts here." for both, even
    // though they don't collide with each other (they'd resolve to the
    // same wrong spot, not to each other's real heading).
    const outline: PdfOutlineEntry[] = [
      { title: "1. Introduction", pageIndex: 0, y: 10, depth: 1 },
      { title: "2. Background", pageIndex: 0, y: 10, depth: 1 },
    ];

    const sections = buildSections(pages, outline);

    expect(sections.map((s) => s.title)).toEqual(["1. Introduction", "2. Background"]);
    expect(sections[0].text).toContain("Real introduction body text starts here.");
    expect(sections[0].text).not.toContain("2. Background");
    expect(sections[1].text).toContain("Real background body text starts here.");
  });
});

// M42 §B3: a figure/table caption must never be misread as a heading of its
// own, even when its font size clears the threshold.
describe("detectHeadingBoundaries — captions are never headings (M42 §B3)", () => {
  it("skips a line adjacent to a figure/table raster block", () => {
    const captionLine = line("Table 1 Results by condition.", 700, 14);
    const blocks: PdfBlock[] = [
      { kind: "line", line: line("Ordinary prose above.", 750, 9) },
      { kind: "line", line: captionLine },
      { kind: "table", image: null, caption: captionLine.text, y: 600, page: 0 },
      { kind: "line", line: line("Ordinary prose below.", 500, 9) },
    ];
    const pages: PdfPageContent[] = [{ pageIndex: 0, width: 600, height: 800, blocks }];

    const sections = buildSections(pages, []);

    // No heading detected anywhere -> falls all the way to "one section".
    expect(sections).toHaveLength(1);
    expect(sections[0].text).toContain("Table 1 Results by condition.");
  });
});

// M42 §A3: the title fallback chain's last real-content rung.
describe("firstMeaningfulSectionTitle", () => {
  it("returns the first section's title when it's a real heading", () => {
    const pages: PdfPageContent[] = [
      page(0, [
        line("Real Chapter Title", 750, 16),
        line("This is the first line of real body text.", 700),
        line("This is the second line of real body text.", 686),
        line("This is the third line of real body text.", 672),
      ]),
    ];
    const sections = buildSections(pages, []);

    expect(firstMeaningfulSectionTitle(sections)).toBe("Real Chapter Title");
  });

  it("returns null for a synthesized placeholder title (no real heading found)", () => {
    const pages: PdfPageContent[] = [page(0, [line("Just some prose.", 700)])];
    const sections = buildSections(pages, []);

    expect(sections[0].title).toBe("Section 1");
    expect(firstMeaningfulSectionTitle(sections)).toBeNull();
  });

  it("returns null for a fixed page-group placeholder title", () => {
    const pages: PdfPageContent[] = Array.from({ length: 45 }, (_, i) =>
      page(i, [line(`Page ${i} body text.`, 700)]),
    );
    const sections = buildSections(pages, []);

    expect(sections[0].title).toBe("Pages 1–10");
    expect(firstMeaningfulSectionTitle(sections)).toBeNull();
  });
});

// M42 §C1/§C3 (PDF.md §4 amended): a detected section is a depth-1
// heading's span, not every heading-qualifying line's span — a depth-2+
// heading stays inline in its parent chapter as a `PdfSubheading` instead
// of fragmenting the spine.
describe("heading hierarchy — depth-1 spine, depth-2+ inline subheadings (M42 §C)", () => {
  it("threads outline depth through: only depth-1 entries start a section, depth-2+ become subheadings", () => {
    const pages: PdfPageContent[] = [
      page(0, [
        line("1. Introduction", 750, 16),
        line("Intro body text here.", 700),
        line("1.1 Background", 650, 14),
        line("Background body text here.", 600),
        line("2. Method", 550, 16),
        line("Method body text here.", 500),
      ]),
    ];
    const outline: PdfOutlineEntry[] = [
      { title: "1. Introduction", pageIndex: 0, y: 760, depth: 1 },
      { title: "1.1 Background", pageIndex: 0, y: 660, depth: 2 },
      { title: "2. Method", pageIndex: 0, y: 560, depth: 1 },
    ];

    const sections = buildSections(pages, outline);

    // The spine collapses to the two real chapters, not three flat entries.
    expect(sections.map((s) => s.title)).toEqual(["1. Introduction", "2. Method"]);
    expect(sections[0].text).toContain("Background body text here.");

    expect(sections[0].subheadings).toHaveLength(1);
    const sub = sections[0].subheadings[0];
    expect(sub.title).toBe("1.1 Background");
    expect(sub.depth).toBe(2);
    // The offset genuinely lands on the subheading's own line in this
    // section's canonical text, not merely somewhere in its vicinity.
    expect(sections[0].text.slice(sub.offset).startsWith("1.1 Background")).toBe(true);

    expect(sections[1].subheadings).toEqual([]);
  });

  it("derives depth from the heading text's own numbering when there is no outline (rung 2)", () => {
    const pages: PdfPageContent[] = [
      page(0, [
        line("1. Introduction", 750, 18),
        line("First body line of the introduction section here.", 700),
        line("Second body line of the introduction section here.", 686),
        line("1.1 Background", 650, 16),
        line("First body line of the background subsection here.", 620),
        line("Second body line of the background subsection here.", 606),
        line("2. Method", 550, 18),
        line("First body line of the method section here.", 520),
        line("Second body line of the method section here.", 506),
      ]),
    ];

    const sections = buildSections(pages, []);

    expect(sections.map((s) => s.title)).toEqual(["1. Introduction", "2. Method"]);
    expect(sections[0].subheadings).toEqual([
      expect.objectContaining({ title: "1.1 Background", depth: 2 }),
    ]);
    const sub = sections[0].subheadings[0];
    expect(sections[0].text.slice(sub.offset).startsWith("1.1 Background")).toBe(true);
    expect(sections[1].subheadings).toEqual([]);
  });

  it("keeps multiple nested subheadings in document order with their own depths", () => {
    const pages: PdfPageContent[] = [
      page(0, [
        line("1. Introduction", 750, 16),
        line("Intro body text here.", 700),
        line("1.1 Background", 650, 14),
        line("Background body text here.", 600),
        line("1.2 Related Work", 570, 14),
        line("Related work body text here.", 540),
        line("1.2.1 Prior Systems", 510, 13),
        line("Prior systems body text here.", 480),
      ]),
    ];
    const outline: PdfOutlineEntry[] = [
      { title: "1. Introduction", pageIndex: 0, y: 760, depth: 1 },
      { title: "1.1 Background", pageIndex: 0, y: 660, depth: 2 },
      { title: "1.2 Related Work", pageIndex: 0, y: 580, depth: 2 },
      { title: "1.2.1 Prior Systems", pageIndex: 0, y: 520, depth: 3 },
    ];

    const sections = buildSections(pages, outline);

    expect(sections).toHaveLength(1);
    expect(sections[0].subheadings.map((s) => [s.title, s.depth])).toEqual([
      ["1.1 Background", 2],
      ["1.2 Related Work", 2],
      ["1.2.1 Prior Systems", 3],
    ]);
    // Strictly increasing — each later subheading's own line sits further
    // into the section's text than the one before it.
    const offsets = sections[0].subheadings.map((s) => s.offset);
    expect(offsets[1]).toBeGreaterThan(offsets[0]);
    expect(offsets[2]).toBeGreaterThan(offsets[1]);
  });

  it("falls through to the next rung when an outline has zero depth-1 boundaries", () => {
    // A malformed/degenerate outline — every entry nested at depth 2+,
    // "a document whose entire outline sits at depth 2+ under one nominal
    // root" (PDF.md §4 ⚠️) — must not collapse the real document into a
    // spine with no chapters at all.
    const pages: PdfPageContent[] = [
      page(0, [line("Ordinary paragraph text, nothing heading-shaped here at all.", 700)]),
    ];
    const outline: PdfOutlineEntry[] = [
      { title: "1.1 A", pageIndex: 0, y: 700, depth: 2 },
      { title: "1.2 B", pageIndex: 0, y: 650, depth: 2 },
    ];

    const sections = buildSections(pages, outline);

    // Falls all the way through to the "one section under 40 pages" rung,
    // as if the malformed outline had never been present.
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Section 1");
  });
});
