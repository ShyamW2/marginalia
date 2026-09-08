import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Resource, ResourceSubheading } from "@marginalia/shared";
import { extractPdf, type ExtractPdfOptions, PdfInvalidError, PdfPasswordError } from "./pdf/extract.js";
import { buildSections, buildSectionsWithPageIndex, firstMeaningfulSectionTitle } from "./pdf/sections.js";
import { generateReflowEpub } from "./pdf/generateEpub.js";
import { EXTRACTOR_VERSION } from "./pdf/version.js";
import { getResourceById, getResourceFilePath, setPdfPageSections } from "./store.js";
import { LIBRARY_DIR } from "../paths.js";

export { PdfInvalidError, PdfPasswordError };

/** PDF.md §2: a PDF resource's id folds in `EXTRACTOR_VERSION` — an
 * extractor upgrade produces a new, separate resource beside the old one
 * (settled decision 5), never a rewrite of text under live highlights. */
export function hashPdfBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).update(`:${EXTRACTOR_VERSION}`).digest("hex");
}

/** Exported so `deleteResource` (store.ts) can clean up this file without
 * duplicating the naming convention. */
export function reflowEpubPath(id: string): string {
  return path.join(LIBRARY_DIR, `${id}.reflow.epub`);
}

function pdfPath(id: string): string {
  return path.join(LIBRARY_DIR, `${id}.pdf`);
}

function titleFromFilename(originalFilename: string): string {
  const base = path.basename(originalFilename, path.extname(originalFilename)).trim();
  return base.length > 0 ? base : "Untitled";
}

/**
 * Imports a PDF's raw bytes into the library (PDF.md §2/§3/§4/§6): hashes
 * (bytes + extractor version), extracts text/outline/rasters, detects the
 * spine per §4, and — for a resource with a text layer — generates the
 * `.reflow.epub` the reading pane actually opens. A scan (§6: >50% of pages
 * under 100 extracted characters) gets zero `resource_text` rows and no
 * generated EPUB; it exists in the library for the native pane's preview
 * mode (M40/M41), not built yet.
 *
 * Mirrors `importEpub`'s shape: content-addressed, immutable-on-import,
 * file(s) written before the transaction commits so a crash between the two
 * can't leave a resource row with no backing file.
 */
export async function importPdf(
  db: Database.Database,
  buffer: Buffer,
  originalFilename: string,
  options: ExtractPdfOptions = {},
): Promise<Resource> {
  const id = hashPdfBuffer(buffer);

  const existing = getResourceById(db, id);
  if (existing) return existing;

  const extracted = await extractPdf(buffer, options);
  const textLayer = !extracted.isScan;
  const importedAt = new Date().toISOString();
  const filePath = pdfPath(id);

  let chapterTitles: Record<string, string> = {};
  // M42 §C4: the native pane's own copy of a section's depth-2+ headings —
  // the reflow pane gets these from the generated EPUB's own nested nav
  // instead, but the native pane never parses that EPUB, so it needs the
  // same information carried here, mirroring `chapterTitles`'s convention
  // (sparse: only a section that actually has subheadings gets an entry).
  let subheadingsBySection: Record<string, ResourceSubheading[]> = {};
  let reflowBuffer: Buffer | null = null;
  let sectionRows: { spineIndex: number; href: string; text: string }[] = [];
  // M41 §A2: page->section, for the native pane's "highlights are shared
  // between reflow and native" (PDF.md §4/§7.5) — built alongside the spine
  // itself so the two never disagree.
  let pageSectionIndex: number[] = [];
  let builtSections: ReturnType<typeof buildSectionsWithPageIndex>["sections"] = [];

  if (textLayer) {
    const built = buildSectionsWithPageIndex(extracted.pages, extracted.outline);
    builtSections = built.sections;
    sectionRows = built.sections.map((s) => ({ spineIndex: s.spineIndex, href: s.href, text: s.text }));
    pageSectionIndex = built.pageSectionIndex;
    for (const section of built.sections) {
      if (section.subheadings.length > 0) subheadingsBySection[String(section.spineIndex)] = section.subheadings;
    }
  }

  // M42 §A3: a placeholder/absent `Info.Title` (extract.ts) falls back to
  // the first real detected heading before resorting to the filename — the
  // same "prefer real content over absent metadata" degrade EPUB import
  // already applies.
  const title = extracted.title ?? firstMeaningfulSectionTitle(builtSections) ?? titleFromFilename(originalFilename);

  if (textLayer) {
    const generated = generateReflowEpub({ title, author: null, sections: builtSections, identifier: id });
    reflowBuffer = generated.buffer;
    chapterTitles = generated.chapterTitles;
  }

  const metadata: Resource["metadata"] = {};
  if (Object.keys(chapterTitles).length > 0) metadata.chapterTitles = chapterTitles;
  if (Object.keys(subheadingsBySection).length > 0) metadata.subheadings = subheadingsBySection;

  const resource: Resource = {
    id,
    title,
    author: null,
    format: "pdf",
    // PDF.md §5/D1: every reflowed PDF defaults to `document`; reader-
    // settable afterwards (§D4), never re-detected.
    kind: "document",
    textLayer,
    metadata,
    importedAt,
  };

  const insertResource = db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at, kind, text_layer)
     VALUES (@id, @title, @author, @format, @filePath, @metadata, @importedAt, @kind, @textLayer)`,
  );
  const insertText = db.prepare(
    `INSERT INTO resource_text (resource_id, spine_index, href, text)
     VALUES (@resourceId, @spineIndex, @href, @text)`,
  );

  const runImport = db.transaction(() => {
    insertResource.run({
      id: resource.id,
      title: resource.title,
      author: resource.author,
      format: resource.format,
      filePath,
      metadata: JSON.stringify(resource.metadata),
      importedAt,
      kind: resource.kind,
      textLayer: textLayer ? 1 : 0,
    });
    for (const row of sectionRows) {
      insertText.run({ resourceId: id, spineIndex: row.spineIndex, href: row.href, text: row.text });
    }
    if (pageSectionIndex.length > 0) setPdfPageSections(db, id, pageSectionIndex);
  });

  fs.writeFileSync(filePath, buffer);
  if (reflowBuffer) fs.writeFileSync(reflowEpubPath(id), reflowBuffer);
  try {
    runImport();
  } catch (err) {
    fs.rmSync(filePath, { force: true });
    if (reflowBuffer) fs.rmSync(reflowEpubPath(id), { force: true });
    throw err;
  }

  return resource;
}

/**
 * PDF.md §2 "on-disk layout": the generated EPUB is a derived artifact, not
 * a resource — "if it is missing at read time, regenerate it rather than
 * failing." Same extractor version, same input bytes, same deterministic
 * `generateReflowEpub` (byte-reproducible per B2), so regenerating is always
 * safe and always produces the same file import would have written. Returns
 * `undefined` for a resource that isn't a digital PDF (wrong format, or a
 * scan with no text layer to reflow) — the caller's job to decide what that
 * means for the response.
 */
export async function ensureReflowEpubPath(db: Database.Database, id: string): Promise<string | undefined> {
  const target = reflowEpubPath(id);
  if (fs.existsSync(target)) return target;

  const resource = getResourceById(db, id);
  const sourcePath = getResourceFilePath(db, id);
  if (!resource || resource.format !== "pdf" || !resource.textLayer || !sourcePath || !fs.existsSync(sourcePath)) {
    return undefined;
  }

  const buffer = fs.readFileSync(sourcePath);
  const extracted = await extractPdf(buffer);
  const sections = buildSections(extracted.pages, extracted.outline);
  const generated = generateReflowEpub({ title: resource.title, author: resource.author, sections, identifier: id });
  fs.writeFileSync(target, generated.buffer);
  return target;
}
