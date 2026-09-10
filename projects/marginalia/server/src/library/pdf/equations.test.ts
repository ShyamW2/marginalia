import { describe, expect, it } from "vitest";
import { detectEquationBands, detectMathDenseBlocks } from "./equations.js";
import { groupLines } from "./lines.js";
import type { PdfLine, RawTextItem } from "./types.js";

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

function glyph(text: string, x: number, y: number, fontName: string, height = 8): RawTextItem {
  return { text, x, y, width: 4, height, fontName };
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

/** A single ordinary prose line — one item, one font, low density. */
function proseLine(y: number, text: string, x = 40): PdfLine {
  return groupLines([{ text, x, y, width: text.length * 6, height: 10, fontName: "Body" }])[0];
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

    const bands = detectEquationBands([eqLine1, eqLine2], PAGE_WIDTH, PAGE_HEIGHT);

    expect(bands).toHaveLength(1);
    expect(bands[0].startIndex).toBe(0);
    expect(bands[0].endIndex).toBe(2);
  });

  it("does not flag an ordinary prose line as an equation", () => {
    const line = proseLine(500, "This is an ordinary sentence of prose.");
    expect(detectEquationBands([line], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });

  // M43 §E1/§E (NOTES.md/decisions.md 2026-09-09): a real PDF typesets math
  // as Unicode math-alphanumeric text in one embedded font (density ~1.0,
  // one font) rather than the classic fragmented-glyph encoding above — the
  // four lines below are that document's own repro'd equation lines.
  // Built directly (bypassing `groupLines`' word-gap heuristic) so `text`
  // matches the real repro'd string verbatim, one item per character — the
  // same "items=N chars=N" shape NOTES.md's repro printed.
  function unicodeMathLine(y: number, text: string, fontName = "g_d0_f6"): PdfLine {
    const items: RawTextItem[] = Array.from(text).map((ch, i) => glyph(ch, 40 + i * 6, y, fontName));
    return { items, text, y, leftEdge: 40, fontSize: 8, fontNames: [fontName] };
  }

  it("detects a Unicode math-alphanumeric equation line (single font, density ~1.0)", () => {
    const line = unicodeMathLine(500, "𝑔′(Δ) = (𝛾, 𝜑 ∘ 𝑔 ∘ 𝑓) (16)");
    const bands = detectEquationBands([line], PAGE_WIDTH, PAGE_HEIGHT);
    expect(bands).toHaveLength(1);
  });

  it("detects a multi-line Unicode math-alphanumeric run as one band", () => {
    const line1 = unicodeMathLine(500, "ℑ∗ ≔ 𝜇ℑ. (𝑒 : Γ → Γ × (Γ → Γ) × 𝖬𝖺𝗒𝖻𝖾(ℑ)) (17)");
    const line2 = unicodeMathLine(486, "Σ ≔ (𝑘 : 𝐾) ⇀ 𝒱 𝑘 (20)");
    const bands = detectEquationBands([line1, line2], PAGE_WIDTH, PAGE_HEIGHT);
    expect(bands).toHaveLength(1);
    expect(bands[0].startIndex).toBe(0);
    expect(bands[0].endIndex).toBe(2);
  });

  it("detects a math-heavy line that mixes in named-relation English, given a trailing equation number", () => {
    const line = unicodeMathLine(500, "notify (𝜎, 𝜎′) ≔ deactivating if 𝜎 ⊧ 𝑑 ∧ 𝜎′ ⊭ 𝑑 (24)");
    expect(detectEquationBands([line], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(1);
  });

  it("does not flag prose that names a variable once, with no equation number", () => {
    const line = unicodeMathLine(500, "Let 𝑥 denote the input to the function under discussion here.");
    expect(detectEquationBands([line], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });

  it("does not flag an ordinary numbered list item as an equation", () => {
    const line = unicodeMathLine(500, "The classifier improved accuracy substantially (24)");
    expect(detectEquationBands([line], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
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

    expect(detectEquationBands([denseLine], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });

  // M43 §G1: the crop shouldn't be flush with the tightest item box — real
  // ascender/descender/sub-superscript overshoot needs margin.
  describe("bounding-box padding (M43 §G1)", () => {
    it("pads the crop rect beyond the raw item union, clamped to the page", () => {
      const line = unicodeMathLine(500, "𝑔′(Δ) = (𝛾, 𝜑 ∘ 𝑔 ∘ 𝑓) (16)");
      const [band] = detectEquationBands([line], PAGE_WIDTH, PAGE_HEIGHT);

      const rawX0 = Math.min(...line.items.map((it) => it.x));
      const rawX1 = Math.max(...line.items.map((it) => it.x + it.width));
      const rawY0 = Math.min(...line.items.map((it) => it.y));
      const rawY1 = Math.max(...line.items.map((it) => it.y + it.height));

      expect(band.x0).toBeLessThan(rawX0);
      expect(band.x1).toBeGreaterThan(rawX1);
      expect(band.y0).toBeLessThan(rawY0);
      expect(band.y1).toBeGreaterThan(rawY1);
    });

    it("clamps padding to the page bounds rather than going negative or past the edge", () => {
      // Placed hard against the top-left corner of the page.
      const line = unicodeMathLine(796, "𝑔′(Δ) = (𝛾, 𝜑) (1)");
      const tight: PdfLine = { ...line, items: line.items.map((it) => ({ ...it, x: it.x - 38 })) };
      const [band] = detectEquationBands([tight], PAGE_WIDTH, PAGE_HEIGHT);

      expect(band.x0).toBeGreaterThanOrEqual(0);
      expect(band.y1).toBeLessThanOrEqual(PAGE_HEIGHT);
    });
  });

  // M43 §G1: a piecewise function's case-row lines sit at ordinary density
  // between two dense equation lines — the band must absorb them rather
  // than truncating at the first one that breaks the run.
  it("widens a band across ordinary-density lines bounded by equation lines on both sides", () => {
    // The top line qualifies via the classic dense/multi-font rule (no
    // number needed) — a piecewise function's opening line is commonly
    // typeset this way even when the rest of the document uses unicode-math
    // text; the case rows below it are ordinary-density prose, and the
    // closing line carries the whole construct's number.
    const top = equationLine(500, [
      { text: "f", font: "MathItalic" },
      { text: "(", font: "MathSymbol" },
      { text: "x", font: "MathItalic" },
      { text: ")", font: "MathSymbol" },
      { text: "≔", font: "MathSuperscript" },
    ]);
    const case1 = proseLine(486, "{ 1 if x > 0");
    const case2 = proseLine(472, "0 if x ≤ 0 }");
    const bottom = unicodeMathLine(458, "𝑔(𝑥) ≔ 𝑓(𝑥) + 1 (30)");

    const bands = detectEquationBands([top, case1, case2, bottom], PAGE_WIDTH, PAGE_HEIGHT);

    expect(bands).toHaveLength(1);
    expect(bands[0].startIndex).toBe(0);
    expect(bands[0].endIndex).toBe(4);
  });

  it("does not absorb an unrelated paragraph beyond the gap-tolerance window", () => {
    const top = unicodeMathLine(500, "𝑓(𝑥) ≔ 𝑥 (31)");
    const paragraph = [
      proseLine(486, "This paragraph has nothing to do with the equation above it."),
      proseLine(472, "It continues for several ordinary lines of plain prose."),
      proseLine(458, "Still going, well past the piecewise-gap tolerance window."),
      proseLine(444, "And a fourth line, to be sure it's really over."),
      proseLine(430, "And a fifth."),
    ];

    const bands = detectEquationBands([top, ...paragraph], PAGE_WIDTH, PAGE_HEIGHT);

    expect(bands).toHaveLength(1);
    expect(bands[0].startIndex).toBe(0);
    expect(bands[0].endIndex).toBe(1);
  });

  // M43 §G2: the equation's own number sometimes lands on a short trailing
  // line by itself, separate from the equation's text.
  describe("runt trailing-number line (M43 §G2)", () => {
    it("absorbs a runt number-only line following a math-dense line with no number of its own", () => {
      const body = unicodeMathLine(500, "reach(𝑖) ≔ ⋂{𝑆 | 𝑖 ∈ 𝑆 ∧ ∀𝑖′ ∈ 𝑆, 𝛾 ∈ Γ}");
      const runt = proseLine(486, "′′′′ (38)");

      const bands = detectEquationBands([body, runt], PAGE_WIDTH, PAGE_HEIGHT);

      expect(bands).toHaveLength(1);
      expect(bands[0].startIndex).toBe(0);
      expect(bands[0].endIndex).toBe(2);
    });

    it("does not absorb a genuine unrelated numbered line that isn't a runt artifact", () => {
      const body = unicodeMathLine(500, "Let 𝑥 denote the input to the function under discussion.");
      const nextLine = proseLine(486, "See item 3 in the list below (38) for details.");

      expect(detectEquationBands([body, nextLine], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
    });
  });

  // M43 §G2: plain-block Greek (Γ, σ, …) previously didn't count toward
  // math-glyph density at all.
  it("counts plain-block Greek letters toward math-glyph density", () => {
    const line = unicodeMathLine(500, "Γ ≔ σ × τ × Δ × Γ (39)");
    expect(detectEquationBands([line], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(1);
  });
});

describe("detectMathDenseBlocks (M43 §H)", () => {
  function greekHeavyLine(y: number, text: string): PdfLine {
    return groupLines([{ text, x: 40, y, width: text.length * 6, height: 10, fontName: "Body" }])[0];
  }

  it("captures a long, math-dense paragraph with no equation number as a block", () => {
    const lines = [
      greekHeavyLine(500, "Γ ⊢ σ : τ. Δ ⊢ Φ ∘ Ψ ⊧ Ω. Γ × Σ ⇀ Σ. Φ ∈ Δ ∧ Ψ ∈ Ω."),
      greekHeavyLine(486, "Γ ⊢ σ : τ ⇒ Δ ⊧ Φ. Σ ⊆ Γ × Δ. Ω ∈ Σ ⇀ Φ. Γ, σ, τ, Δ, Φ, Ψ, Ω ∈ Σ."),
      greekHeavyLine(472, "Γ ⊢ σ : τ. Δ ⊢ Φ ∘ Ψ ⊧ Ω. Γ × Σ ⇀ Σ. Φ ∈ Δ ∧ Ψ ∈ Ω. Γ ⊢ σ : τ ⇒ Δ ⊧ Φ. Ψ ⊧ Ω ⇒ Γ ⊢ σ."),
      greekHeavyLine(458, "Δ ∘ Φ ∈ Ψ. Σ ⇀ Γ × Δ. Ω ⊆ Σ ∧ Φ ∈ Γ. Γ ⊢ σ : τ ⇒ Δ ⊧ Φ ∘ Ψ. Ω ∈ Σ ⇀ Φ ∧ Γ ⊢ σ."),
    ];

    const blocks = detectMathDenseBlocks(lines, [], PAGE_WIDTH, PAGE_HEIGHT);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].startIndex).toBe(0);
    expect(blocks[0].endIndex).toBe(4);
  });

  it("leaves a wordy paragraph that only names a variable or two as text", () => {
    const lines = [
      greekHeavyLine(500, "This paragraph mostly discusses the design in plain English prose,"),
      greekHeavyLine(486, "occasionally naming the variable Γ or the constant σ in passing, but"),
      greekHeavyLine(472, "otherwise reads as an ordinary explanatory passage a reader would want."),
    ];

    expect(detectMathDenseBlocks(lines, [], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });

  it("does not flag a short math-dense line that never reaches the char-count floor", () => {
    const lines = [greekHeavyLine(500, "Γ ⊢ σ : τ, Δ ⊧ Φ.")];
    expect(detectMathDenseBlocks(lines, [], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });

  it("skips lines already claimed by an equation band", () => {
    const lines = [
      greekHeavyLine(500, "Γ ⊢ σ : τ. Δ ⊢ Φ ∘ Ψ ⊧ Ω. Γ × Σ ⇀ Σ. Φ ∈ Δ ∧ Ψ ∈ Ω."),
      greekHeavyLine(486, "Γ ⊢ σ : τ ⇒ Δ ⊧ Φ. Σ ⊆ Γ × Δ. Ω ∈ Σ ⇀ Φ. Γ, σ, τ, Δ, Φ, Ψ, Ω ∈ Σ."),
      greekHeavyLine(472, "Γ ⊢ σ : τ. Δ ⊢ Φ ∘ Ψ ⊧ Ω. Γ × Σ ⇀ Σ. Φ ∈ Δ ∧ Ψ ∈ Ω. Γ ⊢ σ : τ ⇒ Δ ⊧ Φ. Ψ ⊧ Ω ⇒ Γ ⊢ σ."),
      greekHeavyLine(458, "Δ ∘ Φ ∈ Ψ. Σ ⇀ Γ × Δ. Ω ⊆ Σ ∧ Φ ∈ Γ. Γ ⊢ σ : τ ⇒ Δ ⊧ Φ ∘ Ψ. Ω ∈ Σ ⇀ Φ ∧ Γ ⊢ σ."),
    ];

    const blocks = detectMathDenseBlocks(lines, [{ startIndex: 0, endIndex: 4 }], PAGE_WIDTH, PAGE_HEIGHT);

    expect(blocks).toHaveLength(0);
  });
});
