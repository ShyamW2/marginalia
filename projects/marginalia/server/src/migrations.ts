export interface Migration {
  version: number;
  sql: string;
}

/**
 * Numbered, ordered SQL migrations. Applied version is tracked in
 * `pragma user_version` (see db.ts). Append new migrations here — never edit
 * an already-applied one.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE resources (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        author        TEXT,
        format        TEXT NOT NULL,
        file_path     TEXT NOT NULL,
        metadata      TEXT NOT NULL DEFAULT '{}',
        imported_at   TEXT NOT NULL
      );

      CREATE TABLE resource_text (
        resource_id   TEXT NOT NULL REFERENCES resources(id),
        spine_index   INTEGER NOT NULL,
        href          TEXT NOT NULL,
        text          TEXT NOT NULL,
        PRIMARY KEY (resource_id, spine_index)
      );

      CREATE TABLE reading_state (
        resource_id   TEXT PRIMARY KEY REFERENCES resources(id),
        location      TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE highlights (
        id            TEXT PRIMARY KEY,
        resource_id   TEXT NOT NULL REFERENCES resources(id),
        exact         TEXT NOT NULL,
        prefix        TEXT NOT NULL,
        suffix        TEXT NOT NULL,
        cfi           TEXT NOT NULL,
        spine_index   INTEGER NOT NULL,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE threads (
        id            TEXT PRIMARY KEY,
        highlight_id  TEXT NOT NULL UNIQUE REFERENCES highlights(id),
        created_at    TEXT NOT NULL
      );

      CREATE TABLE messages (
        id            TEXT PRIMARY KEY,
        thread_id     TEXT NOT NULL REFERENCES threads(id),
        role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content       TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE publishes (
        thread_id     TEXT PRIMARY KEY REFERENCES threads(id),
        note_path     TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        published_at  TEXT NOT NULL
      );

      CREATE TABLE settings (
        key           TEXT PRIMARY KEY,
        value         TEXT NOT NULL
      );

      CREATE INDEX idx_resource_text_resource ON resource_text(resource_id);
      CREATE INDEX idx_highlights_resource ON highlights(resource_id);
      CREATE INDEX idx_messages_thread ON messages(thread_id);
    `,
  },
  {
    // M7: highlight kinds (docs/decisions.md 2026-07-19). Four semantic
    // kinds chosen at capture time — rose (revisit/general), sage
    // (definition), honey (quote), slate (question, what Ask defaults to).
    // The enum itself is enforced at the zod boundary (shared/schemas.ts),
    // not a SQL CHECK, to avoid ALTER TABLE ADD COLUMN CHECK-constraint
    // portability concerns across better-sqlite3's bundled SQLite versions.
    version: 2,
    sql: `
      ALTER TABLE highlights ADD COLUMN kind TEXT NOT NULL DEFAULT 'rose';

      -- Backfill: a pre-existing highlight that already opened a thread was
      -- functionally a question, even though "kind" didn't exist yet.
      -- Everything else keeps the neutral default above.
      UPDATE highlights SET kind = 'slate'
        WHERE id IN (SELECT highlight_id FROM threads);
    `,
  },
  {
    // M8: the Desk (docs/marginalia/DESIGN.md). Per-resource freeform
    // shelf position/rotation/z-order, and a single-row notepad (the desk's
    // scratch pad) with its own publish ledger — `published_hash` compares
    // against the current content so "publish" is a no-op when nothing
    // changed, mirroring the `publishes` table's idempotency for threads
    // without needing a second table for a single row.
    version: 3,
    sql: `
      CREATE TABLE shelf_state (
        resource_id   TEXT PRIMARY KEY REFERENCES resources(id),
        x             REAL NOT NULL,
        y             REAL NOT NULL,
        rotation      REAL NOT NULL DEFAULT 0,
        z_order       INTEGER NOT NULL DEFAULT 0,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE notepad (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        content         TEXT NOT NULL DEFAULT '',
        published_hash  TEXT,
        updated_at      TEXT NOT NULL
      );
    `,
  },
  {
    // M9: the Scan (docs/marginalia/DESIGN.md). Importance is a user-set
    // 1-3 star rating (0 = unset); tags are freeform per-highlight labels.
    // `positionPercent` is deliberately NOT a column here — SPEC/TASKS calls
    // for it server-*computed* from prefix+exact+suffix char offsets in
    // resource_text (annotations/position.ts), not stored, so it never goes
    // stale if resource_text itself is ever re-extracted.
    version: 4,
    sql: `
      ALTER TABLE highlights ADD COLUMN importance INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE highlight_tags (
        highlight_id  TEXT NOT NULL REFERENCES highlights(id),
        tag           TEXT NOT NULL,
        PRIMARY KEY (highlight_id, tag)
      );
    `,
  },
  {
    // M13: a plain free-text note per highlight — the reader's own voice,
    // separate from the LLM thread (docs/marginalia/TASKS.md M13, settled
    // decision 7 in CLAUDE.md: distilled notes, not transcripts — the vault
    // compiler must keep reading only `threads`/`messages`, never this
    // column; see vault/compiler.ts, unchanged by this migration).
    version: 5,
    sql: `
      ALTER TABLE highlights ADD COLUMN note TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // M14: thread panels become draggable sticky notes (docs/decisions.md
    // 2026-07-27). Stored as an offset from the panel's anchor, not an
    // absolute stage coordinate — the anchor itself moves on every page
    // turn, resize, or margin-setting change, so an absolute coordinate
    // would rot the same way M8's shelf positions would have.
    version: 6,
    sql: `
      ALTER TABLE highlights ADD COLUMN panel_dx REAL NOT NULL DEFAULT 0;
      ALTER TABLE highlights ADD COLUMN panel_dy REAL NOT NULL DEFAULT 0;
    `,
  },
  {
    // M17 "send the reading position, and don't spoil" (docs/decisions.md
    // 2026-07-28 later). Nullable: spineIndex/percent are resolved
    // client-side from epub.js (the same computation the reader already
    // does for the margin rail and TOC), not re-derived server-side from
    // the CFI string, which would mean reimplementing epub.js's own
    // idref-dependent CFI parser — the SPEC-GAP is capturing it once, at
    // the point it's already known accurately, instead of guessing at it
    // from primitives on the server. A pre-M17 row (or a client that hasn't
    // reported these yet) simply has nulls, which context.ts treats as
    // "no known position" — the answer is unrestricted, not broken.
    version: 7,
    sql: `
      ALTER TABLE reading_state ADD COLUMN spine_index INTEGER;
      ALTER TABLE reading_state ADD COLUMN percent REAL;
    `,
  },
  {
    // M17 "surface silent windowing": a nullable per-message note, set only
    // on an assistant answer that was grounded in a window of the book
    // (later, a digest) rather than the whole text — the transparency
    // requirement decisions.md 2026-07-28 (later) calls non-negotiable.
    version: 8,
    sql: `
      ALTER TABLE messages ADD COLUMN context_note TEXT;
    `,
  },
  {
    // M17 usage ledger (docs/decisions.md 2026-07-28 later): one row per
    // LLM call, written from the single `withUsageLedger` seam wrapper
    // (llm/usage.ts) so no route or future call site can forget. Provenance
    // is always 'reported' or 'estimated' in practice today — see the
    // SPEC-GAP note on UsageProvenance in usage.ts.
    version: 9,
    sql: `
      CREATE TABLE llm_usage (
        id                TEXT PRIMARY KEY,
        provider          TEXT NOT NULL,
        model             TEXT NOT NULL,
        operation         TEXT NOT NULL,
        input_tokens      INTEGER NOT NULL,
        output_tokens     INTEGER NOT NULL,
        cache_read_tokens INTEGER,
        cost_usd          REAL,
        provenance        TEXT NOT NULL,
        duration_ms       INTEGER NOT NULL,
        created_at        TEXT NOT NULL
      );

      CREATE INDEX idx_llm_usage_created ON llm_usage(created_at);
    `,
  },
  {
    // M17 "the digest" (docs/decisions.md 2026-07-28 later): chapter is the
    // storage unit, so coverage (which chapters have rows) *is* the
    // resumability/gap-tracking mechanism — no separate cursor column.
    // Re-digesting a chapter is a plain REPLACE, making a re-scan
    // idempotent by construction. `digest_runs` is a single current-run row
    // per resource (same singleton pattern as `notepad`/`shelf_state`) that
    // exists only to drive the rate-limit pause/resume UX and pre-flight
    // messaging — it is not consulted for coverage.
    version: 10,
    sql: `
      CREATE TABLE chapter_digests (
        resource_id   TEXT NOT NULL REFERENCES resources(id),
        spine_index   INTEGER NOT NULL,
        summary       TEXT NOT NULL,
        themes        TEXT NOT NULL DEFAULT '[]',
        characters    TEXT NOT NULL DEFAULT '[]',
        source_hash   TEXT NOT NULL,
        generated_at  TEXT NOT NULL,
        PRIMARY KEY (resource_id, spine_index)
      );

      CREATE TABLE book_digests (
        resource_id   TEXT PRIMARY KEY REFERENCES resources(id),
        synopsis      TEXT NOT NULL,
        cast          TEXT NOT NULL DEFAULT '[]',
        themes        TEXT NOT NULL DEFAULT '[]',
        generated_at  TEXT NOT NULL
      );

      CREATE TABLE digest_runs (
        resource_id   TEXT PRIMARY KEY REFERENCES resources(id),
        spine_start   INTEGER NOT NULL,
        spine_end     INTEGER NOT NULL,
        status        TEXT NOT NULL,
        failed_spine_indices TEXT NOT NULL DEFAULT '[]',
        resumes_at    TEXT,
        last_error    TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
    `,
  },
  {
    // M17 "the context ladder": depth is remembered per book. Empty string
    // means "unset" — the route computes the actual default (Digest once
    // the book has one, Full otherwise) rather than baking that policy into
    // a stored value that would need a migration if the default ever
    // changes.
    version: 11,
    sql: `
      CREATE TABLE resource_ai_settings (
        resource_id           TEXT PRIMARY KEY REFERENCES resources(id),
        context_ladder_depth  TEXT NOT NULL DEFAULT '',
        updated_at            TEXT NOT NULL
      );
    `,
  },
  {
    // M17 "answer transparency": non-negotiable per decisions.md 2026-07-28
    // (later) — every answer records which ladder depth it used and, for
    // Digest, which chapters fed it, and that record must survive a reload
    // (unlike the live-only context_usage SSE field). Nullable: pre-M17
    // messages and the "off"/"full" depths (context_chapters stays '[]')
    // simply have nothing to show.
    version: 12,
    sql: `
      ALTER TABLE messages ADD COLUMN context_depth TEXT;
      ALTER TABLE messages ADD COLUMN context_chapters TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    // M18 "chapter labels on the coverage tiles": the digest's map step
    // (build.ts) now also emits a short descriptive title per chapter —
    // no new pipeline, a field on the existing call. Nullable so existing
    // digested chapters (generated before this column existed) just show
    // the positional fallback until re-digested; there is no backfill.
    version: 13,
    sql: `
      ALTER TABLE chapter_digests ADD COLUMN title TEXT;
    `,
  },
  {
    // M19 "provider profiles and roles" (docs/decisions.md 2026-07-29 later):
    // the single global provider config becomes a *profile*, and two named
    // *roles* (query, digest) point at profiles rather than each call site
    // reading the settings table directly. Migration must be silent — the
    // INSERT below reads whatever is already in `settings` (falling back to
    // the same defaults settings/store.ts's DEFAULTS uses, in case a key was
    // never written) and both roles point at the resulting profile, so
    // nobody has to reconfigure anything. llm_usage gains `role` (nullable —
    // pre-M19 rows genuinely have none) and `resource_id` (nullable — the
    // desk notepad's extract calls aren't tied to one book) so the Usage
    // divider can answer "which model, for which book".
    version: 14,
    sql: `
      CREATE TABLE provider_profiles (
        id                     TEXT PRIMARY KEY,
        name                   TEXT NOT NULL,
        provider               TEXT NOT NULL,
        anthropic_model        TEXT NOT NULL DEFAULT '',
        anthropic_api_key      TEXT NOT NULL DEFAULT '',
        claude_agent_model     TEXT NOT NULL DEFAULT '',
        openai_base_url        TEXT NOT NULL DEFAULT '',
        openai_model           TEXT NOT NULL DEFAULT '',
        openai_api_key         TEXT NOT NULL DEFAULT '',
        openai_context_tokens  TEXT NOT NULL DEFAULT '32768',
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );

      CREATE TABLE provider_roles (
        role        TEXT PRIMARY KEY,
        profile_id  TEXT REFERENCES provider_profiles(id)
      );

      INSERT INTO provider_profiles
        (id, name, provider, anthropic_model, anthropic_api_key, claude_agent_model,
         openai_base_url, openai_model, openai_api_key, openai_context_tokens,
         created_at, updated_at)
      VALUES (
        'default',
        'Default',
        COALESCE((SELECT value FROM settings WHERE key = 'provider'), 'anthropic'),
        COALESCE((SELECT value FROM settings WHERE key = 'anthropic_model'), 'claude-opus-4-8'),
        COALESCE((SELECT value FROM settings WHERE key = 'anthropic_api_key'), ''),
        COALESCE((SELECT value FROM settings WHERE key = 'claude_agent_model'), 'claude-sonnet-5'),
        COALESCE((SELECT value FROM settings WHERE key = 'openai_base_url'), ''),
        COALESCE((SELECT value FROM settings WHERE key = 'openai_model'), ''),
        COALESCE((SELECT value FROM settings WHERE key = 'openai_api_key'), ''),
        COALESCE((SELECT value FROM settings WHERE key = 'openai_context_tokens'), '32768'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );

      INSERT INTO provider_roles (role, profile_id) VALUES ('query', 'default');
      INSERT INTO provider_roles (role, profile_id) VALUES ('digest', 'default');

      ALTER TABLE llm_usage ADD COLUMN role TEXT;
      ALTER TABLE llm_usage ADD COLUMN resource_id TEXT REFERENCES resources(id);

      CREATE INDEX idx_llm_usage_resource ON llm_usage(resource_id);
    `,
  },
  {
    // M19.5 "the digest splits into a plot layer and a thematic layer"
    // (docs/decisions.md 2026-07-29 later): plot is `chapter_digests`/
    // `book_digests`, unchanged by this migration — the existing rows
    // simply *become* the plot layer, no re-digest required. Thematic is
    // new: per chapter *per brief*, cached by (resource, chapter, brief),
    // and expected to be cheap and re-run often, so it gets its own run-
    // tracking table rather than sharing `digest_runs` (a thematic run is
    // keyed by which brief it ran under; a plot run isn't).
    //
    // `resource_briefs` holds the reader's one standing angle per book —
    // editable in place, no history kept. `thematic_digests` snapshots the
    // brief's text and a hash of it alongside the analysis it produced, so
    // a later change to the live brief can be detected (hash mismatch =
    // stale) without losing the ability to show "the brief in force" for
    // analysis already on screen.
    version: 15,
    sql: `
      CREATE TABLE resource_briefs (
        resource_id   TEXT PRIMARY KEY REFERENCES resources(id),
        text          TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE thematic_digests (
        resource_id   TEXT NOT NULL REFERENCES resources(id),
        spine_index   INTEGER NOT NULL,
        brief_hash    TEXT NOT NULL,
        brief_text    TEXT NOT NULL,
        analysis      TEXT NOT NULL,
        themes        TEXT NOT NULL DEFAULT '[]',
        questions     TEXT NOT NULL DEFAULT '[]',
        generated_at  TEXT NOT NULL,
        PRIMARY KEY (resource_id, spine_index)
      );

      CREATE TABLE thematic_runs (
        resource_id           TEXT PRIMARY KEY REFERENCES resources(id),
        spine_start           INTEGER NOT NULL,
        spine_end             INTEGER NOT NULL,
        brief_hash            TEXT NOT NULL,
        status                TEXT NOT NULL,
        failed_spine_indices  TEXT NOT NULL DEFAULT '[]',
        resumes_at            TEXT,
        last_error            TEXT,
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL
      );
    `,
  },
  {
    // M19.5 "spoiler-safe digest display" (docs/decisions.md 2026-07-29
    // later): the book-level synopsis/cast/themes are a reduce over every
    // digested chapter, so they inherently spoil past the reader's
    // bookmark. This caches the *second*, bookmark-bounded reduce — only
    // one snapshot per resource is kept (the most recent), regenerated
    // lazily (see routes/digest.ts) rather than on every request.
    version: 16,
    sql: `
      CREATE TABLE book_digest_snapshots (
        resource_id      TEXT PRIMARY KEY REFERENCES resources(id),
        up_to_spine_index INTEGER NOT NULL,
        synopsis         TEXT NOT NULL,
        cast             TEXT NOT NULL,
        themes           TEXT NOT NULL,
        generated_at     TEXT NOT NULL
      );
    `,
  },
  {
    // M19.5 "the semantic scan: two layers" (docs/decisions.md 2026-07-29
    // later): the Mine layer's theme signal — themes tagged onto a highlight
    // (its quote + note + thread) by an extract pass against the thematic
    // layer's vocabulary (server/src/digest/themeTagging.ts). Same shape as
    // `highlight_tags` (M9) — a highlight's own reader-authored tags and its
    // model-tagged themes are deliberately separate tables, never merged,
    // since one is reader-authored and the other is a model proposal.
    version: 17,
    sql: `
      CREATE TABLE highlight_themes (
        highlight_id  TEXT NOT NULL REFERENCES highlights(id),
        theme         TEXT NOT NULL,
        PRIMARY KEY (highlight_id, theme)
      );
    `,
  },
  {
    // M19.6 "annotations are resizable": persisted per highlight exactly
    // like panel_dx/panel_dy already are, but nullable — NULL means "use
    // the panel's default size" (the existing `min(340px, ...)` CSS cap),
    // not zero, which would mean an invisible panel.
    version: 18,
    sql: `
      ALTER TABLE highlights ADD COLUMN panel_width REAL;
      ALTER TABLE highlights ADD COLUMN panel_height REAL;
    `,
  },
  {
    // M19.6 "page numbers, book-wide and stable" (decisions.md 2026-07-30):
    // a cache for epub.js's book.locations.save() blob. Not a column on
    // resources — resources are immutable-on-import (settled decision 5)
    // and this is a derived cache generated *after* import, not part of the
    // resource itself, same reasoning book_digest_snapshots already follows
    // as its own table. The server never parses `locations` — epub.js is a
    // web/-only dependency (SPEC: the server has no EPUB renderer) — so it
    // stays an opaque string all the way through.
    version: 19,
    sql: `
      CREATE TABLE resource_locations (
        resource_id   TEXT PRIMARY KEY REFERENCES resources(id),
        locations     TEXT NOT NULL,
        generated_at  TEXT NOT NULL
      );
    `,
  },
  {
    // M19.7 "response length is per role" (decisions.md 2026-07-30 "the
    // global overhaul"): `maxResponseTokens` moves off the flat `settings`
    // table onto `provider_roles`, since one profile can serve both roles
    // and a per-profile length couldn't express "same model, longer
    // digests" — decided pre-emptively in the 2026-07-28 entry, actually
    // built here. Backfilled from whatever the global setting already was
    // (not the bare column default) so existing values genuinely carry
    // over, the same COALESCE-from-settings trick migration 14 used for the
    // provider config itself.
    version: 20,
    sql: `
      ALTER TABLE provider_roles ADD COLUMN max_response_tokens INTEGER NOT NULL DEFAULT 8192;

      UPDATE provider_roles
        SET max_response_tokens = CAST(
          COALESCE((SELECT value FROM settings WHERE key = 'max_response_tokens'), '8192') AS INTEGER
        );
    `,
  },
  {
    // M21 (AUDIO.md "Data model"): per-resource listening state. `book_cast`
    // is not created here — it belongs to M22 (multi-voice), and this
    // migration only builds what M21's single-voice slice actually uses.
    version: 21,
    sql: `
      CREATE TABLE audio_state (
        resource_id     TEXT PRIMARY KEY REFERENCES resources(id),
        narrator_voice  TEXT NOT NULL DEFAULT '',
        voice_mode      TEXT NOT NULL DEFAULT 'single' CHECK (voice_mode IN ('single','multi')),
        speed           REAL NOT NULL DEFAULT 1.0,
        cast_scanned_at TEXT,
        updated_at      TEXT NOT NULL
      );
    `,
  },
  {
    // M22 (AUDIO.md "Data model" + "Casting"): `book_cast`, verbatim per the
    // spec's schema. `narrator_gender` lands on `book_digests` and
    // `book_digest_snapshots` too — the digest's book-level reduce is pass 1
    // of the cast scan (decisions.md 2026-07-28), and the reduce step now
    // also names the narrator's gender so voice assignment doesn't have to
    // guess it. Both `cast` columns already store a loosely-typed JSON blob
    // (no column change needed for the richer per-character shape).
    version: 22,
    sql: `
      CREATE TABLE book_cast (
        id            TEXT PRIMARY KEY,
        resource_id   TEXT NOT NULL REFERENCES resources(id),
        name          TEXT NOT NULL,
        aliases       TEXT NOT NULL DEFAULT '[]',
        gender        TEXT NOT NULL,
        age_hint      TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        voice_id      TEXT NOT NULL DEFAULT '',
        voice_locked  INTEGER NOT NULL DEFAULT 0,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        UNIQUE (resource_id, name)
      );

      ALTER TABLE book_digests ADD COLUMN narrator_gender TEXT NOT NULL DEFAULT 'unknown';
      ALTER TABLE book_digest_snapshots ADD COLUMN narrator_gender TEXT NOT NULL DEFAULT 'unknown';
    `,
  },
  {
    // M22.5 H ("which model actually answered, and what it really cost",
    // decisions.md 2026-08-04): four columns, all additive.
    // `message_id`/`profile_id` are the actual size of the task — without
    // them there's no way to join a ledger row to the answer it produced,
    // or to tell a local Ollama profile apart from a hosted OpenRouter one
    // (both `provider = 'openai-compatible'`). `model_source` records
    // whether `model` is what the endpoint echoed or only what we asked
    // for. `cost_basis` is the fix for "the one cost the ledger reports is
    // the one you are not billed for": billed (keyed Anthropic API),
    // notional (the Agent SDK's subscription figure — never charged), or
    // none (local). Backfilled from `provider`, the only signal pre-
    // migration rows have — a claude-agent row's non-null cost_usd was
    // always notional; an anthropic row's null cost_usd was real, unpriced
    // spend (anthropic.ts never populated it), not "free", so it backfills
    // to 'unpriced' rather than 'none'.
    version: 23,
    sql: `
      ALTER TABLE llm_usage ADD COLUMN message_id TEXT REFERENCES messages(id);
      ALTER TABLE llm_usage ADD COLUMN profile_id TEXT REFERENCES provider_profiles(id);
      ALTER TABLE llm_usage ADD COLUMN model_source TEXT NOT NULL DEFAULT 'configured';
      ALTER TABLE llm_usage ADD COLUMN cost_basis TEXT NOT NULL DEFAULT 'none';

      UPDATE llm_usage SET cost_basis = CASE
        WHEN provider = 'claude-agent' THEN 'notional'
        WHEN provider = 'anthropic' THEN 'unpriced'
        ELSE 'none'
      END;

      CREATE INDEX idx_llm_usage_message ON llm_usage(message_id);
      CREATE INDEX idx_llm_usage_profile ON llm_usage(profile_id);
    `,
  },
  {
    // M24.5 "themes worth colouring" (decisions.md, split out of M24
    // 2026-08-14): a distillation pass folds a book's dozens of per-chapter
    // theme strings under ~6-8 book-level themes, keyed to a colour a reader
    // can actually hold in their head. `canonical_themes` is library-wide —
    // not scoped to a resource, unlike every other table here — because the
    // same book-level theme ("Isolation") is meant to be recognised as one
    // entry across every book that surfaces it (TASKS.md M24.5 §3), matched
    // by the same slug/alias/Levenshtein rule vault/concepts.ts already uses
    // for vault concepts (settled decision 6: canonical themes live in
    // SQLite, never the vault, so this stays independent of that table).
    // `color_index` is assigned once, at creation, and never recomputed —
    // TASKS.md's "rebuilding a digest does not reshuffle the colours" is
    // true *because* a rebuild re-matches by name onto the same row rather
    // than re-deriving a colour from scratch.
    version: 24,
    sql: `
      CREATE TABLE canonical_themes (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        slug          TEXT NOT NULL UNIQUE,
        color_index   INTEGER NOT NULL,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE book_themes (
        resource_id         TEXT NOT NULL REFERENCES resources(id),
        canonical_theme_id  TEXT NOT NULL REFERENCES canonical_themes(id),
        generated_at        TEXT NOT NULL,
        PRIMARY KEY (resource_id, canonical_theme_id)
      );

      CREATE TABLE theme_parents (
        resource_id         TEXT NOT NULL REFERENCES resources(id),
        chapter_theme       TEXT NOT NULL,
        canonical_theme_id  TEXT NOT NULL REFERENCES canonical_themes(id),
        PRIMARY KEY (resource_id, chapter_theme)
      );

      CREATE INDEX idx_book_themes_resource ON book_themes(resource_id);
      CREATE INDEX idx_theme_parents_resource ON theme_parents(resource_id);
    `,
  },
  {
    // M26 "Codex CLI as a fourth provider" (decisions.md 2026-08-25): the
    // fourth provider needs its own model field on the profile, same shape
    // as `claude_agent_model` above — a subscription CLI provider names a
    // model but never a key, so there's no paired `_api_key` column here.
    version: 25,
    sql: `
      ALTER TABLE provider_profiles ADD COLUMN codex_model TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    // M30 C "the Define button": a definition rides on the highlight it was
    // looked up for, as two columns rather than a table of its own.
    //
    // ⚠️ This is the shape M30 D's glossary depends on. The glossary is a
    // *filtered view* — "sage highlights in this book whose definition isn't
    // empty" — and a `definitions` (or `glossary`) table would be a second
    // source of truth that goes stale the moment a highlight is deleted.
    // Living on the row means deleteHighlight already cleans it up, with no
    // cascade to write and none to forget.
    //
    // `definition_source` records *which of Define's two paths answered* —
    // 'dictionary' (the bundled WordNet, offline) or 'digest' (the capped
    // M17 digest-rung call). It is shown to the reader, not just logged:
    // "what the dictionary says" and "what this book seems to mean by it"
    // are different claims and must not look alike. Empty string means no
    // definition, matching `definition`'s own default — never NULL, so the
    // glossary's filter is one predicate rather than two.
    version: 26,
    sql: `
      ALTER TABLE highlights ADD COLUMN definition TEXT NOT NULL DEFAULT '';
      ALTER TABLE highlights ADD COLUMN definition_source TEXT NOT NULL DEFAULT '';
    `,
  },
];
