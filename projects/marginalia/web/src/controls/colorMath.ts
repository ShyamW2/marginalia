/**
 * Pure color math for the accent/paper pickers (M22.6 §E, decisions.md
 * 2026-08-12 ruling 4: "contrast is derived, never chosen"). Kept apart from
 * the picker's DOM/pointer wiring for the same reason sliderMath.ts is
 * separate from Slider.tsx — the geometry (and here, the contrast guarantee)
 * is unit-testable without a browser.
 */

export interface Hsl {
  /** Degrees, 0–360. */
  h: number;
  /** Percent, 0–100. */
  s: number;
  /** Percent, 0–100. */
  l: number;
}

export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl));
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

export function rgbToHsl([r, g, b]: [number, number, number]): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: l * 100 };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

export function hexToHsl(hex: string): Hsl {
  return rgbToHsl(hexToRgb(hex));
}

/**
 * Re-hues a background color while keeping its own lightness — the paper
 * tint (M22.6 §E) shifts hue and pins saturation to a subtle, fixed amount
 * so the token's contrast against body text (already tuned in theme.css)
 * barely moves, rather than re-deriving contrast the way accentTextFor does
 * for a fill that sits *behind* readable text at full saturation.
 */
export function tintKeepingLightness(baseHex: string, hue: number, saturation: number): string {
  const { l } = hexToHsl(baseHex);
  return hslToHex({ h: hue, s: saturation, l });
}

/** WCAG relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const linear = (c: number) => {
    const n = c / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [linear(r), linear(g), linear(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio between two relative luminances, always ≥ 1. */
export function contrastRatio(l1: number, l2: number): number {
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The higher-contrast of pure black or pure white against `hsl`. For any
 * color, max(contrast-vs-black, contrast-vs-white) is provably ≥ ~4.58
 * (the two curves cross at relative luminance ≈0.179, where both equal
 * that value) — comfortably above WCAG AA's 4.5:1 for normal text. This is
 * "no picker position can produce unreadable text" in one function: it is
 * a property of the choice rule, not a check on any particular accent.
 */
export function accentTextFor(hsl: Hsl): "#000000" | "#ffffff" {
  const luminance = relativeLuminance(hslToRgb(hsl));
  const contrastBlack = contrastRatio(luminance, 0);
  const contrastWhite = contrastRatio(luminance, 1);
  return contrastBlack >= contrastWhite ? "#000000" : "#ffffff";
}
