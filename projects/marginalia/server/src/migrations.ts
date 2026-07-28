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
];
