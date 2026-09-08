import type Database from "better-sqlite3";
import type {
  ReadingFlow,
  ReadingPosition,
  RenderMode,
  Resource,
  ResourceSummary,
  ShelfState,
} from "@marginalia/shared";
import { deleteHighlight } from "../annotations/highlights.js";

/** Every table keyed directly by `resource_id`, with no cascade of its own
 * beyond the row itself — `deleteResource` below wipes each in one
 * transaction. Highlights are handled separately, through `deleteHighlight`,
 * so their own thread/message/publish cascade still runs correctly. */
const RESOURCE_SCOPED_TABLES = [
  "resource_text",
  "reading_state",
  "shelf_state",
  "resource_locations",
  "pdf_page_sections",
  "chapter_digests",
  "book_digests",
  "book_digest_snapshots",
  "digest_runs",
  "resource_ai_settings",
  "resource_briefs",
  "thematic_digests",
  "thematic_runs",
  "chapter_substrate",
  "chapter_questions",
  "book_themes",
  "theme_parents",
  "audio_state",
  "book_cast",
] as const;

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
 * Deletes a resource and every row that references it — the DB carries
 * plain `REFERENCES` with no `ON DELETE` (migrations.ts's own documented
 * convention: every cascade in this codebase is hand-rolled, `deleteHighlight`
 * the smaller worked example this follows), so this walks every
 * `resource_id`-scoped table in one transaction. Highlights go through
 * `deleteHighlight` itself, not a raw `DELETE`, so their thread/message/
 * publish cascade still runs. `llm_usage` rows are cost/audit history, not
 * resource content — `resource_id` is nulled, the same way `deleteHighlight`
 * already nulls `llm_usage.message_id` rather than dropping usage rows.
 *
 * Deliberately does not touch on-disk files (library/audio/digest — the
 * route layer's job, paths.ts) or the Obsidian vault: the vault is a
 * one-way compiled projection (settled decision 6) the reader may have
 * since edited or cross-linked, and its `Concepts/` notes are shared across
 * the whole vault, not owned by any one book — deleting a resource here
 * never reaches into it.
 */
export function deleteResource(db: Database.Database, id: string): boolean {
  const highlightIds = db
    .prepare("SELECT id FROM highlights WHERE resource_id = ?")
    .all(id) as { id: string }[];

  const result = db.transaction(() => {
    for (const { id: highlightId } of highlightIds) deleteHighlight(db, highlightId);

    db.prepare("UPDATE llm_usage SET resource_id = NULL WHERE resource_id = ?").run(id);

    for (const table of RESOURCE_SCOPED_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE resource_id = ?`).run(id);
    }

    return db.prepare("DELETE FROM resources WHERE id = ?").run(id);
  })();

  return result.changes > 0;
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

/** M41 §A2 (PDF.md §4/§7.5): which `resource_text` section each PDF page
 * belongs to — index is the page index, value is the section index. Built
 * once at import (`importPdf.ts`) from the same boundary detection that
 * produced the spine; empty for a scan, an EPUB, or a PDF imported before
 * this migration (never backfilled — native mode on those falls back to
 * treating the whole document as section 0, same as M40 §D). */
export function getPdfPageSections(
  db: Database.Database,
  resourceId: string,
): number[] {
  const rows = db
    .prepare(
      `SELECT page_index, section_index FROM pdf_page_sections
       WHERE resource_id = ? ORDER BY page_index`,
    )
    .all(resourceId) as { page_index: number; section_index: number }[];
  const result: number[] = [];
  for (const row of rows) result[row.page_index] = row.section_index;
  return result;
}

/** Written once, at import — a PDF's pages never change (decision 5:
 * immutable on import), so this table is never updated in place. */
export function setPdfPageSections(
  db: Database.Database,
  resourceId: string,
  sectionIndexByPage: number[],
): void {
  const insert = db.prepare(
    `INSERT INTO pdf_page_sections (resource_id, page_index, section_index) VALUES (?, ?, ?)`,
  );
  const insertAll = db.transaction((rows: number[]) => {
    rows.forEach((sectionIndex, pageIndex) => insert.run(resourceId, pageIndex, sectionIndex));
  });
  insertAll(sectionIndexByPage);
}

export function getReadingPosition(
  db: Database.Database,
  resourceId: string,
): ReadingPosition | undefined {
  const row = db
    .prepare(
      "SELECT resource_id, location, spine_index, percent, flow, render_mode, updated_at FROM reading_state WHERE resource_id = ?",
    )
    .get(resourceId) as
    | {
        resource_id: string;
        location: string;
        spine_index: number | null;
        percent: number | null;
        flow: ReadingFlow;
        render_mode: RenderMode;
        updated_at: string;
      }
    | undefined;
  if (!row) return undefined;
  return {
    resourceId: row.resource_id,
    location: row.location,
    spineIndex: row.spine_index,
    percent: row.percent,
    flow: row.flow,
    renderMode: row.render_mode,
    updatedAt: row.updated_at,
  };
}

export function setReadingPosition(
  db: Database.Database,
  resourceId: string,
  location: string,
  spineIndex: number | null = null,
  percent: number | null = null,
  // M40 §C9: undefined means "a plain position save — leave the book's
  // saved mode as it is", not "reset it to paginated". `COALESCE` below
  // picks the existing row's value (an update) or the column's own
  // 'paginated' default (a fresh insert) whenever this is undefined.
  flow?: ReadingFlow,
  // M41 §A1: same convention as `flow` — undefined leaves the book's saved
  // reflow/native choice untouched.
  renderMode?: RenderMode,
): ReadingPosition {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO reading_state (resource_id, location, spine_index, percent, flow, render_mode, updated_at)
     VALUES (@resourceId, @location, @spineIndex, @percent, COALESCE(@flow, 'paginated'), COALESCE(@renderMode, 'reflow'), @updatedAt)
     ON CONFLICT (resource_id) DO UPDATE SET
       location = @location, spine_index = @spineIndex, percent = @percent,
       flow = COALESCE(@flow, reading_state.flow),
       render_mode = COALESCE(@renderMode, reading_state.render_mode), updated_at = @updatedAt`,
  ).run({ resourceId, location, spineIndex, percent, flow: flow ?? null, renderMode: renderMode ?? null, updatedAt });
  return getReadingPosition(db, resourceId)!;
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
