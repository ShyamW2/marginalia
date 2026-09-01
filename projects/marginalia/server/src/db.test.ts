import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { createDb } from "./db.js";
import { MIGRATIONS } from "./migrations.js";

function tmpDbPath(label: string): string {
  return path.join(
    os.tmpdir(),
    `marginalia-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
}

function cleanupDbFile(dbPath: string): void {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
}

describe("db migrations", () => {
  it("creates every table from migration 001 in a fresh database", () => {
    const db = createDb(":memory:");

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "resources",
        "resource_text",
        "reading_state",
        "highlights",
        "threads",
        "messages",
        "publishes",
        "settings",
        "shelf_state",
        "notepad",
        "highlight_tags",
      ]),
    );

    db.close();
  });

  it("records the applied schema version", () => {
    const db = createDb(":memory:");
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(37);
    db.close();
  });

  it("migration 002 adds highlights.kind, defaulting to rose, and backfills pre-existing threaded highlights to slate", () => {
    // Migration 2's backfill runs once, against whatever data already
    // exists at migration time — so this has to simulate a real pre-M7
    // database (migration 1 only) rather than insert data into an
    // already-fully-migrated one, or there'd be nothing to backfill.
    const tmpPath = tmpDbPath("kind-backfill");
    try {
      const legacy = new BetterSqlite3(tmpPath);
      legacy.exec(MIGRATIONS[0].sql!);
      legacy.pragma("user_version = 1");
      const now = new Date().toISOString();
      legacy
        .prepare(
          `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
           VALUES ('res-1', 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
        )
        .run({ now });
      // A highlight with a thread (pre-M7 data) — should backfill to slate.
      legacy
        .prepare(
          `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
           VALUES ('h-threaded', 'res-1', 'q', '', '', 'epubcfi(/6/4!/4/2)', 0, @now)`,
        )
        .run({ now });
      legacy
        .prepare(
          `INSERT INTO threads (id, highlight_id, created_at) VALUES ('t-1', 'h-threaded', @now)`,
        )
        .run({ now });
      // A highlight with no thread — should keep the default.
      legacy
        .prepare(
          `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
           VALUES ('h-plain', 'res-1', 'q2', '', '', 'epubcfi(/6/8!/4/2)', 1, @now)`,
        )
        .run({ now });
      legacy.close();

      // Reopening via createDb runs the pending migration (2) against this
      // pre-existing data.
      const db = createDb(tmpPath);
      const rows = db
        .prepare("SELECT id, kind FROM highlights ORDER BY id")
        .all() as { id: string; kind: string }[];

      expect(rows).toEqual([
        { id: "h-plain", kind: "rose" },
        { id: "h-threaded", kind: "slate" },
      ]);
      db.close();
    } finally {
      cleanupDbFile(tmpPath);
    }
  });


  it("migration 005 adds highlights.note, defaulting to empty string", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
       VALUES ('res-1', 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
    ).run({ now });
    db.prepare(
      `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
       VALUES ('h-1', 'res-1', 'q', '', '', 'epubcfi(/6/4!/4/2)', 0, @now)`,
    ).run({ now });

    const row = db.prepare("SELECT note FROM highlights WHERE id = 'h-1'").get() as {
      note: string;
    };
    expect(row.note).toBe("");

    db.prepare("UPDATE highlights SET note = 'a plain note' WHERE id = 'h-1'").run();
    const updated = db.prepare("SELECT note FROM highlights WHERE id = 'h-1'").get() as {
      note: string;
    };
    expect(updated.note).toBe("a plain note");

    db.close();
  });

  it("migration 004 adds highlights.importance, defaulting to 0, and highlight_tags is usable", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
       VALUES ('res-1', 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
    ).run({ now });
    db.prepare(
      `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
       VALUES ('h-1', 'res-1', 'q', '', '', 'epubcfi(/6/4!/4/2)', 0, @now)`,
    ).run({ now });

    const row = db
      .prepare("SELECT importance FROM highlights WHERE id = 'h-1'")
      .get() as { importance: number };
    expect(row.importance).toBe(0);

    db.prepare("INSERT INTO highlight_tags (highlight_id, tag) VALUES ('h-1', 'motif')").run();
    const tags = db
      .prepare("SELECT tag FROM highlight_tags WHERE highlight_id = 'h-1'")
      .all() as { tag: string }[];
    expect(tags).toEqual([{ tag: "motif" }]);

    db.close();
  });

  it("migration 006 adds highlights.panel_dx/panel_dy, defaulting to 0", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
       VALUES ('res-1', 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
    ).run({ now });
    db.prepare(
      `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
       VALUES ('h-1', 'res-1', 'q', '', '', 'epubcfi(/6/4!/4/2)', 0, @now)`,
    ).run({ now });

    const row = db
      .prepare("SELECT panel_dx, panel_dy FROM highlights WHERE id = 'h-1'")
      .get() as { panel_dx: number; panel_dy: number };
    expect(row.panel_dx).toBe(0);
    expect(row.panel_dy).toBe(0);

    db.prepare("UPDATE highlights SET panel_dx = 12.5, panel_dy = -8 WHERE id = 'h-1'").run();
    const updated = db
      .prepare("SELECT panel_dx, panel_dy FROM highlights WHERE id = 'h-1'")
      .get() as { panel_dx: number; panel_dy: number };
    expect(updated.panel_dx).toBe(12.5);
    expect(updated.panel_dy).toBe(-8);

    db.close();
  });

  it("migration 018 adds highlights.panel_width/panel_height, defaulting to NULL", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
       VALUES ('res-1', 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
    ).run({ now });
    db.prepare(
      `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
       VALUES ('h-1', 'res-1', 'q', '', '', 'epubcfi(/6/4!/4/2)', 0, @now)`,
    ).run({ now });

    const row = db
      .prepare("SELECT panel_width, panel_height FROM highlights WHERE id = 'h-1'")
      .get() as { panel_width: number | null; panel_height: number | null };
    expect(row.panel_width).toBeNull();
    expect(row.panel_height).toBeNull();

    db.prepare("UPDATE highlights SET panel_width = 420, panel_height = 560 WHERE id = 'h-1'").run();
    const updated = db
      .prepare("SELECT panel_width, panel_height FROM highlights WHERE id = 'h-1'")
      .get() as { panel_width: number; panel_height: number };
    expect(updated.panel_width).toBe(420);
    expect(updated.panel_height).toBe(560);

    db.close();
  });

  it("migration 019 adds resource_locations, a cache keyed by resource id", () => {
    const db = createDb(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
       VALUES ('res-1', 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
    ).run({ now });

    const missing = db
      .prepare("SELECT locations FROM resource_locations WHERE resource_id = 'res-1'")
      .get();
    expect(missing).toBeUndefined();

    db.prepare(
      `INSERT INTO resource_locations (resource_id, locations, generated_at)
       VALUES ('res-1', '["epubcfi(...)"]', @now)`,
    ).run({ now });
    const row = db
      .prepare("SELECT locations FROM resource_locations WHERE resource_id = 'res-1'")
      .get() as { locations: string };
    expect(row.locations).toBe('["epubcfi(...)"]');

    db.close();
  });

  it("migration 033 clears thematic_digests/book_themes/theme_parents on upgrade, but never canonical_themes", () => {
    // M35 §C4: the stored shape of thematic_digests.themes changed (and its
    // contents are stale under the old naming prompt), so the operator's
    // decision was drop-and-rerun, not migrate-in-place. Seed a database at
    // the version just before this one (32), with real rows in all four
    // theme-adjacent tables, then reopen via createDb — which applies only
    // the pending migration (33) — and assert the three per-resource tables
    // are wiped while canonical_themes (library-wide colour memory) survives.
    const tmpPath = tmpDbPath("theme-drop-rerun");
    try {
      const legacy = new BetterSqlite3(tmpPath);
      for (const m of MIGRATIONS.filter((m) => m.version <= 32).sort((a, b) => a.version - b.version)) {
        legacy.exec(m.sql!);
      }
      legacy.pragma("user_version = 32");
      const now = new Date().toISOString();
      legacy
        .prepare(
          `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
           VALUES ('res-1', 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
        )
        .run({ now });
      legacy
        .prepare(
          `INSERT INTO thematic_digests (resource_id, spine_index, brief_hash, brief_text, analysis, themes, questions, generated_at)
           VALUES ('res-1', 0, 'b', '', 'a', '["old shape"]', '[]', @now)`,
        )
        .run({ now });
      legacy
        .prepare(
          `INSERT INTO canonical_themes (id, name, slug, color_index, created_at)
           VALUES ('ct-1', 'Fate', 'fate', 0, @now)`,
        )
        .run({ now });
      legacy
        .prepare(
          `INSERT INTO book_themes (resource_id, canonical_theme_id, generated_at) VALUES ('res-1', 'ct-1', @now)`,
        )
        .run({ now });
      legacy
        .prepare(
          `INSERT INTO theme_parents (resource_id, chapter_theme, canonical_theme_id) VALUES ('res-1', 'old theme', 'ct-1')`,
        )
        .run();
      legacy.close();

      const db = createDb(tmpPath);
      expect(db.pragma("user_version", { simple: true })).toBe(37);
      expect(db.prepare("SELECT COUNT(*) AS n FROM thematic_digests").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM book_themes").get()).toEqual({ n: 0 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM theme_parents").get()).toEqual({ n: 0 });
      // Library-wide colour memory — never cleared by a per-resource rerun.
      expect(db.prepare("SELECT COUNT(*) AS n FROM canonical_themes").get()).toEqual({ n: 1 });
      db.close();
    } finally {
      cleanupDbFile(tmpPath);
    }
  });

  it("is idempotent — reopening an already-migrated database file is a no-op", () => {
    const tmpPath = tmpDbPath("idempotent");

    try {
      const first = createDb(tmpPath);
      first.close();

      // Reopening the same file must not re-run migration 001 (which would
      // throw on CREATE TABLE against already-existing tables).
      const second = createDb(tmpPath);
      expect(second.pragma("user_version", { simple: true })).toBe(37);
      second.close();
    } finally {
      cleanupDbFile(tmpPath);
    }
  });

  it("migration 037 repairs a database where user_version reached 36 but resource_ai_settings never actually got show_thematic_quotes — found live 2026-09-01", () => {
    // Reproduces the exact broken state a live dev database was found in:
    // every migration through 36 applied (so a normal pending-migrations
    // check sees nothing left to do), yet the column migration 36 was
    // supposed to add is missing. SQLite can't express "ALTER TABLE ADD
    // COLUMN IF NOT EXISTS", so simulate it directly — apply every
    // migration through 36 for real, then drop just that one column back
    // off (SQLite 3.35+'s DROP COLUMN), which stands in for however the
    // original state actually arose.
    const tmpPath = tmpDbPath("migration-37-repair");
    try {
      const legacy = new BetterSqlite3(tmpPath);
      for (const m of MIGRATIONS.filter((m) => m.version <= 36).sort((a, b) => a.version - b.version)) {
        legacy.exec(m.sql!);
      }
      legacy.pragma("user_version = 36");
      legacy.exec("ALTER TABLE resource_ai_settings DROP COLUMN show_thematic_quotes;");
      const columnsBefore = legacy.prepare("PRAGMA table_info(resource_ai_settings)").all() as { name: string }[];
      expect(columnsBefore.some((c) => c.name === "show_thematic_quotes")).toBe(false);
      legacy.close();

      const repaired = createDb(tmpPath);
      expect(repaired.pragma("user_version", { simple: true })).toBe(37);
      const columnsAfter = repaired.prepare("PRAGMA table_info(resource_ai_settings)").all() as { name: string }[];
      expect(columnsAfter.some((c) => c.name === "show_thematic_quotes")).toBe(true);
      repaired.close();
    } finally {
      cleanupDbFile(tmpPath);
    }
  });

  it("migration 037 is a no-op when show_thematic_quotes already exists — the healthy-database case every other machine is in", () => {
    const tmpPath = tmpDbPath("migration-37-noop");
    try {
      const db = createDb(tmpPath);
      db.close();
      // Reopening an already-fully-migrated database must not throw
      // ("duplicate column name") from migration 37 re-adding a column
      // migration 36 already added correctly.
      const reopened = createDb(tmpPath);
      expect(reopened.pragma("user_version", { simple: true })).toBe(37);
      reopened.close();
    } finally {
      cleanupDbFile(tmpPath);
    }
  });
});
