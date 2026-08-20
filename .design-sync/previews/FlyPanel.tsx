import { Button, FlyPanel, IconButton } from "@marginalia/web";

/*
 * FlyPanel is the overlay shell every instrument sits in (Scan, Digest,
 * Settings, Casting). `origin` is the invoking control's rect captured at
 * click time — it flies the panel out of the thing you clicked. `null` (used
 * here, and what a reduced-motion user gets) renders a plain crossfade with
 * no movement, which is the correct static form for a preview card.
 */
const panel: React.CSSProperties = {
  position: "relative",
  width: 340,
  padding: "20px 22px",
  borderRadius: 14,
  background: "var(--color-bg-raised)",
  border: "1px solid var(--color-border)",
  boxShadow: "var(--shadow-panel)",
  color: "var(--color-text)",
  font: "400 14px/1.5 var(--font-sans)",
};

const title: React.CSSProperties = {
  margin: "0 0 6px",
  font: "600 15px var(--font-sans)",
  color: "var(--color-text)",
};

const hint: React.CSSProperties = {
  margin: "0 0 16px",
  color: "var(--color-text-muted)",
  font: "400 13px/1.5 var(--font-sans)",
};

/** The canonical instrument panel, composed the way CastingModal does it:
 *  a close IconButton, a titled heading, body copy, then the actions row. */
export function InstrumentPanel() {
  return (
    <FlyPanel origin={null} className="register-paper" style={panel} role="dialog" aria-modal="true" aria-labelledby="fly-title">
      <IconButton
        icon="×"
        label="Close panel"
        style={{ position: "absolute", top: 12, right: 12 }}
      />
      <h2 id="fly-title" style={title}>
        Publish to vault
      </h2>
      <p style={hint}>
        Distilled notes for the 14 highlights in this chapter will be written to your Obsidian
        vault. Raw threads stay in the reader.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <Button variant="ghost">Cancel</Button>
        <Button variant="solid">Publish 14 notes</Button>
      </div>
    </FlyPanel>
  );
}

/** The quiet dial on the paper register — the reader's own chrome. Flatter,
 *  borderless, no lift: `register-quiet` sits on top of `register-paper`. */
export function QuietRegister() {
  return (
    <FlyPanel
      origin={null}
      className="register-paper register-quiet"
      style={{ ...panel, width: 300 }}
      role="dialog"
      aria-labelledby="fly-quiet-title"
    >
      <h2 id="fly-quiet-title" style={title}>
        Go to chapter
      </h2>
      <p style={hint}>The reader's chrome recedes rather than performs.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="sm" variant="ghost">
          Previous
        </Button>
        <Button size="sm" variant="ghost">
          Next
        </Button>
      </div>
    </FlyPanel>
  );
}
