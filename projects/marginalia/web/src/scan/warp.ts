/**
 * M18 "whole-face barrel warp" (decisions.md 2026-07-28/2026-07-29): the
 * scan's single SVG filter bows the entire base screen outward toward the
 * edges, like a CRT face. This module is the one place that math lives, so
 * the filter's own displacement map (ScanCrtFilter.tsx, a canvas-rendered
 * bitmap — a plain `<radialGradient>` can only vary by radius, not by
 * direction, so it can't encode a genuinely radial push) and every
 * interactive element that must land where it visually appears (heat-band
 * hit-targets, the torch) derive from the *same* function, in the *same*
 * userSpaceOnUse px, instead of two hand-tuned approximations drifting
 * apart.
 *
 * feDisplacementMap semantics (SVG spec): the pixel painted at output
 * point (x,y) is *sampled from* input point (x + dx, y + dy) — a "pull",
 * not a translation of that point. `displacementAt` returns that pull
 * vector, pointed *toward* the center so that content is sampled from
 * nearer the middle and therefore visually stretches *outward* as it
 * approaches the edge — an actual magnifying bulge, not just "reads as
 * one". `warpPoint` answers the question every caller actually has — "a
 * graphic sits at raw point P0; where does it visually end up?" — via a
 * few fixed-point iterations on the pull relationship rather than a
 * closed-form inverse, because the pull vector is itself a smooth function
 * of the output point. Its magnitude is capped well below the radius, so
 * it varies slowly enough that this converges in a handful of steps to
 * sub-pixel accuracy — verified in warp.test.ts.
 */

export interface WarpGeometry {
  width: number;
  height: number;
  /** Warp center — the wrapper's own center. */
  cx: number;
  cy: number;
  /** Distance from center at which displacement saturates at its maximum. */
  r: number;
  /** Maximum pull magnitude in px (at and beyond `r`). 0 at intensity 0. */
  maxPull: number;
}

/** feDisplacementMap `scale` the filter uses is `2 * MAX_PULL_PX` (its dx/dy
 * range is +/-scale/2), so this is the single knob for "how strong". Raised
 * from 22 (M20.5, TASKS.md "barrel distortion scales further with CRT
 * intensity") — the larger base type (ScanPage.module.css et al.) buys back
 * the legibility this costs; M18's rule that intensity 0 is exactly zero
 * displacement is unchanged, this only moves what intensity 1 means. */
export const MAX_PULL_PX = 34;
/** Radius (as a fraction of the half-diagonal) at which displacement caps. */
const SATURATION_FRACTION = 0.75;

export function computeWarpGeometry(width: number, height: number, intensity: number): WarpGeometry {
  const cx = width / 2;
  const cy = height / 2;
  const halfDiagonal = Math.hypot(cx, cy);
  return {
    width,
    height,
    cx,
    cy,
    r: Math.max(1, halfDiagonal * SATURATION_FRACTION),
    maxPull: Math.max(0, intensity) * MAX_PULL_PX,
  };
}

export interface Vector {
  dx: number;
  dy: number;
}

/**
 * The pull vector at output point (x,y): points toward the warp's center,
 * magnitude ramping linearly from 0 at the center to `maxPull` at/beyond
 * `r`. Genuinely radial — unlike M15's original filter, which reused one
 * radius-only gradient for both channels and got a diagonal-biased
 * approximation instead (see decisions.md 2026-07-28's own note on this).
 */
export function displacementAt(x: number, y: number, geom: WarpGeometry): Vector {
  if (geom.maxPull === 0) return { dx: 0, dy: 0 };
  const ddx = x - geom.cx;
  const ddy = y - geom.cy;
  const dist = Math.hypot(ddx, ddy);
  if (dist < 1e-6) return { dx: 0, dy: 0 };
  const t = Math.min(1, dist / geom.r);
  const magnitude = t * geom.maxPull;
  // Unit vector pointing from (x,y) toward the center, scaled by magnitude.
  return { dx: (-ddx / dist) * magnitude, dy: (-ddy / dist) * magnitude };
}

/**
 * Where a graphic drawn at raw point (x0, y0) visually appears once the
 * filter warps it. Fixed-point iteration on the pull-sampling relationship
 * `output + pull(output) = source`.
 */
export function warpPoint(x0: number, y0: number, geom: WarpGeometry): { x: number; y: number } {
  if (geom.maxPull === 0) return { x: x0, y: y0 };
  let x = x0;
  let y = y0;
  for (let i = 0; i < 5; i++) {
    const { dx, dy } = displacementAt(x, y, geom);
    x = x0 - dx;
    y = y0 - dy;
  }
  return { x, y };
}

/**
 * The other direction: given a point the reader actually clicked (screen/
 * wrapper coordinates, i.e. *after* the warp already visually displaced
 * everything), what raw point does it correspond to? Unlike `warpPoint`,
 * this is direct — no iteration — because it's exactly the same
 * pull-sampling relationship `warpPoint` had to invert: `source = output +
 * pull(output)`. Needed anywhere a pointer position must be turned back
 * into a domain position (M18's torch).
 */
export function unwarpPoint(x: number, y: number, geom: WarpGeometry): { x: number; y: number } {
  if (geom.maxPull === 0) return { x, y };
  const { dx, dy } = displacementAt(x, y, geom);
  return { x: x + dx, y: y + dy };
}
