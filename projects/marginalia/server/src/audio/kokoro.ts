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
  if (modelPromise && modelPathUsed === modelPath) return modelPromise;

  transformersEnv.cacheDir = modelPath;
  modelPathUsed = modelPath;
  modelPromise = KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: "cpu" }).catch((err) => {
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
