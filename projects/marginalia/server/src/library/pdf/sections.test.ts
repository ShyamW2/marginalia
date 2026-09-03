import { describe, expect, it } from "vitest";
import { buildSections } from "./sections.js";
import type { PdfLine, PdfOutlineEntry, PdfPageContent } from "./types.js";

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
      { title: "Chapter One", pageIndex: 1, y: 760 },
      { title: "Chapter Two", pageIndex: 2, y: 760 },
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
    const outline: PdfOutlineEntry[] = [{ title: "Chapter Two", pageIndex: 0, y: 400 }];

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
    const outline: PdfOutlineEntry[] = [{ title: "Chapter One", pageIndex: 1, y: 760 }];

    const sections = buildSections(pages, outline);

    expect(sections).toHaveLength(2);
    expect(sections[0].text).toContain("Half-title page");
  });
});
