import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { generateReflowEpub } from "./generateEpub.js";
import { extractEpub } from "../epub.js";
import { buildSections } from "./sections.js";
import type { PdfLine, PdfPageContent } from "./types.js";

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

function page(pageIndex: number, lines: PdfLine[]): PdfPageContent {
  return {
    pageIndex,
    width: 600,
    height: 800,
    blocks: lines.map((l) => ({ kind: "line" as const, line: l })),
  };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("generateReflowEpub", () => {
  const pages: PdfPageContent[] = [
    page(0, [
      line("Chapter One", 750, 16),
      line("The first paragraph of chapter one, with enough words to read as real prose.", 700),
    ]),
    page(1, [
      line("Chapter Two", 750, 16),
      line("The first paragraph of chapter two, continuing on from the previous chapter.", 700),
    ]),
  ];
  const outline = [
    { title: "Chapter One", pageIndex: 0, y: 760, depth: 1 },
    { title: "Chapter Two", pageIndex: 1, y: 760, depth: 1 },
  ];
  const sections = buildSections(pages, outline);

  it("round-trips through extractEpub with the same section count and the same text", () => {
    const generated = generateReflowEpub({ title: "A Test Book", author: "A. Author", sections });

    const parsed = extractEpub(generated.buffer);

    expect(parsed.title).toBe("A Test Book");
    expect(parsed.author).toBe("A. Author");
    // section-000.xhtml, section-001.xhtml are the whole spine — no extra
    // nav/ncx entries leak into it.
    expect(parsed.spine).toHaveLength(sections.length);

    parsed.spine.forEach((item, i) => {
      // extractEpub resolves hrefs relative to the OPF's own directory.
      expect(item.href).toBe(`OEBPS/${sections[i].href}`);
      expect(normalize(item.text)).toContain(normalize(sections[i].text));
    });
  });

  it("populates metadata.chapterTitles by the same NCX route extractChapterTitles uses", () => {
    const generated = generateReflowEpub({ title: "A Test Book", author: null, sections });

    const parsed = extractEpub(generated.buffer);

    expect(parsed.metadata.chapterTitles).toEqual({ "0": "Chapter One", "1": "Chapter Two" });
    expect(generated.chapterTitles).toEqual({ "0": "Chapter One", "1": "Chapter Two" });
  });

  it("is byte-reproducible for the same sections", () => {
    const a = generateReflowEpub({ title: "A Test Book", author: "A. Author", sections });
    const b = generateReflowEpub({ title: "A Test Book", author: "A. Author", sections });

    expect(a.buffer.equals(b.buffer)).toBe(true);
  });

  it("emits a real EPUB 3 nav document with one entry per section", () => {
    const generated = generateReflowEpub({ title: "A Test Book", author: null, sections });
    const zip = new AdmZip(generated.buffer);

    const nav = zip.getEntry("OEBPS/nav.xhtml")?.getData().toString("utf-8");
    expect(nav).toBeTruthy();
    expect(nav).toContain('epub:type="toc"');
    sections.forEach((s) => {
      expect(nav).toContain(`href="${s.href}"`);
      expect(nav).toContain(s.title);
    });
  });

  it("embeds a figure image and keeps its caption in the section text", async () => {
    const pagesWithFigure: PdfPageContent[] = [
      {
        pageIndex: 0,
        width: 600,
        height: 800,
        blocks: [
          { kind: "line", line: line("Intro paragraph text right here.", 700) },
          { kind: "figure", image: Buffer.from("fake-png-bytes"), caption: "Figure 1. A diagram.", y: 400, page: 0 },
          { kind: "line", line: line("Figure 1. A diagram.", 420) },
        ],
      },
    ];
    const oneSection = buildSections(pagesWithFigure, []);
    const generated = generateReflowEpub({ title: "Figures", author: null, sections: oneSection });
    const zip = new AdmZip(generated.buffer);

    const imageEntry = zip.getEntry("OEBPS/images/fig-p0-0.png");
    expect(imageEntry?.getData().toString("utf-8")).toBe("fake-png-bytes");

    const parsed = extractEpub(generated.buffer);
    expect(parsed.spine[0].text).toContain("Figure 1. A diagram.");
  });

  // M42 §C4: a depth-2+ subheading is independently reachable from the
  // chapter picker via an in-section anchor, not a spine index.
  describe("subheadings (M42 §C4)", () => {
    const pagesWithSub: PdfPageContent[] = [
      page(0, [
        line("1. Introduction", 750, 16),
        line("Intro body text here.", 700),
        line("1.1 Background", 650, 14),
        line("Background body text here.", 600),
      ]),
    ];
    const subOutline = [
      { title: "1. Introduction", pageIndex: 0, y: 760, depth: 1 },
      { title: "1.1 Background", pageIndex: 0, y: 660, depth: 2 },
    ];
    const subSections = buildSections(pagesWithSub, subOutline);

    it("gives the subheading's own paragraph a matching loc- id", () => {
      const generated = generateReflowEpub({ title: "Sub Test", author: null, sections: subSections });
      const zip = new AdmZip(generated.buffer);
      const sectionXml = zip.getEntry(`OEBPS/${subSections[0].href}`)?.getData().toString("utf-8");

      const offset = subSections[0].subheadings[0].offset;
      expect(sectionXml).toContain(`<p id="loc-${offset}">1.1 Background</p>`);
    });

    // Found live against a real paper (NOTES.md "M42 — subheading offsets"):
    // a blank line's normalized text is "", and "" is a prefix of every
    // string — an unguarded `startsWith` check let the *first* blank line
    // anywhere in the section (long before the real heading) consume the
    // subheading and attach its id to nothing meaningful.
    it("skips a blank line rather than letting it satisfy the subheading match first", () => {
      const pagesWithBlank: PdfPageContent[] = [
        page(0, [
          line("1. Introduction", 750, 16),
          line("Intro body text here.", 700),
          line("", 680), // a blank line, same shape found live
          line("1.1 Background", 650, 14),
          line("Background body text here.", 600),
        ]),
      ];
      const blankOutline = [
        { title: "1. Introduction", pageIndex: 0, y: 760, depth: 1 },
        { title: "1.1 Background", pageIndex: 0, y: 660, depth: 2 },
      ];
      const blankSections = buildSections(pagesWithBlank, blankOutline);
      const generated = generateReflowEpub({ title: "Blank Test", author: null, sections: blankSections });
      const zip = new AdmZip(generated.buffer);
      const sectionXml = zip.getEntry(`OEBPS/${blankSections[0].href}`)?.getData().toString("utf-8");

      const offset = blankSections[0].subheadings[0].offset;
      expect(sectionXml).toContain(`<p id="loc-${offset}">1.1 Background</p>`);
    });

    it("nests the subheading under its section in both nav.xhtml and toc.ncx", () => {
      const generated = generateReflowEpub({ title: "Sub Test", author: null, sections: subSections });
      const zip = new AdmZip(generated.buffer);
      const offset = subSections[0].subheadings[0].offset;
      const fragmentHref = `${subSections[0].href}#loc-${offset}`;

      const nav = zip.getEntry("OEBPS/nav.xhtml")?.getData().toString("utf-8");
      expect(nav).toContain(`<ol><li><a href="${fragmentHref}">1.1 Background</a></li></ol>`);

      const ncx = zip.getEntry("OEBPS/toc.ncx")?.getData().toString("utf-8");
      expect(ncx).toContain(`<content src="${fragmentHref}"/>`);
    });

    it("does not let the subheading's title leak into metadata.chapterTitles", () => {
      const generated = generateReflowEpub({ title: "Sub Test", author: null, sections: subSections });
      const parsed = extractEpub(generated.buffer);

      expect(parsed.metadata.chapterTitles).toEqual({ "0": "1. Introduction" });
      expect(generated.chapterTitles).toEqual({ "0": "1. Introduction" });
    });
  });
});
