import { useEffect, useState } from "react";
import { Texture, TextureLoader, SRGBColorSpace } from "three";

const loader = new TextureLoader();
// Keyed by resource id: a shelf mounts every book at once, and books remount
// on re-sort/re-filter — without a cache each remount would re-request and
// re-upload the same cover. Never evicted; the library is small enough
// (SPEC.md) that this is bounded by "how many books exist", not unbounded.
const cache = new Map<string, Texture>();

/**
 * Loads a book's cover art as a three.js texture from the same endpoint
 * `BookCover` uses, mirroring its own fallback contract: a missing cover
 * (404, or no cover declared) resolves to `null` rather than rejecting, so a
 * consumer can fall back to a plain face exactly as `BookCover` falls back
 * to a lettered tile.
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
      (loaded) => {
        loaded.colorSpace = SRGBColorSpace;
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
