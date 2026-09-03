import { useEffect, useState } from "react";
import type { HighlightKind } from "@marginalia/shared";
import { HIGHLIGHT_KINDS } from "./highlightKinds.js";
import type { ReaderThemeVars } from "./renderer/types.js";

export type { ReaderThemeVars };

function readVars(): ReaderThemeVars {
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
 * Tracks the resolved paper/ink theme's CSS custom properties so the reading
 * pane — which can't see our stylesheet (an epub.js iframe today; any future
 * renderer's own surface tomorrow) — can be kept in sync with the chrome
 * outside it. Re-reads on explicit theme choice changes (data-theme
 * attribute) and on system prefers-color-scheme changes (the "system" theme
 * choice).
 *
 * Renamed from `useEpubThemeVars`/`EpubThemeVars` (M40 §A, PDF.md §7.2): a
 * type with a format in its name cannot sit on the format-neutral renderer
 * seam. Content is unchanged.
 */
export function useReaderThemeVars(): ReaderThemeVars {
  const [vars, setVars] = useState<ReaderThemeVars>(readVars);

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
