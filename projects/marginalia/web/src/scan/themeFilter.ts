import type { ScanBookTheme } from "@marginalia/shared";

/**
 * M24.5 §4 "the Scan's theme filter becomes the colour key": a selection is
 * either a whole book-level theme (lights every specific theme underneath
 * it) or one specific/chapter-level theme (today's exact-match behaviour,
 * still reachable). `null` is "no theme filter."
 */
export type ThemeSelection = { kind: "book"; id: string } | { kind: "specific"; name: string } | null;

/**
 * The set of specific/chapter-level theme names a selection should light —
 * what `HeatStrip`'s `litThemes` and the Mine layer's own filter both
 * compose against. Selecting a book-level theme expands to every child
 * TASKS.md M24.5 §4 names ("filtering by a book-level theme lights every
 * child theme's highlights"); selecting a specific theme is unchanged from
 * before distillation existed.
 */
export function activeThemeNames(selection: ThemeSelection, bookThemes: ScanBookTheme[]): string[] | null {
  if (selection === null) return null;
  if (selection.kind === "specific") return [selection.name];
  return bookThemes.find((t) => t.id === selection.id)?.children ?? [];
}
