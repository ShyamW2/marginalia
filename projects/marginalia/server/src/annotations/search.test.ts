import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { findAnchorInText } from "@marginalia/shared";
import { createDb } from "../db.js";
import { createHighlight, setHighlightNote } from "./highlights.js";
import { createThread, createMessage } from "./threads.js";
import { searchResource } from "./search.js";

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
  ).run({ resourceId, spineIndex, href: `ch${spineIndex}.xhtml`, text });
}

describe("searchResource", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("returns undefined for a resource that doesn't exist", () => {
    expect(searchResource(db, "missing", "anything")).toBeUndefined();
  });

  it("returns an empty array for a blank query rather than every section", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "some text");
    expect(searchResource(db, "res-1", "   ")).toEqual([]);
  });

  it("finds every occurrence of a book-text phrase, case-insensitively, ordered by position", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "The Target appears here. Later the target appears again.");
    seedSection(db, "res-1", 1, "And a third target sits in the next section.");

    const hits = searchResource(db, "res-1", "target")!;
    expect(hits.map((h) => h.source)).toEqual(["text", "text", "text"]);
    expect(hits.map((h) => h.spineIndex)).toEqual([0, 0, 1]);
    expect(hits[0]!.offset).toBeLessThan(hits[1]!.offset);
    expect(hits.every((h) => h.highlightId === null)).toBe(true);
  });

  it("every text hit's anchor round-trips through findAnchorInText to the same offset", () => {
    seedResource(db, "res-1");
    const text = "some prefix words then the TARGET phrase then some suffix words after it";
    seedSection(db, "res-1", 0, text);

    const hits = searchResource(db, "res-1", "TARGET")!;
    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    const match = findAnchorInText(text, hit.anchor);
    expect(match).not.toBeNull();
    expect(match!.start).toBe(hit.offset);
  });

  it("a query matching both book text and a highlight's own quote returns both, correctly typed", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "prefix words TARGET more words as suffix context here");

    const highlight = createHighlight(db, {
      resourceId: "res-1",
      exact: "TARGET",
      prefix: "prefix words ",
      suffix: " more words",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "honey",
    });

    const hits = searchResource(db, "res-1", "target")!;
    const bySource = new Map(hits.map((h) => [h.source, h]));
    expect(bySource.has("text")).toBe(true);
    expect(bySource.has("highlight")).toBe(true);
    expect(bySource.get("highlight")!.highlightId).toBe(highlight.id);
    expect(bySource.get("text")!.highlightId).toBeNull();
  });

  it("finds a phrase inside a highlight's note, anchored to the highlight's own position", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "the passage that got highlighted, nothing else notable");

    const highlight = createHighlight(db, {
      resourceId: "res-1",
      exact: "the passage that got highlighted",
      prefix: "",
      suffix: ", nothing",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    setHighlightNote(db, highlight.id, "this reminds me of a recurring motif");

    const hits = searchResource(db, "res-1", "recurring motif")!;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.source).toBe("note");
    expect(hits[0]!.highlightId).toBe(highlight.id);
    expect(hits[0]!.snippet).toContain("recurring motif");
    // Anchored to the highlight's own quote, not to anything in the note.
    expect(hits[0]!.anchor.exact).toBe("the passage that got highlighted");
  });

  it("finds a phrase in any thread message, not just the first line (the M9 gap this milestone closes)", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "a highlighted passage sits here, plus filler text");

    const highlight = createHighlight(db, {
      resourceId: "res-1",
      exact: "a highlighted passage",
      prefix: "",
      suffix: " sits here",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    const thread = createThread(db, highlight.id);
    createMessage(db, thread.id, "user", "why does this matter?");
    createMessage(db, thread.id, "assistant", "First point is unrelated.");
    createMessage(db, thread.id, "assistant", "The third message buries the deep insight here.");

    const hits = searchResource(db, "res-1", "deep insight")!;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.source).toBe("thread");
    expect(hits[0]!.highlightId).toBe(highlight.id);
    expect(hits[0]!.snippet).toContain("deep insight");
  });

  it("skips a highlight whose own quote can no longer be found, rather than throwing", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "the section text has since changed completely");

    const highlight = createHighlight(db, {
      resourceId: "res-1",
      exact: "no longer present",
      prefix: "gone ",
      suffix: " context",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    setHighlightNote(db, highlight.id, "still has a matching note though");

    expect(() => searchResource(db, "res-1", "matching note")).not.toThrow();
    expect(searchResource(db, "res-1", "matching note")).toEqual([]);
  });

  it("reads the book's sections at most once per search, however many highlights it has (M24 TASKS.md B)", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "one target here, and a target highlight quote too");
    for (let i = 0; i < 25; i++) {
      createHighlight(db, {
        resourceId: "res-1",
        exact: "target",
        prefix: "and a ",
        suffix: " highlight",
        cfi: `epubcfi(/6/4!/4/${i})`,
        spineIndex: 0,
        kind: "rose",
      });
    }

    let resourceTextReads = 0;
    const originalPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      if (sql.includes("FROM resource_text")) resourceTextReads++;
      return originalPrepare(sql);
    }) as typeof db.prepare;

    searchResource(db, "res-1", "target");
    expect(resourceTextReads).toBe(1);
  });

  // M24.1 C: "decide the matching rule; substring is why 'the' blankets a
  // paragraph".
  it("matches whole words by default, so 'the' stops matching other/there/father", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "there, the other father said the truth");

    const hits = searchResource(db, "res-1", "the")!;
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.offset)).toEqual([7, 29]);
  });

  it("still matches substrings when asked to explicitly", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "there, the other father said the truth");

    expect(searchResource(db, "res-1", "the", "substring")!).toHaveLength(5);
  });

  it("applies the same rule to notes and threads as to book text", () => {
    seedResource(db, "res-1");
    seedSection(db, "res-1", 0, "a quoted passage sits here in the book");

    const highlight = createHighlight(db, {
      resourceId: "res-1",
      exact: "quoted passage",
      prefix: "a ",
      suffix: " sits",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    setHighlightNote(db, highlight.id, "a note about fathers");
    const thread = createThread(db, highlight.id);
    createMessage(db, thread.id, "user", "why fathers?");

    // "father" is inside "fathers" — a substring match, not a word one.
    expect(searchResource(db, "res-1", "father")!).toEqual([]);
    const substringHits = searchResource(db, "res-1", "father", "substring")!;
    expect(substringHits.map((h) => h.source).sort()).toEqual(["note", "thread"]);
  });
});
