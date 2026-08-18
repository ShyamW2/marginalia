import type { HighlightKind } from "@marginalia/shared";

/**
 * The scan's phosphor palette (DESIGN.md Room 3): the same four semantic
 * kinds as the reader's washes (reader/highlightKinds.ts), translated from
 * muted paper/ink tints into saturated neon-on-black — contrast-checked
 * against the scan's near-black panel background (~13.5:1 to 8.7:1 by eye,
 * comfortably past WCAG AA for the graphical elements they're used on).
 */
const PHOSPHOR_RGB: Record<HighlightKind, [number, number, number]> = {
  rose: [255, 107, 129],
  sage: [89, 227, 157],
  honey: [255, 209, 102],
  slate: [94, 200, 255],
};

export function phosphorHue(kind: HighlightKind): string {
  const [r, g, b] = PHOSPHOR_RGB[kind];
  return `rgb(${r}, ${g}, ${b})`;
}

/** Raw channels — M18's two-channel heat field (heatField.ts) blends by
 * category and needs to do real arithmetic on the colour, not just hand a
 * CSS string to the DOM. */
export function phosphorRgb(kind: HighlightKind): [number, number, number] {
  return PHOSPHOR_RGB[kind];
}

export const KIND_ORDER: HighlightKind[] = ["rose", "sage", "honey", "slate"];

/**
 * M24.5's book-level theme ramp (`theme.css`'s `--theme-ramp-0..7`), given
 * the same "muted paper tint → saturated neon-on-black" translation as the
 * four kind hues above — theme.css's own hex values would wash out against
 * this page's `#05070a` override the same way the untranslated kind hues
 * would. A *separate* set of 8 hues, not the same hues re-saturated: hue
 * separation was solved fresh against these four phosphor kind hues
 * (351°/150°/42°/200°, not the paper ramp's 0°/100°/39°/211° obstacles),
 * so it's still ~25° minimum apart from everything on this specific
 * surface. `colorIndex` (server/src/digest/canonicalThemes.ts) indexes
 * this the same way it indexes `--theme-ramp-*` — same identity, two
 * renderings, exactly like kind colours already work.
 */
const THEME_PHOSPHOR_RGB: [number, number, number][] = [
  [243, 142, 104],
  [222, 243, 104],
  [160, 243, 104],
  [104, 243, 110],
  [104, 243, 231],
  [104, 108, 243],
  [187, 104, 243],
  [243, 104, 212],
];

export function themePhosphorHue(colorIndex: number): string {
  const [r, g, b] = THEME_PHOSPHOR_RGB[colorIndex % THEME_PHOSPHOR_RGB.length];
  return `rgb(${r}, ${g}, ${b})`;
}
