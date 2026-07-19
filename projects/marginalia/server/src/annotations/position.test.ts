import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createDb } from "../db.js";
import { computeHighlightPositionPercent } from "./position.js";

type Db = ReturnType<typeof createDb>;

function seedResource(db: Db, id: string) {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, 'Title', NULL, 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ id, now: new Date().toISOString() });
}

function seedSection(db: Db, resourceId: string, spineIndex: number, text: string) {
  db.prepare(
    `INSERT INTO resource_text (resource_id, spine_index, href, text)
     VALUES (@resourceId, @spineIndex, @href, @text)`,
  ).run({ resourceId, spineIndex, href: `ch${spineIndex}.xhtml`, text });
}

describe("computeHighlightPositionPercent", () => {
  let db: Db;

  beforeEach(() => {
    db = createDb(":memory:");
    seedResource(db, "res-1");
  });

  afterEach(() => {
    db.close();
  });

  it("computes a known position: match in the second of three equal-length sections", () => {
    // Section 0: 20 chars, section 1: 20 chars (match starts at local index 5,
    // i.e. global offset 20 + 5 = 25), section 2: 20 chars. Total 60.
    seedSection(db, "res-1", 0, "a".repeat(20));
    seedSection(db, "res-1", 1, "bbbbbTARGETbbbbbbbbb"); // "TARGET" starts at index 5
    seedSection(db, "res-1", 2, "c".repeat(20));

    const percent = computeHighlightPositionPercent(db, "res-1", 1, {
      exact: "TARGET",
      prefix: "bbbbb",
      suffix: "bbbbb",
    });

    expect(percent).toBeCloseTo(25 / 60, 10);
  });

  it("disambiguates duplicate text using prefix/suffix", () => {
    // "echo" appears twice; only the second occurrence has the right context.
    const text = "echo one here, but echo two is the target passage.";
    seedSection(db, "res-1", 0, text);

    const percent = computeHighlightPositionPercent(db, "res-1", 0, {
      exact: "echo",
      prefix: "but ",
      suffix: " two",
    });

    const expectedStart = text.indexOf("but echo two") + "but ".length;
    expect(percent).toBeCloseTo(expectedStart / text.length, 10);
  });

  it("returns null when the text can no longer be found", () => {
    seedSection(db, "res-1", 0, "nothing relevant in this section at all");

    const percent = computeHighlightPositionPercent(db, "res-1", 0, {
      exact: "missing phrase",
      prefix: "before ",
      suffix: " after",
    });

    expect(percent).toBeNull();
  });

  it("falls back to searching every section when the recorded spineIndex is stale (real data shape found in a pre-M9 database)", () => {
    // Section 0: 20 chars of unrelated boilerplate — this is what the
    // (wrong) recorded spineIndex points at. The real text lives in
    // section 1, 30 chars in.
    seedSection(db, "res-1", 0, "boilerplate front matter!!!!");
    seedSection(db, "res-1", 1, "x".repeat(30) + "REAL TEXT" + "y".repeat(20));

    const percent = computeHighlightPositionPercent(db, "res-1", 0, {
      exact: "REAL TEXT",
      prefix: "x",
      suffix: "y",
    });

    const expectedGlobalOffset = "boilerplate front matter!!!!".length + 30;
    const totalLength = "boilerplate front matter!!!!".length + 30 + 9 + 20;
    expect(percent).toBeCloseTo(expectedGlobalOffset / totalLength, 10);
  });

  it("still finds the text via fallback even when the recorded spineIndex doesn't exist at all", () => {
    seedSection(db, "res-1", 0, "only section");

    const percent = computeHighlightPositionPercent(db, "res-1", 5, {
      exact: "only",
      prefix: "",
      suffix: " section",
    });

    expect(percent).not.toBeNull();
  });

  it("returns null when the text is unfindable in any section, regardless of spineIndex", () => {
    seedSection(db, "res-1", 0, "only section");

    const percent = computeHighlightPositionPercent(db, "res-1", 5, {
      exact: "nowhere to be found",
      prefix: "",
      suffix: "",
    });

    expect(percent).toBeNull();
  });

  it("returns null for a resource with no extracted text", () => {
    seedResource(db, "res-empty");
    const percent = computeHighlightPositionPercent(db, "res-empty", 0, {
      exact: "x",
      prefix: "",
      suffix: "",
    });
    expect(percent).toBeNull();
  });
});
