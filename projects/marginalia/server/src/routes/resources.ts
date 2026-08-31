import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import {
  UpdateReadingPositionBodySchema,
  UpdateResourceLocationsBodySchema,
  UpdateShelfStateBodySchema,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import { importEpub } from "../library/importResource.js";
import { extractCoverImage, guessImageMimeType } from "../library/epub.js";
import {
  getReadingPosition,
  getResourceById,
  getResourceFilePath,
  getResourceLocations,
  listResourceSummaries,
  setReadingPosition,
  setResourceLocations,
  setShelfState,
} from "../library/store.js";
import { listHighlightsWithThreadsForResource } from "../annotations/highlights.js";
import { isReaderOrigin } from "../annotations/highlightOrigin.js";
import { buildScanData } from "../annotations/scan.js";
import { searchResource } from "../annotations/search.js";
import { getShowThematicQuotes } from "../digest/thematicQuoteVisibility.js";

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

resourcesRouter.get("/:id/cover", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  const filePath = getResourceFilePath(getDb(), req.params.id);
  const coverHref = resource?.metadata.coverHref;
  if (!resource || !coverHref || !filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "no_cover" });
    return;
  }

  const data = extractCoverImage(filePath, coverHref);
  if (!data) {
    res.status(404).json({ error: "no_cover" });
    return;
  }

  // Resources are content-addressed and immutable-on-import — this id's
  // cover bytes never change, so caching aggressively is safe.
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.type(guessImageMimeType(coverHref));
  res.send(data);
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
    parsed.data.spineIndex ?? null,
    parsed.data.percent ?? null,
  );
  res.json(position);
});

// M19.6 "page numbers, book-wide and stable": epub.js generates and
// serialises the `locations` blob in the browser (the server has no EPUB
// renderer, per SPEC) and caches it here so it's never regenerated for the
// same resource — resources are immutable-on-import (settled decision 5),
// so the blob can never rot. The server treats it as opaque.
resourcesRouter.get("/:id/locations", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ locations: getResourceLocations(getDb(), req.params.id) });
});

resourcesRouter.put("/:id/locations", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = UpdateResourceLocationsBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setResourceLocations(getDb(), req.params.id, parsed.data.locations);
  res.json({ locations: parsed.data.locations });
});

resourcesRouter.put("/:id/shelf", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = UpdateShelfStateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setShelfState(getDb(), req.params.id, parsed.data);
  res.json(parsed.data);
});

resourcesRouter.get("/:id/highlights", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const all = listHighlightsWithThreadsForResource(db, req.params.id);
  // M35 §C7: off by default — a thematic-origin highlight (§C5) never
  // reaches the client (so it never paints inline, never appears in the
  // margin rail) until the reader opts in. §C6's own unconditional
  // exclusion from the count/Annotations list/vault is separate and applies
  // even when this toggle is on; the client re-filters for that itself.
  const highlights = getShowThematicQuotes(db, req.params.id) ? all : all.filter(isReaderOrigin);
  res.json(highlights);
});

resourcesRouter.get("/:id/scan", (req, res) => {
  const data = buildScanData(getDb(), req.params.id);
  if (!data) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(data);
});

resourcesRouter.get("/:id/search", (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q : "";
  // M24.1 C: whole-word unless the caller explicitly asks for substring —
  // an unparseable value is the default, not an error, since the rule only
  // changes which hits come back.
  const mode = req.query.mode === "substring" ? "substring" : "word";
  const hits = searchResource(getDb(), req.params.id, query, mode);
  if (!hits) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(hits);
});
