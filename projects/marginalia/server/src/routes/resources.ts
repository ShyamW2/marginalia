import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import { UpdateReadingPositionBodySchema } from "@marginalia/shared";
import { getDb } from "../db.js";
import { importEpub } from "../library/importResource.js";
import {
  getReadingPosition,
  getResourceById,
  getResourceFilePath,
  listResourceSummaries,
  setReadingPosition,
} from "../library/store.js";
import { listHighlightsWithThreadsForResource } from "../annotations/highlights.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

export const resourcesRouter: Router = Router();

resourcesRouter.post("/", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "missing_file" });
    return;
  }
  if (!req.file.originalname.toLowerCase().endsWith(".epub")) {
    res.status(400).json({ error: "unsupported_format" });
    return;
  }

  try {
    const resource = importEpub(getDb(), req.file.buffer);
    res.status(200).json(resource);
  } catch (err) {
    res.status(422).json({
      error: err instanceof Error ? err.message : "import_failed",
    });
  }
});

resourcesRouter.get("/", (_req, res) => {
  res.json(listResourceSummaries(getDb()));
});

resourcesRouter.get("/:id", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(resource);
});

resourcesRouter.get("/:id/file", (req, res) => {
  const filePath = getResourceFilePath(getDb(), req.params.id);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.type("application/epub+zip");
  res.sendFile(filePath);
});

resourcesRouter.get("/:id/position", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const position = getReadingPosition(getDb(), req.params.id);
  res.json(position ?? null);
});

resourcesRouter.put("/:id/position", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = UpdateReadingPositionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const position = setReadingPosition(
    getDb(),
    req.params.id,
    parsed.data.location,
  );
  res.json(position);
});

resourcesRouter.get("/:id/highlights", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(listHighlightsWithThreadsForResource(getDb(), req.params.id));
});
