import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { renderDigestMarkdown } from "./markdown.js";
import { putBookDigest, putChapterDigest } from "./store.js";
import type { Resource } from "@marginalia/shared";

function seedResource(db: ReturnType<typeof createDb>, resource: Resource): void {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (@id, @title, @author, @format, 'x.epub', @metadata, @importedAt)`,
  ).run({ ...resource, metadata: JSON.stringify(resource.metadata) });
}

function seedSections(
  db: ReturnType<typeof createDb>,
  resourceId: string,
  sections: { spineIndex: number; href: string; text: string }[],
): void {
  const insert = db.prepare(
    "INSERT INTO resource_text (resource_id, spine_index, href, text) VALUES (?, ?, ?, ?)",
  );
  for (const s of sections) insert.run(resourceId, s.spineIndex, s.href, s.text);
}

const resource: Resource = {
  id: "res-1",
  title: "Test Book",
  author: "Test Author",
  format: "epub",
  metadata: { chapterTitles: { "0": "The Beginning" } },
  importedAt: new Date().toISOString(),
};

describe("renderDigestMarkdown", () => {
  it("marks a book with no digest yet as not-yet-digested, chapter by chapter", () => {
    const db = createDb(":memory:");
    seedResource(db, resource);
    seedSections(db, resource.id, [
      { spineIndex: 0, href: "a", text: "..." },
      { spineIndex: 1, href: "b", text: "..." },
    ]);
    const markdown = renderDigestMarkdown(db, resource);
    expect(markdown).toContain("Not yet digested");
    expect(markdown).toContain("The Beginning — not yet digested");
    expect(markdown).toContain("2 of 2 chapters not yet digested");
    db.close();
  });

  it("renders synopsis, cast, themes, and per-chapter summaries once digested", () => {
    const db = createDb(":memory:");
    seedResource(db, resource);
    seedSections(db, resource.id, [{ spineIndex: 0, href: "a", text: "..." }]);
    putChapterDigest(db, {
      resourceId: resource.id,
      spineIndex: 0,
      summary: "Alice arrives.",
      themes: ["arrival"],
      characters: ["Alice"],
      sourceHash: "h1",
    });
    putBookDigest(db, {
      resourceId: resource.id,
      synopsis: "A book about arrival.",
      cast: [{ name: "Alice", description: "the protagonist" }],
      themes: ["arrival"],
    });

    const markdown = renderDigestMarkdown(db, resource);
    expect(markdown).toContain("A book about arrival.");
    expect(markdown).toContain("**Alice** — the protagonist");
    expect(markdown).toContain("Alice arrives.");
    expect(markdown).not.toContain("not yet digested");
    db.close();
  });

  it("is deterministic — regenerating with nothing changed is byte-identical", () => {
    const db = createDb(":memory:");
    seedResource(db, resource);
    seedSections(db, resource.id, [{ spineIndex: 0, href: "a", text: "..." }]);
    putChapterDigest(db, {
      resourceId: resource.id,
      spineIndex: 0,
      summary: "Alice arrives.",
      themes: [],
      characters: [],
      sourceHash: "h1",
    });

    const first = renderDigestMarkdown(db, resource);
    const second = renderDigestMarkdown(db, resource);
    expect(first).toBe(second);
    db.close();
  });
});
