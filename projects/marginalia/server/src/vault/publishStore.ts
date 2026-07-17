import type Database from "better-sqlite3";

export interface PublishRecord {
  threadId: string;
  notePath: string;
  contentHash: string;
  publishedAt: string;
}

export function getPublishRecord(
  db: Database.Database,
  threadId: string,
): PublishRecord | undefined {
  const row = db
    .prepare("SELECT * FROM publishes WHERE thread_id = ?")
    .get(threadId) as
    | { thread_id: string; note_path: string; content_hash: string; published_at: string }
    | undefined;
  if (!row) return undefined;
  return {
    threadId: row.thread_id,
    notePath: row.note_path,
    contentHash: row.content_hash,
    publishedAt: row.published_at,
  };
}

export function recordPublish(
  db: Database.Database,
  threadId: string,
  notePath: string,
  contentHash: string,
): void {
  db.prepare(
    `INSERT INTO publishes (thread_id, note_path, content_hash, published_at)
     VALUES (@threadId, @notePath, @contentHash, @publishedAt)
     ON CONFLICT(thread_id) DO UPDATE SET
       note_path = @notePath, content_hash = @contentHash, published_at = @publishedAt`,
  ).run({ threadId, notePath, contentHash, publishedAt: new Date().toISOString() });
}

/** Every note this resource has published so far, in stable (note_path) order — for the book overview. */
export function listPublishedNotesForResource(
  db: Database.Database,
  resourceId: string,
): { threadId: string; notePath: string }[] {
  const rows = db
    .prepare(
      `SELECT p.thread_id, p.note_path FROM publishes p
       JOIN threads t ON t.id = p.thread_id
       JOIN highlights h ON h.id = t.highlight_id
       WHERE h.resource_id = ?
       ORDER BY p.note_path`,
    )
    .all(resourceId) as { thread_id: string; note_path: string }[];
  return rows.map((r) => ({ threadId: r.thread_id, notePath: r.note_path }));
}
