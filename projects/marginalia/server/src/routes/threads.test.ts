import { describe, expect, it } from "vitest";
import type { Highlight, Resource } from "@marginalia/shared";
import { createDb } from "../db.js";
import { resolveContext } from "./threads.js";
import { setReadingPosition } from "../library/store.js";
import { putChapterDigest, putBookDigest } from "../digest/store.js";
import { putThematicDigest, putBrief, hashBrief } from "../digest/thematicStore.js";
import { replaceBookThemes, resolveCanonicalThemes } from "../digest/canonicalThemes.js";
import { setContextLadderDepth } from "../digest/ladder.js";
import { setLookahead } from "../digest/lookahead.js";
import type { LLMProvider } from "../llm/provider.js";

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "res-1",
    title: "Test Book",
    author: "Test Author",
    format: "epub",
    kind: "prose",
    textLayer: true,
    metadata: {},
    importedAt: new Date().toISOString(),
    ...overrides,
  };
}

function seedResource(db: ReturnType<typeof createDb>, resource: Resource): void {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, @title, @author, @format, 'x.epub', @metadata, @importedAt)`,
  ).run({ ...resource, metadata: JSON.stringify(resource.metadata) });
}

function seedSections(db: ReturnType<typeof createDb>, resourceId: string, count: number): void {
  const insert = db.prepare(
    "INSERT INTO resource_text (resource_id, spine_index, href, text) VALUES (?, ?, ?, ?)",
  );
  for (let i = 0; i < count; i++) {
    insert.run(resourceId, i, `section-${i}.xhtml`, `Chapter ${i} full text.`);
  }
}

function makeHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "hl-1",
    resourceId: "res-1",
    exact: "quoted text",
    prefix: "",
    suffix: "",
    cfi: "epubcfi(/6/4!/4/2)",
    spineIndex: 1,
    kind: "rose",
    origin: "reader",
    importance: 0,
    note: "",
    panelDx: 0,
    panelDy: 0,
    panelWidth: null,
    panelHeight: null,
    definition: "",
    definitionSource: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const fakeProvider: LLMProvider = {
  id: "anthropic",
  capabilities: () => ({ contextTokens: 1_000_000, supportsCaching: true }),
  async *stream() {},
  async extract() {
    return {} as never;
  },
};

function joinedText(bookContext: { text: string }[]): string {
  return bookContext.map((b) => b.text).join("\n\n");
}

describe("resolveContext — M34 §B masking", () => {
  it("Digest rung: masks chapter summaries and thematic analysis past the bookmark", () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    seedSections(db, resource.id, 10);
    for (let i = 0; i < 10; i++) {
      putChapterDigest(db, {
        resourceId: resource.id,
        spineIndex: i,
        summary: `Summary of chapter ${i}`,
        themes: [],
        characters: [],
        title: null,
        sourceHash: "h",
      });
      putThematicDigest(db, {
        resourceId: resource.id,
        spineIndex: i,
        briefHash: hashBrief(""),
        briefText: "",
        analysis: `Thematic analysis of chapter ${i}`,
        themes: [],
        questions: [],
      });
    }
    putBookDigest(db, { resourceId: resource.id, synopsis: "s", cast: [], narratorGender: "unknown", themes: [] });
    setContextLadderDepth(db, resource.id, "digest");
    setReadingPosition(db, resource.id, "loc", 3);

    const highlight = makeHighlight({ spineIndex: 1 });
    const resolved = resolveContext(db, fakeProvider, resource, highlight);

    const text = joinedText(resolved.bookContext);
    // §C1: chapter summaries stay whole for every visible chapter.
    expect(text).toContain("Summary of chapter 3");
    expect(text).not.toContain("Summary of chapter 4");
    // §C2/§C3: no distillation has run, so the thematic essays fall back to
    // current (1) + previous (0) only — never "every visible chapter".
    expect(text).toContain("Thematic analysis of chapter 1");
    expect(text).toContain("Thematic analysis of chapter 0");
    expect(text).not.toContain("Thematic analysis of chapter 2");
    expect(text).not.toContain("Thematic analysis of chapter 3");
    // Still masked regardless: chapter 4 sits past the bookmark, so it's
    // never even a candidate for §C's selection.
    expect(text).not.toContain("Thematic analysis of chapter 4");
    db.close();
  });

  it("Digest rung: §C narrows thematic essays to ranked chapters, and the mask still wins over rank", () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    seedSections(db, resource.id, 10);
    for (let i = 0; i < 10; i++) {
      putThematicDigest(db, {
        resourceId: resource.id,
        spineIndex: i,
        briefHash: hashBrief(""),
        briefText: "",
        // Chapter 4 is the best thematic match for the highlight (chapter 1)
        // but sits past the bookmark — the mask must exclude it regardless
        // of how well it would otherwise rank.
        analysis: `Thematic analysis of chapter ${i}`,
        themes:
          i === 1 || i === 4
            ? [{ name: "fate a", quotes: ["q"] }, { name: "fate b", quotes: ["q"] }]
            : i === 2
              ? [{ name: "fate a", quotes: ["q"] }]
              : [],
        questions: [],
      });
    }
    const [fate] = resolveCanonicalThemes(db, ["Fate"]);
    replaceBookThemes(db, resource.id, [fate], new Map([[fate.id, ["fate a", "fate b"]]]));
    setContextLadderDepth(db, resource.id, "digest");
    setReadingPosition(db, resource.id, "loc", 3); // chapter 4 is past this

    const highlight = makeHighlight({ spineIndex: 1 });
    const resolved = resolveContext(db, fakeProvider, resource, highlight);

    const text = joinedText(resolved.bookContext);
    // Current (1) unconditional, chapter 2 ranks (shares "fate a"), chapter 0
    // is the unconditional "previous" even with no thematic overlap.
    expect(text).toContain("Thematic analysis of chapter 1");
    expect(text).toContain("Thematic analysis of chapter 2");
    expect(text).toContain("Thematic analysis of chapter 0");
    // Chapter 4 would rank highest of all (identical theme vector to the
    // highlight chapter) but is masked out before selection ever sees it.
    expect(text).not.toContain("Thematic analysis of chapter 4");
    db.close();
  });

  it("Digest rung: always covers the highlight's own chapter, even past a stale bookmark", () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    seedSections(db, resource.id, 10);
    putChapterDigest(db, {
      resourceId: resource.id,
      spineIndex: 7,
      summary: "Summary of chapter 7",
      themes: [],
      characters: [],
      title: null,
      sourceHash: "h",
    });
    setContextLadderDepth(db, resource.id, "digest");
    setReadingPosition(db, resource.id, "loc", 2); // bookmark behind the highlight

    const highlight = makeHighlight({ spineIndex: 7 });
    const resolved = resolveContext(db, fakeProvider, resource, highlight);

    expect(joinedText(resolved.bookContext)).toContain("Summary of chapter 7");
    db.close();
  });

  it("Full rung: drops sections past the bookmark", () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    seedSections(db, resource.id, 10);
    setContextLadderDepth(db, resource.id, "full");
    setReadingPosition(db, resource.id, "loc", 3);

    const highlight = makeHighlight({ spineIndex: 1 });
    const resolved = resolveContext(db, fakeProvider, resource, highlight);

    const text = joinedText(resolved.bookContext);
    expect(text).toContain("--- [section 3] ---");
    expect(text).not.toContain("--- [section 4] ---");
    db.close();
  });

  it("lookahead on: Full rung ships every section, ignoring the bookmark", () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    seedSections(db, resource.id, 10);
    setContextLadderDepth(db, resource.id, "full");
    setReadingPosition(db, resource.id, "loc", 3);
    setLookahead(db, resource.id, true);

    const highlight = makeHighlight({ spineIndex: 1 });
    const resolved = resolveContext(db, fakeProvider, resource, highlight);

    const text = joinedText(resolved.bookContext);
    expect(text).toContain("--- [section 9] ---");
    db.close();
  });

  it("brief-filtered thematic chapters stay excluded when stale, independent of the mask", () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    seedSections(db, resource.id, 5);
    putChapterDigest(db, {
      resourceId: resource.id,
      spineIndex: 0,
      summary: "s",
      themes: [],
      characters: [],
      title: null,
      sourceHash: "h",
    });
    putBrief(db, resource.id, "current brief");
    putThematicDigest(db, {
      resourceId: resource.id,
      spineIndex: 0,
      briefHash: "stale-hash",
      briefText: "old brief",
      analysis: "Stale analysis",
      themes: [],
      questions: [],
    });
    setContextLadderDepth(db, resource.id, "digest");
    setReadingPosition(db, resource.id, "loc", 4);

    const highlight = makeHighlight({ spineIndex: 0 });
    const resolved = resolveContext(db, fakeProvider, resource, highlight);

    expect(joinedText(resolved.bookContext)).not.toContain("Stale analysis");
    db.close();
  });
});

describe("resolveContext — M34 §D transparency", () => {
  it("Digest rung: reports thematic chapters separately from plot-digest chapters, and masked reflects lookahead", () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    seedSections(db, resource.id, 5);
    putChapterDigest(db, {
      resourceId: resource.id,
      spineIndex: 1,
      summary: "s",
      themes: [],
      characters: [],
      title: null,
      sourceHash: "h",
    });
    putThematicDigest(db, {
      resourceId: resource.id,
      spineIndex: 1,
      briefHash: hashBrief(""),
      briefText: "",
      analysis: "Thematic analysis of chapter 1",
      themes: [],
      questions: [],
    });
    setContextLadderDepth(db, resource.id, "digest");
    setReadingPosition(db, resource.id, "loc", 4);

    const highlight = makeHighlight({ spineIndex: 1 });
    const masked = resolveContext(db, fakeProvider, resource, highlight);
    expect(masked.contextChapters).toEqual([1]);
    expect(masked.contextThematicChapters).toEqual([1]);
    expect(masked.contextMasked).toBe(true);

    setLookahead(db, resource.id, true);
    const unmasked = resolveContext(db, fakeProvider, resource, highlight);
    expect(unmasked.contextMasked).toBe(false);
    db.close();
  });

  it("Off and Full rungs: no thematic chapters, but masked still reflects lookahead", () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    seedSections(db, resource.id, 5);
    setContextLadderDepth(db, resource.id, "off");
    const highlight = makeHighlight({ spineIndex: 1 });

    const off = resolveContext(db, fakeProvider, resource, highlight);
    expect(off.contextThematicChapters).toEqual([]);
    expect(off.contextMasked).toBe(true);

    setContextLadderDepth(db, resource.id, "full");
    setLookahead(db, resource.id, true);
    const full = resolveContext(db, fakeProvider, resource, highlight);
    expect(full.contextThematicChapters).toEqual([]);
    expect(full.contextMasked).toBe(false);
    db.close();
  });
});
