import { NavCluster } from "@marginalia/web";

/*
 * M19.7 "the nav bar becomes a floating cluster": library, tasks tray,
 * settings and the three theme buttons, anchored top-right. `floating` is the
 * App-shell placement (fixed, top-right); the reader's fullscreen-embedded
 * copy passes false and relies on its own parent for placement. The cards use
 * the non-floating form so the cluster sits in the card rather than pinning
 * itself to the viewport corner.
 */
const stage: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: "10px 6px",
};

const roomStage: React.CSSProperties = {
  position: "relative",
  height: 130,
  padding: 12,
  borderRadius: 10,
  background: "var(--color-bg)",
  border: "1px dashed var(--color-border)",
  overflow: "hidden",
};

/** The cluster as the Desk shows it — settings opens to the desk divider. */
export function Desk() {
  return (
    <div style={stage}>
      <NavCluster settingsTab="desk" floating={false} />
    </div>
  );
}

/** "Settings opens where you already are": each room passes its own tab, so
 *  the same control lands the reader somewhere different from the Scan. */
export function PerRoomSettingsTab() {
  return (
    <div>
      <div style={stage}>
        <NavCluster settingsTab="reading" floating={false} />
      </div>
      <div style={stage}>
        <NavCluster settingsTab="scan" floating={false} />
      </div>
      <div style={stage}>
        <NavCluster settingsTab="audio" floating={false} />
      </div>
    </div>
  );
}

/** In place over a room's ground, which is how it is actually seen —
 *  floating chrome over the surface rather than a bar in the flow. */
export function OverARoom() {
  return (
    <div style={roomStage}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <NavCluster settingsTab="appearance" floating={false} />
      </div>
    </div>
  );
}
