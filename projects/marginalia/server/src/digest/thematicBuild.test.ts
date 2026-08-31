import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db.js";
import { LLMError, type LLMExtractRequest, type LLMProvider } from "../llm/provider.js";
import { runDigest } from "./build.js";
import { runThematicDigest } from "./thematicBuild.js";
import { getChapterDigest } from "./store.js";
import {
  getThematicDigest,
  getThematicRun,
  hashBrief,
  isThematicStale,
  listThematicDigests,
  putBrief,
} from "./thematicStore.js";
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

function makeProvider(
  scriptedExtract: (req: LLMExtractRequest<unknown>) => unknown,
  contextTokens = 100_000,
): LLMProvider {
  return {
    id: "openai-compatible",
    capabilities: () => ({ contextTokens, supportsCaching: false }),
    async *stream() {
      yield { text: "" };
    },
    async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
      return scriptedExtract(req) as T;
    },
  };
}

describe("runThematicDigest", () => {
  it("analyzes every chapter in range under the resource's current brief", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);
    putBrief(db, resource.id, "read for self-determination");

    const provider = makeProvider((req) => {
      if (req.input.includes("Chapter one")) {
        return { analysis: "Ch1 is about autonomy.", themes: ["autonomy"], questions: [{ text: "Why does X choose?", quote: "Chapter one text." }] };
      }
      return { analysis: "Ch2 is about consequence.", themes: ["consequence"], questions: [{ text: "What changed?", quote: "Chapter two text." }] };
    });

    const run = await runThematicDigest(db, provider, resource, sections, 0, 1);
    expect(run.status).toBe("completed");

    const chapters = listThematicDigests(db, resource.id);
    expect(chapters).toHaveLength(2);
    expect(chapters[0].analysis).toBe("Ch1 is about autonomy.");
    expect(chapters[0].briefText).toBe("read for self-determination");
    expect(chapters[0].briefHash).toBe(hashBrief("read for self-determination"));
    db.close();
  });

  it("does not call or invalidate the plot layer — the two passes are fully independent calls", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);

    const plotCalls: string[] = [];
    const plotProvider = makeProvider((req) => {
      plotCalls.push(req.input);
      if (req.input.includes("Chapter one")) return { summary: "Ch1 happens", themes: ["hope"], characters: ["Alice"] };
      return { synopsis: "s", cast: [], narratorGender: "unknown", themes: [] };
    });
    await runDigest(db, plotProvider, resource, sections, 0, 0);
    const plotCallsAfterPlot = plotCalls.length;
    const plotRowBefore = getChapterDigest(db, resource.id, 0);

    const thematicProvider = makeProvider((req) => {
      plotCalls.push(req.input); // would show up if the thematic pass ever hit the plot provider by mistake
      return { analysis: "Ch1 is about hope.", themes: ["hope"], questions: [{ text: "What is hope here?", quote: "Chapter one text." }] };
    });
    await runThematicDigest(db, thematicProvider, resource, sections, 0, 0);

    // The plot provider was never touched again by the thematic run.
    expect(plotCalls.length).toBeGreaterThan(plotCallsAfterPlot);
    const plotRowAfter = getChapterDigest(db, resource.id, 0);
    expect(plotRowAfter?.generatedAt).toBe(plotRowBefore?.generatedAt);
    expect(plotRowAfter?.summary).toBe(plotRowBefore?.summary);
    db.close();
  });

  it("re-running under the same brief is a no-op — already-covered chapters are skipped", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);
    putBrief(db, resource.id, "a brief");

    let calls = 0;
    const provider = makeProvider(() => {
      calls++;
      return { analysis: "analysis", themes: [], questions: [] };
    });

    await runThematicDigest(db, provider, resource, sections, 0, 0);
    expect(calls).toBe(1);
    await runThematicDigest(db, provider, resource, sections, 0, 0);
    expect(calls).toBe(1); // same brief, already covered — never re-paid for
    db.close();
  });

  it("changing the brief makes prior chapters stale and re-running regenerates them", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);
    putBrief(db, resource.id, "brief A");

    let call = 0;
    const provider = makeProvider(() => {
      call++;
      return { analysis: `analysis v${call}`, themes: [], questions: [] };
    });

    await runThematicDigest(db, provider, resource, sections, 0, 0);
    const first = getThematicDigest(db, resource.id, 0)!;
    expect(isThematicStale(first, hashBrief("brief A"))).toBe(false);
    expect(isThematicStale(first, hashBrief("brief B"))).toBe(true);

    putBrief(db, resource.id, "brief B");
    await runThematicDigest(db, provider, resource, sections, 0, 0);
    const second = getThematicDigest(db, resource.id, 0)!;
    expect(second.analysis).not.toBe(first.analysis);
    expect(second.briefText).toBe("brief B");
    db.close();
  });

  it("a rate-limit error pauses the thematic run without losing committed chapters", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider((req) => {
      if (req.input.includes("Chapter two")) throw new LLMError("rate_limit", "slow down");
      return { analysis: "Ch1 analysis", themes: [], questions: [] };
    });

    const paused = await runThematicDigest(db, provider, resource, sections, 0, 1);
    expect(paused.status).toBe("paused_rate_limit");
    expect(getThematicDigest(db, resource.id, 0)).toBeDefined();
    expect(getThematicDigest(db, resource.id, 1)).toBeUndefined();
    const stored = getThematicRun(db, resource.id);
    expect(stored?.status).toBe("paused_rate_limit");
    db.close();
  });

  // M29 (decisions.md 2026-08-22, mirrors build.test.ts's runDigest coverage): a plain
  // network error now gets the same short in-process retry as the plot layer, via the
  // shared `withNetworkRetry` (build.ts) — a transient local-endpoint blip self-heals
  // instead of pausing the run the way only rate_limit used to.
  it("self-heals a transient network error mid-run without pausing", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);

    let attempts = 0;
    const provider = makeProvider(() => {
      attempts++;
      if (attempts < 3) throw new LLMError("network", "fetch failed");
      return { analysis: "Ch1 analysis", themes: [], questions: [] };
    });

    vi.useFakeTimers();
    try {
      const runPromise = runThematicDigest(db, provider, resource, sections, 0, 0);
      await vi.runAllTimersAsync();
      const run = await runPromise;
      expect(run.status).toBe("completed");
      expect(attempts).toBe(3);
      expect(getThematicDigest(db, resource.id, 0)).toBeDefined();
    } finally {
      vi.useRealTimers();
      db.close();
    }
  });

  it("cancelling stops the run before the next chapter is attempted, keeping committed chapters", async () => {
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
        controller.abort();
        return { analysis: "Ch1 analysis", themes: [], questions: [] };
      }
      throw new Error("chapter two must never be attempted once cancelled");
    });

    const run = await runThematicDigest(db, provider, resource, sections, 0, 1, controller.signal);
    expect(run.status).toBe("failed");
    expect(run.lastError).toBe("Cancelled");
    expect(getThematicDigest(db, resource.id, 0)).toBeDefined();
    expect(getThematicDigest(db, resource.id, 1)).toBeUndefined();
    db.close();
  });
});

// ---------------------------------------------------------------------------
// M34 §0b — the shape log
//
// These assert on the log line because the log line *is* the deliverable:
// §0b stores nothing and renders nothing. What §0c has to be able to read off
// a real run is (a) did the chapter split, and (b) did the questions' quotes
// locate — together, because the hypothesis is that the second fails when the
// first is true.
// ---------------------------------------------------------------------------

function captureShapeLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    const line = args.map(String).join(" ");
    if (line.startsWith("[thematic:shape]")) lines.push(line);
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("runThematicDigest — M34 0b shape log", () => {
  it("logs one line per chapter with its length, counts against their ceilings, and quote hits", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "The cat sat on the mat, and the world went on without comment." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => ({
      analysis: "Ten chars.",
      themes: ["indifference", "domesticity"],
      questions: [
        // Verbatim — locates.
        { text: "Whose world?", quote: "the world went on" },
        // Paraphrased — the failure §0a records on click and §0b counts here.
        { text: "Why a cat?", quote: "a cat was sitting upon a mat" },
      ],
    }));

    const log = captureShapeLog();
    try {
      await runThematicDigest(db, provider, resource, sections, 0, 0);
    } finally {
      log.restore();
    }

    expect(log.lines).toHaveLength(1);
    const line = log.lines[0];
    expect(line).toContain("spine=0");
    expect(line).toContain(`chars=${sections[0].text.length}`);
    expect(line).toContain("parts=1");
    expect(line).toContain("themes=2/8");
    expect(line).toContain("questions=2/3");
    expect(line).toContain("quotes_located=1/2");
    db.close();
  });

  it("reports parts>1 when the chapter split, which is what makes a quote miss diagnosable", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    // Two paragraphs, each comfortably over the tiny map budget below, so
    // splitIntoChunks produces more than one chunk and mergeThematicParts runs.
    const paragraph = "Sentence about the sea. ".repeat(40);
    const sections: ResourceTextSection[] = [
      { spineIndex: 3, href: "a", text: `${paragraph}\n\n${paragraph}` },
    ];
    seedSections(db, resource.id, sections);

    // 1000 tokens * 0.25 * 3.5 = 875 chars of map budget.
    const provider = makeProvider(
      () => ({
        analysis: "Merged.",
        themes: ["the sea"],
        // The merge step never sees the chapter text, so its quote is whatever
        // the parts handed it — here, one that no longer matches.
        questions: [{ text: "Why the sea?", quote: "a sentence that was never written" }],
      }),
      1000,
    );

    const log = captureShapeLog();
    try {
      await runThematicDigest(db, provider, resource, sections, 3, 3);
    } finally {
      log.restore();
    }

    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toContain("spine=3");
    expect(log.lines[0]).toMatch(/parts=(?!1\b)\d+/);
    expect(log.lines[0]).toContain("quotes_located=0/1");
    db.close();
  });

  it("logs a too_large line rather than nothing when a chapter never fits", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => {
      throw new LLMError("context_too_large", "too big");
    });

    const log = captureShapeLog();
    try {
      await runThematicDigest(db, provider, resource, sections, 0, 0);
    } finally {
      log.restore();
    }

    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toContain("result=too_large");
    db.close();
  });
});
