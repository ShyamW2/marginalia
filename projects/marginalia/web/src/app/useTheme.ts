import { useCallback, useEffect, useState } from "react";
import { fetchAppearanceSettings, pushAppearanceSetting } from "./appearanceSync.js";

export type ThemeChoice = "paper" | "ink" | "system";

const STORAGE_KEY = "marginalia:theme";

function readStoredChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "paper" || stored === "ink" ? stored : "system";
}

function persistChoice(choice: ThemeChoice): void {
  if (choice === "system") {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, choice);
  }
}

function applyChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

/**
 * Tracks the user's paper/ink/system theme choice, persists it, and reflects
 * it onto <html data-theme="..."> for theme.css to key off. "system" removes
 * the attribute entirely so the prefers-color-scheme media query in
 * theme.css takes over.
 *
 * M44 (DESKTOP.md §3.4): `localStorage` is an instant-paint cache now, not
 * the source of truth — the sidecar `settings` table (`uiTheme`) is, so a
 * launch that lands on a different origin (a desktop build that fell back
 * off its preferred port) still recovers the operator's choice instead of
 * reverting to "system". The reconciliation below runs once per mount and
 * only visibly changes anything when the two disagree.
 */
export function useTheme(): {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice);

  useEffect(() => {
    applyChoice(choice);
  }, [choice]);

  useEffect(() => {
    let cancelled = false;
    fetchAppearanceSettings().then((settings) => {
      if (cancelled || !settings) return;
      const serverChoice: ThemeChoice = settings.uiTheme === "" ? "system" : settings.uiTheme;
      if (serverChoice !== readStoredChoice()) {
        persistChoice(serverChoice);
        setChoiceState(serverChoice);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    persistChoice(next);
    pushAppearanceSetting({ uiTheme: next === "system" ? "" : next });
  }, []);

  return { choice, setChoice };
}
