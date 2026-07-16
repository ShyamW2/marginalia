import { useEffect, useState } from "react";

export interface EpubThemeVars {
  bg: string;
  text: string;
  accent: string;
  fontSerif: string;
  highlight: string;
  highlightActive: string;
  border: string;
}

function readVars(): EpubThemeVars {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    bg: v("--color-bg"),
    text: v("--color-text"),
    accent: v("--color-accent"),
    fontSerif: v("--font-serif"),
    highlight: v("--color-highlight"),
    highlightActive: v("--color-highlight-active"),
    border: v("--color-border"),
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
