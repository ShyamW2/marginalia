import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  THEME_RAMP_SIZE,
  listBookThemes,
  listCanonicalThemes,
  replaceBookThemes,
  resolveCanonicalThemes,
} from "./canonicalThemes.js";

function seedResource(db: ReturnType<typeof createDb>, id: string): void {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ id, now: new Date().toISOString() });
}

describe("resolveCanonicalThemes", () => {
  it("creates a new canonical theme per genuinely new name, coloured by its position in the list", () => {
    const db = createDb(":memory:");
    const themes = resolveCanonicalThemes(db, ["Isolation", "Doubling", "Guilt"]);
    expect(themes.map((t) => t.name)).toEqual(["Isolation", "Doubling", "Guilt"]);
    expect(themes.map((t) => t.colorIndex)).toEqual([0, 1, 2]);
    expect(listCanonicalThemes(db)).toHaveLength(3);
    db.close();
  });

  it("matches an existing canonical theme by slug and reuses its stored colour", () => {
    const db = createDb(":memory:");
    const [first] = resolveCanonicalThemes(db, ["Isolation"]);
    const [second] = resolveCanonicalThemes(db, ["  isolation  "]);
    expect(second.id).toBe(first.id);
    expect(second.colorIndex).toBe(first.colorIndex);
    expect(listCanonicalThemes(db)).toHaveLength(1);
    db.close();
  });

  it("matches near-duplicate names within the same call, not just across calls", () => {
    const db = createDb(":memory:");
    const themes = resolveCanonicalThemes(db, ["Coming of age", "Coming of age "]);
    expect(themes[0].id).toBe(themes[1].id);
    expect(listCanonicalThemes(db)).toHaveLength(1);
    db.close();
  });

  it("never reshuffles a colour once assigned, even when a later call re-mentions it at a different position", () => {
    const db = createDb(":memory:");
    const [isolation] = resolveCanonicalThemes(db, ["Isolation"]);
    expect(isolation.colorIndex).toBe(0);
    // A second book's distillation mentions two brand-new themes before
    // re-mentioning Isolation third — Isolation must keep colour 0 (its
    // original assignment), not silently become colour 2 because that's
    // where it sits in this call's list.
    const second = resolveCanonicalThemes(db, ["Foo", "Bar", "Isolation"]);
    expect(second[2].name).toBe("Isolation");
    expect(second[2].colorIndex).toBe(0);
    db.close();
  });

  it("keeps a genuine near-miss pair separate — TASKS.md's own example, below the 0.85 threshold", () => {
    // Slugified similarity("doubling", "the-double") is 0.30 — nowhere near
    // matchConcept's 0.85 gate, despite reading like a plausible near-miss.
    const db = createDb(":memory:");
    const themes = resolveCanonicalThemes(db, ["Doubling", "The double"]);
    expect(themes[0].id).not.toBe(themes[1].id);
    expect(listCanonicalThemes(db)).toHaveLength(2);
    db.close();
  });

  it("wraps colour assignment at the ramp size", () => {
    const db = createDb(":memory:");
    // Lexically distinct on purpose — "Theme 1"/"Theme 9"-style names sit
    // within matchConcept's own Levenshtein threshold of each other and
    // would collapse together, defeating the point of this test.
    const names = [
      "Isolation",
      "Guilt",
      "Doubling",
      "Alienation",
      "Betrayal",
      "Redemption",
      "Ambition",
      "Memory",
      "Justice",
      "Freedom",
    ];
    expect(names).toHaveLength(THEME_RAMP_SIZE + 2);
    const themes = resolveCanonicalThemes(db, names);
    expect(themes[THEME_RAMP_SIZE].colorIndex).toBe(0);
    expect(themes[THEME_RAMP_SIZE + 1].colorIndex).toBe(1);
    db.close();
  });
});

describe("replaceBookThemes / listBookThemes", () => {
  it("persists parents and their children, nesting specific themes under a book-level theme", () => {
    const db = createDb(":memory:");
    seedResource(db, "res-1");
    const [isolation, guilt] = resolveCanonicalThemes(db, ["Isolation", "Guilt"]);
    replaceBookThemes(
      db,
      "res-1",
      [isolation, guilt],
      new Map([
        [isolation.id, ["loneliness", "alienation"]],
        [guilt.id, ["shame"]],
      ]),
    );

    const bookThemes = listBookThemes(db, "res-1");
    expect(bookThemes).toHaveLength(2);
    const byName = new Map(bookThemes.map((t) => [t.name, t]));
    expect(byName.get("Isolation")?.children).toEqual(["alienation", "loneliness"]);
    expect(byName.get("Guilt")?.children).toEqual(["shame"]);
    db.close();
  });

  it("wholesale-replaces a resource's book themes on a rerun, leaving other resources untouched", () => {
    const db = createDb(":memory:");
    seedResource(db, "res-1");
    seedResource(db, "res-2");
    const [isolation] = resolveCanonicalThemes(db, ["Isolation"]);
    replaceBookThemes(db, "res-1", [isolation], new Map([[isolation.id, ["loneliness"]]]));
    replaceBookThemes(db, "res-2", [isolation], new Map([[isolation.id, ["solitude"]]]));

    const [guilt] = resolveCanonicalThemes(db, ["Guilt"]);
    replaceBookThemes(db, "res-1", [guilt], new Map([[guilt.id, ["shame"]]]));

    expect(listBookThemes(db, "res-1").map((t) => t.name)).toEqual(["Guilt"]);
    expect(listBookThemes(db, "res-2").map((t) => t.name)).toEqual(["Isolation"]);
    db.close();
  });

  it("returns an empty list for a resource with no distillation run yet", () => {
    const db = createDb(":memory:");
    seedResource(db, "res-1");
    expect(listBookThemes(db, "res-1")).toEqual([]);
    db.close();
  });
});
