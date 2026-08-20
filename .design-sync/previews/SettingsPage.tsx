import { SettingsPage } from "@marginalia/web";

/*
 * The Settings surface itself — the tabbed body the modal wraps. It composes
 * most of the rest of the system: the controls kit (Slider, ColorField,
 * Button), ProviderPicker on the LLM tab, and UsageDivider on the Usage tab.
 * Everything it reads from the server comes through the preview provider's
 * stubs, so this renders against realistic settings rather than an error
 * state.
 *
 * `titleId` is set only when it is rendered inside SettingsModal, so
 * aria-labelledby can point at the modal's heading; standalone there is no
 * dialog heading to point at, which is the form shown here.
 */
const frame: React.CSSProperties = {
  maxWidth: 720,
  padding: 16,
  borderRadius: 10,
  background: "var(--color-bg-raised)",
  border: "1px solid var(--color-border)",
};

/** Settings as a standalone page, on its default tab. */
export function Standalone() {
  return (
    <div style={frame}>
      <SettingsPage />
    </div>
  );
}
