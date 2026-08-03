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
} from "@marginalia/shared";

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
};

type SettingsKey = keyof typeof DEFAULTS;

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

  const applyAll = db.transaction(() => {
    for (const [field, value] of Object.entries(update)) {
      if (value === undefined) continue;
      const key = FIELD_TO_KEY[field as keyof Settings];
      if (!key) continue;
      upsert.run({ key, value: String(value) });
    }
  });
  applyAll();

  return getSettings(db);
}
