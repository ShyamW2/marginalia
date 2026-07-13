import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Resource } from "@marginalia/shared";
import { extractEpub } from "./epub.js";
import { getResourceById } from "./store.js";
import { LIBRARY_DIR } from "../paths.js";

export function hashBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Imports an EPUB's raw bytes into the library: hashes the content, and if
 * a resource with that hash doesn't already exist, stores the file,
 * extracts its text, and inserts DB rows. Re-importing identical bytes is a
 * no-op that returns the existing resource — the library is content-
 * addressed and immutable-on-import (see CLAUDE.md settled decisions).
 */
export function importEpub(db: Database.Database, buffer: Buffer): Resource {
  const id = hashBuffer(buffer);

  const existing = getResourceById(db, id);
  if (existing) return existing;

  const extracted = extractEpub(buffer);
  const filePath = path.join(LIBRARY_DIR, `${id}.epub`);
  const importedAt = new Date().toISOString();

  const resource: Resource = {
    id,
    title: extracted.title,
    author: extracted.author,
    format: "epub",
    metadata: extracted.metadata,
    importedAt,
  };

  const insertResource = db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, @title, @author, @format, @filePath, @metadata, @importedAt)`,
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
    });
    for (const item of extracted.spine) {
      insertText.run({
        resourceId: id,
        spineIndex: item.spineIndex,
        href: item.href,
        text: item.text,
      });
    }
  });

  // Write the file before committing the transaction's DB rows so a crash
  // between the two can't leave a resource row with no backing file.
  fs.writeFileSync(filePath, buffer);
  try {
    runImport();
  } catch (err) {
    fs.rmSync(filePath, { force: true });
    throw err;
  }

  return resource;
}
