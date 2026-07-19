import { Router } from "express";
import { SettingsUpdateSchema } from "@marginalia/shared";
import { getDb } from "../db.js";
import { getRawSettings, getSettings, updateSettings } from "../settings/store.js";
import { AnthropicProvider } from "../llm/anthropic.js";
import { ClaudeAgentProvider } from "../llm/claudeAgent.js";
import { OpenAICompatProvider } from "../llm/openaiCompat.js";
import { LLMError, type LLMProvider } from "../llm/provider.js";

export const settingsRouter: Router = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(getSettings(getDb()));
});

settingsRouter.put("/", (req, res) => {
  const parsed = SettingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  res.json(updateSettings(getDb(), parsed.data));
});

/**
 * "Test connection": runs a minimal, aborted-after-first-token stream
 * against the *candidate* settings (which may not be saved yet — masked
 * secret fields ("***") fall back to the currently-saved value so the user
 * can test without retyping an already-set key).
 */
settingsRouter.post("/test", async (req, res) => {
  const parsed = SettingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  const current = getRawSettings(getDb());
  const candidate = { ...current, ...parsed.data };
  if (candidate.anthropicApiKey === "***") candidate.anthropicApiKey = current.anthropicApiKey;
  if (candidate.openaiApiKey === "***") candidate.openaiApiKey = current.openaiApiKey;

  let provider: LLMProvider | null = null;
  if (candidate.provider === "anthropic") {
    if (!candidate.anthropicApiKey) {
      res.json({ ok: false, error: "No Anthropic API key set." });
      return;
    }
    provider = new AnthropicProvider(candidate.anthropicApiKey, candidate.anthropicModel);
  } else if (candidate.provider === "claude-agent") {
    provider = new ClaudeAgentProvider(candidate.claudeAgentModel);
  } else if (candidate.provider === "openai-compatible") {
    if (!candidate.openaiBaseUrl || !candidate.openaiModel) {
      res.json({ ok: false, error: "Base URL and model are required." });
      return;
    }
    provider = new OpenAICompatProvider({
      baseUrl: candidate.openaiBaseUrl,
      model: candidate.openaiModel,
      apiKey: candidate.openaiApiKey,
      contextTokens: candidate.openaiContextTokens,
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
