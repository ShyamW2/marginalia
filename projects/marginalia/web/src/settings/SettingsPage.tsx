import { useEffect, useState } from "react";
import type { LLMProviderId, Settings, SettingsUpdate } from "@marginalia/shared";
import styles from "./SettingsPage.module.css";

const BASE_URL_PRESETS = [
  { label: "OpenRouter", value: "https://openrouter.ai/api/v1" },
  { label: "Ollama (local)", value: "http://localhost:11434/v1" },
  { label: "LM Studio (local)", value: "http://localhost:1234/v1" },
  { label: "Custom", value: "" },
];

type FormState = Settings;

async function fetchSettings(): Promise<Settings | null> {
  const res = await fetch("/api/settings");
  if (!res.ok) return null;
  return (await res.json()) as Settings;
}

export function SettingsPage() {
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [testState, setTestState] = useState<
    { status: "idle" } | { status: "testing" } | { status: "ok" } | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    fetchSettings().then((s) => setForm(s));
  }, []);

  if (!form) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>Settings</h1>
      </div>
    );
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaveMessage(null);
    setTestState({ status: "idle" });
  }

  function buildUpdateBody(): SettingsUpdate {
    if (!form) return {};
    return { ...form };
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildUpdateBody()),
      });
      if (res.ok) {
        const saved = (await res.json()) as Settings;
        setForm(saved);
        setSaveMessage("Saved.");
      } else {
        setSaveMessage("Couldn't save settings.");
      }
    } catch {
      setSaveMessage("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTestState({ status: "testing" });
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildUpdateBody()),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (body.ok) {
        setTestState({ status: "ok" });
      } else {
        setTestState({ status: "error", message: body.error ?? "Connection failed." });
      }
    } catch {
      setTestState({ status: "error", message: "Couldn't reach the server." });
    }
  }

  const isAnthropic = form.provider === "anthropic";

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <p className={styles.hint}>
        Configure an LLM provider to enable asking questions about your books.
        Marginalia works as a reader with no provider configured — the Ask
        pill will nudge you to set one up here.
      </p>

      <div className={styles.field}>
        <label className={styles.label}>Provider</label>
        <div className={styles.providerToggle} role="group" aria-label="Provider">
          {(
            [
              { value: "anthropic", label: "Anthropic" },
              { value: "openai-compatible", label: "OpenAI-compatible" },
            ] satisfies { value: LLMProviderId; label: string }[]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                form.provider === option.value
                  ? `${styles.providerButton} ${styles.providerButtonActive}`
                  : styles.providerButton
              }
              aria-pressed={form.provider === option.value}
              onClick={() => update("provider", option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {isAnthropic ? (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="anthropic-model">
              Model
            </label>
            <input
              id="anthropic-model"
              className={styles.input}
              type="text"
              value={form.anthropicModel}
              placeholder="claude-opus-4-8"
              onChange={(e) => update("anthropicModel", e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="anthropic-key">
              API key
            </label>
            <input
              id="anthropic-key"
              className={styles.input}
              type="password"
              value={form.anthropicApiKey}
              placeholder="sk-ant-..."
              onFocus={() => {
                if (form.anthropicApiKey === "***") update("anthropicApiKey", "");
              }}
              onChange={(e) => update("anthropicApiKey", e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className={styles.field}>
            <label className={styles.label}>Base URL preset</label>
            <div className={styles.presetRow}>
              {BASE_URL_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={styles.presetButton}
                  onClick={() => update("openaiBaseUrl", preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="openai-base-url">
              Base URL
            </label>
            <input
              id="openai-base-url"
              className={styles.input}
              type="text"
              value={form.openaiBaseUrl}
              placeholder="https://openrouter.ai/api/v1"
              onChange={(e) => update("openaiBaseUrl", e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="openai-model">
              Model
            </label>
            <input
              id="openai-model"
              className={styles.input}
              type="text"
              value={form.openaiModel}
              placeholder="e.g. anthropic/claude-opus-4-8, llama3, ..."
              onChange={(e) => update("openaiModel", e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="openai-key">
              API key
            </label>
            <input
              id="openai-key"
              className={styles.input}
              type="password"
              value={form.openaiApiKey}
              placeholder="Leave blank for local servers with no auth"
              onFocus={() => {
                if (form.openaiApiKey === "***") update("openaiApiKey", "");
              }}
              onChange={(e) => update("openaiApiKey", e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="openai-context-tokens">
              Context tokens
            </label>
            <input
              id="openai-context-tokens"
              className={styles.input}
              type="number"
              min={1}
              value={form.openaiContextTokens}
              onChange={(e) =>
                update("openaiContextTokens", Number.parseInt(e.target.value, 10) || 0)
              }
            />
          </div>
        </>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="vault-path">
          Obsidian vault path
        </label>
        <input
          id="vault-path"
          className={styles.input}
          type="text"
          value={form.vaultPath}
          placeholder="/path/to/vault"
          onChange={(e) => update("vaultPath", e.target.value)}
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={handleTestConnection}
          disabled={testState.status === "testing"}
        >
          {testState.status === "testing" ? "Testing…" : "Test connection"}
        </button>
        {saveMessage && <span className={styles.statusText}>{saveMessage}</span>}
        {testState.status === "ok" && (
          <span className={styles.statusSuccess}>Connected.</span>
        )}
        {testState.status === "error" && (
          <span className={styles.statusError}>{testState.message}</span>
        )}
      </div>
    </div>
  );
}
