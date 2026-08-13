import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * The desk's board material, painted into a canvas texture.
 *
 * Shared by the Desk's surface (`DeskScene3D.tsx`) and the shelf's plank
 * (`ShelfScene3D.tsx`) since M23 §D — they are the same piece of furniture seen
 * from two angles, and two boards with different grain in the same room would
 * read as two different rooms.
 */

/** One tile of the desk's grain, in px. Long low-frequency fibers rather than
 * isotropic noise — the same anisotropy `DeskCanvas.module.css`'s 2D `.grain`
 * uses, so the two presentations read as the same material. */
export const GRAIN_TILE_WIDTH = 512;
export const GRAIN_TILE_HEIGHT = 256;

/**
 * Paints the desk's grain into a 2D canvas once per theme. A texture rather
 * than a shader because it is the cheapest thing that survives a lost context
 * gracefully and needs no per-frame work, and 2D canvas is already how the
 * rest of the app draws (`CursorTrail.tsx`).
 */
export function makeWoodTexture(surface: string, grain: string): CanvasTexture | null {
  const canvas = document.createElement("canvas");
  canvas.width = GRAIN_TILE_WIDTH;
  canvas.height = GRAIN_TILE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, GRAIN_TILE_WIDTH, GRAIN_TILE_HEIGHT);

  // Deterministic: the desk must not reshuffle its own grain on a re-render
  // or a theme toggle.
  let seed = 20260813;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  ctx.strokeStyle = grain;
  ctx.lineCap = "round";
  for (let i = 0; i < 220; i += 1) {
    const y = random() * GRAIN_TILE_HEIGHT;
    const amplitude = 1 + random() * 5;
    const wavelength = 120 + random() * 260;
    const phase = random() * Math.PI * 2;
    ctx.globalAlpha = 0.05 + random() * 0.16;
    ctx.lineWidth = 0.4 + random() * 1.5;
    ctx.beginPath();
    for (let x = 0; x <= GRAIN_TILE_WIDTH; x += 8) {
      const wobble = Math.sin((x / wavelength) * Math.PI * 2 + phase) * amplitude;
      if (x === 0) ctx.moveTo(x, y + wobble);
      else ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // Grazing angles at the far edge of a wide field of view are exactly where
  // an unfiltered tile turns to moiré.
  texture.anisotropy = 8;
  return texture;
}

