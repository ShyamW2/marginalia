import type Database from "better-sqlite3";
import type { ContextLadderDepth } from "@marginalia/shared";

/** Explicitly stored depth for this book, or null if the reader has never
 * chosen one — the caller applies the "Digest once a book has one, Full
 * otherwise" default (decisions.md 2026-07-28 later), not this function. */
export function getStoredContextLadderDepth(
  db: Database.Database,
  resourceId: string,
): ContextLadderDepth | null {
  const row = db
    .prepare("SELECT context_ladder_depth FROM resource_ai_settings WHERE resource_id = ?")
    .get(resourceId) as { context_ladder_depth: string } | undefined;
  if (!row || row.context_ladder_depth === "") return null;
  return row.context_ladder_depth as ContextLadderDepth;
}

export function setContextLadderDepth(
  db: Database.Database,
  resourceId: string,
  depth: ContextLadderDepth,
): void {
  db.prepare(
    `INSERT INTO resource_ai_settings (resource_id, context_ladder_depth, updated_at)
     VALUES (@resourceId, @depth, @updatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET
       context_ladder_depth = @depth, updated_at = @updatedAt`,
  ).run({ resourceId, depth, updatedAt: new Date().toISOString() });
}

/** Resolves the effective depth: the reader's explicit choice, else Digest
 * once the book has a book-level digest, else Full. */
export function resolveContextLadderDepth(
  db: Database.Database,
  resourceId: string,
  hasBookDigest: boolean,
): ContextLadderDepth {
  const stored = getStoredContextLadderDepth(db, resourceId);
  if (stored) return stored;
  return hasBookDigest ? "digest" : "full";
}
