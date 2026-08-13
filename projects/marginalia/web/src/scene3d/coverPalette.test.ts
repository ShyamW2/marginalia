import { describe, expect, it } from "vitest";
import { fallbackPalette, inkFor, relativeLuminance, spinePaletteFromPixels } from "./coverPalette.js";

/** Build RGBA pixel data from a list of `[count, r, g, b]` runs. */
function pixels(...runs: [number, number, number, number][]): Uint8ClampedArray {
  const total = runs.reduce((sum, [count]) => sum + count, 0);
  const data = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [count, r, g, b] of runs) {
    for (let n = 0; n < count; n += 1) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
      i += 4;
    }
  }
  return data;
}

function hue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

describe("spinePaletteFromPixels", () => {
  it("picks the cover's character colour over its largest area", () => {
    // A typical jacket: mostly paper, with a strong block of one colour. The
    // white is nine times the area and must still lose — "the colour of this
    // book" is the blue.
    const palette = spinePaletteFromPixels(pixels([900, 250, 248, 244], [100, 40, 60, 200]))!;
    expect(palette).not.toBeNull();
    expect(hue(palette.binding)).toBeGreaterThan(200);
    expect(hue(palette.binding)).toBeLessThan(260);
  });

  it("does not answer black for a cover that is mostly black ink", () => {
    const palette = spinePaletteFromPixels(pixels([900, 8, 8, 10], [100, 200, 60, 40]))!;
    expect(hue(palette.binding)).toBeLessThan(30);
    // And the clamp keeps it off the floor even so.
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
  });

  it("keeps a binding inside the readable lightness band", () => {
    const nearWhite = spinePaletteFromPixels(pixels([1000, 254, 253, 252]))!;
    const nearBlack = spinePaletteFromPixels(pixels([1000, 2, 2, 2]))!;
    expect(relativeLuminance(rgb(nearWhite.binding))).toBeLessThan(0.75);
    expect(relativeLuminance(rgb(nearBlack.binding))).toBeGreaterThan(0.005);
  });

  it("returns null when there is nothing to read", () => {
    expect(spinePaletteFromPixels(new Uint8ClampedArray(0))).toBeNull();
    expect(spinePaletteFromPixels(new Uint8ClampedArray([10, 20, 30, 0]))).toBeNull();
  });

  it("letters every binding it produces with a legible ink", () => {
    for (const source of [
      pixels([100, 250, 250, 250]),
      pixels([100, 10, 10, 10]),
      pixels([100, 40, 60, 200]),
      pixels([100, 220, 190, 60]),
    ]) {
      const palette = spinePaletteFromPixels(source)!;
      expect(contrast(palette.binding, palette.ink)).toBeGreaterThan(3);
    }
  });
});

describe("fallbackPalette", () => {
  it("is deterministic per resource, so an uncovered book is the same object every session", () => {
    expect(fallbackPalette("abc")).toEqual(fallbackPalette("abc"));
  });

  it("distinguishes books rather than rendering a row of identical blanks", () => {
    const bindings = new Set(["abc", "def", "ghi", "jkl"].map((id) => fallbackPalette(id).binding));
    expect(bindings.size).toBeGreaterThan(1);
  });

  it("is legible too", () => {
    const palette = fallbackPalette("abc");
    expect(palette.ink).toBe(inkFor(palette.binding));
    expect(contrast(palette.binding, palette.ink)).toBeGreaterThan(3);
  });
});

function rgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(rgb(a));
  const lb = relativeLuminance(rgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
