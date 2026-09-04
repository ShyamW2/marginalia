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

// jsdom implements no scrolling at all, so `Element.scrollIntoView` is
// simply absent — the search result card calls it to keep the stepped hit
// visible (M24.1 D). A no-op is enough: no test asserts on scroll position,
// only that a component using it mounts and updates.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom does no layout, so `Range` (unlike `Element`) doesn't even stub
// `getBoundingClientRect`/`getClientRects` — both are simply absent (M40 §D,
// `PdfRenderer`, whose highlight-painting path calls both to turn a text
// selection into positioned mark boxes). A single zero-size rect for a
// non-collapsed range is the same convention jsdom itself already uses for
// `Element.getBoundingClientRect()`: no test asserts on real geometry, only
// that a range that spans real text produces at least one paintable box.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  const zeroRect = (): DOMRect =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  Range.prototype.getClientRects = function (this: Range) {
    const rects = this.collapsed ? [] : [zeroRect()];
    return Object.assign(rects, { item: (i: number) => rects[i] ?? null }) as unknown as DOMRectList;
  };
  Range.prototype.getBoundingClientRect = function (this: Range) {
    return this.getClientRects()[0] ?? zeroRect();
  };
}
