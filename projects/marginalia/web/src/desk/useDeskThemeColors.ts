import { useEffect, useState } from "react";

export interface DeskThemeColors {
  /** The desk board's base tone. */
  surface: string;
  /** The grain drawn over it. */
  grain: string;
  /** The raised lip around the desk's edge. */
  rim: string;
}

// Read before the stylesheet has applied (or in a test environment with no
// theme.css at all), `getComputedStyle` returns "" for a custom property.
// Feeding "" to three.js's Color.set throws, so every read has a floor.
const FALLBACK: DeskThemeColors = { surface: "#eee6d6", grain: "#dccfb5", rim: "#c3b092" };

function readDeskColors(): DeskThemeColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    surface: v("--desk-surface", FALLBACK.surface),
    grain: v("--desk-grain", FALLBACK.grain),
    rim: v("--desk-rim", FALLBACK.rim),
  };
}

/**
 * The CSS custom properties the desk's 3D surface materials need, kept in
 * sync the same way `reader/useEpubThemeVars.ts` does for the epub iframe:
 * three.js can't see the stylesheet either, so it needs its own reactive read
 * of the same values.
 */
export function useDeskThemeColors(): DeskThemeColors {
  const [colors, setColors] = useState<DeskThemeColors>(readDeskColors);

  useEffect(() => {
    const update = () =>
      setColors((prev) => {
        const next = readDeskColors();
        // Referential stability matters: this object is an effect dependency
        // in `DeskScene3D`'s surface, where a new identity repaints the grain
        // texture and re-uploads it.
        return prev.surface === next.surface && prev.grain === next.grain && prev.rim === next.rim ? prev : next;
      });
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
  }, []);

  return colors;
}
