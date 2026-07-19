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

/**
 * Library list view: every resource plus its highlight/thread counts,
 * ordered by recency of reading — a book just read (or a freshly imported
 * one nobody's opened yet) sorts above books that have sat untouched.
 */
export function listResourceSummaries(
  db: Database.Database,
): ResourceSummary[] {
  const rows = db
    .prepare(
      `SELECT
         r.*,
         rs.updated_at AS last_read_at,
         (SELECT COUNT(*) FROM highlights h WHERE h.resource_id = r.id) AS highlight_count,
         (SELECT COUNT(*) FROM highlights h
            JOIN threads t ON t.highlight_id = h.id
            WHERE h.resource_id = r.id) AS thread_count
       FROM resources r
       LEFT JOIN reading_state rs ON rs.resource_id = r.id
       ORDER BY COALESCE(rs.updated_at, r.imported_at) DESC`,
    )
    .all() as (ResourceRow & {
    last_read_at: string | null;
    highlight_count: number;
    thread_count: number;
  })[];

  return rows.map((row) => ({
    ...rowToResource(row),
    highlightCount: row.highlight_count,
    threadCount: row.thread_count,
    lastReadAt: row.last_read_at,
  }));
}

export interface ResourceTextSection {
  spineIndex: number;
  href: string;
  text: string;
}

/** All extracted spine text for a resource, in spine order. */
export function getResourceTextSections(
  db: Database.Database,
  resourceId: string,
): ResourceTextSection[] {
  const rows = db
    .prepare(
      `SELECT spine_index, href, text FROM resource_text
       WHERE resource_id = ? ORDER BY spine_index`,
    )
    .all(resourceId) as { spine_index: number; href: string; text: string }[];
  return rows.map((row) => ({
    spineIndex: row.spine_index,
    href: row.href,
    text: row.text,
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
