import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type {
  DefinitionSource,
  Highlight,
  HighlightImportance,
  HighlightKind,
  HighlightWithThread,
} from "@marginalia/shared";

interface HighlightRow {
  id: string;
  resource_id: string;
  exact: string;
  prefix: string;
  suffix: string;
  cfi: string;
  spine_index: number;
  kind: string;
  importance: number;
  note: string;
  panel_dx: number;
  panel_dy: number;
  panel_width: number | null;
  panel_height: number | null;
  definition: string;
  definition_source: string;
  anchor_source: string;
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
    kind: row.kind as HighlightKind,
    importance: row.importance as HighlightImportance,
    note: row.note,
    panelDx: row.panel_dx,
    panelDy: row.panel_dy,
    panelWidth: row.panel_width,
    panelHeight: row.panel_height,
    definition: row.definition,
    definitionSource: row.definition_source as DefinitionSource,
    createdAt: row.created_at,
  };
}

/**
 * How a machine-made anchor was placed (M34 §0a, migration 28). Pure
 * instrumentation: nothing renders it, and `""` — every reader-made
 * highlight — is the default the column carries on its own, so only the
 * chapter-anchor route ever passes one.
 */
export type AnchorSource = "" | "quote" | "chapter_start";

export function createHighlight(
  db: Database.Database,
  input: {
    resourceId: string;
    exact: string;
    prefix: string;
    suffix: string;
    cfi: string;
    spineIndex: number;
    kind: HighlightKind;
    anchorSource?: AnchorSource;
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
    kind: input.kind,
    importance: 0, // matches the highlights.importance column's DEFAULT 0
    note: "", // matches the highlights.note column's DEFAULT ''
    panelDx: 0, // matches the highlights.panel_dx column's DEFAULT 0
    panelDy: 0, // matches the highlights.panel_dy column's DEFAULT 0
    panelWidth: null, // matches panel_width's implicit NULL default
    panelHeight: null, // matches panel_height's implicit NULL default
    definition: "", // matches the highlights.definition column's DEFAULT ''
    definitionSource: "", // matches definition_source's DEFAULT ''
    createdAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, kind, anchor_source, created_at)
     VALUES (@id, @resourceId, @exact, @prefix, @suffix, @cfi, @spineIndex, @kind, @anchorSource, @createdAt)`,
  ).run({ ...highlight, anchorSource: input.anchorSource ?? "" });

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
  message_count: number;
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
            WHERE m.thread_id = t.id AND m.role = 'assistant') AS answer_count,
         (SELECT COUNT(*) FROM messages m
            WHERE m.thread_id = t.id) AS message_count
       FROM highlights h
       LEFT JOIN threads t ON t.highlight_id = h.id
       WHERE h.resource_id = ?
       ORDER BY h.spine_index, h.created_at`,
    )
    .all(resourceId) as HighlightWithThreadRow[];

  return rows.map((row) => ({
    ...rowToHighlight(row),
    thread: row.thread_id
      ? { id: row.thread_id, hasAnswer: row.answer_count > 0, messageCount: row.message_count }
      : null,
  }));
}

export function setHighlightImportance(
  db: Database.Database,
  id: string,
  importance: HighlightImportance,
): void {
  db.prepare("UPDATE highlights SET importance = ? WHERE id = ?").run(importance, id);
}

/** M13: the reader's own note — plain text, autosaved, never sent to an LLM. */
export function setHighlightNote(db: Database.Database, id: string, note: string): void {
  db.prepare("UPDATE highlights SET note = ? WHERE id = ?").run(note, id);
}

/**
 * M30 C: attaches a Define lookup's answer to the highlight it was looked up
 * for. Writing an empty `definition` clears the pair, which is how a
 * highlight leaves M30 D's glossary without anything having to delete it.
 */
export function setHighlightDefinition(
  db: Database.Database,
  id: string,
  definition: string,
  source: DefinitionSource,
): void {
  db.prepare(
    "UPDATE highlights SET definition = ?, definition_source = ? WHERE id = ?",
  ).run(definition, definition ? source : "", id);
}

/** M14: the thread panel's dragged position, stored as an offset from its anchor. */
export function setHighlightPanelOffset(
  db: Database.Database,
  id: string,
  panelDx: number,
  panelDy: number,
): void {
  db.prepare("UPDATE highlights SET panel_dx = ?, panel_dy = ? WHERE id = ?").run(
    panelDx,
    panelDy,
    id,
  );
}

/** M19.6: the thread panel's resized dimensions, in px. */
export function setHighlightPanelSize(
  db: Database.Database,
  id: string,
  panelWidth: number,
  panelHeight: number,
): void {
  db.prepare("UPDATE highlights SET panel_width = ?, panel_height = ? WHERE id = ?").run(
    panelWidth,
    panelHeight,
    id,
  );
}

/** M19.5 dedup for posed-question anchors: re-clicking the same question
 * should reuse its highlight/thread rather than spawning a duplicate. */
export function findHighlightByExact(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
  exact: string,
): Highlight | undefined {
  const row = db
    .prepare(
      "SELECT * FROM highlights WHERE resource_id = ? AND spine_index = ? AND exact = ? ORDER BY created_at LIMIT 1",
    )
    .get(resourceId, spineIndex, exact) as HighlightRow | undefined;
  return row ? rowToHighlight(row) : undefined;
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
 *
 * M30 E, found live driving the new delete-confirmation flow on a real
 * answered thread: with `foreign_keys = ON` (db.ts), this transaction was
 * failing outright — a 500, not the designed 204 — the moment a thread had
 * *any* tracked LLM call, because `llm_usage.message_id` (migration 22)
 * still pointed at the message about to be deleted with no `ON DELETE`
 * clause. The same gap existed for `highlight_tags` and `highlight_themes`
 * (migrations 16, 17) — a tagged or theme-tagged highlight couldn't be
 * deleted either, for the identical reason, just never hit by a manual test
 * because M30 C/D's own Verify entries happened not to tag anything. Fixed
 * the same way `deleteProviderProfile` already handles its own dangling
 * `provider_roles.profile_id`: null the usage ledger's reference (a cost
 * already spent stays in the accounting history; only the link to a
 * conversation that no longer exists goes), delete the rest outright.
 */
export function deleteHighlight(db: Database.Database, id: string): boolean {
  const result = db.transaction(() => {
    db.prepare(
      `UPDATE llm_usage SET message_id = NULL WHERE message_id IN
         (SELECT m.id FROM messages m
            JOIN threads t ON t.id = m.thread_id
            WHERE t.highlight_id = ?)`,
    ).run(id);
    db.prepare(
      `DELETE FROM publishes WHERE thread_id IN
         (SELECT id FROM threads WHERE highlight_id = ?)`,
    ).run(id);
    db.prepare(
      `DELETE FROM messages WHERE thread_id IN
         (SELECT id FROM threads WHERE highlight_id = ?)`,
    ).run(id);
    db.prepare("DELETE FROM threads WHERE highlight_id = ?").run(id);
    db.prepare("DELETE FROM highlight_tags WHERE highlight_id = ?").run(id);
    db.prepare("DELETE FROM highlight_themes WHERE highlight_id = ?").run(id);
    return db.prepare("DELETE FROM highlights WHERE id = ?").run(id);
  })();
  return result.changes > 0;
}
