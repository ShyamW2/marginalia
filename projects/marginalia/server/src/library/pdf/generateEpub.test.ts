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
    { title: "Chapter One", pageIndex: 0, y: 760 },
    { title: "Chapter Two", pageIndex: 1, y: 760 },
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
});
