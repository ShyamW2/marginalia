import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { putChapterDigest } from "./store.js";
import { putThematicDigest } from "./thematicStore.js";
import { isChapterVisible, visibleChapterDigests, visibleThematicDigests } from "./visibility.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1") {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', 'Author', 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ id, now: new Date().toISOString() });
}

describe("isChapterVisible", () => {
  it("shows anything at or before the bookmark", () => {
    expect(isChapterVisible(3, { bookmarkSpineIndex: 5 })).toBe(true);
    expect(isChapterVisible(5, { bookmarkSpineIndex: 5 })).toBe(true);
  });

  it("hides anything past the bookmark by default", () => {
    expect(isChapterVisible(6, { bookmarkSpineIndex: 5 })).toBe(false);
  });

  it("shows a past-bookmark chapter only when explicitly revealed", () => {
    const opts = { bookmarkSpineIndex: 5, revealedSpineIndices: new Set([6]) };
    expect(isChapterVisible(6, opts)).toBe(true);
    expect(isChapterVisible(7, opts)).toBe(false);
  });

  it("shows everything when noMask is set, regardless of bookmark or reveal", () => {
    expect(isChapterVisible(99, { bookmarkSpineIndex: -1, noMask: true })).toBe(true);
  });

  it("treats no bookmark (-1) as nothing revealed yet", () => {
    expect(isChapterVisible(0, { bookmarkSpineIndex: -1 })).toBe(false);
  });
});

describe("visibleChapterDigests / visibleThematicDigests", () => {
  it("filters the store's full lists down to what's visible", () => {
    const db = createDb(":memory:");
    seedResource(db);
    for (const spineIndex of [0, 1, 2, 3]) {
      putChapterDigest(db, {
        resourceId: "res-1",
        spineIndex,
        summary: `s${spineIndex}`,
        themes: [],
        characters: [],
        title: null,
        sourceHash: "h",
      });
      putThematicDigest(db, {
        resourceId: "res-1",
        spineIndex,
        briefHash: "b",
        briefText: "",
        analysis: `a${spineIndex}`,
        themes: [],
        questions: [],
      });
    }

    const opts = { bookmarkSpineIndex: 1 };
    const chapters = visibleChapterDigests(db, "res-1", opts);
    expect(chapters.map((c) => c.spineIndex)).toEqual([0, 1]);

    const thematic = visibleThematicDigests(db, "res-1", opts);
    expect(thematic.map((t) => t.spineIndex)).toEqual([0, 1]);

    db.close();
  });
});
