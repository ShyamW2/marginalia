import { useState } from "react";
import { ColorField } from "@marginalia/web";

const frame: React.CSSProperties = {
  maxWidth: 280,
  padding: 12,
  borderRadius: 10,
  background: "var(--color-bg-raised)",
  border: "1px solid var(--color-border)",
};

const caption: React.CSSProperties = {
  margin: "0 0 8px",
  font: "500 12px var(--font-sans)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

/** The accent picker from the Appearance tab: hue on x, lightness on y, with
 *  the puck sitting over the current colour. `saturation` is not an axis —
 *  it only shapes how vivid the hue gradient renders. */
export function AccentPicker() {
  const [color, setColor] = useState({ hue: 24, lightness: 39 });
  return (
    <div style={frame}>
      <p style={caption}>Accent</p>
      <ColorField
        hue={color.hue}
        lightness={color.lightness}
        saturation={40}
        onChange={setColor}
        ariaLabel="Accent colour"
      />
    </div>
  );
}

/** A low-saturation field — the same control against the paper tint's much
 *  gentler gradient, which is how the Desk's tint picker reads. */
export function LowSaturation() {
  const [color, setColor] = useState({ hue: 38, lightness: 92 });
  return (
    <div style={frame}>
      <p style={caption}>Paper tint</p>
      <ColorField
        hue={color.hue}
        lightness={color.lightness}
        saturation={12}
        onChange={setColor}
        ariaLabel="Paper tint"
      />
    </div>
  );
}
