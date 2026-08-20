import { ProviderPicker } from "@marginalia/web";

/*
 * The LLM settings surface. Settled decision 1: all model access goes through
 * one narrow provider interface, so the picker is provider-agnostic by
 * construction — profiles are configured once and then *assigned to roles*
 * (query answers while you read; digest does batch analysis), rather than one
 * global "the model" setting.
 *
 * It reads `/api/provider-profiles` and `/api/provider-roles`, stubbed by the
 * preview provider with the two branches its UI has to handle: a hosted keyed
 * provider (masked key) and a local openai-compatible endpoint (base URL,
 * context window, no key).
 */
const frame: React.CSSProperties = {
  maxWidth: 620,
  padding: 16,
  borderRadius: 10,
  background: "var(--color-bg-raised)",
  border: "1px solid var(--color-border)",
};

/** `variant="full"` — the Settings LLM tab: the profile select plus the
 *  inline editor for the selected profile. This is the Query role, assigned
 *  to the hosted keyed provider. */
export function QueryRoleFull() {
  return (
    <div style={frame}>
      <ProviderPicker role="query" variant="full" />
    </div>
  );
}

/** The Digest role, assigned to a local openai-compatible endpoint — the
 *  other branch of the editor (base URL and context window, no API key). */
export function DigestRoleFull() {
  return (
    <div style={frame}>
      <ProviderPicker role="digest" variant="full" />
    </div>
  );
}

/** `variant="compact"` — the form the Scan's spotlight and the reader's
 *  action cluster embed: just the picker, no inline editor, with a way back
 *  to full settings. */
export function Compact() {
  return (
    <div style={{ ...frame, maxWidth: 360 }}>
      <ProviderPicker role="digest" variant="compact" />
    </div>
  );
}
