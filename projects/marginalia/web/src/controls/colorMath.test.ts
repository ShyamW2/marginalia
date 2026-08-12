import { describe, expect, it } from "vitest";
import {
  accentTextFor,
  contrastRatio,
  hexToHsl,
  hslToHex,
  hslToRgb,
  rgbToHsl,
  tintKeepingLightness,
} from "./colorMath.js";

describe("hslToRgb / hslToHex", () => {
  it("converts known colors", () => {
    expect(hslToRgb({ h: 0, s: 0, l: 0 })).toEqual([0, 0, 0]);
    expect(hslToRgb({ h: 0, s: 0, l: 100 })).toEqual([255, 255, 255]);
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual([255, 0, 0]);
    expect(hslToHex({ h: 0, s: 100, l: 50 })).toBe("#ff0000");
  });
});

describe("rgbToHsl", () => {
  it("round-trips through hslToRgb", () => {
    for (const hsl of [
      { h: 0, s: 0, l: 0 },
      { h: 0, s: 0, l: 100 },
      { h: 210, s: 40, l: 60 },
      { h: 45, s: 80, l: 25 },
    ]) {
      const roundTripped = rgbToHsl(hslToRgb(hsl));
      expect(roundTripped.h).toBeCloseTo(hsl.h, 0);
      expect(roundTripped.s).toBeCloseTo(hsl.s, 0);
      expect(roundTripped.l).toBeCloseTo(hsl.l, 0);
    }
  });
});

describe("tintKeepingLightness", () => {
  it("changes hue but keeps the original lightness", () => {
    const base = "#faf7f0"; // theme.css's paper --color-bg
    const tinted = tintKeepingLightness(base, 210, 12);
    expect(hexToHsl(tinted).l).toBeCloseTo(hexToHsl(base).l, 0);
  });

  it("keeps body-text contrast at or above AA at a subtle saturation", () => {
    const paperBg = "#faf7f0";
    const paperText = "#2a2620";
    const inkBg = "#1c1a17";
    const inkText = "#e8e2d4";
    const linear = (c: number) => {
      const n = c / 255;
      return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const clean = hex.replace("#", "");
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    for (let hue = 0; hue < 360; hue += 30) {
      const tintedPaper = tintKeepingLightness(paperBg, hue, 12);
      const tintedInk = tintKeepingLightness(inkBg, hue, 12);
      expect(contrastRatio(luminance(tintedPaper), luminance(paperText))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(luminance(tintedInk), luminance(inkText))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("accentTextFor", () => {
  it("picks white on dark accents and black on light accents", () => {
    expect(accentTextFor({ h: 0, s: 0, l: 5 })).toBe("#ffffff");
    expect(accentTextFor({ h: 0, s: 0, l: 95 })).toBe("#000000");
  });

  it("stays at or above WCAG AA (4.5:1) across the whole field", () => {
    // Sweep every hue, saturation and lightness the picker can produce —
    // the derivation must hold everywhere, not just at a few sampled points.
    for (let h = 0; h < 360; h += 15) {
      for (let s = 0; s <= 100; s += 20) {
        for (let l = 0; l <= 100; l += 5) {
          const hsl = { h, s, l };
          const text = accentTextFor(hsl);
          const textLuminance = text === "#000000" ? 0 : 1;
          const rgb = hslToRgb(hsl);
          const accentLuminance = (() => {
            const linear = (c: number) => {
              const n = c / 255;
              return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
            };
            const [r, g, b] = rgb.map(linear);
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          })();
          expect(contrastRatio(accentLuminance, textLuminance)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
