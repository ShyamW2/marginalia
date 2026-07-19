import { useEffect, useState } from "react";
import type { HighlightKind } from "@marginalia/shared";
import { HIGHLIGHT_KINDS } from "./highlightKinds.js";

export interface EpubThemeVars {
  bg: string;
  text: string;
  accent: string;
  fontSerif: string;
  highlight: string;
  highlightActive: string;
  border: string;
  /** Reference hue per highlight kind (docs/marginalia/DESIGN.md). */
  kindColors: Record<HighlightKind, string>;
  /** The theme actually in effect right now — resolved via `color-scheme`,
   * which theme.css sets explicitly for both the "paper"/"ink" override and
   * the prefers-color-scheme fallback, so this always matches what's on
   * screen regardless of which path produced it. */
  colorScheme: "light" | "dark";
}

function readVars(): EpubThemeVars {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  const kindColors = Object.fromEntries(
    HIGHLIGHT_KINDS.map((kind) => [kind, v(`--kind-${kind}`)]),
  ) as Record<HighlightKind, string>;
  return {
    bg: v("--color-bg"),
    text: v("--color-text"),
    accent: v("--color-accent"),
    fontSerif: v("--font-serif"),
    highlight: v("--color-highlight"),
    highlightActive: v("--color-highlight-active"),
    border: v("--color-border"),
    kindColors,
    colorScheme: style.colorScheme === "dark" ? "dark" : "light",
  };
}

/**
 * Tracks the resolved paper/ink theme's CSS custom properties so the epub.js
 * iframe — which can't see our stylesheet — can be kept in sync with the
 * chrome outside it. Re-reads on explicit theme choice changes (data-theme
 * attribute) and on system prefers-color-scheme changes (the "system" theme
 * choice).
 */
export function useEpubThemeVars(): EpubThemeVars {
  const [vars, setVars] = useState<EpubThemeVars>(readVars);

  useEffect(() => {
    const update = () => setVars(readVars());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  return vars;
}
