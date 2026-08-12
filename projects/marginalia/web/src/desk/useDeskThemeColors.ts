import { useEffect, useState } from "react";

export interface DeskThemeColors {
  bg: string;
  accent: string;
  border: string;
}

function readDeskColors(): DeskThemeColors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return { bg: v("--color-bg"), accent: v("--color-accent"), border: v("--color-border") };
}

/**
 * The three CSS custom properties the desk's 3D surface material needs,
 * kept in sync the same way `reader/useEpubThemeVars.ts` does for the epub
 * iframe: three.js can't see the stylesheet either, so it needs its own
 * reactive read of the same values.
 */
export function useDeskThemeColors(): DeskThemeColors {
  const [colors, setColors] = useState<DeskThemeColors>(readDeskColors);

  useEffect(() => {
    const update = () => setColors(readDeskColors());
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
