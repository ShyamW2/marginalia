import type { Voice } from "@marginalia/shared";

/**
 * The TTS seam (AUDIO.md, binding for M21/M22). Same contract style as
 * `LLMProvider` (settled decision 1): the rest of the server only ever sees
 * this file's types, never anything engine-specific (no ONNX session, no
 * transformers.js tensor, nothing from `kokoro-js`). A second, more
 * expressive engine later (AUDIO.md: "a GPU engine is a later
 * implementation behind the same seam") becomes a new file that implements
 * this interface, not a new call site.
 */
export interface TTSEngine {
  readonly id: "kokoro";
  /** Voices this engine can speak in. Stable ids — they're persisted in the
   * cast (M22) and in `audio_state.narrator_voice`. */
  voices(): Promise<Voice[]>;
  /** Synthesize ONE sentence. Returns raw WAV bytes plus its measured
   * duration — never a whole chapter, so cancellation (via `signal`) always
   * lands between sentences, not mid-file. */
  synthesize(req: {
    text: string;
    voiceId: string;
    /** 1.0 default; playback rate is a player concern (AUDIO.md), this is
     * engine-level speed (affects the rendered audio's own duration). */
    speed?: number;
    signal?: AbortSignal;
  }): Promise<{ audio: Uint8Array; format: "wav"; durationMs: number }>;
}

export type TTSErrorCode =
  | "model_unavailable"
  | "model_download_failed"
  | "synthesis_failed"
  | "unsupported_voice";

/**
 * AUDIO.md's native-binding hazard note: `onnxruntime-node` is a native
 * module exactly like `better-sqlite3` (NOTES.md 2026-07-20 ABI mismatch
 * incident) — a failed load must surface as one of these codes, loud, never
 * as a dead `/api/audio/*` route or an unhandled rejection.
 */
export class TTSError extends Error {
  readonly code: TTSErrorCode;

  constructor(code: TTSErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TTSError";
    this.code = code;
  }
}
