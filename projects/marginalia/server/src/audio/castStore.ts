import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { CastAgeHint, CastCharacterGender } from "@marginalia/shared";

export interface BookCastMemberRow {
  id: string;
  resourceId: string;
  name: string;
  aliases: string[];
  gender: CastCharacterGender;
  ageHint: CastAgeHint;
  description: string;
  voiceId: string;
  voiceLocked: boolean;
  sortOrder: number;
}

interface RawRow {
  id: string;
  resource_id: string;
  name: string;
  aliases: string;
  gender: string;
  age_hint: string;
  description: string;
  voice_id: string;
  voice_locked: number;
  sort_order: number;
}

function fromRow(row: RawRow): BookCastMemberRow {
  return {
    id: row.id,
    resourceId: row.resource_id,
    name: row.name,
    aliases: JSON.parse(row.aliases),
    gender: row.gender as CastCharacterGender,
    ageHint: row.age_hint as CastAgeHint,
    description: row.description,
    voiceId: row.voice_id,
    voiceLocked: row.voice_locked === 1,
    sortOrder: row.sort_order,
  };
}

/** The full cast for a resource, in scan/appearance order. */
export function listBookCast(db: Database.Database, resourceId: string): BookCastMemberRow[] {
  const rows = db
    .prepare("SELECT * FROM book_cast WHERE resource_id = ? ORDER BY sort_order")
    .all(resourceId) as RawRow[];
  return rows.map(fromRow);
}

export interface CastScanCharacter {
  name: string;
  aliases: string[];
  gender: CastCharacterGender;
  ageHint: CastAgeHint;
  description: string;
  /** Code's deterministic pick (casting.ts's `assignVoices`) — ignored for
   * any character whose existing row is `voice_locked` (AUDIO.md: "a user
   * override ... must survive a re-scan"). */
  voiceId: string;
}

/**
 * Replaces a resource's cast from a fresh scan, one row per character,
 * matched to an existing row by name so ids and locks survive a re-scan.
 * A locked character keeps its own `voice_id` no matter what the caller
 * assigned it — enforced here in SQL (`CASE WHEN ... voice_locked = 1`),
 * not left to the caller to get right. Characters no longer present in this
 * scan are left as-is; nothing here deletes a row (// SPEC-GAP: AUDIO.md
 * doesn't say what a re-scan should do about a character that disappears —
 * logged in NOTES.md). One transaction: a caller that fails before calling
 * this (a provider error mid-scan) has written nothing at all, and this
 * function itself never leaves a partial cast if it throws partway.
 */
export function saveCastScan(
  db: Database.Database,
  resourceId: string,
  characters: CastScanCharacter[],
): void {
  const existingByName = new Map(listBookCast(db, resourceId).map((m) => [m.name, m]));
  const upsert = db.prepare(
    `INSERT INTO book_cast
       (id, resource_id, name, aliases, gender, age_hint, description, voice_id, voice_locked, sort_order)
     VALUES (@id, @resourceId, @name, @aliases, @gender, @ageHint, @description, @voiceId, 0, @sortOrder)
     ON CONFLICT(resource_id, name) DO UPDATE SET
       aliases = @aliases, gender = @gender, age_hint = @ageHint, description = @description,
       voice_id = CASE WHEN book_cast.voice_locked = 1 THEN book_cast.voice_id ELSE @voiceId END,
       sort_order = @sortOrder`,
  );

  const run = db.transaction(() => {
    characters.forEach((c, index) => {
      upsert.run({
        id: existingByName.get(c.name)?.id ?? crypto.randomUUID(),
        resourceId,
        name: c.name,
        aliases: JSON.stringify(c.aliases),
        gender: c.gender,
        ageHint: c.ageHint,
        description: c.description,
        voiceId: c.voiceId,
        sortOrder: index,
      });
    });
  });
  run();
}
