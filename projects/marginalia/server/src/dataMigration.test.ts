import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATION_MARKER_NAME } from "./paths.js";
import { compareRowCounts, migrateLegacyDataDir } from "./dataMigration.js";

function tmpDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `marginalia-migration-${label}-`));
}

/** A minimal but real database with an open WAL, so the sidecar files
 * (-wal/-shm) actually exist on disk the way §3.1 warns a bare `.sqlite`
 * copy would drop. */
function writeFixtureDb(dir: string, rows: { library: number; highlights: number }): void {
  const db = new Database(path.join(dir, "marginalia.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE library (id INTEGER PRIMARY KEY, title TEXT)");
  db.exec("CREATE TABLE highlights (id INTEGER PRIMARY KEY, text TEXT)");
  const insertLib = db.prepare("INSERT INTO library (title) VALUES (?)");
  for (let i = 0; i < rows.library; i++) insertLib.run(`book ${i}`);
  const insertHl = db.prepare("INSERT INTO highlights (text) VALUES (?)");
  for (let i = 0; i < rows.highlights; i++) insertHl.run(`quote ${i}`);
  db.close();
}

describe("migrateLegacyDataDir", () => {
  it("copies the whole tree, including the WAL sidecars, and marks success", () => {
    const legacy = tmpDir("legacy");
    writeFixtureDb(legacy, { library: 3, highlights: 5 });
    fs.mkdirSync(path.join(legacy, "library"));
    fs.writeFileSync(path.join(legacy, "library", "book.epub"), "fake epub bytes");

    const target = path.join(tmpDir("target-parent"), "marginalia");
    const result = migrateLegacyDataDir(legacy, target);

    expect(result.status).toBe("migrated");
    expect(fs.existsSync(path.join(target, "marginalia.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(target, "library", "book.epub"))).toBe(true);
    expect(fs.existsSync(path.join(target, MIGRATION_MARKER_NAME))).toBe(true);

    // The source is untouched — never moved.
    expect(fs.existsSync(path.join(legacy, "marginalia.sqlite"))).toBe(true);

    const migratedDb = new Database(path.join(target, "marginalia.sqlite"), { readonly: true });
    expect((migratedDb.prepare("SELECT COUNT(*) AS c FROM library").get() as { c: number }).c).toBe(3);
    expect((migratedDb.prepare("SELECT COUNT(*) AS c FROM highlights").get() as { c: number }).c).toBe(5);
    migratedDb.close();
  });

  it("is a no-op when there is no legacy directory", () => {
    const legacy = path.join(tmpDir("parent"), "does-not-exist");
    const target = tmpDir("target");
    const result = migrateLegacyDataDir(legacy, target);
    expect(result.status).toBe("no-legacy-data");
    expect(fs.existsSync(path.join(target, MIGRATION_MARKER_NAME))).toBe(false);
  });

  it("short-circuits once the marker already exists, never re-copying", () => {
    const legacy = tmpDir("legacy");
    writeFixtureDb(legacy, { library: 1, highlights: 1 });
    const target = tmpDir("target");
    fs.writeFileSync(path.join(target, MIGRATION_MARKER_NAME), "{}");
    fs.writeFileSync(path.join(target, "sentinel"), "untouched");

    const result = migrateLegacyDataDir(legacy, target);
    expect(result.status).toBe("already-migrated");
    // Proof nothing was re-copied over it.
    expect(fs.existsSync(path.join(target, "sentinel"))).toBe(true);
    expect(fs.existsSync(path.join(target, "marginalia.sqlite"))).toBe(false);
  });

  it("refuses a non-empty target that has no marker, rather than merging into it", () => {
    const legacy = tmpDir("legacy");
    writeFixtureDb(legacy, { library: 1, highlights: 1 });
    const target = tmpDir("target");
    fs.writeFileSync(path.join(target, "unexpected-file"), "surprise");

    const result = migrateLegacyDataDir(legacy, target);
    expect(result.status).toBe("target-not-empty");
    expect(fs.existsSync(path.join(target, "marginalia.sqlite"))).toBe(false);
  });

  it("never re-verifies over an existing copy on a second call", () => {
    const legacy = tmpDir("legacy");
    writeFixtureDb(legacy, { library: 1, highlights: 1 });
    const target = path.join(tmpDir("target-parent"), "marginalia");

    expect(migrateLegacyDataDir(legacy, target).status).toBe("migrated");
    // The marker is there now, so a second call must short-circuit rather
    // than attempt another copy into a directory that already has one.
    expect(migrateLegacyDataDir(legacy, target).status).toBe("already-migrated");
  });

  it("compareRowCounts reports every table whose count diverges", () => {
    const legacy = tmpDir("legacy");
    writeFixtureDb(legacy, { library: 4, highlights: 2 });
    const migrated = tmpDir("migrated");
    writeFixtureDb(migrated, { library: 4, highlights: 5 });

    const mismatches = compareRowCounts(
      path.join(legacy, "marginalia.sqlite"),
      path.join(migrated, "marginalia.sqlite"),
    );
    expect(mismatches).toEqual([{ table: "highlights", legacy: 2, migrated: 5 }]);
  });

  it("reports verification-failed and skips the marker when the copy diverges", () => {
    const legacy = tmpDir("legacy");
    writeFixtureDb(legacy, { library: 3, highlights: 3 });
    const target = path.join(tmpDir("target-parent"), "marginalia");

    const realCpSync = fs.cpSync.bind(fs);
    vi.spyOn(fs, "cpSync").mockImplementation((src, dest, opts) => {
      realCpSync(src as string, dest as string, opts as fs.CopySyncOptions);
      const db = new Database(path.join(dest as string, "marginalia.sqlite"));
      db.exec("DELETE FROM highlights WHERE id = 1");
      db.close();
    });

    const result = migrateLegacyDataDir(legacy, target);

    expect(result.status).toBe("verification-failed");
    expect(result.mismatches).toEqual([{ table: "highlights", legacy: 3, migrated: 2 }]);
    expect(fs.existsSync(path.join(target, MIGRATION_MARKER_NAME))).toBe(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
