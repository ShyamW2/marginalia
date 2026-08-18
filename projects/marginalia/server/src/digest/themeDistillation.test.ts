import { describe, expect, it } from "vitest";
import type { Resource } from "@marginalia/shared";
import { createDb } from "../db.js";
import type { LLMExtractRequest, LLMProvider } from "../llm/provider.js";
import { putThematicDigest } from "./thematicStore.js";
import { listBookThemes } from "./canonicalThemes.js";
import { runThemeDistillation } from "./themeDistillation.js";

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

describe("runThemeDistillation", () => {
  it("groups chapter themes under book-level parents and persists the result", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "Gregor wakes alone.",
      themes: ["loneliness", "alienation"],
      questions: [],
    });
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 1,
      briefHash: "b",
      briefText: "",
      analysis: "The family withdraws.",
      themes: ["shame"],
      questions: [],
    });

    const provider = makeProvider(() => ({
      themes: [
        { name: "Isolation", children: ["loneliness", "alienation"] },
        { name: "Guilt", children: ["shame"] },
      ],
    }));

    const result = await runThemeDistillation(db, provider, resource);
    expect(result.bookThemes.map((t) => t.name).sort()).toEqual(["Guilt", "Isolation"]);
    const byName = new Map(result.bookThemes.map((t) => [t.name, t]));
    expect(byName.get("Isolation")?.children).toEqual(["alienation", "loneliness"]);
    expect(byName.get("Guilt")?.children).toEqual(["shame"]);
    expect(listBookThemes(db, "res-1")).toEqual(result.bookThemes);
    db.close();
  });

  it("drops a hallucinated child that isn't a real chapter-level theme — code disposes", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: ["loneliness"],
      questions: [],
    });

    const provider = makeProvider(() => ({
      themes: [{ name: "Isolation", children: ["loneliness", "a-theme-that-was-never-tagged"] }],
    }));

    const result = await runThemeDistillation(db, provider, resource);
    expect(result.bookThemes).toHaveLength(1);
    expect(result.bookThemes[0].children).toEqual(["loneliness"]);
    db.close();
  });

  it("assigns a chapter theme the model dropped to its nearest book-level parent — every theme gets a parent", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    putThematicDigest(db, {
      resourceId: "res-1",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: ["loneliness", "solitude"],
      questions: [],
    });

    // The model only assigns "loneliness"; "solitude" is dropped entirely.
    const provider = makeProvider(() => ({
      themes: [{ name: "Isolation", children: ["loneliness"] }],
    }));

    const result = await runThemeDistillation(db, provider, resource);
    expect(result.bookThemes).toHaveLength(1);
    expect(result.bookThemes[0].children).toEqual(["loneliness", "solitude"]);
    db.close();
  });

  it("is a no-op when no chapter has a thematic layer yet", async () => {
    const db = createDb(":memory:");
    const resource = makeResource();
    seedResource(db, resource);
    let calls = 0;
    const provider = makeProvider(() => {
      calls++;
      return { themes: [] };
    });

    const result = await runThemeDistillation(db, provider, resource);
    expect(result.bookThemes).toEqual([]);
    expect(calls).toBe(0);
    db.close();
  });

  it("matches a distilled theme against the library's existing canonical vocabulary", async () => {
    const db = createDb(":memory:");
    const bookA = makeResource({ id: "res-a", title: "Book A" });
    const bookB = makeResource({ id: "res-b", title: "Book B" });
    seedResource(db, bookA);
    seedResource(db, bookB);
    putThematicDigest(db, {
      resourceId: "res-a",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: ["loneliness"],
      questions: [],
    });
    putThematicDigest(db, {
      resourceId: "res-b",
      spineIndex: 0,
      briefHash: "b",
      briefText: "",
      analysis: "a",
      themes: ["solitude"],
      questions: [],
    });

    const providerA = makeProvider(() => ({ themes: [{ name: "Isolation", children: ["loneliness"] }] }));
    const resultA = await runThemeDistillation(db, providerA, bookA);

    const providerB = makeProvider(() => ({ themes: [{ name: "isolation", children: ["solitude"] }] }));
    const resultB = await runThemeDistillation(db, providerB, bookB);

    expect(resultB.bookThemes[0].id).toBe(resultA.bookThemes[0].id);
    expect(resultB.bookThemes[0].colorIndex).toBe(resultA.bookThemes[0].colorIndex);
    db.close();
  });
});
