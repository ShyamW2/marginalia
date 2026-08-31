import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { replaceBookThemes, resolveCanonicalThemes } from "./canonicalThemes.js";
import { selectThematicChapters, type ThematicCandidate } from "./thematicSelection.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1"): void {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ id, now: new Date().toISOString() });
}

function candidate(spineIndex: number, themes: string[]): ThematicCandidate {
  return { spineIndex, analysis: `analysis ${spineIndex}`, themes };
}

describe("selectThematicChapters", () => {
  it("falls back to current + previous only when no distillation has run yet", () => {
    const db = createDb(":memory:");
    seedResource(db);
    const candidates = [0, 1, 2, 3, 4].map((i) => candidate(i, [`theme ${i}`]));

    const selected = selectThematicChapters(db, "res-1", candidates, 4);
    expect(selected.map((c) => c.spineIndex)).toEqual([3, 4]);
    db.close();
  });

  it("falls back to current + previous when the highlight chapter has no thematic vector of its own", () => {
    const db = createDb(":memory:");
    seedResource(db);
    const fate = resolveCanonicalThemes(db, ["Fate"])[0];
    replaceBookThemes(db, "res-1", [fate], new Map([[fate.id, ["fate a", "fate b"]]]));

    // chapter 4 (the highlight) is not among the candidates at all.
    const candidates = [2, 3].map((i) => candidate(i, ["fate a"]));
    const selected = selectThematicChapters(db, "res-1", candidates, 4);
    expect(selected.map((c) => c.spineIndex)).toEqual([3]);
    db.close();
  });

  it("ranks by weighted parent-theme overlap with the highlight chapter, not raw theme overlap", () => {
    const db = createDb(":memory:");
    seedResource(db);
    const fate = resolveCanonicalThemes(db, ["Fate"])[0];
    const identity = resolveCanonicalThemes(db, ["Identity"])[0];
    replaceBookThemes(
      db,
      "res-1",
      [fate, identity],
      new Map([
        [fate.id, ["fate a", "fate b", "fate c"]],
        [identity.id, ["identity a", "identity b"]],
      ]),
    );

    const highlightChapter = candidate(10, ["fate a", "fate b", "fate c"]); // 3/3 under Fate
    const heavyOverlap = candidate(2, ["fate a", "fate b"]); // 2 under Fate — should rank first
    const lightOverlap = candidate(5, ["fate a"]); // 1 under Fate
    const noOverlap = candidate(7, ["identity a", "identity b"]); // 0 under Fate, unrelated parent
    const previous = candidate(9, []); // unconditional regardless of theme

    const selected = selectThematicChapters(
      db,
      "res-1",
      [highlightChapter, heavyOverlap, lightOverlap, noOverlap, previous],
      10,
    );

    // unconditional: 9 (previous) and 10 (current); ranked: 2 before 5; 7 excluded (score 0)
    expect(selected.map((c) => c.spineIndex)).toEqual([2, 5, 9, 10]);
    db.close();
  });

  it("caps the ranked additions, keeping the two unconditional chapters plus the top scorers", () => {
    const db = createDb(":memory:");
    seedResource(db);
    const fate = resolveCanonicalThemes(db, ["Fate"])[0];
    replaceBookThemes(db, "res-1", [fate], new Map([[fate.id, ["fate a"]]]));

    const highlightChapter = candidate(20, ["fate a"]);
    const previous = candidate(19, ["fate a"]);
    const rest = Array.from({ length: 12 }, (_, i) => candidate(i, ["fate a"]));

    const selected = selectThematicChapters(db, "res-1", [highlightChapter, previous, ...rest], 20);
    expect(selected).toHaveLength(9);
    expect(selected.map((c) => c.spineIndex)).toContain(19);
    expect(selected.map((c) => c.spineIndex)).toContain(20);
    db.close();
  });

  it("is deterministic for the same inputs", () => {
    const db = createDb(":memory:");
    seedResource(db);
    const fate = resolveCanonicalThemes(db, ["Fate"])[0];
    replaceBookThemes(db, "res-1", [fate], new Map([[fate.id, ["fate a", "fate b"]]]));

    const candidates = [0, 1, 2, 3, 4, 5].map((i) => candidate(i, i % 2 === 0 ? ["fate a"] : ["fate b"]));
    const first = selectThematicChapters(db, "res-1", candidates, 5);
    const second = selectThematicChapters(db, "res-1", candidates, 5);
    expect(second.map((c) => c.spineIndex)).toEqual(first.map((c) => c.spineIndex));
    db.close();
  });
});
