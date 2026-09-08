/**
 * M41 §C1 (PDF.md §7.6): pure spread/zoom layout math for the native PDF
 * pane — no DOM, no pdf.js, characterized directly by unit tests the same
 * way `readerGeometry.ts` characterizes the reflow pane's own stage math.
 *
 * The spread threshold is computed from the PDF's own page geometry, never
 * a fixed pixel breakpoint like EPUB's `SPREAD_MIN_WIDTH = 960`
 * (readerGeometry.ts) — safe there only because reflowable text lays out at
 * any width. A PDF page has a fixed intrinsic size, and that size varies
 * hugely (a portrait paper vs. a landscape slide deck need very different
 * container widths before a spread is legible).
 */

/** Below this fraction of a page's own native (scale:1) resolution, a 2-up
 * spread renders too small to be worth showing — not tuned against a real
 * display yet, same honesty `PdfRenderer.ts`'s own former `RENDER_SCALE`
 * comment already carried. */
export const MIN_SPREAD_SCALE = 0.6;

export function shouldShowSpread(containerWidth: number, naturalPageWidth: number): boolean {
  if (naturalPageWidth <= 0 || containerWidth <= 0) return false;
  return containerWidth / (naturalPageWidth * 2) >= MIN_SPREAD_SCALE;
}

export type FitMode = "fit-width" | "fit-page";

/** `fit-width`: the page(s) width fills the container, height overflows
 * freely. `fit-page`: the whole page must also fit vertically, so it's
 * `min(widthScale, heightScale)` — always `<=` what `fit-width` would give
 * for the same inputs. `pagesAcross` divides the width budget between 1 or
 * 2 side-by-side pages. */
export function computeFitScale(
  fitMode: FitMode,
  containerWidth: number,
  containerHeight: number,
  naturalPageWidth: number,
  naturalPageHeight: number,
  pagesAcross: 1 | 2,
): number {
  const widthScale = naturalPageWidth > 0 ? containerWidth / (naturalPageWidth * pagesAcross) : 1;
  if (fitMode === "fit-width") return widthScale;
  const heightScale = naturalPageHeight > 0 ? containerHeight / naturalPageHeight : widthScale;
  return Math.min(widthScale, heightScale);
}

export const ZOOM_STEP = 1.2;
export const MIN_ZOOM_SCALE = 0.25;
export const MAX_ZOOM_SCALE = 4;

export function clampZoomScale(scale: number): number {
  return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, scale));
}

// ── M42 §D1: continuous zoom (PDF.md §7.6's polish pass) ───────────────────

/** `factor = e^(-deltaY * WHEEL_ZOOM_SENSITIVITY)`, so a positive `deltaY`
 * (scrolling down/pinching closed) zooms out and a negative one zooms in,
 * continuously rather than in `ZOOM_STEP` jumps — matches Ctrl+wheel/
 * trackpad-pinch conventions elsewhere on the web (browsers themselves,
 * Google Maps, VS Code). Untuned against a real trackpad yet — same honesty
 * `MIN_SPREAD_SCALE`'s own comment already carries — expect operator tuning
 * live. */
export const WHEEL_ZOOM_SENSITIVITY = 0.003;

/** How long a continuous zoom gesture (wheel, pinch, or a drag on the zoom
 * slider) must sit idle before the real raster re-render commits. The live
 * CSS-transform preview (`PdfRenderer.applyZoomPreview`) is what makes the
 * page visibly interpolate through intermediate scales during that idle
 * window rather than jumping once at the end — this is only how long a
 * *real* pdf.js re-render (page.render + getTextContent, both real awaits)
 * is deferred while more input keeps arriving. */
export const ZOOM_COMMIT_DEBOUNCE_MS = 120;

/** Pure wheel-delta → target-scale math, pulled out for the same reason
 * `shouldShowSpread`/`computeFitScale` are: unit-testable without a real
 * `WheelEvent`/DOM. */
export function wheelZoomTarget(baseScale: number, deltaY: number): number {
  return clampZoomScale(baseScale * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY));
}
