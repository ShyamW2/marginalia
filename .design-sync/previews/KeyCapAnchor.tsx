import { GearIcon, IconButton, KeyCapAnchor, LibraryIcon, MagnifierIcon } from "@marginalia/web";

/*
 * "Keycaps that cannot lie" (M19.7): the 3D key graphic is tucked behind its
 * control and revealed on proximity — `.keycap` is `opacity: 0` until the
 * anchor is hovered or `:focus-within`. A resting card therefore shows only
 * the wrapped control, which is correct but not informative; the Revealed
 * story below focuses the inner button so the real reveal state renders
 * statically. Hover is not reproducible in a static card (NOTES.md).
 */
const row: React.CSSProperties = {
  display: "flex",
  gap: 18,
  alignItems: "center",
  padding: "10px 4px",
};

/** Resting: the keycap is hidden, the control keeps its own accessible name.
 *  The charm is never the only path. */
export function Resting() {
  return (
    <div style={row}>
      <KeyCapAnchor shortcutKey="l">
        <IconButton icon={<LibraryIcon />} label="Library" />
      </KeyCapAnchor>
      <KeyCapAnchor shortcutKey="f">
        <IconButton icon={<MagnifierIcon />} label="Find in book" />
      </KeyCapAnchor>
      <KeyCapAnchor shortcutKey=",">
        <IconButton icon={<GearIcon />} label="Settings" />
      </KeyCapAnchor>
    </div>
  );
}

/** Revealed: `:focus-within` is one of the two documented reveal triggers, so
 *  focusing the wrapped control shows the keycap exactly as hovering does. */
export function Revealed() {
  return (
    <div style={row}>
      <KeyCapAnchor shortcutKey="l">
        {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
        <IconButton icon={<LibraryIcon />} label="Library" autoFocus />
      </KeyCapAnchor>
    </div>
  );
}

/** Multi-character keys render as-is; single characters are upper-cased. */
export function LongKey() {
  return (
    <div style={row}>
      <KeyCapAnchor shortcutKey="Esc">
        <IconButton icon={<GearIcon />} label="Close settings" autoFocus />
      </KeyCapAnchor>
    </div>
  );
}
