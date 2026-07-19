import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDb } from "../db.js";
import {
  getNotepad,
  getNotepadForPublish,
  recordNotepadPublish,
  updateNotepadContent,
} from "./store.js";

type Db = ReturnType<typeof createDb>;

describe("notepad store", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("starts empty and not dirty", () => {
    const notepad = getNotepad(db);
    expect(notepad.content).toBe("");
    expect(notepad.dirty).toBe(false);
  });

  it("autosave persists content and marks it dirty (nonblank, unpublished)", () => {
    updateNotepadContent(db, "a scratch thought");
    const notepad = getNotepad(db);
    expect(notepad.content).toBe("a scratch thought");
    expect(notepad.dirty).toBe(true);
  });

  it("publishing clears dirty until content changes again", () => {
    updateNotepadContent(db, "a scratch thought");
    recordNotepadPublish(db, "a scratch thought");
    expect(getNotepad(db).dirty).toBe(false);
    expect(getNotepadForPublish(db).upToDate).toBe(true);

    updateNotepadContent(db, "a scratch thought, revised");
    expect(getNotepad(db).dirty).toBe(true);
    expect(getNotepadForPublish(db).upToDate).toBe(false);
  });

  it("blank content is never dirty and always up to date", () => {
    updateNotepadContent(db, "   ");
    expect(getNotepad(db).dirty).toBe(false);
    expect(getNotepadForPublish(db).upToDate).toBe(true);
  });
});
