import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { buildAudioState } from "./audio.js";

type Db = ReturnType<typeof createDb>;

function seedScanResource(db: Db, id: string) {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at, kind, text_layer)
     VALUES (@id, 'A Scanned Paper', NULL, 'pdf', '/tmp/x.pdf', '{}', @now, 'document', 0)`,
  ).run({ id, now: new Date().toISOString() });
}

describe("buildAudioState", () => {
  // M39 §E1 (PDF.md §6): a scan has zero `resource_text` rows, so there are
  // no spine indices to check against the render cache — this locks in that
  // `GET/PUT /:id/audio` return a real (empty) state rather than throwing.
  it("returns an empty cachedSpineIndices for a resource with no resource_text rows", () => {
    const db = createDb(":memory:");
    seedScanResource(db, "res-1");

    const state = buildAudioState(db, "res-1");

    expect(state.cachedSpineIndices).toEqual([]);
    expect(state.voiceMode).toBe("single");
    db.close();
  });
});
