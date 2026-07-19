# Marginalia — Implementation Spec

This spec is prescriptive. The architectural decisions are already made (see CLAUDE.md
"Settled decisions" and docs/decisions.md) — implement what's written here; don't
redesign. Where this spec is silent, pick the most boring option and leave a
`// SPEC-GAP:` comment so it can be reviewed.

## Stack (fixed)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript everywhere, strict mode | |
| Package manager | pnpm workspaces | workspace root at `projects/marginalia/` |
| Server | Node 22+, Express 5 | plain REST + SSE; no framework magic |
| Validation | zod | every API body and every LLM JSON output has a schema |
| DB | better-sqlite3 | synchronous API is fine; single local user |
| Web | Vite + React 18 + TypeScript | plain CSS modules or vanilla-extract; **no UI kit** (beauty is hand-made) |
| EPUB render (browser) | epub.js (`epubjs`) | wrapped behind our own `ReaderView` component so it's replaceable |
| EPUB text extract (server) | `adm-zip` + `htmlparser2` | parse OPF spine → xhtml → plain text per spine item |
| LLM SDK | `@anthropic-ai/sdk` (Anthropic impl); raw `fetch` (OpenAI-compatible impl) | behind `LLMProvider` — no SDK types outside `server/src/llm/` |

## Repo layout

```
projects/marginalia/
  package.json            # pnpm workspace root, scripts: dev, build, test
  pnpm-workspace.yaml
  shared/                 # zod schemas + TS types shared by server & web
    src/schemas.ts        # Resource, Highlight, Anchor, Thread, Message, Settings
  server/
    src/
      index.ts            # express bootstrap, static serve of web build in prod
      db.ts               # better-sqlite3 init + migrations (plain SQL strings, versioned)
      library/            # import, hashing, text extraction
      annotations/        # highlights + threads store
      llm/
        provider.ts       # LLMProvider interface + registry
        anthropic.ts
        openaiCompat.ts
        context.ts        # context builder
      vault/
        compiler.ts       # distill + publish
        concepts.ts       # concept matching (code, not LLM)
      routes/             # one file per resource: resources.ts, highlights.ts, threads.ts, publish.ts, settings.ts
  web/
    src/
      app/                # routing, theme, layout
      library/            # library grid, import UI
      reader/             # ReaderView (epub.js wrapper), selection → highlight affordance
      threads/            # inline thread UI, margin rail
      settings/
  data/                   # gitignored runtime data (created at startup)
    library/<sha256>.epub
    marginalia.sqlite
```

All runtime data lives under `projects/marginalia/data/` (gitignored). Vault path is
user-configured in settings.

## Data model (SQLite)

Migrations are numbered SQL strings run in order at startup; store applied version in
`pragma user_version`.

```sql
CREATE TABLE resources (
  id            TEXT PRIMARY KEY,        -- sha256 of file bytes (content-addressed)
  title         TEXT NOT NULL,
  author        TEXT,
  format        TEXT NOT NULL,           -- 'epub' (only value in v1)
  file_path     TEXT NOT NULL,           -- data/library/<id>.epub
  metadata      TEXT NOT NULL DEFAULT '{}', -- JSON: language, publisher, cover info
  imported_at   TEXT NOT NULL            -- ISO 8601
);

CREATE TABLE resource_text (               -- extracted at import, immutable
  resource_id   TEXT NOT NULL REFERENCES resources(id),
  spine_index   INTEGER NOT NULL,        -- order in the book
  href          TEXT NOT NULL,           -- spine item href (joins to epub.js section)
  text          TEXT NOT NULL,           -- plain text of that spine item
  PRIMARY KEY (resource_id, spine_index)
);

CREATE TABLE reading_state (
  resource_id   TEXT PRIMARY KEY REFERENCES resources(id),
  location      TEXT NOT NULL,           -- epub.js CFI of current position
  updated_at    TEXT NOT NULL
);

CREATE TABLE highlights (
  id            TEXT PRIMARY KEY,        -- uuid v4
  resource_id   TEXT NOT NULL REFERENCES resources(id),
  exact         TEXT NOT NULL,           -- the selected text, verbatim
  prefix        TEXT NOT NULL,           -- ≤64 chars of text before selection
  suffix        TEXT NOT NULL,           -- ≤64 chars of text after selection
  cfi           TEXT NOT NULL,           -- epub.js CFI range (primary anchor)
  spine_index   INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE threads (
  id            TEXT PRIMARY KEY,        -- uuid v4
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

CREATE TABLE publishes (                  -- idempotency ledger for vault compiler
  thread_id     TEXT PRIMARY KEY REFERENCES threads(id),
  note_path     TEXT NOT NULL,           -- path inside the vault
  content_hash  TEXT NOT NULL,           -- hash of distilled note; skip rewrite if same
  published_at  TEXT NOT NULL
);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,        -- 'provider', 'anthropic_model', 'openai_base_url', 'openai_model', 'vault_path', ...
  value         TEXT NOT NULL
);
```

**Anchoring rule:** the CFI range is the primary anchor (resources are immutable, so it
cannot rot). `exact`/`prefix`/`suffix` are the fallback: if CFI resolution fails at
render time, search the spine item's text for `prefix + exact + suffix`, then `exact`
alone; if still not found, show the highlight in the margin rail as "unanchored" rather
than dropping it. Anchoring resolution logic gets unit tests.

**Additive migrations (M7+).** The schema above is migration 001 and is never edited
retroactively. Later milestones add numbered additive migrations, defined per-milestone
in TASKS.md/DESIGN.md: M7 `highlights.kind`; M8 shelf state + notepad; M9
`highlights.importance` + `highlight_tags` + server-computed `positionPercent`.

## HTTP API

All JSON bodies validated with zod schemas from `shared/`. Errors: `{ error: string }`
with proper status codes.

| Method & path | Purpose |
|---|---|
| `POST /api/resources` | multipart upload of an .epub → import (hash, store, extract text, parse metadata) → resource JSON. Re-importing same bytes returns the existing resource (200, not error). |
| `GET /api/resources` | library list (id, title, author, imported_at, highlight/thread counts) |
| `GET /api/resources/:id` | single resource metadata |
| `GET /api/resources/:id/file` | raw epub bytes (for epub.js in the browser) |
| `GET /api/resources/:id/position` / `PUT` | reading position (CFI) |
| `GET /api/resources/:id/highlights` | all highlights + their thread summaries for render |
| `POST /api/highlights` | `{resourceId, exact, prefix, suffix, cfi, spineIndex}` → highlight |
| `DELETE /api/highlights/:id` | also deletes its thread/messages (cascade in code) |
| `POST /api/threads` | `{highlightId, question}` → **SSE stream**. Creates thread + user message, streams assistant tokens as `data: {"text": "..."}` events, ends with `data: {"done": true, "messageId": ...}`. Persists assistant message on completion. |
| `POST /api/threads/:id/messages` | `{question}` follow-up → same SSE contract |
| `GET /api/threads/:id` | full message history |
| `POST /api/resources/:id/publish` | run vault compiler for this resource → `{notes: n, conceptsCreated: n, conceptsLinked: n}` |
| `GET /api/settings` / `PUT` | provider config + vault path. Never return API keys in GET (return `"***"` if set). |

SSE notes: set `Content-Type: text/event-stream`, flush on every token, handle client
disconnect by aborting the provider stream. If the provider errors mid-stream, emit
`data: {"error": "..."}` then end; do not persist a partial assistant message.

## LLM layer

### The seam

```ts
// server/src/llm/provider.ts — the ONLY types the rest of the server may import
export interface LLMProvider {
  readonly id: 'anthropic' | 'openai-compatible';
  capabilities(): { contextTokens: number; supportsCaching: boolean };
  // Streams plain text chunks. `system` is split into stable/volatile parts so the
  // provider can place cache boundaries. Throws LLMError on failure.
  stream(req: {
    instructions: string;        // stable system instructions
    bookContext: string;         // large, stable per-book context (cacheable)
    messages: { role: 'user' | 'assistant'; content: string }[];
    signal?: AbortSignal;
  }): AsyncIterable<{ text: string }>;
  // Returns schema-validated JSON. Implementations must validate with the zod schema
  // and throw LLMError('extract_parse_failed') on invalid output (one retry allowed).
  extract<T>(req: {
    instructions: string;
    input: string;
    schema: z.ZodType<T>;
  }): Promise<T>;
}
```

`LLMError` carries a machine-readable `code` (`auth`, `rate_limit`, `context_too_large`,
`extract_parse_failed`, `network`, `refused`, `unknown`) — routes map these to HTTP
statuses and the UI shows human messages.

### Anthropic implementation (`anthropic.ts`)

Verified against current SDK docs (July 2026) — do not substitute remembered API shapes:

- Package `@anthropic-ai/sdk`. Default model `claude-opus-4-8` (settings key
  `anthropic_model` overrides; users may set e.g. `claude-sonnet-5` for cheaper reads).
- **Do NOT send `temperature`, `top_p`, `top_k`, or `thinking: {budget_tokens}`** —
  these return 400 on current models. Omit sampling params entirely; omit `thinking`.
- Streaming: `client.messages.stream({...})`, iterate text via the stream's
  `content_block_delta` / `text_delta` events (or `stream.on('text', ...)`); use
  `max_tokens: 8192` for thread answers.
- **Prompt caching (the whole point of whole-book context):** build
  `system` as an array of two text blocks — `[ {type:'text', text: instructions},
  {type:'text', text: bookContext, cache_control: {type:'ephemeral'}} ]`.
  The book text is byte-identical across every question in a session, so follow-ups
  hit cache (~0.1× input price). Never interpolate anything volatile (timestamps,
  question text) into these blocks. Log `usage.cache_read_input_tokens` from the final
  message at debug level so cache behavior is observable.
- Extraction: use `client.messages.parse` with `zodOutputFormat(schema)` from
  `@anthropic-ai/sdk/helpers/zod` (passed as `output_config: {format: ...}`).
  `parsed_output` can be null — treat as `extract_parse_failed`.
- Handle `stop_reason === 'refusal'` → `LLMError('refused')`.
- Errors: catch the SDK's typed classes (`Anthropic.AuthenticationError`,
  `Anthropic.RateLimitError`, `Anthropic.APIError`) — never string-match messages.
- `capabilities()`: `{ contextTokens: 1_000_000, supportsCaching: true }`.

### OpenAI-compatible implementation (`openaiCompat.ts`)

- Config: `openai_base_url`, `openai_model`, `openai_api_key` from settings. Works for
  any chat-completions server (Hermes via vLLM/ollama/llama.cpp, OpenRouter, etc.).
- `POST {base_url}/chat/completions` with `stream: true`; parse SSE lines
  (`data: {...}`, terminated by `data: [DONE]`); text at
  `choices[0].delta.content`.
- `bookContext` goes into the system message after instructions (no cache API —
  `supportsCaching: false`).
- Extraction: request `response_format: {type: 'json_object'}` when the server accepts
  it; always `schema.safeParse` the result; on failure retry once with the validation
  error appended to the prompt; then `extract_parse_failed`.
- `capabilities().contextTokens` from settings key `openai_context_tokens`
  (default 32768).

### Context builder (`context.ts`)

- Input: resource id + highlight. Load all `resource_text` rows in spine order.
- Estimate tokens as `chars / 3.5` (conservative). If full text ≤ 70% of provider
  `contextTokens`, use the whole book. Otherwise use a window: the highlight's spine
  item ± neighbors, expanding alternately, until the budget is filled.
- Render `bookContext` as: title/author header, then each spine item as
  `--- [section {n}] ---\n{text}`. **Deterministic** — same book must produce
  byte-identical context every time (cache invariant).
- The user message for a question:
  ```
  The reader highlighted this passage:

  > {exact}

  (context around it: "...{prefix}[highlighted]{suffix}...")

  Their question: {question}
  ```
- `instructions` (stable): the assistant is a thoughtful reading companion; answer
  grounded in this book; quote the book when referencing it; be concise but substantive;
  if the answer isn't in the book, say so and answer from general knowledge, marked as
  such.

## Vault compiler (`vault/`)

LLM proposes, code disposes — the model returns JSON; only our code touches files.

1. For each thread of the resource without an up-to-date `publishes` row:
   `extract()` with schema:
   ```ts
   z.object({
     title: z.string(),                    // short note title for this insight
     summary: z.string(),                  // 2–6 sentence distilled insight (markdown)
     concepts: z.array(z.object({
       name: z.string(),                   // canonical concept name, Title Case
       aliases: z.array(z.string()),
       gloss: z.string(),                  // one-line definition
     })).max(5),
   })
   ```
   Input: the highlighted passage + full thread transcript.
2. **Concept matching (code, `concepts.ts`):** list `<vault>/Concepts/*.md`. A proposed
   concept matches an existing note if: slug-normalized names are equal, OR any alias
   equals an existing name/alias (aliases stored in the note's YAML frontmatter), OR
   normalized Levenshtein similarity ≥ 0.85. Match → link existing; no match → create
   `Concepts/<Name>.md` with frontmatter (`aliases`, `created`) + gloss + a
   `## Mentions` section.
3. Write `Readings/<Book Title>/<NN> - <title-slug>.md`: frontmatter (book, author,
   thread id, date), the quoted passage as a blockquote, the distilled summary,
   `[[Concept Name]]` links, and a `Sources` line. Append a mention line to each
   concept note's `## Mentions` (idempotent: skip if a line for this thread id exists).
4. Write/refresh `Readings/<Book Title>/_Book.md` — book overview with links to every
   note.
5. Record in `publishes` with the note's content hash. Re-publish with identical hash
   is a no-op; changed hash rewrites the same file path (stable name from thread id
   ordering). Never delete user-edited vault files; only rewrite files we created
   (tracked in `publishes`).
6. All vault writes go through one `writeVaultFile(relPath, content)` helper that
   refuses paths escaping the vault root.

## Web UI — structure & quality bar

- **Routes:** `/` (library), `/read/:id` (reader), `/settings`.
- **Reader layout:** centered column of book text (max ~70ch), margin rail on the right
  showing thread indicators aligned to their highlight's vertical position; header with
  book title + progress; footer pagination controls. Keyboard: ←/→ pages.
- **Selection affordance:** on text selection inside the reader, show a small floating
  pill ("Ask" + highlight color dot). Clicking Ask anchors the highlight, opens an
  inline thread panel (slides in from the margin, anchored visually to the highlight),
  with a textarea. Streaming answer renders as markdown, token by token.
- **Threads are collapsible:** collapsed = a subtle marker in the margin rail;
  expanded = the panel. Highlights in text get a soft background tint.
- **Theming:** light + dark ("paper" and "ink"), CSS custom properties, serif book
  face for reading (e.g. 'Iowan Old Style', 'Palatino', Georgia stack — no webfont
  dependency in v1), sans for chrome. Respect `prefers-color-scheme`, allow override.
- **Quality bar (from CLAUDE.md):** no layout jank when panels open (reserve space or
  overlay), no blocking spinners over book text, focus states, smooth 150–200ms
  ease-out transitions. Empty states designed (empty library invites a drag-drop).
- Reader must remain fully usable with the LLM unconfigured — Ask affordance shows a
  "configure a provider" nudge instead of erroring.

## Testing & verification

- Unit tests (vitest) required for: anchoring resolution (CFI fail → text search
  fallback), context builder windowing + determinism, concept matching, vault path
  safety, SSE stream parsing of the OpenAI-compat provider (against a mocked stream).
- Every milestone in TASKS.md ends with a manual verification step ("drive the app")
  — do it with a real EPUB. Keep 2–3 public-domain EPUBs in `projects/marginalia/
  fixtures/` (e.g. from Standard Ebooks) for tests and manual runs.
- `pnpm dev` at the workspace root must start server (port 5175) + web (Vite, port
  5173, proxying `/api` to 5175) concurrently.
