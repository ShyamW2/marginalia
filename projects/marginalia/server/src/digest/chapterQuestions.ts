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

/** Creates the chapter's question on first write, or replaces its text on a
 * later write for the *same* text (an idempotent resubmit) — one row per
 * (resource, chapter), same upsert shape `putBrief` (thematicStore.ts) uses
 * for its own single-row-per-resource case. This function alone does not
 * defend the second-write case (M36 C1): the route
 * (routes/digest.ts's PUT handler) checks for a genuinely different existing
 * question and refuses with 409 before calling this, since overwriting here
 * would silently destroy the first question while leaving its `note`
 * attached to text that no longer exists. */
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

/**
 * M35 §B2: a posed question whose quote can't be located becomes a
 * chapter-level question instead of a highlight pinned to the chapter's
 * opening 120 characters — "the two features resolve each other; a wrong
 * anchor is worse than no anchor." Unlike `upsertChapterQuestion` (the
 * reader's own PUT, which always overwrites), this never clobbers a
 * question the reader already wrote for that chapter — it only fills an
 * empty slot. Returns the row either way, so the caller can hand the
 * reader *something* to look at even when it left an existing row alone.
 */
export function seedChapterQuestionIfAbsent(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
  question: string,
): ChapterQuestion {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chapter_questions (resource_id, spine_index, question, note, created_at, updated_at)
     VALUES (@resourceId, @spineIndex, @question, '', @now, @now)
     ON CONFLICT(resource_id, spine_index) DO NOTHING`,
  ).run({ resourceId, spineIndex, question, now });
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
