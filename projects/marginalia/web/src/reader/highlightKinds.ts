import type { HighlightKind, Settings } from "@marginalia/shared";

/** Render order for the selection pill's kind dots. */
export const HIGHLIGHT_KINDS: HighlightKind[] = ["rose", "sage", "honey", "slate"];

/**
 * M30 A (decisions.md 2026-08-24, settled decision 16): the label is a
 * setting now — `Settings.kindLabel*` — these are only the fallback a
 * consumer shows when that setting is unset or cleared. Nothing should read
 * this object directly for display; go through `kindLabelsFromSettings`.
 */
export const DEFAULT_KIND_LABELS: Record<HighlightKind, string> = {
  rose: "Regular annotation",
  sage: "Define",
  honey: "Key quote",
  slate: "Thematic Question",
};

/** Resolves the four kind labels for display, falling back to the default
 * name on an empty setting — the acceptance criterion is "never a nameless
 * dot", not just "read the setting". */
export function kindLabelsFromSettings(
  settings: Pick<Settings, "kindLabelRose" | "kindLabelSage" | "kindLabelHoney" | "kindLabelSlate">,
): Record<HighlightKind, string> {
  return {
    rose: settings.kindLabelRose || DEFAULT_KIND_LABELS.rose,
    sage: settings.kindLabelSage || DEFAULT_KIND_LABELS.sage,
    honey: settings.kindLabelHoney || DEFAULT_KIND_LABELS.honey,
    slate: settings.kindLabelSlate || DEFAULT_KIND_LABELS.slate,
  };
}

interface MarkThemeInput {
  kindColors: Record<HighlightKind, string>;
  colorScheme: "light" | "dark";
}

/**
 * M24.1 A: `mix-blend-mode` is not an SVG presentation attribute — unlike
 * `fill`/`fill-opacity`, `element.setAttribute("mix-blend-mode", ...)` is
 * silently a no-op (confirmed live: the attribute lands in the DOM,
 * `getComputedStyle` still reports `normal`). marks-pane's `Highlight.bind()`
 * applies every key of the `attributes` object via bare `setAttribute` (no
 * exceptions), so the *only* channel that actually parses as CSS is the
 * `style` attribute itself — hence this key, rather than a `mix-blend-mode`
 * key that epub.js/marks-pane would set the same broken way. `fill`/
 * `fill-opacity` deliberately stay separate presentation-attribute keys
 * (not folded into this string): clearMarkHover's `el.style.fillOpacity = ""`
 * clear-to-fallback trick depends on the base fill-opacity living on the
 * attribute, not inside the inline style block it's clearing.
 */
function blendStyle(blendMode: "multiply" | "screen"): string {
  return `mix-blend-mode: ${blendMode};`;
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
    style: blendStyle(isDark ? "screen" : "multiply"),
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
    style: blendStyle(isDark ? "screen" : "multiply"),
  };
}

/**
 * M24: a find-bar match. "Distinguishable from the others, without
 * borrowing any of the four highlight-kind hues — a search hit is not a
 * highlight" (TASKS.md M24 A). Reuses `--color-highlight`/`-active`, the
 * same pair the app's own controls already use for hover/pressed states
 * (registers.css), rather than inventing a fifth hue: `current` gets the
 * stronger of the two, every other match on the page gets the quieter one.
 */
export function searchMarkStyle(
  vars: { highlight: string; highlightActive: string; colorScheme: "light" | "dark" },
  current: boolean,
  hidden = false,
): Record<string, string> {
  if (hidden) return { fill: "transparent", "fill-opacity": "0" };
  const isDark = vars.colorScheme === "dark";
  return {
    fill: current ? vars.highlightActive : vars.highlight,
    "fill-opacity": current ? "1" : isDark ? "0.55" : "0.6",
    style: blendStyle(isDark ? "screen" : "multiply"),
  };
}
