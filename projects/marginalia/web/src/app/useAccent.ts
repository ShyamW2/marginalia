import { useCallback, useEffect, useState } from "react";
import { accentTextFor, hslToHex, type Hsl } from "../controls/colorMath.js";

const STORAGE_KEY = "marginalia:accent";

function readStoredAccent(): Hsl | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<Hsl>;
    if (typeof parsed.h === "number" && typeof parsed.s === "number" && typeof parsed.l === "number") {
      return { h: parsed.h, s: parsed.s, l: parsed.l };
    }
  } catch {
    // Falls through to null — a corrupt value is treated as "unset" rather
    // than crashing the app on startup.
  }
  return null;
}

function applyAccent(accent: Hsl | null): void {
  const root = document.documentElement.style;
  if (!accent) {
    root.removeProperty("--color-accent");
    root.removeProperty("--color-accent-text");
    return;
  }
  root.setProperty("--color-accent", hslToHex(accent));
  root.setProperty("--color-accent-text", accentTextFor(accent));
}

/**
 * M22.6 §E / decisions.md 2026-08-12 ruling 4: a custom accent, stored as an
 * HSL triple, overriding theme.css's `--color-accent` for both themes at
 * once. `--color-accent-text` is always *derived* from the chosen accent
 * (accentTextFor), never a second picked value — see colorMath.ts for why
 * that alone guarantees WCAG AA on every accent-on-accent-text pairing.
 * "Reset to default" is just clearing the override: theme.css's own
 * paper/ink `--color-accent` values take back over exactly, no re-derivation.
 */
export function useAccent(): {
  accent: Hsl | null;
  setAccent: (next: Hsl) => void;
  resetAccent: () => void;
} {
  const [accent, setAccentState] = useState<Hsl | null>(readStoredAccent);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  const setAccent = useCallback((next: Hsl) => {
    setAccentState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const resetAccent = useCallback(() => {
    setAccentState(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { accent, setAccent, resetAccent };
}
