import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "paper" | "ink" | "system";

const STORAGE_KEY = "marginalia:theme";

function readStoredChoice(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "paper" || stored === "ink" ? stored : "system";
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
 */
export function useTheme(): {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice);

  useEffect(() => {
    applyChoice(choice);
  }, [choice]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    if (next === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return { choice, setChoice };
}
