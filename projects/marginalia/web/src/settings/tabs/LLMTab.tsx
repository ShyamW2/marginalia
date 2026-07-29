import type { Settings } from "@marginalia/shared";
import { ProviderPicker } from "../ProviderPicker.js";
import styles from "../SettingsPage.module.css";

interface LLMTabProps {
  form: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

/** M19: the flat single-provider form became two role pickers (query,
 * digest) built once (ProviderPicker) and reused here, in the scan's slider,
 * and in the reader's menu icon — see docs/decisions.md 2026-07-29 later. */
export function LLMTab({ form, update }: LLMTabProps) {
  return (
    <>
      <p className={styles.hint}>
        Marginalia works as a reader with no provider configured — the Ask pill and the
        digest will nudge you to set one up. A profile is a complete, reusable config; a
        role decides which profile handles which kind of work.
      </p>
      <ProviderPicker role="query" variant="full" />
      <ProviderPicker role="digest" variant="full" />

      <div className={styles.field}>
        <label className={styles.label} htmlFor="max-response-tokens">
          Max response length — {form.maxResponseTokens} tokens
        </label>
        <input
          id="max-response-tokens"
          className={styles.input}
          type="number"
          min={1}
          value={form.maxResponseTokens}
          onChange={(e) => update("maxResponseTokens", Number.parseInt(e.target.value, 10) || 0)}
        />
        <p className={styles.hint}>
          Applies to whichever profile answers — a subscription profile has no hard
          ceiling to enforce (only a request made in the system prompt); a keyed or local
          profile enforces it directly, so a low limit will visibly truncate answers.
        </p>
      </div>
    </>
  );
}
