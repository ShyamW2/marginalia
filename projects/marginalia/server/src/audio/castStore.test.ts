import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { listBookCast, saveCastScan, updateCastVoice, type CastScanCharacter } from "./castStore.js";

function seedResource(db: ReturnType<typeof createDb>, id = "res-1"): void {
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES (?, 'Test Book', 'Author', 'epub', 'x.epub', '{}', ?)`,
  ).run(id, new Date().toISOString());
}

function alice(overrides: Partial<CastScanCharacter> = {}): CastScanCharacter {
  return {
    name: "Alice",
    aliases: [],
    gender: "female",
    ageHint: "young",
    description: "the protagonist",
    voiceId: "af_alpha",
    ...overrides,
  };
}

describe("saveCastScan / listBookCast", () => {
  it("persists a fresh cast in scan order", () => {
    const db = createDb(":memory:");
    seedResource(db);
    saveCastScan(db, "res-1", [alice(), alice({ name: "Bob", gender: "male", voiceId: "am_beta" })]);

    const cast = listBookCast(db, "res-1");
    expect(cast.map((c) => c.name)).toEqual(["Alice", "Bob"]);
    expect(cast[0].voiceId).toBe("af_alpha");
    expect(cast[0].voiceLocked).toBe(false);
    db.close();
  });

  it("re-scanning replaces metadata and voice for an unlocked character, keeping its id", () => {
    const db = createDb(":memory:");
    seedResource(db);
    saveCastScan(db, "res-1", [alice()]);
    const firstId = listBookCast(db, "res-1")[0].id;

    saveCastScan(db, "res-1", [alice({ description: "updated description", voiceId: "af_beta" })]);
    const cast = listBookCast(db, "res-1");
    expect(cast).toHaveLength(1);
    expect(cast[0].id).toBe(firstId);
    expect(cast[0].description).toBe("updated description");
    expect(cast[0].voiceId).toBe("af_beta");
    db.close();
  });

  it("a locked voice survives a re-scan even when the new scan assigns a different one", () => {
    const db = createDb(":memory:");
    seedResource(db);
    saveCastScan(db, "res-1", [alice()]);
    const id = listBookCast(db, "res-1")[0].id;
    db.prepare("UPDATE book_cast SET voice_locked = 1, voice_id = 'user_choice' WHERE id = ?").run(id);

    saveCastScan(db, "res-1", [alice({ voiceId: "af_beta", description: "re-scanned" })]);
    const cast = listBookCast(db, "res-1");
    expect(cast).toHaveLength(1);
    expect(cast[0].voiceId).toBe("user_choice");
    expect(cast[0].voiceLocked).toBe(true);
    // Non-voice metadata still refreshes from the new scan.
    expect(cast[0].description).toBe("re-scanned");
    db.close();
  });

  it("does not delete a character missing from a later scan", () => {
    const db = createDb(":memory:");
    seedResource(db);
    saveCastScan(db, "res-1", [alice(), alice({ name: "Bob", voiceId: "am_beta" })]);
    saveCastScan(db, "res-1", [alice()]);
    expect(listBookCast(db, "res-1").map((c) => c.name)).toEqual(["Alice", "Bob"]);
    db.close();
  });

  it("a scan is all-or-nothing: a failure partway through leaves no partial write", () => {
    const db = createDb(":memory:");
    seedResource(db);
    const characters = [alice(), alice({ name: null as unknown as string, voiceId: "am_beta" })];
    expect(() => saveCastScan(db, "res-1", characters)).toThrow();
    expect(listBookCast(db, "res-1")).toHaveLength(0);
    db.close();
  });
});

describe("updateCastVoice", () => {
  it("sets the voice and locks it", () => {
    const db = createDb(":memory:");
    seedResource(db);
    saveCastScan(db, "res-1", [alice()]);
    const id = listBookCast(db, "res-1")[0].id;

    const updated = updateCastVoice(db, id, "user_choice");
    expect(updated?.voiceId).toBe("user_choice");
    expect(updated?.voiceLocked).toBe(true);
    expect(listBookCast(db, "res-1")[0].voiceId).toBe("user_choice");
    db.close();
  });

  it("survives a re-scan, per saveCastScan's own lock check", () => {
    const db = createDb(":memory:");
    seedResource(db);
    saveCastScan(db, "res-1", [alice()]);
    const id = listBookCast(db, "res-1")[0].id;
    updateCastVoice(db, id, "user_choice");

    saveCastScan(db, "res-1", [alice({ voiceId: "af_beta", description: "re-scanned" })]);
    const cast = listBookCast(db, "res-1");
    expect(cast[0].voiceId).toBe("user_choice");
    expect(cast[0].voiceLocked).toBe(true);
    db.close();
  });

  it("returns null for an id that doesn't exist", () => {
    const db = createDb(":memory:");
    seedResource(db);
    expect(updateCastVoice(db, "no-such-id", "af_alpha")).toBeNull();
    db.close();
  });
});
