import type { HighlightKind } from "@marginalia/shared";

/** Render order for the selection pill's kind dots. */
export const HIGHLIGHT_KINDS: HighlightKind[] = ["rose", "sage", "honey", "slate"];

export const KIND_LABELS: Record<HighlightKind, string> = {
  rose: "Revisit",
  sage: "Definition",
  honey: "Quote",
  slate: "Question",
};

interface MarkThemeInput {
  kindColors: Record<HighlightKind, string>;
  colorScheme: "light" | "dark";
}

/**
 * epub.js's `Annotations#highlight()` 5th argument — SVG presentation
 * attributes applied straight to the mark's `<rect>` (marks-pane's
 * `Highlight` class; see NOTES.md — these marks render in an SVG pane in
 * the *parent* document, not the iframe, so CSS classes registered via
 * `rendition.themes` never reach them; attributes are the only lever).
 * Muted ~20%-opacity wash on paper (DESIGN.md); a brighter "lifted" tint on
 * ink via a lightening blend, so the color glows rather than muddies
 * against the dark page.
 */
export function markStyleForKind(
  kind: HighlightKind,
  vars: MarkThemeInput,
  hidden = false,
): Record<string, string> {
  // Reading focus mode (DESIGN.md): marks stay attached (so state survives
  // the toggle) but paint invisible — cheaper and simpler than tearing
  // down and re-resolving every mark on every `f` press.
  if (hidden) return { fill: "transparent", "fill-opacity": "0" };

  const isDark = vars.colorScheme === "dark";
  return {
    fill: vars.kindColors[kind],
    "fill-opacity": isDark ? "0.34" : "0.22",
    "mix-blend-mode": isDark ? "screen" : "multiply",
  };
}
