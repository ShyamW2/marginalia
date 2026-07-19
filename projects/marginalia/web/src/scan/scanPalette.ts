import type { HighlightKind } from "@marginalia/shared";

/**
 * The scan's phosphor palette (DESIGN.md Room 3): the same four semantic
 * kinds as the reader's washes (reader/highlightKinds.ts), translated from
 * muted paper/ink tints into saturated neon-on-black — contrast-checked
 * against the scan's near-black panel background (~13.5:1 to 8.7:1 by eye,
 * comfortably past WCAG AA for the graphical elements they're used on).
 */
const PHOSPHOR_HUE: Record<HighlightKind, string> = {
  rose: "#ff6b81",
  sage: "#59e39d",
  honey: "#ffd166",
  slate: "#5ec8ff",
};

export function phosphorHue(kind: HighlightKind): string {
  return PHOSPHOR_HUE[kind];
}

export const KIND_ORDER: HighlightKind[] = ["rose", "sage", "honey", "slate"];
