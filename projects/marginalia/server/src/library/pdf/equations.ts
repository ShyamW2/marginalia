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
//
// Widened again 2026-09-10 (M43 §G2): plain-block Greek (Γ, σ, π, …,
// U+0370–U+03FF) was entirely uncounted — only *styled* Unicode-math-
// alphanumeric Greek (𝛾, in the U+1D400–U+1D7FF plane) fell inside these
// ranges — which understated density on any line using ordinary Greek
// letters, common in display equations that don't happen to run through a
// unicode-math styling pass. Safe to widen because the trailing-number
// requirement below stays the false-positive guard; this only changes the
// density *fraction* on a line that already needs a number to qualify.
const MATH_UNICODE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0370, 0x03ff], // Greek and Coptic (Γ σ π Δ …)
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
// M43 §G2: a real display equation's number sometimes lands on its own
// short trailing line rather than at the end of the equation's own text —
// found live against eqn (38) of the real "Spatiotemporal Composability"
// PDF, where a mis-decoded run of prime/quote glyph fragments preceded the
// number on a line by itself. A line that's essentially just leading
// punctuation/artifact glyphs plus "(NN)" counts as carrying the *previous*
// line's number, not a line of its own.
const RUNT_NUMBER_LINE = /^[^\p{L}\p{N}]*\(\d+\)\s*$/u;

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

/** Whether `line` carries a trailing equation number of its own, or borrows
 *  one from an immediately following runt line (M43 §G2). */
function hasEquationNumber(line: PdfLine, nextLine: PdfLine | undefined): boolean {
  if (TRAILING_EQUATION_NUMBER.test(line.text.trim())) return true;
  return nextLine !== undefined && RUNT_NUMBER_LINE.test(nextLine.text.trim());
}

function isEquationLine(line: PdfLine, nextLine?: PdfLine): boolean {
  const charCount = line.text.replace(/\s/g, "").length;
  if (charCount === 0) return false;
  const density = line.items.length / charCount;
  if (density > ITEM_DENSITY_THRESHOLD && line.fontNames.length >= MIN_DISTINCT_FONTS) return true;

  if (!hasEquationNumber(line, nextLine)) return false;
  return mathGlyphFraction(line.text) > MATH_GLYPH_FRACTION_THRESHOLD;
}

// M43 §G1: a piecewise function's case-row lines (the brace + short case
// expressions) sit at ordinary item density between two genuinely dense
// equation lines — found live, real PDF, a multi-line `match`/`Maybe`
// construct whose crop was truncated to just the dense lines actually
// captured. Tolerate up to this many consecutive non-qualifying lines
// before concluding a band has really ended, the same shape `tables.ts`'s
// `MAX_NONQUALIFYING_RUN` already uses for a table's wrapped column labels.
const PIECEWISE_MAX_GAP_LINES = 3;

// M43 §G1: the raw union of text items' own boxes crops flush to whatever a
// glyph's *reported* box covers — no margin for ascender/descender or
// sub/superscript overshoot a math font's box doesn't fully account for.
// Padding is a fraction of the band's own tallest item, so it scales with
// the equation's font size rather than being a fixed point value.
const VERTICAL_PAD_FRACTION = 0.3;
const HORIZONTAL_PAD_FRACTION = 0.15;

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function paddedBoundingBox(bandLines: PdfLine[], pageWidth: number, pageHeight: number): Box {
  const allItems = bandLines.flatMap((l) => l.items);
  const rawX0 = Math.min(...allItems.map((it) => it.x));
  const rawX1 = Math.max(...allItems.map((it) => it.x + it.width));
  const rawY0 = Math.min(...allItems.map((it) => it.y));
  const rawY1 = Math.max(...allItems.map((it) => it.y + it.height));
  const maxItemHeight = Math.max(...allItems.map((it) => it.height));
  const yPad = maxItemHeight * VERTICAL_PAD_FRACTION;
  const xPad = maxItemHeight * HORIZONTAL_PAD_FRACTION;
  return {
    x0: Math.max(0, rawX0 - xPad),
    x1: Math.min(pageWidth, rawX1 + xPad),
    y0: Math.max(0, rawY0 - yPad),
    y1: Math.min(pageHeight, rawY1 + yPad),
  };
}

export interface EquationBand {
  /** Index range into the lines array, inclusive start, exclusive end. */
  startIndex: number;
  endIndex: number;
  y: number;
  /** Bounding box in PDF user space, for rasterization — padded (§G1) and
   *  clamped to the page. */
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
 *
 * M43 §G widens band *growth* two ways: a short run of ordinary-density
 * lines bounded by equation lines on both sides is absorbed rather than
 * ending the band early (a piecewise function's case rows), and a trailing
 * runt line carrying only the equation's own number is absorbed onto the
 * band that number belongs to.
 */
export function detectEquationBands(lines: PdfLine[], pageWidth: number, pageHeight: number): EquationBand[] {
  const bands: EquationBand[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isEquationLine(lines[i], lines[i + 1])) {
      i++;
      continue;
    }
    const start = i;
    let end = i + 1;
    let lastQualifying = i;
    while (end < lines.length) {
      if (isEquationLine(lines[end], lines[end + 1])) {
        lastQualifying = end;
        end++;
      } else if (end - lastQualifying <= PIECEWISE_MAX_GAP_LINES) {
        end++;
      } else {
        break;
      }
    }
    end = lastQualifying + 1;

    const lastLine = lines[end - 1];
    const runt = lines[end];
    if (runt && !TRAILING_EQUATION_NUMBER.test(lastLine.text.trim()) && RUNT_NUMBER_LINE.test(runt.text.trim())) {
      end++;
    }

    const bandLines = lines.slice(start, end);
    bands.push({
      startIndex: start,
      endIndex: end,
      y: bandLines[0].y,
      ...paddedBoundingBox(bandLines, pageWidth, pageHeight),
    });
    i = end;
  }
  return bands;
}

// M43 §H: a long, math-dense run of lines (a lemma/corollary heavy with
// Greek/math notation) reads as garbled prose in `resource_text` for the
// same reason a display equation does, even with no equation number to
// anchor on and no per-line item-density signature — but a bare density
// threshold with no other gate would also catch ordinary prose that merely
// discusses math (see the ⚠️ above `MATH_UNICODE_RANGES`), so this rule
// requires *both* a stricter density than the number-anchored rule and a
// minimum length, so a single equation-adjacent clause or a wordy paragraph
// that names a variable a couple of times doesn't qualify.
const MATH_BLOCK_MIN_CHARS = 150;
const MATH_BLOCK_DENSITY_THRESHOLD = 0.3;
// Mirrors `lines.ts`'s `paragraphsInSegment` gap-ratio rule for "this is a
// new paragraph, not a wrapped line of the same one" — reused here rather
// than imported so this module doesn't need `lines.ts`'s paragraph-string
// return shape, which discards the line indices this needs.
const PARAGRAPH_GAP_RATIO = 1.4;

export interface MathBlock {
  startIndex: number;
  endIndex: number;
  y: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * PDF.md §3.4 (M43 §H): among the lines *not* already claimed by
 * `detectEquationBands`, a contiguous run (paragraph-bounded, same gap rule
 * as ordinary paragraph splitting) whose combined length clears
 * `MATH_BLOCK_MIN_CHARS` and whose combined math-glyph density clears
 * `MATH_BLOCK_DENSITY_THRESHOLD` is rasterized the same way an equation
 * band is — detect and rasterize, nothing enters `resource_text`. A wordy
 * paragraph that merely names a variable stays text; there's no number to
 * anchor on here, so the higher bar (double the equation rule's 0.15) is
 * this rule's only false-positive guard.
 */
export function detectMathDenseBlocks(
  lines: PdfLine[],
  claimed: ReadonlyArray<{ startIndex: number; endIndex: number }>,
  pageWidth: number,
  pageHeight: number,
): MathBlock[] {
  const isClaimed = (idx: number) => claimed.some((r) => idx >= r.startIndex && idx < r.endIndex);

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const lineSpacingMedian =
    sortedGaps.length === 0
      ? 1
      : sortedGaps.length % 2 === 0
        ? (sortedGaps[sortedGaps.length / 2 - 1] + sortedGaps[sortedGaps.length / 2]) / 2
        : sortedGaps[(sortedGaps.length - 1) / 2];

  const blocks: MathBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isClaimed(i)) {
      i++;
      continue;
    }
    const start = i;
    let end = i + 1;
    while (end < lines.length && !isClaimed(end)) {
      const gap = lines[end - 1].y - lines[end].y;
      if (gap > PARAGRAPH_GAP_RATIO * lineSpacingMedian) break;
      end++;
    }

    const runLines = lines.slice(start, end);
    const combinedText = runLines.map((l) => l.text).join(" ");
    const charCount = combinedText.replace(/\s/g, "").length;
    if (charCount >= MATH_BLOCK_MIN_CHARS && mathGlyphFraction(combinedText) >= MATH_BLOCK_DENSITY_THRESHOLD) {
      blocks.push({
        startIndex: start,
        endIndex: end,
        y: runLines[0].y,
        ...paddedBoundingBox(runLines, pageWidth, pageHeight),
      });
    }
    i = end;
  }
  return blocks;
}
