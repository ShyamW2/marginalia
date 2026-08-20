import { CrtBezel } from "@marginalia/web";

/*
 * The Scan is dark-native: rather than a parallel theme system it overrides
 * the same theme.css custom properties, scoped to its page (ScanPage.module
 * .css `.page`). Every shared component underneath inherits them for free.
 * A Scan card must therefore reproduce that scope — the token overrides plus
 * `register-glass`, the Scan's own control register (mono type, phosphor
 * stroke, square corners, no shadow: a screen doesn't cast one).
 */
const scanScope: React.CSSProperties = {
  ["--color-bg" as string]: "#05070a",
  ["--color-bg-raised" as string]: "#0d1318",
  ["--color-text" as string]: "#cfeeff",
  ["--color-text-muted" as string]: "rgba(207, 238, 255, 0.6)",
  ["--color-border" as string]: "rgba(140, 220, 255, 0.25)",
  ["--color-accent" as string]: "#5ec8ff",
  ["--color-accent-text" as string]: "#04141c",
  ["--color-highlight" as string]: "rgba(94, 200, 255, 0.15)",
  ["--color-highlight-active" as string]: "rgba(94, 200, 255, 0.3)",
  ["--color-danger" as string]: "#ff6b81",
  ["--font-mono" as string]: 'ui-monospace, "SF Mono", "Cascadia Code", monospace',
  background: "var(--color-bg)",
  color: "var(--color-text)",
  padding: 16,
  borderRadius: 10,
};

const screen: React.CSSProperties = {
  padding: "22px 20px",
  font: "400 13px/1.6 var(--font-mono)",
  color: "var(--color-text)",
};

const readout: React.CSSProperties = {
  margin: "0 0 10px",
  font: "600 11px var(--font-mono)",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--color-accent)",
};

/** The bezel is the Scan's frame: it wraps the instrument's whole screen
 *  area, so everything inside reads as being *behind glass*. */
export function Screen() {
  return (
    <div className="register-glass" style={scanScope}>
      <CrtBezel>
        <div style={screen}>
          <p style={readout}>Scan · S3</p>
          <p style={{ margin: 0 }}>
            412 pages · 37 highlights · 6 sections
            <br />
            Filter: none — every band lit
          </p>
        </div>
      </CrtBezel>
    </div>
  );
}

/** A denser payload, to show the bezel framing content rather than being
 *  content itself — it never sets its own type or spacing. */
export function WithReadout() {
  return (
    <div className="register-glass" style={scanScope}>
      <CrtBezel>
        <div style={screen}>
          <p style={readout}>Revisit queue</p>
          <div style={{ display: "grid", gap: 6 }}>
            <span>S1 · the feeling of knowing — ★★★</span>
            <span>S3 · explanatory depth — ★★☆</span>
            <span>S4 · desirable difficulty — ★★★</span>
            <span>S5 · interleaving — ★☆☆</span>
          </div>
        </div>
      </CrtBezel>
    </div>
  );
}
