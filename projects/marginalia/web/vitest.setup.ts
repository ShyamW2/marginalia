// jsdom doesn't implement `window.matchMedia` — App.tsx now depends on it
// unconditionally (usePaperTint.ts, M22.6 §E), the same way
// useEpubThemeVars.ts already did for the reader. A no-op MediaQueryList
// stand-in is enough: nothing under test asserts on live media-query
// changes, only that mounting doesn't throw.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
