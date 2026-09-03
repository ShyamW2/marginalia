import { describe, expect, it } from "vitest";
import { groupLines, linesToText } from "./lines.js";
import type { RawTextItem } from "./types.js";

function item(text: string, x: number, y: number, opts: Partial<RawTextItem> = {}): RawTextItem {
  return { text, x, y, width: text.length * 6, height: 10, fontName: "F1", ...opts };
}

describe("groupLines", () => {
  it("groups items whose y differs by less than half the median line height into one line", () => {
    const items = [item("Hello", 40, 700), item("world", 90, 701)];

    const lines = groupLines(items);

    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("Hello world");
  });

  it("starts a new line when y differs by more than half the median line height", () => {
    const items = [item("First", 40, 700), item("Second", 40, 686)];

    const lines = groupLines(items);

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.text)).toEqual(["First", "Second"]);
  });

  it("joins kerned runs (a small gap under 0.15× font size) with no space", () => {
    const a = item("Wo", 40, 700, { width: 12, height: 10 });
    const b = item("rd", 52.5, 700, { width: 12, height: 10 }); // gap 0.5 < 1.5 (0.15*10)

    const lines = groupLines([a, b]);

    expect(lines[0].text).toBe("Word");
  });
});

describe("linesToText", () => {
  it("de-hyphenates a line break before a lowercase continuation", () => {
    // A soft line-wrap hyphen — the original word is "information", split
    // by layout, not a real compound — so the hyphen is a page artifact
    // and joining removes it.
    const lines = groupLines([
      item("This carries a lot of informa-", 40, 700),
      item("tion about the signal.", 40, 686),
    ]);

    const text = linesToText(lines);

    expect(text).toContain("information about the signal");
    expect(text).not.toContain("informa-tion");
  });

  it("never de-hyphenates before a capital or a digit", () => {
    const capitalCase = groupLines([item("See the GPT-", 40, 700), item("Turing machine result.", 40, 686)]);
    const digitCase = groupLines([item("the model is GPT-", 40, 700), item("4 in this paper.", 40, 686)]);

    const capitalText = linesToText(capitalCase);
    const digitText = linesToText(digitCase);

    expect(capitalText).toContain("GPT-");
    expect(capitalText).not.toMatch(/GPT-t/i);
    expect(digitText).toContain("GPT-");
    expect(digitText).not.toContain("GPT-4in"); // never silently glued together
  });

  it("starts a new paragraph on a vertical gap over 1.4x the median line spacing", () => {
    const lines = groupLines([
      item("Paragraph one, line one.", 40, 760),
      item("Paragraph one, line two.", 40, 746),
      // normal line spacing so far is 14; a 40pt gap should break.
      item("Paragraph two starts here.", 40, 706),
    ]);

    const text = linesToText(lines);

    expect(text.split("\n\n")).toHaveLength(2);
    expect(text).toContain("Paragraph one, line one. Paragraph one, line two.");
    expect(text).toContain("Paragraph two starts here.");
  });

  it("starts a new paragraph on an indented line (~1em past the modal left edge)", () => {
    const lines = groupLines([
      item("Regular line at the margin.", 40, 760),
      item("Another regular line.", 40, 746),
      item("Indented new paragraph.", 60, 732, { height: 12 }),
    ]);

    const text = linesToText(lines);

    expect(text.split("\n\n")).toHaveLength(2);
  });

  it("treats a backward y-jump (a column boundary) as a paragraph break", () => {
    const lines = groupLines([
      item("End of column one.", 40, 500),
      item("Top of column two.", 320, 700),
    ]);

    const text = linesToText(lines);

    expect(text.split("\n\n")).toEqual(["End of column one.", "Top of column two."]);
  });
});
