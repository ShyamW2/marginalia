import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { createHighlight } from "./highlights.js";
import {
  addThreadAnchor,
  createMessage,
  createThread,
  getAnchoredThreadId,
  getOrCreateThread,
  getThreadByHighlightId,
  getThreadSummary,
  isHighlightAnchored,
  listMessagesForThread,
  listThreadAnchors,
} from "./threads.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1") {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', 'Author', 'epub', '/tmp/x.epub', '{}', @importedAt)`,
  ).run({ id, importedAt: new Date().toISOString() });
  return id;
}

function seedHighlight(db: ReturnType<typeof createDb>) {
  const resourceId = seedResource(db);
  return seedHighlightFor(db, resourceId);
}

function seedHighlightFor(db: ReturnType<typeof createDb>, resourceId: string, spineIndex = 0) {
  return createHighlight(db, {
    resourceId,
    exact: `quote ${spineIndex}`,
    prefix: "",
    suffix: "",
    cfi: `epubcfi(/6/${spineIndex}!/4/2)`,
    spineIndex,
    kind: "slate",
  });
}

describe("getOrCreateThread", () => {
  it("creates a thread the first time and reuses it on subsequent calls", () => {
    const db = createDb(":memory:");
    const highlight = seedHighlight(db);

    const first = getOrCreateThread(db, highlight.id);
    const second = getOrCreateThread(db, highlight.id);

    expect(second.id).toBe(first.id);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM threads WHERE highlight_id = ?")
      .get(highlight.id) as { n: number };
    expect(count.n).toBe(1);
    db.close();
  });

  it("createThread throws the UNIQUE(highlight_id) constraint error a race would hit", () => {
    // Documents the exact failure getOrCreateThread guards against: two
    // near-simultaneous first-questions on the same highlight both see no
    // existing thread (this check), then both call createThread — the
    // loser's insert collides with threads.highlight_id's UNIQUE constraint.
    // better-sqlite3 is synchronous, so the interleaving itself can't be
    // reproduced in a single-threaded test; this asserts the shape of the
    // error getOrCreateThread's catch clause must recognize.
    const db = createDb(":memory:");
    const highlight = seedHighlight(db);
    expect(getThreadByHighlightId(db, highlight.id)).toBeUndefined();

    createThread(db, highlight.id);
    let caught: unknown;
    try {
      createThread(db, highlight.id);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toMatch(/^SQLITE_CONSTRAINT/);
    db.close();
  });
});

describe("createMessage — M34 §D transparency", () => {
  it("round-trips contextThematicChapters and contextMasked through storage", () => {
    const db = createDb(":memory:");
    const highlight = seedHighlight(db);
    const thread = createThread(db, highlight.id);

    createMessage(db, thread.id, "assistant", "an answer", {
      contextDepth: "digest",
      contextChapters: [0, 1],
      contextThematicChapters: [1],
      contextMasked: true,
    });

    const [message] = listMessagesForThread(db, thread.id);
    expect(message.contextChapters).toEqual([0, 1]);
    expect(message.contextThematicChapters).toEqual([1]);
    expect(message.contextMasked).toBe(true);
    db.close();
  });

  it("defaults contextThematicChapters to [] and contextMasked to null when not recorded", () => {
    const db = createDb(":memory:");
    const highlight = seedHighlight(db);
    const thread = createThread(db, highlight.id);

    createMessage(db, thread.id, "user", "a question");

    const [message] = listMessagesForThread(db, thread.id);
    expect(message.contextThematicChapters).toEqual([]);
    expect(message.contextMasked).toBeNull();
    db.close();
  });
});

describe("thread_anchors — M35 §D1", () => {
  it("createThread writes the primary's own thread_anchors row at ordinal 0", () => {
    const db = createDb(":memory:");
    const highlight = seedHighlight(db);
    const thread = createThread(db, highlight.id);

    expect(listThreadAnchors(db, thread.id)).toEqual([
      { threadId: thread.id, highlightId: highlight.id, ordinal: 0 },
    ]);
    db.close();
  });

  it("addThreadAnchor appends at the next ordinal, in call order", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);
    const primary = seedHighlightFor(db, resourceId, 0);
    const second = seedHighlightFor(db, resourceId, 2);
    const third = seedHighlightFor(db, resourceId, 5);
    const thread = createThread(db, primary.id);

    addThreadAnchor(db, thread.id, second.id);
    addThreadAnchor(db, thread.id, third.id);

    expect(listThreadAnchors(db, thread.id)).toEqual([
      { threadId: thread.id, highlightId: primary.id, ordinal: 0 },
      { threadId: thread.id, highlightId: second.id, ordinal: 1 },
      { threadId: thread.id, highlightId: third.id, ordinal: 2 },
    ]);
    db.close();
  });
});

describe("getAnchoredThreadId / isHighlightAnchored — M35 §G3", () => {
  it("is undefined/false for a highlight that anchors nothing", () => {
    const db = createDb(":memory:");
    const highlight = seedHighlight(db);

    expect(getAnchoredThreadId(db, highlight.id)).toBeUndefined();
    expect(isHighlightAnchored(db, highlight.id)).toBe(false);
    db.close();
  });

  it("names the thread a highlight is already anchored to, primary or secondary", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);
    const primary = seedHighlightFor(db, resourceId, 0);
    const second = seedHighlightFor(db, resourceId, 2);
    const thread = createThread(db, primary.id);
    addThreadAnchor(db, thread.id, second.id);

    expect(getAnchoredThreadId(db, primary.id)).toBe(thread.id);
    expect(getAnchoredThreadId(db, second.id)).toBe(thread.id);
    expect(isHighlightAnchored(db, second.id)).toBe(true);
    db.close();
  });

  it("distinguishes a highlight anchored to a different thread from one anchored to none", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);
    const primaryA = seedHighlightFor(db, resourceId, 0);
    const primaryB = seedHighlightFor(db, resourceId, 3);
    const threadA = createThread(db, primaryA.id);
    const threadB = createThread(db, primaryB.id);

    expect(getAnchoredThreadId(db, primaryA.id)).toBe(threadA.id);
    expect(getAnchoredThreadId(db, primaryA.id)).not.toBe(threadB.id);
    db.close();
  });
});

describe("getThreadSummary — M35 §G4", () => {
  it("is empty for a just-created thread with no messages", () => {
    const db = createDb(":memory:");
    const highlight = seedHighlight(db);
    const thread = createThread(db, highlight.id);

    expect(getThreadSummary(db, thread.id)).toEqual({
      id: thread.id,
      hasAnswer: false,
      messageCount: 0,
    });
    db.close();
  });

  it("reflects messages already posted to the thread", () => {
    const db = createDb(":memory:");
    const highlight = seedHighlight(db);
    const thread = createThread(db, highlight.id);
    createMessage(db, thread.id, "user", "a question");
    createMessage(db, thread.id, "assistant", "an answer");

    expect(getThreadSummary(db, thread.id)).toEqual({
      id: thread.id,
      hasAnswer: true,
      messageCount: 2,
    });
    db.close();
  });
});
