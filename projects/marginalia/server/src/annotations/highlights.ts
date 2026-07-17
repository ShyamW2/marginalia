import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Highlight, HighlightWithThread } from "@marginalia/shared";

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

interface HighlightWithThreadRow extends HighlightRow {
  thread_id: string | null;
  answer_count: number;
}

/** SPEC: GET /api/resources/:id/highlights — highlights + their thread summaries. */
export function listHighlightsWithThreadsForResource(
  db: Database.Database,
  resourceId: string,
): HighlightWithThread[] {
  const rows = db
    .prepare(
      `SELECT h.*, t.id AS thread_id,
         (SELECT COUNT(*) FROM messages m
            WHERE m.thread_id = t.id AND m.role = 'assistant') AS answer_count
       FROM highlights h
       LEFT JOIN threads t ON t.highlight_id = h.id
       WHERE h.resource_id = ?
       ORDER BY h.spine_index, h.created_at`,
    )
    .all(resourceId) as HighlightWithThreadRow[];

  return rows.map((row) => ({
    ...rowToHighlight(row),
    thread: row.thread_id
      ? { id: row.thread_id, hasAnswer: row.answer_count > 0 }
      : null,
  }));
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
 * deletes its thread/messages"). Also cascades to any `publishes` ledger row
 * for that thread (M6) — `publishes.thread_id` has a foreign key on
 * `threads(id)`, so deleting the thread without it fails the whole
 * transaction once a thread has been published to the vault at least once.
 */
export function deleteHighlight(db: Database.Database, id: string): boolean {
  const result = db.transaction(() => {
    db.prepare(
      `DELETE FROM publishes WHERE thread_id IN
         (SELECT id FROM threads WHERE highlight_id = ?)`,
    ).run(id);
    db.prepare(
      `DELETE FROM messages WHERE thread_id IN
         (SELECT id FROM threads WHERE highlight_id = ?)`,
    ).run(id);
    db.prepare("DELETE FROM threads WHERE highlight_id = ?").run(id);
    return db.prepare("DELETE FROM highlights WHERE id = ?").run(id);
  })();
  return result.changes > 0;
}
