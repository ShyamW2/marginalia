import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { createHighlight } from "./highlights.js";
import { createThread, getOrCreateThread, getThreadByHighlightId } from "./threads.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1") {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', 'Author', 'epub', '/tmp/x.epub', '{}', @importedAt)`,
  ).run({ id, importedAt: new Date().toISOString() });
  return id;
}

function seedHighlight(db: ReturnType<typeof createDb>) {
  const resourceId = seedResource(db);
  return createHighlight(db, {
    resourceId,
    exact: "quote",
    prefix: "",
    suffix: "",
    cfi: "epubcfi(/6/4!/4/2)",
    spineIndex: 0,
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
