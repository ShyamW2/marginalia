import type Database from "better-sqlite3";
import type { VoiceMode } from "@marginalia/shared";

export interface AudioStateRow {
  resourceId: string;
  narratorVoice: string;
  voiceMode: VoiceMode;
  speed: number;
  castScannedAt: string | null;
  updatedAt: string;
}

interface RawRow {
  resource_id: string;
  narrator_voice: string;
  voice_mode: VoiceMode;
  speed: number;
  cast_scanned_at: string | null;
  updated_at: string;
}

function fromRow(row: RawRow): AudioStateRow {
  return {
    resourceId: row.resource_id,
    narratorVoice: row.narrator_voice,
    voiceMode: row.voice_mode,
    speed: row.speed,
    castScannedAt: row.cast_scanned_at,
    updatedAt: row.updated_at,
  };
}

/** Never null — a resource with no row yet reads as the boring default
 * (empty narrator voice, single mode, 1x speed), the same "works with zero
 * setup" convention `settings/store.ts` uses. The route layer fills in
 * `audioDefaultVoice` from Settings when `narratorVoice` is empty. */
export function getAudioState(db: Database.Database, resourceId: string): AudioStateRow {
  const row = db
    .prepare(
      `SELECT resource_id, narrator_voice, voice_mode, speed, cast_scanned_at, updated_at
       FROM audio_state WHERE resource_id = ?`,
    )
    .get(resourceId) as RawRow | undefined;
  if (row) return fromRow(row);
  return {
    resourceId,
    narratorVoice: "",
    voiceMode: "single",
    speed: 1,
    castScannedAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

/** M22: stamps `cast_scanned_at` after a cast scan completes — the signal
 * `AudioState.castScannedAt` surfaces so the UI knows a cast already exists. */
export function markCastScanned(db: Database.Database, resourceId: string): void {
  const current = getAudioState(db, resourceId);
  const next: AudioStateRow = { ...current, castScannedAt: new Date().toISOString() };
  db.prepare(
    `INSERT INTO audio_state (resource_id, narrator_voice, voice_mode, speed, cast_scanned_at, updated_at)
     VALUES (@resourceId, @narratorVoice, @voiceMode, @speed, @castScannedAt, @updatedAt)
     ON CONFLICT (resource_id) DO UPDATE SET cast_scanned_at = @castScannedAt, updated_at = @updatedAt`,
  ).run({ ...next, updatedAt: next.castScannedAt });
}

export function updateAudioState(
  db: Database.Database,
  resourceId: string,
  update: { narratorVoice?: string; voiceMode?: VoiceMode; speed?: number },
): AudioStateRow {
  const current = getAudioState(db, resourceId);
  const next: AudioStateRow = {
    resourceId,
    narratorVoice: update.narratorVoice ?? current.narratorVoice,
    voiceMode: update.voiceMode ?? current.voiceMode,
    speed: update.speed ?? current.speed,
    castScannedAt: current.castScannedAt,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO audio_state (resource_id, narrator_voice, voice_mode, speed, cast_scanned_at, updated_at)
     VALUES (@resourceId, @narratorVoice, @voiceMode, @speed, @castScannedAt, @updatedAt)
     ON CONFLICT (resource_id) DO UPDATE SET
       narrator_voice = @narratorVoice, voice_mode = @voiceMode, speed = @speed, updated_at = @updatedAt`,
  ).run(next);
  return next;
}
