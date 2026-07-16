import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Highlight } from "@marginalia/shared";

interface HighlightRow {
  id: string;
  resource_id: string;
  exact: string;
  prefix: string;
  suffix: string;
  cfi: string;
  spine_index: number;
  created_at: string;
}

function rowToHighlight(row: HighlightRow): Highlight {
  return {
    id: row.id,
    resourceId: row.resource_id,
    exact: row.exact,
    prefix: row.prefix,
    suffix: row.suffix,
    cfi: row.cfi,
    spineIndex: row.spine_index,
    createdAt: row.created_at,
  };
}

export function createHighlight(
  db: Database.Database,
  input: {
    resourceId: string;
    exact: string;
    prefix: string;
    suffix: string;
    cfi: string;
    spineIndex: number;
  },
): Highlight {
  const highlight: Highlight = {
    id: crypto.randomUUID(),
    resourceId: input.resourceId,
    exact: input.exact,
    prefix: input.prefix,
    suffix: input.suffix,
    cfi: input.cfi,
    spineIndex: input.spineIndex,
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
     VALUES (@id, @resourceId, @exact, @prefix, @suffix, @cfi, @spineIndex, @createdAt)`,
  ).run(highlight);

  return highlight;
}

export function listHighlightsForResource(
  db: Database.Database,
  resourceId: string,
): Highlight[] {
  const rows = db
    .prepare(
      `SELECT * FROM highlights WHERE resource_id = ? ORDER BY spine_index, created_at`,
    )
    .all(resourceId) as HighlightRow[];
  return rows.map(rowToHighlight);
}

export function getHighlightById(
  db: Database.Database,
  id: string,
): Highlight | undefined {
  const row = db.prepare("SELECT * FROM highlights WHERE id = ?").get(id) as
    | HighlightRow
    | undefined;
  return row ? rowToHighlight(row) : undefined;
}

/**
 * Deletes a highlight and cascades to its thread + messages (SPEC: "also
 * deletes its thread/messages"). Threads/messages tables exist from the M0
 * migration but nothing writes to them until M5 — this cascade is here now
 * so DELETE /api/highlights/:id is correct as soon as they do.
 */
export function deleteHighlight(db: Database.Database, id: string): boolean {
  const result = db.transaction(() => {
    db.prepare(
      `DELETE FROM messages WHERE thread_id IN
         (SELECT id FROM threads WHERE highlight_id = ?)`,
    ).run(id);
    db.prepare("DELETE FROM threads WHERE highlight_id = ?").run(id);
    return db.prepare("DELETE FROM highlights WHERE id = ?").run(id);
  })();
  return result.changes > 0;
}
