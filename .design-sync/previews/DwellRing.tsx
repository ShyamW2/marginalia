import { DwellRing } from "@marginalia/web";

/* DwellRing is the press-and-hold progress ring drawn at the pointer. It is
   absolutely positioned at (x, y) within its stage, so the stage supplies the
   ground and the coordinates place it. */
const stage: React.CSSProperties = {
  position: "relative",
  height: 150,
  borderRadius: 10,
  background: "var(--color-bg)",
  border: "1px dashed var(--color-border)",
};

/** The ring as a dwell begins — the normal accept path. */
export function Dwelling() {
  return (
    <div style={stage}>
      <DwellRing x={90} y={70} durationMs={600} refused={false} />
    </div>
  );
}

/** `refused` is the rejected dwell: same geometry, danger treatment, so a
 *  refusal reads as a refusal rather than as a slow accept. */
export function Refused() {
  return (
    <div style={stage}>
      <DwellRing x={90} y={70} durationMs={600} refused />
    </div>
  );
}

/** Two rings side by side, so the accept/refuse difference is directly
 *  comparable at a glance. */
export function Comparison() {
  return (
    <div style={stage}>
      <DwellRing x={80} y={70} durationMs={600} refused={false} />
      <DwellRing x={210} y={70} durationMs={600} refused />
    </div>
  );
}
