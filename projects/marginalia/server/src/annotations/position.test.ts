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

  it("returns null when the spine section doesn't exist", () => {
    seedSection(db, "res-1", 0, "only section");

    const percent = computeHighlightPositionPercent(db, "res-1", 5, {
      exact: "only",
      prefix: "",
      suffix: " section",
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
