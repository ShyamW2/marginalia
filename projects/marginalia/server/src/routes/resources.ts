import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import {
  UpdateReadingPositionBodySchema,
  UpdateResourceKindBodySchema,
  UpdateResourceLocationsBodySchema,
  UpdateShelfStateBodySchema,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import { importEpub } from "../library/importResource.js";
import {
  ensureReflowEpubPath,
  hashPdfBuffer,
  importPdf,
  PdfInvalidError,
  PdfPasswordError,
  reflowEpubPath,
} from "../library/importPdf.js";
import { extractCoverImage, guessImageMimeType } from "../library/epub.js";
import {
  deleteResource,
  getPdfPageSections,
  getReadingPosition,
  getResourceById,
  getResourceFilePath,
  getResourceLocations,
  getResourceTextSections,
  listResourceSummaries,
  setReadingPosition,
  setResourceKind,
  setResourceLocations,
  setShelfState,
} from "../library/store.js";
import { listHighlightsWithThreadsForResource } from "../annotations/highlights.js";
import { isReaderOrigin } from "../annotations/highlightOrigin.js";
import { buildScanData } from "../annotations/scan.js";
import { searchResource } from "../annotations/search.js";
import { deleteResourceAudioCache } from "../audio/render.js";
import { digestMarkdownPath } from "../digest/markdown.js";
import { getShowThematicQuotes } from "../digest/thematicQuoteVisibility.js";
import { startJob } from "../jobs/registry.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

export const resourcesRouter: Router = Router();

// M39 §C6 (PDF.md §2.1): designed failure states, each with its own Desk
// message — surfaced through the pdf-import job's `error` field (the tasks
// tray already renders "Failed — <error>"), not an HTTP error code, since
// the import itself runs as a job (§C5).
function pdfImportErrorMessage(err: unknown): string {
  if (err instanceof PdfPasswordError) return "This PDF is password-protected. Marginalia can't open it.";
  if (err instanceof PdfInvalidError) return "This file isn't a readable PDF.";
  return err instanceof Error ? err.message : "PDF import failed";
}

resourcesRouter.post("/", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "missing_file" });
    return;
  }
  const name = req.file.originalname.toLowerCase();

  if (name.endsWith(".epub")) {
    try {
      const resource = importEpub(getDb(), req.file.buffer);
      res.status(200).json(resource);
    } catch (err) {
      res.status(422).json({
        error: err instanceof Error ? err.message : "import_failed",
      });
    }
    return;
  }

  if (name.endsWith(".pdf")) {
    // M39 §C5/PDF.md §2.1: PDF extraction walks every page, detects columns
    // and rasterizes regions — expensive enough that a 400-page PDF would
    // block the single-process server (and therefore reading) for the
    // length of the import, so it runs as a job. The resource id is a pure
    // hash of bytes already in hand, so it's known before extraction even
    // starts and can seed the job's `resourceId` right away.
    const db = getDb();
    const buffer = req.file.buffer;
    const resourceId = hashPdfBuffer(buffer);
    const job = startJob(
      "pdf-import",
      resourceId,
      req.file.originalname,
      async (signal, reportProgress) => {
        try {
          await importPdf(db, buffer, req.file!.originalname, {
            signal,
            onPage: (current, total) => reportProgress({ current, total, message: `Extracting page ${current} of ${total}` }),
          });
        } catch (err) {
          throw new Error(pdfImportErrorMessage(err));
        }
      },
    );
    res.status(202).json({ jobId: job.id });
    return;
  }

  res.status(400).json({ error: "unsupported_format" });
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

// Removes the resource and every DB row that references it
// (`deleteResource`, store.ts), then its on-disk files — library bytes
// (source + generated reflow EPUB), the audio render cache, and the digest
// markdown projection. Deliberately leaves the Obsidian vault untouched
// (store.ts's own doc comment explains why). Irreversible — the client is
// expected to confirm before calling this.
resourcesRouter.delete("/:id", async (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const filePath = getResourceFilePath(db, resource.id);
  deleteResource(db, resource.id);

  if (filePath) fs.rmSync(filePath, { force: true });
  if (resource.format === "pdf") fs.rmSync(reflowEpubPath(resource.id), { force: true });
  fs.rmSync(digestMarkdownPath(resource.id), { force: true });
  await deleteResourceAudioCache(resource.id);

  res.status(204).end();
});

resourcesRouter.get("/:id/file", async (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  // M39 §C3: a PDF with no text layer (§6, a scan) serves its own raw bytes
  // for the native pane's preview mode; every other PDF serves the
  // generated reflow EPUB — the same reading pane every EPUB already opens
  // in (PDF.md §1) — regenerating it first if it's missing (§2's "on-disk
  // layout": the derived artifact, never failed on, only regenerated).
  if (resource.format === "pdf" && !resource.textLayer) {
    const filePath = getResourceFilePath(db, resource.id);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.type("application/pdf");
    res.sendFile(filePath);
    return;
  }

  if (resource.format === "pdf") {
    const reflowPath = await ensureReflowEpubPath(db, resource.id);
    if (!reflowPath) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.type("application/epub+zip");
    res.sendFile(reflowPath);
    return;
  }

  const filePath = getResourceFilePath(db, resource.id);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.type("application/epub+zip");
  res.sendFile(filePath);
});

// M41 §A1 (PDF.md §7.5): the native pane always needs the *raw* PDF bytes,
// scan or not — unlike `/file` above, which serves the generated reflow
// EPUB for every non-scan PDF (the reflow pane's own need). Two routes, not
// a query param on one, because they serve genuinely different content
// types to genuinely different consumers.
resourcesRouter.get("/:id/pdf-source", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource || resource.format !== "pdf") {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const filePath = getResourceFilePath(db, resource.id);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.type("application/pdf");
  res.sendFile(filePath);
});

// M41 §A2 (PDF.md §4/§7.5): the native pane's page->section table, built
// once at import (`importPdf.ts`) — empty for a scan, an EPUB, or a PDF
// imported before migration 44.
resourcesRouter.get("/:id/pdf-sections", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource || resource.format !== "pdf") {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(getPdfPageSections(getDb(), req.params.id));
});

// M41 §A2: the native pane's own copy of `resource_text` — reconstructing a
// highlight's quote from a stored `(sectionIndex, offset, length)` Locator,
// and locating the right page for a cross-mode jump, both need the same
// canonical section text the reflow pane's `resource_text` rows already are
// (PdfRenderer.ts's own comments explain why offsets are resolved against
// this rather than pdf.js's raw per-page text). Reuses the exact rows
// `search.ts`/`digest` already serve server-side; nothing new is computed.
resourcesRouter.get("/:id/text-sections", (req, res) => {
  const resource = getResourceById(getDb(), req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(getResourceTextSections(getDb(), req.params.id));
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
    parsed.data.flow,
    parsed.data.renderMode,
  );
  res.json(position);
});

// M39 §D4 (PDF.md §5, settled decision 18): `kind` is reader-settable in
// both directions — a PDF of a novel and an EPUB of a textbook both exist.
// Never touches a stored digest (§D5): the renderer keys off the digest's
// own fields, not today's `kind`.
resourcesRouter.put("/:id/kind", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = UpdateResourceKindBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setResourceKind(db, req.params.id, parsed.data.kind);
  res.json({ kind: parsed.data.kind });
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
