import type { HighlightKind } from "@marginalia/shared";
import { KIND_ORDER, phosphorRgb } from "./scanPalette.js";

/**
 * M15 "bleeding heat field" (decisions.md 2026-07-20), M18 "heat is coloured
 * by meaning again" (decisions.md 2026-07-28): a continuous density field
 * replacing the old discrete bands as the strip's *visual* — the bands
 * themselves survive underneath as invisible hit-targets (HeatStrip.tsx),
 * so hover/click/filter/dim behaviour is untouched, this only changes what
 * gets painted.
 *
 * M15 shipped one density layer through a fixed cool→hot ramp, which lost
 * the "what's what" reading M9's discrete bands had. M18 restores it with
 * two channels: accumulate one density layer *per highlight kind*, then per
 * pixel take the summed density across all four for brightness/alpha and
 * the highest-density kind for hue. `"density"` mode keeps the M15 ramp
 * available (ignoring kind entirely) for "where did I annotate most",
 * which the two-channel view genuinely isn't as good at.
 */

export type HeatColorMode = "kind" | "density";

export interface HeatPoint {
  /** 0-1 position along the strip. */
  xFraction: number;
  /** 0-1 — note length/thread depth, already dimmed for a filtered-out
   * highlight by the caller so the field and the bands agree. */
  weight: number;
  kind: HighlightKind;
}

const DENSITY_STOPS: [number, [number, number, number]][] = [
  [0, [8, 14, 40]],
  [0.28, [32, 64, 170]],
  [0.55, [150, 45, 190]],
  [0.78, [235, 75, 60]],
  [1, [255, 214, 100]],
];

function densityColor(t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  let lo = DENSITY_STOPS[0]!;
  let hi = DENSITY_STOPS[DENSITY_STOPS.length - 1]!;
  for (let i = 0; i < DENSITY_STOPS.length - 1; i++) {
    if (clamped >= DENSITY_STOPS[i]![0] && clamped <= DENSITY_STOPS[i + 1]![0]) {
      lo = DENSITY_STOPS[i]!;
      hi = DENSITY_STOPS[i + 1]!;
      break;
    }
  }
  const span = hi[0] - lo[0];
  const localT = span > 0 ? (clamped - lo[0]) / span : 0;
  const [r0, g0, b0] = lo[1];
  const [r1, g1, b1] = hi[1];
  return [r0 + (r1 - r0) * localT, g0 + (g1 - g0) * localT, b0 + (b1 - b0) * localT];
}

/** Dim toward black at low density, full phosphor colour at high density —
 * the "kind" mode's per-pixel colour once the dominant category is known. */
function kindColor(kind: HighlightKind, t: number): [number, number, number] {
  const [r, g, b] = phosphorRgb(kind);
  const brightness = 0.35 + 0.65 * Math.min(1, t);
  return [r * brightness, g * brightness, b * brightness];
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
  mode: HeatColorMode = "kind",
): void {
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  canvas.width = w;
  canvas.height = h;

  const visCtx = canvas.getContext("2d");
  if (!visCtx) return;
  visCtx.clearRect(0, 0, w, h);
  if (points.length === 0) return;

  // One density layer per kind (decisions.md "accumulate one density layer
  // per category"), plus the running total — this is the "two-channel"
  // part: hue reads off the per-kind layers, brightness off the total.
  const layers = new Map<HighlightKind, Float32Array>(KIND_ORDER.map((k) => [k, new Float32Array(w * h)]));

  for (const point of points) {
    if (point.weight <= 0) continue;
    const layer = layers.get(point.kind);
    if (!layer) continue;
    const cx = point.xFraction * w;
    const cy = baselineY * dpr - (18 + point.weight * 46) * dpr * 0.55;
    const radius = (26 + point.weight * 44) * dpr;
    const baseAlpha = Math.min(1, 0.35 + point.weight * 0.55);

    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(w - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(h - 1, Math.ceil(cy + radius));
    for (let py = minY; py <= maxY; py++) {
      const dy = py - cy;
      for (let px = minX; px <= maxX; px++) {
        const dx = px - cx;
        const t = Math.sqrt(dx * dx + dy * dy) / radius;
        if (t >= 1) continue;
        const falloff = (1 - t) * (1 - t);
        layer[py * w + px] += baseAlpha * falloff;
      }
    }
  }

  const imageData = visCtx.createImageData(w, h);
  const data = imageData.data;
  const kinds = KIND_ORDER;
  for (let i = 0; i < w * h; i++) {
    let total = 0;
    let dominant: HighlightKind = kinds[0]!;
    let dominantDensity = -1;
    for (const kind of kinds) {
      const density = layers.get(kind)![i]!;
      total += density;
      if (density > dominantDensity) {
        dominantDensity = density;
        dominant = kind;
      }
    }
    if (total <= 0.008) continue;
    const t = Math.min(1, total);
    const [r, g, b] = mode === "density" ? densityColor(t) : kindColor(dominant, t);
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = Math.min(255, Math.round(t * 235));
  }
  visCtx.putImageData(imageData, 0, 0);
}
