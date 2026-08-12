import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { clampValue } from "./sliderMath.js";
import styles from "./ColorField.module.css";

export interface ColorFieldProps {
  /** Degrees, 0–360 — the field's x axis. */
  hue: number;
  /** Percent, 0–100 — the field's y axis (top = 100/white, bottom = 0/black). */
  lightness: number;
  /** Percent, 0–100 — not an axis of this field; only shapes how vivid its
   * hue gradient renders, so the puck sits over a swatch that actually
   * matches the picked saturation. */
  saturation: number;
  onChange: (next: { hue: number; lightness: number }) => void;
  ariaLabel: string;
}

const HUE_STEP = 4;
const LIGHTNESS_STEP = 4;

/**
 * M22.6 §E: the "Arc shape" accent field (decisions.md 2026-08-12 ruling 4)
 * — x is hue, y is lightness. Saturation is a separate slider (ColorField
 * only ever reports hue/lightness), but the field's own gradient is built
 * at the *current* saturation so the swatch under the puck always matches
 * what picking there would actually produce.
 *
 * A bounded, absolute-position pointer target (click/drag maps straight to
 * a point in the box) — unlike Slider's pointer-lock relative scrub, which
 * exists for *unbounded* travel a fixed-size field doesn't need.
 */
export function ColorField({ hue, lightness, saturation, onChange, ariaLabel }: ColorFieldProps) {
  const fieldRef = useRef<HTMLDivElement>(null);

  function setFromClientPoint(clientX: number, clientY: number) {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clampValue(clientX - rect.left, 0, rect.width);
    const y = clampValue(clientY - rect.top, 0, rect.height);
    onChange({
      hue: (x / rect.width) * 360,
      lightness: 100 - (y / rect.height) * 100,
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromClientPoint(event.clientX, event.clientY);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.buttons === 0) return;
    setFromClientPoint(event.clientX, event.clientY);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let nextHue = hue;
    let nextLightness = lightness;
    if (event.key === "ArrowRight") nextHue = (hue + HUE_STEP + 360) % 360;
    else if (event.key === "ArrowLeft") nextHue = (hue - HUE_STEP + 360) % 360;
    else if (event.key === "ArrowUp") nextLightness = clampValue(lightness + LIGHTNESS_STEP, 0, 100);
    else if (event.key === "ArrowDown") nextLightness = clampValue(lightness - LIGHTNESS_STEP, 0, 100);
    else return;
    event.preventDefault();
    onChange({ hue: nextHue, lightness: nextLightness });
  }

  const hueGradient = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360]
    .map((h) => `hsl(${h} ${saturation}% 50%)`)
    .join(", ")})`;

  return (
    <div
      ref={fieldRef}
      className={styles.field}
      style={{ backgroundImage: `linear-gradient(to bottom, #fff, transparent 50%, #000), ${hueGradient}` }}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hue)}
      aria-valuetext={`hue ${Math.round(hue)}°, lightness ${Math.round(lightness)}%`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onKeyDown={handleKeyDown}
    >
      <div
        className={styles.puck}
        style={{
          left: `${(hue / 360) * 100}%`,
          top: `${100 - lightness}%`,
          background: `hsl(${hue} ${saturation}% ${lightness}%)`,
        }}
        aria-hidden="true"
      />
    </div>
  );
}
