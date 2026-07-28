import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { LLMError, type LLMExtractRequest, type LLMProvider } from "../llm/provider.js";
import { estimateDigestRun, runDigest, splitIntoChunks } from "./build.js";
import { getChapterDigest, getDigestRun, listChapterDigests } from "./store.js";
import type { Resource } from "@marginalia/shared";
import type { ResourceTextSection } from "../library/store.js";

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "res-1",
    title: "Test Book",
    author: "Test Author",
    format: "epub",
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

function seedSections(
  db: ReturnType<typeof createDb>,
  resourceId: string,
  sections: ResourceTextSection[],
): void {
  const insert = db.prepare(
    "INSERT INTO resource_text (resource_id, spine_index, href, text) VALUES (?, ?, ?, ?)",
  );
  for (const s of sections) insert.run(resourceId, s.spineIndex, s.href, s.text);
}

describe("splitIntoChunks", () => {
  it("keeps short text as a single chunk", () => {
    expect(splitIntoChunks("one paragraph", 1000)).toEqual(["one paragraph"]);
  });

  it("splits at paragraph boundaries with overlap when over budget", () => {
    const text = ["AAAA", "BBBB", "CCCC", "DDDD"].join("\n\n");
    const chunks = splitIntoChunks(text, 10);
    expect(chunks.length).toBeGreaterThan(1);
    // Overlap: the last paragraph of one chunk reappears as the first of the next.
    expect(chunks[1].startsWith(chunks[0].split("\n\n").at(-1) ?? "")).toBe(true);
  });

  it("never drops a paragraph, even an oversized one with no break points", () => {
    const huge = "x".repeat(500);
    const chunks = splitIntoChunks(`short\n\n${huge}`, 50);
    expect(chunks.join("")).toContain(huge);
  });
});

describe("estimateDigestRun", () => {
  it("counts one extra call per split chapter (map + merge) plus one reduce call", () => {
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "x".repeat(100) },
      { spineIndex: 1, href: "b", text: "x".repeat(100) },
    ];
    // contextTokens tiny enough that each section needs to split into >1 chunk.
    const preflight = estimateDigestRun(sections, 0, 1, 40);
    expect(preflight.chapterCount).toBe(2);
    expect(preflight.estimatedCalls).toBeGreaterThan(2); // more than 1 call/chapter
  });
});

describe("runDigest", () => {
  function makeProvider(scriptedExtract: (req: LLMExtractRequest<unknown>) => unknown): LLMProvider {
    return {
      id: "openai-compatible",
      capabilities: () => ({ contextTokens: 100_000, supportsCaching: false }),
      async *stream() {
        yield { text: "" };
      },
      async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
        return scriptedExtract(req) as T;
      },
    };
  }

  it("digests every chapter in range and writes a consistent book-level reduce", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider((req) => {
      if (req.input.includes("Chapter one")) {
        return { summary: "Ch1 happens", themes: ["hope"], characters: ["Alice"] };
      }
      if (req.input.includes("Chapter two")) {
        return { summary: "Ch2 happens", themes: ["loss"], characters: ["Bob"] };
      }
      // reduce call
      return { synopsis: "A book about hope and loss.", cast: [{ name: "Alice", description: "protagonist" }], themes: ["hope", "loss"] };
    });

    const run = await runDigest(db, provider, resource, sections, 0, 1);
    expect(run.status).toBe("completed");

    const chapters = listChapterDigests(db, resource.id);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].summary).toBe("Ch1 happens");
    expect(chapters[1].summary).toBe("Ch2 happens");

    const bookRow = db.prepare("SELECT synopsis FROM book_digests WHERE resource_id = ?").get(resource.id) as { synopsis: string };
    expect(bookRow.synopsis).toContain("hope and loss");
    db.close();
  });

  it("re-digesting a chapter replaces exactly that row and leaves neighbours untouched", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    let callCount = 0;
    const provider = makeProvider((req) => {
      callCount++;
      if (req.input.includes("Chapter one")) return { summary: `Ch1 v${callCount}`, themes: [], characters: [] };
      if (req.input.includes("Chapter two")) return { summary: "Ch2 happens", themes: [], characters: [] };
      return { synopsis: "s", cast: [], themes: [] };
    });

    await runDigest(db, provider, resource, sections, 0, 1);
    const ch1First = getChapterDigest(db, resource.id, 0);
    const ch2First = getChapterDigest(db, resource.id, 1);

    // Re-run over just chapter 0: chapter 1 already has a row, so it's
    // skipped (coverage-based resumability) — only chapter 0 gets re-processed.
    // Force it to be treated as "not yet covered" by deleting its row first.
    db.prepare("DELETE FROM chapter_digests WHERE resource_id = ? AND spine_index = 0").run(resource.id);
    await runDigest(db, provider, resource, sections, 0, 1);

    const ch1Second = getChapterDigest(db, resource.id, 0);
    const ch2Second = getChapterDigest(db, resource.id, 1);
    expect(ch1Second?.summary).not.toBe(ch1First?.summary);
    expect(ch2Second?.summary).toBe(ch2First?.summary);
    expect(ch2Second?.generatedAt).toBe(ch2First?.generatedAt);
    db.close();
  });

  it("a rate-limit error pauses the run without losing already-committed chapters, and resuming continues from coverage", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
      { spineIndex: 2, href: "c", text: "Chapter three text." },
    ];
    seedSections(db, resource.id, sections);

    let calls = 0;
    const provider = makeProvider((req) => {
      calls++;
      if (req.input.includes("Chapter two")) {
        throw new LLMError("rate_limit", "slow down");
      }
      if (req.input.includes("Chapter one")) return { summary: "Ch1", themes: [], characters: [] };
      if (req.input.includes("Chapter three")) return { summary: "Ch3", themes: [], characters: [] };
      return { synopsis: "s", cast: [], themes: [] };
    });

    const paused = await runDigest(db, provider, resource, sections, 0, 2);
    expect(paused.status).toBe("paused_rate_limit");
    expect(paused.resumesAt).not.toBeNull();
    // Chapter 0 committed before the pause; chapter 2 was never attempted
    // (sequential, stops at the failure) — never lost, never skipped.
    expect(getChapterDigest(db, resource.id, 0)).toBeDefined();
    expect(getChapterDigest(db, resource.id, 2)).toBeUndefined();
    const storedRun = getDigestRun(db, resource.id);
    expect(storedRun?.status).toBe("paused_rate_limit");

    const callsBeforeResume = calls;
    // "Resume": the caller calls runDigest again with an unblocked provider.
    // Chapter 0 must NOT be re-processed (already covered) — never re-paid for.
    const unblockedProvider = makeProvider((req) => {
      calls++;
      if (req.input.includes("Chapter one")) {
        throw new Error("should never re-process an already-digested chapter");
      }
      if (req.input.includes("Chapter two")) return { summary: "Ch2", themes: [], characters: [] };
      if (req.input.includes("Chapter three")) return { summary: "Ch3", themes: [], characters: [] };
      return { synopsis: "s", cast: [], themes: [] };
    });
    const completed = await runDigest(db, unblockedProvider, resource, sections, 0, 2);
    expect(completed.status).toBe("completed");
    expect(calls).toBeGreaterThan(callsBeforeResume);
    expect(listChapterDigests(db, resource.id)).toHaveLength(3);
    db.close();
  });

  it("marks an over-budget chapter failed after one automatic re-split, and continues the run", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider((req) => {
      if (req.input.includes("Chapter one")) {
        throw new LLMError("context_too_large", "nope");
      }
      if (req.input.includes("Chapter two")) return { summary: "Ch2", themes: [], characters: [] };
      return { synopsis: "s", cast: [], themes: [] };
    });

    const run = await runDigest(db, provider, resource, sections, 0, 1);
    expect(run.status).toBe("completed");
    expect(run.failedSpineIndices).toContain(0);
    expect(getChapterDigest(db, resource.id, 0)).toBeUndefined();
    expect(getChapterDigest(db, resource.id, 1)).toBeDefined();
    db.close();
  });
});
