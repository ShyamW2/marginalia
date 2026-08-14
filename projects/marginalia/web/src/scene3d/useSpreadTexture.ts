import { useEffect, useState } from "react";
import { SRGBColorSpace, Texture, TextureLoader } from "three";

const loader = new TextureLoader();

export interface SpreadTextures {
  /** The image's left half, for the page on the opened front board. */
  left: Texture;
  /** Its right half, for the page block's top. */
  right: Texture;
}

/**
 * One picture of the reading pane, cut down the middle into the two pages of
 * an open book (M23 §E, 2026-08-14).
 *
 * The cut is `offset`/`repeat` on two textures sharing one image rather than
 * two rasterizations of half a page each: the source is a single `data:` URL
 * from `reader/pageSnapshot.ts` (the page curl's own capture, reused), and
 * splitting it in the sampler costs nothing and cannot disagree with itself
 * about where the crease is. Half the image lands on each page, so the spread
 * as a whole shows exactly what the pane shows — which is the property that
 * makes the landing's final crossfade a swap between two pictures of the same
 * thing rather than a dissolve between two different ones.
 *
 * ⚠️ Both textures wrap the *same* `Texture.image`, but they must be two
 * `Texture` objects: `offset` and `repeat` live on the texture, not on the
 * material, so a shared instance would put the same half on both pages.
 *
 * `null` for a null source, and `null` if the image fails to decode — the
 * caller falls back to blank paper, which is what the spread was before this
 * existed and remains the correct degradation.
 */
export function useSpreadTexture(src: string | null): SpreadTextures | null {
  const [textures, setTextures] = useState<SpreadTextures | null>(null);

  useEffect(() => {
    if (!src) {
      setTextures(null);
      return;
    }
    let cancelled = false;
    let loaded: SpreadTextures | null = null;
    loader.load(
      src,
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        const right = texture;
        // `clone()` shares the image (and so the GPU upload) while carrying
        // its own sampler state — the whole point of the split above.
        const left = texture.clone();
        left.colorSpace = SRGBColorSpace;
        left.offset.set(0, 0);
        left.repeat.set(0.5, 1);
        right.offset.set(0.5, 0);
        right.repeat.set(0.5, 1);
        left.needsUpdate = true;
        right.needsUpdate = true;
        loaded = { left, right };
        if (cancelled) {
          left.dispose();
          right.dispose();
          return;
        }
        setTextures(loaded);
      },
      undefined,
      () => {
        if (!cancelled) setTextures(null);
      },
    );
    return () => {
      cancelled = true;
      // Not cached, unlike covers: this is one book's one page, captured for
      // one transition and never wanted again.
      loaded?.left.dispose();
      loaded?.right.dispose();
    };
  }, [src]);

  return textures;
}
