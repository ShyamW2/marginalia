import { env as transformersEnv } from "@huggingface/transformers";
import { KokoroTTS } from "kokoro-js";
import type { Voice, VoiceGender } from "@marginalia/shared";
import { TTSError, type TTSEngine } from "./engine.js";

// AUDIO.md's fixed stack: kokoro-js (ONNX, Apache-2.0) via onnxruntime-node,
// which kokoro-js bundles and loads on "cpu" device. `@huggingface/transformers`
// is pinned in package.json to the exact version kokoro-js itself depends on
// (currently 3.8.1) — not just a compatible range — so pnpm dedupes them into
// one module instance. If they resolved to two different copies, setting
// `env.cacheDir` below would configure a *different* transformers.js instance
// than the one `KokoroTTS.from_pretrained` actually loads through, and the
// model would silently re-download into (or read from) the wrong place.
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DTYPE = "q8"; // smallest/fastest quantization that still sounds fine; SPEC-GAP, see NOTES.md

let modelPromise: Promise<KokoroTTS> | null = null;
let modelPathUsed: string | null = null;
// The resolved model, tracked separately from `modelPromise` so idle unload
// (below) only ever disposes a session that actually finished loading —
// never one still mid-download.
let resolvedModel: KokoroTTS | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// M46 (DESKTOP.md §4.2): a loaded Kokoro session is 200–400MB resident and,
// unlike everything else in this process, never released on its own — one
// paragraph of audio at 09:00 is still resident at midnight. 15 minutes is
// long enough to survive an ordinary pause inside a reading session
// (looking something up, a short break) without reloading, short enough
// that stepping away — the actual memory-budget case (NOTES.md) — frees it
// well within the day. Orthogonal to `modelPathUsed`'s settings-change
// invalidation below; the two share `resolvedModel`/`modelPromise` but
// never fire from the same call site.
const IDLE_UNLOAD_MS = 15 * 60 * 1000;

/** Releases the loaded ONNX session (`.dispose()` — letting the JS object
 * go out of scope does not free onnxruntime's own native allocation, same
 * caveat as the GPU textures in `scene3d/`) and resets state so the next
 * request reloads from scratch. Exported for the idle timer and for a
 * settings-driven path change (`loadModel` below) to share one path rather
 * than two slightly different ones. */
async function unload(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const model = resolvedModel;
  resolvedModel = null;
  modelPromise = null;
  modelPathUsed = null;
  if (model) {
    try {
      await model.model.dispose();
    } catch {
      // Best-effort: the process is letting go of the reference regardless,
      // and a failed dispose here shouldn't block the next load.
    }
  }
}

function scheduleIdleUnload(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void unload(), IDLE_UNLOAD_MS);
  // Never the reason the process stays alive — this is cleanup, not work.
  idleTimer.unref?.();
}

/** `af_heart` -> american/female; `bm_george` -> british/male. Kokoro's own
 * `voices` metadata gives `gender` ("Female"/"Male") and a BCP-47-ish
 * `language` ("en-us"/"en-gb") per voice — this reads those rather than
 * re-deriving from the id prefix, so a future voice pack that breaks the
 * naming convention doesn't silently mis-tag. */
function normalizeGender(raw: string): VoiceGender {
  const lower = raw.toLowerCase();
  if (lower === "female") return "female";
  if (lower === "male") return "male";
  return "neutral";
}

function accentFromLanguage(language: string): string | undefined {
  if (language === "en-us") return "american";
  if (language === "en-gb") return "british";
  return language || undefined;
}

async function loadModel(modelPath: string): Promise<KokoroTTS> {
  // A different model path than last time (a setting change) invalidates
  // the cached load — same "settings changed, reload" rule the provider
  // registry follows, just with a heavier resource behind it.
  if (modelPromise && modelPathUsed === modelPath) {
    scheduleIdleUnload();
    return modelPromise;
  }

  // The path is changing (or nothing has loaded yet) — a stale session from
  // the old path must not survive alongside the new one.
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const stale = resolvedModel;
  resolvedModel = null;
  if (stale) void stale.model.dispose();

  transformersEnv.cacheDir = modelPath;
  modelPathUsed = modelPath;
  modelPromise = KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: "cpu" })
    .then((model) => {
      resolvedModel = model;
      scheduleIdleUnload();
      return model;
    })
    .catch((err) => {
      modelPromise = null;
      // AUDIO.md's native-binding hazard: onnxruntime-node failing to load at
      // all (ABI mismatch) and a network/disk failure fetching weights look
      // different to a user, so they get different codes rather than one
      // generic "audio broken".
      const message = err instanceof Error ? err.message : String(err);
      const looksLikeDownloadFailure = /fetch|ENOTFOUND|network|404|ETIMEDOUT/i.test(message);
      throw new TTSError(looksLikeDownloadFailure ? "model_download_failed" : "model_unavailable", message);
    });
  return modelPromise;
}

export class KokoroEngine implements TTSEngine {
  readonly id = "kokoro" as const;

  constructor(private readonly modelPath: string) {}

  async voices(): Promise<Voice[]> {
    const model = await loadModel(this.modelPath);
    return Object.entries(model.voices).map(([id, v]) => ({
      id,
      label: v.name,
      gender: normalizeGender(v.gender),
      accent: accentFromLanguage(v.language),
    }));
  }

  async synthesize(req: {
    text: string;
    voiceId: string;
    speed?: number;
    signal?: AbortSignal;
  }): Promise<{ audio: Uint8Array; format: "wav"; durationMs: number }> {
    const model = await loadModel(this.modelPath);
    if (!(req.voiceId in model.voices)) {
      throw new TTSError("unsupported_voice", `Unknown voice id: ${req.voiceId}`);
    }
    if (req.signal?.aborted) {
      throw new TTSError("synthesis_failed", "aborted");
    }

    try {
      const raw = await model.generate(req.text, {
        voice: req.voiceId as keyof typeof model.voices,
        speed: req.speed ?? 1,
      });
      const wav = new Uint8Array(raw.toWav());
      const durationMs = (raw.audio.length / raw.sampling_rate) * 1000;
      return { audio: wav, format: "wav", durationMs };
    } catch (err) {
      if (err instanceof TTSError) throw err;
      throw new TTSError("synthesis_failed", err instanceof Error ? err.message : String(err));
    }
  }
}
