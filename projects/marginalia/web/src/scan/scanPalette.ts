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
