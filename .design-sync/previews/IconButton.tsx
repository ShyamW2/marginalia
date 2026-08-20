import {
  CircleHalfIcon,
  GearIcon,
  IconButton,
  LibraryIcon,
  MagnifierIcon,
  MoonIcon,
  PlayIcon,
  PublishIcon,
  SunIcon,
  TrayIcon,
} from "@marginalia/web";

const row: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

/** The icon-only member of the Button family. `label` is required, not
 *  optional — with no visible text it is the control's only accessible name
 *  (it becomes both `aria-label` and `title`). */
export function IconSet() {
  return (
    <div style={row}>
      <IconButton icon={<LibraryIcon />} label="Library" />
      <IconButton icon={<MagnifierIcon />} label="Find in book" />
      <IconButton icon={<TrayIcon />} label="Tasks" />
      <IconButton icon={<GearIcon />} label="Settings" />
      <IconButton icon={<PublishIcon />} label="Publish to vault" />
      <IconButton icon={<PlayIcon />} label="Play audio" />
    </div>
  );
}

/** Variants share the Button family's vocabulary; `ghost` is the default,
 *  because icon buttons mostly live in chrome that should recede. */
export function Variants() {
  return (
    <div style={row}>
      <IconButton icon={<GearIcon />} label="Ghost settings" variant="ghost" />
      <IconButton icon={<GearIcon />} label="Outline settings" variant="outline" />
      <IconButton icon={<GearIcon />} label="Solid settings" variant="solid" />
      <IconButton icon={<GearIcon />} label="Danger settings" variant="danger" />
    </div>
  );
}

/** The theme picker, as the app builds it: three icon buttons in a group with
 *  `pressed` marking the active one (it also sets `aria-pressed`). */
export function ThemePicker() {
  return (
    <div style={row} role="group" aria-label="Theme">
      <IconButton icon={<SunIcon />} label="Paper theme" pressed />
      <IconButton icon={<MoonIcon />} label="Ink theme" />
      <IconButton icon={<CircleHalfIcon />} label="Match system" />
    </div>
  );
}

/** Both sizes, resting and disabled. */
export function SizesAndStates() {
  return (
    <div style={row}>
      <IconButton icon={<GearIcon />} label="Small" size="sm" variant="outline" />
      <IconButton icon={<GearIcon />} label="Medium" size="md" variant="outline" />
      <IconButton icon={<GearIcon />} label="Disabled" variant="outline" disabled />
    </div>
  );
}
