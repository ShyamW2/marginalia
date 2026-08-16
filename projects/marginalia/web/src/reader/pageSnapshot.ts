/**
 * The departing page as a bitmap — the texture M20's page curl deforms
 * (`pageFold.ts`), and the one input the whole effect is built on.
 *
 * ## Why this is not html2canvas any more
 *
 * It used to be, with `foreignObjectRendering: true` — chosen in M10 to dodge
 * a real hang cloning epub.js's sandboxed iframe. That option serializes the
 * captured subtree into an SVG `<foreignObject>` and paints it through an
 * `<img>`, and **an SVG rendered as an image cannot host a nested browsing
 * context**. It is a spec rule (SVG-as-image runs in secure static mode), not
 * a browser bug and not an html2canvas bug, so the epub.js iframe — which is
 * the entire page — contributed exactly zero pixels, in every browser, on
 * every platform. Measured directly (2026-08-02): a container with a
 * background and an iframe full of text serializes to an image that is 100%
 * opaque and 0% ink.
 *
 * Every "verified live" screenshot of the curl across three passes was
 * therefore a fold drawn over an empty bitmap, and the M20 acceptance
 * criterion "the live page beneath shows through the opening" was signed off
 * against nothing. See NOTES.md 2026-08-02 and PAGE_CURL.md §5.
 *
 * ## What it does instead
 *
 * The iframe's document is *same-origin* (`sandbox="allow-same-origin"`,
 * content set via `srcdoc`), so rather than screenshotting the iframe we
 * reach through it and serialize its own `documentElement` into the
 * `foreignObject` directly. No nested browsing context, so nothing is in
 * secure static mode's way, and the browser's own layout engine does the
 * work — CSS columns, hyphenation, the reading theme and the exact line
 * breaks all come out right because they are not being re-implemented.
 *
 * Three things have to come along with it, and each is a way this can go
 * subtly wrong:
 *
 * 1. **Stylesheets.** epub.js serves the section's CSS from `blob:` URLs, and
 *    a `<link>` in secure static mode will not load. Their rules are readable
 *    (same-origin), so they are dumped into one inline `<style>` instead.
 * 2. **`url()` assets.** Images and `@font-face` files are `blob:` too, and
 *    would silently fall back — a wrong font is a *visible* mismatch at the
 *    moment the fold starts. Every unique `url()` in the dumped CSS, and
 *    every `<img>`, is refetched and inlined as a `data:` URI.
 * 3. **The scroll offset.** A paginated section is laid out many viewports
 *    wide (measured: 5510px of content behind a 1102px window) and epub.js
 *    scrolls its own container over it. The snapshot depicts the *visible*
 *    window, so the serialized content is translated by `-scrollLeft`.
 *
 * The highlight overlays need none of that — marks-pane draws them as SVG in
 * the *parent* document, as siblings of the iframe (NOTES.md M2/M3) — but
 * they do need a rasterization pass of their own, for a reason that is not
 * obvious until it silently costs you every highlight. See `buildOverlaySvg`.
 *
 * ## Two constraints that are not negotiable
 *
 * - **The deadline stays** (M10). Capture is a best-effort visual flourish;
 *   on a throw or a timeout the caller falls back to the plain slide, and a
 *   stalled capture must never freeze reading.
 * - **The result must be a `data:` URL, not a `blob:` one.** Measured
 *   2026-08-02: an SVG loaded from a blob URL *taints the canvas*, so
 *   `getImageData` (`samplePaperColor`) and `toDataURL` both throw
 *   `SecurityError`. A data URL does not. This is why the SVG is base64'd
 *   into a string rather than handed over as an object URL, and it is not an
 *   optimization anyone should undo.
 */

// Best-effort deadline. A `try/catch` around a capture does nothing for a
// *hang* — a promise that never settles doesn't throw — and M10 hit a real
// one, which froze every future page turn because the turn lock was never
// released. Race a hard deadline instead.
const CAPTURE_TIMEOUT_MS = 700;

// The curl only needs to look sharp for ~400ms of animation, not to be
// print-quality, and full retina resolution measurably slows both the
// rasterization and the per-band blits for no visible benefit.
const MAX_CAPTURE_SCALE = 1.5;

/**
 * The window the snapshot depicts, and where it sits in the laid-out content.
 *
 * epub.js lays a paginated section out as one very wide element and scrolls
 * its own container over it, so "what is on screen" is a viewport-sized
 * window at `scrollX` into content many times that wide. Both numbers are
 * needed: the size sets the bitmap, the offset places the content in it.
 */
export interface CaptureViewport {
  /** Visible size in CSS px — what the snapshot depicts. */
  width: number;
  height: number;
  /** How far the visible window is scrolled into the content. */
  scrollX: number;
  scrollY: number;
  /** The laid-out content's own size, which is much wider than the window. */
  contentWidth: number;
  contentHeight: number;
}

/**
 * Which element is actually scrolling, and by how much.
 *
 * Found by walking up from the iframe rather than by class name: epub.js's
 * `.epub-container` is internal to a dependency, and the structure
 * (`container > .epub-container[scrolls] > .epub-view > iframe`) is not ours
 * to rely on. The first ancestor whose content overflows it is the scroller
 * by definition, whatever it is called.
 */
export function findScroller(container: HTMLElement, frame: HTMLElement): HTMLElement {
  for (let el = frame.parentElement; el; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
      return el;
    }
    if (el === container) break;
  }
  return container;
}

export function captureViewport(
  container: HTMLElement,
  frame: HTMLElement,
): CaptureViewport {
  const scroller = findScroller(container, frame);
  return {
    width: Math.max(1, scroller.clientWidth),
    height: Math.max(1, scroller.clientHeight),
    scrollX: scroller.scrollLeft,
    scrollY: scroller.scrollTop,
    contentWidth: Math.max(1, frame.offsetWidth),
    contentHeight: Math.max(1, frame.offsetHeight),
  };
}

/**
 * Every CSS rule the document is actually using, as one blob of text.
 *
 * Reading `cssRules` rather than copying the `<link>` elements is what makes
 * the blob-URL stylesheets survive: the rules are same-origin and readable,
 * the URLs they came from are not loadable from inside an SVG image. A sheet
 * that refuses to expose its rules (cross-origin) is skipped — losing its
 * styling is a worse-looking snapshot, never a failed one.
 */
export function collectStyleText(doc: Document): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from((sheet as CSSStyleSheet).cssRules)) {
        chunks.push(rule.cssText);
      }
    } catch {
      // Cross-origin sheet: unreadable by design.
    }
  }
  return chunks.join("\n");
}

/**
 * The one style override the copy needs, and the subtlest thing in this file.
 *
 * epub.js paginates by giving `body` a one-viewport width, CSS columns, and
 * `overflow: auto hidden` — the section's other pages live in body's
 * horizontal overflow, and the reader scrolls a container over them. That
 * works in the real iframe only because of an easily-missed CSS rule: when
 * the root element's overflow is `visible`, **the body's overflow is
 * propagated to the viewport** and body itself is then treated as
 * `overflow: visible`, so its columns spill out and stay visible.
 *
 * Inside a `foreignObject` the copied `<html>`/`<body>` are not the document
 * root, so nothing propagates and body clips its own overflow for real. The
 * failure is silent and page-dependent: the snapshot looks right on page 1
 * (which is inside body's box) and comes back **completely blank on every
 * other page**, because the window we translate to lands past body's clip.
 * Measured on Kafka at `scrollLeft` 5510 — 0% ink without this line, 11% with
 * it, and 8% at `scrollLeft` 0 either way.
 */
const OVERFLOW_OVERRIDE = "html,body{overflow:visible !important}";

const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * Rewrites every `url()` in a stylesheet to an inline `data:` URI.
 *
 * `blob:` and same-origin URLs are both unfetchable from inside an SVG image,
 * and the failure mode is silent: a missing `@font-face` file falls back to a
 * system font, which re-breaks every line and makes the snapshot visibly
 * disagree with the page it is supposed to be a picture of, exactly at the
 * moment the fold starts. `fetchAsset` is injected so this stays testable.
 */
export async function inlineCssUrls(
  css: string,
  fetchAsset: (url: string) => Promise<string | null>,
): Promise<string> {
  const urls = new Set<string>();
  for (const match of css.matchAll(CSS_URL)) {
    const url = match[2]!;
    if (!url.startsWith("data:")) urls.add(url);
  }
  if (urls.size === 0) return css;

  const resolved = new Map<string, string>();
  await Promise.all(
    Array.from(urls, async (url) => {
      const dataUrl = await fetchAsset(url);
      if (dataUrl) resolved.set(url, dataUrl);
    }),
  );
  return css.replace(CSS_URL, (whole, _quote, url: string) => {
    const dataUrl = resolved.get(url);
    return dataUrl ? `url("${dataUrl}")` : whole;
  });
}

/** One asset as a `data:` URI, or null if it cannot be had. Never throws —
 * a snapshot missing one image still beats no page turn. */
async function fetchAsset(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * The section's document, serialized as XML and ready to drop into a
 * `<foreignObject>`.
 *
 * The whole `documentElement` goes in, `<html>` and `<body>` elements
 * included, rather than its contents being lifted into a `<div>`: EPUB
 * stylesheets and epub.js's own themes both style `html` and `body` by type
 * selector, and a `<div>` would match neither. Inside a `foreignObject` the
 * parse is namespace-based rather than HTML-parser-based, so a nested
 * `<html>` is a perfectly ordinary styled block box.
 *
 * `XMLSerializer` rather than `outerHTML` because the result has to be
 * well-formed XML — an unclosed `<br>` or a bare `&` anywhere in the book
 * would make the whole image fail to render.
 */
async function serializeSectionDocument(doc: Document): Promise<string> {
  const clone = doc.documentElement.cloneNode(true) as HTMLElement;

  // The originals point at blob: URLs that cannot load in an SVG image; the
  // dump below replaces all of them at once.
  for (const el of Array.from(clone.querySelectorAll("link[rel~='stylesheet'], style"))) {
    el.remove();
  }
  const style = doc.createElement("style");
  const css = await inlineCssUrls(collectStyleText(doc), fetchAsset);
  style.textContent = `${css}\n${OVERFLOW_OVERRIDE}`;
  (clone.querySelector("head") ?? clone).appendChild(style);

  await Promise.all(
    Array.from(clone.querySelectorAll("img")).map(async (img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("data:")) return;
      const dataUrl = await fetchAsset(new URL(src, doc.baseURI).href);
      if (dataUrl) img.setAttribute("src", dataUrl);
      else img.removeAttribute("src"); // a broken-image glyph is worse than a gap
    }),
  );

  return new XMLSerializer().serializeToString(clone);
}

/**
 * The marks-pane overlays: every sibling of the iframe in the view element.
 * They are plain SVG in the parent document (NOTES.md M2/M3) — nothing to
 * inline, nothing to reach through — so they serialize as they are. They are
 * then rasterized in a **second pass**, and that part is not optional; see
 * `buildOverlaySvg`.
 */
function serializeOverlays(frame: HTMLElement): string {
  const parent = frame.parentElement;
  if (!parent) return "";
  const serializer = new XMLSerializer();
  return Array.from(parent.children)
    .filter((child) => child !== frame)
    .map((child) => serializer.serializeToString(child))
    .join("");
}

/**
 * The complete SVG document, sized to the visible window, with the content
 * translated so the right page of a paginated section lands in it.
 *
 * Pure, and separated from everything that touches the DOM, because the
 * translation is the part that is easy to get wrong and cheap to pin.
 */
export function buildSnapshotSvg(
  viewport: CaptureViewport,
  background: string,
  contentMarkup: string,
): string {
  const { width, height, scrollX, scrollY, contentWidth, contentHeight } = viewport;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;` +
    `overflow:hidden;background:${background}">` +
    `<div style="position:relative;width:${contentWidth}px;height:${contentHeight}px;` +
    `margin-left:${-scrollX}px;margin-top:${-scrollY}px">` +
    contentMarkup +
    `</div></div></foreignObject></svg>`
  );
}

/**
 * The highlight overlays, as their own SVG document, translated to the same
 * window.
 *
 * **Why they cannot ride along in `buildSnapshotSvg`.** A `<style>` inside a
 * `foreignObject` is not scoped to it — CSS in an SVG document applies to the
 * whole document — so the section's own stylesheet reaches the overlay's
 * `<svg>`/`<g>`/`<rect>` too, and books ship rules that hit them. Measured on
 * Kafka at `scrollLeft` 5510: highlight wash covers 6.4% of the screen, 5.7%
 * when the overlay is rendered without the book's CSS, and **0% when the two
 * share one SVG**. Paint order was ruled out first — reordering the markup
 * and giving the overlay `z-index: 99` changed nothing. Rather than hunt for
 * whichever rule a given book happens to ship, the overlays get a document no
 * book's CSS can reach, and the two are composited on the canvas instead.
 *
 * It goes through the same `foreignObject` wrapper as the page, on a
 * transparent background, rather than being translated with a `<g transform>`
 * in plain SVG. marks-pane sizes its `<svg>` with an inline
 * `width: 7714px !important` — a *CSS* width, which only means anything in an
 * HTML formatting context. Nested directly in SVG the element keeps the
 * default `width="100%"` viewport and clips everything past it, which is all
 * of it: the rects sit at x ≈ 6114 in a 1102-wide viewport. Measured — the
 * `<g transform>` form renders 0% wash, this one 6.35%, the screen 6.35%.
 */
export function buildOverlaySvg(viewport: CaptureViewport, overlayMarkup: string): string {
  return buildSnapshotSvg(viewport, "transparent", overlayMarkup);
}

/** UTF-8 → base64, chunked so a book-sized page cannot blow the argument
 * limit on `String.fromCharCode`. Base64 rather than percent-encoding
 * because a page of prose is full of curly quotes and em dashes, which
 * `encodeURIComponent` triples where base64 costs a flat third. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function loadSvg(svg: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("snapshot SVG failed to render"));
    image.src = `data:image/svg+xml;base64,${toBase64(svg)}`;
  });
  return image;
}

/**
 * Paints the SVG layers into one canvas, in order, and hands back a PNG.
 *
 * The rasterization has to happen once, here: the fold blits its bitmap ~25
 * times a frame, and an SVG image would be re-rasterized on every one of
 * them. The PNG, rather than the canvas itself, is what the rest of M20
 * already consumes.
 */
async function rasterize(svgs: string[], viewport: CaptureViewport): Promise<string> {
  const scale = Math.min(window.devicePixelRatio || 1, MAX_CAPTURE_SCALE);
  const images = await Promise.all(svgs.map(loadSvg));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width * scale));
  canvas.height = Math.max(1, Math.round(viewport.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context for the snapshot");
  for (const image of images) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

/** The page's own background, read off the section document rather than the
 * reading theme — same principle as `samplePaperColor`, and it keeps the
 * snapshot opaque where the text does not reach. */
function paperBackground(doc: Document): string {
  const win = doc.defaultView;
  if (!win) return "#ffffff";
  for (const el of [doc.body, doc.documentElement]) {
    if (!el) continue;
    const color = win.getComputedStyle(el).backgroundColor;
    if (color && color !== "transparent" && !color.startsWith("rgba(0, 0, 0, 0")) return color;
  }
  return "#ffffff";
}

async function buildSnapshot(container: HTMLElement): Promise<string | null> {
  const frame = container.querySelector("iframe");
  // No iframe, or a cross-origin one: nothing to reach through. The caller
  // falls back to the slide, which is the correct degradation.
  if (!frame) return null;
  const doc = frame.contentDocument;
  if (!doc?.documentElement) return null;

  const viewport = captureViewport(container, frame);
  const layers = [
    buildSnapshotSvg(viewport, paperBackground(doc), await serializeSectionDocument(doc)),
  ];
  const overlays = serializeOverlays(frame);
  if (overlays) layers.push(buildOverlaySvg(viewport, overlays));
  return await rasterize(layers, viewport);
}

/**
 * How much of `container` the snapshot does **not** cover, as a fraction of the
 * container's own width and height on each side.
 *
 * The capture depicts the *scroller* — epub.js's paginated window — and that
 * window sits inside `.marginWrapper`'s padding, which is the reading pane's
 * own margin band (`--reader-margin`). So a snapshot is the page's **text
 * block**, not the pane, and anything that lays it across a rect the size of
 * the pane is silently throwing that band away.
 *
 * The opening did exactly that: the printed spread stretched the text block
 * over the whole page, so a book that had just opened had type running to its
 * very top edge where a real page has a head margin — "it would be nice if we
 * preserved margins (particularly at the top)" (operator, 2026-08-16). With
 * this, the printed leaf is inset by the same fraction the pane insets its own
 * text, and the paper the book is already drawing shows through as the margin.
 *
 * Symmetric by construction (the wrapper's padding is one value on all four
 * sides), so one x and one y are the whole answer. `null` when there is nothing
 * to reach through, or when the band is too small to be worth the arithmetic —
 * both mean "print it full bleed", which is what it did before.
 */
export function snapshotInset(container: HTMLElement): { x: number; y: number } | null {
  const frame = container.querySelector("iframe");
  if (!frame) return null;
  const scroller = findScroller(container, frame);
  if (scroller === container) return null;
  const outer = container.getBoundingClientRect();
  const inner = scroller.getBoundingClientRect();
  if (outer.width <= 0 || outer.height <= 0) return null;
  // Halved: `inner` is inset on both sides, and the fraction wanted is the
  // band on *one* of them.
  const x = (outer.width - inner.width) / 2 / outer.width;
  const y = (outer.height - inner.height) / 2 / outer.height;
  if (!(x >= 0) || !(y >= 0) || x >= 0.5 || y >= 0.5) return null;
  return { x, y };
}

export async function capturePageSnapshot(container: HTMLElement): Promise<string | null> {
  try {
    return await Promise.race([
      buildSnapshot(container),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Any failure — an unusual book's markup, a browser quirk, an asset that
    // will not fetch — falls back to the plain slide rather than blocking the
    // page turn itself.
    return null;
  }
}
