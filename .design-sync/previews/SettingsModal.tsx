import { SettingsModal } from "@marginalia/web";

/*
 * Settings is an *instrument*, not a room (settled decision 13): it opens
 * over whatever you are already in, keeping its own route, rather than being
 * somewhere you travel to. SettingsModal is that overlay — a FlyPanel-based
 * dialog wrapping SettingsPage, which is why it carries the heading that
 * SettingsPage's `titleId` points at.
 *
 * The modal is `position: fixed`; a card renders it inside a transformed
 * wrapper, which becomes the containing block, so it lands in the card
 * rather than escaping to the page viewport.
 */
const stage: React.CSSProperties = {
  position: "relative",
  height: 560,
  borderRadius: 10,
  background: "var(--color-bg)",
  overflow: "hidden",
};

/** The instrument open over a room. */
export function Open() {
  return (
    <div style={stage}>
      <SettingsModal onClose={() => {}} />
    </div>
  );
}
