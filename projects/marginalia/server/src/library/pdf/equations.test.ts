import { describe, expect, it } from "vitest";
import { detectEquationBands } from "./equations.js";
import { groupLines } from "./lines.js";
import type { RawTextItem } from "./types.js";

function glyph(text: string, x: number, y: number, fontName: string): RawTextItem {
  return { text, x, y, width: 4, height: 8, fontName };
}

/** A dense equation-shaped line: a few visible glyphs across several fonts,
 *  interleaved with invisible spacing/positioning items (empty strings —
 *  common in real pdf.js text content for accents and kerning), so
 *  items-per-character comfortably clears the >2.5 threshold. */
function equationLine(y: number, visible: { text: string; font: string }[]) {
  const items: RawTextItem[] = [];
  let x = 40;
  const fonts = ["MathSymbol", "MathItalic"];
  for (const v of visible) {
    items.push(glyph("", x, y, fonts[items.length % fonts.length]));
    x += 4;
    items.push(glyph(v.text, x, y, v.font));
    x += 6;
    items.push(glyph("", x, y, fonts[items.length % fonts.length]));
    x += 4;
  }
  return groupLines(items)[0];
}

describe("detectEquationBands", () => {
  it("detects a run of dense, multi-font lines as one equation band", () => {
    const eqLine1 = equationLine(500, [
      { text: "E", font: "MathItalic" },
      { text: "=", font: "MathSymbol" },
      { text: "m", font: "MathItalic" },
      { text: "c", font: "MathItalic" },
      { text: "2", font: "MathSuperscript" },
    ]);
    const eqLine2 = equationLine(486, [
      { text: "x", font: "MathItalic" },
      { text: "∈", font: "MathSymbol" },
      { text: "ℝ", font: "MathBlackboard" },
    ]);

    const bands = detectEquationBands([eqLine1, eqLine2]);

    expect(bands).toHaveLength(1);
    expect(bands[0].startIndex).toBe(0);
    expect(bands[0].endIndex).toBe(2);
  });

  it("does not flag an ordinary prose line as an equation", () => {
    const proseLine = groupLines([
      { text: "This is an ordinary sentence of prose.", x: 40, y: 500, width: 220, height: 10, fontName: "Body" },
    ])[0];

    expect(detectEquationBands([proseLine])).toHaveLength(0);
  });

  it("requires 3+ distinct fonts, not just high item density", () => {
    // Just as dense as the equation lines above (items-per-character > 2.5,
    // via the same invisible-spacer pattern) but entirely one font — must
    // not be mistaken for an equation.
    const items: RawTextItem[] = [];
    let x = 40;
    for (const ch of ["1", "2", "3", "4"]) {
      items.push(glyph("", x, 500, "Mono"));
      x += 4;
      items.push(glyph(ch, x, 500, "Mono"));
      x += 6;
      items.push(glyph("", x, 500, "Mono"));
      x += 4;
    }
    const denseLine = groupLines(items)[0];

    expect(detectEquationBands([denseLine])).toHaveLength(0);
  });
});
