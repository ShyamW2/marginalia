import { Router } from "express";
import {
  CreateProviderProfileBodySchema,
  SetProviderRoleBodySchema,
  UpdateProviderProfileBodySchema,
  type LLMProviderId,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import {
  createProviderProfile,
  deleteProviderProfile,
  getProviderProfile,
  getProviderProfileRaw,
  getProviderRoles,
  listProviderProfiles,
  setProviderRole,
  updateProviderProfile,
} from "../settings/providers.js";
import { getRawSettings } from "../settings/store.js";
import { AnthropicProvider } from "../llm/anthropic.js";
import { ClaudeAgentProvider } from "../llm/claudeAgent.js";
import { OpenAICompatProvider } from "../llm/openaiCompat.js";
import { LLMError, type LLMProvider } from "../llm/provider.js";

export const providerProfilesRouter: Router = Router();

providerProfilesRouter.get("/", (_req, res) => {
  res.json(listProviderProfiles(getDb()));
});

providerProfilesRouter.post("/", (req, res) => {
  const parsed = CreateProviderProfileBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  res.status(201).json(createProviderProfile(getDb(), parsed.data));
});

providerProfilesRouter.put("/:id", (req, res) => {
  const parsed = UpdateProviderProfileBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const updated = updateProviderProfile(getDb(), req.params.id, parsed.data);
  if (!updated) {
    res.status(404).json({ error: "profile_not_found" });
    return;
  }
  res.json(updated);
});

providerProfilesRouter.delete("/:id", (req, res) => {
  const db = getDb();
  if (!getProviderProfile(db, req.params.id)) {
    res.status(404).json({ error: "profile_not_found" });
    return;
  }
  deleteProviderProfile(db, req.params.id);
  res.status(204).end();
});

/** Runs a minimal, aborted-after-first-token stream against a candidate
 * profile config — same "test connection" contract the old flat-settings
 * /api/settings/test had, now scoped to one profile. A masked secret field
 * ("***") in the body falls back to the profile's saved value (if any)
 * rather than to nothing, so editing the model without retyping a
 * already-set key can still be tested. */
providerProfilesRouter.post("/:id/test", async (req, res) => {
  const parsed = UpdateProviderProfileBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const db = getDb();
  const saved = req.params.id === "new" ? null : getProviderProfileRaw(db, req.params.id);
  const candidate = { ...saved, ...parsed.data } as {
    provider?: LLMProviderId;
    anthropicModel?: string;
    anthropicApiKey?: string;
    claudeAgentModel?: string;
    openaiBaseUrl?: string;
    openaiModel?: string;
    openaiApiKey?: string;
    openaiContextTokens?: number;
  };
  if (candidate.anthropicApiKey === "***") candidate.anthropicApiKey = saved?.anthropicApiKey;
  if (candidate.openaiApiKey === "***") candidate.openaiApiKey = saved?.openaiApiKey;

  const { maxResponseTokens } = getRawSettings(db);

  let provider: LLMProvider | null = null;
  if (candidate.provider === "anthropic") {
    if (!candidate.anthropicApiKey) {
      res.json({ ok: false, error: "No Anthropic API key set." });
      return;
    }
    provider = new AnthropicProvider(
      candidate.anthropicApiKey,
      candidate.anthropicModel ?? "",
      maxResponseTokens,
    );
  } else if (candidate.provider === "claude-agent") {
    provider = new ClaudeAgentProvider(candidate.claudeAgentModel ?? "", maxResponseTokens);
  } else if (candidate.provider === "openai-compatible") {
    if (!candidate.openaiBaseUrl || !candidate.openaiModel) {
      res.json({ ok: false, error: "Base URL and model are required." });
      return;
    }
    provider = new OpenAICompatProvider({
      baseUrl: candidate.openaiBaseUrl,
      model: candidate.openaiModel,
      apiKey: candidate.openaiApiKey ?? "",
      contextTokens: candidate.openaiContextTokens ?? 32768,
      maxResponseTokens,
    });
  }

  if (!provider) {
    res.json({ ok: false, error: "No provider configured." });
    return;
  }

  const controller = new AbortController();
  try {
    for await (const chunk of provider.stream({
      instructions: "Reply with a single word.",
      bookContext: "(connection test — no book context)",
      messages: [{ role: "user", content: "Say hi." }],
      signal: controller.signal,
    })) {
      if (chunk.text.length > 0) {
        controller.abort();
        break;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof LLMError) {
      res.json({ ok: false, error: `${err.code}: ${err.message}` });
      return;
    }
    res.json({ ok: false, error: err instanceof Error ? err.message : "unknown_error" });
  }
});

export const providerRolesRouter: Router = Router();

providerRolesRouter.get("/", (_req, res) => {
  res.json(getProviderRoles(getDb()));
});

providerRolesRouter.put("/:role", (req, res) => {
  const role = req.params.role;
  if (role !== "query" && role !== "digest") {
    res.status(400).json({ error: "invalid_role" });
    return;
  }
  const parsed = SetProviderRoleBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const db = getDb();
  if (parsed.data.profileId && !getProviderProfile(db, parsed.data.profileId)) {
    res.status(404).json({ error: "profile_not_found" });
    return;
  }
  res.json(setProviderRole(db, role, parsed.data.profileId));
});
