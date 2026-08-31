import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { createHighlight, getHighlightById, setHighlightDefinition } from "../annotations/highlights.js";
import { createProviderProfile, setProviderRole } from "../settings/providers.js";
import {
  buildDefineContext,
  clampToTokenBudget,
  defineHighlight,
  deepenDefinition,
  renderDictionarySenses,
} from "./define.js";
import { setReadingPosition } from "../library/store.js";
import { putBookDigest, putChapterDigest, putBookDigestSnapshot } from "../digest/store.js";
import { setLookahead } from "../digest/lookahead.js";
import type { Resource } from "@marginalia/shared";

function seedBook(db: ReturnType<typeof createDb>) {
  const id = "res-define";
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'A Book', 'An Author', 'epub', '/tmp/x.epub', '{}', @importedAt)`,
  ).run({ id, importedAt: new Date().toISOString() });
  const resource: Resource = {
    id,
    title: "A Book",
    author: "An Author",
    format: "epub",
    metadata: {},
    importedAt: new Date().toISOString(),
  };
  return resource;
}

function highlightOn(db: ReturnType<typeof createDb>, resourceId: string, exact: string, spineIndex = 0) {
  return createHighlight(db, {
    resourceId,
    exact,
    prefix: "",
    suffix: "",
    cfi: "epubcfi(/6/4!/4/2)",
    spineIndex,
    kind: "sage",
  });
}

function seedSectionsWithTerm(db: ReturnType<typeof createDb>, resourceId: string, term: string, count: number) {
  const insert = db.prepare(
    "INSERT INTO resource_text (resource_id, spine_index, href, text) VALUES (?, ?, ?, ?)",
  );
  for (let i = 0; i < count; i++) {
    insert.run(resourceId, i, `s${i}.xhtml`, `Chapter ${i} text mentions ${term} once here.`);
  }
}

describe("buildDefineContext — M34 §B3 masking", () => {
  it("omits chapter summaries and occurrence windows past the bookmark", () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    seedSectionsWithTerm(db, resource.id, "timshel", 6);
    for (let i = 0; i < 6; i++) {
      putChapterDigest(db, {
        resourceId: resource.id,
        spineIndex: i,
        summary: `Summary of chapter ${i}`,
        themes: [],
        characters: [],
        title: null,
        sourceHash: "h",
      });
    }
    setReadingPosition(db, resource.id, "loc", 2);
    const highlight = highlightOn(db, resource.id, "timshel", 0);

    const context = buildDefineContext(db, resource, highlight, "timshel");
    expect(context).toContain("Summary of chapter 2");
    expect(context).not.toContain("Summary of chapter 3");
    expect(context).toContain("--- [section 2] ---");
    expect(context).not.toContain("--- [section 3] ---");
    db.close();
  });

  it("uses the spoiler-safe book digest snapshot, not the full one, unless lookahead is on", () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    seedSectionsWithTerm(db, resource.id, "timshel", 3);
    putBookDigest(db, {
      resourceId: resource.id,
      synopsis: "The full, spoiling synopsis.",
      cast: [],
      narratorGender: "unknown",
      themes: [],
    });
    putBookDigestSnapshot(db, {
      resourceId: resource.id,
      upToSpineIndex: 0,
      synopsis: "The spoiler-safe synopsis.",
      cast: [],
      narratorGender: "unknown",
      themes: [],
    });
    setReadingPosition(db, resource.id, "loc", 0);
    const highlight = highlightOn(db, resource.id, "timshel", 0);

    const masked = buildDefineContext(db, resource, highlight, "timshel");
    expect(masked).toContain("The spoiler-safe synopsis.");
    expect(masked).not.toContain("The full, spoiling synopsis.");

    setLookahead(db, resource.id, true);
    const unmasked = buildDefineContext(db, resource, highlight, "timshel");
    expect(unmasked).toContain("The full, spoiling synopsis.");
    db.close();
  });

  it("always includes the highlight's own chapter, even past a stale bookmark", () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    seedSectionsWithTerm(db, resource.id, "timshel", 6);
    setReadingPosition(db, resource.id, "loc", 1);
    const highlight = highlightOn(db, resource.id, "timshel", 4);

    const context = buildDefineContext(db, resource, highlight, "timshel");
    expect(context).toContain("--- [section 4] ---");
    db.close();
  });
});

describe("clampToTokenBudget", () => {
  it("leaves a definition that is already short alone", () => {
    expect(clampToTokenBudget("  a burrowing mammal  ", 90)).toBe("a burrowing mammal");
  });

  it("cuts at a sentence boundary rather than mid-word", () => {
    const text = "First sentence here. Second sentence runs on and on and on and on.";
    // ~5 tokens of budget: enough for the first sentence, not the second.
    expect(clampToTokenBudget(text, 6)).toBe("First sentence here.");
  });

  it("falls back to a word boundary with an ellipsis when there is no sentence to cut at", () => {
    const clamped = clampToTokenBudget("one two three four five six seven eight nine", 4);
    expect(clamped.endsWith("…")).toBe(true);
    // Never mid-word: everything before the ellipsis is whole words.
    expect(clamped.slice(0, -1).trim().split(" ").every((w) => w.length > 0)).toBe(true);
    expect("one two three four five six seven eight nine").toContain(clamped.slice(0, -1).trim());
  });
});

describe("renderDictionarySenses", () => {
  it("renders a single sense as a plain sentence, not a numbered list of one", () => {
    expect(renderDictionarySenses([{ partOfSpeech: "noun", definition: "an edge tool" }])).toBe(
      "(noun) an edge tool",
    );
  });

  it("numbers multiple senses", () => {
    expect(
      renderDictionarySenses([
        { partOfSpeech: "noun", definition: "a score in baseball" },
        { partOfSpeech: "verb", definition: "move fast" },
      ]),
    ).toBe("1. (noun) a score in baseball\n2. (verb) move fast");
  });
});

describe("defineHighlight", () => {
  it("answers a common word from the bundled dictionary with no provider configured", async () => {
    // No provider profile is ever assigned in this in-memory DB — this is
    // M30 C's headline acceptance case, that Define works fully offline.
    const db = createDb(":memory:");
    const resource = seedBook(db);
    const highlight = highlightOn(db, resource.id, "serendipity");

    const definition = await defineHighlight(db, resource, highlight);

    expect(definition.source).toBe("dictionary");
    expect(definition.attribution).toBe("WordNet 3.1");
    expect(definition.definition).toContain("good luck");
    db.close();
  });

  it("shows the headword it actually resolved to when morphology moved it", async () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    const definition = await defineHighlight(db, resource, highlightOn(db, resource.id, "axes"));
    // Defining a word the reader did not select is only honest if the
    // substitution is visible.
    expect(definition.headword).toBe("ax");
    db.close();
  });

  it("refuses a paragraph rather than defining it badly", async () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    const paragraph =
      "It is a truth universally acknowledged, that a single man in possession " +
      "of a good fortune, must be in want of a wife.";
    const definition = await defineHighlight(db, resource, highlightOn(db, resource.id, paragraph));

    expect(definition.reason).toBe("not_a_term");
    expect(definition.definition).toBe("");
    db.close();
  });

  it("reports no_provider — not an error — on a dictionary miss with nothing configured", async () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    // A term no dictionary has, on a book with no digest and no provider:
    // M30 C's third acceptance case, the designed empty state.
    const definition = await defineHighlight(
      db,
      resource,
      highlightOn(db, resource.id, "zharkovian"),
    );

    expect(definition.source).toBe("");
    expect(definition.reason).toBe("no_provider");
    expect(definition.definition).toBe("");
    db.close();
  });

  it("M30 E feedback: reports dictionary_miss — not an automatic digest call — when a provider is configured", async () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    // claude-agent needs no API key to resolve (it uses the machine's own
    // Claude Code login at call time), so this configures a real,
    // non-null provider without making any network call itself — exactly
    // what's needed to prove defineHighlight stops *before* calling it.
    const profile = createProviderProfile(db, { name: "Local Agent", provider: "claude-agent" });
    setProviderRole(db, "query", profile.id);

    const definition = await defineHighlight(
      db,
      resource,
      highlightOn(db, resource.id, "zharkovian"),
    );

    expect(definition.source).toBe("");
    expect(definition.reason).toBe("dictionary_miss");
    expect(definition.definition).toBe("");
    db.close();
  });

  it("stores a definition on the highlight, and clearing it empties both columns", () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    const highlight = highlightOn(db, resource.id, "serendipity");

    // A fresh highlight carries no definition — this is what keeps the
    // glossary a list of definitions rather than of every sage highlight.
    expect(highlight.definition).toBe("");
    expect(highlight.definitionSource).toBe("");

    setHighlightDefinition(db, highlight.id, "(noun) good luck", "dictionary");
    expect(getHighlightById(db, highlight.id)?.definition).toBe("(noun) good luck");
    expect(getHighlightById(db, highlight.id)?.definitionSource).toBe("dictionary");

    // Clearing the text clears the source with it — a sourced empty
    // definition would be a row the glossary filter has to think about.
    setHighlightDefinition(db, highlight.id, "", "dictionary");
    expect(getHighlightById(db, highlight.id)?.definitionSource).toBe("");
    db.close();
  });
});

describe("deepenDefinition", () => {
  it("yields a no_provider done event immediately, with no steps and no model call", async () => {
    const db = createDb(":memory:");
    const resource = seedBook(db);
    const highlight = highlightOn(db, resource.id, "zharkovian");

    const events = [];
    for await (const event of deepenDefinition(db, resource, highlight, "query")) {
      events.push(event);
    }

    // Exactly one event — proof nothing was narrated before the provider
    // check, since there's nothing to search with.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      done: true,
      definition: { source: "", reason: "no_provider" },
    });
    db.close();
  });
});
