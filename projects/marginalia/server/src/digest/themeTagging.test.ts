import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import type { LLMExtractRequest, LLMProvider } from "../llm/provider.js";
import { createHighlight } from "../annotations/highlights.js";
import { listThemesForHighlight } from "../annotations/highlightThemes.js";
import { putThematicDigest } from "./thematicStore.js";
import { runThemeTagging, tagHighlightThemes } from "./themeTagging.js";

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

function seedResource(db: ReturnType<typeof createDb>, id: string): void {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ id, now: new Date().toISOString() });
}

describe("tagHighlightThemes", () => {
  it("filters the model's proposed themes down to the actual vocabulary — code disposes", async () => {
    const provider = makeProvider(() => ({ themes: ["autonomy", "a-theme-not-in-the-vocabulary"] }));
    const highlight = {
      id: "h-1",
      resourceId: "res-1",
      exact: "quote",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose" as const,
      origin: "reader" as const,
      importance: 0 as const,
      note: "",
      panelDx: 0,
      panelDy: 0,
      panelWidth: null,
      panelHeight: null,
      definition: "",
      definitionSource: "" as const,
      createdAt: new Date().toISOString(),
    };
    const themes = await tagHighlightThemes(provider, highlight, "", ["autonomy", "consequence"]);
    expect(themes).toEqual(["autonomy"]);
  });

  it("returns an empty array without calling the provider when the vocabulary is empty", async () => {
    let calls = 0;
    const provider = makeProvider(() => {
      calls++;
      return { themes: [] };
    });
    const highlight = {
      id: "h-1",
      resourceId: "res-1",
      exact: "quote",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose" as const,
      origin: "reader" as const,
      importance: 0 as const,
      note: "",
      panelDx: 0,
      panelDy: 0,
      panelWidth: null,
      panelHeight: null,
      definition: "",
      definitionSource: "" as const,
      createdAt: new Date().toISOString(),
    };
    const themes = await tagHighlightThemes(provider, highlight, "", []);
    expect(themes).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe("runThemeTagging", () => {
  it("tags every untagged highlight against the resource's theme vocabulary", async () => {
    const db = createDb(":memory:");
    seedResource(db, "res-1");
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: [{ name: "autonomy", quotes: ["q"] }, { name: "consequence", quotes: ["q"] }],
      questions: [],
    });
    const highlight = createHighlight(db, {
      resourceId: "res-1",
      exact: "a passage about choice",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });

    const provider = makeProvider(() => ({ themes: ["autonomy"] }));
    const tagged = await runThemeTagging(db, provider, "res-1");
    expect(tagged).toBe(1);
    expect(listThemesForHighlight(db, highlight.id)).toEqual(["autonomy"]);
    db.close();
  });

  it("never re-tags a highlight that already has themes, even across separate runs", async () => {
    const db = createDb(":memory:");
    seedResource(db, "res-1");
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: [{ name: "autonomy", quotes: ["q"] }],
      questions: [],
    });
    createHighlight(db, {
      resourceId: "res-1",
      exact: "a passage",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });

    let calls = 0;
    const provider = makeProvider(() => {
      calls++;
      return { themes: ["autonomy"] };
    });
    await runThemeTagging(db, provider, "res-1");
    expect(calls).toBe(1);
    await runThemeTagging(db, provider, "res-1");
    expect(calls).toBe(1); // already tagged — never re-processed
    db.close();
  });

  it("is a no-op when the resource has no thematic layer yet", async () => {
    const db = createDb(":memory:");
    seedResource(db, "res-1");
    createHighlight(db, {
      resourceId: "res-1",
      exact: "a passage",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });

    let calls = 0;
    const provider = makeProvider(() => {
      calls++;
      return { themes: [] };
    });
    const tagged = await runThemeTagging(db, provider, "res-1");
    expect(tagged).toBe(0);
    expect(calls).toBe(0);
    db.close();
  });

  it("cancelling stops before the next highlight, leaving already-tagged ones tagged", async () => {
    const db = createDb(":memory:");
    seedResource(db, "res-1");
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: [{ name: "autonomy", quotes: ["q"] }],
      questions: [],
    });
    const first = createHighlight(db, {
      resourceId: "res-1",
      exact: "first passage",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/2)",
      spineIndex: 0,
      kind: "rose",
    });
    const second = createHighlight(db, {
      resourceId: "res-1",
      exact: "second passage",
      prefix: "",
      suffix: "",
      cfi: "epubcfi(/6/4!/4/4)",
      spineIndex: 0,
      kind: "rose",
    });

    const controller = new AbortController();
    const provider = makeProvider(() => {
      controller.abort();
      return { themes: ["autonomy"] };
    });
    const tagged = await runThemeTagging(db, provider, "res-1", controller.signal);
    expect(tagged).toBe(1);
    const untagged = [first, second].filter((h) => listThemesForHighlight(db, h.id).length === 0);
    expect(untagged).toHaveLength(1);
    db.close();
  });
});
