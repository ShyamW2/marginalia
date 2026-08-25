import { ProviderAuth } from "../ProviderAuth.js";
import { ProviderPicker } from "../ProviderPicker.js";
import styles from "../SettingsPage.module.css";

/** M19: the flat single-provider form became two role pickers (query,
 * digest) built once (ProviderPicker) and reused here, in the scan's slider,
 * and in the reader's menu icon — see docs/decisions.md 2026-07-29 later.
 * M19.7: max response length moved from a single global field here into
 * each role picker (it's a role property now, not a shared global one). */
export function LLMTab() {
  return (
    <>
      <p className={styles.hint}>
        Marginalia works as a reader with no provider configured — the Ask pill and the
        digest will nudge you to set one up. A profile is a complete, reusable config; a
        role decides which profile handles which kind of work.
      </p>
      <p className={styles.hint}>
        Models routinely misreport their own identity — a local model can and will claim
        to be Claude. The name shown next to an answer comes from the endpoint you
        configured here, never from what the model itself says it is.
      </p>
      <ProviderAuth />
      <ProviderPicker role="query" variant="full" />
      <ProviderPicker role="digest" variant="full" />
    </>
  );
}
