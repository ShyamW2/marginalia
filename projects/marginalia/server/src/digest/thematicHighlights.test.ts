import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { listHighlightsForResource } from "../annotations/highlights.js";
import { getThreadByHighlightId, listThreadAnchors } from "../annotations/threads.js";
import { persistThematicHighlights } from "./thematicHighlights.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1") {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', 'Author', 'epub', '/tmp/x.epub', '{}', @importedAt)`,
  ).run({ id, importedAt: new Date().toISOString() });
  return id;
}

const SECTION_TEXT = "The cat sat on the mat. The world went on without comment.";

describe("persistThematicHighlights — M35 §C5", () => {
  it("creates one highlight per locatable quote, honey-kind, thematic-origin, offset/length set", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    persistThematicHighlights(db, resourceId, 0, SECTION_TEXT, [
      { name: "indifference", quotes: ["The world went on without comment."] },
    ]);

    const highlights = listHighlightsForResource(db, resourceId);
    expect(highlights).toHaveLength(1);
    const [h] = highlights;
    expect(h.exact).toBe("The world went on without comment.");
    expect(h.kind).toBe("honey");
    expect(h.origin).toBe("thematic");
    expect(h.spineIndex).toBe(0);
    db.close();
  });

  it("groups a multi-quote theme into one thread with the extra quotes as thread_anchors", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    persistThematicHighlights(db, resourceId, 0, SECTION_TEXT, [
      { name: "indifference", quotes: ["The cat sat on the mat", "The world went on without comment."] },
    ]);

    const highlights = listHighlightsForResource(db, resourceId);
    expect(highlights).toHaveLength(2);
    const primary = highlights.find((h) => h.exact === "The cat sat on the mat")!;
    const secondary = highlights.find((h) => h.exact === "The world went on without comment.")!;

    const thread = getThreadByHighlightId(db, primary.id);
    expect(thread).toBeDefined();
    const anchors = listThreadAnchors(db, thread!.id);
    expect(anchors.map((a) => a.highlightId).sort()).toEqual([primary.id, secondary.id].sort());
    db.close();
  });

  it("gives each theme its own thread — two themes never share one annotation", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    persistThematicHighlights(db, resourceId, 0, SECTION_TEXT, [
      { name: "indifference", quotes: ["The world went on without comment."] },
      { name: "domesticity", quotes: ["The cat sat on the mat"] },
    ]);

    const highlights = listHighlightsForResource(db, resourceId);
    expect(highlights).toHaveLength(2);
    const threadIds = highlights.map((h) => getThreadByHighlightId(db, h.id)?.id);
    expect(new Set(threadIds).size).toBe(2);
    db.close();
  });

  it("never trusts an unlocatable quote — re-locates rather than assuming §C3 already checked", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    persistThematicHighlights(db, resourceId, 0, SECTION_TEXT, [
      { name: "invented", quotes: ["a sentence that was never written"] },
    ]);

    expect(listHighlightsForResource(db, resourceId)).toEqual([]);
    db.close();
  });

  it("is idempotent — re-running against the same text reuses the existing highlight rather than duplicating", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);
    const theme = [{ name: "indifference", quotes: ["The world went on without comment."] }];

    persistThematicHighlights(db, resourceId, 0, SECTION_TEXT, theme);
    persistThematicHighlights(db, resourceId, 0, SECTION_TEXT, theme);

    expect(listHighlightsForResource(db, resourceId)).toHaveLength(1);
    db.close();
  });

  it("a highlight already anchoring one theme is left alone if a second theme proposes the same quote", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    persistThematicHighlights(db, resourceId, 0, SECTION_TEXT, [
      { name: "indifference", quotes: ["The world went on without comment."] },
    ]);
    // A second, unrelated theme reuses the exact same passage as its own
    // (only) evidence — must not crash on the thread_anchors primary key,
    // and must not create a second annotation on the same highlight.
    persistThematicHighlights(db, resourceId, 0, SECTION_TEXT, [
      { name: "futility", quotes: ["The world went on without comment."] },
    ]);

    const highlights = listHighlightsForResource(db, resourceId);
    expect(highlights).toHaveLength(1);
    db.close();
  });
});
