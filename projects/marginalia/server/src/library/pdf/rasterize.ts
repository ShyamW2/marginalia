/**
 * PDF.md §3 / decisions.md 2026-09-03: rasterization (equation bands,
 * figures) goes through `@napi-rs/canvas`, chosen for its prebuilt N-API
 * binaries — no node-gyp, no per-Node-ABI rebuild, the property
 * `better-sqlite3` lacked when its ABI mismatches killed the server
 * silently across this repo's Mac/Linux split.
 *
 * ⚠️ Rasterization degrades, never fails the import (PDF.md §3 ⚠️). If the
 * canvas module is missing or throws, every function here returns null and
 * logs once per page rather than throwing — extraction continues text-only.
 */

let warnedOnce = false;

function warnDegraded(err: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    "[pdf] rasterization degraded — continuing text-only for this and any later figures/equations:",
    err instanceof Error ? err.message : err,
  );
}

// Minimal shape of what we need from a pdfjs PDFPageProxy — avoids a hard
// type dependency on pdfjs-dist's own types here.
export interface RenderablePage {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> };
}

const RASTER_SCALE = 2;

/** Renders a full page to a PNG buffer at 2× scale, once, so individual
 *  regions can be cropped from it. Null on any failure (degraded). */
export async function renderPageToBuffer(
  page: RenderablePage,
): Promise<{ png: Buffer; scale: number; pageWidth: number; pageHeight: number } | null> {
  try {
    const { createCanvas } = await import("@napi-rs/canvas");
    const unscaledViewport = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: RASTER_SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const png = canvas.toBuffer("image/png");
    return {
      png,
      scale: RASTER_SCALE,
      pageWidth: unscaledViewport.width,
      pageHeight: unscaledViewport.height,
    };
  } catch (err) {
    warnDegraded(err);
    return null;
  }
}

/** Crops a region (PDF user space, origin bottom-left) out of a
 *  full-page raster (canvas pixel space, origin top-left) to its own PNG. */
export async function cropRegion(
  fullPagePng: Buffer,
  scale: number,
  pageHeight: number,
  region: { x0: number; x1: number; y0: number; y1: number },
): Promise<Buffer | null> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(fullPagePng);

    const cx0 = region.x0 * scale;
    const cx1 = region.x1 * scale;
    // PDF y grows upward from the bottom; canvas y grows downward from the
    // top — flip, and region.y1 (the higher PDF y) becomes the smaller
    // (top) canvas y.
    const cy0 = (pageHeight - region.y1) * scale;
    const cy1 = (pageHeight - region.y0) * scale;

    const width = Math.max(1, Math.round(cx1 - cx0));
    const height = Math.max(1, Math.round(cy1 - cy0));

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, -cx0, -cy0);
    return canvas.toBuffer("image/png");
  } catch (err) {
    warnDegraded(err);
    return null;
  }
}
