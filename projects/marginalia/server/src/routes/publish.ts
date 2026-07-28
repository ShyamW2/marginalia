import { Router } from "express";
import { getDb } from "../db.js";
import { getResourceById } from "../library/store.js";
import { getProvider, LLMError, type LLMErrorCode } from "../llm/provider.js";
import { getRawSettings } from "../settings/store.js";
import { publishResource } from "../vault/compiler.js";

export const publishRouter: Router = Router();

const ERROR_STATUS: Record<LLMErrorCode, number> = {
  auth: 401,
  rate_limit: 429,
  context_too_large: 413,
  extract_parse_failed: 502,
  network: 502,
  refused: 502,
  unknown: 502,
};

publishRouter.post("/:id/publish", async (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }

  const { vaultPath } = getRawSettings(db);
  if (!vaultPath) {
    res.status(400).json({ error: "vault_path_unset" });
    return;
  }

  const provider = getProvider(db, "extract");
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  try {
    const result = await publishResource(db, provider, resource.id, vaultPath);
    res.json(result);
  } catch (err) {
    if (err instanceof LLMError) {
      // eslint-disable-next-line no-console
      console.error(`[publish] ${err.code}: ${err.message}`);
      res.status(ERROR_STATUS[err.code]).json({ error: err.code });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[publish]", err);
    res.status(500).json({ error: "publish_failed" });
  }
});
