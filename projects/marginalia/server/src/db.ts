import Database from "better-sqlite3";
import { DB_PATH, ensureDataDirs } from "./paths.js";
import { MIGRATIONS } from "./migrations.js";

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

function runMigrations(database: Database.Database): void {
  const currentVersion = database.pragma("user_version", {
    simple: true,
  }) as number;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    const applyMigration = database.transaction(() => {
      if (migration.run) migration.run(database);
      else database.exec(migration.sql!);
      // pragma values can't be bound params; migration.version is our own
      // integer literal, never user input.
      database.pragma(`user_version = ${migration.version}`);
    });
    applyMigration();
  }
}

/** Closes the singleton connection. Used by graceful shutdown. */
export function closeDb(): void {
  db?.close();
  db = undefined;
}
