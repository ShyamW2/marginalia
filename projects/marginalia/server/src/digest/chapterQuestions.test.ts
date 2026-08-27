import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  getChapterQuestion,
  listChapterQuestions,
  setChapterQuestionNote,
  upsertChapterQuestion,
} from "./chapterQuestions.js";

function seedResource(db: ReturnType<typeof createDb>, id: string): void {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ id, now: new Date().toISOString() });
}

describe("chapterQuestions", () => {
  it("returns null for a chapter with no question yet", () => {
    const db = createDb(":memory:");
    seedResource(db, "r1");
    expect(getChapterQuestion(db, "r1", 0)).toBeNull();
    db.close();
  });

  it("creates a question on first write and survives a reload", () => {
    const db = createDb(":memory:");
    seedResource(db, "r1");
    const created = upsertChapterQuestion(db, "r1", 2, "Why does the narrator lie here?");
    expect(created.spineIndex).toBe(2);
    expect(created.question).toBe("Why does the narrator lie here?");
    expect(created.note).toBe("");

    const reloaded = getChapterQuestion(db, "r1", 2);
    expect(reloaded).toEqual(created);
    db.close();
  });

  it("updates the question text in place rather than creating a second row", () => {
    const db = createDb(":memory:");
    seedResource(db, "r1");
    const first = upsertChapterQuestion(db, "r1", 2, "First draft");
    const second = upsertChapterQuestion(db, "r1", 2, "Better phrasing");
    expect(second.question).toBe("Better phrasing");
    expect(second.createdAt).toBe(first.createdAt);
    expect(listChapterQuestions(db, "r1")).toHaveLength(1);
    db.close();
  });

  it("autosaves the note without touching the question", () => {
    const db = createDb(":memory:");
    seedResource(db, "r1");
    upsertChapterQuestion(db, "r1", 1, "What changes here?");
    setChapterQuestionNote(db, "r1", 1, "A note the reader wrote themselves");
    const updated = getChapterQuestion(db, "r1", 1);
    expect(updated?.question).toBe("What changes here?");
    expect(updated?.note).toBe("A note the reader wrote themselves");
    db.close();
  });

  it("is a no-op setting a note on a chapter with no question", () => {
    const db = createDb(":memory:");
    seedResource(db, "r1");
    setChapterQuestionNote(db, "r1", 0, "orphaned note");
    expect(getChapterQuestion(db, "r1", 0)).toBeNull();
    db.close();
  });

  it("keys questions per chapter, not per resource", () => {
    const db = createDb(":memory:");
    seedResource(db, "r1");
    upsertChapterQuestion(db, "r1", 0, "About chapter 1");
    upsertChapterQuestion(db, "r1", 1, "About chapter 2");
    const list = listChapterQuestions(db, "r1");
    expect(list.map((q) => q.spineIndex)).toEqual([0, 1]);
    db.close();
  });
});
