/**
 * M18 "tighter bleed and a zoom" (decisions.md 2026-07-28): a viewport
 * transform over the strip's existing 0-100% domain, so a dense cluster
 * can be opened up without touching the underlying positions the heat
 * field and hit-targets already agree on. `pan` is the fraction (0-1) at
 * the *left* edge of the current view; the view always shows exactly
 * `1/zoom` of the domain, so `pan` is bounded to `[0, 1 - 1/zoom]`.
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;
const ZOOM_STEP = 1.6;

export interface ZoomState {
  zoom: number;
  pan: number;
}

export function clampPan(pan: number, zoom: number): number {
  const maxPan = Math.max(0, 1 - 1 / zoom);
  return Math.min(maxPan, Math.max(0, pan));
}

/** Zooms in one step, keeping the center of the current view fixed. */
export function zoomIn(state: ZoomState): ZoomState {
  const zoom = Math.min(MAX_ZOOM, state.zoom * ZOOM_STEP);
  const center = state.pan + 0.5 / state.zoom;
  return { zoom, pan: clampPan(center - 0.5 / zoom, zoom) };
}

/** Zooms out one step, keeping the center of the current view fixed;
 * snaps cleanly to (1, 0) rather than leaving float residue near the
 * bottom of the range. */
export function zoomOut(state: ZoomState): ZoomState {
  const zoom = Math.max(MIN_ZOOM, state.zoom / ZOOM_STEP);
  if (zoom <= MIN_ZOOM) return { zoom: MIN_ZOOM, pan: 0 };
  const center = state.pan + 0.5 / state.zoom;
  return { zoom, pan: clampPan(center - 0.5 / zoom, zoom) };
}

/** Pans by a fraction of the *current view's* width (not the whole domain)
 * — a step feels the same size regardless of how far zoomed in you are. */
export function panByViewFraction(state: ZoomState, fraction: number): ZoomState {
  const viewWidth = 1 / state.zoom;
  return { zoom: state.zoom, pan: clampPan(state.pan + fraction * viewWidth, state.zoom) };
}

/** Raw domain fraction (0-1) -> position within the current view (0-1),
 * before the barrel warp. Composes with warp.ts by feeding its result (in
 * strip px) into `warpPoint` — this function only handles the zoom/pan
 * half of that composition. */
export function fractionToView(fraction: number, state: ZoomState): number {
  return (fraction - state.pan) * state.zoom;
}
