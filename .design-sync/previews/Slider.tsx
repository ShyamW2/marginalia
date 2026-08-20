import { useState } from "react";
import { Slider } from "@marginalia/web";

const field: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "6px 0",
  font: "500 13px var(--font-sans)",
  color: "var(--color-text)",
};

/** The canonical settings form, ported from the Appearance tab: a label and
 *  a readout slider per row. Resting form is a readout — no track, no thumb;
 *  the value is the control. */
export function AppearanceSettings() {
  const [saturation, setSaturation] = useState(62);
  const [hue, setHue] = useState(38);
  return (
    <div>
      <div style={field}>
        <span>Saturation</span>
        <Slider
          ariaLabel="Accent saturation"
          value={saturation}
          min={0}
          max={100}
          step={1}
          dragPxPerUnit={2}
          keyboardStep={5}
          formatValue={(v) => `${Math.round(v)}%`}
          onCommit={setSaturation}
        />
      </div>
      <div style={field}>
        <span>Paper hue</span>
        <Slider
          ariaLabel="Paper hue"
          value={hue}
          min={0}
          max={360}
          step={1}
          dragPxPerUnit={2}
          keyboardStep={10}
          formatValue={(v) => `${Math.round(v)}°`}
          onCommit={setHue}
        />
      </div>
    </div>
  );
}

/** `scale="log2"` — a fixed *octave* per pixel, so dragging feels the same at
 *  4k tokens as at 128k. `formatValue` returns the human string
 *  (aria-valuetext), never the raw number. */
export function LogarithmicTokens() {
  const [tokens, setTokens] = useState(16384);
  return (
    <div style={field}>
      <span>Max response tokens</span>
      <Slider
        ariaLabel="Max response tokens"
        value={tokens}
        min={1024}
        max={200000}
        scale="log2"
        dragPxPerUnit={140}
        keyboardStep={2}
        formatValue={(v) => `${Math.round(v).toLocaleString()} tokens`}
        onCommit={setTokens}
      />
    </div>
  );
}

/** Detents are advisory snap points — also what Shift+Arrow steps between.
 *  `capture` sets how close a drag must come before the detent takes it. */
export function WithDetents() {
  const [width, setWidth] = useState(68);
  return (
    <div style={field}>
      <span>Reader pane width</span>
      <Slider
        ariaLabel="Reader pane width"
        value={width}
        min={40}
        max={100}
        step={1}
        detents={[50, 68, 80, 100]}
        capture={{ absolute: 3 }}
        dragPxPerUnit={4}
        keyboardStep={2}
        formatValue={(v) => `${Math.round(v)}% of page`}
        onCommit={setWidth}
      />
    </div>
  );
}
