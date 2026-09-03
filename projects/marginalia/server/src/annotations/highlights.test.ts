import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  createHighlight,
  deleteHighlight,
  getHighlightById,
  listHighlightsForResource,
  listHighlightsForThread,
  listHighlightsMissingOffset,
  listHighlightsWithThreadsForResource,
  reanchorHighlightToResource,
  setHighlightNote,
  setHighlightOffset,
  setHighlightPanelOffset,
} from "./highlights.js";
import { addThreadAnchor, createThread, getThreadById, listThreadAnchors } from "./threads.js";

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

  describe("M35 §D5: deleting one of several anchors", () => {
    it("deleting a non-primary anchor removes only that anchor — the thread and its primary survive", () => {
      const db = createDb(":memory:");
      const resourceId = seedResource(db);
      const primary = createHighlight(db, {
        resourceId,
        exact: "primary",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
      });
      const secondary = createHighlight(db, {
        resourceId,
        exact: "secondary",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/8!/4/2)",
        spineIndex: 2,
        kind: "rose",
      });
      const thread = createThread(db, primary.id);
      addThreadAnchor(db, thread.id, secondary.id);

      expect(deleteHighlight(db, secondary.id)).toBe(true);

      expect(getHighlightById(db, secondary.id)).toBeUndefined();
      expect(getHighlightById(db, primary.id)).toBeDefined();
      expect(getThreadById(db, thread.id)).toBeDefined();
      expect(getThreadById(db, thread.id)?.highlightId).toBe(primary.id);
      expect(listThreadAnchors(db, thread.id)).toEqual([
        { threadId: thread.id, highlightId: primary.id, ordinal: 0 },
      ]);
      db.close();
    });

    it("deleting the primary anchor while another remains promotes the next one — the trap TASKS.md calls out", () => {
      const db = createDb(":memory:");
      const resourceId = seedResource(db);
      const primary = createHighlight(db, {
        resourceId,
        exact: "primary",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
      });
      const secondary = createHighlight(db, {
        resourceId,
        exact: "secondary",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/8!/4/2)",
        spineIndex: 2,
        kind: "rose",
      });
      const third = createHighlight(db, {
        resourceId,
        exact: "third",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/12!/4/2)",
        spineIndex: 4,
        kind: "rose",
      });
      const thread = createThread(db, primary.id);
      addThreadAnchor(db, thread.id, secondary.id);
      addThreadAnchor(db, thread.id, third.id);

      expect(deleteHighlight(db, primary.id)).toBe(true);

      expect(getHighlightById(db, primary.id)).toBeUndefined();
      const survivingThread = getThreadById(db, thread.id);
      expect(survivingThread).toBeDefined();
      // Promoted to the next-oldest remaining anchor (by ordinal) — secondary,
      // not third, even though both survive.
      expect(survivingThread?.highlightId).toBe(secondary.id);
      expect(listThreadAnchors(db, thread.id).map((a) => a.highlightId)).toEqual([
        secondary.id,
        third.id,
      ]);
      db.close();
    });

    it("deleting the last remaining anchor cascades the thread away, exactly today's one-anchor behavior", () => {
      const db = createDb(":memory:");
      const resourceId = seedResource(db);
      const primary = createHighlight(db, {
        resourceId,
        exact: "primary",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
      });
      const secondary = createHighlight(db, {
        resourceId,
        exact: "secondary",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/8!/4/2)",
        spineIndex: 2,
        kind: "rose",
      });
      const thread = createThread(db, primary.id);
      addThreadAnchor(db, thread.id, secondary.id);

      expect(deleteHighlight(db, primary.id)).toBe(true);
      expect(getThreadById(db, thread.id)?.highlightId).toBe(secondary.id);

      // Now the last anchor goes — the thread itself must go too.
      expect(deleteHighlight(db, secondary.id)).toBe(true);
      expect(getThreadById(db, thread.id)).toBeUndefined();
      expect(db.prepare("SELECT COUNT(*) AS n FROM thread_anchors WHERE thread_id = ?").get(thread.id)).toEqual({
        n: 0,
      });
      db.close();
    });

    it("M35 §D3: listHighlightsWithThreadsForResource sets primaryHighlightId only on a genuine secondary anchor", () => {
      const db = createDb(":memory:");
      const resourceId = seedResource(db);
      const primary = createHighlight(db, {
        resourceId,
        exact: "primary",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
      });
      const secondary = createHighlight(db, {
        resourceId,
        exact: "secondary",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/8!/4/2)",
        spineIndex: 2,
        kind: "rose",
      });
      const ordinary = createHighlight(db, {
        resourceId,
        exact: "ordinary, no thread at all",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/12!/4/2)",
        spineIndex: 4,
        kind: "rose",
      });
      const thread = createThread(db, primary.id);
      addThreadAnchor(db, thread.id, secondary.id);

      const rows = listHighlightsWithThreadsForResource(db, resourceId);
      const byId = new Map(rows.map((h) => [h.id, h]));

      // The primary already carries its own `.thread` — primaryHighlightId
      // would be redundant (and self-referential), so it stays null.
      expect(byId.get(primary.id)?.thread?.id).toBe(thread.id);
      expect(byId.get(primary.id)?.primaryHighlightId).toBeNull();

      // The secondary has no `.thread` of its own, but points at the one
      // it's really a part of.
      expect(byId.get(secondary.id)?.thread).toBeNull();
      expect(byId.get(secondary.id)?.primaryHighlightId).toBe(primary.id);

      // An ordinary highlight with no thread at all — neither field fires.
      expect(byId.get(ordinary.id)?.thread).toBeNull();
      expect(byId.get(ordinary.id)?.primaryHighlightId).toBeNull();
      db.close();
    });

    it("listHighlightsForThread returns every anchor in reading order (spine index, then offset)", () => {
      const db = createDb(":memory:");
      const resourceId = seedResource(db);
      const later = createHighlight(db, {
        resourceId,
        exact: "later in the book",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/8!/4/2)",
        spineIndex: 3,
        kind: "rose",
      });
      const earlier = createHighlight(db, {
        resourceId,
        exact: "earlier in the book",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
      });
      // Created primary-first as "later", with "earlier" added second — the
      // list must still come back in reading order, not creation order.
      const thread = createThread(db, later.id);
      addThreadAnchor(db, thread.id, earlier.id);

      const sources = listHighlightsForThread(db, thread.id);
      expect(sources.map((h) => h.exact)).toEqual(["earlier in the book", "later in the book"]);
      db.close();
    });
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

  // M34 §0a — instrumentation, so the assertion is on the column, not on
  // anything the API returns. A reader-made highlight must stay '' or the
  // "how did machine-made anchors land?" query counts every highlight in
  // the book.
  it("M34 0a: records anchor_source, defaulting to '' for reader-made highlights", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    const base = {
      resourceId,
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose" as const,
    };
    const reader = createHighlight(db, { ...base, exact: "reader-made" });
    const located = createHighlight(db, { ...base, exact: "located", anchorSource: "quote" });
    const fallback = createHighlight(db, {
      ...base,
      exact: "fell back",
      anchorSource: "chapter_start",
    });

    const sourceOf = (id: string) =>
      (db.prepare("SELECT anchor_source FROM highlights WHERE id = ?").get(id) as {
        anchor_source: string;
      }).anchor_source;

    expect(sourceOf(reader.id)).toBe("");
    expect(sourceOf(located.id)).toBe("quote");
    expect(sourceOf(fallback.id)).toBe("chapter_start");
    db.close();
  });

  // M35 §A1 — same server-only shape as anchor_source: stored, not returned
  // on the domain object.
  describe("M35 §A offset/length", () => {
    it("stores offset/length when the caller provides them, and null when it doesn't", () => {
      const db = createDb(":memory:");
      const resourceId = seedResource(db);

      const located = createHighlight(db, {
        resourceId,
        exact: "quote",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
        offset: 42,
        length: 5,
      });
      const unanchored = createHighlight(db, {
        resourceId,
        exact: "other",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
      });

      const rowFor = (id: string) =>
        db.prepare(`SELECT "offset", length FROM highlights WHERE id = ?`).get(id) as {
          offset: number | null;
          length: number | null;
        };

      expect(rowFor(located.id)).toEqual({ offset: 42, length: 5 });
      expect(rowFor(unanchored.id)).toEqual({ offset: null, length: null });
      db.close();
    });

    it("lists only highlights missing an offset, and setHighlightOffset removes them from that list", () => {
      const db = createDb(":memory:");
      const resourceId = seedResource(db);

      const withOffset = createHighlight(db, {
        resourceId,
        exact: "a",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
        offset: 0,
        length: 1,
      });
      const missing = createHighlight(db, {
        resourceId,
        exact: "b",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 1,
        kind: "rose",
      });

      const before = listHighlightsMissingOffset(db, resourceId);
      expect(before.map((h) => h.id)).toEqual([missing.id]);
      expect(before.map((h) => h.id)).not.toContain(withOffset.id);

      setHighlightOffset(db, missing.id, 7, 3);
      expect(listHighlightsMissingOffset(db, resourceId)).toHaveLength(0);
      db.close();
    });
  });

  // M39 §C7 (PDF.md §2's migration path): reanchoring a highlight across an
  // extractor-version upgrade.
  describe("reanchorHighlightToResource", () => {
    it("moves a highlight's resource/spine/offset in place, carrying its thread, note, tags and panel position for free", () => {
      const db = createDb(":memory:");
      const oldResourceId = seedResource(db, "old-res");
      const newResourceId = seedResource(db, "new-res");

      const highlight = createHighlight(db, {
        resourceId: oldResourceId,
        exact: "quote",
        prefix: "pre",
        suffix: "suf",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
        offset: 5,
        length: 5,
      });
      setHighlightNote(db, highlight.id, "a note");
      setHighlightPanelOffset(db, highlight.id, 12, -4);
      const thread = createThread(db, highlight.id);

      reanchorHighlightToResource(db, highlight.id, {
        resourceId: newResourceId,
        spineIndex: 3,
        offset: 40,
        length: 5,
      });

      const moved = getHighlightById(db, highlight.id);
      expect(moved).toMatchObject({
        resourceId: newResourceId,
        spineIndex: 3,
        exact: "quote",
        note: "a note",
        panelDx: 12,
        panelDy: -4,
      });
      // offset/length aren't part of the `Highlight` domain type (see this
      // file's own comment on `HighlightMissingOffset`) — check the row.
      const row = db.prepare(`SELECT "offset", length FROM highlights WHERE id = ?`).get(highlight.id) as {
        offset: number;
        length: number;
      };
      expect(row).toEqual({ offset: 40, length: 5 });

      // The thread never moved rows at all — it keys off highlight_id,
      // which didn't change — so it's still exactly where it was.
      expect(getThreadById(db, thread.id)?.highlightId).toBe(highlight.id);
      expect(listHighlightsForResource(db, oldResourceId)).toHaveLength(0);
      expect(listHighlightsForResource(db, newResourceId).map((h) => h.id)).toEqual([highlight.id]);
      db.close();
    });
  });
});
