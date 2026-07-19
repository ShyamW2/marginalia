import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDb } from "../db.js";
import {
  listDistinctTagsForResource,
  listTagsByHighlightId,
  listTagsForHighlight,
  setTagsForHighlight,
} from "./tags.js";

type Db = ReturnType<typeof createDb>;

function seedResource(db: Db, resourceId: string) {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@resourceId, 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ resourceId, now: new Date().toISOString() });
}

function seedHighlight(db: Db, resourceId: string, highlightId: string) {
  db.prepare(
    `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
     VALUES (@highlightId, @resourceId, 'q', '', '', 'epubcfi(/6/4!/4/2)', 0, @now)`,
  ).run({ highlightId, resourceId, now: new Date().toISOString() });
}

describe("highlight tags store", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
    seedResource(db, "res-1");
    seedHighlight(db, "res-1", "h-1");
    seedHighlight(db, "res-1", "h-2");
  });

  afterEach(() => {
    db.close();
  });

  it("starts with no tags", () => {
    expect(listTagsForHighlight(db, "h-1")).toEqual([]);
  });

  it("sets and lists tags in sorted order", () => {
    setTagsForHighlight(db, "h-1", ["zeta", "alpha"]);
    expect(listTagsForHighlight(db, "h-1")).toEqual(["alpha", "zeta"]);
  });

  it("replaces the full tag set rather than appending", () => {
    setTagsForHighlight(db, "h-1", ["alpha", "beta"]);
    setTagsForHighlight(db, "h-1", ["gamma"]);
    expect(listTagsForHighlight(db, "h-1")).toEqual(["gamma"]);
  });

  it("dedupes and drops blank tags", () => {
    setTagsForHighlight(db, "h-1", ["alpha", "alpha", "  ", ""]);
    expect(listTagsForHighlight(db, "h-1")).toEqual(["alpha"]);
  });

  it("lists distinct tags across a resource's highlights", () => {
    setTagsForHighlight(db, "h-1", ["alpha", "shared"]);
    setTagsForHighlight(db, "h-2", ["beta", "shared"]);
    expect(listDistinctTagsForResource(db, "res-1")).toEqual(["alpha", "beta", "shared"]);
  });

  it("bulk-loads tags by highlight id in one query", () => {
    setTagsForHighlight(db, "h-1", ["alpha"]);
    setTagsForHighlight(db, "h-2", ["beta"]);
    const map = listTagsByHighlightId(db, "res-1");
    expect(map.get("h-1")).toEqual(["alpha"]);
    expect(map.get("h-2")).toEqual(["beta"]);
  });
});
