import type Database from "better-sqlite3";
import type {
  ReadingPosition,
  Resource,
  ResourceSummary,
} from "@marginalia/shared";

interface ResourceRow {
  id: string;
  title: string;
  author: string | null;
  format: string;
  file_path: string;
  metadata: string;
  imported_at: string;
}

function rowToResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format as Resource["format"],
    metadata: JSON.parse(row.metadata),
    importedAt: row.imported_at,
  };
}

export function getResourceById(
  db: Database.Database,
  id: string,
): Resource | undefined {
  const row = db.prepare("SELECT * FROM resources WHERE id = ?").get(id) as
    | ResourceRow
    | undefined;
  return row ? rowToResource(row) : undefined;
}

export function getResourceFilePath(
  db: Database.Database,
  id: string,
): string | undefined {
  const row = db
    .prepare("SELECT file_path FROM resources WHERE id = ?")
    .get(id) as { file_path: string } | undefined;
  return row?.file_path;
}

/** Library list view: every resource plus its highlight/thread counts. */
export function listResourceSummaries(
  db: Database.Database,
): ResourceSummary[] {
  const rows = db
    .prepare(
      `SELECT
         r.*,
         (SELECT COUNT(*) FROM highlights h WHERE h.resource_id = r.id) AS highlight_count,
         (SELECT COUNT(*) FROM highlights h
            JOIN threads t ON t.highlight_id = h.id
            WHERE h.resource_id = r.id) AS thread_count
       FROM resources r
       ORDER BY r.imported_at DESC`,
    )
    .all() as (ResourceRow & {
    highlight_count: number;
    thread_count: number;
  })[];

  return rows.map((row) => ({
    ...rowToResource(row),
    highlightCount: row.highlight_count,
    threadCount: row.thread_count,
  }));
}

export function getReadingPosition(
  db: Database.Database,
  resourceId: string,
): ReadingPosition | undefined {
  const row = db
    .prepare(
      "SELECT resource_id, location, updated_at FROM reading_state WHERE resource_id = ?",
    )
    .get(resourceId) as
    | { resource_id: string; location: string; updated_at: string }
    | undefined;
  if (!row) return undefined;
  return {
    resourceId: row.resource_id,
    location: row.location,
    updatedAt: row.updated_at,
  };
}

export function setReadingPosition(
  db: Database.Database,
  resourceId: string,
  location: string,
): ReadingPosition {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO reading_state (resource_id, location, updated_at)
     VALUES (@resourceId, @location, @updatedAt)
     ON CONFLICT (resource_id) DO UPDATE SET location = @location, updated_at = @updatedAt`,
  ).run({ resourceId, location, updatedAt });
  return { resourceId, location, updatedAt };
}
