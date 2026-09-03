import type Database from "better-sqlite3";
import type {
  ReadingPosition,
  Resource,
  ResourceSummary,
  ShelfState,
} from "@marginalia/shared";

interface ResourceRow {
  id: string;
  title: string;
  author: string | null;
  format: string;
  file_path: string;
  metadata: string;
  imported_at: string;
  kind: string;
  text_layer: number;
}

function rowToResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format as Resource["format"],
    kind: row.kind as Resource["kind"],
    textLayer: row.text_layer !== 0,
    metadata: JSON.parse(row.metadata),
    importedAt: row.imported_at,
  };
}

/** M39 §D4: `kind` is reader-settable in both directions (a PDF of a novel,
 * an EPUB of a textbook). Never touches a stored digest — settled decision
 * 18/§D5: a digest renders from the fields it was built with, not from
 * today's `kind`. */
export function setResourceKind(
  db: Database.Database,
  resourceId: string,
  kind: Resource["kind"],
): void {
  db.prepare("UPDATE resources SET kind = ? WHERE id = ?").run(kind, resourceId);
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
         -- M35 §C6: a thematic-origin highlight (§C5) is machine-proposed
         -- evidence, not something the reader made — it must never inflate
         -- either count, regardless of §C7's show/hide toggle (which only
         -- governs whether it's *painted*, not whether it's "yours").
         (SELECT COUNT(*) FROM highlights h WHERE h.resource_id = r.id AND h.origin = 'reader') AS highlight_count,
         (SELECT COUNT(*) FROM highlights h
            JOIN threads t ON t.highlight_id = h.id
            WHERE h.resource_id = r.id AND h.origin = 'reader') AS thread_count,
         ss.x AS shelf_x,
         ss.y AS shelf_y,
         ss.rotation AS shelf_rotation,
         ss.z_order AS shelf_z_order
       FROM resources r
       LEFT JOIN reading_state rs ON rs.resource_id = r.id
       LEFT JOIN shelf_state ss ON ss.resource_id = r.id
       ORDER BY COALESCE(rs.updated_at, r.imported_at) DESC`,
    )
    .all() as (ResourceRow & {
    last_read_at: string | null;
    highlight_count: number;
    thread_count: number;
    shelf_x: number | null;
    shelf_y: number | null;
    shelf_rotation: number | null;
    shelf_z_order: number | null;
  })[];

  return rows.map((row) => ({
    ...rowToResource(row),
    highlightCount: row.highlight_count,
    threadCount: row.thread_count,
    lastReadAt: row.last_read_at,
    shelf:
      row.shelf_x === null
        ? null
        : {
            x: row.shelf_x,
            y: row.shelf_y as number,
            rotation: row.shelf_rotation as number,
            zOrder: row.shelf_z_order as number,
          },
  }));
}

export function setShelfState(
  db: Database.Database,
  resourceId: string,
  shelf: ShelfState,
): void {
  db.prepare(
    `INSERT INTO shelf_state (resource_id, x, y, rotation, z_order, updated_at)
     VALUES (@resourceId, @x, @y, @rotation, @zOrder, @updatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET
       x = @x, y = @y, rotation = @rotation, z_order = @zOrder, updated_at = @updatedAt`,
  ).run({
    resourceId,
    x: shelf.x,
    y: shelf.y,
    rotation: shelf.rotation,
    zOrder: shelf.zOrder,
    updatedAt: new Date().toISOString(),
  });
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

/** M35 §A1: one section's text, for a caller that only needs to locate an
 * anchor in a single chapter and shouldn't pay for the whole book's text
 * the way `getResourceTextSections` does. */
export function getResourceTextSection(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
): ResourceTextSection | undefined {
  const row = db
    .prepare(
      `SELECT spine_index, href, text FROM resource_text
       WHERE resource_id = ? AND spine_index = ?`,
    )
    .get(resourceId, spineIndex) as { spine_index: number; href: string; text: string } | undefined;
  return row ? { spineIndex: row.spine_index, href: row.href, text: row.text } : undefined;
}

export function getReadingPosition(
  db: Database.Database,
  resourceId: string,
): ReadingPosition | undefined {
  const row = db
    .prepare(
      "SELECT resource_id, location, spine_index, percent, updated_at FROM reading_state WHERE resource_id = ?",
    )
    .get(resourceId) as
    | {
        resource_id: string;
        location: string;
        spine_index: number | null;
        percent: number | null;
        updated_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    resourceId: row.resource_id,
    location: row.location,
    spineIndex: row.spine_index,
    percent: row.percent,
    updatedAt: row.updated_at,
  };
}

export function setReadingPosition(
  db: Database.Database,
  resourceId: string,
  location: string,
  spineIndex: number | null = null,
  percent: number | null = null,
): ReadingPosition {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO reading_state (resource_id, location, spine_index, percent, updated_at)
     VALUES (@resourceId, @location, @spineIndex, @percent, @updatedAt)
     ON CONFLICT (resource_id) DO UPDATE SET
       location = @location, spine_index = @spineIndex, percent = @percent, updated_at = @updatedAt`,
  ).run({ resourceId, location, spineIndex, percent, updatedAt });
  return { resourceId, location, spineIndex, percent, updatedAt };
}

/** M19.6 "page numbers, book-wide and stable": the cached
 * `book.locations.save()` blob (opaque to the server — see migration 19). */
export function getResourceLocations(
  db: Database.Database,
  resourceId: string,
): string | null {
  const row = db
    .prepare("SELECT locations FROM resource_locations WHERE resource_id = ?")
    .get(resourceId) as { locations: string } | undefined;
  return row?.locations ?? null;
}

export function setResourceLocations(
  db: Database.Database,
  resourceId: string,
  locations: string,
): void {
  db.prepare(
    `INSERT INTO resource_locations (resource_id, locations, generated_at)
     VALUES (@resourceId, @locations, @generatedAt)
     ON CONFLICT (resource_id) DO UPDATE SET
       locations = @locations, generated_at = @generatedAt`,
  ).run({ resourceId, locations, generatedAt: new Date().toISOString() });
}
