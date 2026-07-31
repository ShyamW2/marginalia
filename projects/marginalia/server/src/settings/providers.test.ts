import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  createProviderProfile,
  deleteProviderProfile,
  getProviderProfile,
  getProviderRoles,
  getRoleProfileRaw,
  listProviderProfiles,
  setProviderRole,
  setRoleMaxResponseTokens,
  updateProviderProfile,
} from "./providers.js";
import { getProvider } from "../llm/provider.js";

describe("M19 migration 14 — silent provider profile migration", () => {
  it("turns a pre-M19 settings row into a Default profile that both roles point at", () => {
    const db = createDb(":memory:");
    // Simulate a pre-M19 database: someone had already configured Anthropic
    // via the old flat settings table before this migration ever ran.
    db.prepare("DELETE FROM provider_roles").run();
    db.prepare("DELETE FROM provider_profiles").run();
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('provider', 'anthropic'), ('anthropic_model', 'claude-opus-4-8'), ('anthropic_api_key', 'sk-ant-test')",
    ).run();
    // Re-run just the migration 14 SQL against this state, the same shape
    // db.ts applies at startup for a real upgrade.
    db.exec(`
      INSERT INTO provider_profiles
        (id, name, provider, anthropic_model, anthropic_api_key, claude_agent_model,
         openai_base_url, openai_model, openai_api_key, openai_context_tokens,
         created_at, updated_at)
      VALUES (
        'default', 'Default',
        COALESCE((SELECT value FROM settings WHERE key = 'provider'), 'anthropic'),
        COALESCE((SELECT value FROM settings WHERE key = 'anthropic_model'), 'claude-opus-4-8'),
        COALESCE((SELECT value FROM settings WHERE key = 'anthropic_api_key'), ''),
        COALESCE((SELECT value FROM settings WHERE key = 'claude_agent_model'), 'claude-sonnet-5'),
        COALESCE((SELECT value FROM settings WHERE key = 'openai_base_url'), ''),
        COALESCE((SELECT value FROM settings WHERE key = 'openai_model'), ''),
        COALESCE((SELECT value FROM settings WHERE key = 'openai_api_key'), ''),
        COALESCE((SELECT value FROM settings WHERE key = 'openai_context_tokens'), '32768'),
        '2026-07-29T00:00:00.000Z', '2026-07-29T00:00:00.000Z'
      );
      INSERT INTO provider_roles (role, profile_id) VALUES ('query', 'default');
      INSERT INTO provider_roles (role, profile_id) VALUES ('digest', 'default');
    `);

    const roles = getProviderRoles(db);
    expect(roles).toHaveLength(2);
    for (const assignment of roles) {
      expect(assignment.profile?.name).toBe("Default");
      expect(assignment.profile?.provider).toBe("anthropic");
      expect(assignment.profile?.anthropicModel).toBe("claude-opus-4-8");
      expect(assignment.profile?.anthropicApiKey).toBe("***"); // masked
      expect(assignment.configured).toBe(true);
    }
    db.close();
  });

  it("a fresh database already has both roles pointing at the Default profile", () => {
    const db = createDb(":memory:");
    const roles = getProviderRoles(db);
    expect(roles.map((r) => r.role).sort()).toEqual(["digest", "query"]);
    expect(roles.every((r) => r.profileId === "default")).toBe(true);
    db.close();
  });
});

describe("provider profile CRUD", () => {
  it("creates, lists (masked), updates, and deletes a profile", () => {
    const db = createDb(":memory:");
    const created = createProviderProfile(db, {
      name: "Local Hermes",
      provider: "openai-compatible",
      openaiBaseUrl: "http://localhost:11434/v1",
      openaiModel: "hermes3",
      openaiApiKey: "secret-key",
      openaiContextTokens: 8192,
    });
    expect(created.openaiApiKey).toBe("***");

    const listed = listProviderProfiles(db);
    expect(listed.map((p) => p.name)).toEqual(expect.arrayContaining(["Default", "Local Hermes"]));

    const updated = updateProviderProfile(db, created.id, { name: "Local Hermes (renamed)" });
    expect(updated?.name).toBe("Local Hermes (renamed)");

    // "***" means leave the secret unchanged, not overwrite with the literal.
    updateProviderProfile(db, created.id, { openaiApiKey: "***" });
    const stillMasked = getProviderProfile(db, created.id);
    expect(stillMasked?.openaiApiKey).toBe("***");

    deleteProviderProfile(db, created.id);
    expect(getProviderProfile(db, created.id)).toBeNull();
    db.close();
  });

  it("deleting a profile a role points at degrades that role to unconfigured, not a dangling reference", () => {
    const db = createDb(":memory:");
    const profile = createProviderProfile(db, {
      name: "Temp",
      provider: "openai-compatible",
      openaiBaseUrl: "http://localhost:11434/v1",
      openaiModel: "hermes3",
    });
    setProviderRole(db, "digest", profile.id);
    expect(getRoleProfileRaw(db, "digest")?.id).toBe(profile.id);

    deleteProviderProfile(db, profile.id);

    const assignment = getProviderRoles(db).find((r) => r.role === "digest")!;
    expect(assignment.profileId).toBeNull();
    expect(assignment.profile).toBeNull();
    expect(assignment.configured).toBe(false);
    db.close();
  });
});

describe("roles resolve to independent profiles", () => {
  it("digests a book on a local model while questions are answered by Claude, in the same session", () => {
    const db = createDb(":memory:");
    updateProviderProfile(db, "default", {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-8",
      anthropicApiKey: "sk-ant-test",
    });
    const localProfile = createProviderProfile(db, {
      name: "Local Hermes",
      provider: "openai-compatible",
      openaiBaseUrl: "http://localhost:11434/v1",
      openaiModel: "hermes3",
      openaiContextTokens: 8192,
    });
    setProviderRole(db, "digest", localProfile.id);
    // "query" role is untouched — still points at Default (Anthropic).

    const queryProvider = getProvider(db, "query", "thread");
    const digestProvider = getProvider(db, "digest", "digest");
    expect(queryProvider?.id).toBe("anthropic");
    expect(digestProvider?.id).toBe("openai-compatible");
    db.close();
  });

  it("a role with no configured profile returns null, same nudge as an unconfigured provider", () => {
    const db = createDb(":memory:");
    updateProviderProfile(db, "default", {
      provider: "anthropic",
      anthropicModel: "claude-opus-4-8",
      anthropicApiKey: "sk-ant-test",
    });
    setProviderRole(db, "digest", null);
    expect(getProvider(db, "digest", "digest")).toBeNull();
    // query role, still pointing at the configured Default profile, is unaffected.
    expect(getProvider(db, "query", "thread")).not.toBeNull();
    db.close();
  });
});

describe("M19.7 migration 20 — max response length becomes per-role", () => {
  it("a fresh database has both roles at the same 8192 default the old global setting used", () => {
    const db = createDb(":memory:");
    const roles = getProviderRoles(db);
    expect(roles.every((r) => r.maxResponseTokens === 8192)).toBe(true);
    db.close();
  });

  it("carries over a customized global value into both roles, not just the bare column default", () => {
    const db = createDb(":memory:");
    // Simulate a pre-M19.7 database where the reader had turned this down
    // from the 8192 default before the migration ever ran.
    db.prepare("UPDATE provider_roles SET max_response_tokens = 8192").run();
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('max_response_tokens', '2048') ON CONFLICT(key) DO UPDATE SET value = '2048'",
    ).run();
    db.exec(`
      UPDATE provider_roles
        SET max_response_tokens = CAST(
          COALESCE((SELECT value FROM settings WHERE key = 'max_response_tokens'), '8192') AS INTEGER
        );
    `);
    const roles = getProviderRoles(db);
    expect(roles.every((r) => r.maxResponseTokens === 2048)).toBe(true);
    db.close();
  });

  it("query and digest can hold different response lengths on the same profile", () => {
    const db = createDb(":memory:");
    setRoleMaxResponseTokens(db, "query", 1000);
    setRoleMaxResponseTokens(db, "digest", 8000);
    const roles = getProviderRoles(db);
    expect(roles.find((r) => r.role === "query")?.maxResponseTokens).toBe(1000);
    expect(roles.find((r) => r.role === "digest")?.maxResponseTokens).toBe(8000);
    // Both still resolve to the same Default profile — this is a role
    // property, not a profile one.
    expect(roles.find((r) => r.role === "query")?.profileId).toBe("default");
    expect(roles.find((r) => r.role === "digest")?.profileId).toBe("default");
    db.close();
  });
});
