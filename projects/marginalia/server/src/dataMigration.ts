import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { MIGRATION_MARKER_NAME } from "./paths.js";

const DB_BASENAME = "marginalia.sqlite";

export interface TableRowCount {
  table: string;
  legacy: number;
  migrated: number;
}

export type DataMigrationStatus =
  | "migrated"
  | "already-migrated"
  | "no-legacy-data"
  | "target-not-empty"
  | "verification-failed";

export interface DataMigrationResult {
  status: DataMigrationStatus;
  mismatches?: TableRowCount[];
}

/**
 * M44 (DESKTOP.md §3.1): copy the legacy `data/` directory into its new
 * per-user home, verify every table's row count matches, and only then write
 * the marker `resolveDataDir` looks for. **Never moves** — `legacyDir` is
 * left untouched in every outcome, so a bad copy is recoverable by deleting
 * `targetDir` and running again. Not wired into server startup: the operator
 * runs it deliberately (`pnpm --filter server migrate-data-dir`), the same
 * way this session tested it — against a *copy* of the real directory, never
 * the original.
 *
 * The `-wal`/`-shm` sidecars are ordinary files under `legacyDir`, so the
 * whole-tree copy below carries them alongside `marginalia.sqlite` without
 * needing to know their names — the failure mode §3.1 warns about (a WAL
 * left behind because only the `.sqlite` was considered "the database") is
 * a special case only if you copy files one at a time.
 */
export function migrateLegacyDataDir(legacyDir: string, targetDir: string): DataMigrationResult {
  const markerPath = path.join(targetDir, MIGRATION_MARKER_NAME);
  if (fs.existsSync(markerPath)) {
    return { status: "already-migrated" };
  }
  if (!fs.existsSync(legacyDir)) {
    return { status: "no-legacy-data" };
  }
  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    return { status: "target-not-empty" };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(legacyDir, targetDir, { recursive: true });

  const legacyDbPath = path.join(legacyDir, DB_BASENAME);
  const migratedDbPath = path.join(targetDir, DB_BASENAME);
  const mismatches =
    fs.existsSync(legacyDbPath) && fs.existsSync(migratedDbPath)
      ? compareRowCounts(legacyDbPath, migratedDbPath)
      : [];

  if (mismatches.length > 0) {
    return { status: "verification-failed", mismatches };
  }

  fs.writeFileSync(
    markerPath,
    JSON.stringify({ migratedAt: new Date().toISOString(), source: legacyDir }, null, 2),
  );
  return { status: "migrated" };
}

/** Every user table's row count, legacy vs. migrated — opened read-only so
 * this never contends with a connection either database might already have
 * open, and so it can never itself write to either file. Exported
 * separately so the mismatch path is testable without needing to make
 * `fs.cpSync` itself produce a bad copy. */
export function compareRowCounts(legacyDbPath: string, migratedDbPath: string): TableRowCount[] {
  const legacyDb = new Database(legacyDbPath, { readonly: true });
  const migratedDb = new Database(migratedDbPath, { readonly: true });
  try {
    const tables = legacyDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    const mismatches: TableRowCount[] = [];
    for (const { name } of tables) {
      const legacyCount = (
        legacyDb.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }
      ).c;
      const migratedCount = (
        migratedDb.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as { c: number }
      ).c;
      if (legacyCount !== migratedCount) {
        mismatches.push({ table: name, legacy: legacyCount, migrated: migratedCount });
      }
    }
    return mismatches;
  } finally {
    legacyDb.close();
    migratedDb.close();
  }
}
