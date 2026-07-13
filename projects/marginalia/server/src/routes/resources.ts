import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import { getDb } from "../db.js";
import { importEpub } from "../library/importResource.js";
import {
  getResourceById,
  getResourceFilePath,
  listResourceSummaries,
} from "../library/store.js";

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
