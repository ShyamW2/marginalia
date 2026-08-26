import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  createHighlight,
  deleteHighlight,
  getHighlightById,
  listHighlightsForResource,
  setHighlightNote,
  setHighlightPanelOffset,
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
      kind: "rose",
    });
    createHighlight(db, {
      resourceId,
      exact: "first",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
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
      kind: "rose",
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

  it("M30 E: deletes a highlight even when its thread has a tracked LLM call, a tag, and a theme", () => {
    // Found live (2026-08-27) driving the new delete-confirmation flow on a
    // real answered thread: with `foreign_keys = ON` (db.ts), this used to
    // fail the whole transaction — a 500, not the designed 204 — the moment
    // a thread had *any* llm_usage row pointing at one of its messages, or
    // the highlight had a tag or a theme. None of those exist in the
    // "cascades to its thread and messages" test above, which is exactly
    // why this gap went unnoticed until a real book exercised it.
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    const highlight = createHighlight(db, {
      resourceId,
      exact: "the golden gate",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO threads (id, highlight_id, created_at) VALUES ('thread-1', @highlightId, @now)`,
    ).run({ highlightId: highlight.id, now });
    db.prepare(
      `INSERT INTO messages (id, thread_id, role, content, created_at)
       VALUES ('msg-1', 'thread-1', 'assistant', 'an answer', @now)`,
    ).run({ now });
    db.prepare(
      `INSERT INTO llm_usage
         (id, provider, model, operation, input_tokens, output_tokens, provenance, duration_ms, created_at, message_id)
       VALUES ('usage-1', 'openai-compatible', 'qwen3.5', 'thread', 100, 50, 'reported', 1000, @now, 'msg-1')`,
    ).run({ now });
    db.prepare(`INSERT INTO highlight_tags (highlight_id, tag) VALUES (?, 'favorite')`).run(highlight.id);
    db.prepare(`INSERT INTO highlight_themes (highlight_id, theme) VALUES (?, 'moral-choice')`).run(
      highlight.id,
    );

    expect(deleteHighlight(db, highlight.id)).toBe(true);
    expect(getHighlightById(db, highlight.id)).toBeUndefined();
    expect(db.prepare("SELECT * FROM highlight_tags WHERE highlight_id = ?").get(highlight.id)).toBeUndefined();
    expect(
      db.prepare("SELECT * FROM highlight_themes WHERE highlight_id = ?").get(highlight.id),
    ).toBeUndefined();
    // The cost record survives — only its dangling link to the deleted
    // message is cleared, same "fall back to null, never delete the
    // accounting history" rule deleteProviderProfile already follows.
    const usageRow = db.prepare("SELECT * FROM llm_usage WHERE id = 'usage-1'").get() as
      | { message_id: string | null }
      | undefined;
    expect(usageRow).toBeDefined();
    expect(usageRow?.message_id).toBeNull();
    db.close();
  });

  it("deleting a non-existent highlight is reported as a no-op", () => {
    const db = createDb(":memory:");
    expect(deleteHighlight(db, "missing")).toBe(false);
    db.close();
  });

  it("deletes a highlight whose thread has a publishes ledger row (M6)", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    const highlight = createHighlight(db, {
      resourceId,
      exact: "quote",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO threads (id, highlight_id, created_at) VALUES ('thread-1', @highlightId, @now)`,
    ).run({ highlightId: highlight.id, now });
    db.prepare(
      `INSERT INTO publishes (thread_id, note_path, content_hash, published_at)
       VALUES ('thread-1', 'Readings/Book/01 - note.md', 'abc123', @now)`,
    ).run({ now });

    expect(deleteHighlight(db, highlight.id)).toBe(true);
    expect(db.prepare("SELECT * FROM publishes WHERE thread_id = 'thread-1'").get()).toBeUndefined();
    db.close();
  });

  it("creates a highlight with an empty note by default and setHighlightNote updates it", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    const highlight = createHighlight(db, {
      resourceId,
      exact: "quote",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    expect(highlight.note).toBe("");
    expect(getHighlightById(db, highlight.id)?.note).toBe("");

    setHighlightNote(db, highlight.id, "the reader's own note");
    expect(getHighlightById(db, highlight.id)?.note).toBe("the reader's own note");
    db.close();
  });

  it("creates a highlight with a zero panel offset by default and setHighlightPanelOffset updates it", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    const highlight = createHighlight(db, {
      resourceId,
      exact: "quote",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    expect(highlight.panelDx).toBe(0);
    expect(highlight.panelDy).toBe(0);

    setHighlightPanelOffset(db, highlight.id, 42, -17.5);
    const updated = getHighlightById(db, highlight.id);
    expect(updated?.panelDx).toBe(42);
    expect(updated?.panelDy).toBe(-17.5);
    db.close();
  });
});
