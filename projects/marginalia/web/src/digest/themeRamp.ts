/**
 * M24.5 "themes worth colouring": maps a book-level theme's `colorIndex`
 * (server/src/digest/canonicalThemes.ts, assigned once at creation and
 * never recomputed) onto the CSS custom property carrying its actual hue
 * (theme.css's `--theme-ramp-*` block). One place, so the Scan's legend and
 * the digest page's own theme list can never disagree on which colour a
 * given index means. Kept in sync with `THEME_RAMP_SIZE` server-side —
 * mismatched, the modulo wrap just lands on a different (still valid) ramp
 * slot, never an invalid one.
 */
export const THEME_RAMP_SIZE = 8;

/** `colorIndex` is always a non-negative integer (`ScanBookThemeSchema`). */
export function themeRampColor(colorIndex: number): string {
  return `var(--theme-ramp-${colorIndex % THEME_RAMP_SIZE})`;
}
