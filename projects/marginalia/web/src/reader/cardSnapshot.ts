/**
 * M20 step 2: the turning sheet is the **paper card**, not the text column.
 *
 * `pageSnapshot.ts` captures the element epub.js renders into
 * (`.epubContainer`), which sits inside `.marginWrapper`'s padding — so its
 * bitmap is the text column and stops one reader margin short of the sheet's
 * edge on every side. Folding that rectangle reads as peeling a page pasted
 * onto the paper rather than peeling the paper: the reader margin stays
 * behind, flat, while the print lifts off it.
 *
 * The fix is deliberately *not* to capture more. The captured element is the
 * only one whose contents are hard to serialize (an iframe — see
 * PAGE_CURL.md §5, four of whose lines exist because of a failure that
 * renders a plausible but wrong bitmap); the margin band around it is flat
 * paper, one colour, and the card's own background is that same colour by
 * construction (ReaderView.module.css `.stage` — the M16 fix that pinned it
 * to the epub body's `--color-bg`). So the card bitmap is the page bitmap
 * composited into a larger canvas over that colour, and nothing here has to
 * know anything about the app's CSS.
 *
 * The result is handed to `PageCurl` as a canvas rather than a data URL: it
 * is drawn, never transported, and a PNG encode plus a decode per page turn
 * is a real cost on the interaction path for no benefit.
 */
import { samplePaperColor, type Rgb } from "./pageFold.js";
import { recordSnapshotDebug } from "./snapshotDebug.js";

/** Where the captured content sits inside the card, in CSS px. All four
 * numbers come from `getBoundingClientRect()` on `.pageClip` and
 * `.epubContainer`, so the offsets are whatever the live layout says they
 * are — the margin token is never re-derived here. */
export interface CardLayout {
  cardWidth: number;
  cardHeight: number;
  contentWidth: number;
  contentHeight: number;
  /** The content's top-left within the card. */
  offsetX: number;
  offsetY: number;
}

export interface CardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function cardLayout(card: CardRect, content: CardRect): CardLayout {
  return {
    cardWidth: card.width,
    cardHeight: card.height,
    contentWidth: content.width,
    contentHeight: content.height,
    offsetX: content.left - card.left,
    offsetY: content.top - card.top,
  };
}

/** The card bitmap's size and where the page bitmap lands in it, in the
 * *bitmap's* own pixels. The snapshot is captured at whatever device scale
 * `pageSnapshot` chose, so the scale is read back from the bitmap rather
 * than assumed to be `devicePixelRatio` — the two disagree the moment a
 * capture is clamped or a window moves between displays mid-session. */
export function cardCompositeRect(
  layout: CardLayout,
  bitmapWidth: number,
  bitmapHeight: number,
): { scale: number; width: number; height: number; dx: number; dy: number } {
  const scale = layout.contentWidth > 0 ? bitmapWidth / layout.contentWidth : 1;
  return {
    scale,
    width: Math.max(1, Math.round(layout.cardWidth * scale)),
    height: Math.max(1, Math.round(layout.cardHeight * scale)),
    dx: Math.round(layout.offsetX * scale),
    dy: Math.round(layout.offsetY * scale),
  };
}

/**
 * The colour to paint the margin band, taken from the element that actually
 * paints it.
 *
 * `samplePaperColor` is the wrong instrument here and it was measured being
 * wrong: it downscales the bitmap to 8x8 and takes the median, which on a
 * page of prose averages ink into every tile — rgb(228,225,218) against the
 * card's real rgb(250,247,240), a difference you can see as a band the
 * moment the sheet lifts. It stays the right instrument for the *back* of
 * the sheet, which only wants "roughly what colour is this paper".
 *
 * The margin is the card's own background, so this walks up from the card
 * for the first ancestor that paints one (`.pageClip` is transparent; the
 * `.stage` above it is where `--color-bg` lands) and returns it verbatim.
 * That is one computed value, not a re-implementation of the app's CSS, and
 * it is exact by construction whatever the reading theme.
 */
export function resolveCardPaper(card: Element | null): string | null {
  for (let el: Element | null = card; el; el = el.parentElement) {
    const color = getComputedStyle(el).backgroundColor;
    if (!color) continue;
    if (color === "transparent") continue;
    // rgba(...,'0') — any fully transparent background paints nothing.
    if (/^rgba\(.*,\s*0(\.0+)?\)$/.test(color)) continue;
    return color;
  }
  return null;
}

/**
 * Decodes a snapshot data URL. Exported because the M20 step 3 slide needs
 * the *image*, not a canvas: it paints the departing card as one `<img>` over
 * the card's own background rather than compositing the two together, so
 * `composeCardSnapshot` below is exactly one canvas and one blit it can skip.
 * Resolves `null` on a snapshot that will not decode, which every caller
 * treats as a failed capture.
 */
export function loadSnapshotImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

const rgbCss = (rgb: Rgb) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

/**
 * Composites a page snapshot into a card-sized canvas over the page's own
 * paper colour. Returns `null` if the snapshot will not decode, which the
 * caller must treat exactly as a failed capture (fall back to the slide) —
 * a fold over a blank card is the failure mode PAGE_CURL.md §5 exists to
 * prevent.
 */
export async function composeCardSnapshot(
  src: string,
  layout: CardLayout,
  paper?: string | null,
): Promise<HTMLCanvasElement | null> {
  const image = await loadSnapshotImage(src);
  if (!image || !image.naturalWidth || !image.naturalHeight) return null;

  const rect = cardCompositeRect(layout, image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // `paper` is the card's own computed background (`resolveCardPaper`), which
  // is exact. Sampling the bitmap is the fallback for a caller that has no
  // element to ask — close enough that the fold still reads as paper, off by
  // enough to be visible, so it is not the default.
  ctx.fillStyle = paper ?? rgbCss(samplePaperColor(image));
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, rect.dx, rect.dy);

  // M31 §0h: see snapshotDebug.ts — the other of the two log points, paired
  // with pageSnapshot.rasterize's. `rect` is `cardCompositeRect`'s output,
  // the leading suspect per 0g: it recovers scale as a ratio
  // (bitmapWidth / layout.contentWidth), which is silently wrong the moment
  // either side was measured off a viewport that isn't the visible one.
  if (import.meta.env.DEV) {
    console.debug("[marginalia] cardSnapshot.composeCardSnapshot", {
      "image.naturalWidth": image.naturalWidth,
      "image.naturalHeight": image.naturalHeight,
      layout,
      rect,
    });
    recordSnapshotDebug({ composedDataUrl: canvas.toDataURL("image/png") });
  }
  return canvas;
}
