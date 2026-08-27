import type Database from "better-sqlite3";
import type { ChapterQuestion } from "@marginalia/shared";

interface ChapterQuestionRow {
  resource_id: string;
  spine_index: number;
  question: string;
  note: string;
  created_at: string;
  updated_at: string;
}

function rowToChapterQuestion(row: ChapterQuestionRow): ChapterQuestion {
  return {
    resourceId: row.resource_id,
    spineIndex: row.spine_index,
    question: row.question,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getChapterQuestion(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
): ChapterQuestion | null {
  const row = db
    .prepare("SELECT * FROM chapter_questions WHERE resource_id = ? AND spine_index = ?")
    .get(resourceId, spineIndex) as ChapterQuestionRow | undefined;
  return row ? rowToChapterQuestion(row) : null;
}

export function listChapterQuestions(db: Database.Database, resourceId: string): ChapterQuestion[] {
  const rows = db
    .prepare("SELECT * FROM chapter_questions WHERE resource_id = ? ORDER BY spine_index")
    .all(resourceId) as ChapterQuestionRow[];
  return rows.map(rowToChapterQuestion);
}

/** Creates the chapter's question on first write, or replaces its text on any
 * later one — one row per (resource, chapter), same upsert shape
 * `putBrief` (thematicStore.ts) uses for its own single-row-per-resource case. */
export function upsertChapterQuestion(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
  question: string,
): ChapterQuestion {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chapter_questions (resource_id, spine_index, question, note, created_at, updated_at)
     VALUES (@resourceId, @spineIndex, @question, '', @now, @now)
     ON CONFLICT(resource_id, spine_index) DO UPDATE SET question = @question, updated_at = @now`,
  ).run({ resourceId, spineIndex, question, now });
  // Re-read rather than trust the input for `note`/`createdAt` — an update
  // must keep the existing note and created_at, and SQLite's RETURNING
  // support is version-dependent across better-sqlite3's bundled builds.
  return getChapterQuestion(db, resourceId, spineIndex)!;
}

/** The answer-space: plain text, autosaved — same shape as
 * `setHighlightNote` (annotations/highlights.ts). No-op if the chapter has no
 * question yet (there is nothing to attach a note to). */
export function setChapterQuestionNote(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
  note: string,
): void {
  db.prepare(
    "UPDATE chapter_questions SET note = ?, updated_at = ? WHERE resource_id = ? AND spine_index = ?",
  ).run(note, new Date().toISOString(), resourceId, spineIndex);
}
