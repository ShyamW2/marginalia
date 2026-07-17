import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  levenshteinSimilarity,
  listExistingConcepts,
  matchConcept,
  slugify,
  type ExistingConcept,
} from "./concepts.js";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Bildungsroman")).toBe("bildungsroman");
    expect(slugify("The Absurd")).toBe("the-absurd");
  });

  it("strips punctuation", () => {
    expect(slugify("Kafka's Metamorphosis!")).toBe("kafka-s-metamorphosis");
  });
});

describe("levenshteinSimilarity", () => {
  it("is 1 for identical strings", () => {
    expect(levenshteinSimilarity("absurdism", "absurdism")).toBe(1);
  });

  it("is 0 for completely different strings of equal length", () => {
    expect(levenshteinSimilarity("abc", "xyz")).toBe(0);
  });

  it("is high for a near-miss typo", () => {
    expect(levenshteinSimilarity("absurdism", "absurdisim")).toBeGreaterThanOrEqual(0.85);
  });
});

describe("matchConcept", () => {
  const existing: ExistingConcept[] = [
    { name: "Absurdism", aliases: ["The Absurd"], relPath: "Concepts/Absurdism.md" },
    { name: "Bildungsroman", aliases: [], relPath: "Concepts/Bildungsroman.md" },
  ];

  it("matches on exact slug-normalized name", () => {
    const match = matchConcept(existing, { name: "absurdism", aliases: [] });
    expect(match?.relPath).toBe("Concepts/Absurdism.md");
  });

  it("matches on alias hit", () => {
    const match = matchConcept(existing, { name: "The Absurd", aliases: [] });
    expect(match?.relPath).toBe("Concepts/Absurdism.md");
  });

  it("matches on a proposed alias equalling an existing name", () => {
    const match = matchConcept(existing, {
      name: "Something New",
      aliases: ["Bildungsroman"],
    });
    expect(match?.relPath).toBe("Concepts/Bildungsroman.md");
  });

  it("matches on fuzzy (Levenshtein) similarity", () => {
    const match = matchConcept(existing, { name: "Absurdisim", aliases: [] });
    expect(match?.relPath).toBe("Concepts/Absurdism.md");
  });

  it("returns null when nothing is close enough", () => {
    const match = matchConcept(existing, { name: "Dramatic Irony", aliases: [] });
    expect(match).toBeNull();
  });
});

describe("listExistingConcepts", () => {
  let vaultPath: string;

  beforeAll(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "marginalia-vault-"));
    fs.mkdirSync(path.join(vaultPath, "Concepts"));
    fs.writeFileSync(
      path.join(vaultPath, "Concepts", "Absurdism.md"),
      "---\naliases:\n  - The Absurd\n  - Absurdist Philosophy\ncreated: 2026-07-17T00:00:00.000Z\n---\n\nA gloss.\n",
    );
    fs.writeFileSync(
      path.join(vaultPath, "Concepts", "Bildungsroman.md"),
      "---\naliases:\ncreated: 2026-07-17T00:00:00.000Z\n---\n\nA gloss.\n",
    );
  });

  afterAll(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it("parses name + aliases from frontmatter", () => {
    const concepts = listExistingConcepts(vaultPath);
    expect(concepts).toHaveLength(2);
    const absurdism = concepts.find((c) => c.name === "Absurdism");
    expect(absurdism?.aliases).toEqual(["The Absurd", "Absurdist Philosophy"]);
  });

  it("returns an empty list when the Concepts folder doesn't exist", () => {
    expect(listExistingConcepts(path.join(vaultPath, "nonexistent"))).toEqual([]);
  });
});
