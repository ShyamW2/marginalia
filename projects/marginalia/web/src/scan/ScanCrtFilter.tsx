interface ScanCrtFilterProps {
  id: string;
  /** 0 (no effect) — 1 (full). Callers should skip rendering this component
   * entirely at 0 or under reduced motion rather than pass 0 through. */
  intensity: number;
}

/**
 * M15 "CRT treatment" (decisions.md 2026-07-20): the SVG filter chain
 * applied to the scan's graphics layer only (never the mono readouts,
 * labels, or the revisit queue — those never reference this filter's id).
 * Three effects chained: a barrel warp (`feDisplacementMap` fed by a radial
 * gradient — the gradient is genuinely radially symmetric, so the resulting
 * warp isn't a mathematically perfect outward bulge, but it reads as one:
 * a CRT face bowing more toward the edges than the center, which is the
 * actual ask), a bloom (blur the graphics and screen it back over the
 * crisp original — "fuzz the strokes" without losing them entirely), and a
 * subtle chromatic fringe (split R/G/B, offset R and B oppositely, screen
 * back together).
 */
export function ScanCrtFilter({ id, intensity }: ScanCrtFilterProps) {
  const gradId = `${id}-warp-grad`;
  const warpScale = intensity * 16;
  const fringe = intensity * 2.2;
  const bloom = 1.5 + intensity * 3;

  return (
    <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        <radialGradient id={gradId} cx="50%" cy="50%" r="75%">
          <stop offset="0%" stopColor="#808080" />
          <stop offset="100%" stopColor="#ffffff" />
        </radialGradient>
        <rect id={`${gradId}-rect`} x="0" y="0" width="100%" height="100%" fill={`url(#${gradId})`} />
        <filter id={id} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
          <feImage
            href={`#${gradId}-rect`}
            x="0"
            y="0"
            width="100%"
            height="100%"
            result="warpMap"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warpMap"
            scale={warpScale}
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
