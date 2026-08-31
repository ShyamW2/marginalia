import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { listResourceSummaries } from "./store.js";
import { createHighlight } from "../annotations/highlights.js";
import { createThread } from "../annotations/threads.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1") {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', 'Author', 'epub', '/tmp/x.epub', '{}', @importedAt)`,
  ).run({ id, importedAt: new Date().toISOString() });
  return id;
}

describe("listResourceSummaries — M35 §C6", () => {
  it("highlight_count and thread_count never include a thematic-origin row", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    createHighlight(db, {
      resourceId,
      exact: "reader's own mark",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    const thematic = createHighlight(db, {
      resourceId,
      exact: "machine-proposed evidence",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/8!/4/2)",
      spineIndex: 1,
      kind: "honey",
      origin: "thematic",
    });
    createThread(db, thematic.id);

    const [summary] = listResourceSummaries(db);
    expect(summary.highlightCount).toBe(1);
    expect(summary.threadCount).toBe(0);
    db.close();
  });
});
