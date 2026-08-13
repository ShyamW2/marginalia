/**
 * The binding's colours, derived from the cover art rather than chosen.
 *
 * A real book's cloth is dyed to go with its jacket, and a shelf of books whose
 * spines are all the same brown reads as a set of tiles rather than a set of
 * objects — the same failure `deskDepthMath.ts`'s `bookThickness` exists to
 * avoid in the other dimension. So the binding takes a **prominent colour from
 * the cover**, and the lettering takes whichever ink is legible against it.
 *
 * The extraction is deliberately dumb: quantize, weight, average. Anything
 * cleverer (k-means, median cut) buys accuracy this doesn't need — the target
 * is "recognisably this book's colour", not a faithful dominant hue — and would
 * cost time on the main thread while a shelf is mounting.
 *
 * Kept apart from the component and from any canvas so it is unit-testable
 * without a GPU or a DOM, the same split as `bookGeometry.ts`.
 */

export interface SpinePalette {
  /** The cloth: a prominent colour from the cover, `#rrggbb`. */
  binding: string;
  /** Lettering that is legible on `binding`, `#rrggbb`. */
  ink: string;
}

/** Bits of each channel kept when bucketing. 4 bits = 16 levels = 4096
 * buckets: coarse enough that a photographic gradient lands in one bucket
 * instead of scattering across a hundred, fine enough to keep two nearby
 * brand colours apart. */
const QUANT_BITS = 4;
const QUANT_SHIFT = 8 - QUANT_BITS;

/** Paper and ink are *everywhere* on a book cover and are almost never what
 * anyone means by "its colour" — so near-white and near-black are heavily
 * discounted rather than excluded, which keeps an all-grey cover from having
 * no answer at all. */
const EXTREME_LIGHTNESS_WEIGHT = 0.12;
const NEAR_WHITE = 0.9;
const NEAR_BLACK = 0.07;

/** Bindings live in a band: lighter than this and the book disappears against
 * a pale desk, darker and every dark cover produces the same black slab. */
const MIN_BINDING_LIGHTNESS = 0.14;
const MAX_BINDING_LIGHTNESS = 0.82;

const DARK_INK = "#1c1814";
const LIGHT_INK = "#f7f2e8";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toHex({ r, g, b }: Rgb): string {
  const part = (channel: number) =>
    Math.round(clamp01(channel) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(r / 255)}${part(g / 255)}${part(b / 255)}`;
}

/** Channels in 0–255; h in turns, s and l in 0–1. */
function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  return { h: (h / 6 + 1) % 1, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 1) + 1) % 1;
  const x = c * (1 - Math.abs(((hp * 6) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  const sector = Math.floor(hp * 6);
  if (sector === 0) rgb = [c, x, 0];
  else if (sector === 1) rgb = [x, c, 0];
  else if (sector === 2) rgb = [0, c, x];
  else if (sector === 3) rgb = [0, x, c];
  else if (sector === 4) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

/** WCAG relative luminance, 0–1. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = clamp01(value / 255);
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function parseHex(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/**
 * Whichever of the two inks reads better on `binding`. Two fixed inks rather
 * than a computed tint: spine lettering is either foil-light or stamped-dark,
 * and a per-book computed ink would drift into low-contrast mud on exactly the
 * mid-lightness bindings where legibility is already hardest.
 */
export function inkFor(binding: string): string {
  const bg = parseHex(binding);
  return contrastRatio(bg, parseHex(LIGHT_INK)) >= contrastRatio(bg, parseHex(DARK_INK))
    ? LIGHT_INK
    : DARK_INK;
}

/** Pull a binding colour into the band where it reads as dyed cloth: never so
 * pale it vanishes against the desk, never so dark that every dark cover
 * produces the same slab, and with a touch of saturation back (averaging a
 * bucket always desaturates, since it averages toward grey). */
function asCloth(rgb: Rgb): Rgb {
  const { h, s, l } = rgbToHsl(rgb);
  return hslToRgb(
    h,
    Math.min(1, s * 1.14),
    Math.min(MAX_BINDING_LIGHTNESS, Math.max(MIN_BINDING_LIGHTNESS, l)),
  );
}

/**
 * A prominent colour from RGBA pixel data (any size — sample it down before
 * calling; `useCoverPalette` uses 48×72).
 *
 * Returns `null` for pixel data with nothing to say (empty, or fully
 * transparent), so the caller can fall back deterministically rather than
 * being handed a plausible-looking black.
 */
export function spinePaletteFromPixels(pixels: Uint8ClampedArray): SpinePalette | null {
  if (pixels.length < 4) return null;
  const weights = new Map<number, { w: number; r: number; g: number; b: number }>();
  let total = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const { s, l } = rgbToHsl({ r, g, b });
    // Colourfulness is most of the signal — a cover's *character* colour is
    // almost always its most saturated large area, not its largest area.
    let w = 0.15 + s;
    if (l > NEAR_WHITE || l < NEAR_BLACK) w *= EXTREME_LIGHTNESS_WEIGHT;
    const key =
      ((r >> QUANT_SHIFT) << (QUANT_BITS * 2)) | ((g >> QUANT_SHIFT) << QUANT_BITS) | (b >> QUANT_SHIFT);
    const bucket = weights.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
    bucket.w += w;
    bucket.r += r * w;
    bucket.g += g * w;
    bucket.b += b * w;
    weights.set(key, bucket);
    total += w;
  }

  if (total === 0) return null;

  let best: { w: number; r: number; g: number; b: number } | null = null;
  for (const bucket of weights.values()) {
    if (!best || bucket.w > best.w) best = bucket;
  }
  if (!best) return null;

  const binding = toHex(asCloth({ r: best.r / best.w, g: best.g / best.w, b: best.b / best.w }));
  return { binding, ink: inkFor(binding) };
}

/**
 * The binding for a book with no cover art, deterministic per resource id — so
 * an uncovered book is still a distinct object on the shelf rather than one of
 * a row of identical blanks, and is the *same* object every session and on
 * every surface (the same contract `bookThickness` carries).
 *
 * Muted on purpose: this is the fallback, and a book that shouted louder than
 * the ones with real cover art would invert the emphasis.
 */
export function fallbackPalette(resourceId: string): SpinePalette {
  let hash = 0;
  for (let i = 0; i < resourceId.length; i += 1) {
    hash = (hash * 31 + resourceId.charCodeAt(i)) >>> 0;
  }
  const rgb = hslToRgb((hash % 360) / 360, 0.26, 0.38);
  const binding = toHex(rgb);
  return { binding, ink: inkFor(binding) };
}
