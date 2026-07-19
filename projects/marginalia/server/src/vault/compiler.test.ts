import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createDb } from "../db.js";
import type { LLMProvider, LLMExtractRequest, LLMStreamRequest } from "../llm/provider.js";
import { updateNotepadContent } from "../notepad/store.js";
import { publishNotepad, publishResource } from "./compiler.js";

type Db = ReturnType<typeof createDb>;

/** Returns queued responses in order; throws if asked for more than provided
 * (so a test can assert extract() was NOT called again on a second publish). */
class FakeProvider implements LLMProvider {
  readonly id = "openai-compatible" as const;
  calls = 0;
  constructor(private readonly responses: unknown[]) {}

  capabilities() {
    return { contextTokens: 32768, supportsCaching: false };
  }

  // eslint-disable-next-line require-yield
  async *stream(_req: LLMStreamRequest): AsyncIterable<{ text: string }> {
    throw new Error("stream() should not be called by the vault compiler");
  }

  async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
    this.calls++;
    if (this.responses.length === 0) {
      throw new Error("FakeProvider: no more queued extract() responses");
    }
    const next = this.responses.shift();
    return req.schema.parse(next) as T;
  }
}

function seedResource(db: Db, id: string, title: string, author: string | null = "Author") {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, @title, @author, 'epub', '/tmp/x.epub', '{}', @importedAt)`,
  ).run({ id, title, author, importedAt: new Date().toISOString() });
}

function seedHighlight(db: Db, id: string, resourceId: string, exact: string, spineIndex = 0) {
  db.prepare(
    `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, created_at)
     VALUES (@id, @resourceId, @exact, '', '', @cfi, @spineIndex, @createdAt)`,
  ).run({
    id,
    resourceId,
    exact,
    cfi: `epubcfi(/6/${spineIndex}!/4/2)`,
    spineIndex,
    createdAt: new Date().toISOString(),
  });
}

/** Seeds a thread with one user + one assistant message (an "answered" thread). */
function seedAnsweredThread(db: Db, threadId: string, highlightId: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO threads (id, highlight_id, created_at) VALUES (@id, @highlightId, @now)`,
  ).run({ id: threadId, highlightId, now });
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, created_at)
     VALUES (@id, @threadId, 'user', @content, @now)`,
  ).run({ id: `${threadId}-u`, threadId, content: "Their question: why?", now });
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, created_at)
     VALUES (@id, @threadId, 'assistant', @content, @now)`,
  ).run({ id: `${threadId}-a`, threadId, content: "Because of themes.", now });
}

/** Seeds a thread with only a user message — unanswered, must never be published. */
function seedUnansweredThread(db: Db, threadId: string, highlightId: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO threads (id, highlight_id, created_at) VALUES (@id, @highlightId, @now)`,
  ).run({ id: threadId, highlightId, now });
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, created_at)
     VALUES (@id, @threadId, 'user', @content, @now)`,
  ).run({ id: `${threadId}-u`, threadId, content: "Their question: why?", now });
}

describe("publishResource", () => {
  let db: Db;
  let vaultPath: string;

  beforeEach(() => {
    db = createDb(":memory:");
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "marginalia-vault-"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it("writes a reading note, a new concept note, and a book overview", async () => {
    seedResource(db, "res-1", "Metamorphosis", "Franz Kafka");
    seedHighlight(db, "h-1", "res-1", "he found himself transformed");
    seedAnsweredThread(db, "t-1", "h-1");

    const provider = new FakeProvider([
      {
        title: "The Transformation",
        summary: "A meditation on alienation.",
        concepts: [{ name: "Absurdism", aliases: ["The Absurd"], gloss: "Meaninglessness of existence." }],
      },
    ]);

    const result = await publishResource(db, provider, "res-1", vaultPath);
    expect(result).toEqual({ notes: 1, conceptsCreated: 1, conceptsLinked: 0 });

    const noteFiles = fs.readdirSync(path.join(vaultPath, "Readings", "Metamorphosis"));
    expect(noteFiles).toContain("01 - the-transformation.md");
    expect(noteFiles).toContain("_Book.md");

    const note = fs.readFileSync(
      path.join(vaultPath, "Readings", "Metamorphosis", "01 - the-transformation.md"),
      "utf8",
    );
    expect(note).toContain("he found himself transformed");
    expect(note).toContain("A meditation on alienation.");
    expect(note).toContain("[[Absurdism]]");
    expect(note).toContain("Sources: Metamorphosis by Franz Kafka");

    const conceptNote = fs.readFileSync(path.join(vaultPath, "Concepts", "Absurdism.md"), "utf8");
    expect(conceptNote).toContain("The Absurd");
    expect(conceptNote).toContain("Meaninglessness of existence.");
    expect(conceptNote).toContain("<!-- thread:t-1 -->");

    const overview = fs.readFileSync(
      path.join(vaultPath, "Readings", "Metamorphosis", "_Book.md"),
      "utf8",
    );
    expect(overview).toContain("01 - the-transformation");
  });

  it("only publishes threads that have an assistant answer", async () => {
    seedResource(db, "res-1", "Metamorphosis");
    seedHighlight(db, "h-1", "res-1", "unanswered passage");
    seedUnansweredThread(db, "t-1", "h-1");

    const provider = new FakeProvider([]); // extract() must never be called
    const result = await publishResource(db, provider, "res-1", vaultPath);

    expect(result).toEqual({ notes: 0, conceptsCreated: 0, conceptsLinked: 0 });
    expect(provider.calls).toBe(0);
    expect(fs.existsSync(path.join(vaultPath, "Readings"))).toBe(false);
  });

  it("re-publishing is a no-op: no re-extraction, identical file bytes", async () => {
    seedResource(db, "res-1", "Metamorphosis");
    seedHighlight(db, "h-1", "res-1", "passage one");
    seedAnsweredThread(db, "t-1", "h-1");

    const provider = new FakeProvider([
      {
        title: "First Note",
        summary: "Summary one.",
        concepts: [],
      },
    ]);
    await publishResource(db, provider, "res-1", vaultPath);

    const notePath = path.join(vaultPath, "Readings", "Metamorphosis", "01 - first-note.md");
    const hashBefore = crypto.createHash("sha256").update(fs.readFileSync(notePath)).digest("hex");

    // Second publish: FakeProvider has zero responses queued — if the
    // compiler tried to extract() again, this would throw.
    const result = await publishResource(db, provider, "res-1", vaultPath);

    expect(result).toEqual({ notes: 0, conceptsCreated: 0, conceptsLinked: 0 });
    expect(provider.calls).toBe(1);
    const hashAfter = crypto.createHash("sha256").update(fs.readFileSync(notePath)).digest("hex");
    expect(hashAfter).toBe(hashBefore);
  });

  it("links a fuzzy/alias-matching concept instead of duplicating it, within one run", async () => {
    seedResource(db, "res-1", "Metamorphosis");
    seedHighlight(db, "h-1", "res-1", "passage one", 0);
    seedHighlight(db, "h-2", "res-1", "passage two", 1);
    seedAnsweredThread(db, "t-1", "h-1");
    seedAnsweredThread(db, "t-2", "h-2");

    const provider = new FakeProvider([
      {
        title: "Note One",
        summary: "Summary one.",
        concepts: [{ name: "Absurdism", aliases: [], gloss: "Meaninglessness." }],
      },
      {
        title: "Note Two",
        summary: "Summary two.",
        concepts: [
          { name: "The Absurd Condition", aliases: ["Absurdism"], gloss: "A restated gloss." },
        ],
      },
    ]);

    const result = await publishResource(db, provider, "res-1", vaultPath);
    expect(result).toEqual({ notes: 2, conceptsCreated: 1, conceptsLinked: 1 });

    const conceptFiles = fs.readdirSync(path.join(vaultPath, "Concepts"));
    expect(conceptFiles).toEqual(["Absurdism.md"]);

    const conceptNote = fs.readFileSync(path.join(vaultPath, "Concepts", "Absurdism.md"), "utf8");
    expect(conceptNote).toContain("<!-- thread:t-1 -->");
    expect(conceptNote).toContain("<!-- thread:t-2 -->");
  });

  it("sanitizes a concept name for the filename and uses that same name in the wikilink", async () => {
    seedResource(db, "res-1", "Metamorphosis");
    seedHighlight(db, "h-1", "res-1", "passage one");
    seedAnsweredThread(db, "t-1", "h-1");

    const provider = new FakeProvider([
      {
        title: "Note One",
        summary: "Summary one.",
        concepts: [
          { name: "Cultural/Societal Expectations", aliases: [], gloss: "A gloss." },
        ],
      },
    ]);
    await publishResource(db, provider, "res-1", vaultPath);

    // The concept file must exist at the sanitized path (no nested "Cultural/" folder)...
    const conceptFiles = fs.readdirSync(path.join(vaultPath, "Concepts"));
    expect(conceptFiles).toEqual(["Cultural-Societal Expectations.md"]);

    // ...and the reading note's wikilink must reference that exact same
    // sanitized name, or Obsidian can't resolve it.
    const note = fs.readFileSync(
      path.join(vaultPath, "Readings", "Metamorphosis", "01 - note-one.md"),
      "utf8",
    );
    expect(note).toContain("[[Cultural-Societal Expectations]]");
    expect(note).not.toContain("[[Cultural/Societal Expectations]]");
  });

  it("re-publishes into a new vault path even though the ledger already has a row", async () => {
    seedResource(db, "res-1", "Metamorphosis");
    seedHighlight(db, "h-1", "res-1", "passage one");
    seedAnsweredThread(db, "t-1", "h-1");

    const provider = new FakeProvider([
      { title: "First Note", summary: "Summary one.", concepts: [] },
    ]);
    await publishResource(db, provider, "res-1", vaultPath);
    expect(
      fs.existsSync(path.join(vaultPath, "Readings", "Metamorphosis", "01 - first-note.md")),
    ).toBe(true);

    // Same ledger (same db), but a *different* vault directory — as if the
    // user changed the vault path setting (moved vaults, pointed at a fresh
    // one, etc). The old note doesn't exist here even though a `publishes`
    // row for this thread does.
    const newVaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "marginalia-vault-new-"));
    try {
      const provider2 = new FakeProvider([
        { title: "First Note", summary: "Summary one.", concepts: [] },
      ]);
      const result = await publishResource(db, provider2, "res-1", newVaultPath);

      // Must actually re-extract and write into the new vault, not silently
      // no-op because the ledger thinks it's already published.
      expect(result).toEqual({ notes: 1, conceptsCreated: 0, conceptsLinked: 0 });
      expect(
        fs.existsSync(path.join(newVaultPath, "Readings", "Metamorphosis", "01 - first-note.md")),
      ).toBe(true);

      // The book overview in the new vault must only link notes that
      // actually exist there — never a phantom link to the old vault's note.
      const overview = fs.readFileSync(
        path.join(newVaultPath, "Readings", "Metamorphosis", "_Book.md"),
        "utf8",
      );
      expect(overview).toContain("01 - first-note");
    } finally {
      fs.rmSync(newVaultPath, { recursive: true, force: true });
    }
  });

  it("links threads from a second book to the same concept note as the first", async () => {
    seedResource(db, "res-1", "Book One");
    seedHighlight(db, "h-1", "res-1", "passage one");
    seedAnsweredThread(db, "t-1", "h-1");

    seedResource(db, "res-2", "Book Two");
    seedHighlight(db, "h-2", "res-2", "passage two");
    seedAnsweredThread(db, "t-2", "h-2");

    const provider = new FakeProvider([
      {
        title: "Note From Book One",
        summary: "Summary one.",
        concepts: [{ name: "Absurdism", aliases: [], gloss: "Meaninglessness." }],
      },
    ]);
    await publishResource(db, provider, "res-1", vaultPath);

    const provider2 = new FakeProvider([
      {
        title: "Note From Book Two",
        summary: "Summary two.",
        concepts: [{ name: "Absurdism", aliases: [], gloss: "A restated gloss." }],
      },
    ]);
    const result2 = await publishResource(db, provider2, "res-2", vaultPath);

    expect(result2).toEqual({ notes: 1, conceptsCreated: 0, conceptsLinked: 1 });
    const conceptFiles = fs.readdirSync(path.join(vaultPath, "Concepts"));
    expect(conceptFiles).toEqual(["Absurdism.md"]);
    const conceptNote = fs.readFileSync(path.join(vaultPath, "Concepts", "Absurdism.md"), "utf8");
    expect(conceptNote).toContain("<!-- thread:t-1 -->");
    expect(conceptNote).toContain("<!-- thread:t-2 -->");
  });
});

describe("publishNotepad", () => {
  let db: Db;
  let vaultPath: string;

  beforeEach(() => {
    db = createDb(":memory:");
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "marginalia-vault-"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it("is a no-op on blank content — no extract call, nothing written", async () => {
    const provider = new FakeProvider([]);
    const result = await publishNotepad(db, provider, vaultPath);
    expect(result).toEqual({ notes: 0, conceptsCreated: 0, conceptsLinked: 0 });
    expect(provider.calls).toBe(0);
    expect(fs.existsSync(path.join(vaultPath, "Notes"))).toBe(false);
  });

  it("writes Notes/Desk Notepad.md and links a new concept", async () => {
    updateNotepadContent(db, "Loose thought about entropy and decay.");
    const provider = new FakeProvider([
      { concepts: [{ name: "Entropy", aliases: [], gloss: "Disorder increases." }] },
    ]);

    const result = await publishNotepad(db, provider, vaultPath);
    expect(result).toEqual({ notes: 1, conceptsCreated: 1, conceptsLinked: 0 });

    const note = fs.readFileSync(path.join(vaultPath, "Notes", "Desk Notepad.md"), "utf8");
    expect(note).toContain("Loose thought about entropy and decay.");
    expect(note).toContain("[[Entropy]]");
  });

  it("republishing unchanged content is a no-op — no re-extraction", async () => {
    updateNotepadContent(db, "Stable thought.");
    const provider = new FakeProvider([{ concepts: [] }]);
    await publishNotepad(db, provider, vaultPath);

    const result = await publishNotepad(db, provider, vaultPath);
    expect(result).toEqual({ notes: 0, conceptsCreated: 0, conceptsLinked: 0 });
    expect(provider.calls).toBe(1);
  });

  it("editing the content after a publish triggers a fresh regenerate-in-place publish", async () => {
    updateNotepadContent(db, "First version.");
    const provider = new FakeProvider([{ concepts: [] }]);
    await publishNotepad(db, provider, vaultPath);

    updateNotepadContent(db, "Second, edited version.");
    const provider2 = new FakeProvider([{ concepts: [] }]);
    const result = await publishNotepad(db, provider2, vaultPath);

    expect(result).toEqual({ notes: 1, conceptsCreated: 0, conceptsLinked: 0 });
    const note = fs.readFileSync(path.join(vaultPath, "Notes", "Desk Notepad.md"), "utf8");
    expect(note).toContain("Second, edited version.");
    expect(note).not.toContain("First version.");
  });
});
