import type { PdfLine } from "./types.js";

const ITEM_DENSITY_THRESHOLD = 2.5;
const MIN_DISTINCT_FONTS = 3;

// Widened 2026-09-09 (M43 §E, decisions.md that date): the density/fontNames
// check above is tuned for the classic LaTeX/dvips encoding — math as many
// tiny individually-positioned glyph-path fragments spread across several
// subset fonts. A modern `unicode-math`-style toolchain instead typesets
// display equations as ordinary positioned *text* runs of Unicode
// math-alphanumeric codepoints in a single embedded font, which sits at
// density ~1.0 and one font — found live against a real PDF where this left
// `detectEquationBands` with zero bands anywhere in the document (NOTES.md/
// decisions.md "M43 §E1", 2026-09-09).
//
// ⚠️ A pure "fraction of math-only Unicode" signal was tried first and
// discarded — found live, same PDF, same session: this document (formal
// program semantics) writes *inline* math this dense throughout its ordinary
// prose ("1. 𝜋𝑛 ∈ dom(𝐹𝛾) ∪ {𝗋𝗈𝗈𝗍};"), and even single stray subscript
// fragments ("𝑚") read as 100% math. A density-only threshold rasterized 267
// "equation" bands across the paper — mostly inline-math sentences and
// isolated glyphs, exactly what §3.4's "inline math is out of scope" already
// forbids touching. The one signal specific enough to mean "this line is a
// numbered display equation, not prose that happens to use math notation" is
// the equation's own right-aligned number: real display equations in this
// document (and conventionally, in general) end their line in "(16)",
// "(24)", … — an inline-math-heavy prose sentence does not.
const MATH_UNICODE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1d400, 0x1d7ff], // Mathematical Alphanumeric Symbols (𝑔 𝛾 𝜑 𝖬𝖺𝗒𝖻𝖾 …)
  [0x2100, 0x214f], // Letterlike Symbols (ℑ ℝ ℕ ℤ ℂ ℓ …)
  [0x2190, 0x21ff], // Arrows (→ ⇀ ⇒ …)
  [0x2200, 0x22ff], // Mathematical Operators (∈ ∀ ∃ ≔ ⊧ ⊭ ∘ …)
  [0x27c0, 0x27ef], // Miscellaneous Mathematical Symbols-A
  [0x2980, 0x29ff], // Miscellaneous Mathematical Symbols-B
  [0x2a00, 0x2aff], // Supplemental Mathematical Operators
];
// Only load-bearing alongside the trailing equation number below — see the
// ⚠️ above for why a bare fraction threshold isn't used on its own.
const MATH_GLYPH_FRACTION_THRESHOLD = 0.15;
const TRAILING_EQUATION_NUMBER = /\(\d+\)\s*$/;

function isMathCodepoint(codepoint: number): boolean {
  return MATH_UNICODE_RANGES.some(([lo, hi]) => codepoint >= lo && codepoint <= hi);
}

/** Fraction of `text`'s non-space *codepoints* (not UTF-16 units — the
 *  math-alphanumeric plane is outside the BMP and would otherwise count
 *  each character twice) that fall in `MATH_UNICODE_RANGES`. */
function mathGlyphFraction(text: string): number {
  const chars = Array.from(text.replace(/\s/g, ""));
  if (chars.length === 0) return 0;
  const mathChars = chars.filter((ch) => isMathCodepoint(ch.codePointAt(0)!));
  return mathChars.length / chars.length;
}

function isEquationLine(line: PdfLine): boolean {
  const charCount = line.text.replace(/\s/g, "").length;
  if (charCount === 0) return false;
  const density = line.items.length / charCount;
  if (density > ITEM_DENSITY_THRESHOLD && line.fontNames.length >= MIN_DISTINCT_FONTS) return true;

  if (!TRAILING_EQUATION_NUMBER.test(line.text.trim())) return false;
  return mathGlyphFraction(line.text) > MATH_GLYPH_FRACTION_THRESHOLD;
}

export interface EquationBand {
  /** Index range into the lines array, inclusive start, exclusive end. */
  startIndex: number;
  endIndex: number;
  y: number;
  /** Bounding box in PDF user space, for rasterization. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * PDF.md §3.4: a run of lines whose item-count-per-character exceeds ~2.5
 * and whose items span 3+ distinct fontNames is an equation band — or,
 * widened 2026-09-09 (M43 §E), whose text is dense with math-only Unicode
 * codepoints (`isEquationLine` above). Either way: detect and rasterize,
 * never reconstruct as text.
 */
export function detectEquationBands(lines: PdfLine[]): EquationBand[] {
  const bands: EquationBand[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isEquationLine(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    let end = i + 1;
    while (end < lines.length && isEquationLine(lines[end])) end++;

    const bandLines = lines.slice(start, end);
    const allItems = bandLines.flatMap((l) => l.items);
    bands.push({
      startIndex: start,
      endIndex: end,
      y: bandLines[0].y,
      x0: Math.min(...allItems.map((it) => it.x)),
      x1: Math.max(...allItems.map((it) => it.x + it.width)),
      y0: Math.min(...allItems.map((it) => it.y)),
      y1: Math.max(...allItems.map((it) => it.y + it.height)),
    });
    i = end;
  }
  return bands;
}
