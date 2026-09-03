import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { buildDigestStatus } from "./digest.js";

type Db = ReturnType<typeof createDb>;

function seedScanResource(db: Db, id: string) {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at, kind, text_layer)
     VALUES (@id, 'A Scanned Paper', NULL, 'pdf', '/tmp/x.pdf', '{}', @now, 'document', 0)`,
  ).run({ id, now: new Date().toISOString() });
}

describe("buildDigestStatus", () => {
  // M39 §E1 (PDF.md §6): a `text_layer = 0` scan imports with zero
  // `resource_text` rows — the digest route assumed at least one section
  // existed. This locks in the empty path: no chapters, no book digest, no
  // run, and — the actual risk — no thrown error.
  it("returns an empty status for a resource with no resource_text rows, rather than throwing", () => {
    const db = createDb(":memory:");
    seedScanResource(db, "res-1");

    const status = buildDigestStatus(db, "res-1", new Set(), false);

    expect(status.totalChapters).toBe(0);
    expect(status.chapters).toEqual([]);
    expect(status.book).toBeNull();
    expect(status.run).toBeNull();
    db.close();
  });
});
