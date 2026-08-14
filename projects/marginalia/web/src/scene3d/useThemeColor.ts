import { useEffect, useState } from "react";

/**
 * One CSS custom property, read as a colour string and kept in sync with the
 * theme — three.js can't see the stylesheet, so anything it paints with a
 * themed colour needs its own reactive read (`reader/useEpubThemeVars.ts` does
 * the same job for the epub iframe).
 *
 * ⚠️ Read before the stylesheet has applied — or in a test environment with no
 * theme.css at all — `getComputedStyle` returns "" for a custom property, and
 * feeding "" to three.js's `Color.set` throws. Hence the mandatory fallback.
 *
 * `desk/useDeskThemeColors.ts` is the same mechanism for six properties at
 * once, deliberately not built on this: it has to return one referentially
 * stable object, because a new identity there repaints and re-uploads the
 * desk's grain texture.
 */
export function useThemeColor(property: string, fallback: string): string {
  const read = () =>
    getComputedStyle(document.documentElement).getPropertyValue(property).trim() || fallback;
  const [color, setColor] = useState(read);

  useEffect(() => {
    const update = () => setColor(read());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", update);
    };
    // `read` closes over the two arguments and is recreated per render; the
    // effect only needs to re-run if those actually change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property, fallback]);

  return color;
}
