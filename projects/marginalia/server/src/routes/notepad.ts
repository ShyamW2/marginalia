import { Router } from "express";
import { UpdateNotepadBodySchema } from "@marginalia/shared";
import { getDb } from "../db.js";
import { getNotepad, updateNotepadContent } from "../notepad/store.js";
import { getProvider, LLMError, type LLMErrorCode } from "../llm/provider.js";
import { getRawSettings } from "../settings/store.js";
import { publishNotepad } from "../vault/compiler.js";

export const notepadRouter: Router = Router();

const ERROR_STATUS: Record<LLMErrorCode, number> = {
  auth: 401,
  rate_limit: 429,
  context_too_large: 413,
  extract_parse_failed: 502,
  network: 502,
  refused: 502,
  unknown: 502,
};

notepadRouter.get("/", (_req, res) => {
  res.json(getNotepad(getDb()));
});

notepadRouter.put("/", (req, res) => {
  const parsed = UpdateNotepadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  res.json(updateNotepadContent(getDb(), parsed.data.content));
});

notepadRouter.post("/publish", async (_req, res) => {
  const db = getDb();
  const { vaultPath } = getRawSettings(db);
  if (!vaultPath) {
    res.status(400).json({ error: "vault_path_unset" });
    return;
  }

  const provider = getProvider(db, "digest", "extract");
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  try {
    const result = await publishNotepad(db, provider, vaultPath);
    res.json(result);
  } catch (err) {
    if (err instanceof LLMError) {
      // eslint-disable-next-line no-console
      console.error(`[notepad publish] ${err.code}: ${err.message}`);
      res.status(ERROR_STATUS[err.code]).json({ error: err.code });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[notepad publish]", err);
    res.status(500).json({ error: "publish_failed" });
  }
});
