import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db.js";
import { LLMError, type LLMExtractRequest, type LLMProvider } from "../llm/provider.js";
import {
  estimateDigestRun,
  maybeRefreshBookDigestSnapshot,
  refreshBookDigestSnapshotInBackground,
  runDigest,
  splitIntoChunks,
  withNetworkRetry,
} from "./build.js";
import { getBookDigestSnapshot, getChapterDigest, getDigestRun, listChapterDigests } from "./store.js";
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

// M29 (decisions.md 2026-08-22): a plain network failure (a local endpoint like Ollama
// dropping a connection mid-reload) used to have no retry at all, unlike rate_limit's
// pause/resume — one blip permanently failed the whole run.
describe("withNetworkRetry", () => {
  it("retries a network-class LLMError with backoff, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) throw new LLMError("network", "fetch failed");
        return "ok";
      });
      const promise = withNetworkRetry(fn);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe("ok");
      expect(attempts).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after the retry budget and throws the last network error", async () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn(async () => {
        throw new LLMError("network", "fetch failed");
      });
      const promise = withNetworkRetry(fn);
      const assertion = expect(promise).rejects.toThrow("fetch failed");
      await vi.runAllTimersAsync();
      await assertion;
      // 1 initial attempt + 3 retries.
      expect(fn).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-network LLMError (e.g. rate_limit stays the caller's job)", async () => {
    const fn = vi.fn(async () => {
      throw new LLMError("rate_limit", "slow down");
    });
    await expect(withNetworkRetry(fn)).rejects.toThrow("slow down");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry once the signal is already aborted — a real cancellation, not a network fault", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async () => {
      throw new LLMError("network", "fetch failed");
    });
    await expect(withNetworkRetry(fn, controller.signal)).rejects.toThrow("fetch failed");
    expect(fn).toHaveBeenCalledTimes(1);
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
      return { synopsis: "A book about hope and loss.", cast: [{ name: "Alice", description: "protagonist" }], narratorGender: "unknown", themes: ["hope", "loss"] };
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

  // M22.6 B (decisions.md 2026-08-12 ruling 2): three defects behind one
  // screenshot — a raw spine index leaking into the UI, "Current" naming
  // the chapter that just finished instead of the one in flight, and the
  // final reduce call leaving the last chapter's label standing.
  it("reports each chapter's UI label before its own call, and names the reduce phase", async () => {
    const db = createDb(":memory:");
    const resource = makeResource({ metadata: { chapterTitles: { "0": "The Storm" } } });
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider((req) => {
      if (req.input.includes("Chapter one")) return { summary: "Ch1", themes: [], characters: [] };
      if (req.input.includes("Chapter two")) return { summary: "Ch2", themes: [], characters: [] };
      return { synopsis: "Book", cast: [], narratorGender: "unknown", themes: [] };
    });

    const calls: [number, number, string | null][] = [];
    await runDigest(db, provider, resource, sections, 0, 1, undefined, (current, total, message) =>
      calls.push([current, total, message]),
    );

    // sectionLabel's raw "section <spineIndex>" form is for the prompt only
    // and must never reach a progress message.
    for (const [, , message] of calls) {
      if (message !== null) expect(message).not.toMatch(/^section \d/);
    }
    // Chapter 1's label is the first one reported — i.e. before its own
    // `digestChapter` call resolves, not after (the bug: it used to only
    // appear once chapter 2 was already the one actually in flight).
    const firstLabeled = calls.find(([, , message]) => message !== null);
    expect(firstLabeled?.[2]).toBe("S1 · The Storm");
    // The reduce call — `total`'s "+1" — gets its own label instead of
    // leaving chapter 2's behind while it's what's actually running.
    expect(calls.some(([, , message]) => message === "Composing the book digest")).toBe(true);
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
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
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
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
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
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
    });
    const completed = await runDigest(db, unblockedProvider, resource, sections, 0, 2);
    expect(completed.status).toBe("completed");
    expect(calls).toBeGreaterThan(callsBeforeResume);
    expect(listChapterDigests(db, resource.id)).toHaveLength(3);
    db.close();
  });

  it("self-heals a transient network error mid-run without pausing or failing", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);

    let chapterAttempts = 0;
    const provider = makeProvider((req) => {
      if (req.input.includes("Chapter one")) {
        chapterAttempts++;
        if (chapterAttempts < 3) throw new LLMError("network", "fetch failed");
        return { summary: "Ch1", themes: [], characters: [] };
      }
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
    });

    vi.useFakeTimers();
    try {
      const runPromise = runDigest(db, provider, resource, sections, 0, 0);
      await vi.runAllTimersAsync();
      const run = await runPromise;
      expect(run.status).toBe("completed");
      expect(chapterAttempts).toBe(3);
      expect(getChapterDigest(db, resource.id, 0)).toBeDefined();
    } finally {
      vi.useRealTimers();
      db.close();
    }
  });

  it("a persistent network error still fails the run (not paused) once retries are exhausted, keeping resumability", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider((req) => {
      if (req.input.includes("Chapter two")) {
        throw new LLMError("network", "fetch failed");
      }
      return { summary: "Ch1", themes: [], characters: [] };
    });

    vi.useFakeTimers();
    try {
      // runDigest rejects (not resolves) on a non-rate_limit error, same as
      // before M29 — persistRun("failed", ...) happens first, then it
      // rethrows to the caller (the job registry marks the job failed from
      // that rejection). Attach the assertion before flushing timers so the
      // retry backoff's rejection is never briefly unhandled.
      const runPromise = runDigest(db, provider, resource, sections, 0, 1);
      const assertion = expect(runPromise).rejects.toThrow("fetch failed");
      await vi.runAllTimersAsync();
      await assertion;

      // Distinct from rate_limit's pause/resume: an outage that outlasts the
      // short in-process retry budget is a real failure, not left in a
      // phantom "paused" state that needs someone watching the Scan to clear.
      const stored = getDigestRun(db, resource.id);
      expect(stored?.status).toBe("failed");
      expect(stored?.lastError).toBe("fetch failed");
      // Chapter 0 (already committed before the failing chapter) is kept —
      // same resumability guarantee as the rate-limit path.
      expect(getChapterDigest(db, resource.id, 0)).toBeDefined();
      expect(getChapterDigest(db, resource.id, 1)).toBeUndefined();
    } finally {
      vi.useRealTimers();
      db.close();
    }
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
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
    });

    const run = await runDigest(db, provider, resource, sections, 0, 1);
    expect(run.status).toBe("completed");
    expect(run.failedSpineIndices).toContain(0);
    expect(getChapterDigest(db, resource.id, 0)).toBeUndefined();
    expect(getChapterDigest(db, resource.id, 1)).toBeDefined();
    db.close();
  });

  // M20.6 "the job registry" — cancellation must actually stop the work,
  // not just abandon the caller's wait on it (decisions.md 2026-07-30):
  // already-committed chapters stay, and no half-written chapter appears.
  it("cancelling between chapters stops the run before the next chapter is ever attempted", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    const controller = new AbortController();
    const provider = makeProvider((req) => {
      if (req.input.includes("Chapter one")) {
        // Simulates the cancel button being pressed right after this call
        // lands — chapter 1 still gets committed; chapter 2 must never be
        // attempted at all.
        controller.abort();
        return { summary: "Ch1", themes: [], characters: [] };
      }
      throw new Error("chapter two must never be attempted once cancelled");
    });

    const run = await runDigest(db, provider, resource, sections, 0, 1, controller.signal);
    expect(run.status).toBe("failed");
    expect(run.lastError).toBe("Cancelled");
    expect(getChapterDigest(db, resource.id, 0)).toBeDefined();
    expect(getChapterDigest(db, resource.id, 1)).toBeUndefined();
    db.close();
  });

  it("cancelling mid-call aborts the in-flight extract() itself, not just the next one queued behind it", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    const controller = new AbortController();
    const provider: LLMProvider = {
      id: "openai-compatible",
      capabilities: () => ({ contextTokens: 100_000, supportsCaching: false }),
      async *stream() {
        yield { text: "" };
      },
      async extract<T>(req: LLMExtractRequest<unknown>): Promise<T> {
        if (req.input.includes("Chapter one")) {
          return { summary: "Ch1", themes: [], characters: [] } as T;
        }
        // Simulates a real provider whose in-flight call actually observes
        // the AbortSignal (the seam threaded through anthropic.ts/
        // openaiCompat.ts/claudeAgent.ts) and rejects instead of resolving.
        controller.abort();
        throw new Error("aborted mid-call");
      },
    };

    await expect(runDigest(db, provider, resource, sections, 0, 1, controller.signal)).rejects.toThrow();
    expect(getChapterDigest(db, resource.id, 0)).toBeDefined();
    expect(getChapterDigest(db, resource.id, 1)).toBeUndefined();
    const storedRun = getDigestRun(db, resource.id);
    expect(storedRun?.status).toBe("failed");
    expect(storedRun?.lastError).toBe("Cancelled");
    db.close();
  });
});

describe("maybeRefreshBookDigestSnapshot", () => {
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

  it("does nothing when no chapter within the bookmark has been digested yet", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    let calls = 0;
    const provider = makeProvider(() => {
      calls++;
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
    });

    await maybeRefreshBookDigestSnapshot(db, provider, resource, 5);
    expect(calls).toBe(0);
    expect(getBookDigestSnapshot(db, resource.id)).toBeUndefined();
    db.close();
  });

  it("builds a snapshot from only the chapters up to the bookmark, and skips chapters past it", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
      { spineIndex: 2, href: "c", text: "Chapter three text." },
    ];
    seedSections(db, resource.id, sections);
    const plotProvider = makeProvider((req) => {
      if (req.input.includes("Chapter one")) return { summary: "Ch1", themes: [], characters: [] };
      if (req.input.includes("Chapter two")) return { summary: "Ch2", themes: [], characters: [] };
      if (req.input.includes("Chapter three")) return { summary: "Ch3", themes: [], characters: [] };
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
    });
    await runDigest(db, plotProvider, resource, sections, 0, 2);

    let seenChapterNumbers: number[] = [];
    const snapshotProvider = makeProvider((req) => {
      seenChapterNumbers = [0, 1, 2].filter((n) => req.input.includes(`Chapter ${n}:`));
      return { synopsis: "safe synopsis", cast: [], narratorGender: "unknown", themes: [] };
    });

    // Bookmark at chapter 1 — chapter 2 is past it and must not appear.
    await maybeRefreshBookDigestSnapshot(db, snapshotProvider, resource, 1);
    const snapshot = getBookDigestSnapshot(db, resource.id);
    expect(snapshot?.synopsis).toBe("safe synopsis");
    expect(snapshot?.upToSpineIndex).toBe(1);
    expect(seenChapterNumbers).toEqual([0, 1]);
    db.close();
  });

  it("does not call the provider again once the snapshot already covers the bookmark's frontier", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);
    await runDigest(
      db,
      makeProvider((req) =>
        req.input.includes("Chapter one")
          ? { summary: "Ch1", themes: [], characters: [] }
          : { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] },
      ),
      resource,
      sections,
      0,
      0,
    );

    let calls = 0;
    const provider = makeProvider(() => {
      calls++;
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
    });
    await maybeRefreshBookDigestSnapshot(db, provider, resource, 0);
    expect(calls).toBe(1);
    // Same bookmark, no new chapters digested since — a second call (e.g. a
    // page turn that didn't advance into new digest coverage) is a no-op.
    await maybeRefreshBookDigestSnapshot(db, provider, resource, 0);
    expect(calls).toBe(1);
    db.close();
  });
});

// M29 (decisions.md 2026-08-22): this is what `GET /:id/digest` actually calls now — the
// route used to `await maybeRefreshBookDigestSnapshot` inline with no try/catch, so a slow
// or failing local-model call blocked (or 500'd) the whole digest-open request despite
// being documented as "best-effort, silent". These tests hold the wrapper to that promise.
describe("refreshBookDigestSnapshotInBackground", () => {
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

  async function seedOneDigestedChapter(db: ReturnType<typeof createDb>, resource: Resource): Promise<void> {
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);
    await runDigest(
      db,
      makeProvider((req) =>
        req.input.includes("Chapter one")
          ? { summary: "Ch1", themes: [], characters: [] }
          : { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] },
      ),
      resource,
      sections,
      0,
      0,
    );
  }

  it("returns synchronously and swallows a failing refresh instead of throwing or rejecting the caller", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    await seedOneDigestedChapter(db, resource);

    let resolveExtract: (() => void) | undefined;
    const stall = new Promise<void>((resolve) => {
      resolveExtract = resolve;
    });
    const provider = makeProvider(async () => {
      await stall;
      throw new LLMError("network", "fetch failed");
    });

    // A blocking implementation would hang on the still-pending `stall`
    // promise here; reaching the assertion at all proves it didn't.
    expect(() => refreshBookDigestSnapshotInBackground(db, provider, resource, 0)).not.toThrow();

    resolveExtract?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The failed refresh never got to write a snapshot — but nothing above
    // threw or produced an unhandled rejection either.
    expect(getBookDigestSnapshot(db, resource.id)).toBeUndefined();
    db.close();
  });

  it("dedups concurrent calls for the same resource into a single underlying refresh", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    await seedOneDigestedChapter(db, resource);

    let calls = 0;
    let resolveExtract: (() => void) | undefined;
    const stall = new Promise<void>((resolve) => {
      resolveExtract = resolve;
    });
    const provider = makeProvider(async () => {
      calls++;
      await stall;
      return { synopsis: "safe synopsis", cast: [], narratorGender: "unknown", themes: [] };
    });

    // Simulates two "open digest" requests landing before the first
    // background refresh has finished — must not fire two concurrent LLM
    // calls for the same book.
    refreshBookDigestSnapshotInBackground(db, provider, resource, 0);
    refreshBookDigestSnapshotInBackground(db, provider, resource, 0);
    resolveExtract?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    expect(getBookDigestSnapshot(db, resource.id)?.synopsis).toBe("safe synopsis");
    db.close();
  });
});
