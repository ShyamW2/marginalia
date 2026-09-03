import { describe, expect, it, vi } from "vitest";
import { createDb } from "../db.js";
import { LLMError, type LLMExtractRequest, type LLMProvider } from "../llm/provider.js";
import { runDigest } from "./build.js";
import { runThematicDigest } from "./thematicBuild.js";
import { getChapterDigest } from "./store.js";
import { listBookThemes } from "./canonicalThemes.js";
import { listHighlightsForResource } from "../annotations/highlights.js";
import { getChapterSubstrate } from "./substrateStore.js";
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
  // M34 §C0: `runThematicDigest` now chains a distillation call onto the end
  // of a run — every existing test's `scriptedExtract` is written against
  // the thematic-part shape, not the distillation shape, so route
  // distillation's own `extract` call away from it by default (no themes to
  // distil is exactly right for tests that were never about §C0).
  distillationExtract: (req: LLMExtractRequest<unknown>) => unknown = () => ({ themes: [] }),
  // M37 §A: `runThematicDigest` now also builds a chapter's substrate before
  // the thematic call — every existing test's `scriptedExtract` is written
  // against the thematic-part shape, not the substrate shape, so route the
  // substrate's own `extract` call away from it by default. An empty
  // substrate is fine for every one of these tests: the thematic mock below
  // never actually reads what the substrate said (it branches on the
  // chapter label baked into `req.input`), and evidence-filtering checks a
  // returned quote against the chapter's real text, not the substrate.
  substrateExtract: (req: LLMExtractRequest<unknown>) => unknown = () => ({ passages: [], claims: [] }),
): LLMProvider {
  return {
    id: "openai-compatible",
    capabilities: () => ({ contextTokens, supportsCaching: false }),
    async *stream() {
      yield { text: "" };
    },
    async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
      if (req.instructions.startsWith("You are distilling")) {
        return distillationExtract(req) as T;
      }
      if (req.instructions.startsWith("You are building a durable, reusable extract")) {
        return substrateExtract(req) as T;
      }
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
      // M37 §B: the thematic call's input is now the chapter's substrate,
      // not its raw text — the chapter label (present in every extract
      // call's input regardless of what's in the substrate) is the stable
      // way to tell the two chapters apart here.
      if (req.input.includes("section 0")) {
        return {
          analysis: "Ch1 is about autonomy.",
          themes: [{ name: "autonomy", quotes: ["Chapter one text."] }],
          questions: [{ text: "Why does X choose?", quote: "Chapter one text." }],
        };
      }
      return {
        analysis: "Ch2 is about consequence.",
        themes: [{ name: "consequence", quotes: ["Chapter two text."] }],
        questions: [{ text: "What changed?", quote: "Chapter two text." }],
      };
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
      return {
        analysis: "Ch1 is about hope.",
        themes: [{ name: "hope", quotes: ["Chapter one text."] }],
        questions: [{ text: "What is hope here?", quote: "Chapter one text." }],
      };
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

  it("M37 §D1: unlike 'notes' mode, 'full' mode re-analyzes a chapter already covered under the current brief", async () => {
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

    await runThematicDigest(db, provider, resource, sections, 0, 0, undefined, undefined, "notes");
    expect(calls).toBe(1);
    // Same brief, same range — "notes" mode would skip this as already
    // covered (the test above), but "full" is the reader explicitly asking
    // for the deeper pass regardless.
    await runThematicDigest(db, provider, resource, sections, 0, 0, undefined, undefined, "full");
    expect(calls).toBe(2);
    db.close();
  });

  it("M37 §C1: a 'full' re-read's theme quotes merge back into the chapter's substrate", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sectionText = "Chapter one text, with a passage worth remembering in it.";
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: sectionText }];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => ({
      analysis: "analysis",
      themes: [{ name: "memory", quotes: ["a passage worth remembering"] }],
      questions: [],
    }));

    await runThematicDigest(db, provider, resource, sections, 0, 0, undefined, undefined, "full");

    const substrate = getChapterSubstrate(db, resource.id, 0);
    const match = substrate?.passages.find((p) => p.quote === "a passage worth remembering");
    expect(match).toBeDefined();
    expect(match?.drawnByBriefHashes).toEqual([hashBrief("")]);
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
      // M37 §B: match on the chapter label, not the raw text — see the
      // first test's comment on why.
      if (req.input.includes("section 1")) throw new LLMError("rate_limit", "slow down");
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
      // M37 §B: match on the chapter label, not the raw text — see the
      // first test's comment on why.
      if (req.input.includes("section 0")) {
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

describe("runThematicDigest — M34 §C0 chains distillation onto the run", () => {
  it("distils the book-level themes once new chapters are committed", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text." },
      { spineIndex: 1, href: "b", text: "Chapter two text." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(
      (req) =>
        // M37 §B: match on the chapter label, not the raw text — see the
        // first test's comment on why.
        req.input.includes("section 0")
          ? {
              analysis: "Ch1 is about fate.",
              themes: [{ name: "fate as pull", quotes: ["Chapter one text."] }],
              questions: [],
            }
          : {
              analysis: "Ch2 is about fate too.",
              themes: [{ name: "fate as trap", quotes: ["Chapter two text."] }],
              questions: [],
            },
      100_000,
      () => ({ themes: [{ name: "Fate", children: ["fate as pull", "fate as trap"] }] }),
    );

    const run = await runThematicDigest(db, provider, resource, sections, 0, 1);
    expect(run.status).toBe("completed");

    const bookThemes = listBookThemes(db, resource.id);
    expect(bookThemes.map((t) => t.name)).toEqual(["Fate"]);
    expect(bookThemes[0].children).toEqual(["fate as pull", "fate as trap"]);
    db.close();
  });

  it("a failed distillation still leaves the thematic run completed", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(
      () => ({
        analysis: "Ch1 is about fate.",
        themes: [{ name: "fate", quotes: ["Chapter one text."] }],
        questions: [],
      }),
      100_000,
      () => {
        throw new Error("distillation endpoint down");
      },
    );

    const run = await runThematicDigest(db, provider, resource, sections, 0, 0);
    expect(run.status).toBe("completed");
    expect(listBookThemes(db, resource.id)).toEqual([]);
    db.close();
  });

  it("does not re-run distillation on a no-op re-run (nothing new was committed)", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);
    putBrief(db, resource.id, "a brief");

    let distillationCalls = 0;
    const provider = makeProvider(
      () => ({
        analysis: "Ch1 is about fate.",
        themes: [{ name: "fate", quotes: ["Chapter one text."] }],
        questions: [],
      }),
      100_000,
      () => {
        distillationCalls++;
        return { themes: [{ name: "Fate", children: ["fate"] }] };
      },
    );

    await runThematicDigest(db, provider, resource, sections, 0, 0);
    expect(distillationCalls).toBe(1);
    await runThematicDigest(db, provider, resource, sections, 0, 0);
    expect(distillationCalls).toBe(1); // same brief, already covered — thematic pass skipped, so is distillation
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
      themes: [
        { name: "indifference", quotes: ["the world went on without comment"] },
        { name: "domesticity", quotes: ["The cat sat on the mat"] },
      ],
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
    expect(line).toContain("themes=2/12");
    expect(line).toContain("questions=2/3");
    expect(line).toContain("quotes_located=1/2");
    db.close();
  });

  it("carries each part's original quote through the merge untouched (§B3), rather than letting the model re-emit it", async () => {
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
    let partCall = 0;
    const provider = makeProvider((req) => {
      if (req.instructions.startsWith("You are merging")) {
        // If mergeThematicParts ever read a `questions` field off this
        // response instead of assembling it in code, this fabricated quote
        // would show up as a surviving (and locatable-looking) question —
        // it doesn't, because the merge schema no longer has that key.
        return { analysis: "Merged.", themes: ["the sea"], questions: [{ text: "Merge-invented?", quote: "never in the text" }] };
      }
      partCall++;
      return {
        analysis: `Part ${partCall}`,
        themes: [{ name: "the sea", quotes: ["the sea"] }],
        // Part 1's quote is real (it's a sentence in `paragraph`); part 2's
        // is fabricated, same as before — the point is that the merge no
        // longer blurs the two together.
        questions: [
          {
            text: `Q${partCall}`,
            quote: partCall === 1 ? "Sentence about the sea." : "a sentence that was never written",
          },
        ],
      };
    }, 1000, undefined, () => ({
      // M37 §B: the thing that now needs to force a 2-chunk split is the
      // chapter's *substrate*, not its raw text — one small locatable
      // passage plus one long claim, which `serializeSubstrateForPrompt`
      // turns into paragraphs sized to overflow the same 875-char budget
      // via the same overlap mechanism `splitIntoChunks` already gave the
      // raw-text version of this test.
      passages: [{ quote: "sea" }],
      claims: [{ claim: "This chapter is about the sea. ".repeat(50), holder: null }],
    }));

    const log = captureShapeLog();
    try {
      await runThematicDigest(db, provider, resource, sections, 3, 3);
    } finally {
      log.restore();
    }

    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toContain("spine=3");
    expect(log.lines[0]).toMatch(/parts=(?!1\b)\d+/);
    expect(log.lines[0]).toContain("questions=2/3");
    expect(log.lines[0]).toContain("quotes_located=1/2");
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

// ---------------------------------------------------------------------------
// M35 §C1/§C2/§C3 — themes carry quotes
// ---------------------------------------------------------------------------

describe("runThematicDigest — M35 §C1 themes carry quotes", () => {
  it("stores a theme's verbatim quotes alongside its name, and a question's valid theme reference survives", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => ({
      analysis: "Ch1 is about autonomy.",
      themes: [{ name: "autonomy", quotes: ["Chapter one text."] }],
      questions: [{ text: "Why does X choose?", quote: "Chapter one text.", theme: "autonomy" }],
    }));

    await runThematicDigest(db, provider, resource, sections, 0, 0);
    const digest = getThematicDigest(db, resource.id, 0)!;
    expect(digest.themes).toEqual([{ name: "autonomy", quotes: ["Chapter one text."] }]);
    expect(digest.questions[0].theme).toBe("autonomy");
    db.close();
  });

  it("nulls out a question's theme reference when it doesn't name one of this part's own themes", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => ({
      analysis: "Ch1 is about autonomy.",
      themes: [{ name: "autonomy", quotes: ["Chapter one text."] }],
      // "consequence" was never proposed as a theme for this part — a
      // hallucinated or stale reference, dropped rather than trusted.
      questions: [{ text: "What happens next?", quote: "Chapter one text.", theme: "consequence" }],
    }));

    await runThematicDigest(db, provider, resource, sections, 0, 0);
    const digest = getThematicDigest(db, resource.id, 0)!;
    expect(digest.questions[0].theme).toBeNull();
    db.close();
  });
});

describe("runThematicDigest — M35 §C3 evidence-based dropping", () => {
  it("drops an unlocatable quote from a theme but keeps the theme if another quote of its still locates", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => ({
      analysis: "Ch1 is about autonomy.",
      themes: [{ name: "autonomy", quotes: ["Chapter one text.", "a sentence that was never written"] }],
      questions: [],
    }));

    await runThematicDigest(db, provider, resource, sections, 0, 0);
    const digest = getThematicDigest(db, resource.id, 0)!;
    expect(digest.themes).toEqual([{ name: "autonomy", quotes: ["Chapter one text."] }]);
    db.close();
  });

  it("drops a theme entirely once none of its quotes locate — an unevidenced theme never survives", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [{ spineIndex: 0, href: "a", text: "Chapter one text." }];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => ({
      analysis: "Ch1 is about autonomy.",
      themes: [
        { name: "autonomy", quotes: ["Chapter one text."] },
        { name: "invented", quotes: ["a sentence that was never written"] },
      ],
      questions: [],
    }));

    await runThematicDigest(db, provider, resource, sections, 0, 0);
    const digest = getThematicDigest(db, resource.id, 0)!;
    expect(digest.themes.map((t) => t.name)).toEqual(["autonomy"]);
    db.close();
  });
});

describe("runThematicDigest — M35 §C5 wires evidenced themes into real highlights", () => {
  it("a completed run leaves a thematic-origin, honey-kind highlight for each surviving theme quote", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text about autonomy." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => ({
      analysis: "Ch1 is about autonomy.",
      themes: [{ name: "autonomy", quotes: ["Chapter one text about autonomy."] }],
      questions: [],
    }));

    await runThematicDigest(db, provider, resource, sections, 0, 0);

    const highlights = listHighlightsForResource(db, resource.id);
    expect(highlights).toHaveLength(1);
    expect(highlights[0].origin).toBe("thematic");
    expect(highlights[0].kind).toBe("honey");
    expect(highlights[0].exact).toBe("Chapter one text about autonomy.");
    db.close();
  });
});

describe("runThematicDigest — M35 §C1 merge reattaches theme quotes", () => {
  it("attaches quotes from the originating part to a merged theme name, and drops a merge-invented name no part matches", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const paragraph = "Sentence about the sea. ".repeat(40);
    const sections: ResourceTextSection[] = [
      { spineIndex: 3, href: "a", text: `${paragraph}\n\n${paragraph}` },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider((req) => {
      if (req.instructions.startsWith("You are merging")) {
        // "invented theme" names nothing any part proposed — must not
        // survive with fabricated quotes just because the merge said so.
        return { analysis: "Merged.", themes: ["the sea", "invented theme"] };
      }
      return {
        analysis: "Part.",
        themes: [{ name: "the sea", quotes: ["Sentence about the sea."] }],
        questions: [],
      };
    }, 1000);

    await runThematicDigest(db, provider, resource, sections, 3, 3);
    const digest = getThematicDigest(db, resource.id, 3)!;
    expect(digest.themes).toEqual([{ name: "the sea", quotes: ["Sentence about the sea."] }]);
    db.close();
  });
});

describe("runThematicDigest — M35 §E1 zone sentences", () => {
  it("stores a theme's zone start/end sentences alongside its quotes", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const sections: ResourceTextSection[] = [
      { spineIndex: 0, href: "a", text: "Chapter one text about autonomy. It runs for one stretch." },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider(() => ({
      analysis: "Ch1 is about autonomy.",
      themes: [
        {
          name: "autonomy",
          quotes: ["Chapter one text about autonomy."],
          zoneStart: "Chapter one text about autonomy.",
          zoneEnd: "It runs for one stretch.",
        },
      ],
      questions: [],
    }));

    await runThematicDigest(db, provider, resource, sections, 0, 0);
    const digest = getThematicDigest(db, resource.id, 0)!;
    expect(digest.themes[0].zoneStart).toBe("Chapter one text about autonomy.");
    expect(digest.themes[0].zoneEnd).toBe("It runs for one stretch.");
    db.close();
  });

  it("carries a merged theme's zone sentences through from the originating part, same as its quotes", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    const paragraph = "Sentence about the sea. ".repeat(40);
    const sections: ResourceTextSection[] = [
      { spineIndex: 3, href: "a", text: `${paragraph}\n\n${paragraph}` },
    ];
    seedSections(db, resource.id, sections);

    const provider = makeProvider((req) => {
      if (req.instructions.startsWith("You are merging")) {
        return { analysis: "Merged.", themes: ["the sea"] };
      }
      return {
        analysis: "Part.",
        themes: [
          {
            name: "the sea",
            quotes: ["Sentence about the sea."],
            zoneStart: "Sentence about the sea.",
            zoneEnd: "Sentence about the sea.",
          },
        ],
        questions: [],
      };
    }, 1000);

    await runThematicDigest(db, provider, resource, sections, 3, 3);
    const digest = getThematicDigest(db, resource.id, 3)!;
    expect(digest.themes[0].zoneStart).toBe("Sentence about the sea.");
    expect(digest.themes[0].zoneEnd).toBe("Sentence about the sea.");
    db.close();
  });
});
