import { useRef, useState } from "react";
import {
  MAX_RESPONSE_TOKENS_MAX,
  MAX_RESPONSE_TOKENS_MIN,
  type CreateProviderProfileBody,
  type ProviderProfile,
  type ProviderRole,
  type UpdateProviderProfileBody,
} from "@marginalia/shared";
import { useProviderRoles } from "./useProviderRoles.js";
import {
  createProviderProfile,
  deleteProviderProfile,
  setProviderRole,
  setRoleMaxResponseTokens,
  testProviderProfile,
  updateProviderProfile,
} from "./providerApi.js";
import { emitProviderRolesSaved } from "./providerBus.js";
import { Button } from "../controls/Button.js";
import { Slider } from "../controls/Slider.js";
import styles from "./ProviderPicker.module.css";

function formatTokens(value: number): string {
  return `${Math.round(value).toLocaleString()} tokens`;
}

// M19.7 "the two token sliders": context length is log2, 1024 -> 200K,
// detenting on powers of two — generated rather than hand-listed so the top
// of the range (200K, not itself a power of two) can't quietly fall out of
// sync with the bottom.
const CONTEXT_TOKENS_MIN = 1024;
const CONTEXT_TOKENS_MAX = 200_000;
const CONTEXT_TOKEN_DETENTS: number[] = [];
for (let p = Math.log2(CONTEXT_TOKENS_MIN); 2 ** p <= CONTEXT_TOKENS_MAX; p++) {
  CONTEXT_TOKEN_DETENTS.push(2 ** p);
}

// M22.5: every 500 tokens, generated for the same reason as the context
// detents above — the top of the range (10,000) is itself a multiple of
// 500, but hand-listing invites the two falling out of sync anyway.
const RESPONSE_TOKEN_DETENTS: number[] = [];
for (let d = 500; d <= MAX_RESPONSE_TOKENS_MAX; d += 500) {
  RESPONSE_TOKEN_DETENTS.push(d);
}

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

// 2026-08-25: "how the provider list is organized" was flattened from one
// row of three raw provider ids (which of the app's four seams, LLMProvider
// implementations) into how a reader actually thinks about the choice —
// how it's billed — with the concrete provider one step in. Two of the
// three billing categories fan out to the *same* `openai-compatible` seam
// under the hood (a base-URL preset, nothing more); "Local" isn't a fourth
// seam, just that seam pointed at localhost. `codex-cli` doesn't exist yet
// (M26, blocked on capturing a real event shape — see NOTES.md) — its two
// tiles are shown so the taxonomy reads as the target shape, not a partial
// one, but disabled rather than half-wired: selecting one can't write a
// `provider` value `getProvider()` (llm/provider.ts) has no case for.
const OPENAI_HOSTED_URL = "https://api.openai.com/v1";
const GEMINI_HOSTED_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const OLLAMA_URL = "http://localhost:11434/v1";
const LMSTUDIO_URL = "http://localhost:1234/v1";
const HOSTED_PRESET_URLS = new Set([OPENAI_HOSTED_URL, GEMINI_HOSTED_URL, OPENROUTER_URL]);
const LOCAL_PRESET_URLS = new Set([OLLAMA_URL, LMSTUDIO_URL]);

// A per-endpoint hint for the Model field below — cosmetic, falls back to
// today's generic placeholder for "Other"/a profile from before this
// existed, never validated against.
const MODEL_PLACEHOLDER: Record<string, string> = {
  [OPENAI_HOSTED_URL]: "gpt-5.1",
  [GEMINI_HOSTED_URL]: "gemini-2.5-pro",
  [OPENROUTER_URL]: "anthropic/claude-opus-4-8",
  [OLLAMA_URL]: "llama3.3",
  [LMSTUDIO_URL]: "llama-3.3-70b",
};

type BillingCategory = "subscription" | "hosted" | "local";

const CATEGORY_ORDER: BillingCategory[] = ["subscription", "hosted", "local"];

const CATEGORY_COPY: Record<BillingCategory, { label: string; hint: string }> = {
  subscription: {
    label: "Prepaid subscription",
    hint: "Billed against a plan you already pay for — no per-token cost.",
  },
  hosted: {
    label: "Pay-per-use API",
    hint: "A hosted endpoint, billed per token against your own API key.",
  },
  local: {
    label: "Local",
    hint: "Runs on this machine or your LAN — no cloud, no account.",
  },
};

interface ProviderOption {
  key: string;
  label: string;
  disabled?: boolean;
  /** Applied as `{...draft, ...patch}` in one write — never as two separate
   * `set()` calls, which would each read the same stale `draft` closure and
   * silently drop whichever field the other one touched. */
  patch: Partial<Draft>;
  active: (draft: Draft) => boolean;
}

function openaiCompatOption(key: string, label: string, url: string): ProviderOption {
  return {
    key,
    label,
    patch: { provider: "openai-compatible", openaiBaseUrl: url },
    active: (draft) => draft.provider === "openai-compatible" && (draft.openaiBaseUrl ?? "") === url,
  };
}

const CODEX_COMING_SOON: Omit<ProviderOption, "key" | "label"> = {
  disabled: true,
  patch: {},
  active: () => false,
};

const PROVIDER_OPTIONS: Record<BillingCategory, ProviderOption[]> = {
  subscription: [
    {
      key: "claude-agent",
      label: "Anthropic — Claude",
      patch: { provider: "claude-agent" },
      active: (draft) => draft.provider === "claude-agent",
    },
    { key: "codex-subscription", label: "OpenAI — Codex", ...CODEX_COMING_SOON },
  ],
  hosted: [
    {
      key: "anthropic",
      label: "Anthropic",
      patch: { provider: "anthropic" },
      active: (draft) => draft.provider === "anthropic",
    },
    openaiCompatOption("openai-hosted", "OpenAI", OPENAI_HOSTED_URL),
    openaiCompatOption("gemini", "Google Gemini", GEMINI_HOSTED_URL),
    openaiCompatOption("openrouter", "OpenRouter", OPENROUTER_URL),
    { key: "codex-hosted", label: "Codex", ...CODEX_COMING_SOON },
    {
      key: "other-hosted",
      label: "Other",
      patch: { provider: "openai-compatible", openaiBaseUrl: "" },
      active: (draft) =>
        draft.provider === "openai-compatible" &&
        !HOSTED_PRESET_URLS.has(draft.openaiBaseUrl ?? "") &&
        !LOCAL_PRESET_URLS.has(draft.openaiBaseUrl ?? ""),
    },
  ],
  local: [
    openaiCompatOption("ollama", "Ollama", OLLAMA_URL),
    openaiCompatOption("lmstudio", "LM Studio", LMSTUDIO_URL),
    {
      key: "other-local",
      label: "Other local server",
      patch: { provider: "openai-compatible", openaiBaseUrl: "" },
      active: (draft) =>
        draft.provider === "openai-compatible" &&
        !LOCAL_PRESET_URLS.has(draft.openaiBaseUrl ?? "") &&
        !HOSTED_PRESET_URLS.has(draft.openaiBaseUrl ?? ""),
    },
  ],
};

function categoryFromDraft(draft: Draft): BillingCategory {
  if (draft.provider === "claude-agent") return "subscription";
  if (draft.provider === "anthropic") return "hosted";
  return LOCAL_PRESET_URLS.has(draft.openaiBaseUrl ?? "") ? "local" : "hosted";
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
  // Local, not lifted: ProviderFields remounts fresh per edit session (the
  // parent's `editing` toggle unmounts it between "Edit" clicks — see
  // ProviderPicker below), so a lazy initializer derived once from the
  // draft that's already there is correct and never goes stale.
  const [category, setCategory] = useState<BillingCategory>(() => categoryFromDraft(draft));

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    onChange({ ...draft, [key]: value });
  }

  function selectCategory(next: BillingCategory) {
    setCategory(next);
    // Land on a real, working selection immediately rather than a category
    // shown with no provider tile active yet — the first non-disabled
    // option is as good a default as any.
    const first = PROVIDER_OPTIONS[next].find((option) => !option.disabled);
    if (first) onChange({ ...draft, ...first.patch });
  }

  function selectProvider(option: ProviderOption) {
    if (option.disabled) return;
    onChange({ ...draft, ...option.patch });
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
        <label className={styles.label}>Billing</label>
        <div className={styles.toggleRow} role="group" aria-label="Billing">
          {CATEGORY_ORDER.map((cat) => (
            <Button
              key={cat}
              variant="outline"
              size="sm"
              className={styles.toggleButton}
              pressed={category === cat}
              onClick={() => selectCategory(cat)}
            >
              {CATEGORY_COPY[cat].label}
            </Button>
          ))}
        </div>
        <p className={styles.hint}>{CATEGORY_COPY[category].hint}</p>
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Provider</label>
        <div className={styles.toggleRow} role="group" aria-label="Provider">
          {PROVIDER_OPTIONS[category].map((option) => (
            <Button
              key={option.key}
              variant="outline"
              size="sm"
              className={styles.toggleButton}
              pressed={option.active(draft)}
              disabled={option.disabled}
              title={option.disabled ? "Coming soon — needs M26's Codex CLI provider" : undefined}
              onClick={() => selectProvider(option)}
            >
              {option.label}
              {option.disabled ? " (coming soon)" : ""}
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
            <label className={styles.label} htmlFor={`${idPrefix}-openai-base-url`}>
              Base URL
            </label>
            <input
              id={`${idPrefix}-openai-base-url`}
              className={styles.input}
              type="text"
              value={draft.openaiBaseUrl ?? ""}
              placeholder="https://api.your-provider.com/v1"
              onChange={(e) => set("openaiBaseUrl", e.target.value)}
            />
            <p className={styles.hint}>
              Set by the provider tile above — edit directly for anything without one (GLM,
              Kimi, a self-hosted proxy, ...).
            </p>
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
              placeholder={MODEL_PLACEHOLDER[draft.openaiBaseUrl ?? ""] ?? "e.g. anthropic/claude-opus-4-8, llama3, ..."}
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
            <span className={styles.label} id={`${idPrefix}-context-tokens-label`}>
              Context length
            </span>
            <Slider
              ariaLabel="Context length"
              value={draft.openaiContextTokens ?? 32768}
              min={CONTEXT_TOKENS_MIN}
              max={CONTEXT_TOKENS_MAX}
              scale="log2"
              detents={CONTEXT_TOKEN_DETENTS}
              capture={{ fraction: 0.05 }}
              step={1}
              dragPxPerUnit={64}
              keyboardStep={2}
              formatValue={formatTokens}
              onCommit={(value) => set("openaiContextTokens", value)}
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
  onNavigateToSettings?: (event: import("react").MouseEvent<HTMLButtonElement>) => void;
  /** M24.7 §F: the composer's own mount (immediately left of Ask) drops the
   * "Query"/"Digest" role label — the row already reads as a model picker
   * from context, and the label is width the narrow composer row can't
   * spare and still keep Ask legible. Compact-variant only. */
  hideLabel?: boolean;
}

export function ProviderPicker({ role, variant, onNavigateToSettings, hideLabel }: ProviderPickerProps) {
  const { profiles, roles, loading, refresh } = useProviderRoles();
  const assignment = roles.find((r) => r.role === role) ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<
    { status: "idle" } | { status: "testing" } | { status: "ok" } | { status: "error"; message: string }
  >({ status: "idle" });
  const [maxTokensError, setMaxTokensError] = useState<string | null>(null);
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

  async function handleMaxResponseTokensCommit(value: number) {
    setMaxTokensError(null);
    const result = await setRoleMaxResponseTokens(role, value);
    if (result === null) {
      setMaxTokensError("Couldn't save the response length — try again.");
      return;
    }
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
        {!hideLabel && (
          <label className={styles.compactLabel} htmlFor={`provider-compact-${role}`}>
            {copy.label}
          </label>
        )}
        <select
          id={`provider-compact-${role}`}
          className={styles.compactSelect}
          aria-label={hideLabel ? copy.label : undefined}
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

      <div className={styles.field}>
        <span className={styles.label} id={`${role}-max-response-tokens-label`}>
          Max response length
        </span>
        <Slider
          ariaLabel={`${copy.label} max response length`}
          value={assignment?.maxResponseTokens ?? 8192}
          min={MAX_RESPONSE_TOKENS_MIN}
          max={MAX_RESPONSE_TOKENS_MAX}
          detents={RESPONSE_TOKEN_DETENTS}
          capture={{ absolute: 25 }}
          step={1}
          dragPxPerUnit={0.08}
          keyboardStep={250}
          formatValue={formatTokens}
          onCommit={handleMaxResponseTokensCommit}
        />
        {maxTokensError && <p className={styles.statusError}>{maxTokensError}</p>}
        <p className={styles.hint}>
          Applies to whichever profile answers this role — a subscription profile has no
          hard ceiling to enforce (only a request made in the system prompt); a keyed or
          local profile enforces it directly, so a low limit will visibly truncate answers.
        </p>
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
