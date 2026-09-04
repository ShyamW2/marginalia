import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  getPdfPageSections,
  getReadingPosition,
  getResourceById,
  listResourceSummaries,
  setPdfPageSections,
  setReadingPosition,
  setResourceKind,
} from "./store.js";
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

// M39 §D1/§D4 (PDF.md §5/§6, settled decision 18).
describe("resources.kind / text_layer", () => {
  it("backfills every pre-existing row (every EPUB) to kind='prose', text_layer=true", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    const resource = getResourceById(db, resourceId);
    expect(resource?.kind).toBe("prose");
    expect(resource?.textLayer).toBe(true);
    db.close();
  });

  it("setResourceKind changes kind in both directions without touching text_layer", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    setResourceKind(db, resourceId, "document");
    expect(getResourceById(db, resourceId)?.kind).toBe("document");

    setResourceKind(db, resourceId, "prose");
    expect(getResourceById(db, resourceId)?.kind).toBe("prose");
    expect(getResourceById(db, resourceId)?.textLayer).toBe(true);
    db.close();
  });
});

// M40 §C9 (migration 42): the reading mode is per-book state, so it lives
// alongside the position it's saved next to rather than the global settings
// table — and a plain position save (the common case, every scroll/turn)
// must not silently reset it back to "paginated".
describe("setReadingPosition — flow", () => {
  it("defaults a brand-new row to 'paginated' when no flow is given", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    setReadingPosition(db, resourceId, "loc-1", 0, 0);
    expect(getReadingPosition(db, resourceId)?.flow).toBe("paginated");
    db.close();
  });

  it("a plain position save leaves a previously-set flow untouched", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    setReadingPosition(db, resourceId, "loc-1", 0, 0, "scrolled");
    expect(getReadingPosition(db, resourceId)?.flow).toBe("scrolled");

    setReadingPosition(db, resourceId, "loc-2", 1, 10);
    expect(getReadingPosition(db, resourceId)?.flow).toBe("scrolled");
    expect(getReadingPosition(db, resourceId)?.location).toBe("loc-2");
    db.close();
  });

  it("an explicit flow switches the saved mode on an existing row", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    setReadingPosition(db, resourceId, "loc-1", 0, 0, "paginated");
    setReadingPosition(db, resourceId, "loc-1", 0, 0, "scrolled");
    expect(getReadingPosition(db, resourceId)?.flow).toBe("scrolled");
    db.close();
  });
});

// M41 §A1 (migration 43): same shape as `flow` above — a plain position
// save must not silently reset a book's reflow/native choice back to
// "reflow".
describe("setReadingPosition — renderMode", () => {
  it("defaults a brand-new row to 'reflow' when no renderMode is given", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    setReadingPosition(db, resourceId, "loc-1", 0, 0);
    expect(getReadingPosition(db, resourceId)?.renderMode).toBe("reflow");
    db.close();
  });

  it("a plain position save leaves a previously-set renderMode untouched", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    setReadingPosition(db, resourceId, "loc-1", 0, 0, undefined, "native");
    expect(getReadingPosition(db, resourceId)?.renderMode).toBe("native");

    setReadingPosition(db, resourceId, "loc-2", 1, 10);
    expect(getReadingPosition(db, resourceId)?.renderMode).toBe("native");
    expect(getReadingPosition(db, resourceId)?.location).toBe("loc-2");
    db.close();
  });

  it("an explicit renderMode switches the saved mode on an existing row", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    setReadingPosition(db, resourceId, "loc-1", 0, 0, undefined, "reflow");
    setReadingPosition(db, resourceId, "loc-1", 0, 0, undefined, "native");
    expect(getReadingPosition(db, resourceId)?.renderMode).toBe("native");
    db.close();
  });
});

// M41 §A2 (migration 44): page->section is written once, at import, and
// read back exactly — no aggregation or reordering in either direction.
describe("pdf_page_sections", () => {
  it("round-trips a page->section table indexed by page", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    setPdfPageSections(db, resourceId, [0, 0, 1, 1, 1, 2]);
    expect(getPdfPageSections(db, resourceId)).toEqual([0, 0, 1, 1, 1, 2]);
    db.close();
  });

  it("returns an empty array for a resource with no page->section rows", () => {
    const db = createDb(":memory:");
    const resourceId = seedResource(db);

    expect(getPdfPageSections(db, resourceId)).toEqual([]);
    db.close();
  });
});
