import { describe, expect, it } from "vitest";
import { buildPageBlocks } from "./blocks.js";
import { blocksToText } from "./lines.js";
import { groupLines } from "./lines.js";
import type { RawTextItem } from "./types.js";

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

function item(text: string, x: number, y: number, opts: Partial<RawTextItem> = {}): RawTextItem {
  return { text, x, y, width: text.length * 6, height: 10, fontName: "F1", ...opts };
}

function equationItems(y: number): RawTextItem[] {
  const items: RawTextItem[] = [];
  let x = 40;
  const fonts = ["MathItalic", "MathSymbol", "MathSuperscript"];
  for (const ch of ["E", "=", "m", "c", "2"]) {
    items.push({ text: "", x, y, width: 4, height: 8, fontName: fonts[items.length % 3] });
    x += 4;
    items.push({ text: ch, x, y, width: 4, height: 8, fontName: fonts[items.length % 3] });
    x += 6;
    items.push({ text: "", x, y, width: 4, height: 8, fontName: fonts[items.length % 3] });
    x += 4;
  }
  return items;
}

describe("buildPageBlocks", () => {
  it("replaces an equation band's lines with one equation block, contributing no text", () => {
    const lines = groupLines([
      ...[item("Before the equation.", 40, 700)],
      ...equationItems(680),
      ...[item("After the equation.", 40, 660)],
    ]);

    const blocks = buildPageBlocks(lines, PAGE_WIDTH, PAGE_HEIGHT, [null], []);

    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toEqual(["line", "equation", "line"]);
    expect(blocksToText(blocks)).not.toMatch(/E.*=.*m.*c.*2/);
    expect(blocksToText(blocks)).toContain("Before the equation.");
    expect(blocksToText(blocks)).toContain("After the equation.");
  });

  it("keeps a figure's caption as a line block and inserts the figure block beside it", () => {
    const lines = groupLines([
      item("Preceding paragraph text runs here.", 40, 700),
      item("Figure 1. The pipeline.", 40, 300),
      item("Following paragraph text runs here.", 40, 280),
    ]);
    const image = Buffer.from("fake-png");

    const blocks = buildPageBlocks(lines, PAGE_WIDTH, PAGE_HEIGHT, [], [image]);

    const kinds = blocks.map((b) => b.kind);
    // figure sits "above" its caption line, per figures.test.ts's equivalent case.
    expect(kinds).toEqual(["line", "figure", "line", "line"]);
    const figureBlock = blocks.find((b) => b.kind === "figure");
    expect(figureBlock?.kind).toBe("figure");
    if (figureBlock?.kind === "figure") {
      expect(figureBlock.image).toBe(image);
      expect(figureBlock.caption).toBe("Figure 1. The pipeline.");
    }
    expect(blocksToText(blocks)).toContain("Figure 1. The pipeline.");
  });

  it("produces only line blocks, in order, for a page with no equations or figures", () => {
    const lines = groupLines([item("Just one line.", 40, 700)]);

    const blocks = buildPageBlocks(lines, PAGE_WIDTH, PAGE_HEIGHT, [], []);

    expect(blocks).toEqual([{ kind: "line", line: lines[0] }]);
  });
});
