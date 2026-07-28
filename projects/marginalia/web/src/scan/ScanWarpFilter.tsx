import { useMemo } from "react";
import { computeWarpGeometry, displacementAt, type WarpGeometry } from "./warp.js";

interface ScanWarpFilterProps {
  id: string;
  width: number;
  height: number;
  /** 0 (no effect) — 1 (full). Callers should skip rendering this component
   * entirely at 0 or under reduced motion rather than pass 0 through. */
  intensity: number;
}

// Every this-many px gets its own sampled displacement value; feImage's own
// scaling smooths between them, and the field itself is smooth (it's a
// function of radius alone), so a coarse grid is indistinguishable from a
// dense one while staying cheap to generate on every resize.
const GRID_STEP_PX = 14;
const MAX_GRID_CELLS = 160;

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Renders the displacement map `warpPoint`'s math implies, as a small PNG
 * data URL: R/G channels encode the pull vector's x/y (feDisplacementMap's
 * own encoding — 128 is "no displacement", scaled by `scale`). A plain
 * `<radialGradient>` can't do this (it only varies by radius, not
 * direction), which is why M15's original filter had to settle for a
 * diagonal approximation instead of the genuinely radial pull this milestone
 * wants — see warp.ts's module comment.
 *
 * Covers `region`, not just the wrapper's own 0..width box: a pull *toward*
 * the center means the wrapper's true edge content (a letter sitting right
 * at x=0, say) is sampled from *by* some output point outside that box —
 * left undefined there, per the SVG spec an `feImage` is transparent (and
 * therefore a spurious -scale/2 displacement, not zero) past its own
 * bounds, which silently ate a few px of content off every edge until this
 * was caught live rendering the actual scan page (see NOTES.md "M18").
 * `region` is the filter's own region (wrapper box plus margin), so the map
 * stays valid everywhere a pulled sample could actually land.
 */
function renderDisplacementMap(geom: WarpGeometry, scale: number, region: Region): string {
  const cols = Math.max(2, Math.min(MAX_GRID_CELLS, Math.round(region.width / GRID_STEP_PX)));
  const rows = Math.max(2, Math.min(MAX_GRID_CELLS, Math.round(region.height / GRID_STEP_PX)));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const image = ctx.createImageData(cols, rows);
  const stepX = region.width / cols;
  const stepY = region.height / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = region.x + (col + 0.5) * stepX;
      const y = region.y + (row + 0.5) * stepY;
      const { dx, dy } = displacementAt(x, y, geom);
      const i = (row * cols + col) * 4;
      image.data[i] = scale > 0 ? clampByte(127.5 + (255 * dx) / scale) : 128;
      image.data[i + 1] = scale > 0 ? clampByte(127.5 + (255 * dy) / scale) : 128;
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

/**
 * M18 "whole-face barrel warp" (decisions.md 2026-07-28/2026-07-29): one SVG
 * filter, applied to one wrapper containing the entire base scan screen —
 * readouts, filters, the heat strip, the digest spotlight, the revisit
 * queue — so the glass bows as a single coherent surface rather than each
 * piece bowing around its own center (M15's per-strip filter). Three
 * chained effects: the radial pull above (a genuine outward bulge, unlike
 * M15's diagonal approximation), a chromatic fringe (split R/G/B, offset R
 * and B oppositely, screen back together), and a bloom (blur screened back
 * over the crisp original — "fuzz the strokes" without losing them).
 * Floating layers (the per-highlight hover readout, popovers, modals) are
 * portalled outside this wrapper — a `filter` on an ancestor would
 * otherwise both warp them and break their `position: fixed` containment.
 */
export function ScanWarpFilter({ id, width, height, intensity }: ScanWarpFilterProps) {
  const geom = useMemo(() => computeWarpGeometry(width, height, intensity), [width, height, intensity]);
  const scale = geom.maxPull * 2;
  const fringe = intensity * 2.2;
  const bloom = 1.5 + intensity * 3;
  // Generous headroom for the outward pull plus the fringe/bloom spread —
  // fixed px rather than a percentage, since filterUnits is userSpaceOnUse.
  const margin = 40 + geom.maxPull * 2 + bloom * 4;
  const region = useMemo<Region>(
    () => ({ x: -margin, y: -margin, width: width + margin * 2, height: height + margin * 2 }),
    [width, height, margin],
  );
  const dataUrl = useMemo(
    () => (width > 0 && height > 0 ? renderDisplacementMap(geom, scale, region) : ""),
    [geom, scale, region, width, height],
  );

  if (!dataUrl) return null;

  return (
    <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        <filter
          id={id}
          filterUnits="userSpaceOnUse"
          primitiveUnits="userSpaceOnUse"
          x={-margin}
          y={-margin}
          width={width + margin * 2}
          height={height + margin * 2}
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={dataUrl}
            x={region.x}
            y={region.y}
            width={region.width}
            height={region.height}
            result="warpMap"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warpMap"
            scale={scale}
            xChannelSelector="R"
            yChannelSelector="G"
            result="warped"
          />

          <feColorMatrix
            in="warped"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="rOnly"
          />
          <feOffset in="rOnly" dx={fringe} dy="0" result="rShift" />
          <feColorMatrix
            in="warped"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="bOnly"
          />
          <feOffset in="bOnly" dx={-fringe} dy="0" result="bShift" />
          <feColorMatrix
            in="warped"
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="gOnly"
          />
          <feBlend in="rShift" in2="gOnly" mode="screen" result="rg" />
          <feBlend in="rg" in2="bShift" mode="screen" result="fringed" />

          <feGaussianBlur in="fringed" stdDeviation={bloom} result="bloomed" />
          <feBlend in="fringed" in2="bloomed" mode="screen" />
        </filter>
      </defs>
    </svg>
  );
}
