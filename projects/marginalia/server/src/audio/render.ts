import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AudioSegment, VoiceMode } from "@marginalia/shared";
import { AUDIO_DIR } from "../paths.js";
import type { TTSEngine } from "./engine.js";
import type { SentenceVoice } from "./attribution.js";
import { segmentSentences } from "./segment.js";
import { writeEncodedSegment } from "./encode.js";

/** The on-disk manifest carries one field the wire schema doesn't (`ext`,
 * so the file-serving route knows whether to look for `.opus` or `.wav`
 * without a directory scan) — never sent to the client as-is.
 *
 * Written incrementally, one sentence at a time (see `renderSection`) —
 * `totalSegments` is known and written up front (segmentation is instant;
 * synthesis is what's slow), so a client can tell "3 of 40 rendered so far"
 * from "this section only ever had 3 sentences". */
export interface SectionManifestFile {
  spineIndex: number;
  castHash: string;
  totalSegments: number;
  segments: (AudioSegment & { ext: "opus" | "wav" })[];
}

/**
 * AUDIO.md: "castHash = sha256 of the ordered (speakerId → voiceId)
 * mapping plus the narrator voice and engine id." `voiceMode` is also part
 * of the hash (M22) — without it, switching single→multi with an empty or
 * unchanged cast mapping would hash identically to the single-voice render
 * already on disk, and the route would serve that stale single-voice audio
 * as though it were the (never-run) multi-voice render. `cast` defaults to
 * empty for the single-voice (M21) case, where character assignments are
 * irrelevant to what's actually rendered.
 */
export function computeCastHash(
  engineId: string,
  narratorVoiceId: string,
  voiceMode: VoiceMode = "single",
  cast: { speakerId: string; voiceId: string }[] = [],
): string {
  const ordered = [...cast].sort((a, b) => a.speakerId.localeCompare(b.speakerId));
  const payload = JSON.stringify({ engine: engineId, narrator: narratorVoiceId, voiceMode, cast: ordered });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function resourceCastDir(resourceId: string, castHash: string): string {
  return path.join(AUDIO_DIR, resourceId, castHash);
}

function sectionDir(resourceId: string, castHash: string, spineIndex: number): string {
  return path.join(resourceCastDir(resourceId, castHash), String(spineIndex));
}

function manifestPath(resourceId: string, castHash: string, spineIndex: number): string {
  return path.join(resourceCastDir(resourceId, castHash), `${spineIndex}.json`);
}

function readManifest(resourceId: string, castHash: string, spineIndex: number): SectionManifestFile | null {
  const file = manifestPath(resourceId, castHash, spineIndex);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as SectionManifestFile;
  } catch {
    return null;
  }
}

/**
 * The cache's idempotency check is file existence, never the manifest row
 * alone (the vault compiler's 2026-07-19 bug, AUDIO.md's own precedent): a
 * manifest that claims a segment exists but whose file is gone (a `data/`
 * deletion mid-session) is *not* cached.
 */
export function isSectionCached(resourceId: string, castHash: string, spineIndex: number): boolean {
  const manifest = readManifest(resourceId, castHash, spineIndex);
  if (!manifest) return false;
  if (manifest.segments.length !== manifest.totalSegments) return false;
  const dir = sectionDir(resourceId, castHash, spineIndex);
  return manifest.segments.every((seg) => fs.existsSync(path.join(dir, `${seg.n}.${seg.ext}`)));
}

export function getSectionManifest(resourceId: string, castHash: string, spineIndex: number): SectionManifestFile | null {
  return isSectionCached(resourceId, castHash, spineIndex) ? readManifest(resourceId, castHash, spineIndex) : null;
}

/**
 * Whatever is on disk right now, complete or not — the render route's
 * manifest endpoint uses this (not `getSectionManifest`) so a player can
 * start speaking sentence 0 the moment it lands instead of waiting for the
 * whole section (decisions.md 2026-07-27: "listening starts in seconds").
 * Still file-existence-checked per segment, same cache-honesty rule as
 * `isSectionCached` — a segment whose file vanished doesn't get handed to
 * the player as playable.
 */
export function getPartialSectionManifest(
  resourceId: string,
  castHash: string,
  spineIndex: number,
): SectionManifestFile | null {
  const manifest = readManifest(resourceId, castHash, spineIndex);
  if (!manifest) return null;
  const dir = sectionDir(resourceId, castHash, spineIndex);
  return { ...manifest, segments: manifest.segments.filter((seg) => fs.existsSync(path.join(dir, `${seg.n}.${seg.ext}`))) };
}

/** Absolute path to one rendered segment file, or null if it isn't
 * actually there (a stale manifest, or never rendered). */
export function getSegmentFilePath(
  resourceId: string,
  castHash: string,
  spineIndex: number,
  n: number,
): { path: string; ext: "opus" | "wav" } | null {
  const manifest = readManifest(resourceId, castHash, spineIndex);
  const seg = manifest?.segments.find((s) => s.n === n);
  if (!seg) return null;
  const filePath = path.join(sectionDir(resourceId, castHash, spineIndex), `${seg.n}.${seg.ext}`);
  return fs.existsSync(filePath) ? { path: filePath, ext: seg.ext } : null;
}

export function listCachedSpineIndices(resourceId: string, castHash: string, spineIndices: number[]): number[] {
  return spineIndices.filter((i) => isSectionCached(resourceId, castHash, i));
}

/** Deletes the whole rendered-audio tree for a resource (every cast hash) —
 * AUDIO.md: "safe to delete at any time." */
export async function deleteResourceAudioCache(resourceId: string): Promise<void> {
  await fsp.rm(path.join(AUDIO_DIR, resourceId), { recursive: true, force: true });
}

/**
 * Renders one spine section's sentence-by-sentence audio and writes its
 * manifest — incrementally, one sentence at a time, so a section is
 * playable before it's fully rendered (see `getPartialSectionManifest`).
 * Idempotent per AUDIO.md ("rendering a chapter twice does no synthesis the
 * second time") via the job route's own cache check before this is ever
 * called — this function itself always (re)renders every sentence when
 * invoked, and does not attempt to resume a previously interrupted partial
 * render (SPEC-GAP: AUDIO.md only requires that a full cache hit is a
 * no-op and that cancelling actually stops work, not that a *partial*
 * render survives a restart — see NOTES.md).
 */
export async function renderSection(
  engine: TTSEngine,
  resourceId: string,
  spineIndex: number,
  sectionText: string,
  castHash: string,
  narratorVoiceId: string,
  speed: number,
  signal: AbortSignal,
  reportProgress: (current: number, total: number, message?: string | null) => void,
  /** M22: one entry per sentence (same length/order `segmentSentences`
   * produces from `sectionText` — the caller computes attribution against
   * that exact same segmentation). Omitted entirely for single-voice
   * (M21 behaviour, unchanged): every sentence uses `narratorVoiceId`. */
  sentenceVoices?: SentenceVoice[],
): Promise<void> {
  const sentences = segmentSentences(sectionText);
  const dir = sectionDir(resourceId, castHash, spineIndex);
  await fsp.mkdir(dir, { recursive: true });

  const manifestFile = manifestPath(resourceId, castHash, spineIndex);
  const segments: (AudioSegment & { ext: "opus" | "wav" })[] = [];
  const writeManifest = () =>
    fsp.writeFile(
      manifestFile,
      JSON.stringify({ spineIndex, castHash, totalSegments: sentences.length, segments } satisfies SectionManifestFile),
      "utf8",
    );

  // Written before any synthesis happens: a client racing the very start of
  // this job already learns "N sentences are coming" even though none of
  // them exist on disk yet.
  await writeManifest();

  for (let n = 0; n < sentences.length; n++) {
    if (signal.aborted) throw new DOMException("Section render aborted", "AbortError");
    const sentence = sentences[n];
    const voice = sentenceVoices?.[n] ?? { voiceId: narratorVoiceId, speakerId: null };
    reportProgress(n, sentences.length, sentence.text.slice(0, 48));

    const result = await engine.synthesize({
      text: sentence.text,
      voiceId: voice.voiceId,
      speed,
      signal,
    });
    const ext = await writeEncodedSegment(result.audio, path.join(dir, String(n)));
    segments.push({
      n,
      charStart: sentence.charStart,
      charEnd: sentence.charEnd,
      durationMs: result.durationMs,
      voiceId: voice.voiceId,
      speakerId: voice.speakerId,
      text: sentence.text,
      ext,
    });
    await writeManifest();
  }

  reportProgress(sentences.length, sentences.length, null);
}
