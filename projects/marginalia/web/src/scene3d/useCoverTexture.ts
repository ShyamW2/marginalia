import { useEffect, useState } from "react";
import { CanvasTexture, ImageLoader, SRGBColorSpace, Texture } from "three";

const loader = new ImageLoader();
// Keyed by resource id: a shelf mounts every book at once, and books remount
// on re-sort/re-filter — without a cache each remount would re-request and
// re-upload the same cover. Never evicted; the library is small enough
// (SPEC.md) that this is bounded by "how many books exist", not unbounded.
const cache = new Map<string, Texture>();

/**
 * The largest a cover is ever uploaded at, in texels.
 *
 * ⚠️ **Measured, not guessed** (TASKS.md M23 §A: "price the texture upload
 * before designing around it"). A shelf of 60 books built from the real fixture
 * covers uploaded **465 MB** of pixel data — the covers arrive at their source
 * resolution, around 1200×1800, or 8.6 MB of VRAM each, and every one of them
 * is *drawn* at 168×252 CSS px on the Desk and at a foreshortened ~235×352 on
 * the shelf. Nothing on any surface can show a texel of the difference.
 *
 * 384×576 is twice the largest on-screen size, which covers a 2× display, and
 * takes the same shelf to roughly 53 MB. The bound is on the longest edge so a
 * cover with an unusual aspect ratio is still bounded by area.
 */
const MAX_COVER_EDGE = 576;

/** Downscale on the CPU before the GPU ever sees it, preserving aspect. Returns
 * the source untouched when it is already small enough — most covers are not. */
function fit(image: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  const scale = MAX_COVER_EDGE / Math.max(image.naturalWidth, image.naturalHeight);
  if (!(scale < 1)) return image;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return image;
  // The browser's own resampler, which is mipmap-quality and runs off the main
  // thread's pixel loop — a manual box filter here would be slower and worse.
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Loads a book's cover art as a three.js texture from the same endpoint
 * `BookCover` uses, mirroring its own fallback contract: a missing cover
 * (404, or no cover declared) resolves to `null` rather than rejecting, so a
 * consumer can fall back to a plain face exactly as `BookCover` falls back
 * to a lettered tile.
 *
 * The returned texture's `image` is a plain 2D image source, which is also what
 * `useSpinePalette` samples the binding colour out of.
 */
export function useCoverTexture(resourceId: string): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(() => cache.get(resourceId) ?? null);

  useEffect(() => {
    const cached = cache.get(resourceId);
    if (cached) {
      setTexture(cached);
      return;
    }
    let cancelled = false;
    loader.load(
      `/api/resources/${resourceId}/cover`,
      (image) => {
        const source = fit(image);
        // CanvasTexture when it was resampled (it carries a canvas), a plain
        // Texture when the source was already small enough.
        const loaded =
          source instanceof HTMLCanvasElement ? new CanvasTexture(source) : new Texture(source);
        loaded.colorSpace = SRGBColorSpace;
        loaded.needsUpdate = true;
        cache.set(resourceId, loaded);
        if (!cancelled) setTexture(loaded);
      },
      undefined,
      () => {
        // Expected for a book with no cover art (BookCover.tsx's onError
        // path does the same) — not an error worth surfacing.
        if (!cancelled) setTexture(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  return texture;
}
