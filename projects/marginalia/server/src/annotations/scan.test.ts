import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDb } from "../db.js";
import { createHighlight } from "./highlights.js";
import { createThread, createMessage } from "./threads.js";
import { setTagsForHighlight } from "./tags.js";
import { buildScanData } from "./scan.js";

type Db = ReturnType<typeof createDb>;

function seedResource(db: Db, id: string) {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ id, now: new Date().toISOString() });
}

function seedSection(db: Db, resourceId: string, spineIndex: number, text: string) {
  db.prepare(
    `INSERT INTO resource_text (resource_id, spine_index, href, text)
     VALUES (@resourceId, @spineIndex, @href, @text)`,
  ).run({ resourceId, spineIndex, href: `chapter-${spineIndex}.xhtml`, text });
}

describe("buildScanData", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("returns undefined for a resource that doesn't exist", () => {
    expect(buildScanData(db, "missing")).toBeUndefined();
  });

  it("computes chapter tick positions from spine section lengths", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "a".repeat(30));
    seedSection(db, "res-1", 1, "b".repeat(70));

    const data = buildScanData(db, "res-1")!;
    expect(data.chapters).toEqual([
      { spineIndex: 0, label: "chapter-0", startPercent: 0, lengthPercent: 0.3 },
      { spineIndex: 1, label: "chapter-1", startPercent: 0.3, lengthPercent: 0.7 },
    ]);
  });

  it("assembles a highlight's kind, importance, tags, position, and thread preview", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "prefix TARGET suffix, more text to pad out the section.");

    const highlight = createHighlight(db, {
      resourceId: "res-1",
      exact: "TARGET",
      prefix: "prefix ",
      suffix: " suffix",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "honey",
    });
    setTagsForHighlight(db, highlight.id, ["motif", "villain"]);

    const thread = createThread(db, highlight.id);
    createMessage(db, thread.id, "user", "Their question: why?");
    createMessage(db, thread.id, "assistant", "Because of the theme of transformation.\nMore detail.");

    const data = buildScanData(db, "res-1")!;
    expect(data.totalHighlights).toBe(1);
    const scanHighlight = data.highlights[0];
    expect(scanHighlight.kind).toBe("honey");
    expect(scanHighlight.tags).toEqual(["motif", "villain"]);
    expect(scanHighlight.positionPercent).toBeGreaterThan(0);
    expect(scanHighlight.threadId).toBe(thread.id);
    expect(scanHighlight.hasAnswer).toBe(true);
    expect(scanHighlight.threadMessageCount).toBe(2);
    expect(scanHighlight.threadFirstLine).toBe("Because of the theme of transformation.");
  });

  it("a highlight whose text can no longer be found gets a null positionPercent, not a thrown error", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "the section text has since changed completely");

    createHighlight(db, {
      resourceId: "res-1",
      exact: "no longer present",
      prefix: "gone ",
      suffix: " context",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });

    const data = buildScanData(db, "res-1")!;
    expect(data.highlights[0].positionPercent).toBeNull();
  });
});
