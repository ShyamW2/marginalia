import { useCallback, useEffect, useState } from "react";
import { accentTextFor, hslToHex, type Hsl } from "../controls/colorMath.js";
import { fetchAppearanceSettings, pushAppearanceSetting } from "./appearanceSync.js";

const STORAGE_KEY = "marginalia:accent";

function parseAccent(stored: string | null): Hsl | null {
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

function readStoredAccent(): Hsl | null {
  if (typeof window === "undefined") return null;
  return parseAccent(window.localStorage.getItem(STORAGE_KEY));
}

function persistAccent(accent: Hsl | null): void {
  if (accent) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(accent));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}

function accentsEqual(a: Hsl | null, b: Hsl | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.h === b.h && a.s === b.s && a.l === b.l;
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
 *
 * M44 (DESKTOP.md §3.4): `localStorage` is an instant-paint cache now, not
 * the source of truth — the sidecar `settings` table (`uiAccent`) is. See
 * useTheme.ts for why the reconciliation below only runs once per mount.
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

  useEffect(() => {
    let cancelled = false;
    fetchAppearanceSettings().then((settings) => {
      if (cancelled || !settings) return;
      const serverAccent = settings.uiAccent ? parseAccent(settings.uiAccent) : null;
      if (!accentsEqual(serverAccent, readStoredAccent())) {
        persistAccent(serverAccent);
        setAccentState(serverAccent);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setAccent = useCallback((next: Hsl) => {
    setAccentState(next);
    persistAccent(next);
    pushAppearanceSetting({ uiAccent: JSON.stringify(next) });
  }, []);

  const resetAccent = useCallback(() => {
    setAccentState(null);
    persistAccent(null);
    pushAppearanceSetting({ uiAccent: "" });
  }, []);

  return { accent, setAccent, resetAccent };
}
