import Database from "better-sqlite3";
import { DB_PATH, ensureDataDirs } from "./paths.js";
import { MIGRATIONS, type Migration } from "./migrations.js";

let db: Database.Database | undefined;

/**
 * Opens a database at the given path (or ':memory:') and runs any pending
 * migrations against it. Exposed separately from getDb() so tests can spin
 * up an isolated database instead of touching the real data directory.
 */
export function createDb(dbPath: string): Database.Database {
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  runMigrations(database);
  return database;
}

/** Returns the singleton SQLite connection for the app's data directory. */
export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDirs();
  db = createDb(DB_PATH);
  return db;
}

function applyOneMigration(database: Database.Database, migration: Migration): void {
  const run = database.transaction(() => {
    if (migration.run) migration.run(database);
    else database.exec(migration.sql!);
    // pragma values can't be bound params; migration.version is our own
    // integer literal, never user input.
    database.pragma(`user_version = ${migration.version}`);
  });
  run();
}

function runMigrations(database: Database.Database): void {
  const currentVersion = database.pragma("user_version", {
    simple: true,
  }) as number;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    // M40 §B3: a table-rebuild migration (CREATE/copy/DROP/RENAME) needs
    // `foreign_keys = OFF` for the DROP of a table other tables still
    // reference — SQLite genuinely enforces that check, confirmed live
    // (`DROP TABLE` on a referenced parent throws "FOREIGN KEY constraint
    // failed" with rows still pointing at it). But the pragma is a
    // documented no-op while a transaction is open, and every migration
    // here runs inside one — so the toggle has to happen *outside* the
    // transaction `applyOneMigration` opens, which is what this branch is
    // for. `foreign_key_check` afterward is the other half of SQLite's own
    // rebuild recipe: confirms the rebuild didn't quietly orphan a
    // reference, checked before re-enabling enforcement.
    if (migration.requiresForeignKeysOff) {
      database.pragma("foreign_keys = OFF");
      try {
        applyOneMigration(database, migration);
        const violations = database.pragma("foreign_key_check") as unknown[];
        if (violations.length > 0) {
          throw new Error(
            `migration ${migration.version} left dangling foreign keys: ${JSON.stringify(violations)}`,
          );
        }
      } finally {
        database.pragma("foreign_keys = ON");
      }
      continue;
    }
    applyOneMigration(database, migration);
  }
}

/** Closes the singleton connection. Used by graceful shutdown. */
export function closeDb(): void {
  db?.close();
  db = undefined;
}
