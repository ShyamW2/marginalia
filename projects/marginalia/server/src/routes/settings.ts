import { Router } from "express";
import { SettingsUpdateSchema } from "@marginalia/shared";
import { getDb } from "../db.js";
import { getSettings, updateSettings } from "../settings/store.js";

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
