import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDb } from "../db.js";
import { setReadingPosition } from "../library/store.js";
import { putChapterDigest } from "../digest/store.js";
import { putThematicDigest } from "../digest/thematicStore.js";
import { setShowThematicQuotes } from "../digest/thematicQuoteVisibility.js";
import { createHighlight } from "./highlights.js";
import { createThread, createMessage } from "./threads.js";
import { setTagsForHighlight } from "./tags.js";
import { setThemesForHighlight } from "./highlightThemes.js";
import { buildScanData } from "./scan.js";

type Db = ReturnType<typeof createDb>;

function seedResource(db: Db, id: string, metadata: Record<string, unknown> = {}) {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', NULL, 'epub', '/tmp/x.epub', @metadata, @now)`,
  ).run({ id, metadata: JSON.stringify(metadata), now: new Date().toISOString() });
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

  it("computes chapter tick positions from spine section lengths, numbered 1-based", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "a".repeat(30));
    seedSection(db, "res-1", 1, "b".repeat(70));

    const data = buildScanData(db, "res-1")!;
    expect(data.chapters).toEqual([
      { spineIndex: 0, chapterNumber: 1, title: null, startPercent: 0, lengthPercent: 0.3 },
      { spineIndex: 1, chapterNumber: 2, title: null, startPercent: 0.3, lengthPercent: 0.7 },
    ]);
  });

  it("resolves a chapter's title from the resource's NCX-derived metadata by spine index", () => {
    seedResource(db, "res-1", { chapterTitles: { "1": "The Awakening" } });
    seedSection(db, "res-1", 0, "a".repeat(30));
    seedSection(db, "res-1", 1, "b".repeat(70));

    const data = buildScanData(db, "res-1")!;
    expect(data.chapters[0]!.title).toBeNull();
    expect(data.chapters[1]!.title).toBe("The Awakening");
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

  it("carries a highlight's tagged themes separately from its reader-authored tags", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "some section text");
    const highlight = createHighlight(db, {
      resourceId: "res-1",
      exact: "some",
      prefix: "",
      suffix: " section",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    setTagsForHighlight(db, highlight.id, ["my-tag"]);
    setThemesForHighlight(db, highlight.id, ["autonomy"]);

    const data = buildScanData(db, "res-1")!;
    expect(data.highlights[0].tags).toEqual(["my-tag"]);
    expect(data.highlights[0].themes).toEqual(["autonomy"]);
  });

  it("book layer falls back to hasDigest=false with no chapters when nothing's been digested", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "chapter text");

    const data = buildScanData(db, "res-1")!;
    expect(data.book.hasDigest).toBe(false);
    expect(data.book.themeVocabulary).toEqual([]);
    expect(data.book.chapters[0]).toEqual({ spineIndex: 0, hasThematic: false, themes: [] });
  });

  it("book layer surfaces a chapter's thematic themes only once the bookmark has reached it", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "chapter zero text");
    seedSection(db, "res-1", 1, "chapter one text");
    putChapterDigest(db, {
      resourceId: "res-1",
      spineIndex: 0,
      summary: "s",
      themes: [],
      characters: [],
      title: null,
      sourceHash: "h",
    });
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: [{ name: "autonomy", quotes: ["q"] }],
      questions: [],
    });
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 1,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: [{ name: "consequence", quotes: ["q"] }],
      questions: [],
    });

    // No bookmark at all — nothing revealed yet, same conservative default
    // as the digest page's chapter gating.
    let data = buildScanData(db, "res-1")!;
    expect(data.book.hasDigest).toBe(true);
    expect(data.book.chapters).toEqual([
      { spineIndex: 0, hasThematic: false, themes: [] },
      { spineIndex: 1, hasThematic: false, themes: [] },
    ]);
    expect(data.book.themeVocabulary).toEqual([]);

    // Bookmark at chapter 0 — chapter 0 revealed, chapter 1 still gated.
    setReadingPosition(db, "res-1", "epubcfi(/6/4!/4/2)", 0, 0);
    data = buildScanData(db, "res-1")!;
    expect(data.book.chapters[0]).toEqual({ spineIndex: 0, hasThematic: true, themes: ["autonomy"] });
    expect(data.book.chapters[1]).toEqual({ spineIndex: 1, hasThematic: false, themes: [] });
    expect(data.book.themeVocabulary).toEqual(["autonomy"]);
  });

  describe("M35 §C6/§C7: thematic-origin highlights", () => {
    it("excludes a thematic-origin highlight from totalHighlights and the Mine layer by default", () => {
      seedResource(db, "res-1");
      seedSection(db, "res-1", 0, "chapter text");
      createHighlight(db, {
        resourceId: "res-1",
        exact: "reader's own mark",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
      });
      createHighlight(db, {
        resourceId: "res-1",
        exact: "machine-proposed evidence",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/8!/4/2)",
        spineIndex: 0,
        kind: "honey",
        origin: "thematic",
      });

      const data = buildScanData(db, "res-1")!;
      expect(data.totalHighlights).toBe(1);
      expect(data.highlights.map((h) => h.exact)).toEqual(["reader's own mark"]);
    });

    it("paints the thematic-origin highlight once the toggle is on, but totalHighlights still excludes it", () => {
      seedResource(db, "res-1");
      seedSection(db, "res-1", 0, "chapter text");
      createHighlight(db, {
        resourceId: "res-1",
        exact: "reader's own mark",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/4!/4/2)",
        spineIndex: 0,
        kind: "rose",
      });
      createHighlight(db, {
        resourceId: "res-1",
        exact: "machine-proposed evidence",
        prefix: "",
        suffix: "",
        cfi: "epubcfi(/6/8!/4/2)",
        spineIndex: 0,
        kind: "honey",
        origin: "thematic",
      });
      setShowThematicQuotes(db, "res-1", true);

      const data = buildScanData(db, "res-1")!;
      expect(data.totalHighlights).toBe(1);
      expect(data.highlights.map((h) => h.exact).sort()).toEqual(
        ["machine-proposed evidence", "reader's own mark"].sort(),
      );
    });
  });
});
