import { Router } from "express";
import {
  AudioSectionManifestSchema,
  AudioStateSchema,
  BookCastResponseSchema,
  StartJobResponseSchema,
  TestVoiceBodySchema,
  UpdateAudioStateBodySchema,
  type AudioState,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import { getResourceById, getResourceTextSections } from "../library/store.js";
import { getRawSettings } from "../settings/store.js";
import { getEngine } from "../audio/registry.js";
import { TTSError } from "../audio/engine.js";
import { getAudioState, markCastScanned, updateAudioState } from "../audio/state.js";
import { assignVoices } from "../audio/casting.js";
import { listBookCast, saveCastScan } from "../audio/castStore.js";
import {
  computeCastHash,
  deleteResourceAudioCache,
  getPartialSectionManifest,
  getSegmentFilePath,
  isSectionCached,
  listCachedSpineIndices,
  renderSection,
} from "../audio/render.js";
import { getJob, startJob } from "../jobs/registry.js";
import { getProvider } from "../llm/provider.js";
import { runDigest } from "../digest/build.js";
import { getBookDigest } from "../digest/store.js";

/** `GET /api/audio/*`, `POST /api/audio/test-voice` — engine-level, not
 * scoped to a resource. */
export const ttsRouter: Router = Router();

/** `/api/resources/:id/audio*` — one listening state + rendered cache per book. */
export const audioRouter: Router = Router();

/**
 * De-dupes concurrent render requests for the same resource/cast/section —
 * the player's own chapter-ahead prefetch (warming the next section) and a
 * reader jumping straight there manually can both call this route for the
 * identical section before the first render finishes. Two jobs racing to
 * write the same manifest file would not corrupt the audio itself (each
 * writes the same deterministic content for a given sentence index), but
 * the *manifest* is a full overwrite per job, not a merge — a slower job's
 * write landing after a faster one's could regress an already-complete
 * manifest back to a partial one. Keyed in memory, same lifetime as the
 * job registry itself (a single local-first process, CLAUDE.md decision 4).
 */
const inFlightRenders = new Map<string, string>();

function renderKey(resourceId: string, castHash: string, spineIndex: number): string {
  return `${resourceId}:${castHash}:${spineIndex}`;
}

function ttsErrorStatus(code: TTSError["code"]): number {
  switch (code) {
    case "unsupported_voice":
      return 400;
    case "model_unavailable":
    case "model_download_failed":
      return 503;
    case "synthesis_failed":
    default:
      return 500;
  }
}

ttsRouter.get("/voices", async (req, res) => {
  const engine = getEngine(getDb());
  try {
    res.json(await engine.voices());
  } catch (err) {
    if (err instanceof TTSError) {
      res.status(ttsErrorStatus(err.code)).json({ error: err.code });
      return;
    }
    throw err;
  }
});

/** The audio equivalent of a provider's "Test connection" (AUDIO.md task 1):
 * synthesizes one short sentence and returns it as playable WAV bytes —
 * never encoded, since this is a one-off, not cached. */
ttsRouter.post("/test-voice", async (req, res) => {
  const parsed = TestVoiceBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const engine = getEngine(getDb());
  try {
    const result = await engine.synthesize({
      text: parsed.data.text ?? "This is what this voice sounds like.",
      voiceId: parsed.data.voiceId,
    });
    res.setHeader("Content-Type", "audio/wav");
    res.send(Buffer.from(result.audio));
  } catch (err) {
    if (err instanceof TTSError) {
      res.status(ttsErrorStatus(err.code)).json({ error: err.code });
      return;
    }
    throw err;
  }
});

function buildAudioState(resourceId: string): AudioState {
  const db = getDb();
  const row = getAudioState(db, resourceId);
  const { audioDefaultVoice, ttsEngine } = getRawSettings(db);
  const narratorVoice = row.narratorVoice || audioDefaultVoice;
  const castHash = computeCastHash(ttsEngine, narratorVoice);
  const spineIndices = getResourceTextSections(db, resourceId).map((s) => s.spineIndex);
  return {
    narratorVoice,
    voiceMode: row.voiceMode,
    speed: row.speed,
    castScannedAt: row.castScannedAt,
    cachedSpineIndices: listCachedSpineIndices(resourceId, castHash, spineIndices),
  };
}

audioRouter.get("/:id/audio", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  res.json(AudioStateSchema.parse(buildAudioState(resource.id)));
});

audioRouter.put("/:id/audio", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const parsed = UpdateAudioStateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  updateAudioState(db, resource.id, parsed.data);
  res.json(AudioStateSchema.parse(buildAudioState(resource.id)));
});

audioRouter.delete("/:id/audio", async (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  await deleteResourceAudioCache(resource.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// M22 — the cast (AUDIO.md "Casting"). Pass 1 is the digest's own book-level
// reduce (decisions.md 2026-07-28: "it *is* pass 1 of the audio cast scan.
// Do not build a second scanner"), so this route ensures/resumes a full-book
// digest, then does the one thing that's genuinely new: deterministic voice
// assignment (casting.ts) and persistence (castStore.ts).
// ---------------------------------------------------------------------------

audioRouter.get("/:id/cast", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  res.json(
    BookCastResponseSchema.parse({
      scannedAt: getAudioState(db, resource.id).castScannedAt,
      members: listBookCast(db, resource.id),
    }),
  );
});

audioRouter.post("/:id/cast/scan", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  // AUDIO.md: "Both passes claim the digest provider role rather than the
  // global provider — casting a long book is batch analysis."
  const provider = getProvider(db, "digest", "cast", resource.id);
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }
  const sections = getResourceTextSections(db, resource.id);
  if (sections.length === 0) {
    res.status(400).json({ error: "no_text" });
    return;
  }
  const spineEnd = Math.max(...sections.map((s) => s.spineIndex));

  const job = startJob("cast-scan", resource.id, resource.title, async (signal, reportProgress) => {
    const run = await runDigest(db, provider, resource, sections, 0, spineEnd, signal, (current, total, message) =>
      reportProgress({ current, total, message }),
    );
    // Cooperative cancellation returns normally (never throws) — `startJob`
    // itself checks `signal.aborted` after a clean resolve and marks the job
    // "cancelled", so returning here (not throwing) is what makes that work.
    if (signal.aborted) return;
    // Anything short of "completed" (paused on a rate limit, or a chapter
    // that failed outright) means the cast this scan would produce is
    // systematically incomplete — AUDIO.md's "a provider failure mid-scan
    // leaves no half-written cast" extends to "leaves no cast built on a
    // half-finished digest". Surfacing this as a failed job (with the
    // digest's own reason) beats silently completing with nothing written.
    if (run.status !== "completed") {
      throw new Error(`Digest ${run.status}${run.lastError ? `: ${run.lastError}` : ""}`);
    }

    reportProgress({ current: 0, total: 1, message: "Assigning voices" });
    const digest = getBookDigest(db, resource.id);
    const characters = digest?.cast ?? [];

    const engine = getEngine(db);
    const voices = await engine.voices();
    const { audioDefaultVoice } = getRawSettings(db);
    const narratorVoice = getAudioState(db, resource.id).narratorVoice || audioDefaultVoice;

    const existing = listBookCast(db, resource.id);
    const lockedByName = new Map(existing.filter((m) => m.voiceLocked).map((m) => [m.name, m]));
    const newNames = new Set(characters.map((c) => c.name));
    // Reserve two kinds of voice: every locked character's (never even
    // handed to assignVoices — a lock is a hard pin), and every *stale* row
    // not present in this scan's fresh cast (a name the digest phrased
    // differently this time — castStore.ts never deletes these, so their
    // voice is still live and must not be handed to someone new; see
    // NOTES.md's M22 SPEC-GAP on stale rows). Without the second half, a
    // freshly-reworded character can silently collide with an orphaned
    // one's voice — reproduced live: "Chief Clerk" vs "The Chief Clerk".
    const claimed = existing.filter((m) => m.voiceLocked || !newNames.has(m.name));
    const reserved = [narratorVoice, ...claimed.map((m) => m.voiceId)];
    const assignable = characters.filter((c) => !lockedByName.has(c.name));
    const assignments = assignVoices(assignable, voices, reserved);

    saveCastScan(
      db,
      resource.id,
      characters.map((c) => ({
        name: c.name,
        aliases: c.aliases,
        gender: c.gender,
        ageHint: c.ageHint,
        description: c.description,
        voiceId: assignments.get(c.name) ?? lockedByName.get(c.name)?.voiceId ?? "",
      })),
    );
    markCastScanned(db, resource.id);
    reportProgress({ current: 1, total: 1, message: null });
  });
  res.status(202).json(StartJobResponseSchema.parse({ jobId: job.id }));
});

function parseSpineIndex(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

type SectionContextResult =
  | { ok: false; status: number; body: { error: string } }
  | {
      ok: true;
      resource: NonNullable<ReturnType<typeof getResourceById>>;
      spineIndex: number;
      section: ReturnType<typeof getResourceTextSections>[number];
      narratorVoice: string;
      speed: number;
      castHash: string;
    };

/** Resolves the resource, section, and the narrator voice + cast hash this
 * request should act under — the same three lookups every section route
 * needs before it can do anything. */
function resolveSectionContext(resourceId: string, spineIndexRaw: string): SectionContextResult {
  const db = getDb();
  const resource = getResourceById(db, resourceId);
  if (!resource) return { ok: false, status: 404, body: { error: "resource_not_found" } };
  const spineIndex = parseSpineIndex(spineIndexRaw);
  if (spineIndex === null) return { ok: false, status: 400, body: { error: "invalid_spine_index" } };
  const section = getResourceTextSections(db, resource.id).find((s) => s.spineIndex === spineIndex);
  if (!section) return { ok: false, status: 404, body: { error: "section_not_found" } };

  const { audioDefaultVoice, ttsEngine } = getRawSettings(db);
  const audioState = getAudioState(db, resource.id);
  const narratorVoice = audioState.narratorVoice || audioDefaultVoice;
  const castHash = computeCastHash(ttsEngine, narratorVoice);
  return { ok: true, resource, spineIndex, section, narratorVoice, speed: audioState.speed, castHash };
}

/**
 * Ensures one spine section is rendered. AUDIO.md specs this as its own SSE
 * endpoint; it now goes through the M20.6 job registry instead (TASKS.md
 * M20.6: "placed before M21 on purpose ... AUDIO.md already specs an SSE
 * progress endpoint" — the job registry *is* that endpoint, generalized).
 * A cache hit responds immediately with no job at all.
 */
audioRouter.post("/:id/audio/sections/:spineIndex", (req, res) => {
  const ctx = resolveSectionContext(req.params.id, req.params.spineIndex);
  if (!ctx.ok) {
    res.status(ctx.status).json(ctx.body);
    return;
  }
  const { resource, spineIndex, section, narratorVoice, speed, castHash } = ctx;

  if (isSectionCached(resource.id, castHash, spineIndex)) {
    res.json({ cached: true });
    return;
  }

  const key = renderKey(resource.id, castHash, spineIndex);
  const existingJobId = inFlightRenders.get(key);
  if (existingJobId && getJob(existingJobId)?.status === "running") {
    res.status(202).json({ jobId: existingJobId });
    return;
  }

  const engine = getEngine(getDb());
  const job = startJob("audio-render", resource.id, resource.title, async (signal, reportProgress) => {
    try {
      await renderSection(
        engine,
        resource.id,
        spineIndex,
        section.text,
        castHash,
        narratorVoice,
        speed,
        signal,
        (current, total, message) => reportProgress({ current, total, message: message ?? null }),
      );
    } catch (err) {
      if (err instanceof TTSError) {
        // eslint-disable-next-line no-console
        console.error(`[audio-render] ${err.code}: ${err.message}`);
      } else if (!(err instanceof DOMException && err.name === "AbortError")) {
        // eslint-disable-next-line no-console
        console.error("[audio-render]", err);
      }
      throw err;
    } finally {
      if (inFlightRenders.get(key) === job.id) inFlightRenders.delete(key);
    }
  });
  inFlightRenders.set(key, job.id);
  res.status(202).json({ jobId: job.id });
});

/**
 * Returns whatever has actually rendered so far, complete or not — a
 * partial manifest (`segments.length < totalSegments`) is a normal,
 * expected response while a render job is still running, not an error
 * (decisions.md 2026-07-27: "listening starts in seconds", not once the
 * whole chapter has synthesized).
 */
audioRouter.get("/:id/audio/sections/:spineIndex/manifest", (req, res) => {
  const ctx = resolveSectionContext(req.params.id, req.params.spineIndex);
  if (!ctx.ok) {
    res.status(ctx.status).json(ctx.body);
    return;
  }
  const manifest = getPartialSectionManifest(ctx.resource.id, ctx.castHash, ctx.spineIndex);
  if (!manifest) {
    res.status(404).json({ error: "not_rendered" });
    return;
  }
  res.json(
    AudioSectionManifestSchema.parse({
      spineIndex: manifest.spineIndex,
      castHash: manifest.castHash,
      totalSegments: manifest.totalSegments,
      segments: manifest.segments.map(({ ext: _ext, ...seg }) => seg),
    }),
  );
});

audioRouter.get("/:id/audio/sections/:spineIndex/:n", (req, res) => {
  const ctx = resolveSectionContext(req.params.id, req.params.spineIndex);
  if (!ctx.ok) {
    res.status(ctx.status).json(ctx.body);
    return;
  }
  const n = Number(req.params.n);
  if (!Number.isInteger(n) || n < 0) {
    res.status(400).json({ error: "invalid_segment" });
    return;
  }
  const file = getSegmentFilePath(ctx.resource.id, ctx.castHash, ctx.spineIndex, n);
  if (!file) {
    res.status(404).json({ error: "segment_not_found" });
    return;
  }
  res.type(file.ext === "opus" ? "audio/ogg" : "audio/wav");
  // Content-addressed by `castHash` + spine + sentence index (render.ts) —
  // this exact URL's bytes can never change, only a re-cast writes a new
  // path. `send`'s own default (`max-age=0`, revalidate-on-every-request)
  // was forcing a network round trip on every replay/skip-back even for a
  // segment already fully downloaded once; `immutable` lets the browser
  // skip that entirely.
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  // `res.sendFile` (via the `send` module) already implements Range/206 —
  // exactly what the player's sequential `<audio>` segments need, and
  // AUDIO.md's HTTP table asks for ("Range-supporting static file serve").
  res.sendFile(file.path);
});
