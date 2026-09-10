import { useEffect, useState } from "react";
import { fallbackPalette, spinePaletteFromPixels, type SpinePalette } from "./coverPalette.js";
import { useCoverTexture } from "./useCoverTexture.js";
import { LruCache } from "./lruCache.js";

// How large the cover is sampled at. The extraction quantizes to 4 bits a
// channel anyway (`coverPalette.ts`), so a thumbnail carries every bit of
// signal a full-size read would — at ~1/300th of the pixels to walk.
const SAMPLE_WIDTH = 48;
const SAMPLE_HEIGHT = 72;

// Keyed by resource id, like the cover cache it reads through: the answer
// cannot change (covers are immutable on import, settled decision 5), and a
// shelf remounts every book on every view change.
//
// M46 (DESKTOP.md §4.1): bounded, but with no `onEvict` — unlike
// `spineTexture.ts`/`useCoverTexture.ts`, a `SpinePalette` is a handful of
// plain RGB values, not a GPU resource. Giving it a `.dispose()` step by
// reflex, "because the other two caches have one", would be following the
// letter of the fix and not its reasoning. Same 120 cap as the cover cache
// it's derived from, so the two don't drift apart on the same shelf.
const MAX_CACHED_PALETTES = 120;
const cache = new LruCache<string, SpinePalette>(MAX_CACHED_PALETTES);

function sample(image: CanvasImageSource): SpinePalette | null {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(image, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    return spinePaletteFromPixels(ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data);
  } catch {
    // A cover that can't be read back (a tainted canvas, a decode that failed
    // between load and draw) is the no-cover case, not an error worth
    // surfacing — same contract as `useCoverTexture`'s own onError path.
    return null;
  }
}

/**
 * The binding colours for a book, read from its own cover art.
 *
 * Always returns a usable palette: a book whose cover hasn't loaded yet, or
 * has none at all, gets its deterministic fallback, so nothing downstream has
 * to handle a null and no book ever renders untinted while it waits.
 */
export function useSpinePalette(resourceId: string): SpinePalette {
  const texture = useCoverTexture(resourceId);
  const [palette, setPalette] = useState<SpinePalette | null>(() => cache.get(resourceId) ?? null);

  useEffect(() => {
    const cached = cache.get(resourceId);
    if (cached) {
      setPalette(cached);
      return;
    }
    const image = texture?.image as CanvasImageSource | undefined;
    if (!image) return;
    const read = sample(image);
    if (!read) return;
    cache.set(resourceId, read);
    setPalette(read);
  }, [resourceId, texture]);

  return palette ?? fallbackPalette(resourceId);
}
