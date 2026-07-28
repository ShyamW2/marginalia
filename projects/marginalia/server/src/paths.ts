import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));

// This file lives at <workspace>/server/src/paths.ts in dev (tsx) and at
// <workspace>/server/dist/paths.js after build — both are two levels under
// the workspace root (projects/marginalia/), so the same relative walk
// resolves correctly in both cases.
export const WORKSPACE_ROOT = path.resolve(here, "..", "..");
export const DATA_DIR = path.join(WORKSPACE_ROOT, "data");
export const LIBRARY_DIR = path.join(DATA_DIR, "library");
export const DB_PATH = path.join(DATA_DIR, "marginalia.sqlite");
// M17: the book digest's markdown projection — a deterministically
// regenerated read-only view of chapter_digests/book_digests, same pattern
// as the vault compiler (settled decision 6: never parsed back).
export const DIGEST_DIR = path.join(DATA_DIR, "digests");

/** Creates the runtime data directories if they don't already exist. */
export function ensureDataDirs(): void {
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  fs.mkdirSync(DIGEST_DIR, { recursive: true });
}
