import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type {
  CreateProviderProfileBody,
  LLMProviderId,
  ProviderProfile,
  ProviderRole,
  ProviderRoleAssignment,
  UpdateProviderProfileBody,
} from "@marginalia/shared";

const MASK = "***";
const SECRET_FIELDS = ["anthropicApiKey", "openaiApiKey"] as const;

interface ProfileRow {
  id: string;
  name: string;
  provider: string;
  anthropic_model: string;
  anthropic_api_key: string;
  claude_agent_model: string;
  codex_model: string;
  openai_base_url: string;
  openai_model: string;
  openai_api_key: string;
  openai_context_tokens: string;
  created_at: string;
  updated_at: string;
}

function rowToProfile(row: ProfileRow): ProviderProfile {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as LLMProviderId,
    anthropicModel: row.anthropic_model,
    anthropicApiKey: row.anthropic_api_key,
    claudeAgentModel: row.claude_agent_model,
    codexModel: row.codex_model,
    openaiBaseUrl: row.openai_base_url,
    openaiModel: row.openai_model,
    openaiApiKey: row.openai_api_key,
    openaiContextTokens: Number.parseInt(row.openai_context_tokens, 10),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function maskProfile(profile: ProviderProfile): ProviderProfile {
  return {
    ...profile,
    anthropicApiKey: profile.anthropicApiKey ? MASK : "",
    openaiApiKey: profile.openaiApiKey ? MASK : "",
  };
}

/** Unmasked — internal use only (the LLM provider layer). Never expose via HTTP. */
export function getProviderProfileRaw(
  db: Database.Database,
  id: string,
): ProviderProfile | null {
  const row = db
    .prepare("SELECT * FROM provider_profiles WHERE id = ?")
    .get(id) as ProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

export function listProviderProfiles(db: Database.Database): ProviderProfile[] {
  const rows = db
    .prepare("SELECT * FROM provider_profiles ORDER BY created_at ASC")
    .all() as ProfileRow[];
  return rows.map((row) => maskProfile(rowToProfile(row)));
}

export function getProviderProfile(
  db: Database.Database,
  id: string,
): ProviderProfile | null {
  const profile = getProviderProfileRaw(db, id);
  return profile ? maskProfile(profile) : null;
}

export function createProviderProfile(
  db: Database.Database,
  body: CreateProviderProfileBody,
): ProviderProfile {
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    name: body.name,
    provider: body.provider,
    anthropic_model: body.anthropicModel ?? "",
    anthropic_api_key: body.anthropicApiKey ?? "",
    claude_agent_model: body.claudeAgentModel ?? "",
    codex_model: body.codexModel ?? "",
    openai_base_url: body.openaiBaseUrl ?? "",
    openai_model: body.openaiModel ?? "",
    openai_api_key: body.openaiApiKey ?? "",
    openai_context_tokens: String(body.openaiContextTokens ?? 32768),
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO provider_profiles
       (id, name, provider, anthropic_model, anthropic_api_key, claude_agent_model, codex_model,
        openai_base_url, openai_model, openai_api_key, openai_context_tokens,
        created_at, updated_at)
     VALUES
       (@id, @name, @provider, @anthropic_model, @anthropic_api_key, @claude_agent_model, @codex_model,
        @openai_base_url, @openai_model, @openai_api_key, @openai_context_tokens,
        @created_at, @updated_at)`,
  ).run(row);
  return maskProfile(rowToProfile(row));
}

const UPDATE_FIELD_TO_COLUMN: Record<keyof UpdateProviderProfileBody, string> = {
  name: "name",
  provider: "provider",
  anthropicModel: "anthropic_model",
  anthropicApiKey: "anthropic_api_key",
  claudeAgentModel: "claude_agent_model",
  codexModel: "codex_model",
  openaiBaseUrl: "openai_base_url",
  openaiModel: "openai_model",
  openaiApiKey: "openai_api_key",
  openaiContextTokens: "openai_context_tokens",
};

/**
 * PUT /api/provider-profiles/:id — partial update. A secret field of exactly
 * "***" means "leave unchanged" (echo of the masked GET value), same
 * convention as settings/store.ts's updateSettings.
 */
export function updateProviderProfile(
  db: Database.Database,
  id: string,
  update: UpdateProviderProfileBody,
): ProviderProfile | null {
  const existing = getProviderProfileRaw(db, id);
  if (!existing) return null;

  const sets: string[] = [];
  const params: Record<string, string> = { id };
  for (const [field, value] of Object.entries(update)) {
    if (value === undefined) continue;
    const column = UPDATE_FIELD_TO_COLUMN[field as keyof UpdateProviderProfileBody];
    if (!column) continue;
    if (SECRET_FIELDS.includes(field as (typeof SECRET_FIELDS)[number]) && value === MASK) {
      continue; // leave unchanged
    }
    sets.push(`${column} = @${column}`);
    params[column] = String(value);
  }
  if (sets.length > 0) {
    params.updated_at = new Date().toISOString();
    db.prepare(
      `UPDATE provider_profiles SET ${sets.join(", ")}, updated_at = @updated_at WHERE id = @id`,
    ).run(params);
  }
  return getProviderProfile(db, id);
}

/** Deletes a profile. Any role pointing at it falls back to null (the
 * "configure a provider" nudge), never a dangling foreign key. */
export function deleteProviderProfile(db: Database.Database, id: string): void {
  const applyAll = db.transaction(() => {
    db.prepare("UPDATE provider_roles SET profile_id = NULL WHERE profile_id = ?").run(id);
    db.prepare("DELETE FROM provider_profiles WHERE id = ?").run(id);
  });
  applyAll();
}

const ROLES: ProviderRole[] = ["query", "digest"];

/** Resolves a role straight to its profile, unmasked — the only function the
 * LLM provider layer (llm/provider.ts) should call. */
export function getRoleProfileRaw(
  db: Database.Database,
  role: ProviderRole,
): ProviderProfile | null {
  const row = db
    .prepare("SELECT profile_id FROM provider_roles WHERE role = ?")
    .get(role) as { profile_id: string | null } | undefined;
  if (!row?.profile_id) return null;
  return getProviderProfileRaw(db, row.profile_id);
}

/** M19.7 "response length is per role": the only other thing
 * llm/provider.ts's getProvider() needs from provider_roles besides the
 * profile itself. Always returns a value — both roles' rows are created by
 * migration 14 and never deleted, only reassigned (setProviderRole). */
export function getRoleMaxResponseTokens(db: Database.Database, role: ProviderRole): number {
  const row = db
    .prepare("SELECT max_response_tokens FROM provider_roles WHERE role = ?")
    .get(role) as { max_response_tokens: number } | undefined;
  return row?.max_response_tokens ?? 8192;
}

export function getProviderRoles(db: Database.Database): ProviderRoleAssignment[] {
  return ROLES.map((role) => {
    const row = db
      .prepare("SELECT profile_id, max_response_tokens FROM provider_roles WHERE role = ?")
      .get(role) as { profile_id: string | null; max_response_tokens: number } | undefined;
    const profileId = row?.profile_id ?? null;
    const profile = profileId ? getProviderProfile(db, profileId) : null;
    return {
      role,
      profileId,
      profile,
      configured: isProfileConfigured(profile),
      maxResponseTokens: row?.max_response_tokens ?? 8192,
    };
  });
}

/** A profile "is configured" the same way the old flat settings answered
 * isProviderConfigured() — enough to attempt a call, not that the call will
 * succeed. */
function isProfileConfigured(profile: ProviderProfile | null): boolean {
  if (!profile) return false;
  if (profile.provider === "anthropic") return Boolean(profile.anthropicApiKey);
  if (profile.provider === "claude-agent") return true; // uses local Claude Code login
  if (profile.provider === "codex-cli") return true; // uses local `codex login`
  return Boolean(profile.openaiBaseUrl && profile.openaiModel);
}

/** PUT /api/provider-roles/:role — reassign which profile a role points at.
 * `profileId: null` clears it (degrades to the "configure a provider" nudge). */
export function setProviderRole(
  db: Database.Database,
  role: ProviderRole,
  profileId: string | null,
): ProviderRoleAssignment {
  db.prepare(
    `INSERT INTO provider_roles (role, profile_id) VALUES (@role, @profileId)
     ON CONFLICT(role) DO UPDATE SET profile_id = @profileId`,
  ).run({ role, profileId });
  return getProviderRoles(db).find((r) => r.role === role)!;
}

/** PUT /api/provider-roles/:role/max-response-tokens — a role property, not
 * a profile one (M19.7: one profile can serve both roles at different
 * lengths, e.g. shorter query answers and longer digests). */
export function setRoleMaxResponseTokens(
  db: Database.Database,
  role: ProviderRole,
  maxResponseTokens: number,
): ProviderRoleAssignment {
  db.prepare("UPDATE provider_roles SET max_response_tokens = @maxResponseTokens WHERE role = @role").run({
    role,
    maxResponseTokens,
  });
  return getProviderRoles(db).find((r) => r.role === role)!;
}
