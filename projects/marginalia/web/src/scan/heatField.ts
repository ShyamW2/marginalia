/**
 * M15 "bleeding heat field" (decisions.md 2026-07-20): a continuous
 * cool→hot density field replacing the old discrete bands as the strip's
 * *visual* — the bands themselves survive underneath as invisible
 * hit-targets (HeatStrip.tsx), so hover/click/filter/dim behaviour is
 * untouched, this only changes what gets painted.
 *
 * Two-pass technique: paint every highlight as a white radial-gradient blob
 * with `globalCompositeOperation: "lighter"` onto an offscreen canvas — since
 * every blob is the same colour, additive blending leaves the *alpha*
 * channel holding a genuine summed density (0-1, clamped) with the colour
 * channels staying white throughout. A second pass walks the pixel buffer,
 * turning that density into a colour via `heatColor` and using the density
 * itself as the final per-pixel opacity, then blits the result onto the
 * visible canvas with a single `putImageData` (which bypasses `lighter` and
 * writes pixels directly, so no double-blending against whatever glow was
 * there before).
 */

export interface HeatPoint {
  /** 0-1 position along the strip. */
  xFraction: number;
  /** 0-1 — note length/thread depth, already dimmed for a filtered-out
   * highlight by the caller so the field and the bands agree. */
  weight: number;
}

const STOPS: [number, [number, number, number]][] = [
  [0, [8, 14, 40]],
  [0.28, [32, 64, 170]],
  [0.55, [150, 45, 190]],
  [0.78, [235, 75, 60]],
  [1, [255, 214, 100]],
];

function heatColor(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  let lo = STOPS[0]!;
  let hi = STOPS[STOPS.length - 1]!;
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (clamped >= STOPS[i]![0] && clamped <= STOPS[i + 1]![0]) {
      lo = STOPS[i]!;
      hi = STOPS[i + 1]!;
      break;
    }
  }
  const span = hi[0] - lo[0];
  const localT = span > 0 ? (clamped - lo[0]) / span : 0;
  const [r0, g0, b0] = lo[1];
  const [r1, g1, b1] = hi[1];
  return [r0 + (r1 - r0) * localT, g0 + (g1 - g0) * localT, b0 + (b1 - b0) * localT];
}

/** Draws the density field for the given points onto `canvas`, sized to
 * `width`x`height` CSS px at `dpr` device pixels per CSS px. `baselineY` is
 * where a point's blob is centred vertically (in canvas px), matching the
 * strip's existing baseline so the field reads as "growing up from the
 * timeline" the way the old bars did. */
export function drawHeatField(
  canvas: HTMLCanvasElement,
  points: HeatPoint[],
  width: number,
  height: number,
  baselineY: number,
  dpr: number,
): void {
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  canvas.width = w;
  canvas.height = h;

  const visCtx = canvas.getContext("2d");
  if (!visCtx) return;
  visCtx.clearRect(0, 0, w, h);
  if (points.length === 0) return;

  const density = document.createElement("canvas");
  density.width = w;
  density.height = h;
  const dctx = density.getContext("2d");
  if (!dctx) return;
  dctx.globalCompositeOperation = "lighter";

  for (const point of points) {
    if (point.weight <= 0) continue;
    const x = point.xFraction * w;
    const y = baselineY * dpr - (18 + point.weight * 46) * dpr * 0.55;
    const radius = (26 + point.weight * 44) * dpr;
    const grad = dctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.35 + point.weight * 0.55)})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    dctx.fillStyle = grad;
    dctx.beginPath();
    dctx.arc(x, y, radius, 0, Math.PI * 2);
    dctx.fill();
  }

  const imageData = dctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]! / 255;
    if (alpha <= 0.008) {
      data[i + 3] = 0;
      continue;
    }
    const [r, g, b] = heatColor(alpha);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = Math.min(255, Math.round(alpha * 235));
  }
  visCtx.putImageData(imageData, 0, 0);
}
