import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { AudioSegment } from "@marginalia/shared";
import { AUDIO_DIR } from "../paths.js";
import type { TTSEngine } from "./engine.js";
import { segmentSentences } from "./segment.js";
import { writeEncodedSegment } from "./encode.js";

/** The on-disk manifest carries one field the wire schema doesn't (`ext`,
 * so the file-serving route knows whether to look for `.opus` or `.wav`
 * without a directory scan) — never sent to the client as-is. */
export interface SectionManifestFile {
  spineIndex: number;
  castHash: string;
  segments: (AudioSegment & { ext: "opus" | "wav" })[];
}

/**
 * AUDIO.md: "castHash = sha256 of the ordered (speakerId → voiceId)
 * mapping plus the narrator voice and engine id." M21 is single-voice only,
 * so `cast` is always empty here — M22 extends this function's input, not
 * its shape, when per-character voices exist.
 */
export function computeCastHash(
  engineId: string,
  narratorVoiceId: string,
  cast: { speakerId: string; voiceId: string }[] = [],
): string {
  const ordered = [...cast].sort((a, b) => a.speakerId.localeCompare(b.speakerId));
  const payload = JSON.stringify({ engine: engineId, narrator: narratorVoiceId, cast: ordered });
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
  const dir = sectionDir(resourceId, castHash, spineIndex);
  return manifest.segments.every((seg) => fs.existsSync(path.join(dir, `${seg.n}.${seg.ext}`)));
}

export function getSectionManifest(resourceId: string, castHash: string, spineIndex: number): SectionManifestFile | null {
  return isSectionCached(resourceId, castHash, spineIndex) ? readManifest(resourceId, castHash, spineIndex) : null;
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
 * manifest. Idempotent per AUDIO.md ("rendering a chapter twice does no
 * synthesis the second time") via the job route's own cache check before
 * this is ever called — this function itself always (re)renders every
 * sentence when invoked, and does not attempt to resume a previously
 * interrupted partial render (SPEC-GAP: AUDIO.md only requires that a full
 * cache hit is a no-op and that cancelling actually stops work, not that a
 * *partial* render survives a restart — see NOTES.md).
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
): Promise<void> {
  const sentences = segmentSentences(sectionText);
  const dir = sectionDir(resourceId, castHash, spineIndex);
  await fsp.mkdir(dir, { recursive: true });

  const segments: (AudioSegment & { ext: "opus" | "wav" })[] = [];
  for (let n = 0; n < sentences.length; n++) {
    if (signal.aborted) throw new DOMException("Section render aborted", "AbortError");
    const sentence = sentences[n];
    reportProgress(n, sentences.length, sentence.text.slice(0, 48));

    const result = await engine.synthesize({
      text: sentence.text,
      voiceId: narratorVoiceId,
      speed,
      signal,
    });
    const ext = await writeEncodedSegment(result.audio, path.join(dir, String(n)));
    segments.push({
      n,
      charStart: sentence.charStart,
      charEnd: sentence.charEnd,
      durationMs: result.durationMs,
      voiceId: narratorVoiceId,
      speakerId: null,
      text: sentence.text,
      ext,
    });
  }

  const manifest: SectionManifestFile = { spineIndex, castHash, segments };
  await fsp.writeFile(manifestPath(resourceId, castHash, spineIndex), JSON.stringify(manifest), "utf8");
  reportProgress(sentences.length, sentences.length, null);
}
