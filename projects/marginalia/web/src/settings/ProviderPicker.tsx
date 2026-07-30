import { useRef, useState } from "react";
import type {
  CreateProviderProfileBody,
  LLMProviderId,
  ProviderProfile,
  ProviderRole,
  UpdateProviderProfileBody,
} from "@marginalia/shared";
import { useProviderRoles } from "./useProviderRoles.js";
import {
  createProviderProfile,
  deleteProviderProfile,
  setProviderRole,
  testProviderProfile,
  updateProviderProfile,
} from "./providerApi.js";
import { emitProviderRolesSaved } from "./providerBus.js";
import { Button } from "../controls/Button.js";
import styles from "./ProviderPicker.module.css";

const ROLE_COPY: Record<ProviderRole, { label: string; hint: string }> = {
  query: {
    label: "Query",
    hint: "Answers questions while you're reading — the Ask thread in the margin.",
  },
  digest: {
    label: "Digest",
    hint: "Batch analysis: the digest, the thematic scan, and (later) audio casting.",
  },
};

const BASE_URL_PRESETS = [
  { label: "OpenRouter", value: "https://openrouter.ai/api/v1" },
  { label: "Ollama (local)", value: "http://localhost:11434/v1" },
  { label: "LM Studio (local)", value: "http://localhost:1234/v1" },
];

const NEW_PROFILE_VALUE = "__new__";

type Draft = CreateProviderProfileBody & Partial<UpdateProviderProfileBody>;

function blankDraft(name: string): Draft {
  return {
    name,
    provider: "claude-agent",
    anthropicModel: "claude-opus-4-8",
    anthropicApiKey: "",
    claudeAgentModel: "claude-sonnet-5",
    openaiBaseUrl: "",
    openaiModel: "",
    openaiApiKey: "",
    openaiContextTokens: 32768,
  };
}

function draftFromProfile(profile: ProviderProfile): Draft {
  return { ...profile };
}

interface ProviderFieldsProps {
  draft: Draft;
  onChange: (draft: Draft) => void;
  idPrefix: string;
}

/** The per-provider field set — the same shape the old flat SettingsPage
 * used, now shared by every profile editor (create or edit) instead of
 * living once per role. */
function ProviderFields({ draft, onChange, idPrefix }: ProviderFieldsProps) {
  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    onChange({ ...draft, [key]: value });
  }

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${idPrefix}-name`}>
          Profile name
        </label>
        <input
          id={`${idPrefix}-name`}
          className={styles.input}
          type="text"
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Provider</label>
        <div className={styles.toggleRow} role="group" aria-label="Provider">
          {(
            [
              { value: "claude-agent", label: "Claude (subscription)" },
              { value: "anthropic", label: "Anthropic API key" },
              { value: "openai-compatible", label: "OpenAI-compatible" },
            ] satisfies { value: LLMProviderId; label: string }[]
          ).map((option) => (
            <Button
              key={option.value}
              variant="outline"
              size="sm"
              className={styles.toggleButton}
              pressed={draft.provider === option.value}
              onClick={() => set("provider", option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {draft.provider === "claude-agent" && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${idPrefix}-claude-agent-model`}>
            Model
          </label>
          <input
            id={`${idPrefix}-claude-agent-model`}
            className={styles.input}
            type="text"
            value={draft.claudeAgentModel ?? ""}
            placeholder="claude-sonnet-5"
            onChange={(e) => set("claudeAgentModel", e.target.value)}
          />
          <p className={styles.hint}>
            Uses the machine's Claude Code login — no API key, no per-token billing.
          </p>
        </div>
      )}

      {draft.provider === "anthropic" && (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${idPrefix}-anthropic-model`}>
              Model
            </label>
            <input
              id={`${idPrefix}-anthropic-model`}
              className={styles.input}
              type="text"
              value={draft.anthropicModel ?? ""}
              placeholder="claude-opus-4-8"
              onChange={(e) => set("anthropicModel", e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${idPrefix}-anthropic-key`}>
              API key
            </label>
            <input
              id={`${idPrefix}-anthropic-key`}
              className={styles.input}
              type="password"
              value={draft.anthropicApiKey ?? ""}
              placeholder="sk-ant-..."
              onFocus={() => {
                if (draft.anthropicApiKey === "***") set("anthropicApiKey", "");
              }}
              onChange={(e) => set("anthropicApiKey", e.target.value)}
            />
          </div>
        </>
      )}

      {draft.provider === "openai-compatible" && (
        <>
          <div className={styles.field}>
            <label className={styles.label}>Base URL preset</label>
            <div className={styles.presetRow}>
              {BASE_URL_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  className={styles.presetButton}
                  onClick={() => set("openaiBaseUrl", preset.value)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${idPrefix}-openai-base-url`}>
              Base URL
            </label>
            <input
              id={`${idPrefix}-openai-base-url`}
              className={styles.input}
              type="text"
              value={draft.openaiBaseUrl ?? ""}
              placeholder="https://openrouter.ai/api/v1"
              onChange={(e) => set("openaiBaseUrl", e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${idPrefix}-openai-model`}>
              Model
            </label>
            <input
              id={`${idPrefix}-openai-model`}
              className={styles.input}
              type="text"
              value={draft.openaiModel ?? ""}
              placeholder="e.g. anthropic/claude-opus-4-8, llama3, ..."
              onChange={(e) => set("openaiModel", e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${idPrefix}-openai-key`}>
              API key
            </label>
            <input
              id={`${idPrefix}-openai-key`}
              className={styles.input}
              type="password"
              value={draft.openaiApiKey ?? ""}
              placeholder="Leave blank for local servers with no auth"
              onFocus={() => {
                if (draft.openaiApiKey === "***") set("openaiApiKey", "");
              }}
              onChange={(e) => set("openaiApiKey", e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${idPrefix}-openai-context-tokens`}>
              Context tokens
            </label>
            <input
              id={`${idPrefix}-openai-context-tokens`}
              className={styles.input}
              type="number"
              min={1}
              value={draft.openaiContextTokens ?? 32768}
              onChange={(e) =>
                set("openaiContextTokens", Number.parseInt(e.target.value, 10) || 0)
              }
            />
          </div>
        </>
      )}
    </>
  );
}

interface ProviderPickerProps {
  role: ProviderRole;
  /** "full": the settings LLM tab — profile select + inline editor.
   * "compact": the scan slider / reader menu icon — just the select and a
   * click-through into settings, no inline editing. */
  variant: "full" | "compact";
  onNavigateToSettings?: () => void;
}

export function ProviderPicker({ role, variant, onNavigateToSettings }: ProviderPickerProps) {
  const { profiles, roles, loading, refresh } = useProviderRoles();
  const assignment = roles.find((r) => r.role === role) ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<
    { status: "idle" } | { status: "testing" } | { status: "ok" } | { status: "error"; message: string }
  >({ status: "idle" });
  const draftForProfileId = useRef<string | "new" | null>(null);

  const copy = ROLE_COPY[role];

  async function handleSelectChange(value: string) {
    setTestState({ status: "idle" });
    if (value === NEW_PROFILE_VALUE) {
      draftForProfileId.current = "new";
      setDraft(blankDraft(`${copy.label} profile`));
      setEditing(true);
      return;
    }
    setEditing(false);
    await setProviderRole(role, value);
    emitProviderRolesSaved();
  }

  function openEditor() {
    if (!assignment?.profile) return;
    draftForProfileId.current = assignment.profile.id;
    setDraft(draftFromProfile(assignment.profile));
    setTestState({ status: "idle" });
    setEditing(true);
  }

  async function handleSaveDraft() {
    if (!draft) return;
    setSaving(true);
    try {
      if (draftForProfileId.current === "new") {
        const created = await createProviderProfile(draft as CreateProviderProfileBody);
        if (created) {
          await setProviderRole(role, created.id);
          emitProviderRolesSaved();
          setEditing(false);
        }
      } else if (draftForProfileId.current) {
        await updateProviderProfile(draftForProfileId.current, draft);
        emitProviderRolesSaved();
        setEditing(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!assignment?.profile) return;
    await deleteProviderProfile(assignment.profile.id);
    emitProviderRolesSaved();
    setEditing(false);
  }

  async function handleTest() {
    if (!draft || draftForProfileId.current === null) return;
    setTestState({ status: "testing" });
    const id = draftForProfileId.current === "new" ? "new" : draftForProfileId.current;
    const result = await testProviderProfile(id, draft);
    setTestState(
      result.ok ? { status: "ok" } : { status: "error", message: result.error ?? "Connection failed." },
    );
  }

  if (loading) return null;

  if (variant === "compact") {
    return (
      <div className={styles.compact}>
        <label className={styles.compactLabel} htmlFor={`provider-compact-${role}`}>
          {copy.label}
        </label>
        <select
          id={`provider-compact-${role}`}
          className={styles.compactSelect}
          value={assignment?.profileId ?? ""}
          onChange={(e) => void handleSelectChange(e.target.value)}
        >
          {!assignment?.profileId && <option value="">Not configured</option>}
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {onNavigateToSettings && (
          <Button
            variant="ghost"
            size="sm"
            className={styles.compactLink}
            style={{ color: "var(--color-accent)" }}
            onClick={onNavigateToSettings}
          >
            Settings →
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.rolePanel}>
      <h3 className={styles.roleTitle}>{copy.label}</h3>
      <p className={styles.hint}>{copy.hint}</p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor={`provider-select-${role}`}>
          Profile
        </label>
        <div className={styles.selectRow}>
          <select
            id={`provider-select-${role}`}
            className={styles.input}
            value={editing && draftForProfileId.current === "new" ? NEW_PROFILE_VALUE : (assignment?.profileId ?? "")}
            onChange={(e) => void handleSelectChange(e.target.value)}
          >
            {!assignment?.profileId && <option value="">Not configured</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={NEW_PROFILE_VALUE}>+ New profile…</option>
          </select>
          {assignment?.profile && !editing && (
            <Button variant="outline" size="sm" onClick={openEditor}>
              Edit
            </Button>
          )}
        </div>
        {!assignment?.configured && !editing && (
          <p className={styles.nudge}>
            No provider configured for this role — the {role === "query" ? "Ask thread" : "digest"}{" "}
            will show a nudge to set one up until you do.
          </p>
        )}
      </div>

      {editing && draft && (
        <div className={styles.editor}>
          <ProviderFields draft={draft} onChange={setDraft} idPrefix={`${role}-${draftForProfileId.current}`} />
          <div className={styles.actions}>
            <Button variant="solid" size="sm" onClick={handleSaveDraft} disabled={saving}>
              {saving ? "Saving…" : draftForProfileId.current === "new" ? "Create & use" : "Save"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testState.status === "testing"}
            >
              {testState.status === "testing" ? "Testing…" : "Test connection"}
            </Button>
            {draftForProfileId.current !== "new" && (
              <Button variant="danger" size="sm" onClick={handleDelete}>
                Delete profile
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {testState.status === "ok" && <span className={styles.statusSuccess}>Connected.</span>}
            {testState.status === "error" && (
              <span className={styles.statusError}>{testState.message}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
