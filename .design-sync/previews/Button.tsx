import { Button, GearIcon, PublishIcon, SunIcon } from "@marginalia/web";

const row: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

/** The four variants, in the order DESIGN.md ranks them: solid carries the
 *  one primary action on a surface, outline is the workhorse, ghost recedes
 *  into chrome, danger is destructive-only. */
export function Variants() {
  return (
    <div style={row}>
      <Button variant="solid">Publish to vault</Button>
      <Button variant="outline">Open digest</Button>
      <Button variant="ghost">Cancel</Button>
      <Button variant="danger">Delete book</Button>
    </div>
  );
}

/** Two sizes. `sm` is for dense chrome (tabs, trays); `md` is the default. */
export function Sizes() {
  return (
    <div style={row}>
      <Button size="sm" variant="outline">
        Small
      </Button>
      <Button size="md" variant="outline">
        Medium
      </Button>
      <Button size="sm" variant="solid">
        Small solid
      </Button>
      <Button size="md" variant="solid">
        Medium solid
      </Button>
    </div>
  );
}

/** A leading icon goes through `icon`, never inside `children` — icon-only
 *  controls are `IconButton`, which requires an accessible label. */
export function WithIcon() {
  return (
    <div style={row}>
      <Button variant="outline" icon={<GearIcon />}>
        Settings
      </Button>
      <Button variant="solid" icon={<PublishIcon />}>
        Publish
      </Button>
      <Button variant="ghost" icon={<SunIcon />}>
        Paper theme
      </Button>
    </div>
  );
}

/** `pressed` is persistent toggle state (theme picker, kind filter), distinct
 *  from the momentary `:active` press — it also sets `aria-pressed`. */
export function States() {
  return (
    <div style={row}>
      <Button variant="outline" pressed>
        Pressed
      </Button>
      <Button variant="outline" disabled>
        Disabled
      </Button>
      <Button variant="solid" disabled>
        Disabled solid
      </Button>
      <Button variant="ghost" pressed>
        Ghost pressed
      </Button>
    </div>
  );
}
