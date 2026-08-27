import { Router } from "express";
import { ProviderAuthProviderSchema } from "@marginalia/shared";
import {
  cancelAuthFlow,
  checkAuthStatus,
  describeCli,
  getAuthFlow,
  logout,
  startAuthFlow,
} from "../llm/authFlows.js";

export const providerAuthRouter: Router = Router();

function parseProvider(req: { params: { provider: string } }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  const parsed = ProviderAuthProviderSchema.safeParse(req.params.provider);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_provider" });
    return null;
  }
  return parsed.data;
}

providerAuthRouter.get("/:provider/status", async (req, res) => {
  const provider = parseProvider(req, res);
  if (!provider) return;
  res.json(await checkAuthStatus(provider));
});

/** Read-only machine diagnostics behind the Settings setup guide — where the
 * CLI is, or where we looked for it. Never returns credentials. */
providerAuthRouter.get("/:provider/diagnostics", async (req, res) => {
  const provider = parseProvider(req, res);
  if (!provider) return;
  res.json(await describeCli(provider));
});

providerAuthRouter.post("/:provider/login", (req, res) => {
  const provider = parseProvider(req, res);
  if (!provider) return;
  res.status(201).json(startAuthFlow(provider));
});

providerAuthRouter.get("/:provider/login/:flowId", (req, res) => {
  if (!parseProvider(req, res)) return;
  const flow = getAuthFlow(req.params.flowId);
  if (!flow) {
    res.status(404).json({ error: "flow_not_found" });
    return;
  }
  res.json(flow);
});

providerAuthRouter.delete("/:provider/login/:flowId", (req, res) => {
  if (!parseProvider(req, res)) return;
  cancelAuthFlow(req.params.flowId);
  res.status(204).end();
});

providerAuthRouter.post("/:provider/logout", async (req, res) => {
  const provider = parseProvider(req, res);
  if (!provider) return;
  await logout(provider);
  res.status(204).end();
});
