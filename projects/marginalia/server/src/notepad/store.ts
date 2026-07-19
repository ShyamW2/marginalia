import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Notepad } from "@marginalia/shared";

interface NotepadRow {
  content: string;
  published_hash: string | null;
  updated_at: string;
}

function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readRow(db: Database.Database): NotepadRow {
  const row = db
    .prepare("SELECT content, published_hash, updated_at FROM notepad WHERE id = 1")
    .get() as NotepadRow | undefined;
  return row ?? { content: "", published_hash: null, updated_at: new Date().toISOString() };
}

export function getNotepad(db: Database.Database): Notepad {
  const row = readRow(db);
  return {
    content: row.content,
    updatedAt: row.updated_at,
    // Blank content is never "dirty" — there's nothing to publish.
    dirty: row.content.trim() !== "" && row.published_hash !== contentHash(row.content),
  };
}

export function updateNotepadContent(db: Database.Database, content: string): Notepad {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO notepad (id, content, published_hash, updated_at)
     VALUES (1, @content, NULL, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET content = @content, updated_at = @updatedAt`,
  ).run({ content, updatedAt });
  return getNotepad(db);
}

/** Internal: current content + whether it matches the last published hash. */
export function getNotepadForPublish(db: Database.Database): {
  content: string;
  upToDate: boolean;
} {
  const row = readRow(db);
  const upToDate =
    row.content.trim() === "" || row.published_hash === contentHash(row.content);
  return { content: row.content, upToDate };
}

export function recordNotepadPublish(db: Database.Database, content: string): void {
  db.prepare("UPDATE notepad SET published_hash = ? WHERE id = 1").run(contentHash(content));
}
