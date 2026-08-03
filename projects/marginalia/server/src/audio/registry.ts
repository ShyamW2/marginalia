import type Database from "better-sqlite3";
import { getRawSettings } from "../settings/store.js";
import { KokoroEngine } from "./kokoro.js";
import type { TTSEngine } from "./engine.js";

/**
 * Resolves the configured `TTSEngine`, the same way `llm/provider.ts`
 * resolves a role to a provider — one place that knows which implementation
 * is live (AUDIO.md: "Engine selection reads settings the same way
 * llm/provider.ts does"). Unlike an `LLMProvider` role, audio always has a
 * usable default (settings/store.ts ships a default engine, model path, and
 * narrator voice) — "works with zero setup" — so this never returns null;
 * a broken engine surfaces as a `TTSError` when actually called, not here.
 */
export function getEngine(db: Database.Database): TTSEngine {
  const { ttsEngine, ttsModelPath } = getRawSettings(db);
  // Only one implementation exists yet; the switch is written out anyway so
  // a second engine (AUDIO.md: "a GPU engine is a later implementation
  // behind the same seam") is a new case, not a restructure.
  switch (ttsEngine) {
    case "kokoro":
    default:
      return new KokoroEngine(ttsModelPath);
  }
}
