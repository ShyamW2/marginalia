import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  createHighlight,
  deleteHighlight,
  getHighlightById,
  listHighlightsForResource,
} from "./highlights.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1") {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', 'Author', 'epub', '/tmp/x.epub', '{}', @importedAt)`,
  ).run({ id, importedAt: new Date().toISOString() });
  return id;
}

describe("highlights store", () => {
  it("creates and lists highlights for a resource, ordered by spine position", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    createHighlight(db, {
      resourceId,
      exact: "second",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/8!/4/2)",
      spineIndex: 2,
    });
    createHighlight(db, {
      resourceId,
      exact: "first",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
    });

    const highlights = listHighlightsForResource(db, resourceId);
    expect(highlights.map((h) => h.exact)).toEqual(["first", "second"]);
    db.close();
  });

  it("deletes a highlight and cascades to its thread and messages", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    const highlight = createHighlight(db, {
      resourceId,
      exact: "quote",
      prefix: "before ",
      suffix: " after",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
    });

    db.prepare(
      `INSERT INTO threads (id, highlight_id, created_at) VALUES ('thread-1', @highlightId, @now)`,
    ).run({ highlightId: highlight.id, now: new Date().toISOString() });
    db.prepare(
      `INSERT INTO messages (id, thread_id, role, content, created_at)
       VALUES ('msg-1', 'thread-1', 'user', 'hello', @now)`,
    ).run({ now: new Date().toISOString() });

    const deleted = deleteHighlight(db, highlight.id);
    expect(deleted).toBe(true);
    expect(getHighlightById(db, highlight.id)).toBeUndefined();
    expect(db.prepare("SELECT * FROM threads WHERE id = 'thread-1'").get()).toBeUndefined();
    expect(db.prepare("SELECT * FROM messages WHERE id = 'msg-1'").get()).toBeUndefined();
    db.close();
  });

  it("deleting a non-existent highlight is reported as a no-op", () => {
    const db = createDb(":memory:");
    expect(deleteHighlight(db, "missing")).toBe(false);
    db.close();
  });
});
