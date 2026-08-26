import type Database from "better-sqlite3";
import type {
  CursorStyleChoice,
  PageNumberMode,
  PageTransition,
  ReaderMargin,
  ReaderPaneWidth,
  Settings,
  SettingsUpdate,
  SpreadMode,
  TTSEngineId,
} from "@marginalia/shared";
import { MODELS_DIR } from "../paths.js";

// M19 (docs/decisions.md 2026-07-29 later): provider config lives in
// provider_profiles/provider_roles now (see settings/providers.ts) — this
// table + DEFAULTS cover everything else settings has ever held.
const DEFAULTS = {
  vault_path: "",
  cursor_style: "custom" as CursorStyleChoice,
  cursor_trail_enabled: "true",
  // SPEC-GAP: TASKS.md doesn't say what the default should be — "single"
  // (today's behavior, unchanged until a reader opts in) is the boring
  // choice.
  spread_mode: "single" as SpreadMode,
  // M20 step 3 (decisions.md 2026-08-03): the plain slide is the default —
  // the curl is the strongest, most expensive thing the reader does, and a
  // reader who wants it opts in. Unlike the settings above, this one is *not*
  // "today's behavior unchanged": the curl shipped as the only transition.
  page_transition: "slide" as PageTransition,
  // M14: "normal" matches the pre-M14 fixed edge padding — unchanged until a
  // reader opts into something wider or narrower.
  reader_margin: "normal" as ReaderMargin,
  // M16: 1 = today's unscaled size, unchanged until a reader opts in.
  reader_font_scale: "1",
  // M15: a tasteful default — visible bow/glow without fighting legibility.
  scan_crt_intensity: "0.6",
  // M17: 0 = no ceiling — a digest run pre-flight estimate above this many
  // input tokens is refused rather than started.
  digest_token_budget: "0",
  // M19.6 "page numbers, book-wide and stable": "off" is today's behavior,
  // unchanged until a reader opts in (same convention as reader_margin etc).
  page_number_mode: "off" as PageNumberMode,
  // M19.6 "the reading pane is resizable": 0 = unset, use the spread-mode
  // default (same "0 = no override" convention as digest_token_budget).
  reader_pane_width: "0",
  // M21 (AUDIO.md "Settings additions"): "kokoro" is the only engine so far.
  tts_engine: "kokoro" as TTSEngineId,
  // Empty = unset, meaning "use MODELS_DIR" (paths.ts) — same "empty string
  // is the boring default" convention vault_path already uses, not a real
  // path sentinel a caller needs to special-case.
  tts_model_path: "",
  // af_heart is Kokoro's own top-graded American-female voice — a sensible
  // default so single-voice listening works with zero setup (AUDIO.md).
  audio_default_voice: "af_heart",
  audio_auto_turn_pages: "true",
  // M30 A (decisions.md 2026-08-24): the operator's names for the four
  // permanent kind slots — see settled decision 16. Deleted, never stored
  // empty, on a clear (see updateSettings) so this default is what a
  // cleared field falls back to.
  kind_label_rose: "Regular annotation",
  kind_label_sage: "Define",
  kind_label_honey: "Key quote",
  kind_label_slate: "Thematic Question",
};

type SettingsKey = keyof typeof DEFAULTS;

/** M30 A: clearing one of these to "" resets to the default rather than
 * persisting a blank label — see updateSettings. */
const KIND_LABEL_KEYS = new Set<SettingsKey>([
  "kind_label_rose",
  "kind_label_sage",
  "kind_label_honey",
  "kind_label_slate",
]);

const KEY_TO_FIELD: Record<SettingsKey, keyof Settings> = {
  vault_path: "vaultPath",
  cursor_style: "cursorStyle",
  cursor_trail_enabled: "cursorTrailEnabled",
  spread_mode: "spreadMode",
  page_transition: "pageTransition",
  reader_margin: "readerMargin",
  reader_font_scale: "readerFontScale",
  scan_crt_intensity: "scanCrtIntensity",
  digest_token_budget: "digestTokenBudget",
  page_number_mode: "pageNumberMode",
  reader_pane_width: "readerPaneWidth",
  tts_engine: "ttsEngine",
  tts_model_path: "ttsModelPath",
  audio_default_voice: "audioDefaultVoice",
  audio_auto_turn_pages: "audioAutoTurnPages",
  kind_label_rose: "kindLabelRose",
  kind_label_sage: "kindLabelSage",
  kind_label_honey: "kindLabelHoney",
  kind_label_slate: "kindLabelSlate",
};

const FIELD_TO_KEY = Object.fromEntries(
  Object.entries(KEY_TO_FIELD).map(([key, field]) => [field, key]),
) as Record<keyof Settings, SettingsKey>;

function readRaw(db: Database.Database): Record<SettingsKey, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored } as Record<SettingsKey, string>;
}

/** Unmasked settings for internal use. Never expose via HTTP. */
export function getRawSettings(db: Database.Database): {
  vaultPath: string;
  cursorStyle: CursorStyleChoice;
  cursorTrailEnabled: boolean;
  spreadMode: SpreadMode;
  pageTransition: PageTransition;
  readerMargin: ReaderMargin;
  readerFontScale: number;
  scanCrtIntensity: number;
  digestTokenBudget: number;
  pageNumberMode: PageNumberMode;
  readerPaneWidth: ReaderPaneWidth;
  ttsEngine: TTSEngineId;
  ttsModelPath: string;
  audioDefaultVoice: string;
  audioAutoTurnPages: boolean;
  kindLabelRose: string;
  kindLabelSage: string;
  kindLabelHoney: string;
  kindLabelSlate: string;
} {
  const raw = readRaw(db);
  return {
    vaultPath: raw.vault_path,
    cursorStyle: raw.cursor_style as CursorStyleChoice,
    cursorTrailEnabled: raw.cursor_trail_enabled === "true",
    spreadMode: raw.spread_mode as SpreadMode,
    pageTransition: raw.page_transition as PageTransition,
    readerMargin: raw.reader_margin as ReaderMargin,
    readerFontScale: Number.parseFloat(raw.reader_font_scale),
    scanCrtIntensity: Number.parseFloat(raw.scan_crt_intensity),
    digestTokenBudget: Number.parseInt(raw.digest_token_budget, 10),
    pageNumberMode: raw.page_number_mode as PageNumberMode,
    readerPaneWidth: Number.parseInt(raw.reader_pane_width, 10),
    ttsEngine: raw.tts_engine as TTSEngineId,
    ttsModelPath: raw.tts_model_path || MODELS_DIR,
    audioDefaultVoice: raw.audio_default_voice,
    audioAutoTurnPages: raw.audio_auto_turn_pages === "true",
    kindLabelRose: raw.kind_label_rose,
    kindLabelSage: raw.kind_label_sage,
    kindLabelHoney: raw.kind_label_honey,
    kindLabelSlate: raw.kind_label_slate,
  };
}

/** GET /api/settings response — no secrets live here anymore (M19). */
export function getSettings(db: Database.Database): Settings {
  return getRawSettings(db);
}

/** PUT /api/settings — partial update. */
export function updateSettings(
  db: Database.Database,
  update: SettingsUpdate,
): Settings {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`,
  );
  const clear = db.prepare("DELETE FROM settings WHERE key = ?");

  const applyAll = db.transaction(() => {
    for (const [field, value] of Object.entries(update)) {
      if (value === undefined) continue;
      const key = FIELD_TO_KEY[field as keyof Settings];
      if (!key) continue;
      // M30 A: a kind label cleared to "" resets to its default rather than
      // persisting a blank one — deleting the row lets the DEFAULTS merge
      // in readRaw supply the fallback, the same mechanism an unset key
      // already uses.
      if (KIND_LABEL_KEYS.has(key) && value === "") {
        clear.run(key);
        continue;
      }
      upsert.run({ key, value: String(value) });
    }
  });
  applyAll();

  return getSettings(db);
}
