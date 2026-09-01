import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { getChapterSubstrate, putChapterSubstrate } from "./substrateStore.js";
import { mergeQuotesIntoSubstrate } from "./substrateBuild.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1"): void {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Test Book', 'Test Author', 'epub', 'x.epub', '{}', @importedAt)`,
  ).run({ id, importedAt: new Date().toISOString() });
}

describe("mergeQuotesIntoSubstrate", () => {
  it("M37 §C1: appends a quote the brief-blind pass never kept, crediting the brief that surfaced it", () => {
    const db = createDb(":memory:");
    seedResource(db);
    putChapterSubstrate(db, {
      resourceId: "res-1",
      spineIndex: 0,
      passages: [],
      claims: [],
      sourceHash: "hash-0",
    });
    const sectionText = "Alice was beginning to get very tired of sitting by her sister on the bank.";
    const quote = "very tired of sitting by her sister";

    mergeQuotesIntoSubstrate(db, "res-1", 0, sectionText, [quote], "brief-a");

    const substrate = getChapterSubstrate(db, "res-1", 0);
    expect(substrate?.passages).toHaveLength(1);
    expect(substrate?.passages[0].quote).toBe(quote);
    expect(substrate?.passages[0].drawnByBriefHashes).toEqual(["brief-a"]);
    db.close();
  });

  it("M37 §C2: a second brief drawing on the same quote credits it rather than duplicating the passage", () => {
    const db = createDb(":memory:");
    seedResource(db);
    putChapterSubstrate(db, {
      resourceId: "res-1",
      spineIndex: 0,
      passages: [],
      claims: [],
      sourceHash: "hash-0",
    });
    const sectionText = "Alice was beginning to get very tired of sitting by her sister on the bank.";
    const quote = "very tired of sitting by her sister";

    mergeQuotesIntoSubstrate(db, "res-1", 0, sectionText, [quote], "brief-a");
    mergeQuotesIntoSubstrate(db, "res-1", 0, sectionText, [quote], "brief-b");
    // Same brief drawing on it again is a no-op on the credit, not a third entry.
    mergeQuotesIntoSubstrate(db, "res-1", 0, sectionText, [quote], "brief-a");

    const substrate = getChapterSubstrate(db, "res-1", 0);
    expect(substrate?.passages).toHaveLength(1);
    expect(substrate?.passages[0].drawnByBriefHashes).toEqual(["brief-a", "brief-b"]);
    db.close();
  });

  it("M37 §C2: eviction over the cap keeps quotes two+ briefs drew on over one no brief ever drew on", () => {
    const db = createDb(":memory:");
    seedResource(db);
    // Short section text -> the length-scaled budget clamps to A2's floor
    // (1500 tokens), so passages get 60% of it = 900 tokens = 3150 chars.
    const sectionText = "A short chapter.";
    putChapterSubstrate(db, {
      resourceId: "res-1",
      spineIndex: 0,
      passages: [
        // Never drawn on by any brief — §C2 says this is first to go.
        { quote: "z".repeat(2450), prefix: "", suffix: "", drawnByBriefHashes: [] },
        // Two briefs independently selected this one — §C2 says keep it.
        { quote: "q".repeat(2450), prefix: "", suffix: "", drawnByBriefHashes: ["brief-x", "brief-y"] },
      ],
      claims: [],
      sourceHash: "hash-0",
    });

    // No new quotes surfaced this pass — just re-clamping an already
    // over-cap substrate (1400 of 900 tokens) is enough to trigger eviction.
    mergeQuotesIntoSubstrate(db, "res-1", 0, sectionText, [], "brief-z");

    const substrate = getChapterSubstrate(db, "res-1", 0);
    expect(substrate?.passages).toHaveLength(1);
    expect(substrate?.passages[0].drawnByBriefHashes).toEqual(["brief-x", "brief-y"]);
    db.close();
  });

  it("is a no-op when the chapter has no substrate row yet", () => {
    const db = createDb(":memory:");
    seedResource(db);
    mergeQuotesIntoSubstrate(db, "res-1", 0, "Some text.", ["Some text."], "brief-a");
    expect(getChapterSubstrate(db, "res-1", 0)).toBeUndefined();
    db.close();
  });
});
