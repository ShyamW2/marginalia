import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";
import type { SpinePalette } from "./coverPalette.js";
import { fitSpineTitle } from "./spineLayout.js";

/**
 * Paints a book's spine — cloth, head rule, and the title running head to tail
 * — into a canvas texture for `Book3D`'s round back.
 *
 * ## Why a canvas and not an SVG or a DOM label
 *
 * The spine is a *curved* surface (`bookGeometry.ts`: a bound book has no flat
 * spine), so the lettering has to be part of its material — there is no flat
 * rectangle to hang a DOM node on that would still line up once the book is
 * laid flat on the Desk or turned side-on into the opening. Canvas is also
 * already how this app draws pixels (`CursorTrail.tsx`, the desk's grain), and
 * it survives a lost context by simply being re-uploaded.
 *
 * ## Orientation, which is easy to get mirrored
 *
 * `CylinderGeometry`'s `v` runs along its axis — the book's own height — and
 * `CanvasTexture` keeps three.js's default `flipY`, so **canvas row 0 is the
 * book's head**. Text painted from the top of the canvas downward therefore
 * reads head-to-tail, which is how English-language spines are lettered and
 * how they read on a shelf without tilting your own head the wrong way. `u`
 * runs across the arc, so the canvas's width is the spine's width.
 */

export interface SpineTextureRequest {
  resourceId: string;
  title: string;
  palette: SpinePalette;
  /** The spine's length (the book's height) and its width across the arc, in
   * the same world px everything else in the seam uses. */
  lengthPx: number;
  widthPx: number;
}

/** Texels per world px. 2 is enough for the lettering to stay crisp on a
 * hi-dpi screen at the closest any surface gets to a spine; above it the
 * upload cost climbs with nothing visible in return (measurement in NOTES.md,
 * M23 §D). */
const TEXEL_SCALE = 2;
/** Bounds on the painted canvas so a pathological size can't allocate a
 * surface the GPU will refuse. */
const MAX_CANVAS_EDGE = 2048;

// One texture per book, kept for the session. A book's spine does not change,
// and a shelf remounts every book whenever the view mode changes — the same
// rationale (and the same "the library is small enough" bound, SPEC.md) as the
// cover cache in `useCoverTexture.ts`.
const cache = new Map<string, CanvasTexture>();

const FONT_STACK = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;

/**
 * Deterministic weave, drawn once per texture: a real binding is cloth, and a
 * perfectly flat colour under a moving light reads as plastic. Seeded from the
 * texture's own size so it never reshuffles between renders of the same book.
 */
function paintCloth(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  let seed = (width * 73856093) ^ (height * 19349663);
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  ctx.save();
  for (let y = 0; y < height; y += 3) {
    ctx.globalAlpha = 0.018 + random() * 0.03;
    ctx.fillStyle = random() > 0.5 ? "#ffffff" : "#000000";
    ctx.fillRect(0, y, width, 1.5);
  }
  ctx.restore();
}

function paint(request: SpineTextureRequest): HTMLCanvasElement {
  const { title, palette, lengthPx, widthPx } = request;
  const canvas = document.createElement("canvas");
  const width = Math.min(MAX_CANVAS_EDGE, Math.max(8, Math.round(widthPx * TEXEL_SCALE)));
  const height = Math.min(MAX_CANVAS_EDGE, Math.max(8, Math.round(lengthPx * TEXEL_SCALE)));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = palette.binding;
  ctx.fillRect(0, 0, width, height);
  paintCloth(ctx, width, height);

  // The joints where the cloth turns onto the boards, which is where a real
  // binding catches the light. Two thin gradients rather than a bevel: the
  // geometry is already round, so this only has to *shade* the curve.
  const shade = ctx.createLinearGradient(0, 0, width, 0);
  shade.addColorStop(0, "rgba(0,0,0,0.28)");
  shade.addColorStop(0.28, "rgba(255,255,255,0.07)");
  shade.addColorStop(0.72, "rgba(255,255,255,0.05)");
  shade.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);

  // ⚠️ Fitted in **world px, then scaled up** — not fitted in canvas px.
  // `spineLayout.ts`'s type bounds are sizes a reader sees on screen, so
  // measuring in texels silently divides every one of them by `TEXEL_SCALE`:
  // the first cut passed the canvas's own dimensions and capped every spine at
  // half the intended lettering, which reads as timid rather than as wrong.
  const set = fitSpineTitle(title, lengthPx, widthPx, (text, fontPx) => {
    ctx.font = `500 ${fontPx * TEXEL_SCALE}px ${FONT_STACK}`;
    return ctx.measureText(text).width / TEXEL_SCALE;
  });
  const fontPx = set.fontPx * TEXEL_SCALE;
  const titleStart = set.start * TEXEL_SCALE;

  ctx.fillStyle = palette.ink;

  // The head rule: a short band across the spine, above the title. It is not
  // decoration — it is what tells you which end of the book is up when a shelf
  // of spines is the only thing you can see.
  const ruleWidth = width * 0.5;
  const ruleThickness = Math.max(1, height * 0.0016);
  ctx.globalAlpha = 0.75;
  ctx.fillRect((width - ruleWidth) / 2, titleStart * 0.55, ruleWidth, ruleThickness);
  ctx.globalAlpha = 1;

  // Rotate into the spine's long axis: +90° puts the text baseline running
  // down the canvas, reading head to tail (see this module's header).
  ctx.save();
  ctx.translate(width / 2, titleStart);
  ctx.rotate(Math.PI / 2);
  ctx.font = `500 ${fontPx}px ${FONT_STACK}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(set.text, 0, 0);
  ctx.restore();

  return canvas;
}

/**
 * The spine texture for a book, painted once and cached. Returns `null` when
 * there is no canvas to paint into (jsdom under test), so `Book3D` falls back
 * to a plain dyed spine exactly as it falls back to a plain cover.
 */
export function spineTexture(request: SpineTextureRequest): CanvasTexture | null {
  const key = [
    request.resourceId,
    request.title,
    request.palette.binding,
    Math.round(request.lengthPx),
    Math.round(request.widthPx),
  ].join("|");
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = paint(request);
  if (!canvas.getContext("2d")) return null;

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // No mipmaps: the spine is never seen small enough to need them, and
  // generating them for a 2048-tall strip is most of the upload cost.
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  cache.set(key, texture);
  return texture;
}
