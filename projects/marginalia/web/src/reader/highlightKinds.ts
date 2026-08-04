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

/**
 * The fill-opacity a hovered mark lifts to.
 *
 * M19.6 operator feedback round 4: hover used to scale the base wash by a
 * fixed multiplier (0.22 -> 0.57 on paper), which reads as a third colour —
 * paler than the `::selection` yellow you see while the passage is still
 * freshly selected, and the operator asked for hover to match *that* presence.
 * Full strength is what does it: the mark's own kind colour, undiluted, still
 * blended (multiply on paper, screen on ink) so the glyphs stay as legible as
 * they are at 0.22. Kind identity survives — honey hovers honey-coloured, not
 * selection-yellow — which is the point of having kinds.
 *
 * Ink stops short of full: `screen` over a dark page *lightens*, so an
 * undiluted wash there glares where multiply on paper merely deepens.
 */
export function hoverFillOpacity(colorScheme: "light" | "dark"): number {
  return colorScheme === "dark" ? 0.6 : 0.95;
}

/**
 * M21 (AUDIO.md): the currently-playing sentence's mark while listening —
 * "visually distinct from the four highlight kinds and quieter than all of
 * them". Uses the reader's own accent rather than a `kindColors` entry, so
 * it never reads as a fifth highlight kind a reader might try to click into
 * a thread — it moves every few seconds on its own, driven by playback, not
 * by anything the reader chose to mark.
 */
export function audioTintStyle(
  vars: { accent: string; colorScheme: "light" | "dark" },
  hidden = false,
): Record<string, string> {
  if (hidden) return { fill: "transparent", "fill-opacity": "0" };
  const isDark = vars.colorScheme === "dark";
  return {
    fill: vars.accent,
    "fill-opacity": isDark ? "0.22" : "0.14",
    "mix-blend-mode": isDark ? "screen" : "multiply",
  };
}
