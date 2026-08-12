import { useCallback, useEffect, useState } from "react";
import { tintKeepingLightness } from "../controls/colorMath.js";

const STORAGE_KEY = "marginalia:paperHue";
// Subtle by construction, not by convention — colorMath.test.ts sweeps every
// hue at this saturation against both themes' body-text colors and asserts
// WCAG AA holds throughout, so this number is load-bearing, not decorative.
const PAPER_TINT_SATURATION = 12;
const TINTED_TOKENS = ["--color-bg", "--color-bg-raised"] as const;

function readStoredHue(): number | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === null) return null;
  const hue = Number(stored);
  return Number.isFinite(hue) ? hue : null;
}

function applyPaperTint(hue: number | null): void {
  const root = document.documentElement;
  // Clear any previous override *before* reading "the base color" below —
  // otherwise a hue change would re-tint an already-tinted value instead of
  // theme.css's own paper/ink one, and hue === null wouldn't cleanly
  // restore the shipped color.
  for (const token of TINTED_TOKENS) root.style.removeProperty(token);
  if (hue === null) return;
  const computed = getComputedStyle(root);
  for (const token of TINTED_TOKENS) {
    const base = computed.getPropertyValue(token).trim();
    root.style.setProperty(token, tintKeepingLightness(base, hue, PAPER_TINT_SATURATION));
  }
}

/**
 * M22.6 §E / decisions.md 2026-08-12 ruling 4: background/paper hue for the
 * `paper` register (Desk, Book, Digest, Settings) only. Reading — never
 * hardcoding — the current `--color-bg`/`--color-bg-raised` before re-hueing
 * them is what keeps this correct under both themes without duplicating
 * theme.css's literal colors here; it's also why this re-applies on every
 * resolved-theme change rather than once at pick-time.
 *
 * Never reaches the Scan: `ScanPage.module.css`'s `.page` hardcodes its own
 * `--color-bg`/`--color-bg-raised` as a fixed CRT phosphor palette, so an
 * override at `:root` is shadowed the instant it's inherited into that
 * subtree — the same material-not-room split settled decision 12 already
 * draws between the two registers.
 */
export function usePaperTint(): {
  hue: number | null;
  setHue: (next: number) => void;
  resetHue: () => void;
} {
  const [hue, setHueState] = useState<number | null>(readStoredHue);

  useEffect(() => {
    applyPaperTint(hue);
    const reapply = () => applyPaperTint(hue);

    // "system" theme changes with no React state anywhere to react to
    // (theme.css's own prefers-color-scheme media query does it) — this is
    // the one other place that cares what the *resolved* base color is, so
    // it needs its own way to notice.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", reapply);
    // An explicit paper/ink toggle (useTheme.ts) instead sets/clears
    // data-theme directly; catching that mutation is cheaper and more
    // direct than threading theme state into this hook.
    const observer = new MutationObserver(reapply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      media.removeEventListener("change", reapply);
      observer.disconnect();
    };
  }, [hue]);

  const setHue = useCallback((next: number) => {
    setHueState(next);
    window.localStorage.setItem(STORAGE_KEY, String(next));
  }, []);

  const resetHue = useCallback(() => {
    setHueState(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { hue, setHue, resetHue };
}
