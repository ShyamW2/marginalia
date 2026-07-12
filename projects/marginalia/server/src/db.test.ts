import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "./db.js";

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
      ]),
    );

    db.close();
  });

  it("records the applied schema version", () => {
    const db = createDb(":memory:");
    const version = db.pragma("user_version", { simple: true });
    expect(version).toBe(1);
    db.close();
  });

  it("is idempotent — reopening an already-migrated database file is a no-op", () => {
    const tmpPath = path.join(
      os.tmpdir(),
      `marginalia-test-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
    );

    try {
      const first = createDb(tmpPath);
      first.close();

      // Reopening the same file must not re-run migration 001 (which would
      // throw on CREATE TABLE against already-existing tables).
      const second = createDb(tmpPath);
      expect(second.pragma("user_version", { simple: true })).toBe(1);
      second.close();
    } finally {
      fs.rmSync(tmpPath, { force: true });
      fs.rmSync(`${tmpPath}-wal`, { force: true });
      fs.rmSync(`${tmpPath}-shm`, { force: true });
    }
  });
});
