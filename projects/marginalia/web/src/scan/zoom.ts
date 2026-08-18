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

/**
 * Zooms to `state.zoom * factor`, keeping whichever domain fraction
 * currently sits at `viewPosition` (0-1, same space `fractionToView`
 * returns) fixed at that same view position — the general form both the
 * zoom buttons and M20.5's wheel-to-zoom are built on. `viewPosition: 0.5`
 * (the view's center) is what the buttons use; wheel-to-zoom passes the
 * cursor's own position instead, so the point under it doesn't jump.
 */
export function zoomAtViewPosition(state: ZoomState, factor: number, viewPosition: number): ZoomState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
  if (zoom <= MIN_ZOOM) return { zoom: MIN_ZOOM, pan: 0 };
  const domainFraction = viewPosition / state.zoom + state.pan;
  const pan = domainFraction - viewPosition / zoom;
  return { zoom, pan: clampPan(pan, zoom) };
}

/** Zooms in one step, keeping the center of the current view fixed. */
export function zoomIn(state: ZoomState): ZoomState {
  return zoomAtViewPosition(state, ZOOM_STEP, 0.5);
}

/** Zooms out one step, keeping the center of the current view fixed;
 * snaps cleanly to (1, 0) rather than leaving float residue near the
 * bottom of the range. */
export function zoomOut(state: ZoomState): ZoomState {
  return zoomAtViewPosition(state, 1 / ZOOM_STEP, 0.5);
}

/** Pans by a fraction of the *current view's* width (not the whole domain)
 * — a step feels the same size regardless of how far zoomed in you are. */
export function panByViewFraction(state: ZoomState, fraction: number): ZoomState {
  const viewWidth = 1 / state.zoom;
  return { zoom: state.zoom, pan: clampPan(state.pan + fraction * viewWidth, state.zoom) };
}

/**
 * Adjusts `pan` (never `zoom`) so `domainFraction` lands inside the current
 * view, with a small margin — the find cursor's own auto-pan (TASKS.md
 * M24 C: "the strip auto-pans to keep the cursor in view"). A no-op both
 * when the fraction is already visible and at the default zoom (`clampPan`
 * forces `pan` to 0 whenever the whole domain already fits).
 */
export function panToReveal(state: ZoomState, domainFraction: number, margin = 0.05): ZoomState {
  const viewWidth = 1 / state.zoom;
  const marginFraction = Math.min(viewWidth / 2, viewWidth * margin);
  const viewStart = state.pan + marginFraction;
  const viewEnd = state.pan + viewWidth - marginFraction;
  if (domainFraction >= viewStart && domainFraction <= viewEnd) return state;
  const pan =
    domainFraction < viewStart
      ? domainFraction - marginFraction
      : domainFraction - viewWidth + marginFraction;
  return { zoom: state.zoom, pan: clampPan(pan, state.zoom) };
}

/** Raw domain fraction (0-1) -> position within the current view (0-1),
 * before the barrel warp. Composes with warp.ts by feeding its result (in
 * strip px) into `warpPoint` — this function only handles the zoom/pan
 * half of that composition. */
export function fractionToView(fraction: number, state: ZoomState): number {
  return (fraction - state.pan) * state.zoom;
}
