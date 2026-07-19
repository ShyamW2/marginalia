import type Database from "better-sqlite3";
import type {
  CursorStyleChoice,
  LLMProviderId,
  Settings,
  SettingsUpdate,
} from "@marginalia/shared";

const DEFAULTS = {
  provider: "anthropic" as LLMProviderId,
  anthropic_model: "claude-opus-4-8",
  anthropic_api_key: "",
  claude_agent_model: "claude-sonnet-5",
  openai_base_url: "",
  openai_model: "",
  openai_api_key: "",
  openai_context_tokens: "32768",
  vault_path: "",
  cursor_style: "custom" as CursorStyleChoice,
  cursor_trail_enabled: "true",
};

type SettingsKey = keyof typeof DEFAULTS;

const KEY_TO_FIELD: Record<SettingsKey, keyof Settings> = {
  provider: "provider",
  anthropic_model: "anthropicModel",
  anthropic_api_key: "anthropicApiKey",
  claude_agent_model: "claudeAgentModel",
  openai_base_url: "openaiBaseUrl",
  openai_model: "openaiModel",
  openai_api_key: "openaiApiKey",
  openai_context_tokens: "openaiContextTokens",
  vault_path: "vaultPath",
  cursor_style: "cursorStyle",
  cursor_trail_enabled: "cursorTrailEnabled",
};

const FIELD_TO_KEY = Object.fromEntries(
  Object.entries(KEY_TO_FIELD).map(([key, field]) => [field, key]),
) as Record<keyof Settings, SettingsKey>;

const SECRET_FIELDS: (keyof Settings)[] = ["anthropicApiKey", "openaiApiKey"];
const MASK = "***";

function readRaw(db: Database.Database): Record<SettingsKey, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored } as Record<SettingsKey, string>;
}

/** Unmasked settings for internal use (the LLM provider layer). Never expose via HTTP. */
export function getRawSettings(db: Database.Database): {
  provider: LLMProviderId;
  anthropicModel: string;
  anthropicApiKey: string;
  claudeAgentModel: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey: string;
  openaiContextTokens: number;
  vaultPath: string;
  cursorStyle: CursorStyleChoice;
  cursorTrailEnabled: boolean;
} {
  const raw = readRaw(db);
  return {
    provider: raw.provider as LLMProviderId,
    anthropicModel: raw.anthropic_model,
    anthropicApiKey: raw.anthropic_api_key,
    claudeAgentModel: raw.claude_agent_model,
    openaiBaseUrl: raw.openai_base_url,
    openaiModel: raw.openai_model,
    openaiApiKey: raw.openai_api_key,
    openaiContextTokens: Number.parseInt(raw.openai_context_tokens, 10),
    vaultPath: raw.vault_path,
    cursorStyle: raw.cursor_style as CursorStyleChoice,
    cursorTrailEnabled: raw.cursor_trail_enabled === "true",
  };
}

/** GET /api/settings response — secret fields masked. */
export function getSettings(db: Database.Database): Settings {
  const raw = getRawSettings(db);
  return {
    ...raw,
    anthropicApiKey: raw.anthropicApiKey ? MASK : "",
    openaiApiKey: raw.openaiApiKey ? MASK : "",
  };
}

/**
 * PUT /api/settings — partial update. A secret field of exactly "***" means
 * "leave unchanged" (the echoed masked value from GET); an empty string
 * clears it; anything else replaces it.
 */
export function updateSettings(
  db: Database.Database,
  update: SettingsUpdate,
): Settings {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`,
  );

  const applyAll = db.transaction(() => {
    for (const [field, value] of Object.entries(update)) {
      if (value === undefined) continue;
      const key = FIELD_TO_KEY[field as keyof Settings];
      if (!key) continue;
      if (SECRET_FIELDS.includes(field as keyof Settings) && value === MASK) {
        continue; // leave unchanged
      }
      upsert.run({ key, value: String(value) });
    }
  });
  applyAll();

  return getSettings(db);
}
