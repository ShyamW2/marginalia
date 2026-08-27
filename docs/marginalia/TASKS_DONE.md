## M0 — Scaffold

- [x] `projects/marginalia/` pnpm workspace: root `package.json`, `pnpm-workspace.yaml`,
      packages `shared/`, `server/`, `web/` (strict TS configs, shared base tsconfig)
- [x] `shared/src/schemas.ts`: zod schemas + inferred types for Resource, Anchor,
      Highlight, Thread, Message, Settings (per SPEC data model)
- [x] Express server: bootstrap, `/api/health` → `{ok: true}`, error-handling
      middleware, `data/` dir creation at startup
- [x] SQLite init + migration runner (`db.ts`) with migration 001 = full SPEC schema
- [x] Vite React app: routes `/`, `/read/:id`, `/settings` (placeholder pages), theme
      CSS custom properties (paper/ink), proxy `/api` → server
- [x] Root `pnpm dev` runs both; `pnpm test` runs vitest; `pnpm build` builds both
- [x] Download 2 public-domain EPUBs into `projects/marginalia/fixtures/`
- [x] **Verify:** `pnpm dev` → browser shows themed placeholder app; `curl
      localhost:5175/api/health` returns ok; `pnpm test` passes (one smoke test)

## M1 — Import & library

- [x] Server: EPUB metadata + text extraction (`library/`): unzip, parse OPF (title,
      author, spine), extract plain text per spine item → `resource_text`
- [x] `POST /api/resources` (multipart): sha256 hash, store to `data/library/`,
      extract, insert; duplicate import returns existing resource
- [x] `GET /api/resources`, `GET /api/resources/:id`, `GET /api/resources/:id/file`
- [x] Web: library grid (title/author cards), drag-drop + file-picker import with
      progress state, designed empty state
- [x] Unit tests: extraction against a fixture EPUB (spine count, non-empty text,
      correct title)
- [x] **Verify:** import both fixture EPUBs via drag-drop; they appear in the grid;
      re-importing one is a no-op; `resource_text` rows exist in sqlite
      _(verified 2026-07-13: API + headless-browser pass; 14/5 `resource_text` rows,
      dedupe confirmed, `:id/file` serves `application/epub+zip`, non-epub → 400 +
      inline UI error)_

## M2 — Reader

- [x] `ReaderView` component wrapping epub.js: load book from
      `/api/resources/:id/file`, paginated flow mode, centered column layout per SPEC
- [x] Keyboard (←/→) + click-zone page turns; progress indicator in header
- [x] Reading position: save CFI (debounced) via `PUT /api/resources/:id/position`,
      restore on open
- [x] Paper/ink themes applied *inside* the epub iframe (epub.js themes API) and
      matching chrome outside
- [x] Typography pass: serif book stack, comfortable measure/leading, margins
- [x] **Verify:** open a fixture book, read/page through it, close, reopen → same
      position; toggle dark mode → book content and chrome both switch; it looks like
      something you'd *choose* to read in
      _(verified 2026-07-16: headless-browser pass against both fixtures — paginated
      flow renders with serif typography in a centered column; Next/Prev buttons,
      window-level and in-iframe ←/→ keys, and click-zone (left/right thirds, middle
      inert) all turn pages; progress % updates and reaches whole-book percentages
      once `book.locations.generate()` resolves; position saves debounced and
      restores near-exactly on reload; toggling Ink switches both the chrome and the
      epub iframe's injected theme together)_

## M3 — Highlights

- [x] Selection capture in the epub iframe: on selection, compute `{exact, prefix,
      suffix, cfi (range CFI), spineIndex}`; show floating "Ask" pill near selection
- [x] `POST /api/highlights`, `GET /api/resources/:id/highlights`,
      `DELETE /api/highlights/:id` (cascades thread + messages)
- [x] Render persisted highlights on section load (epub.js annotations), soft tint;
      clicking a highlight selects it
- [x] Anchor resolution fallback (SPEC anchoring rule) + unit tests: CFI resolves;
      CFI broken → prefix/exact/suffix search; unresolvable → "unanchored" flag
- [x] Margin rail: dot per highlight on the current page area; click → scroll/flip to it
- [x] **Verify:** highlight three passages across different chapters; reload → all
      three render in place; delete one from the rail; dots navigate correctly
      _(verified 2026-07-17: headless-browser pass against the Alice fixture —
      selecting real on-screen text raises the Ask pill within viewport bounds;
      posting a highlight renders its soft-tint mark immediately via epub.js's
      marks-pane; two highlights created in different chapters both show as margin
      rail dots that survive a full reload; clicking a dot navigates to and
      re-renders its mark; deleting via the rail's hover-revealed × removes both the
      dot and the on-page mark and is reflected server-side)_

## M4 — LLM provider layer

- [x] `LLMProvider` interface + `LLMError` + provider registry reading settings
      (`llm/provider.ts`) — exactly per SPEC seam
- [x] Anthropic implementation per SPEC (streaming, 2-block system with
      `cache_control` on book context, `messages.parse` + `zodOutputFormat` for
      extract, typed error mapping, refusal handling, debug log of cache reads)
- [x] OpenAI-compatible implementation per SPEC (SSE parsing, extract with safeParse +
      one retry)
- [x] Context builder (`llm/context.ts`): whole-book vs window logic, deterministic
      rendering + unit tests (determinism, budget respected, window centers on
      highlight)
- [x] Settings API + settings page: provider picker, model, base URL, API keys
      (masked), vault path, context tokens; "Test connection" button that runs a
      1-token stream; base-URL presets for openaiCompat (OpenRouter / Ollama /
      LM Studio / Custom)
      _(Deferred, NOT part of M4: a third `claudeAgent` provider using the Claude
      Agent SDK for subscription-credit access — see docs/decisions.md 2026-07-17
      provider-strategy entry. Do not build it in M4.)_
- [x] Dev CLI: `pnpm --filter server ask <resourceId> "<question>"` streams an answer
      to stdout (verifies the layer without UI)
- [x] Unit tests: openaiCompat SSE parsing (mocked), context builder; manual: CLI ask
      against both a real Anthropic key and one OpenAI-compatible endpoint if available
- [x] **Verify:** CLI ask on a fixture book returns a grounded streamed answer; second
      ask on same book logs `cache_read_input_tokens > 0` (Anthropic)
      _(verified 2026-07-17: 25/25 unit tests pass (llm/context, llm/openaiCompat SSE
      parsing); full `tsc -b` clean on server+web; CLI ask (both direct `tsx` and the
      documented `pnpm --filter server ask <id> "<question>"` form) against the Alice
      fixture through a local Ollama server (llama3.1:8b, openaiCompat provider) returns
      a grounded, correctly-streamed answer; Settings page driven in a real headless
      browser — provider toggle, field population, and "Test connection" all confirmed
      working end-to-end against that same live endpoint, including its failure path
      (unknown model → surfaced error message). No Anthropic API key was available in
      this environment, so the Anthropic-specific `cache_read_input_tokens > 0` check
      could not be run live — the Anthropic implementation is unit-tested and
      type-checked but not yet exercised against the real API; do that first with a
      real key before relying on its caching behavior)_

## M5 — Inline threads (the core interaction)

- [x] `POST /api/threads` + `POST /api/threads/:id/messages` SSE endpoints per SPEC
      (persist on completion, abort on disconnect, error event contract)
- [x] Thread panel UI: opens from the Ask pill, visually anchored to the highlight,
      question textarea, streamed markdown answer, follow-up input, collapse to margin
      marker
- [x] Margin rail shows thread state (has-answer vs unanswered); reopening a book
      restores all threads collapsed; clicking a highlight or rail dot expands its
      thread
- [x] Unconfigured-provider nudge state ("configure a provider" → link to settings)
- [x] Streaming UX polish: token-by-token render without scroll jank, stop button
      (aborts SSE), error state with retry
- [x] **Verify (the product moment):** read a chapter, highlight a passage, ask a real
      question, watch the answer stream inline; ask a follow-up; collapse it; flip
      pages; come back → thread is there. Do this for 15 minutes with a real book and
      note friction in docs/marginalia/NOTES.md
      _(verified 2026-07-17: 36/36 unit tests pass across all packages; full `tsc -b`
      clean. Driven end-to-end in a real headless browser against a live local
      Ollama endpoint (openaiCompat) on the Alice fixture: select text → Ask pill →
      highlight created → panel opens anchored at the selection, no layout jank;
      typed question streams a real grounded markdown answer token-by-token with
      stick-to-bottom autoscroll; asked a follow-up in the same thread; Stop mid-stream
      correctly aborts and returns to the composer with no partial persisted; collapsed
      via the × button; full page reload restores every thread collapsed (SPEC) with
      the margin rail showing outlined-vs-filled dots for unanswered-vs-answered
      threads; clicking a dot reopens the panel with complete history restored;
      deleting a highlight whose thread is open closes the panel; unconfigured-provider
      nudge (with a working Settings link) verified by clearing the provider config and
      confirming the composer is replaced, not errored; both Paper and Ink themes
      checked. This was driven by an automated browser, not a human 15-minute reading
      session — a real read-through is still worth doing before calling the product
      moment fully validated, but every mechanical piece of the interaction is
      confirmed working)_

## M6 — Vault compiler

**M6 pre-flight fixes** — from the 2026-07-17 M4/M5 senior review (full
detail + reproduction notes in NOTES.md, "Senior review + M4/M5 sign-off").
Do these first, in order:

- [x] Fix message persistence: write the user+assistant message pair in one
      transaction *after* the stream completes (SPEC: persist on completion);
      error/abort persists nothing. Make UI Retry not duplicate the optimistic
      user bubble. Verify: provider-500 → retry → thread has exactly one copy
      of the question and no dangling rows
      _(verified 2026-07-17: live against a local Ollama openaiCompat
      endpoint — pointed the provider at an unreachable URL, asked a
      question, confirmed the thread row exists with zero messages after the
      `network: fetch failed` error; restored the working endpoint and
      re-posted the same question (simulating UI Retry), confirmed the
      thread ends with exactly one user + one assistant message, no
      duplicate. `pnpm build` + `pnpm test` (46/46) clean.)_
- [x] Security: remove `app.use(cors())` (same-origin via Vite proxy/static
      serving — nothing needs CORS) and bind `app.listen(PORT, "127.0.0.1")`.
      Verify: no `Access-Control-Allow-Origin` header; server unreachable from
      non-loopback
      _(verified 2026-07-17: `curl` with an `Origin` header, including a
      preflight OPTIONS, returns no `Access-Control-*` headers; `curl` to the
      machine's LAN IP on the server port fails to connect (loopback-only),
      confirming the exfiltration path via `/api/settings/test` is closed.
      Also dropped the now-unused `cors`/`@types/cors` deps.)_
- [x] `openaiCompat.ts`: send `max_tokens: THREAD_MAX_TOKENS` in stream and
      extract request bodies (const currently declared but unused)
      _(verified 2026-07-17: added to both request bodies; exercised via the
      live Ollama stream above without incident; `openaiCompat.test.ts`
      still 7/7 green.)_
- [x] (Quick wins) — **moved to M7** as its first task (decisions.md 2026-07-19);
      nothing left to do here

- [x] Distill extraction call + schema (`vault/compiler.ts`) per SPEC
      _(verified 2026-07-17: zod/v4 schema per the M4 note; instructions
      spell out the exact JSON shape — needed for small local models under
      `response_format: json_object`, which otherwise invent their own
      shape. Live-tested against Ollama llama3.1:8b.)_
- [x] Concept matching in code (`vault/concepts.ts`): slug/alias/Levenshtein rules +
      unit tests (match, no-match, alias hit)
      _(12/12 unit tests: exact slug, alias hit either direction, Levenshtein
      fuzzy match, no-match, frontmatter parsing, missing Concepts folder.)_
- [x] Note writers: reading note, concept note create/append-mention, `_Book.md`
      overview; `writeVaultFile` path-safety helper + unit test (rejects `../`)
      _(4/4 path-safety unit tests incl. `../` and absolute-path escapes.
      Bug caught during live verification: a concept name containing "/"
      broke its own wikilink (file sanitized, link text wasn't) — fixed by
      deriving the canonical concept name from the sanitized filename;
      regression test added.)_
- [x] Idempotency: `publishes` ledger, unchanged-hash no-op, changed-hash rewrite,
      never touch untracked files
      _("Up to date" = a `publishes` row already exists for the thread — see
      SPEC-GAP comment in compiler.ts (no cheap staleness signal, and
      re-extracting identical input isn't guaranteed byte-identical, which
      would break idempotency). Live-verified: full sha256 diff of every
      vault file before/after a second publish was empty.)_
- [x] `POST /api/resources/:id/publish` + UI: publish button on library card + in
      reader, result toast ("4 notes, 2 new concepts, 3 linked")
      _(Live-verified with a real headless-browser pass in both themes;
      toast on the library card and in the reader; reader toast repositioned
      to the top after catching it overlapping the Previous/Next pagination
      buttons at the bottom.)_
- [x] **Verify:** against a scratch vault: publish a book with 3+ threads → folders/
      notes/concepts appear and open correctly in Obsidian; publish again → no changes;
      threads from a second book sharing a concept link to the SAME concept note
      _(verified 2026-07-17: real end-to-end run against a scratch vault
      using a live local Ollama endpoint (not mocked) — 3 answered threads on
      Metamorphosis published to 3 reading notes + 15 concept notes + a
      `_Book.md` overview; every `[[wikilink]]` in the reading notes resolves
      to an actual concept file (scripted check); a second publish produced
      byte-identical files (sha256 diff empty) with zero re-extraction calls;
      a second book (Alice) published cleanly into the same vault. Also
      caught and fixed a real bug along the way: `deleteHighlight` didn't
      cascade to the `publishes` table, so deleting a highlight whose thread
      had been published failed on a foreign-key violation — fixed with a
      regression test. Cross-book concept-linking onto the *same* note is
      deterministically covered by compiler.test.ts (not relied on live,
      since two different books happening to converge on identical concept
      names from a small local model isn't a reliable thing to wait for).
      Manual "open in Obsidian" was not literally done — Obsidian isn't
      installed in this environment — but every note was checked to be
      well-formed markdown with valid YAML-safe frontmatter and
      link-target-verified wikilinks, which is the practical equivalent.)_

## M7 — Beauty & revisit pass (v1 close-out + motion foundation)

Design direction for M7–M10 lives in docs/marginalia/DESIGN.md — read it before
starting any milestone from here on.

- [x] M6 carry-over quick wins: Anthropic `capabilities()` context size per model,
      not hardcoded 1M; trim provider error bodies from SSE `{error}` events (log
      raw server-side); catch the `UNIQUE(highlight_id)` race in thread creation
      and reuse the existing thread
- [x] Highlight kinds (decisions.md 2026-07-19): additive migration
      `highlights.kind` ∈ rose|sage|honey|slate (backfill: has-thread → slate,
      else rose); selection pill shows four kind dots + Ask (Ask without a pick =
      slate); marks, rail dots, and thread-panel spine tinted by kind — muted
      theme-aware washes per DESIGN.md reference hues, contrast-checked in both
      themes
- [x] Adopt `motion` (framer-motion successor); code-split routes with `React.lazy`
      (epub.js loads only in the reader; kills the 552KB single-chunk build warning)
- [x] Motion pass: panel open/close, pill appearance, page-turn feel (150–200ms
      ease-out, no jank); transitions interruptible, `transform`/`opacity` only
- [x] First doorway transition: library card → reader as a shared-element zoom
      (proof of the motion system; plain crossfade under reduced motion)
- [x] Library polish: covers extracted from EPUBs, annotated-book indicator (thread
      count), recently-read ordering
- [x] Reader revisit affordances: "annotations" overview (list of all threads in book,
      jump-to), unanchored-highlight surfacing
- [x] Reading focus mode: `f` toggles all marks/tabs/rail dots for a clean page;
      subtle "notes hidden" indicator; persists for the session
      _(verified 2026-07-19: headless-browser pass against the Alice fixture
      — `f` hides the Annotations button behind a "Notes hidden" indicator,
      hides the margin rail, and repaints every mark transparent; a second
      `f` restores all three. Ignores the key while typing in the thread
      panel. Live verification also surfaced and fixed a real pre-existing
      epub.js mark-tracking bug — see NOTES.md, "reading focus mode + a real
      epub.js mark-tracking bug" — that affected theme re-tinting and
      highlight deletion too, not just focus mode.)_
- [x] Dark mode audit across every view; focus-visible states; reduced-motion respect
      _(verified 2026-07-19: static audit found zero hardcoded colors anywhere
      in `web/src` outside `theme.css`/`highlightKinds.ts`/`useEpubThemeVars.ts`
      (the three theme-aware files) — every component already themes purely
      through CSS custom properties. Both `outline: none` occurrences
      (ThreadPanel textarea, SettingsPage input) have a compensating
      `:focus-visible` border/box-shadow, not a silently removed focus ring;
      every other interactive element either has an explicit
      `:focus-visible` rule or falls back to the browser's native ring (no
      global button/outline reset strips it). All 6 components using
      `motion` call `useReducedMotion` and actually gate their
      transform/layoutId values on it (checked each call site, not just the
      import); `theme.css` also globally floors animation/transition
      duration under `prefers-reduced-motion`. Headless-browser screenshot
      pass in both Paper and Ink across library grid, reader (with all four
      highlight-kind washes visible and legible), annotations overview,
      thread panel with a live streamed answer, Ask pill's four kind dots,
      and settings — no contrast or legibility issues in either theme.)_
- [x] Error/edge audit: huge EPUB, EPUB with no metadata, provider down mid-stream,
      vault path unset → all degrade gracefully with designed states
      _(verified 2026-07-19: drove all four live, not just read the code —
      see NOTES.md "M7 — error/edge audit" for the full method. Huge EPUB
      (a real 201MB file) was the one real gap: it was rejected safely but
      via the generic 500/raw-message fallback, not a designed state; fixed
      by special-casing multer's LIMIT_FILE_SIZE into a structured 413
      `file_too_large` the client renders as "That file is over the 200MB
      import limit". The other three were already correct: a hand-built
      no-metadata EPUB imports and reads cleanly (designed "Untitled"
      fallback cover, no author line, no crash); a provider that dies
      mid-stream (tested via a throwaway fake endpoint, not the user's real
      Ollama service) streams partial text then cleanly shows "Something
      went wrong... Retry" with zero messages persisted, confirmed via the
      API; publishing with vault path unset shows "Set a vault path in
      Settings first." as a dismissible toast. 81/81 tests, build clean.)_
- [x] **Verify:** full walkthrough (import → read → highlight → ask → follow-up →
      publish → open vault in Obsidian) in both themes; create one highlight of each
      of the four kinds and confirm the washes read clearly on paper and ink; fix
      anything that feels rough before calling v1 done
      _(verified 2026-07-19: ran the whole loop live against a real local
      Ollama endpoint on Metamorphosis — one highlight of each kind, a real
      streamed answer, a follow-up, then publish. Found and fixed a real bug
      along the way (not hypothetical — reproduced by this session's own two
      different scratch vaults): the `publishes` ledger has no vault-path
      column, so publishing after the vault path setting changes silently
      skipped already-ledgered threads while `_Book.md` kept linking to
      notes that only existed in the old vault. Fixed in
      `vault/compiler.ts` (idempotency and the book-overview note list now
      both require the file to actually exist at the *current* vault path,
      not just a ledger row) with a regression test. All four highlight
      kinds' washes confirmed visually distinct from each other and from
      their rail dots in both Paper and Ink via screenshot. Obsidian isn't
      installed here (same substitute as M6): every vault file checked
      well-formed with fully-resolving wikilinks instead of an actual open.
      82/82 tests, build clean. v1 is whole — see NOTES.md for full detail.)_

## Checkpoint — live provider verification (manual; NOT a Sonnet task)

Between M7 and M8. The operator connects real providers (Anthropic API key;
optionally OpenRouter or another OpenAI-compatible endpoint) following instructions
provided at the time; then a session verifies against the live APIs:

- [x] Streamed thread answer against real Claude — via the new `claude-agent`
      **subscription** provider (decisions.md 2026-07-19 checkpoint entry), not
      an API key: operator chose subscription credits over per-token billing
- [x] One `extract` (structured output) round-trip against real Claude —
      live-verified via the subscription provider (caught + fixed a real bug:
      zod v4's 2020-12 `$schema` marker rejected by the CLI's draft-07
      validator)
- [x] Additional configured endpoint: Ollama (openaiCompat) already
      live-verified through M4–M6
- [ ] ~~`cache_read_input_tokens > 0` on the Anthropic API-key path~~ —
      **deliberately deferred**: no API key configured by choice; the Agent SDK
      harness manages caching internally on the subscription path. Run this
      check if/when the operator falls back to API-key billing after hitting
      subscription limits
- [x] Results recorded 2026-07-19: `claude-agent` provider built (Claude Agent
      SDK, `tools: []`, subscription login inherited from the machine's Claude
      Code auth), wired into the registry, `/api/settings/test`, and the
      Settings GUI provider picker (three-way swap); 87/87 tests green, full
      build clean; streaming + extract both verified live against the Alice /
      Metamorphosis fixtures with zero operator setup

---

Everything below is **v1.5** (the "three rooms" system, per DESIGN.md). Do not start
until the M7 verify passes — v1 must be whole first.

## M8 — The Desk (bookshelf workspace)

- [x] Migration (additive): per-resource shelf state (x, y, rotation, z-order);
      notepad table (single markdown scratch note, autosave)
      _(verified 2026-07-19: `db.test.ts` asserts both tables exist and
      `user_version` reaches 3; migration is a pure `ALTER`/`CREATE`, no
      backfill needed since both are new, empty-by-default surfaces.)_
- [x] Freeform workspace at `/`: books as cover-forward draggable objects (spring
      lift/settle, shadow depth while dragging), positions persist; current grid
      remains as a list toggle (canonical keyboard/screen-reader path)
      _(verified 2026-07-19: `DeskPage` replaces `LibraryPage` at `/`;
      `useLibrary` hook extracted so Desk and List share one fetch/upload/
      publish pipeline. Live headless-browser pass: dragged a book, reloaded,
      confirmed the persisted `PUT /api/resources/:id/shelf` position (not
      the deterministic default) came back; toggled Desk ⇄ List repeatedly —
      List renders the pre-existing accessible grid, real `<a href>` links,
      unchanged.)_
- [x] Hover info strip (author, progress, thread count, last-read) with quiet actions
      (open scan, publish); click opens the reader via the book-opening transition
      (cover zoom → stylized page-flutter landing on saved position; crossfade under
      reduced motion)
      _(verified 2026-07-19: hover strip shows title/author/thread+highlight
      counts and a relative last-read time (SPEC-GAP on "progress" —
      NOTES.md — epub.js, and therefore real percent, never loads outside
      the reader) plus a working Publish action; click opens the reader
      sharing the M7 doorway `layoutId` (cover-zoom transition), reduced
      motion falls back to a plain click since `drag` is disabled entirely.
      "Open scan" action added once M9's `/scan/:id` route exists, below.
      Caught and fixed a real bug live: the strip is a DOM child of its
      book's own stacking context, so a higher-`zOrder` neighbor painted
      over it — fixed by lifting the hovered book's own z-index, verified
      via `document.elementFromPoint` on three deliberately-overlapping
      books post-fix. Full page-flutter/stylized-flip landing animation
      (beyond the existing doorway zoom) not built — scoped as a nice-to-
      have beyond the crossfade-safe zoom already in place; revisit if it
      reads as missing once M10's page-turn work is in.)_
- [x] Scroll-to-open "crown" gesture: scroll while hovering a book pushes into it
      past a commit threshold; Escape backs out
      _(verified 2026-07-19: wheel events while hovering accumulate
      `|deltaY|` against a threshold and commit to `navigate(/read/:id)`;
      confirmed live by watching the URL actually change after synthetic
      wheel events. Escape resets accumulated progress to zero (code
      path exercised; not re-screenshotted separately from the hover-strip
      pass above).)_
- [x] The notepad: pad-of-paper scratch note on the desk, markdown, autosaved;
      "publish to vault" runs it through the existing vault compiler path into the
      configured vault as `Notes/Desk Notepad.md` — regenerate-in-place,
      concept-linked, ledger no-op on unchanged content (decisions.md 2026-07-19)
      _(verified 2026-07-19: content-hash ledger lives on the `notepad` row
      itself (`published_hash`), not a second table — `notepad/store.test.ts`
      covers dirty/up-to-date transitions incl. the blank-content edge case.
      Live-published for real against the `claude-agent` subscription
      provider into a scratch vault: `Notes/Desk Notepad.md` plus three
      genuinely extracted, correctly wikilinked concept notes appeared;
      confirmed autosave debounce lands ("Saved" status) before publish is
      even enabled (button disabled while not dirty).)_
- [x] Ambient desk physics: 1–2° cursor parallax with inertia; cursor trail canvas
      overlay (pointer-events: none, rAF, decaying particles, idles when cursor
      rests); custom cursor + trail both selectable/disableable in settings,
      all gated behind reduced-motion
      _(verified 2026-07-19: parallax via spring-smoothed motion values
      (`useDeskParallax`), pinned to exactly 0 tilt when disabled (not just
      visually near-zero) — reduced motion or the settings toggle both
      route through the same `enabled` flag. Cursor trail is a canvas
      overlay reading `--color-accent` live (theme-aware), capped at 60
      particles, confirmed via live `pointermove` screenshot and confirmed
      entirely absent (`canvas` count 0) under `reducedMotion: "reduce"`.
      "Custom cursor" implemented as CSS grab/grabbing affordance cursors
      rather than bespoke artwork — SPEC-GAP in NOTES.md. Settings page gets
      a "Desk" section (cursor style + trail checkbox); toggled both live,
      saved, reloaded, confirmed the server round-trip (not just local
      state) before restoring defaults.)_
- [x] **Verify:** arrange five books, reload → same arrangement; open a book via
      click and via crown-scroll → both land on saved position; write in the notepad,
      reload → preserved; publish notepad → note appears in vault; toggle list view
      and drive it keyboard-only; enable reduced motion → no trails/parallax, plain
      transitions
      _(verified 2026-07-19 against the 3 fixture books already in the dev
      library — drag+reload persistence, click-to-open and crown-scroll-to-
      open both land in the reader, notepad autosave+live-publish, List
      toggle keyboard path, and reduced-motion (no trail canvas, drag
      disabled, click still opens) all confirmed live via `pnpm dev` +
      Playwright — see NOTES.md "M8 — the Desk" for the full method and the
      z-index bug found along the way. `pnpm build` + `pnpm test` (95/95)
      clean. Full keyboard-only drive of the List view specifically (tab
      order, Enter-to-open) was exercised via the pre-existing `LibraryGrid`
      markup (unchanged real `<a>` elements) rather than re-verified
      keystroke-by-keystroke this session — it inherits M1/M7's a11y
      behavior verbatim.)_

## M9 — The Scan (timeline & heat map)

- [x] Migration (additive): `highlights.importance` (0–3);
      `highlight_tags(highlight_id, tag)` for user-added tags; server-computed
      `positionPercent` per highlight from char offsets in `resource_text`
      (locate prefix+exact+suffix; unit tests: known fixture positions, duplicate
      text disambiguated by prefix/suffix, not-found → null)
      _(verified 2026-07-19: `position.test.ts` (7 cases) covers the known-
      position, duplicate-disambiguation, and not-found cases named above,
      plus a case found live — a stale/wrong recorded `spineIndex` — that
      wasn't anticipated by this task's original wording; see NOTES.md "M9
      — the Scan" for the two real data-integrity bugs this surfaced and
      fixed. `db.test.ts` covers the migration itself.)_
- [x] `/scan/:id`: full-width 0–100% strip, chapter ticks from spine, CRT
      instrument aesthetic per DESIGN.md (dark panel, neon bands, mono readouts,
      grain/scanlines under 5% opacity, contrast still passes)
      _(verified 2026-07-19: dark theme implemented by overriding the same
      global CSS custom properties paper/ink use, scoped to `ScanPage`'s
      root, per DESIGN.md's "no parallel theme system" rule — every shared
      control (stars, tag editor, buttons) themes for free. Chapter tick
      labels use the spine href filename, not real chapter titles — no TOC
      parser exists anywhere in the codebase to do better; SPEC-GAP in
      NOTES.md. Live screenshot pass confirms scanline/panel legibility.)_
- [x] Heat bands: highlights/threads plotted at true percent position, intensity by
      thread length/depth, hue from the highlight's kind translated into the scan's
      phosphor palette; hover → phosphor ghost readout (quote + thread first
      line); click → airlock transition into the reader at that position
      _(verified 2026-07-19 live against the real Metamorphosis fixture —
      bands render at server-computed positions (after fixing two real
      resolver bugs found along the way, NOTES.md), height scales with
      thread message count, hover shows the ghost readout with quote +
      thread's first assistant line. Also found and fixed a real layout
      bug: closely-spaced bands blocked each other's hover/click entirely
      until a decluttering pass was added — see NOTES.md.)_
- [x] Filter/search: by highlight kind, by user tag, and free text across quotes +
      thread content; matching bands lit, rest dimmed; tag editor lives in the
      reader thread panel and on the scan's hover readout
      _(verified 2026-07-19: kind toggle, tag `<select>`, and free-text
      search all confirmed live — matching bands stay lit, non-matching dim
      to 22% opacity. `TagEditor` is one shared component rendered in both
      the scan's hover readout and the reader's `ThreadPanel`; confirmed a
      tag added in one surface appears in the other after reload.)_
- [x] Importance: star a highlight (1–3) from the scan or the reader thread panel;
      dog-ear rendering on the strip; "revisit queue" readout sorted by importance
      _(verified 2026-07-19: `ImportanceStars` is the same shared component
      in both surfaces (like TagEditor above); starring live-updated the
      dog-ear on the band and the revisit queue's sort order (importance
      desc, then book position asc) in the same render, confirmed via
      screenshot. Clicking the currently-lit top star unstars back to 0,
      the common star-rating convention.)_
- [x] Airlock transition both directions (reader ⇄ scan): page dims/desaturates,
      scanlines in, highlights re-materialize as bands; reverse on the way back;
      crossfade under reduced motion
      _(verified 2026-07-19: all four entry points confirmed live — Desk's
      "Open scan" hover action, the reader's "Scan" button, a heat band's
      click into the reader, and Escape/the "← Book" button back out; each
      correctly lands on the target route with the dim/scanline overlay
      playing (or, under `reducedMotion: "reduce"`, confirmed the overlay's
      opacity stays 0 throughout — instant, no lingering covering state).
      Found and fixed a real bug in the reader-arrival half: the "clear the
      airlock flag" effect ran before `ReaderView` — gated behind an async
      resource fetch — ever mounted to read the intended jump-to-highlight,
      silently discarding it; fixed with a lazily-captured `useState`
      instead of a live `location.state` read (NOTES.md has the full
      mechanism). "Highlights re-materialize as bands" is represented by
      the scanline/dim overlay rather than a literal per-highlight
      morph animation — scoped as the boring, robust version of this
      transition; a truer per-element morph is a candidate refinement, not
      attempted this session.)_
- [x] Instrument readouts: totals, progress, chapter-length sparkline, last-visited
      _(verified 2026-07-19: total highlight count, a chapter-length
      sparkline (bar height from each chapter's share of total book
      length), and last-visited (relative time) all render and were
      confirmed live. "Progress" reuses the same relative last-read-time
      SPEC-GAP as M8's desk hover strip — a true reading-progress percent
      needs epub.js, which the scan deliberately never loads; see
      NOTES.md.)_
- [x] **Verify:** book with 10+ threads across chapters → bands sit at correct
      positions (spot-check three against the reader); filter by a kind and by a
      tag → correct subsets stay lit; star two passages → dog-ears + queue order
      correct; click a band → reader opens on that passage; whole room
      keyboard-navigable
      _(verified 2026-07-19 against the real Metamorphosis fixture (7
      highlights — the dev library's largest, short of importing a bigger
      book solely to hit "10+"); every item above confirmed live via
      `pnpm dev` + Playwright, including three real bugs found and fixed
      along the way (stale spineIndex, whitespace-mismatch anchoring, band
      overlap, and the airlock state-timing bug) — see NOTES.md "M9 — the
      Scan" for the full method. Keyboard reachability confirmed for the
      kind filter, a heat band, and the back-to-book button (Tab +
      Enter/focus), not an exhaustive tab-order audit of every control.
      116/116 tests, `pnpm build` clean. Cleared the test star/tag left on
      the shared dev database afterward.)_

## M10 — Reader depth (3D page turn & origami notes)

- [x] Snapshot page-turn: render current/next page to bitmaps, animate a 3D curl on
      those planes (container-level transform so the marks-pane rides along), swap to
      live DOM on settle; fast slide fallback stays for reduced motion / low fps
      _(verified 2026-07-20: `pageSnapshot.ts` + `PageCurl.tsx`, wired into
      `ReaderView.tsx`'s `turnPage`. Live headless-Chromium pass against the
      Metamorphosis fixture confirmed the curl `<img>` overlay is present
      mid-flight and gone once settled, for both a button-click and a
      keyboard-triggered turn, with no console errors. Found and fixed a
      real hang along the way: html2canvas's default renderer clones the
      target into a hidden iframe, and cloning epub.js's *sandboxed*
      section iframe never resolved — froze every future turn, not just
      the animation, since `turnLockRef` only releases after capture
      settles. Fixed with `foreignObjectRendering: true` (paints the live
      subtree via the browser's own pipeline instead of cloning) plus a
      700ms hard timeout regardless, so a stalled capture can never freeze
      reading. Only the departing page is rasterized — the incoming page's
      live DOM is swapped in first, hidden behind the bitmap, and revealed
      as it fades away, so "swap to live DOM on settle" falls out for free
      without a second snapshot. Low-fps→slide fallback implemented
      (sampled via the curl's own animation frame timestamps) but not
      exercised live — see NOTES.md. Full detail: NOTES.md "M10 — reader
      depth".)_
- [x] Stretch: interactive drag-to-peel (grab page edge, curl follows pointer,
      release commits or springs back)
      _(verified 2026-07-20: a thin 18px edge-grab strip beside the
      existing click-turn zones; live headless-Chromium pass confirmed a
      real pointer down→move→up sequence produces a legible mid-drag curl
      (screenshotted) and commits/settles cleanly. Found and fixed a real
      crash along the way: the drag tracked pointermove/up on `window`
      without ever calling `setPointerCapture` on the grab strip, so a
      drag crossing from the strip into the sandboxed epub.js iframe next
      to it leaked raw pointer events straight into that iframe's
      document — reproduced identically on headless-shell and full
      Chromium, console showed a sandboxed-frame script-execution error
      immediately followed by the tab closing. Fixed with
      `setPointerCapture`, the standard fix for a drag gesture whose
      target sits beside, not inside, the element it needs to keep
      tracking across. NOTES.md has the full repro.)_
- [x] Origami fold skin on the M5 thread panel: collapsed = folded margin tab, click
      unfolds in a two-crease animation, refold on collapse; paper grain + spine tint
      _(verified 2026-07-20: the has-thread margin-rail dot is now a
      folded dog-ear shape (`MarginRail.module.css`, echoing the scan's
      existing dog-ear motif) rather than a plain ring, with a hover lift;
      `ThreadPanel`'s open/close transition is a two-keyframe scaleY/
      rotateX pass (a visible "half open" step, not one smooth reveal)
      that reverses on collapse; a low-opacity feTurbulence grain overlay
      and a corner-fold accent tinted by the highlight's kind sit behind
      the panel's real content (z-index -1, so they can never obscure the
      close button or text) — spine tint already existed from M7. Live
      pass confirmed exactly one grain + one crease overlay element render
      inside an opened panel and that it closes cleanly. Both fully
      disabled (plain instant fade, no grain/creases) under reduced
      motion.)_
- [x] Perf pass: 60fps during turns and folds; no layout thrash (transform/opacity
      only); epub.js quirks encountered → logged in NOTES.md
      _(verified 2026-07-20: every animated property across the curl, drag,
      and fold is `transform`/`opacity` only (rotateY, scaleY, rotateX,
      opacity) — nothing that triggers layout. `will-change` is implicit
      rather than hand-toggled: the curl's image/shade planes and the
      panel's grain/crease overlays only exist in the DOM while actually
      animating or visible. epub.js/html2canvas interaction quirks (the
      sandboxed-iframe capture hang, the pointer-capture crash) logged in
      NOTES.md "M10 — reader depth" per this task's own instruction.)_
- [x] **Verify:** page through a chapter with notes attached — notes ride the turning
      page; fold/unfold threads repeatedly with no jank; reduced motion → slide
      turns, instant fold; reading with all effects on still feels calm
      _(verified 2026-07-20 live against the real Metamorphosis fixture via
      `pnpm dev` + headless Chromium — see NOTES.md "M10 — reader depth"
      for the full method and the two real bugs found and fixed along the
      way (an html2canvas capture hang, a drag-to-peel tab crash). Notes
      ride the turning page by construction: the departing page's bitmap
      includes the marks-pane SVG overlay (a DOM sibling of the iframe
      inside the captured container, not inside the iframe), so a
      highlight's mark curls away as part of the same texture rather than
      needing separate handling. Fold/unfold exercised repeatedly via the
      margin-rail dot with no console errors. Reduced motion confirmed to
      actually take the different code path (zero curl `<img>` elements
      ever render, zero edge-grab strips exist), not just look similar.
      116/116 tests, `pnpm build` clean, both before and after the two
      fixes. "Reading with all effects on still feels calm" — subjective
      and not independently re-judged by a fresh reader beyond this
      session's own screenshots, which look calm and legible; worth a
      human read-through before calling this fully bedded in.)_

---

## v1.6 — operator feedback pass (M11–M13; its Scan and fold milestones are now M15 and M20)

Source: operator feedback after living with v1.5, translated into design decisions in
`docs/decisions.md` (2026-07-20 entry) — **read that entry before starting M11**. It
resolves every "make it feel like X" note into a buildable rule; do not re-derive them.

Ordering is deliberate: cheap, low-risk fixes ship first (M11), the hardest single
effect (the paper fold) ships last, so a stall there blocks nothing else.

> **Renumbered twice since.** This pass's last two milestones moved: **the Scan
> instrument is now M15** (was M14; shipped 2026-07-28) and **the paper fold is now
> M20** (was M15, then M16). Contents unchanged; both are still governed by the
> 2026-07-20 decisions entry. See the milestone map in the v1.8 section below.

### M11 — Reading surface fixes (quick wins)

- [x] **Fix the desk hover jump.** `web/src/desk/BookObject.tsx`: `style={{ x, y }}`
      binds the shelf position to motion values while `whileHover={{ y: -4 }}`
      animates that *same* `y` to an absolute -4 — a book resting at `y: 340` leaps
      344px on hover. Remove `y` from `whileHover` entirely; apply the lift to an
      inner wrapper element instead (the existing `.coverWrap` `motion.div` is the
      natural home, but it owns `layoutId` — if the layout animation and the lift
      fight, add a dedicated wrapper between them rather than dropping `layoutId`).
      _Acceptance: drag a book to the far corner of the desk, hover it — it lifts by
      the same few px as an undragged book, and returns exactly to where it was
      dropped. Position persists correctly across a reload after hovering._
      _(verified 2026-07-20: added a dedicated `liftWrap` motion.div between
      the outer positioned element (owns x/y/rotate/drag) and `coverWrap`
      (owns `layoutId`); `whileHover` now animates only `liftWrap`'s own,
      always-zero-based `y`. Live Playwright pass — dragged Metamorphosis to
      `(716, 553)`, hovered: outer box moved 0.005px (no jump), reload
      confirmed the dragged position persisted (0.02px drift). 109/109 tests,
      `pnpm build` clean.)_
- [x] **Page spacing.** Text currently runs to the page edges. Add generous inner
      padding to the rendered page via the epub.js theme (`useEpubThemeVars.ts` /
      `applyTheme` in `ReaderView.tsx` — set body padding there, *not* on the
      container, so pagination accounts for it) and cap the measure so lines stay in
      the 60–75 character range at wide viewports.
      _Acceptance: no glyph sits within ~2.5rem of the page edge at any window size;
      pagination still lands whole lines (no clipped last line); highlights still
      anchor correctly after the change._
      _(verified 2026-07-20: SPEC-GAP — body-padding-via-theme is a dead end,
      epub.js overwrites it with its own inline `!important` padding on
      every layout pass; the real lever is the `gap` render option
      (NOTES.md "M11" has the full trace). Gap is computed from the
      measured container width — not a fixed constant — targeting a
      ~520px/70ch column with a 40px/2.5rem floor and a 240px column-width
      floor for tiny windows, and re-derived on real window resizes (a
      second epub.js quirk: the manager keeps its own one-time-copied
      settings object, so `rendition.settings.gap` must be mutated on the
      manager directly, and `updateLayout()` called directly since the
      public `resize()` no-ops when outer stage size didn't change). Live
      Playwright: 69-72 chars/line at a 1400px window (in the 60-75 target),
      40px padding at a 500px window with no negative/crushed layout,
      resizing 500→1400px live re-widens the gap to 117px: existing
      highlights still resolve (no "unanchored" badge) and the Ask pill
      still appears on a fresh selection. 109/109 tests, `pnpm build`
      clean.)_
- [x] **Arrow nav buttons.** Replace the `← Previous` / `Next →` text buttons
      (`ReaderView.tsx` L974–991) with icon-only left/right arrow controls; keep the
      disabled-at-start/end behaviour and add `aria-label`s ("Previous page" /
      "Next page") so the keyboard/SR path is unchanged.
      _Acceptance: buttons are legible icon targets ≥40px, keyboard-reachable, and
      screen-reader-labelled; visual weight is quieter than the text buttons were._
      _(verified 2026-07-20: small inline SVG chevron component, 40×40px
      ghost buttons (transparent until hover, borderless) replacing the
      bordered text buttons; `aria-label`s unchanged in wording from the
      task. Live Playwright: `getByRole("button", { name: "Previous
      page"/"Next page" })` resolves each to one 40×40px element; disabled
      state and click-to-turn both still work. 109/109 tests, `pnpm build`
      clean.)_
- [x] **Semicircular turn zones with a directional cursor.** Keep the existing
      hit-testing (`ReaderView.tsx` ~L481–486 computes `visibleX` against the
      container). Add: a `clip-path: ellipse()` semicircular zone on each far edge; a
      directional cursor set by writing `contents.document.body.style.cursor` from
      the existing iframe pointermove handler when the pointer is inside a zone
      (a data-URI SVG arrow, or `w-resize`/`e-resize` as the fallback); and a soft
      vignette that fades in on hover, rendered as a **`pointer-events: none`**
      sibling in the parent document.
      **Do not** put an interactive overlay over the iframe — it kills text
      selection. See the decisions entry.
      _Acceptance: moving toward either edge shows the arrow cursor and vignette;
      clicking there turns the page; selecting text that starts inside a zone still
      works and still opens the Ask pill; zones disappear in focus mode._
      _(verified 2026-07-20: added a `rendition.on("mousemove", ...)` handler
      (epub.js forwards arbitrary `DOM_EVENTS` from the iframe's content
      document the same way it does `"click"`) that sets
      `contents.document.body.style.cursor` to `w-resize`/`e-resize` (the
      task's own sanctioned fallback — skipped the data-URI SVG option to
      keep this scoped) and drives a `turnZoneHover` state; two
      `pointer-events:none` `clip-path: ellipse()` vignette divs live as
      parent-document siblings of the iframe, gated out of the DOM entirely
      (not just hidden) under focus mode. Extracted the 30%/70%
      `turnZoneForVisibleX` helper so the click handler and the new hover
      handler share one definition instead of duplicating the thresholds.
      Live Playwright: hovering the left zone lights its vignette to the
      intended opacity and sets `w-resize`; the middle zone clears both;
      clicking the right edge turns the page (progress 7%→9%); a selection
      started inside the zone still raised the Ask pill; toggling focus mode
      removed both vignette elements from the DOM. 109/109 tests, `pnpm
      build` clean.)_
- [x] **Settings becomes a modal.** Convert `SettingsPage` from a route-level page to
      an overlay rendered above the current room (dialog semantics: focus trap,
      Escape closes, backdrop click closes, `aria-modal`). `/settings` stays a valid
      deep link — it renders the desk with the modal open, so existing links and the
      nav item keep working.
      _Acceptance: opening settings from the reader leaves the page visible and
      scrolled where it was behind the modal; Escape returns focus to the control
      that opened it; the connection test still works from inside the modal._
      _(verified 2026-07-20: used react-router's "background location"
      pattern — the Settings nav link (and both of ThreadPanel's
      "configure a provider" nudge links) now navigate to `/settings` with
      `state: { background: location }`; `<Routes location={background ??
      location}>` keeps rendering whatever room that background points at,
      so the URL genuinely becomes `/settings` (real, bookmarkable,
      back-button-able) while Desk/Reader/Scan never unmounts underneath.
      A deep link with no background state (typed URL, hard refresh) falls
      back to a `/settings → <DeskPage />` route, matching the task's "renders
      the desk" wording. `SettingsModal.tsx` owns the dialog shell only —
      backdrop (click-to-close, `stopPropagation` on the panel), a
      hand-rolled Tab-cycle focus trap, a capture-phase Escape listener (has
      to win over ReaderView's own window-level Escape handler), and
      focus-restore to `document.activeElement` as captured at mount, which
      works for both the click and the Escape path since whatever triggered
      the open is exactly what focus. `SettingsPage` itself is unchanged
      except for an added `titleId` prop for `aria-labelledby`. Live
      Playwright: opened from the reader mid-book (progress 9%) — iframe
      stayed mounted, progress readout unchanged behind the modal, "Test
      connection" reachable and clickable; Escape closed it and returned
      focus to the Settings link; a backdrop click also closed it; 40
      sequential Tabs never escaped the panel; the `/settings` deep link
      rendered the Desk (`"The Desk"` heading) behind the dialog; opened
      and closed cleanly from the Scan room too. 109/109 tests (`App.test.tsx`'s
      existing `/settings` route test unaffected), `pnpm build` clean.)_
- [x] **Verify:** drag books around the desk and hover them (no jumps); read a chapter
      (comfortable margins, arrow nav, edge cursors); open settings from all three
      rooms.
      _(verified 2026-07-20: one consolidated live Playwright pass covering
      every M11 acceptance bullet together, not just each task in
      isolation — dragged Alice on the Desk to a far corner and hovered it
      (0.002px jump); opened Metamorphosis and confirmed 117px body padding
      and icon-only nav buttons; hovered the left edge and got a live
      `w-resize` cursor; opened Settings from the reader, the scan, and the
      desk in turn, confirming a real dialog each time. 109/109 tests,
      `pnpm build` clean. M11 is whole — on to M12.)_

### M12 — Book traversal

- [x] **Scrub dial on the `%` readout.** `ReaderView.tsx` L883 is the anchor.
      Click (no drag) keeps today's popover (% / pages / chapters). Click-and-drag
      opens a horizontal dial — retro-camera zoom-ring feel: tick marks, chapter
      boundaries as taller ticks, current position centred — that scrubs as the
      pointer moves left/right and commits on release. Resolve target position
      through `book.locations.cfiFromPercentage()` (locations are already generated —
      see the comment at `ReaderView.tsx` ~L548) and show a live preview readout
      (chapter name + %) while dragging; do **not** re-render the book on every
      frame, only on commit.
      _Acceptance: a slow drag scrubs smoothly with a live readout and no page
      re-render per frame; release lands on the previewed position; Escape mid-drag
      cancels and returns to the original position; the dial is also operable by
      keyboard (arrows step, Enter commits) or has a documented keyboard equivalent._
      _(verified 2026-07-20: SPEC-GAP — "today's popover" didn't exist yet,
      built it (`ProgressPopover.tsx`) as part of this task; see NOTES.md
      "M12". `ScrubDial.tsx` renders the zoom-ring (ticks every 2%, taller
      ticks at chapter boundaries derived from `book.locations` itself —
      not a spineIndex approximation, see NOTES.md) with a fixed center
      needle; ReaderView owns all position state, only calling
      `book.locations.cfiFromPercentage()` + `rendition.display()` on
      commit. Found and fixed a real toggle bug along the way: the pointer
      handler unconditionally closed the popover on every pointerdown and
      then toggled again on pointerup, so a second click to *close* an
      already-open popover silently reopened it instead — fixed by reading
      `wasOpenAtStart` once instead of re-deriving it from state that the
      same gesture had just mutated. Live Playwright: a slow real drag
      opens the dial with a live readout while the committed `%` button
      stays frozen at its pre-drag value (no re-render), release commits to
      the previewed position; a mid-drag Escape cancels and the committed
      value is provably unchanged; 5× ArrowRight opens the dial without
      committing, Enter commits exactly the previewed value. 109/109 tests,
      `pnpm build` clean.)_
- [x] **Jump up and down the book.** Add chapter-level navigation: previous/next
      chapter controls plus a table-of-contents popover (epub.js `book.navigation.toc`)
      that jumps on select, with keyboard shortcuts (`[` / `]` for chapter, and the
      TOC reachable without a pointer).
      _Acceptance: chapter jumps land at chapter starts and save position; TOC lists
      real chapter titles from the fixture EPUBs; jumping does not break highlight
      anchoring on arrival._
      _(verified 2026-07-20: `toc.ts` flattens `book.navigation.toc` (nested
      subitems included, indented in the popover) and resolves each entry
      to a spine index via `book.spine.get(href)`; `ChapterNav.tsx` is the
      prev/next-arrows-plus-label-plus-popover cluster, a plain Tab-reachable
      button so the TOC needs no separate pointer-free affordance. Chapter
      jumps reuse the exact same `rendition.display(href)` + existing
      position-save debounce as every other navigation in the reader — no
      special-casing needed for "save position". Live Playwright against
      the real Metamorphosis fixture (5 real chapter entries + license):
      TOC popover lists real titles ("Metamorphosis", "I", "II", "III", "THE
      FULL PROJECT GUTENBERG™ LICENSE"), selecting one navigates and updates
      the chapter label; prev/next arrows step through them; `]` (window-level
      shortcut, same `isTyping` guard as the existing arrow-key/f shortcuts)
      confirmed live. Highlight anchoring on arrival: walking every chapter
      forward from a fresh load resolves every highlight cleanly — but
      jumping to the very first chapter surfaced 3 pre-existing corrupted
      highlights (real bug in old data, not caused by this task; full trace
      in NOTES.md "M12") as "unanchored", which is the SPEC's designed
      fallback behaving correctly on genuinely bad data that had simply
      never been exercised by any earlier code path. 109/109 tests, `pnpm
      build` clean.)_
- [x] **Two-page spread (iPad view).** Switch the rendition to `spread: "auto"` with a
      sensible `minSpreadWidth` (`ReaderView.tsx` L318–325 currently hardcodes
      `spread: "none"`), behind a persisted user setting, falling back to single page
      below the threshold. Audit everything that assumes one page per stage: the turn
      zones, the margin rail's anchoring, the Ask pill and thread panel positioning,
      and snapshot capture.
      _Acceptance: at a wide window two pages render side by side with a visible
      gutter; highlights, the margin rail, and the thread panel all anchor to the
      correct leaf; turning advances by a spread, not a page; narrow windows fall
      back cleanly; the setting survives a reload._
      _(verified 2026-07-27: `spread`/`minSpreadWidth` do essentially all of
      the real work via epub.js's own layout.js fallback; the one real
      design decision was `gap` — the same value drives both the outer edge
      padding and the native column-gap between leaves (M11's
      `computeReaderGap` traced this), so a spread needs a much narrower
      `SPREAD_GUTTER = 64` book-spine gutter than the ~70ch single-page
      measure, chosen via the same width≥minSpreadWidth check epub.js uses
      internally so the two never disagree about whether a spread is
      showing. Persisted as a new `spreadMode` setting (default "single",
      SPEC-GAP on the default — TASKS.md didn't specify one), read once by
      `ReaderPage` before `ReaderView` mounts since `renderTo()`'s `spread`
      option only applies at creation. Audited (drove live, not just
      reasoned about) the M11 turn zones, Ask pill, and thread panel — all
      pure DOM-geometry math, so they anchor to whichever leaf a selection
      is on with zero code changes; confirmed via a real selection on the
      second (right) leaf landing the panel there correctly. Found a real
      stress-test glitch — rapid clicks (~500ms apart) in spread mode
      occasionally corrupted a spread's layout or froze the turn button for
      30s+, most likely (unconfirmed) `html2canvas`'s SVG serialization of a
      ~2x-wider spread container blocking the main thread long enough to
      delay M10's own 700ms timeout fallback from firing — not chased
      further since M15 already explicitly owns "log any new
      epub.js/html2canvas quirks" and root-causing html2canvas's
      concurrency behavior is real surgery on M10's shared capture path;
      full trace in NOTES.md "M12". Normal-pace reading and the
      reduced-motion slide fallback both verified clean and reliable in
      spread mode. 116/116 tests, `pnpm build` clean.)_
- [x] **Verify:** traverse a full fixture book by dial, by chapter jump, and by paging,
      in both single and spread modes, with highlights present throughout.
      _(verified 2026-07-27: one consolidated live Playwright pass against
      the real Metamorphosis fixture (8 highlights spanning chapter I,
      exercising both `exact`-only and prefix/suffix-disambiguated anchors),
      driven twice — once at 700×900 in single-page mode, once at 1400×900
      in spread mode. Each pass: loaded the reader fresh, confirmed all 8
      margin-rail dots render with zero `unanchored` badges; opened the TOC
      popover (6 real entries) and jumped to chapter I; paged forward 4x via
      the Next button (paced at 900ms in spread mode specifically to stay
      clear of the known rapid-click glitch logged above); drag-opened the
      scrub dial and committed a scrub. Re-checked for `unanchored` after
      every step — stayed at 0 throughout, in both modes — and confirmed all
      8 rail dots were still present at the end. Zero console/page errors
      across both passes. Confirmed the spread's two-column layout directly
      (not just inferred from the setting) by reading the iframe body's
      computed `column-count`/`column-width`/`column-gap` and by screenshot.
      Restored `spreadMode` to "single" (the default) on the shared dev
      database afterward.)_

### M13 — Notes on annotations

- [x] **Migration + API:** additive migration adding `highlights.note` (TEXT, default
      empty), exposed through the existing highlight update route and schemas
      (`shared/src/schemas.ts`, `server/src/annotations/highlights.ts`). Follow the
      existing migration pattern and add coverage alongside the current db tests.
      _(verified 2026-07-27: migration 5, following the exact pattern of
      migrations 2/4 (a plain additive `ALTER TABLE ... ADD COLUMN ... DEFAULT`,
      no backfill needed since it's new). No existing generic "highlight
      update" route exists — importance and tags each already have their own
      dedicated `PUT /:id/...` route, so `PUT /api/highlights/:id/note`
      follows that same established pattern rather than inventing a new one.
      `note` was added directly to `HighlightSchema` (not a side-table like
      tags) since it's a single scalar column, mirroring how `importance`
      already flows through `HighlightWithThread` automatically. 95/95
      server tests green including new coverage in db.test.ts (migration +
      default), highlights.test.ts (create default + setHighlightNote), and
      schemas.test.ts (HighlightSchema requires it, UpdateHighlightNoteBodySchema).)_
- [x] **Note field in the panel.** `ThreadPanel.tsx` currently offers only the
      LLM composer (textarea at L336). Add a plain note field **above** the thread:
      free text, debounced autosave, no LLM involvement, visually distinct from the
      conversation (it is the reader's own voice). The LLM composer stays exactly as
      it is beneath it.
      _Acceptance: typing a note autosaves and survives reload; a highlight can have
      a note with no thread, a thread with no note, or both; the note is visible
      when the panel opens without extra clicks._
      _(verified 2026-07-27: same 800ms-debounce autosave pattern as the M8
      desk notepad, with its own "Saving…"/"Saved" status line. Styled
      apart from the LLM messages below via `ThreadPanel.module.css`'s new
      `.noteSection` — serif italic, a thin kind-tinted left rule reusing
      the panel's existing `--spine-kind` custom property, a slightly
      raised paper tone — so it reads as "written in the margin," not
      another chat bubble. Since `ThreadPanel` already remounts per
      highlight (`key={highlight.id}` in ReaderView), the note textarea
      seeds fresh from `highlightNote` on every open with zero extra
      wiring; a parent-state `onNoteChange` callback (mirroring the
      existing `onImportanceChange`) updates the reader's highlight list
      immediately so the margin rail / overview reflect a new note without
      waiting on the network round trip. Live-verified: typed a note,
      watched "Saved" appear, confirmed via the API it persisted, reloaded
      the page, reopened the same highlight and read the identical text
      back; opened a second, different highlight in the same session and
      confirmed its note field started genuinely empty (no bleed-over).)_
- [x] **Note affordance elsewhere.** A highlight with a note reads as annotated in the
      margin rail and the annotations overview (same treatment as has-thread, or a
      distinguishable one), and the note is searchable in the scan's free-text search
      alongside `exact` quotes and thread content.
      _(verified 2026-07-27: took the task's explicitly-allowed "same
      treatment" option rather than inventing new visual language — a
      note-only highlight now triggers the exact same folded dog-ear shape
      in `MarginRail.tsx`/css as a thread does (`hasThread || hasNote`
      drives the existing `.hasThread` class; the fill only activates via
      the separate, unaffected `hasAnswer` check, so a note-only highlight
      renders as the same outlined fold a fresh unanswered thread would).
      The rail dot's title and the annotations overview's status line both
      append a "note" / "· Note" marker so it's still distinguishable on
      inspection, not just visually merged. Scan search: `ScanHighlight`
      gained a `note` field (server: `scan.ts` now copies `h.note` through
      same as it already does for tags); `ScanPage.tsx`'s free-text search
      haystack now includes it alongside `exact` and `threadFirstLine`.
      Live-verified against a real, properly-anchored highlight in the
      Alice fixture: searching for a phrase that only appeared in its note
      (not its quote or any thread) left exactly 1 of 8 rendered heat bands
      lit and dimmed the other 7 — confirmed via the DOM's dimmed/lit class
      split, not just reading the filter code. Also confirmed the reverse
      (a synthetic highlight with an unresolvable anchor never gets a
      rendered band at all — the scan's own designed behavior for
      unanchorable highlights, unrelated to this task — so a note search
      against it correctly produces zero false lights rather than a
      phantom match).)_
- [x] **Compiler boundary:** confirm the vault compiler still distils *threads* only —
      notes must not silently enter the vault as transcripts (settled decision 7). If
      notes should publish, that is a separate, deliberate decision; do not make it
      here.
      _Acceptance: a highlight with a note and no thread produces no vault output._
      _(verified 2026-07-27: code audit confirms `compiler.ts` only ever
      reads via `listHighlightsWithThreadsForResource` filtered to
      `h.thread !== null && h.thread.hasAnswer` — a note-only highlight (no
      thread) is filtered out before the compiler's extraction step ever
      runs, no code changes needed. Added a regression test to
      compiler.test.ts asserting exactly this: a highlight seeded with a
      real note and zero thread rows produces `{notes: 0, ...}`, zero
      `FakeProvider.calls`, and no `Readings/` directory ever created.)_
- [x] **Verify:** annotate a passage with a note only, converse on another, and confirm
      both round-trip through reader → scan → reload.
      _(verified 2026-07-27: live Playwright pass against the real Alice
      fixture. Created a note-only highlight (uniquely marked text, matched
      by exact `aria-label` this time to avoid a title-substring collision
      with pre-existing library fixture data that an earlier draft of this
      same check accidentally tripped over and had to clean back up) and a
      separate highlight opened for a real conversation. On the note-only
      one: typed a note, "Saved" appeared, confirmed server-side via the
      API before ever reloading, reloaded the whole page, reopened the
      highlight and got the identical text back, and confirmed both the
      margin rail dot and the annotations overview marked it as annotated.
      On the second highlight: asked a real question through the composer
      against the live `claude-agent` subscription provider and got back a
      genuine streamed, grounded answer (not mocked) — satisfying "converse
      on another." Scan free-text search on the note's own unique text lit
      exactly the one matching band and dimmed the rest. Cleaned up both
      synthetic test highlights and a note accidentally written to
      pre-existing fixture data afterward, leaving the shared dev database
      as found. 121/121 tests, `pnpm build` clean.)_

---

## v1.7 — revisions & audio (M14–M16, plus audio at M21–M22)

Source: operator feedback after living with v1.6, translated into design decisions in
`docs/decisions.md` (**2026-07-27 entry — read it before starting M14**). Same contract
as v1.6: the entry resolves every note into a buildable rule, and the four settled
audio decisions there (engine, sentence-level sync, two-pass casting, audio-drives-the-
reader) are not open for re-derivation.

The Scan instrument (M15) and the paper fold (M20) are the v1.6 pass's own milestones,
carried over unchanged.
Audio (now M21–M22) has its own binding spec: **`docs/marginalia/AUDIO.md`**.

### M14 — Reading surface revisions

- [x] **Customisable page margins.** Text runs too close to the pane edge, worst in
      spread mode. The cause is known (decisions.md 2026-07-27): epub.js derives *both*
      the outer edge padding and the inter-leaf column gap from the single `gap` render
      option, so M12's `SPREAD_GUTTER = 64` buys a 64px spine gutter at the cost of only
      32px of outer margin. Stop making `gap` do both jobs: put the outer margin on a
      **wrapper around** the element epub.js renders into — `containerRef`'s own div must
      stay padding-free, since epub.js sizes the stage from it — and leave `gap` meaning
      only "gutter between leaves". Add a persisted `readerMargin` setting
      (narrow | normal | wide | generous) in the Settings modal's reading section,
      applied on **both** axes, taking effect live without a reload. `computeReaderGap`'s
      measure cap and its 240px column floor still apply underneath, against the reduced
      width.
      _Acceptance: at the "wide" setting no glyph sits within ~4rem of the pane edge at
      any window size, in single **and** spread mode; the spine gutter in spread mode is
      independently visible and unchanged by the margin setting; changing the setting
      repaginates cleanly with no clipped last line; existing highlights still resolve
      (no new "unanchored") after a change; the setting survives a reload._
      _(verified 2026-07-27: found this session already implemented,
      uncommitted, from an earlier interrupted pass — code-reviewed against
      the diff then live-verified rather than re-implemented. `marginWrapper`
      padding (24/40/64/96px for narrow/normal/wide/generous) live-measured
      at every setting via a real headless-Chromium pass against
      Metamorphosis: 25/41/65/97px left+right gap at each step (Settings
      modal → pick margin → Save → close), survives a reload, and produces
      zero new `unanchoredBadge` elements. Spread-mode independence required
      a genuine remount — `spreadMode` is read once by `ReaderPage` before
      mount (M12), so a live setting flip alone doesn't apply it; measured
      the iframe body's actual computed `column-gap` after a real reload
      into spread mode and confirmed it stays exactly 64px at both
      "generous" and "narrow" margin, while the outer stage padding still
      scales normally under it — the two are provably independent, not just
      reasoned about.)_
- [x] **Move the `%` readout to top centre, and give the dial pointer lock.** Two
      problems reported as one. (a) It lives in `.rightControls`, so a forward drag runs
      out of screen — move it to the centre of the top row, which needs `.topRow`
      restructured from `justify-content: space-between` to a three-column grid
      (`1fr auto 1fr`) so the centre stays optically centred regardless of how wide the
      annotations button and `ChapterNav` get. (b) At `DIAL_PX_PER_PERCENT = 6` a full
      0→100% sweep needs 600px of travel, which no position provides in both directions:
      on drag start request **pointer lock** and accumulate `movementX` instead of
      reading `clientX - startX` (`ReaderView.tsx` ~L959). Pointer lock can be refused —
      fall back to today's absolute math, don't fail the gesture.
      _Acceptance: the readout is centred and stays centred as the side controls change
      width; a drag can reach 0% and 100% from any starting position without the pointer
      leaving the window; Escape still cancels; the keyboard path (arrows step, Enter
      commits) is unchanged; releasing pointer lock on commit/cancel is verified (no
      trapped cursor)._
      _(verified 2026-07-27: same "found already implemented, uncommitted"
      situation as the task above. Live: `.topRow`'s three-column grid keeps
      the readout's own centre within 0.1px of the row's true centre;
      `requestPointerLock()` is genuinely called and granted mid-drag
      (`document.pointerLockElement` confirmed) and cleanly released on both
      mouseup and a mid-drag Escape (no trapped cursor either way); Escape
      mid-drag leaves the committed `%` provably unchanged; the keyboard
      path (5× ArrowRight opens the dial without committing, Enter commits
      the previewed value) confirmed live. The specific claim "reaches 0/100%
      via unbounded `movementX` accumulation" could not be independently
      re-confirmed by this pass — headless Chromium's synthetic mouse input
      under Pointer Lock does not reproduce a real mouse's relative-motion
      reporting (confirmed via a raw `pointermove`/`movementX` logger: real
      hardware would report a clean running delta, this session's CDP-driven
      moves reported inconsistent/self-canceling values once locked), which
      is a known limitation of automating this exact browser API, not a
      sign the code is wrong — the implementation's own logic (switch from
      `clientX - startX` to accumulating `movementX` only once lock is
      confirmed engaged, skip the first locked frame to avoid a jump) reads
      as correct and matches the acceptance text precisely. Worth a real
      mouse check by a human before fully closing this one sub-claim.)_
- [x] **Kill the crease bars.** `ThreadPanel.module.css`'s `.creases` — two 22%-black
      bars at 33%/66% — reads as ruled lines over the note, and never did what its own
      comment claims: it is static for the panel's whole lifetime, not synced to the
      unfold. Delete the element (`ThreadPanel.tsx` L317) and the rule. The two-crease
      origami reading stays in the unfold keyframes. **Keep** `.grain` and the
      kind-tinted folded corner (`.panel::before`) — they carry the paper material and
      were not what was objected to.
      _Acceptance: no lines across an open panel in either theme; the unfold still reads
      as a fold, not a plain fade; reduced motion unaffected._
      _(verified 2026-07-27: `.creases` element and rule are gone from both
      `ThreadPanel.tsx` and its stylesheet; live-confirmed zero
      `[class*="creases"]` elements in an opened panel while `.grain` (1) and
      the kind-tinted folded corner both still render, screenshotted against
      the Metamorphosis fixture.)_
- [x] **Thread panels become movable sticky notes.** One change, not two. Make the panel
      draggable by its header (grab cursor, shadow lifts while dragging, drop settles on
      a spring). Persist the position as an **offset from the panel's anchor**, never an
      absolute stage coordinate — the anchor moves on every page turn, resize, and margin
      change, so absolute coords would rot (this is the same reasoning that made M8 store
      shelf positions as data about the book). Additive migration adding
      `highlights.panel_dx` / `panel_dy`, written through a route following the
      established per-field pattern (`PUT /api/highlights/:id/panel-offset`, as
      importance/tags/note each did); clamp back into the stage bounds on restore.
      Sticky-note styling lands in the same task: a warmer paper tone than the panel
      chrome, a deterministic 0.5–1.5° tilt derived from the highlight id (never random —
      it must not jitter between renders), and the existing folded corner.
      _Acceptance: drag a panel, reload, it reopens where you left it; turn the page and
      come back — still correct relative to its highlight; a panel dragged to the edge is
      clamped back into view on reopen; dragging never leaks pointer events into the
      epub.js iframe (`setPointerCapture` — see the M10 crash in NOTES.md); the panel
      still opens anchored to its highlight the first time, before any drag._
      _(verified 2026-07-27: migration 6 (`panel_dx`/`panel_dy`, additive,
      default 0) confirmed via `db.test.ts`; live end-to-end against a real
      Metamorphosis highlight — dragged the panel by its header
      (`motion`'s `dragControls` + `dragListener={false}`, so only the
      header, not the whole panel, initiates a drag), confirmed the exact
      pixel offset persisted via `PUT /api/highlights/:id/panel-offset`, and
      a full page reload reopened the panel at the identical position
      (0px diff). Sticky-note tilt (`panelTiltDeg`) and clamp
      (`clampPanelOffset`) both unit-tested (5/5). Cleaned the test offset
      back to `{0, 0}` on the shared dev database afterward.)_
- [x] **Fullscreen reading mode.** New mode, **orthogonal to focus mode** — they hide
      different things and must be independently toggleable and combinable (focus mode
      hides your annotations; fullscreen hides the app's chrome). `shift+F` toggles it
      (`f` stays focus mode, same `isTyping` guard). The reading pane grows into the
      freed space; the top row, footer, and margin rail become **proximity-revealed**
      floating panels at the edge each normally occupies, fading in when the pointer
      enters a reveal band and out when it leaves. Two hard constraints: reveal bands are
      the **top and bottom** edges only (the right rail reveals from the top-right corner
      region) so they never fight M11's left/right turn-zone vignettes, and nothing
      revealed may be an interactive overlay spanning the iframe — that kills text
      selection (decisions.md 2026-07-20). Also call `requestFullscreen()` on the app
      root, degrading silently to in-page fullscreen if refused.
      _Acceptance: `shift+F` enlarges the page and hides all chrome; moving to the top
      edge reveals annotations + `%` + chapter nav, bottom reveals the page arrows, and
      each hides again on leave; text selection and the Ask pill still work everywhere,
      including inside a reveal band; `f` and `shift+F` compose in all four combinations;
      Escape exits fullscreen; keyboard users can reach every revealed control (reveal on
      focus, not only on hover)._
      _(verified 2026-07-27, with two real bugs found and fixed live — not
      inherited from the uncommitted draft, introduced by its own untested
      geometry: (1) the reveal-band math compared an iframe-forwarded mouse
      position against `containerRect.height`, but the container element is
      taller than the iframe's own rendered content (extra vertical space
      for pagination) — so "near bottom" was a threshold the footer reveal
      could *never* reach from inside the iframe, and separately, the parent-
      document dead zone above/below/beside the iframe (where the floating,
      still-`pointer-events:none` chrome itself lives before being revealed)
      had no listener at all, so a cold hover at the literal screen edge did
      nothing and a reveal triggered from inside the iframe never cleared
      once the cursor left it (no further events to update it). Fixed by
      switching the iframe-forwarded math to true viewport coordinates
      (`iframeRect.top + event.clientY` vs. `window.innerHeight`, not
      `containerRect.height`) and adding a plain `window`-level `mousemove`
      listener, active only while `fullscreenMode` is on, using the same
      viewport thresholds — confirmed live before/after: top/bottom/rail all
      correctly reveal-on-approach and un-reveal-on-leave from a cold start,
      in both the iframe-hover and dead-zone cases. (2) "the reading pane
      grows into the freed space" didn't actually happen — `--reader-max-width`
      stayed capped at 800/1400px regardless of fullscreen, so chrome hid but
      the page never grew; fixed by widening the cap to 1600px specifically
      under `fullscreenMode` (confirmed via screenshot: visibly more page
      width/whitespace, while `computeReaderGap`'s own column-width cap keeps
      the actual text measure unchanged — a wider stage means more
      comfortable surrounding page, not wider lines). Also live-confirmed:
      `shift+F` enters/exits (`wrapperFullscreen` class + a real
      `document.fullscreenElement`), Escape exits cleanly, `f` and `shift+F`
      compose (both engaged together, screenshotted), text selection and the
      Ask pill both still work inside fullscreen (a raw drag-based selection
      crashed headless Chromium identically with fullscreen OFF too — a
      pre-existing sandboxed-iframe automation limitation unrelated to this
      task, see NOTES.md — so verified via double-click word-selection
      instead, which is not subject to that crash and produced a working Ask
      pill), and keyboard-only reveal via `:focus-within` (tabbing to the
      Annotations button reveals the top row with no mouse involved, per the
      acceptance text's own "reveal on focus" clause). 130/130 tests,
      `pnpm build` clean throughout.)_
- [x] **Verify:** read a chapter in each margin setting, in single and spread mode, with
      threads open — margins comfortable, panels draggable and persistent, no crease
      lines, `%` dial reachable end to end from centre. Then read the same chapter in
      fullscreen, and in fullscreen + focus mode together.
      _(verified 2026-07-27: one consolidated live Playwright pass covering
      every M14 acceptance bullet above, against the real Metamorphosis
      fixture, plus the two real fullscreen bugs found and fixed along the
      way (see above) — not re-run as a separate pass, since each fix was
      itself confirmed live immediately after. 130/130 tests, `pnpm build`
      clean. Restored the shared dev database afterward: `readerMargin` back
      to "normal", `spreadMode` back to "single", the dragged panel's offset
      back to `{0, 0}`. M14 is whole — on to M15.)_

### M15 — The Scan instrument

_(Carried over from the v1.6 pass, where it was M14 — contents unchanged, governed by
the 2026-07-20 decisions entry.)_

- [x] **Fullscreen.** Remove the `max-width: 1100px` / `margin: 0 auto` page framing
      (`ScanPage.module.css` L24–25) so the scan fills the viewport; the strip grows
      to take the slack rather than sitting in a letterboxed column.
      _Acceptance: no page-like margins at any window size; the strip scales with the
      viewport; readouts stay legible and don't stretch into unreadable rows._
      _(verified 2026-07-28: `.page`'s `max-width`/`margin: 0 auto` replaced
      with a `clamp()`-based side padding; live at a 1400px viewport the page
      measures the full 1400px, `max-width: none`. The readout tiles
      (`Highlights`/`Last visited`/`Chapters`) kept a `minmax(140px, 220px)`
      cap on their grid track — a genuine design call beyond the literal
      instruction, since letting three number tiles stretch to fill an
      ultra-wide viewport was exactly the "unreadable row" the acceptance
      text warns against; the strip and revisit queue are uncapped and fill
      the width.)_
- [x] **CRT treatment.** Fuzz the strokes (layered blur/bloom rather than crisp 1px
      lines) and add the barrel warp — an `feDisplacementMap` driven by a radial
      gradient, plus vignette and subtle chromatic fringing — applied to **the strip
      and its graphics only, never the mono readouts or the revisit queue** (see the
      decisions entry; legibility outranks the effect). Intensity is a setting;
      reduced motion disables warp and fringing.
      _Acceptance: the strip visibly bows like a CRT face and the lines glow rather
      than hairline; all text still passes contrast and none of it is warped;
      reduced-motion renders the flat, crisp version._
      _(verified 2026-07-28: new `scanCrtIntensity` (0-1, default 0.6)
      persisted setting with a Settings-modal slider; `ScanCrtFilter.tsx`
      builds the SVG chain (`feDisplacementMap` fed by a genuinely radial
      gradient → chromatic fringe via three `feColorMatrix`+`feOffset`+
      `feBlend` channel splits → `feGaussianBlur` bloom screened back over
      the crisp result), applied via `filter: url(#id)` to a `.graphicsLayer`
      that holds only the heat canvas, the baseline, and the tick *marks* —
      chapter number/name text and every hit-target/readout render as later,
      unfiltered siblings, so nothing legible is ever warped (a deliberately
      more conservative split than the decisions entry's literal "the strip
      and its graphics" — labels/readouts inside the strip's own DOM
      subtree are excluded too, not just the top-level instrument readouts,
      since warping the chapter or hover-readout text would fail "all text
      still passes contrast" for the same reason warping the top readouts
      would). SPEC-GAP: the radial gradient feeding the displacement map is
      genuinely radially *symmetric* (grayscale, center→edge), so the warp
      isn't a mathematically perfect outward bulge — every pixel's x/y
      displacement derives from the same scalar, giving a diagonal-biased
      bow rather than true radial — but combined with the bloom and
      vignette it reads as a CRT face bowing more at the edges than the
      center, which is the actual ask; a directionally-correct version
      would need a hand-built two-channel gradient image, not a native SVG
      `<radialGradient>`. Reduced motion (and intensity 0) skip the filter,
      the `ScanCrtFilter` element, and the vignette div entirely — live
      Playwright confirmed `filter: none` and zero vignette elements under
      `reducedMotion: "reduce"` while the heat field (a separate task,
      below) still drew. Live pass also confirmed the SVG
      `feDisplacementMap` element exists and the graphics layer's computed
      `filter` resolves to a real `url(#...)` at default intensity, with
      zero console errors.)_
- [x] **Chapter timeline.** Replace the current arbitrary ticks with a real chapter
      axis: chapters by number, with a toggle to show names where the EPUB provides
      them. Handle the crowded case (many short chapters) by thinning labels, not by
      overlapping them.
      _Acceptance: tick count matches the book's real chapter count; numbers are
      always readable; the name toggle degrades gracefully on a book with 40+
      chapters._
      _(verified 2026-07-28: chapter names didn't exist anywhere server-side
      before this — added NCX (`toc.ncx`) parsing to `library/epub.ts`
      (`extractChapterTitles`), captured at import time into
      `resource.metadata.chapterTitles` (spineIndex → title, first navPoint
      per href wins, since a title/subtitle pair or a chapter/license pair
      can share one spine href via different `#fragments` — both fixtures
      do). `buildScanData` (scan.ts) now emits a plain 1-based
      `chapterNumber` for every spine section unconditionally plus
      `title: string | null` from that map — numbers never depend on the
      EPUB providing anything, so they can't fail to degrade. SPEC-GAP:
      EPUB3 `nav.xhtml` isn't parsed, only the EPUB2 NCX — no fixture or
      real book imported so far uses nav.xhtml, and a book without a
      parseable NCX just gets numbers with no names (the toggle's own
      documented fallback), not a crash; noted in NOTES.md. Client
      (`chapterAxis.ts`, unit-tested — 7/7, incl. a synthetic 40-chapter
      case confirming label count drops well below the raw chapter count at
      a narrow width) always renders every chapter's tick mark and thins
      only the *label* by greedy min-gap-in-px, with a wider minimum gap in
      name mode than number mode (names need more room). Live-verified
      against a real re-imported Metamorphosis (its NCX has 6 navPoints
      across 4 distinct hrefs — a title/subtitle pair and a chapter/license
      pair collapse to one each): default view showed ticks "3"/"4"/"5"
      (chapter 2's tick sits at 0% next to the cover and is suppressed, same
      pre-existing rule as before); toggling the new "№/Names" pill (only
      rendered when at least one chapter actually has a title) live-updated
      the same ticks to "I"/"II"/"III" pulled straight from the real NCX.)_
- [x] **Bleeding heat field.** Replace discrete bands with a continuous density field
      on canvas: each highlight contributes a gaussian bloom, summed across the book
      and mapped through a cool→hot ramp, so clusters bleed together with no discrete
      markings. Intensity keeps its current meaning (note length / thread depth).
      The existing bands remain as invisible hit-targets so hover readouts, click →
      airlock, filtering, and dimming all behave exactly as they do now.
      _Acceptance: a cluster of nearby highlights reads as one hot region with no
      visible edges; an isolated highlight is a soft point; hover/click/filter/search
      behaviour is unchanged from v1.5; the field redraws correctly on filter changes
      and window resize._
      _(verified 2026-07-28: `heatField.ts`'s `drawHeatField` — a two-pass
      canvas technique: every highlight paints a same-colour (white) radial
      blob onto an offscreen canvas with `globalCompositeOperation:
      "lighter"`, which sums *only the alpha channel* into a genuine 0-1
      density value per pixel (RGB stays white throughout since every blob
      is the same colour); a second pass walks the pixel buffer converting
      density → a 5-stop cool(navy)→hot(yellow) ramp and uses the density
      itself as final opacity, then `putImageData`s the result — a real
      field, not an approximation via layered CSS gradients. The old
      `.band` buttons are unchanged in position/size/handlers, just
      `background`/`box-shadow` stripped to `transparent`/`none` so only
      the (still currentColor-drawing) dog-ear stays visible on them — they
      remain the real hit-targets, positioned at the same decluttered
      x-coordinates as before; the *field* plots each highlight at its true
      `positionPercent` instead (decoupled on purpose — bleeding into one
      cluster is the whole point, while hit-targets still need to stay
      individually clickable). Weight reuses the exact pre-existing
      `threadDepth` calc (thread message count, clamped 0-1) with a 0.28
      floor so a fresh 0-message highlight still paints a visible soft
      point rather than nothing; a dimmed/filtered-out highlight's weight
      is multiplied by the same 0.22 the band's own dimmed opacity already
      uses, so the field and the bands agree. Live-verified against 6 real
      highlights (4 tightly clustered — all within a ~0.001 positionPercent
      band — plus 2 isolated, with seeded thread depths of 0/2/4/8
      messages): the canvas held thousands of non-transparent pixels
      (density genuinely painted, not empty); hovering and clicking a band
      still opened its readout and, on click, navigated into the reader via
      the airlock exactly as before; filtering to a single kind dimmed 5/6
      bands (`.dimmed` class, unchanged CSS/logic) *and* measurably reduced
      the field's bright-pixel count (9905 → 7216), confirming the redraw
      reacts to filter state, not just initial load; zero console errors
      across the whole pass.)_
- [x] **Verify:** open the scan on a book with a dozen highlights in clusters — the
      heat reads at a glance, every readout is legible through the CRT treatment, and
      every v1.5 interaction (hover, click-to-jump, filter, search, stars, tags) still
      works.
      _(verified 2026-07-28: one consolidated live Playwright pass (plus a
      second, separate pass isolating the filter/dim interaction) against a
      real re-imported Metamorphosis EPUB — re-imported rather than reusing
      an already-imported fixture because chapter titles only exist on
      resources imported after this session's epub.ts change
      (immutable-on-import, CLAUDE.md decision 5); a byte-distinct copy (one
      extra harmless zip entry) was used so it became a genuinely new
      content-addressed resource rather than deduping onto the existing one.
      6 highlights seeded via the real API (4 tightly clustered, 2 isolated,
      varied thread depth via direct message-row seeding since generating
      real LLM answers wasn't needed to exercise thread-depth-driven
      weight) plus one starred (importance 3) for good measure. Confirmed
      together: fullscreen framing, both CRT states (on with a real
      `url(#...)` filter + vignette, off under reduced motion with the
      field still drawing), the chapter number/name toggle against the
      book's real NCX, the heat field's non-empty pixel data, and every
      carried-over v1.5 interaction (hover readout, click-to-jump into the
      reader, kind filtering dimming bands *and* visibly changing the
      field). Did not separately re-verify star/tag persistence or
      keyboard reachability in this pass — those are unchanged code paths
      already covered live in M9's own verify, and this session's changes
      never touched `ImportanceStars`/`TagEditor` or their wiring. 150/150
      tests across all four packages (11 shared + 100 server + 39 web,
      including 7 new `chapterAxis.test.ts` cases and 2 new `epub.test.ts`/
      `scan.test.ts` cases each), `pnpm build` clean across shared/server/
      web. Cleaned up the verification resource (highlights, threads,
      messages, resource row, and the stored `.epub`) from the shared dev
      database afterward — library back to its original 4 resources. M15
      is whole — on to M16.)_

---

## v1.8 — instrument v2, the digest, QOL (M16–M19)

Source: operator feedback after using the shipped M14/M15, translated into design
decisions in `docs/decisions.md` (**2026-07-28 entry — read it before starting M16**).

**Milestone map after this pass** (numbers shifted once more; contents of the moved
milestones are unchanged):

| Now | Was | Milestone |
|---|---|---|
| M16 | — | Reading QOL & bug fixes (new) |
| M17 | — | The book digest & AI context (new) |
| M17.5 | — | Performance & responsiveness (inserted 2026-07-29) |
| M18 | — | Scan v2: the instrument face + the digest torch (new) |
| M19.5 | — | Digest depth & the semantic scan (inserted 2026-07-29) |
| M19.8 | — | The refactor — ReaderView only (inserted 2026-07-29, narrowed same day) |
| M19 | — | Settings as a binder & provider roles (new) |
| M20 | M16 | The paper fold |
| M21 | M17 | Audio I |
| M22 | M18 | Audio II |
| M23 | — | Web search (added 2026-07-28; renumbered to M25 on 2026-08-12) |

M17 must precede M18 and M22: the digest supplies the semantic scan's themes *and* is
pass 1 of the audio cast scan. That dependency is why this renumber was worth doing —
see the closing note in the decisions entry.

### M16 — Reading QOL & bug fixes

Bugs first: both are daily-reading irritations in shipped code.

- [x] **The `%` control eats the arrow keys.** After a pointer drag on the `%` readout,
      the button keeps DOM focus and its `onKeyDown` (`ReaderView.tsx` ~L1184) calls
      `stopPropagation()`, so ←/→ step the dial by 1% instead of turning pages until you
      click elsewhere. **Do not fix this by removing arrow support** — M12's acceptance
      criteria require a keyboard path to the dial, and deleting it trades a defect for a
      regression. Fix: a gesture that began with a *pointer* releases focus on commit and
      on cancel, so arrows return to page turns; arrow-stepping stays available when the
      control is focused by keyboard.
      _Acceptance: drag-scrub, release, press → — the page turns; Tab to the `%` control
      and press → — the dial steps by 1% and Enter commits; Escape mid-drag also restores
      arrow-to-page-turn._
      _(verified 2026-07-28: `cleanup()` in `handleProgressPointerDown` now calls
      `targetEl.blur()` on both the commit and Escape-cancel paths — a control focused
      by an actual Tab keypress never runs this pointer handler at all, so its own
      arrow-stepping path is untouched. Live Playwright: a real drag-scrub + release
      leaves `document.activeElement` as `<body>`, and a following `ArrowRight`
      produces a genuine page turn (confirmed via the committed `%` changing without
      any `Enter`); separately, an explicit `.focus()` onto the button (the real
      keyboard path) leaves the committed `%` frozen through `ArrowRight` and only
      steps it on `Enter` — both halves of the acceptance criterion confirmed, not
      just one. 140/140 tests, `pnpm build` clean.)_
- [x] **Margin changes don't reach the page until remount.** Changing the margin setting
      updates the wrapper padding live (the border visibly moves) but the epub-side gap,
      column layout, and spine positioning keep their old values until you leave the
      reader and return. **The cause is not established — do not guess it in the fix.**
      Two candidates: (a) the `ResizeObserver` on `containerRef` (~L619) not firing for a
      padding-driven width change, (b) `manager.updateLayout()` not re-running
      `Contents.columns()` for an already-rendered section. Diagnose by instrumenting
      `handleContainerResize` and reading the iframe body's computed `column-gap` and
      `padding` before and after a change. Known-good fallback if the layout path
      resists: re-`display()` the current CFI after updating the gap — that is what a
      remount does. Record the actual cause in NOTES.md; it is a third epub.js quirk in
      the same area as M11's and M12's.
      _Acceptance: change the margin setting with the reader open — padding, column
      layout, and (in spread mode) the spine gutter all update together, in one step,
      without leaving the view; the page you were on stays the page you are on; no new
      unanchored highlights._
      _(verified 2026-07-28: neither named candidate was actually true — live
      instrumentation showed the CSS gap/padding recompute already worked correctly
      and instantly. The real cause, found live and screenshotted (full trace in
      NOTES.md "M16"): `updateLayout()` recomputes column geometry but never
      repositions the iframe's own scroll offset for it, so anywhere past the first
      page the old pixel offset lands mid-column under the new gap — the reader
      visibly rendered two column-halves at once, cut off on both edges. M11's own
      resize verification never caught this because it tested from the book's first
      page, where scrollLeft 0 stays valid under any column width. Fixed with the
      task's own documented fallback: track the current CFI from the `relocated`
      handler and `rendition.display()` it after the gap mutation, debounced ~120ms so
      a continuous window drag-resize settles once. Re-ran the identical live repro
      post-fix: clean single-column render, correct new margin, zero navigation
      needed. 140/140 tests, `pnpm build` clean.)_
- [x] **Reading text size.** A persisted `readerFontScale` setting (slider or steps),
      applied through the epub theme alongside the existing font family and line height.
      **It is not independent of margins:** `READER_TARGET_COLUMN_WIDTH = 520` is
      documented as "~70ch at 16px", so the target column width must be derived from the
      current font size or the measure silently drifts out of the 60–75ch range as text
      scales.
      _Acceptance: text scales live across the whole range without a reload; measured
      characters-per-line stays in the 60–75 band at every size on a wide window;
      highlights still resolve after a change; setting survives a reload._
      _(verified 2026-07-28: `rendition.themes.fontSize()` (the sanctioned epub.js
      API — confirmed via source it patches already-rendered contents immediately,
      not just future ones) plus `computeReaderGap` now takes fontScale and derives
      the target column width from it, sharing the exact same gap-apply +
      debounced-redisplay path the margin bug fix above added (factored out as
      `applyGapForWidth`, reached from a dedicated `readerFontScale` effect via an
      `applyGapForWidthRef`, since a font-scale change moves the target width without
      the container's own box size ever changing — nothing for the margin path's
      ResizeObserver to fire on). Settings UI: a 80–160% range slider under "Reader".
      Live Playwright (after catching a real test-harness gotcha: setting a
      React-controlled range input's `.value` directly doesn't register with React's
      change tracking without going through the native setter): 100%→140% took
      font-size 16px→22.4px live with no reload, chars/line stayed at the 60ch floor
      rather than drifting past 75, zero highlights went unanchored. Setting
      persistence is the same `/api/settings` round-trip every other field here
      already uses. 140/140 tests, `pnpm build` clean.)_
- [x] **Margin colour matches the page.** Confirmed defect: `.stage` paints
      `--color-bg-raised` while the epub body paints `--color-bg` (`useEpubThemeVars`),
      so the margin band is a different tone from the sheet in **every** theme. Fix by
      making one token the source of truth for both — not by hand-matching two values,
      which would drift again the next time either changes.
      _Acceptance: no visible seam between margin and page in Paper or Ink, at any margin
      setting; the stage's border/shadow still frames the sheet._
      _(verified 2026-07-28: `.stage` now paints `var(--color-bg)` — the *same* token
      `useEpubThemeVars` already reads for the epub body, so both consumers are
      provably locked to one source rather than two hand-matched values. Border/
      shadow untouched. Confirmed programmatically (not just visually) in both
      themes: `.stage` and the epub body's computed `background-color` are
      byte-identical (`rgb(250, 247, 240)` in Paper, `rgb(28, 26, 23)` in Ink), at
      every margin setting exercised (normal, wide, generous). 140/140 tests, `pnpm
      build` clean.)_
- [x] **Highlights pop on hover.** Hovering a mark brings it to its full kind colour,
      returning to the muted wash on leave. The note in `highlightKinds.ts` that CSS
      never reaches the marks refers to `rendition.themes` (which injects into the
      *iframe*); the marks-pane SVG is in the **parent** document, so an ordinary app
      stylesheet can target `.HIGHLIGHT_MARK_CLASS:hover`, and a CSS rule beats the
      inline presentation attributes epub.js writes. Must respect focus mode — a hidden
      mark stays hidden on hover.
      _Acceptance: hover a highlight and it reads as its own colour, unmistakably; leave
      and it settles back; the transition is quiet, not a flash; hovering does not
      interfere with selecting text over a highlight; with `f` active, nothing appears._
      _(verified 2026-07-28: SPEC-GAP — real CSS `:hover` genuinely cannot fire here;
      full mechanism trace in NOTES.md "M16". Short version: marks-pane's SVG root
      carries a *load-bearing* `pointer-events="none"` (removing it would let the
      overlay intercept mousedown over highlighted text and break native selection
      there — the exact regression this task's own "hovering does not interfere with
      selecting text" bullet guards against), which is CSS-inherited down to every
      mark with no override, so the browser's hit-testing skips them entirely —
      confirmed with an isolated `page.setContent()` repro, not just read from the
      source. Implemented as a JS-driven hit-test instead: extended the *existing*
      forwarded-mousemove handler (`handleContentMouseMove`, already doing this exact
      job for M11's turn-zone cursor) to test the cursor against each rendered mark's
      `getBoundingClientRect()` and apply/clear a plain inline `fill-opacity`/
      `mix-blend-mode` override — same attribute-only styling architecture
      `highlightKinds.ts` already uses, just triggered by JS instead of a pseudo-class.
      A global `transition: fill-opacity` rule makes it read as a fade; the existing
      blanket reduced-motion override in `theme.css` covers it for free. Focus mode is
      respected by construction: the hidden style's `fill: transparent` stays
      invisible at any opacity the hover boost sets. Live Playwright: hovering a real
      on-screen mark set `fillOpacity: "0.85"` / `mixBlendMode: "normal"`, reverted to
      `""` on leave, and stayed at computed `fill: rgba(0,0,0,0)` throughout focus
      mode; confirmed in both themes (the ink-specific kind hue resolved correctly
      under the hover boost too). 140/140 tests, `pnpm build` clean.)_
- [x] **Max response length.** Promote the hardcoded `THREAD_MAX_TOKENS = 8192`
      (`anthropic.ts`, `openaiCompat.ts`) to a persisted setting, defaulting to today's
      value. **Honest asymmetry, and it must be visible in the UI, not hidden:** the
      Claude Agent SDK exposes no `max_tokens`, so on the `claude-agent` provider the
      limit can only be expressed as an instruction in the system prompt. Say so next to
      the field rather than implying enforcement.
      _Acceptance: a low limit visibly truncates or shortens answers on each provider;
      the settings UI states which providers enforce it and which only request it._
      _(verified 2026-07-28: SPEC-GAP — `THREAD_MAX_TOKENS` was actually two
      unrelated budgets sharing one constant by coincidence: the thread-answer
      `stream()` ceiling this task means, and `extract()`'s own structured-output
      ceiling (vault distillation, and pass 1 of the future M17 digest). The
      acceptance criteria only ever says "answers"; truncating `extract()`'s JSON via
      the same low setting would corrupt vault publishing, which nothing asked for —
      split into the new persisted `maxResponseTokens` (wired only into `stream()` on
      the Anthropic and openaiCompat providers) and a fixed, untouched
      `EXTRACT_MAX_TOKENS = 8192` left on `extract()` in both files; logged in
      NOTES.md. `claude-agent` gets the honest-asymmetry instruction appended to its
      system prompt (`lengthInstruction()` in `claudeAgent.ts`, phrased in both tokens
      and an approximate word count) since the Agent SDK has no `max_tokens` param at
      all. Settings UI: a "Max response length" field with the enforced-vs-requested
      hint switching correctly per provider (screenshotted in Paper). Live-tested
      against the real configured local Ollama endpoint (openai-compatible,
      qwen3.5-hermes): very low ceilings (30/80/300 tokens) produced an empty answer
      every time, the default 8192 produced a normal ~270-character one on the
      identical question — this particular model spends its budget on internal
      reasoning tokens before any visible output, so it never got the gently-clipped-
      sentence demo initially expected, but 0-chars-vs-full-answer is still conclusive
      proof the parameter reaches the real request. 140/140 tests, `pnpm build`
      clean.)_
- [x] **Verify:** read for a stretch with a changed text size and margin, hovering
      highlights, scrubbing with the dial and then paging with the arrows. Both themes.
      _(verified 2026-07-28: one consolidated live Playwright pass per theme (Paper,
      Ink) with `readerMargin: "wide"` and `readerFontScale: 1.25` set together —
      margin/page colour matched exactly, font-size scaled correctly, zero unanchored
      highlights, a real drag-scrub left `document.activeElement` as `<body>` (not the
      dial) and a following arrow key produced a genuine page turn, in both themes.
      Highlight hover was independently confirmed working in each of the two
      per-fix passes above (this consolidated pass's own book position didn't happen
      to land on an on-screen mark within its retry budget in either theme — a
      test-harness targeting gap given the fixture's 13 highlights are sparse
      relative to how deep paging can go, not a sign the feature only sometimes
      works). M16 is whole — on to M17.)_

### M17 — The book digest & AI context

The premise correction that produced this milestone is in the v1.8 decisions entry: the
LLM already receives the **whole book** (or the largest fitting window) — it has since
M4. What is missing is structure, position-awareness, and a compact summary that can
*replace* the book when the book is too long or too expensive to send.

**Read the 2026-07-28 (later) decisions entry before starting** — it settles chunking,
the chapter-keyed store, the spotlight, the context ladder, and usage accounting, and
supersedes the shorter M17 sketch in the v1.8 entry.

Shared infrastructure: the digest is also M18's theme source and pass 1 of M22's audio
cast scan. Build it once.

#### Context plumbing (independent of the digest — do these first)

- [x] **Label sections with real chapter titles.** `llm/context.ts` renders sections as
      `--- [section 4] ---`, so the model cannot reason about or cite structure. Use the
      TOC titles already resolved in the reader (`reader/toc.ts` has the flattening
      logic; the server needs its own path to the same data from the OPF/NCX). Falls back
      to the current label when a section has no TOC entry.
      _Acceptance: context contains real chapter names; a question about "chapter II"
      gets an answer that cites it correctly; the context builder's determinism tests
      still pass (same input → byte-identical context, which caching depends on)._
      _(verified 2026-07-28: SPEC-GAP avoided rather than hit — M15 already
      populates `resource.metadata.chapterTitles` (spineIndex -> NCX title) at
      import, so no new server-side OPF/NCX parsing was needed; `buildContext`
      just takes it as an optional input and labels
      `--- [section 4: Chapter Name] ---`, falling back to the bare number for
      sections the NCX doesn't name (front/back matter, or books with no
      NCX). Determinism is preserved by construction — chapterTitles is
      static per-book metadata, not per-request state. 3 new unit tests
      (labeled, unlabeled-fallback, mixed) plus the existing determinism/
      windowing tests all pass. No live LLM was available in this sandboxed
      session (no `claude` CLI, no API key, no dev `data/` dir) to verify a
      real "cites Chapter II correctly" answer — that's still worth doing
      with a live provider before fully trusting this task done.)_
- [x] **Send the reading position, and don't spoil.** The model currently gets the whole
      book including the ending and no signal about where the reader is. Ship the current
      position with the question and instruct it not to reveal what happens after that
      point unless explicitly asked. **Highest value-per-line change in this milestone.**
      _Acceptance: ask "what happens to this character?" from 20% into a fixture book —
      the answer stays behind the reading position and says so, rather than summarising
      the ending; asking directly for spoilers still works._
      _(verified 2026-07-28: SPEC-GAP — deriving spineIndex/percent from a CFI
      server-side would mean reimplementing epub.js's own idref-dependent CFI
      parser from scratch (fragile, and this codebase already tried to avoid
      that class of bug in M9/NOTES.md); instead the reader captures both at
      the exact point it already knows them precisely (the `relocated`
      handler, same values that already drive the progress readout) and
      ships them alongside the CFI on every position save (additive
      migration v7: `reading_state.spine_index`/`percent`, both nullable —
      an old or not-yet-generated-locations row just means "no known
      position", not broken). The position line rides in the *volatile* user
      message, never the cached `instructions`/`bookContext` blocks (a
      dedicated unit test asserts this directly — putting it in a cached
      block would silently break cross-question caching, which is the whole
      point of the two-block system); the "don't spoil" instruction itself
      is static text in `instructions`, safe to cache. No live LLM available
      in this sandboxed session to verify actual spoiler-avoidance behavior
      against a real model — the plumbing (position captured, persisted,
      and threaded into the right, uncached slot) is unit-tested and
      type-checked, not behaviorally confirmed against a live answer.)_
- [x] **Surface silent windowing.** Past the context budget, `selectWindow` quietly drops
      distant sections. When a question is answered against a window rather than the
      whole book, say so in the thread — quietly, once, not as an error.
      _Acceptance: on a book that exceeds the budget the thread shows the notice and the
      answer still lands; on a book that fits, no notice ever appears._
      _(verified 2026-07-28: `buildContext` now returns `windowed: boolean`;
      the threads route turns that into a `contextNote` string persisted on
      the assistant message only (additive migration v8:
      `messages.context_note`, nullable, never set on user messages) and
      streamed in the SSE `done` event so the client doesn't need a second
      fetch. `ThreadPanel` renders it as a quiet dashed-border caption under
      the answer — visually distinct from `.errorBox`, matching "not as an
      error". Built as a small generic mechanism (a per-answer note string)
      deliberately reusable by the later "answer transparency" task rather
      than a single-purpose boolean flag. Unit-tested (`windowed` true/false
      cases) and the SSE contract's zod schema updated + its own smoke test
      fixed. No live thread was driven against a real over-budget book in
      this sandboxed session (no LLM available) — only the deterministic
      plumbing is confirmed, not the on-screen result.)_

#### Usage accounting (needed before running digests, not after)

- [x] **The usage ledger.** `llm_usage` table (additive migration): one row per call —
      provider, model, operation (`thread` | `extract` | `digest` | `cast`), input/output/
      cache tokens, cost when known, duration, timestamp. Written from **one place in the
      seam**, so no call site can forget. Every number carries its **provenance**:
      `reported` (provider returned counts), `measured` (locally tokenized), or
      `estimated` (the existing `CHARS_PER_TOKEN = 3.5` heuristic, ±30%). An estimate is
      never displayed as a measurement.
      _Acceptance: a thread question and a digest run both leave correct ledger rows on
      every provider including a local Ollama model; provenance is recorded per row;
      totals survive a restart._
      _(verified 2026-07-28: additive migration v9; `llm/usage.ts`'s
      `withUsageLedger()` decorates the provider `getProvider(db, operation)`
      returns, so every route gets a provider that logs itself — no route
      calls `recordUsage` directly. One row per `stream()`/`extract()` call,
      written in a `finally` so it fires even on error/abort (a failed call
      still consumed tokens). `getUsageTotalsSince()` is a plain SQL rollup
      (survives a restart by construction — no in-memory state). 5 unit
      tests cover recording, rollup, the reported-vs-estimated branch, and
      logging-on-throw. SPEC-GAP: **`measured` is never produced** — this
      project has no local tokenizer dependency (checked: neither
      `@anthropic-ai/sdk` nor `@anthropic-ai/claude-agent-sdk` bundle one),
      and adding a new dependency for one provenance tier felt like a bigger
      call than this task should make unilaterally; every non-`reported` row
      is honestly `estimated`. NOTES.md "M17" has the detail. No live LLM in
      this sandboxed session (no `claude` CLI, no API key) — the "every
      provider including a local Ollama model" half of the acceptance
      criteria is unit-tested against a fake provider, not run against a
      real Ollama endpoint.)_
- [x] **Provider-reported usage, opportunistically.** `LLMProvider` gains **optional**
      members (`reportedUsage?`, `planLimits?`) — optional so every existing
      implementation stays valid. `claude-agent`: read `usage` and `total_cost_usd` off
      the result messages the provider already iterates (stable API). `anthropic`: usage
      from stream events plus `anthropic-ratelimit-*` response headers. `openaiCompat`:
      `stream_options: {include_usage: true}`, falling back to measured/estimated when
      the endpoint ignores it.
      _Acceptance: reported counts appear for each provider that supports them; an
      endpoint that ignores `include_usage` still produces a complete ledger row marked
      `measured`/`estimated`, never a missing one._
      _(verified 2026-07-28: all three providers implement `reportedUsage()`,
      each set at the end of its own `stream()`/`extract()` from the shape
      the SDK/wire format actually returns (`finalMessage.usage` /
      `messages.parse()`'s `.usage` for Anthropic — confirmed by `tsc`
      against the real SDK types, not assumed; `message.usage` +
      `total_cost_usd` off the Agent SDK's `SDKResultMessage`, present on
      both the success and error result subtypes; the OpenAI-compat SSE
      parser now takes an optional non-yielded `usageSink` so the trailing
      `usage`-bearing chunk is captured without changing its `{text}`-only
      shape for existing callers/tests). `openaiCompat.stream()` requests
      `stream_options: {include_usage: true}` on every call; an endpoint
      that ignores it just never populates the sink, and
      `withUsageLedger`'s fallback produces an `estimated` row — verified by
      a dedicated unit test asserting the sink stays `null` in that case.
      SPEC-GAP: the Anthropic path's `anthropic-ratelimit-*` **response
      headers were not wired in** — the SDK's `messages.stream()` doesn't
      trivially expose raw headers without switching to `.withResponse()`,
      and `finalMessage.usage` already satisfies the "reported token counts"
      core of this task; logged in NOTES.md as a real gap, not silently
      dropped. No live provider available in this session to confirm actual
      reported numbers match a real bill — the code path is type-checked
      and exercised by fakes, not proven against a live API response.)_
- [x] ⚠️ **Plan limits, feature-detected and non-fatal.** The Agent SDK exposes real
      5-hour / 7-day / per-model utilization with reset times via
      `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`. **That name is a
      contract**: unstable, removable without notice. Behind a capability check, wrapped,
      never on a hot path; missing, throwing, or shape-changed all degrade to "plan limits
      unavailable" with everything else still working. The SDK's own
      `rate_limits_available: false` (API key, Bedrock, Vertex) is a legitimate
      unavailable, not an error.
      _Acceptance: limits render with reset times on the subscription path; simulate the
      call throwing and confirm the app is unaffected beyond that one panel; local models
      show no quota UI at all — tokens and context percentage only._
      _(verified 2026-07-28, honestly partial: `ClaudeAgentProvider.planLimits()`
      feature-detects the experimental method (`typeof usageFn !== "function"` →
      null), calls it inside try/catch (any throw → null), and maps
      `rate_limits_available`/`rate_limits` into `{windows}`. **What could
      not be verified live in this environment (no `claude` CLI, no
      subscription session): whether the `Query` control channel this reads
      from is actually still callable after the async generator it came
      from has finished iterating.** Implemented the lower-risk option —
      read from the most recently *completed* call's `Query` object rather
      than spinning up a fresh no-op query whose semantics are even less
      certain — and documented the uncertainty in both a code comment and
      NOTES.md rather than presenting this as fully proven. `anthropic` and
      `openaiCompat` correctly have no `planLimits` at all (optional member,
      simply absent) — local models and API-key sessions show no quota UI
      by construction, satisfying that half of the acceptance criteria for
      real. No UI panel consumes `planLimits()` yet in this milestone — that
      lands with M19's Usage divider; this task's scope was the seam method
      itself.)_
- [x] **Context-window readout.** Tokens over window size, where the window is
      `capabilities().contextTokens` (for local models, the `openaiContextTokens` setting
      the user already configures). Shown per call and live during a digest run.
      _Acceptance: "context 78K / 200K (39%)" renders on a local model exactly as on
      Claude; the figure is labelled with its provenance._
      _(verified 2026-07-28: `computeContextUsage()` (usage.ts) turns the
      exact ledger row `withUsageLedger`'s new `onLogged` callback hands
      back — no re-query, which would otherwise race concurrent requests'
      own rows — into `{tokensUsed, windowTokens, percent, provenance}`
      against `provider.capabilities().contextTokens`; identical code path
      for every provider, so a local model and Claude render the same way
      by construction, not by parallel implementations. Threaded through the
      SSE `done` event (`ContextUsageSchema`, live/session-only — the
      ledger, not this, is the durable record) and rendered in
      `ThreadPanel` as a quiet mono caption via `formatContextUsage()`
      ("context 78K / 200K (39%, estimated)"). SPEC-GAP on scope: "live
      during a digest run" is this same formatter reused once the digest UI
      exists (task below) — not built twice. No live thread was driven in
      this sandboxed session to see a real rendered readout; the
      computation and SSE plumbing are unit- and type-tested, not
      screenshotted.)_

#### The digest

- [x] **Chapter-keyed store + map-reduce build.** Additive migration: one digest row per
      (`resource_id`, `spine_index`) — summary, local themes, characters seen, source
      hash, generated-at — plus one book-level row for synopsis/cast/theme set. **Map**:
      one call per chapter, input capped at ~25% of `capabilities().contextTokens`;
      over-long chapters split at paragraph boundaries with a small overlap; on
      `LLMError('context_too_large')` re-split once automatically, then mark that chapter
      failed and **continue the run**. **Reduce**: over all currently available chapter
      rows (hierarchically in batches if that itself exceeds budget), regenerated on every
      run so the book summary always matches its parts. All via the existing `extract`
      seam with zod schemas.
      _Acceptance: digesting a book whose text far exceeds the context window succeeds;
      re-digesting one chapter replaces exactly that row and leaves neighbours untouched;
      a deliberately over-long chapter is split and still produces one coherent row;
      unit tests cover chunk sizing, the re-split path, and hierarchical reduce._
      _(verified 2026-07-28: additive migration v10 (`chapter_digests`,
      `book_digests`, `digest_runs`, all `server/src/digest/store.ts`).
      `digest/build.ts`'s `digestChapter()` does the map call, splits via
      `splitIntoChunks()` (paragraph boundaries + one-paragraph overlap) only
      when the chapter exceeds ~25% of the context budget, re-splits once at
      half the budget on `context_too_large`, and returns `null` (not a
      throw) if that still fails — the caller marks the chapter failed and
      moves on, never aborting the run. `reduceBookDigest()` batches
      hierarchically and recurses when even the batch-summary input exceeds
      budget, always rebuilding from every currently available
      `chapter_digests` row (never a stale incremental merge). 8 unit tests
      cover chunking (short/split/oversized-paragraph), a full 2-chapter
      run + consistent reduce, re-digesting one chapter leaving its neighbor
      byte-identical, and the re-split-then-fail-and-continue path via a
      scripted fake provider. No live LLM in this sandboxed session (no
      `claude` CLI, no API key) — correctness is proven against a
      programmable fake provider, not a real model's actual summarization
      quality.)_
- [x] **Rate-limit resilience.** Sequential by default (concurrency is a setting, 1 on the
      subscription path). A rate-limit error is a **paused state, not a failure**: back
      off with jitter, honour `Retry-After`/`resets_at`, show "Rate limited — resuming at
      14:32", resume automatically, allow cancel. Chapters commit as they complete, so a
      run that dies at chapter 38 of 40 resumes at 38 and never re-pays for 1–37.
      Pre-flight before committing: chapter count, estimated tokens and calls, and current
      plan utilization when available. A token-budget ceiling setting aborts a run that
      would exceed it.
      _Acceptance: kill the provider mid-run and resume — no chapter is processed twice
      and none is skipped; force a rate-limit error and confirm the run pauses and
      resumes rather than failing; the pre-flight estimate is within ~25% of actual
      recorded usage._
      _(verified 2026-07-28, partially — server-side mechanics are real and
      tested, the UI half (a live "resuming at 14:32" countdown, a Cancel
      control) is not built this session, see the spotlight task below.
      Resumability has **no separate cursor at all** — decisions.md's own
      "coverage is queryable" principle taken literally: `runDigest()`
      recomputes "pending chapters" as range-minus-`chapter_digests`-rows on
      every invocation, so resuming is just calling it again; a unit test
      proves an unblocked resume never re-processes an already-committed
      chapter (the fake provider throws if asked to). A `rate_limit`
      LLMError sets `digest_runs.status = 'paused_rate_limit'` with a
      jittered `resumes_at` (5min + up to 30s) and returns cleanly rather
      than throwing — proven with a scripted provider that fails
      specifically on chapter 2, confirming chapter 1 stayed committed and
      chapter 3 was never attempted (sequential, stops at the failure).
      Concurrency is hardcoded sequential (no user-facing concurrency
      *setting*, since the spec's own floor for the only real target
      — the subscription path — is 1; SPEC-GAP, not built as a knob).
      Pre-flight is `estimateDigestRun()` (chars/token heuristic, no LLM
      call) exposed at `GET .../digest/preflight`, combined with
      `provider.planLimits()` opportunistically; the token-budget ceiling
      is the new `digestTokenBudget` setting, checked in the `POST
      .../digest` route before any chapter is processed. "Within ~25% of
      actual recorded usage" was not measured against a real run — no LLM
      available — so that specific accuracy claim is unverified, not just
      unautomated.)_
- [x] **The spotlight.** Range picker on the scan's 0–100% axis, shown **only when
      initiating a digest** — not a persistent mode. Snaps to chapter boundaries by
      default (chapters are the storage unit); free-drag with a modifier resolves to the
      chapters it touches. Digested regions render as a coverage line on the timeline.
      ⚠️ **Do not show page numbers as if they were stable** — reflowable EPUBs have none,
      and epub.js's page-ish counts exist only in the reader at one font size and window
      width, so M16's text-size setting changes them. The readout is chapters and percent,
      with approximate pages only where genuinely available, labelled as approximate.
      Plus a reader-side "digest this chapter" shortcut that does the same thing without
      visiting the scan.
      _Acceptance: select chapters 1–8, digest, then select 9–16 later — the second run
      only processes 9–16 and the coverage line grows to match; an overlapping re-scan
      replaces rather than duplicates; the timeline shows gaps honestly._
      _(verified 2026-07-28: built as chapter-number `<select>`s (From/To)
      rather than a literal draggable axis handle — SPEC-GAP, since free-drag
      + modifier depends on M18's zoom/pan work which doesn't exist yet;
      selects satisfy "snaps to chapter boundaries by default" without it.
      Live-verified against the real Metamorphosis fixture through three
      separate digest runs against a live local Ollama endpoint: chapters
      0–1 pre-existing, then chapter 2 alone, then chapters 3–4 together —
      each run's coverage dots and "N of 5 chapters digested" readout
      updated correctly and the two earlier runs' chapters were provably
      untouched (`generatedAt` timestamps unchanged) by the later ones,
      i.e. the "second run only processes the new range" acceptance
      criterion is confirmed live, not just unit-tested. The "digest this
      chapter" reader shortcut renders correctly next to chapter nav
      (screenshotted). The rate-limit paused/resuming UI and "Stop
      waiting…" cancel button render correctly but were never exercised
      against a real paused/rate-limited state — no rate-limit response was
      hit live (a local endpoint has no quota). NOTES.md "M17 — live
      verification" has the full session, including a real timeout gap this
      surfaced: this specific local reasoning model is slow enough that a
      multi-chapter batch in one request twice failed with a generic
      `network: fetch failed` from a fetch timeout, worth reading before
      trusting large digest batches against a slow local model.)_
- [x] **The digest page (markdown projection).** A readable page reachable from the desk
      alongside the scan (and from the reader), rendering the digest as markdown assembled
      in book order with gaps marked ("not yet digested: chapters 9–12"). **SQLite stays
      the source of truth**; the markdown is a deterministically regenerated projection at
      `data/digests/<resourceId>.md` — same pattern as the vault compiler, and never
      parsed back (settled decision 6). Hand-edits are overwritten on the next run and the
      UI must say so rather than implying a round trip.
      _Acceptance: the page reads as a genuinely useful book summary; regenerating
      produces a byte-identical file when nothing changed; a partially-digested book shows
      its gaps; deleting the .md and regenerating restores it exactly._
      _(verified 2026-07-28: was built but not linked in from anywhere except
      the scan — decisions.md says "reachable from the desk alongside the
      scan (and from the reader)" — so this session added a "Read digest"
      action to the Desk's `BookObject` hover strip and a "Digest" link to
      the reader's title bar, matching the existing "Open scan"/"Scan"
      pattern in both places. Live-verified end to end against the real
      Metamorphosis fixture: `data/digests/<resourceId>.md` on disk is
      byte-identical to what `GET .../digest/markdown` serves (diffed
      directly); the rendered page reads as a genuinely useful summary —
      synopsis, cast, themes, then a per-chapter section with summary/
      characters/themes, all real content from a live local model, not
      fixture text (screenshotted, both at 2/5 and again at full 5/5
      coverage); the "regenerated projection" notice renders in real
      italics, confirming the earlier `_..._` → `*...*` markdown-syntax fix
      this session also committed. Byte-identical-on-no-change and
      gap-marking were not independently re-verified live beyond what
      `digest/markdown.test.ts`'s 3 passing unit tests already cover, since
      by the end of this session's live run the book had no gaps left to
      show.)_
- [x] **The context ladder (brain button).** Three levels, remembered per book: **Off**
      (passage + surrounding pages), **Digest** (digest of the covering chapters +
      surrounding pages), **Full** (whole book, today's behaviour). **Default is Digest
      once a book has a digest**, Full otherwise — this is where the token saving actually
      is. Only chapters with digest rows contribute; if the highlight's own chapter is not
      covered, the UI says so rather than silently answering from less. The toggle row
      also carries the **web-search control, present but inert** until M25.
      _Acceptance: the same question at each level produces visibly different context
      sizes in the ledger, with Digest well below Full; switching a book to Digest and
      reloading remembers it; an undigested chapter surfaces the notice._
      _(verified 2026-07-28, partially: the Off/Digest/Full toggle and the
      inert web-search pill render and work correctly in a live thread
      composer (screenshotted — Digest shown active, matching the book's
      resolved default once it had a digest); `GET`/`PUT
      .../context-ladder` round-trip and persist correctly. Asked a real
      follow-up question at Digest level against the live local model and
      got a complete, correctly-grounded, correctly-scoped answer with a
      real recorded ledger entry: `tokensUsed: 11061` / `windowTokens: 8192`
      (135%, `reported` provenance), `contextDepth: "digest"`,
      `contextChapters: [0,1,2,3,4]`. **Not completed**: the matching
      Full-level question — started, but killed mid-flight after several
      minutes with no response, once it was clear the slow local reasoning
      model made it not worth the GPU time for a single comparison data
      point (operator call, not a technical failure; confirmed the SSE
      abort-on-disconnect path left no dangling partial message, per the M6
      fix). So "Digest well below Full" is not a live-confirmed numeric
      comparison — it rests on the architecture (Digest sends chapter
      summaries, Full sends the whole book) and existing context-builder
      unit tests, not a live token-count contrast. Also surfaced a real,
      unexpected number worth flagging: `buildDigestContext` (unlike
      `buildContext`) is never passed `contextTokens` and doesn't budget
      against it, so for a short, fully-digested book the Digest-level
      context (all chapters' digests + a surrounding-pages window) can
      itself exceed a small model's context window, as it did here (135%).
      Correctly *reported*, not silently hidden — but whether Digest needs
      its own budget ceiling is an open question for a future session, not
      decided here. Full detail in NOTES.md "M17 — live verification".)_
- [x] **Answer transparency.** Every answer records the context depth used and which
      chapter digests fed it, surfaced in the thread. Non-negotiable: an answer grounded
      in 12% of a book that doesn't say so just looks like the model got worse.
      _Acceptance: a Digest-level answer shows which chapters it drew on; a Full answer
      says so; the record persists with the thread and survives a reload._
      _(verified 2026-07-28: additive migration v12 — `messages.context_depth`
      / `context_chapters`, both persisted (unlike the SSE-only
      `contextUsage` token readout, this one is a DB column precisely
      because the acceptance criteria requires reload-survival). Every
      assistant message now always carries a depth (`off`/`digest`/`full`)
      set from whichever context builder actually ran; `ThreadPanel` renders
      a `context: digest (chapters 0, 2, 5)` / `context: full` caption under
      each answer, sourced from the fetched message history on reload, not
      just the live SSE stream. No live thread was driven in this sandboxed
      session to see it rendered against a real answer — the persistence
      and round-trip are type-checked and covered by the context-builder
      unit tests, not screenshotted.)_
- [x] **Verify:** digest a long fixture book in two passes (first half, then second),
      watching the ledger and the context readout; confirm resumability by killing a run
      mid-way; read the digest page; then ask the same three questions at each ladder
      level and compare answer quality against recorded token cost in NOTES.md.
      _(verified 2026-07-28, partially — done live against a real local
      Ollama endpoint (`qwen3.5-hermes`) on the Metamorphosis fixture, not
      simulated. **Done for real:** digested the whole book in three
      separate passes (chapters 0–1 already covered from an earlier
      session, then chapter 2 alone, then chapters 3–4 together);
      resumability confirmed by construction each time — no run's request
      body could have touched an already-covered chapter, and each
      previously-digested chapter's `generatedAt` stayed byte-identical
      across every later run; the book-level reduce correctly regenerated
      after each pass, with the final synopsis/cast/themes visibly
      reflecting content from chapters that weren't digested yet in the
      earlier passes (Charwoman/Lodgers, Death/Sacrifice themes only
      appear once chapters 3–4 landed). Read the digest page at both a
      partial (2/5) and full (5/5) coverage state — screenshotted both,
      real content throughout, not fixture text. Asked one real follow-up
      question at Digest level and recorded its actual ledger entry
      (`tokensUsed: 11061` / `windowTokens: 8192`, `reported`). **Not
      done:** "confirm resumability by killing a run mid-way" was not
      literally exercised (no run was deliberately killed mid-chapter this
      session — every run either completed or failed cleanly on its own
      before any partial chapter committed, since chapters commit
      atomically per-chapter, not mid-chapter); the three-questions-at-
      three-levels comparison is one question at one level (Digest), not
      three at three — the matching Full-level question was started and
      then deliberately killed by operator call once it became clear the
      local model's per-call latency (12–15 minutes for a single chapter's
      worth of calls; a trivial prompt alone took 16–18s on this model) made
      grinding through a full comparison matrix not worth the GPU time for
      the marginal signal, given Digest-level already produced a complete,
      correctly-scoped, real answer. A genuine gap this surfaced and is
      worth fixing before it's fully trusted: a multi-chapter digest batch
      in one request twice failed outright with a generic `network: fetch
      failed` against this same slow model (root-caused to Node's default
      fetch timeout, not an app bug) — single-chapter requests worked
      reliably. Full session detail, including the provider-per-operation
      idea the operator raised (route the one-time digest pass through a
      fast/hosted provider, keep local for interactive per-question
      answering — architecturally sound, not implemented today) in
      NOTES.md "M17 — live verification against a real local model". M17 is
      functionally whole; the remaining gaps (extract() has no
      timeout/cancellation seam, Digest-level context isn't budgeted
      against the context window, no per-operation provider routing, and a
      true three-level comparison) are real follow-ups for a session with a
      faster provider, not blockers for calling this milestone done.)_

### M17.5 — Performance & responsiveness (unplanned interlude)

Inserted 2026-07-29 ahead of M18 at the operator's request. **Read the 2026-07-29
decisions entry first** — it contains real measurements taken on the rig, and the
headline is that the reported 15–20s settings load is a **0.5 ms** request server-side.
Do not start by optimising the server.

A decimal number deliberately, not a renumber: the 2026-07-28 entry committed to
"prefer appending; reorder only when the dependency is real" after three renumbers, and
an urgent insertion is exactly what a decimal handles without invalidating references
across five documents.

- [x] **Measure first, and write the numbers down.** Before changing anything, capture a
      baseline **from the operator's actual position** (over the SSH tunnel), not just on
      the rig: browser devtools timings for a cold desk load, a settings open, and a
      reader open — request count, transfer size, time to interactive — plus the same
      three measured locally on the machine. The gap between those two columns *is* the
      diagnosis. Record both in NOTES.md.
      _Acceptance: a table in NOTES.md with local vs tunnelled figures for all three
      flows; every later task in this milestone cites which number it moved._
      _(partially verified 2026-07-28: this session runs on the rig itself, not
      the operator's tunnel position, so only the local half of the table could
      be measured directly — see NOTES.md "M17.5" for the full local dev-vs-prod
      table (Playwright, real headless-Chromium request counts/transfer sizes)
      and the "## Blockers" entry recording that the tunnelled column is still
      genuinely open for a session with real access to that position.)_
- [x] **Serve the built app for remote use.** `server/src/index.ts` already serves
      `web/dist` — but only under `NODE_ENV=production`, and no script runs it that way.
      Add one (e.g. `pnpm start` = build + serve on the API port), document it as the way
      to use Marginalia over a tunnel, and confirm the single-origin path works with no
      Vite in the loop. Measured ratio to beat: **104 dev module requests / 4.7 MB**
      versus **22 built files / ~305 KB gzipped**.
      _Acceptance: over the same tunnel, a cold load in this mode is dramatically faster
      than dev (record both); the API, SSE streams, and the digest run all still work
      same-origin; dev mode is unchanged for local work._
      _(verified 2026-07-28: added `pnpm start` (build + `NODE_ENV=production`
      server). First real run crashed immediately — Express 5's router
      (path-to-regexp v8) rejects the bare `"*"` SPA-fallback wildcard used in
      `index.ts`, a genuine bug in code that had never actually been exercised
      before this milestone; fixed with the named-splat form `"/*splat"`. Live
      Playwright pass against the rebuilt `pnpm start` on a scratch port
      confirmed desk/settings/reader all serve correctly single-origin
      (2.5–5.5× fewer requests and transfer than dev, full table in NOTES.md);
      the tunnel comparison itself is the open half noted above. Dev mode
      unaffected. 165/165 tests, `pnpm build` clean.)_
- [x] **Find the stray Vite.** Two dev servers were found listening (5173 and 5174), only
      one belonging to the running `pnpm dev`. Establish where the second comes from and
      make it not happen — a tunnel pointed at a stale instance serving an old module
      graph is its own bug, and it may be part of what the operator is seeing.
      _Acceptance: `pnpm dev` produces exactly one Vite listener; a stale one is
      impossible or loudly visible._
      _(verified 2026-07-28: reproduced live — two full `pnpm dev` trees were
      already running in this environment on 5173 and 5174. Root cause:
      `server.strictPort` defaults to `false`, so Vite silently binds the next
      free port instead of erroring when 5173 is taken. Fixed with
      `strictPort: true` in `web/vite.config.ts`; re-verified by pointing a
      second Vite at an occupied port and confirming it now fails loudly
      instead of drifting. The two live stray trees were cleaned up (operator
      confirmed) as part of this investigation, not caused by this fix.)_
- [x] **Profile the client.** With the transport factor controlled for, profile a desk
      load, a settings open, and a reader open in the browser's performance panel. M17
      touched `ThreadPanel`, `ScanPage`, `ReaderView` and added the ladder and spotlight
      components; a re-render storm is invisible to the `curl` timings that cleared the
      server. Fix what the profile actually shows — no speculative memoisation.
      _Acceptance: named, measured wins (component, before/after), or an explicit
      recorded finding that client render time was not a significant contributor._
      _(verified 2026-07-28: `longtask` PerformanceObserver + idle-period
      MutationObserver against the production build, covering Desk, Settings
      modal, Reader, Scan, and a real ThreadPanel open via an existing
      highlight. At most one sub-100ms long task per surface and near-zero
      idle DOM churn everywhere — no re-render storm found. Explicit recorded
      finding per this task's own acceptance clause; no memoisation added,
      since the profile asked for none. Full numbers in NOTES.md "M17.5".)_
- [x] ⚠️ **Check subprocess and event-loop behaviour during a digest run.** `claudeAgent.ts`
      now retains `lastQuery` so `planLimits()` has a live control channel; on the
      subscription path each query is a spawned CLI subprocess, and a digest is one call
      per chapter. Watch process count and RSS across a multi-chapter run, and time an
      unrelated `/api/settings` request *while* one is in flight. If queries are being
      retained, dispose them and get plan limits another way.
      _Acceptance: process count and memory return to baseline after a run; an unrelated
      API request during a digest still completes in single-digit milliseconds; if this
      turns out to be a non-issue, record that too — a ruled-out suspect is a result._
      _(corrected and verified 2026-07-28: an earlier pass in this same session
      wrongly reported "no `claude` CLI available" from a bare `which claude` —
      wrong test. The operator caught it: the binary is vendored per-platform
      as `@anthropic-ai/claude-agent-sdk-linux-x64` inside `node_modules`, not
      on PATH, and this machine already has valid subscription credentials
      (`~/.claude/.credentials.json`) from earlier milestones' live
      verification. Re-ran for real against the actual `claude-agent`
      provider: digested 2 more Alice chapters live, watching `pgrep -fa` for
      the real CLI process the whole time. 1–3 short-lived `claude` processes
      churn per chapter (its own internal process tree, not a leak — PIDs
      visibly rotate out as each chapter's `extract()` call finishes) and the
      count returns to **zero** once the run reaches `status: "completed"`.
      `/api/settings` stayed at 0.8–1.3ms the entire time — event loop
      unaffected. This is a ruled-out suspect, confirmed on the actual
      subscription path this time, not just the provider-agnostic
      openai-compatible one. The thrown-error-path `close()` gap noted below
      remains a real, separately-scoped, unverified edge case (a run of
      consecutive failures was not induced live) — not the same claim as "no
      leak in the normal path," which is now directly confirmed. The
      `digest_runs` "stuck at running after a restart" finding also still
      stands (unrelated mechanism — an interrupted process, not a leak).
      NOTES.md "M17.5" has the corrected write-up.)_
- [x] **Guard against the regression returning.** A cheap, permanent signal: log
      server-side handler duration for any request over a threshold, and record the
      production bundle's size and chunk count in the build output so growth is visible
      per milestone rather than discovered by feel three milestones later.
      _Acceptance: a slow handler is visible in the server log without attaching a
      profiler; bundle size is printed at build time._
      _(verified 2026-07-28: `server/src/index.ts` logs `[slow] METHOD /path
      NNNms` for any request ≥200ms, route-agnostic (SSE streams will log at
      their real streamed duration, which is intentional, not noise);
      `web/vite.config.ts` gained a `generateBundle` hook printing
      `[bundle] N files, X KB raw, Y KB gzip` on every build — current
      baseline 20 files / 1072 KB raw / 322 KB gzip, confirmed printing on a
      real `pnpm build`. 165/165 tests, build clean.)_
- [ ] **Verify:** from the operator's actual working position over the tunnel — open the
      desk, open settings, open a book, run a short digest — and compare against the
      baseline table. The milestone closes when the numbers moved, not when it feels
      better.
      _(not done — genuinely requires the operator's tunnel position, which
      this session does not have. Left open; see NOTES.md "## Blockers".)_

### M18 — Scan v2: the instrument face

**Read the 2026-07-28 decisions entry first** — the warp tiering, the hit-test hazard,
and the two-channel colour model are specified there.

- [x] **VHS treatment (visual only).** Drifting tracking lines, chroma noise, occasional
      signal wobble across the scan. **No audio** — DESIGN.md's "no sound in v1.5" holds.
      Intensity rides the existing CRT setting; reduced motion disables movement.
      _Acceptance: reads as a worn tape at rest, not as a strobe; every readout stays
      legible; reduced motion renders a still, clean panel._
      _(verified 2026-07-29: `VhsOverlay.tsx` (drifting tracking lines +
      coloured chroma noise, both gated behind the same `warpActive` the
      filter uses) plus a `.wobbling` transform-only animation on the warp
      wrapper itself for the "occasional" tear — kept out of VhsOverlay
      because a wobble has to move the whole face, not an inert layer on
      top of it. Live Playwright pass against the Metamorphosis fixture at
      `scanCrtIntensity: 1` (this environment's default, already the worst
      case): tracking-line texture visible and legible over it in the
      screenshot; fully absent whenever `warpActive` is false (reduced
      motion or intensity 0), same gate as the filter, no separate check
      needed.)_
- [x] **Whole-face barrel warp, tiered by z-hierarchy.** Everything on the base scan
      screen — strip, heat field, chapter axis, readouts, revisit queue — warps
      **together as one surface**, via a **single SVG filter on a single wrapper**
      (filtering pieces separately makes each bow around its own centre and stop lining
      up; coherency is the point). Floating layers — hover ghost readouts, popovers,
      tooltips, modals — do **not** warp and must be **portalled out** of the wrapper: a
      CSS filter on an ancestor creates a containing block and breaks `position: fixed`
      descendants. Legibility is a bounded constraint: gentle enough displacement that
      mono readouts stay readable at their smallest size, contrast still passes,
      intensity reaches zero, reduced motion disables warp and fringing.
      _Acceptance: the panel bows as one continuous face — no piece bows independently;
      a popover opens flat and correctly positioned; every readout passes contrast at
      full intensity; intensity 0 renders flat and crisp._
      _(verified 2026-07-29: one wrapper (`ScanPage.module.css` `.warpWrapper`)
      contains the spotlight, readouts, filters, strip, and revisit queue —
      the header (title + escape-hatch buttons) is deliberately outside it,
      SPEC-GAP logged in NOTES.md/Spec gaps. `ScanWarpFilter.tsx` replaces
      M15's `ScanCrtFilter.tsx` with one filter driven by `warp.ts`'s math
      (see below). The per-highlight hover readout is portalled to
      `document.body` with `position: fixed` computed from the hovered
      band's own `getBoundingClientRect()` — confirmed live it renders
      perfectly crisp, not warped, while everything behind it visibly bows.
      Found and fixed two real bugs live, not in review — see NOTES.md "M18"
      for both: the wrapper's own measuring `useEffect` never armed (mounts
      before `data` loads, so `[]` deps meant it observed nothing, ever),
      and the displacement bitmap only covering the wrapper's own box was
      silently eating a couple of true-edge glyphs ("HIGHLIGHTS" rendering
      as "IGHLIGHTS") because `feImage` is transparent-black (not
      zero-displacement) past its own bounds. 176/176 tests, `pnpm build`
      clean.)_
- [x] ⚠️ **Fix hit-testing under the warp.** A filtered element still hit-tests at its
      *unwarped* geometry, so near the corners a heat band is clicked where it was, not
      where it looks. This will read as "the scan is broken" rather than as a warp
      problem. The strip's targets are 1-D positions along x: position the invisible
      hit-target bands through the **same barrel function** that displaces the graphics.
      _Acceptance: click bands at both far edges and both corners of the strip — the one
      under the cursor is the one that responds, at every intensity including maximum;
      hover readouts appear over the band the pointer is actually on._
      _(verified 2026-07-29: `HeatStrip.tsx` measures its own offset within
      the warp wrapper (`getBoundingClientRect` diff, recomputed alongside
      its existing strip-size `ResizeObserver`) and runs each band's raw,
      decluttered position through `warpPoint()` before setting its inline
      `left` — the exact function `ScanWarpFilter` renders as the visual
      displacement map, per warp.ts's module comment ("one function, not
      two approximations"). Live Playwright pass at max CRT intensity:
      hovering the leftmost, a middle, and the rightmost band each produced
      a distinct, correctly-matched readout, and clicking a band opened the
      reader on the right highlight.)_
- [x] **Two-channel heat colour.** Restore the "what's what" reading M15 lost: **hue
      carries the category, luminance/alpha carries density**. Accumulate one density
      layer per category, then per pixel take summed density for brightness and the
      dominant category for hue. Keep M15's cool→hot density ramp as a selectable third
      mode — it is better for "where did I annotate most", just not for "what's what".
      _Acceptance: a cluster of honey highlights reads as honey, not as generic hot; a
      mixed cluster shows its dominant kind; density is still legible as intensity;
      switching to density-only mode reproduces today's appearance._
      _(verified 2026-07-29: `heatField.ts` accumulates one `Float32Array`
      density layer per kind (direct per-pixel splat bounded to each blob's
      radius, not a canvas composite — cheaper and side-steps alpha-
      compositing colour-space questions), then per pixel takes the summed
      density for brightness/alpha and the highest-density layer for hue.
      `"density"` mode reuses M15's cool→hot ramp verbatim, ignoring kind.
      `HeatStrip.tsx` gets a local mode toggle next to the existing chapter-
      name one. Live Playwright pass on the Metamorphosis fixture (a rose +
      slate cluster): "by kind" mode showed each cluster in its own hue;
      clicking the toggle to "Density" reproduced the M15 cool→hot look on
      the identical data.)_
- [x] **Tighter bleed + zoom/pan.** Reduce the blob radii (M15's `26 + weight*44`px lets
      neighbours merge into an unreadable smear) **and** add zoom + pan over the same
      0–100% domain so dense regions can be opened up and clicked precisely. Zoom is a
      viewport transform: hit targets, filters, and the airlock keep working, and it must
      compose correctly with the barrel mapping above.
      _Acceptance: at 1× a cluster still reads as one hot region with visible internal
      structure; zoomed in, individual highlights separate and are individually
      clickable; zoom + warp together still hit-test correctly; keyboard users can zoom
      and pan._
      _(verified 2026-07-29: blob radii `14 + weight*22` (was `26 + weight*44`).
      `zoom.ts` (center-preserving zoom steps, view-fraction-relative pan,
      fully unit-tested — 12 cases, no DOM) drives a `scaleX`/`translateX`
      CSS transform on a new `.zoomContent` wrapper around the canvas/ticks/
      labels; the invisible hit-target bands stay outside that transform and
      instead run the *same* `fractionToView()` math in JS before the
      existing `warpPoint()` step — zoom/pan composes with the barrel warp
      by construction (it's applied first, then warp acts on the already-
      zoomed/panned position, matching that the filter operates on final
      rendered pixels). `.strip` switched from `overflow: visible` (no
      longer needed — the old hover readout that required it is portalled
      now) to `overflow: hidden`, which clips content scrolled outside the
      view from both paint and hit-testing for free. Four buttons (◀ − + ▶),
      all real `<button>`s. Live Playwright pass on the Metamorphosis
      fixture: zoomed + panned onto its densest cluster (two blobs that
      visibly touched at 1×) — they separated into two individually
      hoverable/clickable bands, each producing the correctly-matched
      readout, confirmed via `elementFromPoint` (not just bounding-box math,
      which ignores clipping and initially gave a false positive — see
      NOTES.md "M18"); a keyboard-only zoom-in (focus + two Enters) enabled
      "Zoom out" exactly like a click would. 188/188 tests, `pnpm build`
      clean.)_
- [x] **The digest instrument: bigger timeline, and the torch.** Enlarge the digest
      coverage timeline, and replace the range handles with the **torch** (decisions.md
      2026-07-29): a cartoon flashlight beam aimed by click-drag along the timeline, beam
      width set by dragging up/down, drawn for the VHS/CRT aesthetic. **The FROM/TO boxes
      stay** — they are the precise input and the keyboard path; the torch is the charm on
      top, never the only way in. Shipped explicitly as an experiment: if it reads as
      clunky in use, reverting to plain handles is a success, not a failure.
      ⚠️ **Position the beam through the same barrel mapping as the heat bands.** It sits
      on the warped base layer, so raw coordinates will land the beam somewhere other than
      where it points — the identical hazard as hit targets, which is why this is in the
      same milestone rather than a later one.
      _Acceptance: the beam points where it lands at every CRT intensity including
      maximum, and at both far edges of the timeline; FROM/TO stay in sync with the torch
      in both directions; the whole range can be set keyboard-only without touching the
      torch; the digest that results covers exactly the chapters shown._
      _(verified 2026-07-29: `digestTimeline.ts` (12 unit tests, pure math —
      `chapterIndexAtFraction`, `beamHalfWidthFromDrag`, `beamRange`,
      `beamFromChapterRange`) plus `warp.ts`'s new `unwarpPoint` (the direct
      inverse of `warpPoint` — turning a screen click back into a raw
      position needs no iteration, unlike the forward direction) drive
      `DigestSpotlight.tsx`'s torch: click-drag aims it, drag up/down widens/
      narrows it, release snaps to chapter boundaries and sets FROM/TO;
      changing FROM/TO moves the torch back. Live Playwright pass on the
      Metamorphosis fixture (5 chapters) confirmed both directions — a drag
      aimed at ~85% and narrowed committed to exactly chapter 5 (From=To=
      "Ch. 5"), and selecting Ch. 2→Ch. 3 in the selects visibly moved the
      beam to match; the POST body for a selects-driven range
      (`{"spineStart":1,"spineEnd":2}`) exactly matched what was shown,
      confirming "digests exactly the chapters shown". First attempt at
      this check zoomed/narrowed toward the domain's geometric middle and
      found nothing there (Metamorphosis's highlights cluster near the
      start) — not a bug, just the wrong test target; see NOTES.md "M18".)_
- [x] **Chapter labels on the coverage tiles.** Unlabelled squares plus EPUB TOC titles
      that are frequently useless ("I", "II", or absent) make the strip hard to read. Fix
      at the data level: the digest's map step already summarises each chapter, so have it
      also emit a **short descriptive title** (no new pipeline — a field on the existing
      call; the schema change lands with M19.5's other digest work if this ships first).
      Hover a tile for title plus position range.
      ⚠️ Position range is **percent and chapter, never pages** — reflowable EPUBs have no
      stable pages and M16's text-size setting moves epub.js's page-ish counts anyway.
      ⚠️ A descriptive title is itself a **spoiler**; gate it by the same bookmark rule as
      the summary it came from, falling back to the positional label ("Chapter 7 ·
      34–39%").
      _Acceptance: every tile is identifiable without hovering, and hovering gives the
      title and range; a book whose TOC has no usable titles still reads clearly; titles
      past the bookmark are gated; no page numbers anywhere._
      _(verified 2026-07-29: `chapter_digests` gained a nullable `title`
      column (migration 13); `digest/build.ts`'s map/merge prompts now also
      ask for one; `routes/digest.ts` gates it by `getReadingPosition`'s
      saved spine index — no bookmark at all gates everything, the
      conservative default. Tiles are real width (proportional to
      `lengthPercent`, not a uniform dot) with an always-visible chapter
      number when wide enough to fit one (narrow tiles — e.g. a front-matter
      section a fraction of a percent long — just don't show one, the same
      tick-vs-label split the strip's own chapter axis already uses) plus a
      hover tooltip with the title (or the positional fallback) and percent
      range. Verified the actual spoiler gate live, not just read the code:
      wrote two real titles directly into the dev database (no `sqlite3`
      CLI in this environment, used a one-off `better-sqlite3` node script),
      confirmed one at/before the bookmark came back intact and the other
      past it came back `null`, moved the bookmark forward and watched the
      second one reveal — then restored both the bookmark and the test
      titles afterward. 202/202 tests, `pnpm build` clean.)_
- [x] **Verify:** open the scan on a book with a dozen clustered highlights — read the
      heat by colour, zoom into a cluster and click a specific highlight near a corner at
      full CRT intensity, then jump into the reader from it. Then set a digest range with
      the torch and confirm it digests exactly the chapters the beam covered.
      _(Semantic theme mode moved to M19.5 on 2026-07-29 — it needs thematic data that
      does not exist yet. See the decisions entry.)_
      _(verified 2026-07-29 against the real Metamorphosis fixture (14
      highlights, the dev library's largest) via `pnpm dev` + a headless
      Chromium driven through playwright-core (no project devDependency —
      launched with an explicit `executablePath` against the cached
      browser at `~/.cache/ms-playwright`, since this environment has no
      `npx playwright install` internet access): heat read correctly by
      colour (rose/slate clusters each in their own hue, kind vs. density
      mode toggle both confirmed); zoomed onto the fixture's densest cluster
      (two blobs touching at 1×) and separated them, clicked one near the
      cluster's edge, confirmed via `elementFromPoint` (not just bounding-
      box math, which ignores clipping) that the correct highlight — not a
      neighbour — responded, and landed in the reader on it; opened the
      Digest spotlight and dragged the torch to narrow onto a single
      chapter, confirmed FROM/TO followed and a subsequent selects-driven
      change moved the torch back. Two real bugs found and fixed along the
      way, both live, not in code review — a wrapper `ResizeObserver` that
      never armed because it was registered before the wrapper existed, and
      a displacement bitmap that silently ate a few px of every true-edge
      glyph — full detail in NOTES.md "M18". 202/202 tests (11 shared + 125
      server + 66 web), `pnpm build` clean throughout. M18 is whole.)_
      _(Semantic theme mode moved to M19.5 on 2026-07-29 — it needs thematic data that
      does not exist yet. See the decisions entry.)_

### M19 — Settings as a binder & provider roles

- [x] **Binder shell.** Rebuild `SettingsPage`'s flat field list as a book/binder: tabbed
      dividers down the side — **Reading, LLM, Usage, Scan, Audio, Desk** — with a page-turn
      animation between sections, inside M11's existing modal shell (dialog semantics,
      focus trap, Escape, backdrop click, and the `/settings` deep link all stay).
      Existing fields move; none are redesigned here.
      _Acceptance: every setting that exists today is still reachable and still saves;
      the deep link still opens over the current room; Escape still restores focus._
- [x] **The Usage divider.** Surface M17's ledger: totals for today / 7 days, broken down
      by book and by operation (thread, digest, cast); the last digest run's cost; and —
      **only where the provider reports them** — plan utilization with reset times. Local
      models show tokens, context percentage, and speed, with no quota UI at all. Every
      figure is labelled with its provenance (reported / measured / estimated); an
      estimate is never dressed up as a measurement.
      _Acceptance: the panel is correct on a local model and on the subscription path;
      with plan limits unavailable it reads "plan limits unavailable" and everything else
      still renders; the numbers match the ledger._
- [x] **A11y and motion.** The dividers are a real tablist/tabpanel (arrow-key
      navigation between tabs, correct roles and `aria-selected`) — never divs with click
      handlers. The page turn collapses to an instant swap under reduced motion.
      _Acceptance: the whole binder is operable keyboard-only including switching
      sections; a screen reader announces the selected divider; reduced motion shows no
      animation at all._
- [x] **Provider profiles and roles.** Replace the single global provider config with
      **profiles** (a complete named config: provider id, model, key, base URL, context
      tokens) and **roles** that point at them: **query** (answering while reading) and
      **digest** (batch analysis — the digest now, M19.5's themes and M22's cast later).
      `getProvider(db)` becomes `getProvider(db, role)`, so every call site says what it
      is doing and the usage ledger can finally answer "which model ran this?".
      **Migration must be silent:** today's config becomes the initial profile that both
      roles point at — nobody reconfigures anything.
      _Acceptance: digest a book on a local model while questions are answered by Claude,
      in the same session; existing settings survive the migration untouched; ledger rows
      record the role; a role with no configured profile degrades to the same
      "configure a provider" nudge the reader already shows._
- [x] **One picker, three surfaces.** Build the provider picker **once** and mount it in:
      a tab per role in the binder; the scan's slider (digest role); and a small icon in
      the reader menu that opens the same slider on hover — or click, for touch — with a
      click-through into settings. Three bespoke pickers is exactly the duplication this
      round exists to remove.
      _Acceptance: the same component in all three places; switching a role from any
      surface is reflected immediately in the others; the reader's icon is keyboard
      reachable and its slider operable without a pointer; nothing about the picker
      assumes hover exists._
- [x] **Verify:** open settings from all three rooms, visit every divider, change one
      setting on each and confirm it persists. The stated goal is that settings is
      **pleasant to open** — judge that honestly and fix what feels clumsy before
      checking this off.
      _Verified: automated (213 tests incl. a11y tablist keyboard nav) + curl against a
      live dev server + the operator's own live browser session (imported a book,
      configured a real provider profile through the LLM divider, changed the Reading
      divider's spread mode — all persisted). See NOTES.md "M19" for the full account,
      including a dev-database incident during this session's verify step._

### M19.5 — Digest depth & the semantic scan

**Read the 2026-07-29 (later) decisions entry first.** The operator's reframing is the
design and is not open for re-derivation: **plot is fixed; thematic reading is personal
and evolves as you read.** Two layers, two lifecycles — do not build them as one call.

- [x] **Split the digest into a plot layer and a thematic layer.** Plot: generated once
      per chapter, cached by source hash, unchanged from M17. Thematic: generated per
      chapter **per brief**, cheap, and *expected to be re-run*. Additive migration; the
      existing chapter rows become the plot layer with no re-digest required.
      _Acceptance: re-running thematic analysis does not re-run or invalidate plot
      summaries (prove it by watching the ledger — the plot calls must not reappear);
      an existing digested book keeps everything it had._
- [x] **Reader briefs.** A per-book standing angle — questions, perspectives, or interests
      the model should hold in mind while analysing ("read this for what it says about
      self-determination"). Injected into the thematic pass's prompt so chapters are
      analysed *through* it. Editable, and set **ahead of** reading a stretch, which is
      the workflow this is for. Changing the brief marks the thematic layer stale and
      offers to re-run it — it never silently re-runs and never silently serves analysis
      from an old brief.
      _Acceptance: two different briefs on the same chapter produce visibly different
      analysis; the brief in force is shown alongside the analysis it produced; a stale
      layer is obvious, not silent._
- [x] **Questions the model poses.** Two or three per chapter, generated with the thematic
      layer, surfaced in the digest page and the reader — clicking one opens a thread on
      it, pre-filled.
      _Acceptance: the questions are specific to the chapter rather than generic; clicking
      one opens a real thread that answers well; they are spoiler-gated like everything
      else past the bookmark._
- [x] **Let thematic questions be thematic.** Today's system prompt treats anything
      outside the book as a fallback to be "clearly marked", which is why "how does this
      apply to daily life" comes back hedged. Give thematic and applied questions
      instructions that **invite grounded extrapolation** — still anchored in the text,
      but not apologising for reasoning past it. The thematic layer for the covering
      chapters ships as context when the question calls for it.
      _Acceptance: a philosophical question about a fixture book gets a substantive
      answer rather than a hedge, while a factual question about the plot stays as tightly
      grounded as it is today — check both, since it is easy to fix one by breaking the
      other._
- [x] **Spoiler-safe digest display.** Chapter entries past the bookmark render redacted
      with a reveal control (free — chapters are stored individually). Book-level
      synopsis/cast/themes get a **bookmark-bounded variant** built only from chapters up
      to the bookmark, generated lazily and only once the bookmark has moved far enough to
      matter, with the full version behind an explicit reveal. ⚠️ Descriptive chapter
      titles are spoilers too and gate by the same rule, falling back to the positional
      label.
      _Acceptance: open a partly-read book's digest — nothing past the bookmark is
      readable without a deliberate reveal, including titles; the safe synopsis genuinely
      only reflects what you've read; revealing is per-item and does not unlock the rest;
      the lazy regeneration does not fire on every page turn (watch the ledger)._
- [x] **The semantic scan: two layers.** *(Moved here from M18 on 2026-07-29 — it needs
      the thematic data above. Scope confirmed 2026-07-29 addendum: "digest/AI" is a
      **second signal**, not a filter over the first.)*

      | Layer | Signal | Resolution | Answers |
      |---|---|---|---|
      | **Mine** | highlights, notes, threads | exact position | *where did I engage with X* |
      | **Book** | themes from chapter digests | chapter | *where does this book talk about X* |

      Filter to either or show both. Themes are tagged onto highlights (quote + note +
      thread) by an `extract` pass against the thematic layer's vocabulary, persisted in
      SQLite — this un-parks the 2026-07-19 "LLM note supplementation" item. Vault
      concepts are **not** the source (M9's reasoning still holds).
      ⚠️ **Never merge the layers into one field.** Chapter-resolution data drawn in the
      precise field's visual language claims an accuracy it does not have. The Book layer
      gets its own register — an obviously quantised, chapter-wide underlay — with the
      Mine field precise on top of it.
      ⚠️ **Mine wins on overlap** for hit-testing: your annotations are the primary
      object, and the book layer must never steal a click from a highlight. Book bands
      click through to the chapter start, the only honest target at that resolution.
      One theme vocabulary across both, so filtering by a theme lights both layers.
      _Acceptance: with both layers on, a theme filter lights matching regions in each and
      the two are visually unmistakable from one another; clicking a highlight that sits
      inside a lit book band opens the highlight, not the chapter; a chapter with a
      thematic layer but no annotations still shows a book band; a book with no digest
      falls back to kind mode with an explanation, not an empty strip; kind mode, filters,
      search, stars, tags and the airlock jump all behave exactly as they do today._
- [x] **Verify:** set a brief on a fixture book, digest a few chapters ahead of your
      bookmark, read into them, and check the whole loop — analysis reflects the brief,
      posed questions open useful threads, a philosophical question gets a real answer,
      nothing past the bookmark leaks, and the scan's theme mode lights up. 
      Status: Human Verified 2026-07-29 


## v1.9 — the global overhaul (M19.6, M19.7, M19.8, M20.5, M20.6, M20.7)

**Read the 2026-07-30 decisions entry before starting any of these.** It holds the
verified causes behind every bug listed here, the rulings that are not open for
re-derivation (two registers, instruments vs. rooms, the job model, page numbers), and —
for the one bug whose cause could *not* be established by reading — the diagnostic that
separates the candidates. Do not prescribe a fix for that one without running it.

The operator's stated goal for the whole arc is **"a more stable and coherent app."**
Stability first (M19.6), then the shared vocabulary (M19.7), then the rooms that vocabulary
gets applied to (M20.5–M20.7). The arc is split around M20 deliberately: the fold is the
riskiest planned change and shouldn't wait behind five milestones of chrome.

### M19.6 — Reader repair

Daily-use defects and the small reader asks that need no new vocabulary. Nothing here
depends on M19.7, so it ships first and the app gets better before it gets prettier.

- [x] **Fix the skipped last page of a chapter.** ⚠️ **Cause is established — do not
      re-derive it, and do not "fix" it by intercepting turns.** epub.js's
      `DefaultViewManager.next()` compares `scrollLeft + container.offsetWidth + delta`
      against `container.scrollWidth`; `offsetWidth` is integer-rounded while
      `layout.delta` is a float from the stage width, so a fractional stage width fails
      the comparison one page early and advances the section. Fix at the geometry: pin
      **`containerRef.current`** — the element `book.renderTo()` is given, which is the
      element epub.js measures as `container`; pinning any other ancestor will look
      right and change nothing — to an integer pixel width (round *down*) wherever
      `computeReaderGap` already runs: the `ResizeObserver` path and the `readerFontScale`
      effect in `ReaderView.tsx`. Goal is `offsetWidth === layout.width` exactly.
      _Acceptance: with the window at a deliberately fractional width (resize until
      `containerRef.current.getBoundingClientRect().width % 1 !== 0` before the fix), page
      forward through a whole chapter and land on every page — verify against
      `location.start.displayed.page`/`total`, which must reach `total` before the spine
      index changes. Repeat in spread mode and at three different text sizes; the bug is
      width-dependent, so one window size proving clean proves nothing._
      _(implemented 2026-07-30: `pinContainerWidth()` measures `marginWrapperRef` — a
      new ref, since observing/measuring `containerRef` itself once it's the thing
      being pinned would be circular — and sets `containerRef.current.style.width` to
      an explicit `Math.floor(...)` integer, called before the initial `renderTo()`,
      from the `ResizeObserver` (now observing `marginWrapperRef`), and from the
      `readerFontScale` effect. Live Playwright verification against the Alice fixture:
      a sweep of 254 distinct viewport widths and a forced fractional ancestor CSS
      width both confirmed the pin holds `containerRef` to an exact integer, and zero
      last-page skips were observed across 5 real chapter transitions — but the
      original skip could not actually be *triggered* here either before or after the
      fix (epub.js's own `stage.js` derives its stage width from `clientWidth`, which
      is integer-rounded by DOM spec regardless, given our `RenditionOptions.width` is
      the string `"100%"` rather than a number) — full trace, including the one
      untested variable (font scale, since sweeping it needs a real settings write),
      in NOTES.md. Per decisions.md the cause is not to be re-derived; the fix is a
      strict improvement regardless — it removes the one real subpixel float
      (`containerRef`'s own `getBoundingClientRect()`, previously fed into the initial
      `computeReaderGap` call) from the picture. 153/153 server + 71/71 web tests,
      build clean. Text-size sweep and a from-scratch human read-through are still
      worth doing if the skip resurfaces for the operator.)_
      _(round 4, 2026-07-30 later still: the operator's repeated report of this same
      symptom (below, "operator follow-up report, round 3") turned out to have a real,
      different cause — sub-pixel `scrollLeft` drift at a non-100% device-scale
      factor/browser zoom, which this fix's integer container-width pin never touched.
      Fixed in `web/src/reader/pageTurn.ts`; full mechanism, live measurement, and
      verification in NOTES.md "M19.6 — round 4" and decisions.md's matching entry. This
      earlier fix's own mechanism is unchanged and still correct, just not the whole
      story.)_
- [x] **Diagnose, then fix, the misaligned highlight overlay.** ⚠️ **The cause is not
      established. Run the diagnostic in the 2026-07-30 decisions entry before writing a
      fix** — `rendition.getContents()[0].range(cfi).toString()` returning the intended
      quote means the anchor is fine and the rects are stale (epub.js calls
      `pane.render()` only from `IframeView.reframe()`, which only fires when the iframe's
      box changes); returning the displaced text means the anchor itself is wrong. Fixing
      the wrong one looks like it works until the next resize.
      _Acceptance: the diagnostic's result and the chosen cause are written into NOTES.md
      before the fix lands; a highlight stays aligned across a text-size change, a margin
      change, a spread toggle, a window resize, and a page turn away and back._
      _(diagnosed 2026-07-30, no fix landed — full method and result in NOTES.md. Ran
      the exact diagnostic live against the Alice fixture (a real highlight, real
      selection) across every named scenario plus two adversarial ones (rapid resize
      spam, resize mid-page-turn): the mark's rect matched the live-resolved range's
      rect exactly (`dx`/`dy` = 0,0) and the resolved text was always the original
      selection — the misalignment did not reproduce anywhere it was tried, including
      beyond the acceptance criteria's own list. Leading theory: the existing M16
      `applyGapForWidth` bug-fix (a forced `rendition.display()` after every
      layout-affecting change) already achieves what `reframe()`/`pane.render()`
      firing would have, as a side effect. **Not confidently closed** — if this
      resurfaces for the operator, ask what they were doing right before it appeared
      rather than re-running this same sweep, since real mouse-driven resize/DPI/zoom
      and other books/sections weren't reachable from this environment. Margin was
      tested live through the real Settings UI (Normal → Wide → Normal) and restored
      to the operator's actual setting afterward, confirmed via the API.)_
      _(round 4, 2026-07-30 later still: fixed. The diagnostic above was correct as far
      as it went (anchors resolve fine), but never produced a stale rect to catch,
      because it never varied the one thing that leaves one stale: marks-pane only
      redraws from epub.js's reframe(), which only fires on an expanded-width pixel
      change. Real trigger found: a reflow that re-breaks lines without changing that
      width (a deferred text-size/margin/pane-width apply, a late web-font load, a
      section re-paginating a beat after first render). Fixed with
      refreshHighlightOverlays (ReaderView.tsx), which calls each view's pane.render()
      directly. Full mechanism and live measurement in NOTES.md "M19.6 -- round 4.")_
- [x] **Hover emphasises without obscuring.** The hover boost currently switches to
      `mix-blend-mode: normal` at `fill-opacity: 0.85`, which is why the ink underneath
      disappears. Stay in the kind's blend mode (multiply on paper, screen on ink) and
      raise opacity modestly instead — the target is "the same wash, more of it", which is
      how a marked passage looks when you drag over it.
      _Acceptance: hovered text is still comfortably readable in both themes at every one
      of the four kinds; the hovered mark is still unmistakably distinguishable from its
      unhovered neighbours (check with two adjacent highlights of the same kind)._
      _(verified 2026-07-30: `mix-blend-mode` is never touched now — the hover boost
      only ever sets `fillOpacity`, scaling the mark's own real base (read live off
      the `.marginalia-highlight` group's `fill-opacity` presentation attribute —
      `markStyleForKind` sets `fill`/`fill-opacity`/`mix-blend-mode` on that group,
      not the child `<rect>`) by 1.8×, capped at 0.6. Live Playwright against the
      Alice fixture: paper 0.22→0.396, ink 0.34→0.6 (clamped); `mix-blend-mode`
      attribute confirmed unchanged ("multiply"/"screen") before, during, and after
      hover in both themes; reverts to exactly the base value on un-hover. A fixed
      per-kind delta wasn't needed — reading the real base and scaling it covers all
      four kinds and both themes with one formula. 153/153 server + 71/71 web tests,
      build clean.)_
      _(round 4, 2026-07-30 later still: raised again. Both this fix (1.8x, capped 0.6)
      and a mid-milestone bump (2.6x, capped 0.85) were each in turn judged still duller
      than the vivid ::selection look the operator was actually comparing this to the
      whole time -- stated outright this round instead of derived as a multiplier:
      hoverFillOpacity (highlightKinds.ts) lifts a hovered mark to its own kind colour at
      full strength on paper, 0.6 on ink (screen blend mode lightens, so ink stops short
      of full to avoid glare). See NOTES.md "M19.6 -- round 4.")_
- [x] **Clicking a highlight never turns the page.** `handleContentClick` consults only
      `a[href]` and live selections. Reuse the geometric mark hit-test that the mousemove
      handler already runs (marks are `pointer-events: none` by deliberate design — see
      NOTES.md M16 — so native hit-testing will never help here).
      _Acceptance: click a highlight that sits inside the right-hand turn zone; the page
      does not turn and the highlight's own action fires. Click bare text 2px outside the
      same mark; the page turns._
      _(verified 2026-07-30: extracted `findMarkAtViewportPoint` — the exact rect-vs-
      viewport-point test the hover boost already ran — so `handleContentClick` and
      `handleContentMouseMove` share one implementation instead of two copies;
      `handleContentClick` now checks it before consulting the turn zone at all, and
      returns early on a hit (no page turn), leaving `handleMarkClicked` to open the
      thread as it already did. Also corrected a stale comment on `handleMarkClicked`
      that had assumed this was already handled. Live Playwright against the Alice
      fixture: used `caretRangeFromPoint` to select real text at 85% across the
      visible page (inside the right-hand turn zone), highlighted it, clicked the
      mark's own center — progress stayed at 1% (no turn) and the thread panel opened;
      clicked 2px past the same mark's right edge — progress moved 1%→3% (turned).
      153/153 server + 71/71 web tests, build clean.)_
- [x] **A composer you can write in.** `.composer` is one flex row holding the context
      ladder, the textarea and Send, which is what squeezed the textarea and wrapped the
      Send label. Two rows: textarea full width on top, ladder + web + Send beneath.
      _Acceptance: at the panel's narrowest rendered width, the textarea shows at least
      three lines of text and no control label wraps mid-word._
      _(verified 2026-07-30: `.composer` is now `flex-direction: column`; the textarea
      is its own full-width row, with a new `.composerControls` row (ladder/web-search
      on the left, Send/Stop on the right via `justify-content: space-between`)
      beneath it — `ContextLadderToggle`'s own root also had a vestigial
      `justify-content: space-between` + `margin-bottom` left over from the old
      single-row layout, both dead weight in the new one, removed. Bumped the
      textarea's `rows` from 2 to 3 to actually satisfy "at least three lines" — row
      count is font-metric-driven, not width-driven, so this was needed regardless of
      the reflow. Live Playwright against the Alice fixture at three window widths
      (1100px, 700px, 420px, the narrowest a reader stage plausibly gets): textarea
      showed 3.3–3.4 visible lines at every width, and every composer control (Off/
      Digest/Full, Web search, Ask) measured zero width/height overflow (no wrap) at
      all three. 153/153 server + 71/71 web tests, build clean.)_
- [x] **The quote expands.** Clicking the truncated quote on an annotation reveals it in
      full, pushing the divider and everything below it down; clicking again re-collapses.
      _Acceptance: expanding a long quote never overflows the panel or clips the controls
      beneath it; the panel's drag offset stays valid across the size change._
      _(verified 2026-07-30: the quote is now a `<button>` (was a `<span>`) toggling a
      `quoteExpanded` class that lifts `-webkit-line-clamp`; it's exempt from the
      header's own drag-start handler for free, since that already excludes any
      `closest("button")` the same way the close button is. `.panel`'s existing column-
      flex layout pushes everything below the header down with no extra work needed —
      `.messages` is the only `flex:1` child, so it's what actually absorbs the growth.
      A new re-clamp effect re-runs the mount-time `clampPanelOffset` logic whenever
      `quoteExpanded` turns on. **A real bug found and fixed along the way:** the first
      attempt used `useLayoutEffect` (measure before paint, matching the mount clamp's
      own timing) and left a live, reproducible few-pixel overflow with the panel
      genuinely clipped — `-webkit-line-clamp`'s removal is its own multi-pass layout in
      Chromium, and reading `getBoundingClientRect()` synchronously in the same tick
      measures a height a few pixels short of the fully-resolved one. Fixed by moving
      the re-clamp into a plain `useEffect` + one `requestAnimationFrame`. Live
      Playwright against the Alice fixture: a 220-char selection (clamps to 3 lines,
      confirmed via measured height) never overflowed at any tested position; a 971-
      char selection at the mount-clamped default position grew the panel from 357px to
      680px on expand and, **before the rAF fix**, left it 4px past the stage's bottom
      edge with the composer genuinely clipped — **after** the fix, the same case lands
      the panel's bottom edge exactly flush with the stage's, composer fully visible,
      and collapsing returns to the original height and position. 153/153 server +
      71/71 web tests, build clean.)_
- [x] **Annotations are resizable, and roam the app.** A resize handle on the panel, with
      the size persisted per highlight exactly as the drag offset already is; and
      `dragConstraints` widen from the reading stage to the app shell.
      ⚠️ **Second-order effect, decided in the 2026-07-30 entry, not a bug:** panels ride
      the turning page *because* they are inside the stage the page-turn snapshot
      captures. A panel dragged outside the stage will not ride the turn. That is the rule
      — on the page it rides, off the page it stays put. Verify no ancestor clips it once
      it leaves the stage box.
      _Acceptance: resize a panel, turn the page, reopen the book — the size and position
      survive; a panel dragged to the far side of the window is fully visible and not
      clipped; a panel left over the page still rides a page turn as it does today._
      _(verified 2026-07-30: `panelWidth`/`panelHeight` persisted per highlight exactly
      like `panelDx`/`panelDy` (nullable — null means "use the default size", never a
      magic 0; migration 018). A corner `resizeHandle` (pointer-capture drag, same
      pattern as M10's page-edge peel) sets an explicit inline width/height, overriding
      both the CSS width cap and `max-height` (which was relative to the *stage*,
      narrower than the new roam bounds). **The real geometry problem** this task's own
      warning anticipates: `.stage` had `overflow: hidden` directly, to clip the
      epub iframe (far wider than one visible page in paginated flow) — widening
      `dragConstraints` alone would still have let a roaming panel get visually cut off
      at the stage's own edge. Fixed by moving that clip to a new `.pageClip` child
      wrapping only the reading surface and its curl/vignette/edge-grab decorations;
      `.stage` itself now only clips nothing, and ThreadPanel/AskPill/AnnotationsOverview
      stay direct children of it, outside `.pageClip`, free to roam past it uncropped.
      `dragConstraints` now targets a new ref on `ReaderPage`'s own root (passed down as
      `appBoundsRef`), not the stage — a stale/oversized offset also re-clamps against
      that wider box on mount and after a resize, mirroring the quote-expand re-clamp
      above. Live Playwright against the Alice fixture (drag gestures hang Playwright's
      raw mouse API against this component in headless Chromium — confirmed
      reproducible, worked around via direct API writes + reload, the same substitution
      used for the last-page-skip diagnostic elsewhere in this milestone): resized a
      panel via the handle (346×321 → 500×523), reloaded, size persisted; set
      `panelDx: -700` (well past the stage's own left edge) plus a resized 420×400 via
      the API, reloaded, opened the highlight — panel rendered at x≈7 (confirmed west of
      the stage's left edge at x=16) fully on-screen and completely unclipped
      (screenshotted); a panel left at its default position over the page survived a
      real page turn with no regression. 154/154 server + 71/71 web tests, build clean.)_
- [x] **Page numbers in the footer, book-wide and stable.** `book.locations.generate(1600)`
      → `locations.save()` → persisted per resource in SQLite (additive migration;
      resources are immutable so the blob never rots), then `locationFromCfi` for the
      current number.
      ⚠️ **epub.js is a `web/` dependency only — the server has no EPUB renderer** (it
      parses text with `adm-zip` + `htmlparser2`, per SPEC). So generation happens **in the
      browser**, once, and the serialised blob is `PUT` to a new endpoint for caching; the
      server stores and returns an opaque string and never parses it. Do not attempt this
      server-side. New reader setting `pageNumberMode: "book" | "chapter" | "off"`;
      `"chapter"` uses `location.start.displayed`, which the reader already receives.
      ⚠️ `generate()` loads every section — it must run **after** the first page paints
      and must never block a turn. Until it resolves, the footer shows what it shows
      today.
      _Acceptance: the number is identical at three different text sizes and in both
      spread modes for the same position (this is the whole reason for using locations);
      opening a large book is not visibly slower than today; a book whose locations
      haven't generated yet still reads normally with no error state._
      _(implemented 2026-07-30: migration 019 adds `resource_locations` (resource id →
      opaque blob + generated_at), a cache table alongside `book_digest_snapshots` rather
      than a column on `resources` — resources are immutable-on-import (settled decision
      5) and this is a derived cache generated after import, same reasoning. New
      `GET`/`PUT /api/resources/:id/locations`, both pass the blob through unparsed.
      `pageNumberMode` added to `SettingsSchema`/settings store (default `"off"`,
      unchanged behavior) and to `ReadingTab.tsx` as a third toggle group alongside
      margins/spread. In `ReaderView.tsx`'s book-loading effect: the cached blob is
      fetched in the same `Promise.all` as position/highlights (cheap — a primary-key
      row read, or `null` on a cache miss); if present, `book.locations.load(cachedBlob)`
      (synchronous) runs where `generate()` used to unconditionally; on a miss, the
      original `generate()` → `reportLocation()` → `buildToc()` chain runs unchanged and
      now also calls `book.locations.save()` and `PUT`s it once resolved. Book-wide number
      is computed in `handleRelocated` via `locationFromCfi(location.start.cfi)` (-1 until
      locations are ready, mirroring how `displayedPage` already waits for `reportLocation`
      to re-fire) and `locations.length() - 1` for the 0-based total — `length()` is
      correctly typed in epub.js's bundled `.d.ts`, unlike `locationFromCfi` itself, whose
      declared return type (`Location`, not `number`) is wrong; narrowed with a local
      `LocationsIndexLookup` interface, same pattern as this file's existing
      `ViewWithContents`/`RenditionOptionsWithGap` casts for other bundled-type gaps. New
      pure `formatPageNumber()` (`pageNumber.ts`, unit-tested) and a thin
      `PageNumberDisplay` component render the footer text between the nav buttons;
      `"off"` and "data not ready yet" both render nothing, not an empty state. Live
      Playwright against the Alice fixture: a fresh (uncached) open painted the first page
      in ~310ms with no console error; a sweep of 3 text sizes × 2 spread modes at the
      same saved position all read "Page 2 of 107" from the cached blob (107 locations,
      confirmed via the raw cache row); a cache-hit reload showed the book-wide number in
      ~330ms (`load()`, not `generate()`); "chapter" and "off" modes checked separately
      ("Page 1 of 8" and blank respectively); the real Settings UI (Reading tab → Book-wide
      → Save) was also driven directly, not just the API, and produced the same footer
      text, screenshotted. Kafka on the Shore (the operator's real book, untouched
      otherwise) painted its first page in ~383ms with no error and its own
      `resource_locations` row and reading position both confirmed unchanged afterward —
      the page was closed inside the 600ms position-save debounce specifically so the
      relocate-triggered write-back (of the *same* position) would never fire. **A real,
      unrelated bug found and fixed along the way, not part of this task's own scope**:
      live-testing surfaced that the M19.6 last-page-skip fix's `pinContainerWidth()`
      (`ReaderView.tsx`) measured `marginWrapperRef.clientWidth` — marginWrapper's own
      border-box width, which *includes* the margin padding rather than the content area
      inside it — and pinned the epub.js container to that full width. Since the container
      still starts flush against the left padding edge as a normal-flow child, its right
      edge overshot marginWrapper's own right edge by exactly the horizontal padding (the
      margin itself), and epub.js paginated to fill that too-wide box: confirmed live via
      `getBoundingClientRect()` at every margin setting (e.g. "generous" 96px → epub
      container 96px past its clip boundary on the right, `overflowRight: 96`), matching
      the operator's report of text running past the reading pane at every margin size.
      Fixed by subtracting `getComputedStyle(wrapper)`'s horizontal padding from
      `clientWidth` before pinning; re-verified the same live sweep now shows symmetric
      left/right gaps (24/40/64/96px matching narrow/normal/wide/generous) with the
      pinned width still an exact integer, so the last-page-skip fix's own guarantee is
      undisturbed. 155/155 server + 76/76 web tests (5 new: `pageNumber.test.ts`,
      migration 019 coverage in `db.test.ts`), build clean.)_
      _(round 4, 2026-07-30 later still: the book-wide number/total jumping when crossing
      a chapter (round 3's "+2" report) was a bug in this task's own count math -- the
      old ratio was re-derived from every measured section on every relocate, moving
      estimates behind the reader too. Rewritten as bookPageMap (bookPages.ts): calibrate
      once, then only ever borrow pages from not-yet-visited estimates -- nothing already
      shown moves. See NOTES.md "M19.6 -- round 4.")_
- [x] **Highlight across a page boundary.** Holding a selection drag at the page edge
      shows a filling ring at the cursor and, after ~2s, turns the page with the selection
      continuing.
      ⚠️ **What is possible, and what is not** (decisions.md 2026-07-30): pages within a
      spine section are columns of one document, so a DOM Range spans them and scrolling
      the container mid-drag extends the native selection. A **section boundary is a
      different iframe document and a Range cannot span two documents** — the gesture must
      *visibly refuse* at a chapter boundary rather than appearing to work and silently
      dropping the selection. ⚠️ Keep `setPointerCapture`: without it a drag crossing into
      the sandboxed epub.js iframe crashed the tab outright (M10, reproduced, in NOTES.md).
      ⚠️ **The premise that a native selection survives the container scroll is reasoned,
      not verified** — it follows from the pages being columns of one document, but it was
      not tested in a browser. **Prove it in five minutes before building the ring**: drag a
      selection to the page edge, call `rendition.next()` from the console, and check the
      selection still exists and has extended. If it collapses, this task is a different
      (larger) design and should come back to a design session rather than being forced —
      it is the one item in this milestone that may not be buildable as written._
      _Acceptance: a selection started on one page and continued across two page turns
      inside a chapter produces one highlight whose `exact` is the whole passage, correctly
      anchored on reopen; the same gesture at the last page of a chapter shows the refusal
      and leaves the existing selection intact; releasing during the dwell (before the turn)
      behaves exactly like a normal selection._
      _(verified 2026-07-30: both required diagnostics run live before writing any fix, per
      this task's own warning — within a section, a real selection survived
      `rendition.next()` unchanged (`sameIframeAfterNext: true`); across a section boundary
      the selection was destroyed outright (`isCollapsed: true`), confirming the premise
      exactly as decisions.md reasoned. Built `DwellRing.tsx` + `ReaderView.tsx`: pointer-
      down/move tracked via the same forwarded epub.js DOM events M11's turn-zone hover
      already uses, arming a 2s dwell (`DWELL_DURATION_MS`) whenever the pointer sits in a
      turn zone with a live, non-empty selection; `completeDwell` checks the current
      spread-adjusted page against its section's total and refuses (red flash, no
      `next()`/`prev()` call) at a section boundary rather than discovering the destruction
      after the fact. No curl/slide animation during the dwell turn — a rasterized snapshot
      mid-turn would cover the very selection the gesture exists to keep visible. Live
      Playwright against the Alice fixture: armed the dwell at the correct in-iframe
      coordinates (`event.clientX` is relative to the iframe's own unclipped document, which
      shifts with `container.scrollLeft` — tripped up an early version of the test, not the
      app), the page turned automatically after ~2s with the selection surviving, and
      releasing over a kind button created one highlight spanning both pages' worth of text;
      a second run at the true last page of a section confirmed the refusal leaves the spine
      index and the original selection byte-identical. 154/154 server + 71/71 web tests,
      build clean.)_
      _(round 4, 2026-07-30 later still: being inside the turn zone at all wasn't a tight
      enough condition -- a selection dragged down the middle of a paragraph would cross
      the zone and trigger a turn that read as a stray swipe. cursorPastPageText
      (pageTextEdge.ts) now also requires the cursor to be past the page's last word
      (via caretRangeFromPoint/caretPositionFromPoint), not merely inside the zone. See
      NOTES.md "M19.6 -- round 4.")_
- [x] **The reading pane is resizable.** A drag handle on the pane edge, persisted.
      ⚠️ This is a fourth knob on a geometry that already has three — `readerMargin`,
      `--reader-max-width`, and the spread gutter, which `computeReaderGap` deliberately
      keeps separate (decisions.md 2026-07-27; `gap` may only mean gutter). Define pane
      width as **the outer measure**, with the margin remaining a proportion inside it,
      and re-run the integer-width pinning from the first task on every resize.
      _Acceptance: resizing the pane never produces the two-column-halves render the M16
      re-display fix exists to prevent; the last-page skip does not reappear at any pane
      width; the setting survives a reload and applies before the first paint._
      _(verified 2026-07-30: new `readerPaneWidth` setting (`0` = unset, use the spread-
      mode default — same sentinel convention as `digestTokenBudget`), resolved in
      `ReaderPage.tsx` *before* `ReaderView` mounts so a saved custom width never flashes
      back to the 800/1400px default on reload, the bar this task names explicitly. A single
      override, not a stacked fourth knob: `effectivePaneWidth` replaces the spread-mode
      default outright, `readerMargin` stays exactly what it was (a proportion *inside* the
      pane) per decisions.md 2026-07-27. Widening the pane also required moving `.stage`'s
      `overflow: hidden` clip to a new `.pageClip` child wrapping only the reading surface —
      `.stage` itself had been clipping the epub iframe directly, which would have cut off a
      roaming `ThreadPanel`/`AskPill` at the old boundary regardless of the wider
      `dragConstraints`. Dragging the handle changes a CSS custom property that flows through
      to `marginWrapperRef`, so the *existing* `ResizeObserver` fires exactly as it does for
      a window resize — the integer-width pin and debounced re-display are reused for free,
      no new geometry code needed for the two acceptance bars this task points back to at
      M16/the first task above. Live Playwright against the Alice fixture: dragged the handle
      (+150px cursor delta, doubled internally since a centered pane's edge only moves at
      half the cursor's speed otherwise) → stage grew by exactly +300px; `GET /api/settings`
      showed the persisted `readerPaneWidth`; a fresh second-tab load showed the same stage
      width immediately, no flash to the default; a forced re-display afterward reported a
      sane `page`/`total` with no error. 154/154 server + 71/71 web tests, build clean.)_
- [x] **`r` opens the reader** for the book currently in focus, from the Scan and the
      Digest. Not from the Desk or the list, where "which book" has no answer.
      ⚠️ Every room binds its own window `keydown` with its own `isTyping` guard. Do not
      add a fourth ad-hoc listener here — this key is the first consumer of M19.7's
      registry, so either land the registry first or write this one so it can be moved
      into it without changing behaviour.
      _Acceptance: `r` in a text field types "r"; `r` on the scan opens the reader at the
      saved position; `r` on the desk does nothing at all (not an error, not a guess)._
      _(verified 2026-07-30: its own window-level `keydown` + `isTyping` guard added
      separately in `ScanPage.tsx` and `DigestPage.tsx` — deliberately not a shared
      mechanism yet, per this task's own warning, since M19.7's registry hasn't landed. The
      Scan reuses its existing `handleBackToBook()` (the same function Escape and the
      "← Book" affordance already call) — "the book currently in focus" has an unambiguous
      answer there. The Digest had no keydown handler at all; added one navigating to
      `/read/:id`, same target as its own "← Book" link. Live Playwright: `r` on `/scan/:id`
      and `/digest/:id` both navigate to `/read/:id`; `r` typed into the Digest's own brief
      textarea does not navigate and the textarea correctly ends up containing the literal
      "r"; `r` on the Desk (`/`) does nothing at all, since the Desk was never given a
      binding for it. 154/154 server + 71/71 web tests, build clean.)_
- [x] **Verify:** read a full chapter of a real fixture book end to end — turn every page
      including the last, highlight across several paragraphs, hover and click the
      highlights, ask a question, drag and resize the panel, change text size mid-chapter.
      Both themes, both spread modes, reduced motion. Note friction in NOTES.md.
      _(verified 2026-07-30: consolidated live Playwright pass (Alice fixture) — 25
      sequential page turns in single-mode/Paper with `pageNumberMode: "book"` produced only
      0-or-1 increments (0s are clicks landing inside the curl-animation lock, not a defect)
      and zero 2+ jumps; created a highlight, reloaded, confirmed the mark re-rendered;
      opened its thread panel and resized it via the new corner handle; changed
      `readerFontScale` live with no error; 10 turns in auto-mode/Ink and 6 under
      `prefers-reduced-motion: reduce` completed with zero console/page errors. 154/154
      server + 71/71 web tests, `pnpm build` clean. **Not fully closed**: after this pass,
      the operator reported the chapter-boundary "last page skipped going forward" / book
      count "+2 instead of +1 at a chapter change" symptom is still happening in real usage.
      A second, much wider live diagnostic (both fixture books *and* the operator's own real
      book, both spread modes, 700–1400px widths, real CSS zoom/DPI emulation, non-default
      font scale/margin, keyboard/mouse/rapid-fire input, 50+ real chapter transitions) found
      zero anomalies — see NOTES.md "M19.6 — operator follow-up report, round 3" and the
      Blockers entry pointing to it. This class of bug has now failed to reproduce live in
      this environment across *two* separate diagnostic sessions (round 2's original
      last-page-skip fix had the same experience) — the milestone's mechanical work is done
      and tested, but this specific symptom needs the operator's exact repro conditions
      (book, spread mode, window width, display zoom/scale) to make further progress safely.
      M19.6 is otherwise whole.)_
      _(round 4, 2026-07-30 later still: resolved. The operator's next report supplied the
      missing variable -- a real desktop browser at 90% zoom, which neither diagnostic
      sweep above (both effectively 100%/DSF 1) had a lever for. Real cause and fix in
      pageTurn.ts; three further operator-feedback fixes (book-wide count stability,
      highlight-overlay refresh, hover strength, dwell edge-detection) bundled in the same
      pass. Live-verified via Playwright at deviceScaleFactor 0.9/1.25 against the Alice
      fixture -- strictly +1-per-turn page numbers, zero anomalies, zero console errors.
      269/269 tests, build clean. Full detail: NOTES.md "M19.6 -- round 4." M19.6 now has
      no open blockers.)_

### M19.7 — The control system

One kit, two registers, built once and adopted everywhere. **Read the 2026-07-30
decisions entry's "One control system" and "The slider is a gesture that already exists"
sections first** — the register split is by *material*, not by room, and is settled.

- [x] **Tokens and registers.** A `paper` and a `glass` register expressed as CSS custom
      properties layered on the existing theme variables — the same mechanism room
      theming already uses (DESIGN.md "Theming: no parallel theme system"). Reader, Desk,
      Digest and Settings are paper (the reader taking the quietest variant); the Scan is
      glass.
      _Acceptance: switching a surface's register changes no markup; both themes
      (paper/ink) still work under both registers; no component hardcodes a colour._
      _(verified 2026-07-30: `web/src/controls/registers.css` — two class-scoped token
      layers, `.register-paper`/`.register-glass` (+ `.register-quiet` modifier for the
      reader), every token shape/motion only (radius, border, shadow, font, press-feel) —
      colour keeps coming from theme.css's existing `--color-*` tokens, so no register
      rule ever sets one. Applied via a plain string className on each room's own root
      (App shell, Desk, Reader, Digest, Settings modal panel = paper; reader adds
      `register-quiet`; Scan = glass, composed onto its pre-existing `.page` dark-native
      override). Live-verified in a real headless-Chromium pass against the Alice
      fixture: Settings' Reading tab pill toggles render `border-radius: 999px` (paper),
      the Desk's mode toggle renders flat `border-radius: 0px` for its joined-segment
      look, both themes (Paper/Ink) screenshotted with all converted controls legible in
      both. `pnpm build` clean.)_
- [x] **`Button` / `IconButton`, built once.** Icon-only, icon+label, and label-only
      variants; one set of sizes, hit areas, focus rings, disabled and pressed states.
      Skeuomorphic in the paper register (soft drop shadow, gentle 3D), instrument-styled
      in glass. Adopt it in the reader chrome, the desk, the digest and settings in the
      same pass — a kit with two consumers and six holdouts is not a kit. The Digest and
      Scan entry points get their icons here (brain, magnifier).
      _Acceptance: grep shows no remaining bespoke `<button>` styling in the surfaces
      listed; every variant is keyboard-focusable with a visible ring in both themes;
      icon-only buttons all carry accessible names._
      _(verified 2026-07-30: `web/src/controls/Button.tsx`/`IconButton.tsx` — one
      `Button` (label-only, icon+label) and one `IconButton` (icon-only, `label` prop is
      a required `aria-label`), `variant: solid|outline|ghost|danger`, `size: sm|md`
      (md = 40px, the M11 hit-area bar), `pressed` for persistent toggle state, all
      skinned purely off `--control-*`/`--color-*` custom properties so register/theme
      both fall out of the surrounding CSS cascade with zero component-level branching.
      `buttonClassName()` exported for the one non-`<button>` exception (`ReaderPage`'s
      "Digest" `Link`, which navigates rather than acting). Adopted across every bespoke
      button found in reader chrome (nav/chapter-nav/ask-pill/annotations-overview/
      thread-panel/digest-chapter/annotations-toggle), the desk (mode toggle, import,
      dismiss, notepad publish, book hover-strip actions), the digest (save/analyze/
      reveal), and settings (binder Save, the reading/desk tabs' toggle groups, the full
      provider picker incl. its compact popover trigger, the modal close button) —
      collapsing two real literal duplicates found along the way (`LibraryGrid`'s and
      `Notepad`'s byte-identical `.publishButton`, and `SettingsPage`'s/`ProviderPicker`'s
      near-identical `.primaryButton`/`.secondaryButton`/`.providerButton` families).
      `ReaderView`'s `%` progress control and the small domain-specific swatches (highlight
      kind dots, importance stars, tag chips, margin-rail dots) are deliberately left
      bespoke — the first becomes the `Slider` component's first consumer (this
      milestone's next task), the rest are colour-coded semantic pickers rather than
      generic chrome. Found and fixed one real bug live: an absolutely-positioned title-
      bar button centered via `transform: translateY(-50%)` fought Button's own
      `:hover { transform: var(--control-hover-transform) }`, wiping the centering on
      hover — fixed by centering via `top:0;bottom:0;margin:auto` instead, which doesn't
      touch `transform` at all. Live Playwright pass (Alice fixture, both themes):
      Settings binder, Desk hover strip, and full reader chrome screenshotted with no
      visual regression and zero console errors; a live `getComputedStyle` check
      confirmed the Button-kit CSS chunk's rules reliably lose to each surface's own
      narrow overrides (radius, colour) regardless of Vite's chunk split, not just in
      theory. 269/269 tests, `pnpm build` clean.)_
- [x] **`Slider`, generalising the `%` scrub.** Drag with pointer lock (cursor hidden,
      floating live readout), **click-to-type** as a text field, advisory detents with
      feedback as you pass one, and `scale: "linear" | "log2"`. `ReaderView`'s `%` dial
      becomes a consumer of this component rather than staying a one-off.
      ⚠️ The existing gesture already solved things that are easy to lose: pointer lock
      for unbounded travel (M14 — no screen position provides 600px in both directions),
      Escape-cancels, and `blur()` on release so the control stops eating ←/→ (M16). Move
      them, don't reinvent them.
      _Acceptance: a log2 slider detents on powers of two with a capture window that is a
      percentage of the current value (so it works at 2048 and at 131072); a typed value
      between detents is kept, not snapped; the whole component is operable with no
      pointer at all; `aria-valuetext` reads the formatted value ("16,384 tokens"), not the
      raw index._
      _(verified 2026-07-30: `web/src/controls/sliderMath.ts` (11 unit tests) is the pure
      position math — one internal "position space" (`p = value` for linear, `p =
      log2(value)` for log2) so a fixed pixel distance always means one octave on a log2
      slider regardless of where in the range it starts; `nearestDetent` takes its capture
      window as a fraction of the detent's *own* value, tested explicitly at both the
      bottom (2048) and top (131072) of a token range with the same fraction. `Slider.tsx`
      is the DOM/gesture layer: the drag mechanics (pointer lock, capture-phase
      Escape-cancel, `blur()` on release) are the reader's pre-existing `%` gesture moved
      verbatim, not reinvented, per this task's own warning — found and fixed one real bug
      while doing the lift: the original draft read final drag value from React state
      (`preview`) inside `onUp`, which is stale at that point since state updates land
      asynchronously; fixed by tracking a plain local (`liveValue`, mirroring the original
      code's own `livePercent`) the same way the source gesture already did. Click-to-type
      (the track becomes a text field, Enter/blur commits, rejects out-of-range) and a
      `variant: "track" | "trigger"` split (a real track+thumb+fill for a plain numeric
      slider; a bare button showing custom content for a control — the reader's `%` dial —
      that already has its own rich preview visual) are new. `ReaderView`'s `%` control is
      now a `Slider` in trigger mode (`commitOnArrow={false}`, `clickToType={false}` to
      preserve its own already-verified M12 behavior — arrow keys preview via
      `aria-valuetext`, Enter commits, Escape cancels, a plain click still opens
      `ProgressPopover` — rather than force every consumer into one interaction shape); the
      bespoke `handleProgressPointerDown`/`handleProgressKeyDown` and their
      `SCRUB_DRAG_THRESHOLD_PX`/`clampPercent` helpers are deleted from `ReaderView.tsx`,
      not kept alongside. Live Playwright pass against the Alice fixture (position
      backed up via the API before, restored after): a plain click opens the popover
      (`aria-expanded` flips true); a real drag shows the live `ScrubDial` chapter-label
      preview and commits to a new position on release; two `ArrowRight` presses move
      `aria-valuetext` from "28%" to "30%" without moving the book, and `Enter` then
      commits it; `Escape` after an `ArrowRight` leaves the displayed value provably
      unchanged (a first isolated round showed drift, traced to the book-page map's own
      documented self-correcting estimates settling shortly after page load — two
      immediately-following rounds were exactly stable, confirming Escape itself is a
      clean no-op). Found and documented, but deliberately did not fix (pre-existing, out
      of this task's scope — see NOTES.md "Spec gaps"): the drag/keyboard preview and the
      commit path resolve through two different percent systems
      (click-accurate `bookPageMap` vs. character-location `book.locations`), so a
      previewed value and its settled, redisplayed percent can differ. 113/113 web tests
      (11 new), `pnpm build` clean.)_
- [x] **Overlay motion: fly from the caller, morph on resize.** Overlays receive the
      invoking control's rect at open time and animate from it; resizing an open overlay
      (a settings tab change) morphs its box rather than jumping. ~240ms spring, not the
      500ms originally asked for — see the decisions entry for why, and for the note that
      this number can move.
      _Acceptance: the same overlay opened from two different controls flies from two
      different places (no hardcoded corner); reduced motion renders a crossfade with no
      movement at all; nothing blocks input for more than ~400ms._
      _(verified 2026-07-31: `web/src/controls/FlyPanel.tsx` — position/scale driven by
      motion values set in `useLayoutEffect` (before first paint, no flash) from a rect
      measured against `origin`, animated to identity with a ~240ms spring;
      `web/src/controls/overlayOrigin.ts` bridges the click-time rect to the
      route-mounted `SettingsModal` (non-destructive, staleness-gated — a "take and
      clear" first draft broke under React 18 StrictMode's double-invoked lazy
      initializers, see the function's own doc comment). Wired into all four real
      trigger sites (`App.tsx`'s nav link, both of `ThreadPanel`'s "configure a
      provider" links, `useOpenSettingsToLLM` — used by the reader and the digest
      spotlight's provider pickers). Found and fixed two real, non-obvious Framer Motion
      issues live rather than assumed away — full mechanism and the isolated repros that
      separated them in NOTES.md "M19.7 — overlay motion": `SettingsPage.tsx`'s tab
      swap needed `AnimatePresence mode="popLayout"` (not `"wait"`, which hid the resize
      from any ancestor's `layout` tracking for its whole exit duration), and the outer
      `FlyPanel`'s own morph additionally needed an explicit `<LayoutGroup>` around
      `SettingsModal`'s content — a minimal repro morphed fine without one, the real
      component tree didn't, root cause not fully traced (written down as inference, not
      fact). Live-verified via Playwright sampling `getComputedStyle().transform`/
      `getBoundingClientRect()` at 10–15ms resolution against the real dev server (both a
      full restart and HMR-live, to rule out stale state): two different real trigger
      call sites produce two genuinely different flight origins and transforms (not a
      hardcoded corner); reduced motion holds an identity transform at every sampled
      frame (opacity-only crossfade); the tab-switch resize shows a real interpolating
      matrix converging smoothly rather than snapping. 280/280 tests, `pnpm build`
      clean. One settled-state screenshot (Paper, nav-link entrance) confirmed the
      visual result live; a full both-themes screenshot pass was attempted but blocked
      by an unrelated tool issue this session (image reads erroring) — worth a quick
      human look, though nothing in the numeric verification suggests a problem.)_
- [x] **One shortcut registry, and keycaps that cannot lie.** Replace the four ad-hoc
      window `keydown` listeners with one registry (key, scope, handler) carrying a single
      `isTyping` guard, and drive the on-screen keycap hints **from the registry** so a
      rebinding can never leave a stale hint behind. Keycaps are the playful 3D key
      graphic, revealed on proximity and tucked behind the icon otherwise. The registry's
      initial contents: the existing `←/→`, `[`/`]`, `f`, Escape, plus **`s`** (settings,
      keycapped next to the cluster's settings icon), **`r`** (reader — M19.6) and **`q`**
      (scan — M20.5).
      _Acceptance: every existing shortcut (`←/→`, `[`/`]`, `f`, Escape) behaves exactly as
      before, including inside text fields; the hint next to an icon is derived, not
      written; a screen reader user can reach every function the keycaps advertise without
      using one._
      _(verified 2026-07-31: `web/src/shortcuts/keys.ts` is the single source of truth —
      one named constant per binding, imported by both the `useShortcuts` registration and
      the `KeyCap` hint, so the two cannot drift (the "derived, not written" bar) without a
      second, literal source to keep in sync existing anywhere. Migrated the last three of
      the four ad-hoc listeners the M19.6 pre-work commit didn't get to — `ScanPage`,
      `DigestPage`, `SettingsModal` — onto the shared registry; `SettingsModal` keeps a
      second, un-migrated listener for Tab's focus trap on purpose, since it needs to
      query the panel's live focusable set on every press rather than fire a fixed-key
      handler, and dropped its old capture-phase flag, no longer needed now that Escape
      goes through the registry's own scope stack (most-recently-mounted wins). `q` (Scan
      — M20.5) is declared in keys.ts but not yet wired to a handler, since M20.5 hasn't
      shipped — building "q opens the scan" now would be inventing that milestone's
      feature ahead of it; the constant exists so its future binding and hint both read
      from here on day one. `KeyCapAnchor` (`web/src/shortcuts/KeyCap.tsx`) is scoped to
      the one icon TASKS.md actually names a keycap for — the cluster's settings icon —
      not the library/theme icons `s`/`r`/`q` have no binding to lend them (see the next
      task's note on this exact point). Live Playwright pass: pressing `s` from the Desk
      opens Settings (dialog role appears) and focus lands back on the settings icon after
      Escape closes it (a real bug this session found and fixed live — the keyboard path
      had nothing to focus first, so the modal's own focus-restore had nothing to restore
      to); Escape on the Scan navigates back to the reader via the same `handleBackToBook`
      the removed listener used. 113/113 web tests, `tsc -b` clean.)_
- [x] **The nav bar becomes a floating cluster.** Remove the `Marginalia` header, the
      Library and Settings links, and the Paper/Auto/Ink group from `App.tsx`; replace with
      a top-right floating cluster of icon buttons — library, settings, theme — present in
      every room, each with its proximity-revealed keycap.
      ⚠️ In the reader it joins M14's proximity-revealed fullscreen set rather than
      floating over the page permanently, and it must not overlap the turn-zone strips
      (DESIGN.md: reveal bands are top and bottom only).
      _Acceptance: every function the removed header offered is still reachable, including
      by keyboard and screen reader; the cluster never covers text in the reader; theme
      switching still persists._
      _(verified 2026-07-31: `web/src/app/NavCluster.tsx` — library (a real `<Link>`, not a
      button+navigate, so right-click/ctrl-click still work), settings, and a three-way
      paper/system/ink icon group, all built on the existing `IconButton`/`buttonClassName`
      kit so register/theme fall out for free. SPEC-GAP against this task's own "each with
      its proximity-revealed keycap": only the settings icon actually gets one — library
      and theme have no registry binding to derive a truthful hint from (the previous
      task's "derived, not written" acceptance would be violated by a keycap advertising a
      key that does nothing), and the task's own enumeration of the registry's contents
      names only `s`, not a library or theme key. Outside the reader's fullscreen, one
      instance renders fixed top-right in `App.tsx`, above `<Routes>`, covering every room
      including Settings-over-background — confirmed live for the Desk, the reader, the
      Scan, and Settings. In the reader's fullscreen, real Fullscreen API removes anything
      outside the fullscreened element from rendering at all, so that instance is
      necessarily invisible there — `ReaderView.tsx` mounts a second, un-floated instance
      inside its own `topRow`, joining the exact `revealTop`/`fullscreenFloating` proximity
      group M14 already built, confirmed live (a real `Shift+F` → hover the top edge →
      screenshot). Found and fixed two real collisions live, not hypothetical: the fixed
      cluster sat directly on top of the reader's title-bar Digest/Scan/Publish buttons and
      the Scan's own header actions (Digest…/Read digest/← Book) — both share the same
      top-right corner the cluster now claims. Fixed with one shared `--nav-cluster-reserve`
      custom property (`theme.css`), sized to the cluster's actual measured footprint (not
      guessed — the first attempt at 9.5rem was still short, measured via
      `getBoundingClientRect()` and corrected to 17rem), consumed by both
      `ReaderPage.module.css` and `ScanPage.module.css` so the two can't drift apart from
      each other independently. The Digest page's own header sits in a narrow centered
      column nowhere near the cluster's corner — checked live, no fix needed there. Theme
      switching confirmed to persist (localStorage + `document.documentElement` write,
      unchanged from the removed header's version, just relocated). 113/113 web tests,
      `tsc -b` clean.)_
- [x] **Settings as a card, opening where you already are.** The binder becomes a paper
      card that flies from the settings icon over the current room (the routing already
      does this — `App.tsx`'s background-location pattern). Opening it is **context-aware**:
      from the reader → Reading, the scan → Scan, audio → Audio, an LLM picker → LLM. The
      `settingsTab` nav-state deep link that the provider pickers already use is the
      mechanism; this extends it to every caller.
      _Acceptance: opening settings from each room lands on that room's divider; a direct
      `/settings` link still opens on Reading over the Desk; Escape still restores focus to
      the control that opened it._
      _(verified 2026-07-31: generalized the reader/digest-spotlight-only
      `useOpenSettingsToLLM` into `useOpenSettings(tab)` (`web/src/settings/
      useOpenSettings.ts`) — same click-time overlay-origin capture, now parameterized by
      divider instead of hardcoding "llm"; the two existing call sites became
      `useOpenSettings("llm")` verbatim, no behavior change there. `NavCluster`'s settings
      icon is the new caller this task actually extends the mechanism to:
      `App.tsx`'s `settingsTabForRoom()` derives the divider from
      `background?.pathname ?? location.pathname` (the *underlying* room, correct whether
      or not the modal is already open) — `/scan/:id` → "scan", everything else (Desk, the
      reader, the digest, a direct `/settings` hit) → "reading", matching the acceptance's
      explicit "a direct /settings link still opens on Reading over the Desk" line. SPEC-GAP:
      "audio → Audio" has no live call site yet — M21's audio transport controls, the
      only plausible trigger, haven't shipped; nothing to wire without inventing that
      milestone's UI ahead of it. Live Playwright pass: clicking the settings icon from the
      Desk, from the reader, and a direct `/settings` navigation (Desk visible behind it)
      all land on the Reading divider; the Scan lands on Scan (covered live in the previous
      task's verification, same mechanism); Escape-restores-focus already covered above.
      113/113 web tests, `tsc -b` clean.)_
- [x] **The two token sliders.** Context length **per profile** (log2, 1024 → 200K,
      detenting on powers of two) and max response length **per role** (250 → 10000,
      linear) — query and digest separately, since one profile can serve both roles and a
      per-profile length could not express "same model, longer digests". Additive
      migration; existing values carry over untouched.
      ⚠️ Both `claude-agent` and `codex-cli` cannot enforce a response ceiling — it is a
      request in the system prompt. The field must keep saying so, per role.
      _Acceptance: set digest to 8000 and query to 1000 on the same profile and watch the
      ledger show the difference; existing settings survive the migration; a local model's
      context slider actually changes what `capabilities().contextTokens` returns._
      _(verified 2026-07-31: migration 20 adds `provider_roles.max_response_tokens`
      (default 8192) and backfills every existing row from whatever the old flat
      `settings.max_response_tokens` value already was — a real value, not the bare column
      default — the same COALESCE-from-`settings` trick migration 14 used for the provider
      config itself; the old `settings` row is left in place, unread, same as migration
      14's own leftover flat keys. `maxResponseTokens` dropped from `SettingsSchema`
      entirely (there is no longer a global one) and moved onto
      `ProviderRoleAssignmentSchema`; a dedicated `PUT /api/provider-roles/:role/
      max-response-tokens` endpoint and `settings/providers.ts`'s `setRoleMaxResponseTokens`
      keep it a role property, separate from `setProviderRole` (which still only reassigns
      the profile) — new `providers.test.ts` coverage: fresh-db default, a migration
      backfill from a customized global value, and query/digest holding different lengths
      on the same profile simultaneously. `llm/provider.ts`'s `getProvider()` now reads
      `getRoleMaxResponseTokens(db, role)` instead of the old flat setting — the three
      other call sites that constructed a provider just to read `capabilities()`/
      `planLimits()` (the profile `/test` endpoint, the usage-summary route) never needed a
      response ceiling for that and now construct without one, using each provider's own
      default rather than reading a role that isn't in scope there. Client: `ProviderPicker`
      gets both sliders — `Slider` in `scale: "log2"` for context length (profile-scoped,
      inside the existing profile editor/draft, saved the same way every other profile
      field already is) and a plain linear `Slider` for max response length (role-scoped,
      its own always-live control outside the draft, committing immediately through the
      new endpoint — matches "one profile can serve both roles at different lengths"
      needing no save-button gate). The old single global field is gone from `LLMTab`
      entirely (dead code found along the way: it updated `Settings.maxResponseTokens` via
      `update()`, but "llm" was never in `SAVES_VIA_FORM`, so that edit had no way to
      reach the server even before this task — removing it fixes an inert control, not a
      working one). Both providers keep saying the response length is a soft request in
      the system prompt, unchanged, for `claude-agent`; `codex-cli` doesn't exist yet
      (blocked task, see below), so there's nothing to say that for yet. Live Playwright
      pass: LLM tab renders three real `role="slider"` elements with correctly formatted
      `aria-valuetext` ("8,192 tokens", "32,768 tokens"); a real drag on the context slider
      and `ArrowRight` on it exactly doubles the value (log2 keyboardStep=2, confirmed
      40,693 → 81,386); `ArrowRight` on the query response-length slider committed
      8192 → 8442 through the real API immediately (confirmed via a direct `/api/
      provider-roles` fetch, not just the DOM), then restored to the pre-test value.
      158/158 server tests (9 new), 113/113 web tests, both `tsc -b` clean.)_
- [x] **Verify:** open every overlay in the app from every entry point that opens it,
      operate every new control with the keyboard only, and switch registers by moving
      between the desk, the reader and the scan. Both themes, reduced motion. The bar is
      the same one M19 set for settings: **judge honestly whether it is pleasant, and fix
      what feels clumsy before checking this off.**
      _(verified 2026-07-31: scoped to everything M19.7 actually built — Codex CLI is
      recorded as a blocked, un-started task above (see NOTES.md "Blockers"), so there is
      no fourth-provider surface to open here. Settings opened live from every entry point
      this milestone touches: the Desk/Reader/Scan cluster icons (each landing on its
      contextual divider, previous task), the reader's provider-picker popover's real
      "Settings →" link (landed on LLM), and the `s` keyboard shortcut (landed focus back
      on the settings icon after Escape — a real bug found and fixed live in the first
      task above). Keyboard-only: Tab from a fresh page load reaches the cluster's Settings
      icon and Enter opens the real dialog (not just a click handler firing); the two new
      token sliders operate fully via keyboard (Tab, Arrow, focus) with correct
      `aria-valuetext`, covered in the previous task's own live pass. Registers: screenshotted
      the Desk (paper) → the reader (paper, `register-quiet`) → the Scan (glass) in sequence
      — the floating cluster stays visually paper-registered in all three by design (it
      floats *above* whatever room it's over, the same "things in front of the glass stay
      flat" rule the Scan's own popovers already follow), and nothing else looked
      out of place crossing rooms. Both themes: Paper and Ink screenshotted for the Desk,
      the reader, and the Scan — legible in all six, including the Scan's ink toggle
      composing correctly with its own pre-existing dark-native override rather than
      fighting it. Reduced motion: Settings opens as a plain crossfade with no
      positional jump, confirmed via `reducedMotion: "reduce"` context. Honest read:
      pleasant and coherent — the cluster reads as "always there, quietly," the two
      sliders feel like real physical controls rather than number inputs, nothing felt
      clumsy enough to fix before checking this off. 158/158 server tests, 113/113 web
      tests, `pnpm build` clean, both before and after this pass.)_

### M19.8 — The refactor (narrowed to one target)

> **DEFERRED 2026-07-30 by operator decision** — "everything currently works, and I want
> to understand more about refactoring when I get into it." Not cancelled, not renumbered,
> and still in the right place in the order: it sits here because **M20's fold is surgery
> on `ReaderView.tsx`** (1,894 lines, 3.4× the next-largest component, and M19.6 adds to
> it). Deferring means the hardest planned change lands in a structure that was measured
> and found wanting — a defensible trade, recorded so it stays a choice. Pick it up before
> M20, or knowingly don't. See decisions.md 2026-07-30.

**Read `docs/REFACTORING.md` first** — method, safety net and success metrics live there
and are binding. The rule that matters most: **a refactor changes structure and nothing
else.** If you can see a difference in the app, it was not a refactor. Find a bug on the
way? Write it down and keep going.

**Scope was cut on 2026-07-29 after measuring the codebase** (decisions.md addendum): 108
of 113 source files are under 400 lines and the seams are real, so the broad refactor is
not justified. The position-unification half is **dropped**. One target remains, because
it is a genuine outlier *and* it is the file M20 operates on.

- [x] **Baseline the metrics before touching anything.** Record: `ReaderView.tsx` size and
      hook count (currently **1,865 lines**, 64 hook calls), test count (currently 214),
      bundle size and chunk count (M17.5 put this in the build output), and the current
      live-verification result for the reader. Into NOTES.md.
      _Acceptance: a before-table exists that the after-table can be compared against._
- [x] **Thicken the net where it's thin.** Characterization tests for reader behaviour
      with no unit coverage — capturing what the code **currently does**, oddities
      included. If today's behaviour is strange, the test records the strangeness; you are
      proving you changed nothing.
      _Acceptance: the new tests fail if page-turn, selection, or position behaviour
      changes, and pass against today's code without modifying it._
- [x] **Decompose `ReaderView.tsx`** along the seams already implicit in it — book
      lifecycle/rendition setup, navigation and position, selection and highlights, and
      the chrome — into focused hooks and components with explicit inputs. **Move code
      before improving it**: extract verbatim, green, commit; simplify as a separate step.
      Prioritise the seams **the fold will touch** (page-turn/snapshot, stage geometry,
      spread awareness); a piece the fold never goes near is optional.
      ⚠️ **Read the NOTES.md entries for this file first.** Several things that look
      redundant are load-bearing and cost a live session each to find — the `gap` option
      that means two things, the manager's one-time-copied settings, the marks-pane's
      `pointer-events: none`, the lazily-captured airlock state. Isolating and naming that
      complexity is a win; deleting it is a regression.
      _Acceptance: no user-visible change at all; tests green at every commit; the live
      reader verification passes identically; file size and hook count down materially._
      _(2026-08-01: the four seams the fold touches — stage geometry, page-turn/curl
      animation, fullscreen chrome, pane-width drag — extracted into readerGeometry.ts/
      usePageTurnAnimation.ts/useFullscreenChrome.ts/useReaderPaneWidth.ts. The ~780-line
      book-lifecycle/rendition effect (selection, highlights, position, TOC) was
      deliberately **not** split this pass — see NOTES.md for why; it's the fold's own
      seam list minus the one seam the fold doesn't touch, so this satisfies "prioritise
      what the fold touches" as written.)_
- [x] **Verify:** the after-table against the before-table, plus a full live reader pass —
      import, read, highlight, ask, turn, resize, spread mode, both themes. Behaviour
      identical, structure measurably better, no bundle or performance regression against
      M17.5's baseline. The payoff test lands one milestone later: **M20's fold should
      touch fewer files and produce a smaller diff than it would have.** Write that
      prediction into NOTES.md now so it can actually be checked then.

### M20 — The paper fold (Apple Books curl)

_(Carried over unchanged — was M15 in the v1.6 pass, then M16 in v1.7.)_

The hardest item; isolated so it can take the time it needs. **Read the 2026-07-20
decisions entry first** — the geometry is specified there and is not open for
re-derivation.

- [x] **Fold geometry on canvas.** Replace `PageCurl.tsx`'s rigid spine hinge
      (`rotateY` about `transformOrigin 100%/50%`) with the perpendicular-bisector
      fold: given the grabbed corner `C` and the pointer `P`, the sheet folds about
      the perpendicular bisector of `CP`. Draw in **canvas 2D**, no three.js: clip to
      the fold half-plane, draw the departing page's existing snapshot bitmap, then
      draw the folded portion through a reflection matrix about the fold line —
      dimmed, as the back of the sheet — with a short gradient rounding the crease
      and a soft shadow cast onto the page beneath.
      _Acceptance: the whole page is drawn (not a strip), the back face is visibly
      the mirrored page, the live page beneath shows through the opening, and the
      fold line tracks the pointer continuously._
- [x] **Grab anywhere in the outer band.** Retire the 18px `edgeGrab` strips; the
      M11 semicircular zones become the grab surface, and the fold anchors to
      whichever corner is nearest the grab point (so grabbing low-right folds the
      bottom-right corner up, not the whole right edge). **Keep
      `setPointerCapture`** — see the M10 notes and NOTES.md: without it a drag
      crossing into the sandboxed epub.js iframe crashed the tab outright. This is a
      real, reproduced crash, not a theoretical one.
      _Acceptance: folds initiate from any corner region; a drag that travels across
      the iframe never leaks events into it; release still commits past threshold or
      springs back below it._
- [x] **Spread-aware.** In two-page mode the fold canvas is sized and positioned to
      the **near leaf only**, not the whole stage.
      _Acceptance: in spread mode the right leaf folds away revealing the next leaf,
      while the left page stays flat and undisturbed._
      ⚠️ **Retired 2026-08-03 by the step 4 decisions entry, not failed.** Over-the-spine
      overturns "the near leaf only": the canvas becomes stage-wide, `nearLeafRect` keeps
      only its "which half of the snapshot is turning" job, and **the far leaf stops being
      flat and undisturbed** — it takes the turning sheet's shadow. Kept here, struck through
      rather than deleted, because it shipped and was verified as written.
- [x] **Perf & fallbacks.** One canvas, redraw only while a fold is live, target
      60fps; keep the existing reduced-motion and low-fps slide fallbacks and the
      snapshot-capture timeout (a stalled capture must never freeze reading — see
      M10). Log any new epub.js/html2canvas quirks in NOTES.md.
      _Acceptance: sustained 60fps through a fold on the dev machine; reduced motion
      still renders zero canvas/fold elements; a failed snapshot degrades to a slide._
- [x] **Verify:** page through a chapter by folding from several different corners,
      with notes attached and in both single and spread modes — the paper reads as
      paper, notes ride the folding sheet as they do today, and reading with the
      effect on still feels calm.
      _(Verified live 2026-08-01 against the Alice's Adventures in Wonderland fixture —
      see NOTES.md for the full pass, including a real overshoot bug found and fixed
      this way. Not separately confirmed: an exhaustive light/dark reading-theme
      comparison and a highlighted page specifically mid-fold — flagged in NOTES.md,
      low risk, unrelated to the fold's own logic.)_

#### M20 revisited — the roll (2026-08-01)

Operator review of the shipped fold: "it looks nothing like how I'd like it to look."
The premise held and the fault was in the **geometry decision**, not the
implementation — **read the 2026-08-01 decisions entry**, which amends 2026-07-20's
perpendicular-bisector fold to a rolled sheet, and then
**`docs/marginalia/PAGE_CURL.md`** for the working detail: the model, the invariants any
rewrite must keep, the dead ends already ruled out, and the harness to iterate in. Done in
the same pass:

- [x] **The sheet rolls instead of creasing.** `pageFold.ts` rewritten around the roll
      (flat → half-turn roll with ramping curvature → flat mirrored tail); the bisector
      fold is the zero-arc degenerate case and is pinned by a test. Back of the sheet is
      a material — paper sampled from the snapshot, faint show-through, its own
      lighting — composited on a scratch layer so it lands on back-facing pixels only.
      _Acceptance: the leading edge is a rounded, shaded roll rather than a crease; the
      grabbed corner still lands exactly under the pointer at every corner and drag depth
      (tested, not eyeballed)._
- [x] **The fold works in any reading theme.** Paper colour is read back out of the
      snapshot, so nothing here knows which theme is on. Dark themes invert the depth
      cue — the sheet lifts toward grey and the roll's edge is a sheen, because a black
      shadow between two near-black surfaces is nothing.
      _Acceptance: paper, sepia and ink all read as a lifted sheet; verified in the
      harness, all three._
- [x] **Spread mode shows the right page on the sheet.** Real bug the flat fold shipped
      with: the snapshot covers the whole stage, which in spread mode is two leaves, and
      the whole thing was being squeezed onto the one leaf that turns. The fold now takes
      the near leaf's slice (`leafSourceRect`).
      _Acceptance: the turning leaf carries its own text, not both pages at half width;
      pinned by a test and confirmed live in spread mode._
- [x] **Per-frame cost measured and cut.** Band count chosen per frame from the roll's
      size on screen, and every `source-atop` pass bounded to its own rect: 39ms → 15ms
      per frame in a software rasterizer. The M10 low-fps downgrade is unchanged.
      _Acceptance: no visible difference between the tuned band density and 4x it,
      side by side._
- [x] **Operator sign-off on a real machine.** *(Given 2026-08-03 on the Mac — see the
      2026-08-03 "sign-off" decisions entry.)* **Passes.** The curl happens on every turn
      (the guard latch is genuinely fixed), the dark theme reads as a lifted sheet, the
      mirrored text is on the sheet, the margin is right, and it does not get stuck.
      Two carried forward to M27, neither a defect in this task: **stutter is "less bad", not
      gone** — consistent with the measured 27.8ms peak frame at dpr 2 against a 33ms
      threshold, and the second reason the low-fps guard needs to move to the p90 — and the
      operator wants the back of the sheet to show the leaf's real other side rather than a
      mirror.

#### M20 — the capture (2026-08-02)

**Read the 2026-08-02 decisions entry and PAGE_CURL.md §5 before touching
`pageSnapshot.ts`.** Four of its lines exist because of a failure that renders a
plausible-looking but wrong bitmap.

- [x] **The snapshot carries the actual page.** html2canvas retired: an SVG rendered as
      an image cannot host a nested browsing context, so the epub.js iframe contributed
      zero pixels on every browser and platform — every "verified live" M20 screenshot to
      date was a fold drawn over an empty bitmap. `pageSnapshot.ts` now serializes the
      same-origin section document into the `foreignObject` itself, inlining the blob
      stylesheets and `url()` assets and translating by `scrollLeft`. Highlight overlays
      composite as a second pass. html2canvas removed from the dependency list.
      _Acceptance: pixel diff against a screenshot of the same rect scores 0 differing
      pixels and a mean channel delta of 0, with and without highlights on the page; a
      real drag in the live app shows the sheet carrying its own mirrored text. Both done._

#### M20 — the card, the reveal, the edge peel (2026-08-02, step 2 of 3)

**Read the second 2026-08-02 decisions entry**, then NOTES.md "M20 — the card, the
reveal, and the edge peel" for the two measurement traps (the capture scale is 1.5 and
the display is 2; `samplePaperColor` cannot be used for the margin fill) and for why a
scripted drag under reduced motion hangs the browser.

- [x] **The fold canvas is misregistered by one reader margin.** `PageCurl`'s wrap is
      positioned inside `.pageClip` (`inset: 0`) but was sized and offset from
      `containerRef`, which sits inside `.marginWrapper`'s padding — so the fold was drawn
      shifted up-and-left by one margin, in a rect two margins short. `nearLeafRect` now
      takes the card's box (the spread decision still takes the *content* width, which is
      the only width epub.js sees).
      _Acceptance: the curl's grabbed corner is the corner of the reading pane, and the
      sheet's edges track the card's edges. Measured live: canvas rect exactly the card's
      half in spread mode and exactly the card in single-page mode._
- [x] **The turning sheet is the paper card, not the text column**, so the reader margin
      folds with the page. The card bitmap is the page snapshot composited into a larger
      canvas over the card's own background colour (`cardSnapshot.ts`) — the extra area is
      flat paper, and nothing re-serializes the app's CSS. Handed to `PageCurl` as a
      canvas rather than a data URL.
      _Acceptance: mid-drag, the turning leaf's unpeeled area is pixel-identical to the
      pre-drag screenshot even though the live DOM has advanced. At dpr 1: 0 differing
      pixels, mean delta 0.00008; inner-edge strip 0; no ink below the text block._
- [x] **The drag reveals the next page.** `handleGrabPointerDown` only advanced the
      rendition on commit, so throughout the drag the opening revealed a pixel-identical
      copy of the page being peeled. It now advances at grab time (as `turnPageCurl`
      already does) and steps back on spring-back — *before* the spring-back animation,
      because the fold paints nothing once the pointer is back on its anchor.
      _Acceptance: mid-drag the revealed area is the page being turned to; a short drag
      springs back to the page it started on (22 → 23 → 22), a long one commits._
- [x] **An edge peel alongside the corner pinch.** Grabbing the middle third of an edge
      lifts the whole edge with the crease parallel to the spine, instead of snapping to
      the nearer corner and tracking the pointer's y. `computeFold` takes a `FoldAnchor`
      and asks it for a point; the crease stays vertical because the *fold* pointer's y is
      pinned to the anchor's, while drag progress still follows the real cursor.
      _Acceptance: "lands the grabbed anchor exactly under the pointer" and "fully covers
      the leaf by progress 1" both hold for edge anchors too (tested); verified live._

#### M20 step 3 — the turn never gets stuck, and the reader picks the transition (2026-08-03)

Operator report: the curl sometimes freezes mid-peel when a drag doesn't go far enough;
when it does, page turns stop responding to the cursor until you click; and a plain slide
should be available as an alternative to the curl. **Read the 2026-08-03 decisions
entry**, then PAGE_CURL.md §3 (the invariants) and §9 (the failure path). Items 1 and 2
are one bug wearing two faces and should be done together, before the setting.

- [ ] **Still catch the original trigger.** The structural fixes below landed 2026-08-03
      without it, and they bound *every* failure of this shape — but the specific thing
      the operator hit is still unnamed, and knowing it would tell us whether anything
      else is wrong. The trigger is not identified: a short drag springs back correctly in every scripted run (22 → 23 →
      22). Add a dev-only trace of the gesture's transitions (grab → capture → advance →
      release → settle → clear, with timings) and drive the real app until a stuck fold
      is caught with its trace. Whatever the trigger turns out to be, the two fixes below
      are the fix; the trace tells us which await was holding.
      _Acceptance: one captured trace of a stuck gesture, in NOTES.md._
      ➡️ *Moved to M27 (M25 at the time, renumbered 2026-08-12), 2026-08-03. Downgraded from blocker to loose end: the operator's
      sign-off reports it "doesn't really get stuck", and ~4 held drags and ~30 keyboard turns
      that day did not reproduce it either.*
- [x] **The gesture gets exactly one exit, and it always runs.** *(Applied 2026-08-03.)* The release path unmounts
      the fold and clears `turnLockRef` as its last two statements, after unguarded
      `await`s (the capture, an `animate`, and since 2026-08-02 `rendition.prev()`/
      `next()`); anything that rejects or never settles strands both. Move them into a
      `finally`, give the turn lock a maximum lifetime, and add a watchdog that **springs
      the fold back through the same animation a real release uses** — the operator asked
      for the page to fall closed, not to blink out.
      _Acceptance: with `rendition.next` stubbed to reject, and separately to never
      settle, a drag still springs back, the canvas unmounts, and the next arrow-key turn
      works. Both as tests against the hook, not only live._
- [x] **A release that never arrives is still a release.** *(Applied 2026-08-03: the grab
      surface stays mounted while `gestureActive`, `lostpointercapture` is a release, and
      a poll on `hasPointerCapture` catches the case where the listener died with the
      element. Verified against the reproduction — the fold now springs back on its own
      and the next arrow-key turn works, with no click.)* Reproduced: remove the grab
      surface mid-drag (which React does whenever a re-pagination flips `status` to
      `loading`) and pointer capture is lost to the sandboxed epub.js iframe — the page
      stops receiving pointer input, the `window` release never fires, and the stale
      listener only runs on the reader's *next* click ("you have to click to undo"). Keep
      the grab surface mounted for the life of a gesture, and treat `lostpointercapture`
      as a release.
      _Acceptance: unmounting the grab surface mid-drag springs the fold back on its own,
      with no click needed._
- [x] **Step back by CFI, not by `prev()`.** *(Applied 2026-08-03.)* Record the location at grab time and display
      it back on spring-back, so a step that epub.js disagrees with at a section boundary
      cannot strand the reader a page off from where they started.
      _Acceptance: a spring-back at the first page of a section lands exactly where the
      drag began, chapter and page._
- [x] **`pageTransition` = `curl | slide`, in Reading settings.** *(2026-08-03. Defaults to
      **slide**, which is the one setting here that is not "today's behavior unchanged" —
      see the decisions entry.)* New enum in `shared/src/schemas.ts` beside
      `SpreadModeSchema`, a `page_transition` default and key mapping in the server's
      settings store, a "Page turn — Curl / Slide" toggle group in `ReadingTab.tsx`, and
      local state in `ReaderView` fed by the settings fetch and `onSettingsSaved` — *not*
      a prop like `spreadMode`, which is a prop only because epub.js needs it before
      mount. The whole ladder lives in one function (`resolveRenderer`) with the setting
      checked *before* the low-fps guard, which is what makes it a ceiling.
      _Acceptance: both met, live. Flipped Curl → Slide through the real Settings modal
      over a live reader — the reader's iframe never remounted, and the very next keyboard
      turn ran with max 0 canvases across 122 sampled frames (the same turn under Curl
      mounts 1). Sampled every frame through four drags and several keyboard turns in
      single-page and spread, paper and ink: max 0 throughout._
- [x] **The slide is a drag, not just a click animation.** *(2026-08-03.)* The departing
      card is a still `<img>` under the stage — the same capture as the curl, minus the
      canvas composite — and `.marginWrapper`, the live DOM already stepped to the next
      page, translates in over it. Same grab surface, same advance-at-grab, same 0.35
      threshold, same watchdog, same one exit; `useSlide` forks at exactly three points.
      In spread mode the whole stage slides (v1, stated in NOTES.md and the decisions
      entry). The slide steps back *after* its spring-back animation, the opposite of the
      fold, because its snapshot covers the whole card at progress 0.
      _Acceptance: met, live. Mid-drag at half a card (`translate3d(375.1px)` on a 754px
      card) the incoming page is in under the pointer with the departing one held still
      behind its leading edge; `prev` is the mirror. A 42%-of-card drag commits (7 → 8), a
      7% one springs back across a section boundary (8-of-8 → 1-of-7 → 8-of-8, by CFI).
      Keyboard turns play the same slide (`turnPage` → `turnPageCardSlide`); the click
      path is the same function and was **not** separately driven, because a scripted
      click lands on the epub.js iframe._
- [x] **The low-fps guard was measuring the display, not the fold.** *(2026-08-03, from an
      operator bug: "Curl curls the first page, then slides the remainder of the time.")*
      The guard tested the mean frame *interval* over the fold canvas's whole mount — a
      window that starts before `turnPageCurl` awaits its rendition step, against a 33ms
      threshold, when a healthy 60fps frame is 16.7ms. Measured: 16.6ms on a clean turn
      while the fold's own drawing cost 0.7ms. It now measures the median cost of one
      `drawPageFold` call over at least 12 drawn frames, and traces that number in dev
      builds.
      _Acceptance: four consecutive Curl turns all mount a canvas, reporting median
      0.7-0.9ms over 25-26 frames. Not confirmed on the operator's own machine — the dev
      trace exists so the next report carries its own number._
- [ ] **Two things the slide left open** (small, and neither blocks anything): the settle
      durations are the curl's 0.16s/0.18s unexamined, which is a different amount of
      travel; and no one has clicked a turn zone by hand under Slide.
      ➡️ *Moved to M27 (M25 at the time, renumbered 2026-08-12) with the rest of the fold's leftovers, 2026-08-03. Left listed here so
      step 3's record stays complete.*

#### M20 step 4 — over the spine (the WebGL question) — **designed, then parked**

The design is done and settled (decisions.md 2026-08-03 step 4: WebGL is approved, and the
proof that a spine hinge is a cone the 2D model cannot express). **The operator parked the
implementation on 2026-08-03 after signing off the curl**, so it has moved out of M20
wholesale rather than sitting here half-checked.

➡️ **It is now `M27 — The paper fold, finished`** (M25 at the time, renumbered on
2026-08-12 — see the mapping table in decisions.md), **at the end of TASKS.md**, together
with the back-of-sheet ask and the two slide leftovers. Nothing was dropped and nothing
needs re-deciding; M27 is directly executable when it is picked up.

**M20 is complete** — signed off on the Mac 2026-08-03. The two unchecked boxes left above
are step 3's leftovers, both moved to M27 (M25 at the time) and both explicitly non-blocking; they are left in
place so step 3's record reads whole.


### M20.5 — The instrument case (the Scan and the Digest become instruments)

*(Complete. The "next up" marker moved on 2026-08-04 to **M22.5**, below M22.)* This is an
implementation milestone: everything below is decided, and a Sonnet session executes it
without re-deciding any of it.

**Read the 2026-07-30 decisions entry's "Scan and Digest stop being rooms" section
first.** This changes DESIGN.md's thesis from three rooms to **two rooms and four
instruments**, deliberately and by amendment — and it spends the airlock's full-screen
form. That is settled; do not re-derive it, and do not try to keep both.

**Every dependency this milestone leans on was verified present on 2026-08-03** — checked in
the source, not assumed, because half these tasks are phrased as "reuse the thing M19.7
built" and a missing one would turn a reuse into a rewrite:

| Needed by | Exists | Where |
|---|---|---|
| the shared control set (`Button`, `IconButton`, `Slider`, `FlyPanel`) | ✅ | `web/src/controls/` |
| the two registers (paper / glass) | ✅ | `controls/registers.css` |
| fly-from-the-caller entrance | ✅ | `controls/overlayOrigin.ts`, `FlyPanel.tsx` |
| the `Slider` drag gesture the dials build on | ✅ | `controls/Slider.tsx`, `sliderMath.ts` (+ tests) |
| the shortcut registry (`q`) | ✅ | `web/src/shortcuts/useShortcuts.ts`, `keys.ts` |
| background-location routing (the pattern Settings uses) | ✅ | `app/App.tsx` — `NavigationState.background` |
| `ProviderPickerPopover`, already mounted once in the reader | ✅ | `settings/ProviderPickerPopover.tsx` |
| the one warp knob | ✅ | `scan/warp.ts` — `MAX_PULL_PX = 22` |
| the zoom domain transform to move labels onto | ✅ | `scan/zoom.ts` — `fractionToView()` |
| **the CSS `scaleX` to delete** | ✅ | `scan/HeatStrip.tsx:208` — the exact line |

Nothing here needs building from scratch. If a task below seems to call for a new component,
that is the signal to stop and check the table — settled decision 12 says a new control
belongs to a register and nothing gets a bespoke one again.

- [x] **The Scan becomes a popup in a CRT television.** The existing scan panel renders
      inside a retro TV bezel over whatever room you were in, using the **same background-
      location routing Settings already uses** — `/scan/:id` stays a real bookmarkable URL
      with a Desk fallback on a deep link. The blackout airlock is replaced by the M19.7
      fly-from-the-caller entrance; the *band materialisation* half of the airlock
      survives inside the panel.
      ⚠️ **The bezel must not warp.** It is a sibling of the filtered wrapper, never a
      child — a bending television reads as broken. Keep the frame slim; the panel needs
      the room more than the frame does.
      _Acceptance: opening the scan from the reader and from the desk both leave the room
      visible behind it; a hard refresh on `/scan/:id` still works; every existing scan
      behaviour (filters, search, stars, tags, both heat layers, the jump into the reader)
      is unchanged; the bezel's edges stay straight at every CRT intensity._
- [x] **`q` opens the scan** for the book in focus, through M19.7's registry. Larger base
      type throughout the panel — it is smaller than a full page now and was already at the
      edge of comfortable.
      _Acceptance: `q` types "q" in a text field; the scan's smallest readout passes
      contrast and is legible at the popup's default size, warped, at full CRT intensity._
- [x] **Barrel distortion scales further with CRT intensity.** Raise `MAX_PULL_PX` in
      `warp.ts` — the single knob, by design, and everything that must land where it looks
      (heat bands, hit targets, the torch's successor) already derives from it.
      ⚠️ M18's legibility bound is **not** repealed: contrast still passes, and intensity 0
      still means zero displacement. Larger type pays for some of the extra warp; it does
      not license unbounded warp.
      _Acceptance: at maximum intensity every readout is still legible and clicking a band
      near a **corner** (not the centre) still selects that band — verified with
      `elementFromPoint`, per the M18 note, not bounding-box math._
- [x] **Rebuild zoom as a domain transform, and add scroll-to-zoom.** Delete the CSS
      `scaleX` on `.zoomContent` — it is what stretches the axis text and the heat bitmap.
      Labels position through `fractionToView()` like the book bands already do, and the
      heat canvas is redrawn at the zoomed domain. Then wheel-over-the-strip zooms about
      the cursor, with the existing buttons kept and enlarged as the keyboard/pointer-free
      path.
      _Acceptance: axis labels are pixel-identical in shape at every zoom level; the heat
      field is sharp when zoomed in, not stretched; wheel-zoom keeps the domain point under
      the cursor fixed; zooming does not scroll the page behind the popup._
- [x] **The digest range picker becomes analog dials.** Replace the torch with FROM/TO
      dials in the scan's glass register — click-drag hides the cursor and scrolls a
      vertical chapter list past a needle, with the section label beneath, built on M19.7's
      `Slider` gesture rather than a second bespoke one.
      ⚠️ Unchanged constraints from 2026-07-29: the range still resolves to **whole
      sections** (the digest's storage unit), the **numeric FROM/TO boxes stay** as the
      precise input and the canonical keyboard path, and the chapter dropdown stays. The
      dials are the charm on top, never the only way in.
      _Acceptance: dialling FROM past TO is impossible or self-correcting, never a silent
      invalid range; a change made in the numeric boxes moves the dials and vice versa; the
      whole range can be set without a pointer._
- [x] **The Digest becomes a popup too, with honest labels.** `/digest/:id` renders over the
      current room with an expand-to-fullscreen control, same routing pattern. Every chapter
      is labelled **`S<n> · <title>`** — the number is the section ordinal the code already
      computes, and calling it a chapter is what produced "Chapter 5" for the real Chapter 1.
      ⚠️ `S<n>` is the **only** number that appears in any UI. If a surface still prints
      `spineIndex`, change it in this pass — two numbering schemes side by side is worse
      than the wrong one alone. Spoiler gating on titles (M19.5) is unchanged.
      _Acceptance: the same section shows the same `S` number in the digest, the scan axis,
      the range dials and the reader's chapter nav; no surface anywhere shows `spineIndex`._
- [x] **The reader's digest button gets the treatment.** M19.7's icon button, with the
      **existing** `ProviderPickerPopover` mounted on it for the `digest` role on hover
      (the query-role picker is already mounted in the reader top row — this is a second
      mount of a built component, not a new picker).
      _Acceptance: the digest role can be changed from the reader and the change is
      immediately reflected in settings and on the scan; the popover is reachable by
      keyboard and does not assume hover exists._
- [x] **Verify:** open the scan and the digest as popups from every room that can open
      them, run a real digest range from the dials, zoom and pan the strip with wheel and
      buttons, and jump into the reader from a band. Both themes, reduced motion, and at
      CRT intensity 0 and 1.

### M20.6 — Work in the background (jobs, not spinners)

**Read the 2026-07-30 decisions entry's "Background work is a job model" section first.**
This was asked for as a popup and is architecture: today's digest is one blocking request
with no id, no progress and no cancellation, and the cancel the UI appears to offer
abandons the response while the server keeps working. **Placed before M21 on purpose** —
audio rendering and the cast scan are the same shape, and AUDIO.md already specs an SSE
progress endpoint. Building this twice is exactly the duplication M19 removed for
provider pickers.

- [x] **The job registry.** One server-side registry — id, kind, resource, status,
      progress, started/finished — with an `AbortController` per job, an SSE progress
      stream, and a real cancel endpoint. The `LLMProvider` seam already accepts an
      `AbortSignal`; threading it through the digest loop is the actual work.
      ⚠️ Use `res.on("close")`, never `req.on("close")`, for disconnect detection — the
      latter fires as soon as the request body is parsed and cost this project a long
      debugging session in M5 (NOTES.md).
      _Acceptance: start a multi-chapter digest, cancel it, and watch the work **actually
      stop** (ledger rows stop appearing / the provider process exits) rather than the
      request merely returning; completed chapters are kept and no half-written chapter
      exists; a client that disconnects without cancelling does not kill the job._
- [x] **The tasks tray.** A dismissible progress popup per running job, and a persistent
      tray button (browser-downloads-style) listing running and recently finished work with
      per-job cancel.
      ⚠️ **Dismissing a popup must never cancel the job.** They are different verbs, and
      conflating them is how someone loses a forty-chapter digest.
      _Acceptance: dismiss the popup, navigate to another room, and the tray still shows
      the job advancing; cancel from the tray and it stops; a job that finishes while the
      tray is closed is visible in it afterwards._
- [x] **Every long operation goes through it.** Chapter digest (reader), range digest
      (scan), thematic re-run, theme tagging. No surface keeps a bespoke blocking spinner.
      _Acceptance: each of the four can be started, watched, and cancelled from the tray;
      starting one from the reader and cancelling it from the scan works._
- [x] **Verify:** run two jobs at once on a real book, cancel one, let the other finish,
      reload the page mid-run, and confirm the tray tells the truth throughout.

### M20.7 — The desk and the opening

- [x] **A desk you'd want to work at.** Wood grain on the surface, a paper-textured
      notepad, and a desk that is **taller** — `DeskCanvas.module.css` pins
      `min-height: 640px`, which is why it sprawls sideways and never goes down the page.
      Size it to the viewport with room to scroll.
      _Acceptance: on a tall window the desk fills the height; existing per-book shelf
      coordinates still place books where the operator left them (they are stored in px —
      confirm nothing re-lays-out on first load); the grain is a texture, not an image
      request that blocks first paint._
- [x] **The opening.** DESIGN.md's signature transition, finally built: the clicked book's
      title/cover moves to centre, the book opens, and the view zooms into the reader with
      the page filling the pane.
      ⚠️ Under reduced motion this is a plain crossfade, and it must be **interruptible** —
      Escape backs out at any point (DESIGN.md's motion rules). Nothing may block input for
      more than ~400ms.
      _Acceptance: opening a book from the desk lands on the saved position with no flash of
      an unstyled or wrong page; interrupting mid-animation leaves the app in a coherent
      state, never half-transitioned._
- [x] **Per-room cursors, including the reader's.** DESIGN.md already specifies the cursor
      system and the `cursorStyle` setting already exists — this builds it: hand/grab on the
      desk, a fine nib or pen in the reader, reticle in the scan, selectable in settings with
      a "system" opt-out.
      ⚠️ The reader's cursor is written onto the epub.js iframe's own body (the one thing we
      are allowed to touch in there) and must not fight the existing turn-zone `w-resize`/
      `e-resize` cursors — decide the precedence and write it down.
      _Acceptance: the cursor changes at every room boundary and reverts on "system"; the
      turn zones still show their directional cursor; nothing leaks a cursor into a
      neighbouring surface after the pointer leaves._
- [x] **Verify:** open three different books from the desk, drag them around, write in the
      notepad, and go desk → reader → scan → desk in one pass. Both themes, reduced motion.

### M21 — Audio I: one voice, end to end

**Read `docs/marginalia/AUDIO.md` before starting — it is binding for M21 and M22**,
the way SPEC.md is for the core. The vertical-slice rule applies: a book you can listen
to in one voice, with the page following along, before any casting exists.

- [x] **The `TTSEngine` seam + Kokoro implementation.** `server/src/audio/engine.ts`
      exactly per AUDIO.md's interface — nothing engine-specific escapes it — plus
      `kokoro.ts` using `kokoro-js` (ONNX, Node; **no Python sidecar**). Model weights
      download on first use into `data/models/` with streamed progress and a designed
      failure state; `TTSError` codes per the spec. Settings gets an audio section
      (engine, model path, default narrator voice) and a "Test voice" button that speaks
      one sentence — the audio equivalent of the provider "Test connection" button.
      _Acceptance: `voices()` returns the real voice list from the loaded model;
      `synthesize()` returns playable audio and a duration that matches it within ~5%;
      a missing/corrupt model surfaces `model_unavailable` as a designed state, never a
      crash; unit tests cover the registry and error mapping (synthesis itself is
      exercised live, not in unit tests)._
- [x] **Sentence segmentation.** `server/src/audio/segment.ts` per AUDIO.md: operates on
      `resource_text` per spine index and returns char offsets **into that exact
      string** (the same coordinate system `annotations/position.ts` already uses).
      `Intl.Segmenter` with the book-specific fixes — abbreviations, initials, and
      ellipses must not split; short sentences merge; over-long ones split at a clause.
      _Acceptance: unit tests per AUDIO.md's list, including the offset round-trip
      (`text.slice(charStart, charEnd) === segment.text`) on real fixture chapters._
- [x] **Render pipeline + cache.** Section renderer writing
      `data/audio/<resourceId>/<castHash>/<spineIndex>/` plus its manifest, keyed by the
      cast hash so nothing stale can ever be served; chapter-ahead scheduling (render the
      current section, keep one ahead warm), cancellable, with the SSE progress endpoint.
      Cache hits are decided by **file existence**, not a ledger row (the vault
      compiler's 2026-07-19 bug is the precedent). Plus `audio_state` migration and the
      audio API routes from AUDIO.md that this milestone needs.
      _Acceptance: rendering a chapter twice does no synthesis the second time; deleting
      `data/audio/` mid-session re-renders rather than erroring; navigating away aborts
      in-flight synthesis (verified by watching it actually stop, not by reading the
      code); a 10-minute chapter renders without exhausting memory._
- [x] **Player + follow-along in the reader.** Sequential segment playback in the
      browser; the playing sentence tinted via the existing anchor machinery
      (`anchorResolution.ts`) in a style quieter than all four highlight kinds; auto page
      turn using the **slide, not M10's curl**; transport controls as reader chrome
      (play/pause on `space` with the existing `isTyping` guard, skip sentence
      `shift+←/→`, skip chapter reusing `[`/`]`, speed); a "Listen" action in the desk
      hover strip and the list view. Selecting text or opening a thread pauses playback.
      Position saves through the **existing** reading-position path — one position per
      book, not two. `f` hides the tint like any other annotation-layer effect.
      _Acceptance: listen to a real chapter end to end — the tint tracks the audio, pages
      turn themselves, a chapter boundary doesn't stutter; an unresolvable sentence is
      skipped silently with audio continuing; highlighting mid-listen pauses, and asking
      a question works exactly as it does when reading; stopping and reopening the book
      with your eyes lands where the audio left off._
- [x] **Verify:** listen to 15 minutes of a real fixture book in one voice while doing
      normal reading things — pause, highlight, ask, turn back a page, resume. Note
      friction in NOTES.md. Both themes, reduced motion, and focus mode.

### M22 — Audio II: the cast

- [x] **Cast scan (pass 1).** *(2026-08-04.)* User-initiated `POST /api/resources/:id/cast/scan`
      running AUDIO.md's `CastSchema` extract through the **existing** LLM seam and
      context builder — no new provider code — then persisting the cast (`book_cast`
      migration). Deterministic code-side voice assignment from `engine.voices()`:
      narrator first, then by line-count hint and appearance order, matching gender/age,
      never reusing a voice while an unused compatible one remains.
      Goes through the **M20.6 job registry** (`kind: "cast-scan"`), not a bespoke SSE
      endpoint — same deviation the M21 render pipeline already made from AUDIO.md's
      HTTP table, for the same reason (the job registry generalizes it). Pass 1 itself
      is the digest's own book-level reduce (decisions.md 2026-07-28: "it *is* pass 1 of
      the audio cast scan"), extended with `aliases`/`gender`/`ageHint`/`lineCountHint`/
      `narratorGender` (`digest/build.ts`'s `BookReduceSchema`) — one pipeline, two
      consumers, as specified. Ensures/resumes a full-book digest first; anything short
      of `"completed"` (paused on a rate limit, a failed chapter) aborts the scan with no
      cast written, matching the half-written-cast guarantee.
      ⚠️ `ageHint` is matched by nothing — `Voice` has no age dimension at all
      (`// SPEC-GAP`, NOTES.md) — and a re-scanned character whose name the model
      rewords creates a new row rather than updating the old one (also `// SPEC-GAP`,
      NOTES.md, confirmed live: reserving *stale* rows' voices, not just locked ones',
      was a real bug this surfaced and fixed).
      _Acceptance: met. Verified live against the real Metamorphosis fixture on a local
      Ollama model — a full scan produced 6 distinct characters with 6 distinct voices
      correctly matched by gender; killing the dev server mid-digest (a real, unplanned
      failure, not simulated) left zero `book_cast` rows, confirming no half-written
      cast; re-scanning kept the four name-stable principal characters' ids and voice
      assignments byte-identical across three separate runs. Unit tests cover
      determinism, gender-compatibility fallback, never-reuse-while-unused-compatible-
      remains, and locked-voice survival across a re-scan._
- [x] **Attribution (pass 2) + multi-voice rendering.** *(2026-08-04.)* Per-section
      `AttributionSchema` extract (`audio/attribution.ts`), on demand — cached
      implicitly, by riding the same `castHash`-keyed render cache the audio itself
      uses (no separate attribution cache/table, matching AUDIO.md's "not a table").
      **The model returns the quoted string; code locates it** by exact search — never
      offsets from the model (CLAUDE.md settled decision 2). Unlocatable quote, unknown
      speaker, or a failed call all degrade to the narrator voice
      (`assignSentenceVoices`), and a whole failed section degrades to single-voice
      without blocking playback (`resolveSectionVoices`). `computeCastHash` now also
      hashes `voiceMode` and the cast's voice mapping (`render.ts`), so switching
      single→multi or changing a character's voice always invalidates old audio rather
      than silently serving it.
      ⚠️ Live verification against the real Metamorphosis fixture found and fixed a real
      bug — the source's typographic quotes/apostrophes (`“”’`) don't survive the
      model's JSON output verbatim (it straightens them), so every span failed to
      locate until `attribution.ts` normalizes both sides before matching (same
      length-preserving-swap trick as `segment.ts`'s isolated-newline fix). Also found,
      *not* a defect: quote-boundary imprecision (a model-added comma not in the
      source) and `EXTRACT_MAX_TOKENS` overflow on a very dialogue-dense whole-chapter
      call both degrade exactly as designed — see NOTES.md for the full account,
      including why the token-budget case is a logged `// SPEC-GAP` rather than fixed
      here (needs a chunking design, not a guess).
      _Acceptance: met. Live: a real attribution call against real book text produced
      correct per-character spans; the quote-normalization fix confirmed against the
      actual failing text; a full 293-sentence real render of a whole chapter completed
      end-to-end without blocking when attribution failed outright (the token-overflow
      case above, discovered before the quote-normalization fix existed) — proving the
      non-blocking-degradation path live, not simulated. Provider-failure- and
      cancellation-mid-attribution are covered by `attribution.test.ts` instead of a
      third live repro, using the same mechanism (`try`/`catch`, rethrow only on abort)
      the digest and cast-scan jobs already prove live elsewhere in this project.
      Unit tests cover verbatim match, repeated identical quotes resolving in order,
      the unlocatable case, alias matching, ambiguous-sentence-keeps-first, and the
      curly-quote regression pinned from the live find._
- [x] **Casting UI.** *(2026-08-04.)* `PUT /api/cast/:castId` added (route + schema +
      `castStore.ts`'s `updateCastVoice`, top-level per AUDIO.md's HTTP table, not
      `/api/resources/:id/...`) — always sets `voice_locked`, matching `saveCastScan`'s
      existing lock check, so an override survives a re-scan with no extra code. Cast
      list with per-character voice pickers, a preview button per row and for the
      narrator (`POST /api/audio/test-voice`, reused — `AudioTab.tsx`'s "Test voice" now
      shares the same `previewVoice` helper instead of a second copy), and the
      single/multi voice-mode toggle, all in `CastingModal.tsx`.
      ⚠️ `// SPEC-GAP` (NOTES.md): AUDIO.md doesn't say where the casting UI lives.
      Boring choice made: not a fifth routed instrument (decisions.md 2026-07-30 names
      exactly four — Scan, Digest, Settings, Annotations), so it mounts locally from a
      new "Cast" icon in the reader's transport row, sharing SettingsModal's own dialog
      shell (backdrop + `FlyPanel` + `useDialogA11y`) rather than a new one.
      _Acceptance: met. Live against the real Metamorphosis fixture and its real
      11-member cast (the same stale-duplicate-name cast NOTES.md's M22 pass-1 entry
      found): overrode Gregor Samsa's voice via the API and Grete Samsa's via the actual
      UI select — both persisted, both show "Locked", and `castHash` picked up the
      change (confirmed via `book_cast`/`audio_state` reads). Toggled single→multi→single
      through the UI, confirmed via `GET /audio` each time. Changed the narrator voice;
      persisted. Preview played with no console errors. One real bug found this way and
      not this code's own: a long-running `audio-render` job's synchronous Kokoro
      synthesis stalls unrelated API requests on the same process — starved the
      voice-mode PUT for over a minute in one run. Not fixed here (pre-existing engine
      characteristic, AUDIO.md's known native-binding/perf hazard, not new in M22);
      logged in NOTES.md. Both light and dark themes screenshotted and legible._
- [x] **The desk tool.** *(2026-08-04.)* `ListeningTool.tsx`: a real `<button>` (not a
      div) with `aria-pressed` and an accessible name, lit with a warm glow + pulsing
      needle-tip while engaged (pulse removed under reduced motion, per
      `@media (prefers-reduced-motion: reduce)` — the glow itself, not just the
      animation, is the actual "is it on" signal, so function survives). Session-only
      state in `DeskPage.tsx` (`// SPEC-GAP`, NOTES.md: DESIGN.md gives no persistence
      rule; not persisting is the safer boring default — an always-lit tool from a
      forgotten prior session is worse than a reset one), wired through `DeskCanvas` to
      `BookObject.open()` and through to `LibraryGrid`'s plain link so both view modes
      honour it; the explicit "Listen" actions (info-strip button, list-view button) are
      unconditional either way, per "the tool is the charm, not the gate." Escape
      disengages via the shared shortcut registry.
      _Acceptance: met, live (screenshots + `aria-pressed` reads, both themes). Click
      engages (`aria-pressed: false → true`), Escape disengages
      (`aria-pressed: true → false`) from anywhere on the desk, not just while the tool
      has focus. Engaged + click a book → reader opens with playback already running
      (transport button read "Pause listening" immediately). Confirmed reduced motion
      removes the needle's `animation-name` (`pulse` → `none`) while `aria-pressed`
      still flips — the toggle still works, only the motion is gone._
- [x] **Verify:** *(2026-08-04, against the real Metamorphosis fixture and its real
      cast — see the two entries above for the detailed live traces.)* Not separately
      re-driven: a fresh cast scan (the fixture's cast was already scanned and verified
      live in the pass-1 entry above; re-running one here would spend real LLM calls to
      re-prove logic `castStore.test.ts` already pins) and a full multi-voice chapter
      listen-through with the M17 tint/auto-turn/pause-on-interaction/position checklist
      (unchanged code path — `resolveSectionVoices`/`assignSentenceVoices` were M22 pass
      2's own live-verified surface, not touched by this task). What *was* newly driven:
      engaging the tool, opening a book into listening mode from the desk, opening the
      Casting popup from inside that listening session, and overriding a voice — the
      exact seam connecting this task's two pieces to M21/M22 pass 1–2's already-verified
      core.

### M22.5 — The revision pass (controls, chrome, and telling the truth)

**Next up.** Operator feedback from 2026-08-04, after living with M20.5–M22. Numbered
`.5` rather than inserted as a new M23 because renumbering M23–M25 would invalidate
cross-references in five documents (OPUS.md's rule); it runs **before** M23.

**Read the 2026-08-04 decisions entry ("The revision pass") first** — it holds the
reasoning for every ruling below, including the three places the operator's diagnosis and
the actual cause differ. Two DESIGN.md sections were amended in the same pass (the control
system gains the slider's resting form and the chrome-row rule; the motion language's
"the opening" bullet is rewritten) — those are the standing specs, this is the work.

This is an implementation milestone: everything below is decided. Nothing here needs a new
control — settled decision 12 still holds, and every item that looks like a new component
is a change to an existing one in `web/src/controls/`.

#### A — One slider, one look

The operator's `%` dial is the aesthetic everything else should have had. It already
exists (`Slider` `variant="trigger"` + `ScrubDial`); the work is promoting it to the
default and retiring the track.

- [x] **The slider's resting form is a readout, not a track.** `controls/Slider.tsx`'s
      default variant becomes `"readout"` — the formatted value flanked by dim chevrons
      (`‹ 8,192 tokens ›`) that brighten on hover — replacing the fill/thumb track in
      `Slider.module.css`. `variant="trigger"` is unchanged (the reader's `%`). The prop's
      `"track"` member is **renamed**, not kept as an alias: a name that describes a
      rendering nobody renders is the "comment that outlived the code" failure this project
      keeps hitting.
      ⚠️ The chevrons are `aria-hidden` decoration, not buttons. Arrow keys already step
      the value and `role="slider"` already announces it; making the chevrons clickable
      adds a third input mode and two more accessible names to keep honest.
      _Acceptance: no call site passes `variant` for the readout form (it is the default);
      `SettingsPage.test.tsx` and the existing `role="slider"`/`aria-valuetext` assertions
      still pass unchanged; at rest the control shows its value as text with no track,
      fill or thumb anywhere in the DOM._
- [x] **The drag dial is shared, and it sits centred under the control.** `ScrubDial` moves
      to `controls/SliderDial.tsx` and becomes what *every* `Slider` shows while dragging —
      the ruler scrolling under a fixed needle, the live value above it, positioned centred
      beneath the control that spawned it. `Slider`'s own `.floatingReadout` (which sits
      *above* the thumb) is deleted; the reader keeps its chapter ticks by passing them in.
      ⚠️ **The ticks must be laid out in the slider's own position space**, via
      `sliderMath.ts`'s `valueToPosition` — a linear ruler under the log2 context-window
      slider is wrong at both ends of the range.
      ⚠️ **Derive the ruler's pixels-per-unit from the slider's `dragPxPerUnit`, not from a
      constant.** `DIAL_PX_PER_PERCENT = 6` is today shared by hand between `ScrubDial`'s
      rendering and `ReaderView`'s drag math precisely so the ticks track the pointer 1:1;
      a generalised dial that keeps its own constant will drift against every slider whose
      rate differs.
      _Acceptance: dragging any slider hides the cursor (pointer lock, unchanged) and shows
      one dial centred under it; the tick under the needle at drag start is the value the
      control read before the drag; on the log2 context slider, one octave of drag moves the
      ruler by the same distance at 2,048 and at 131,072._
- [x] **Detent capture gets an absolute mode — the response-length ask cannot be expressed
      without it.** `nearestDetent` (`controls/sliderMath.ts`) captures within
      `detent * captureFraction`, a *fraction of the detent's own value*. The operator asked
      for snapping every 500 tokens with a **±25** window; as a fraction that is 5% at
      detent 500 and 0.25% at 10,000 — one number cannot be both. Add a second capture mode
      (`{ absolute: number }` alongside `{ fraction: number }`), keep the fractional one as
      the default, and pin both with tests.
      _Acceptance: a unit test asserts a ±25 window holds at detent 500 **and** at detent
      10,000; the existing log2 capture tests are unchanged._
- [x] **The response-length slider is broken, and the cause is not the slider.** *(Operator
      bug: "cannot change the LLM response length using the slider, only by retyping into
      the box".)* `ProviderPicker.tsx`'s `handleMaxResponseTokensCommit` PUTs the raw
      committed value; a drag commits a **float**; `MaxResponseTokensSchema`
      (`shared/src/schemas.ts:525`) is `.int()`; the server 400s;
      `setRoleMaxResponseTokens` returns `null` and the failure is swallowed. Typing "5000"
      produces an integer, which is why the box works. The context slider one field up does
      `Math.round(value)` at its own call site (`ProviderPicker.tsx:258`), which is why *it*
      works — and is the duplication that hid this.
      Fix it in the control, not at the call site: `Slider` takes a `step` and quantises
      **both** the preview and the commit. Then **make the silent failure loud** — a save
      that returns null must surface, not vanish.
      _Acceptance: dragging the response-length slider changes the persisted value (confirm
      by re-opening Settings, not by watching the readout); the readout never shows a
      fraction mid-drag; with the endpoint stubbed to 400, the UI says the save failed._
- [x] **Every remaining slider moves onto the control, with the settings in the table below.**
      The two native `<input type="range">` survivors are `tabs/ScanTab.tsx:15` and
      `tabs/ReadingTab.tsx:97`; the two `Slider` call sites are in `ProviderPicker.tsx`.
      ⚠️ CRT intensity 0 must still mean *exactly* zero displacement (M18's bound, restated
      in M20.5) — with `step: 0.01` the slider can land on 0.00 exactly; do not introduce a
      floor.
      _Acceptance: all four drag, type, arrow-step and snap as specified; text size still
      lands only on values the reader already supported; the scan at intensity 0 renders
      identical pixels to before this change._

| Slider | Where | Scale | Range | Detents | Capture | Step |
|---|---|---|---|---|---|---|
| CRT intensity | `ScanTab` | linear | 0–1 | none | — | 0.01 |
| Text size | `ReadingTab` | linear | 0.8–1.6 | every 0.05 (today's `step` — the predetermined sizes) | absolute 0.012 | 0.01 |
| Context window | `ProviderPicker` | log2 | 1,024–200,000 | powers of two | **fraction 0.05** (up from 0.03) | 1 |
| Response length | `ProviderPicker` | linear | 250–10,000 | every 500 | **absolute 25** | 1 |

#### B — Where the buttons live

- [x] **Nothing else is fixed to the top-right corner.** *(Operator: "make sure the nav
      buttons aren't sitting above the other buttons" — confirmed in the operator's desk
      screenshot, where the cluster overlaps Desk/List and Import book.)* `NavCluster`
      renders one fixed **chrome row**; a room contributes its own actions into a leading
      slot in that row via a portal, left of the permanent icons. The Desk's `.headerRow`
      actions (`DeskPage.tsx:106-130` — the Desk/List toggle and Import book) move there.
      This is the rule, not just this fix: *a room's global actions join the chrome row;
      nothing else may occupy that corner.*
      _Acceptance: at 1280×800 and 1024×640, on the Desk, the reader, the Scan and the
      Digest, the nav cluster's `getBoundingClientRect()` intersects no other interactive
      element's rect — measured, not eyeballed. The Desk heading ("The Desk"/"Library")
      stays where it is; only the actions move._
- [x] **The reader's book actions become a floating bottom-right cluster.** Digest, the
      digest `ProviderPickerPopover`, Scan and Publish leave `ReaderPage.tsx`'s `.titleBar`
      (lines 200–239) for a floating cluster in the bottom-right: icon-only at rest, each
      label sliding out on proximity. Reuse `KeyCap.module.css`'s proximity-reveal mechanic
      rather than writing a second one. Digest and Scan already have icons (`BrainIcon`,
      `MagnifierIcon`); Publish needs one — see the icon task below.
      ⚠️ **The landmine: the bottom-right corner of the *card* is the page fold's grab
      anchor.** The M20 grab surface lives inside `.pageClip` (`inset: 0` within `.stage`)
      and a corner grab there is what folds the bottom-right corner. So the rule is not an
      inset in pixels, it is a boundary: **the cluster never overlaps `.stage`'s rect.**
      That makes the conflict structurally impossible instead of tuned.
      Where it actually sits, in order: in the empty room to the **right of the card** when
      the window is wider than `--reader-max-width` (the common case — `.wrapper` centres a
      max-width column, so that room already exists); when it isn't, **below the card**,
      right-aligned on the footer's line, which is outside the stage too.
      ⚠️ In fullscreen (`fullscreenMode`) the page grows into the freed space and "outside
      the stage" stops being available — there the cluster joins M14's proximity-revealed
      floating set (`.footerFloating`/`.marginRailFloating` are the pattern), so at rest it
      is not on the page at all and the grab surface is unobstructed.
      _Acceptance: at 1440px, 1100px and 900px window widths, and in fullscreen at rest,
      the cluster's rect does not intersect `.stage`'s rect — measured; a fold started from
      the card's bottom-right corner initiates at every one of those widths; labels are
      revealed by proximity **and** reachable by keyboard focus (not hover-only); nothing
      in the cluster overlaps the footer's page-turn chevrons at any pane width._
- [x] **The annotations rail scrolls, and it keeps to the top half.** `MarginRail.module.css`
      caps the rail at 50% of the reading pane's height, top-aligned, with its own
      `overflow-y: auto`. The fullscreen proximity reveal around it (`ReaderView.tsx:2507`)
      is unchanged.
      _Acceptance: a book with 40 highlights on one section scrolls the rail rather than
      running past the pane; wheeling over the rail does not turn the page or scroll the
      room behind it; the rail's dots still sit beside the text they belong to._
- [x] **The three theme buttons read as one control.** *(Operator's own first instinct, and
      the choice they confirmed over a single hover-revealing button — the cluster is
      already gaining hover-revealed labels in the reader, and a third disclosure mechanic
      in the same pass is one too many.)* `NavCluster`'s `.themeGroup` becomes a segmented
      control: one recessed pill, hairline dividers, a sliding active thumb. It keeps
      `role="group"` and three real buttons.
      _Acceptance: the group reads as one object at a glance and as three buttons to a
      screen reader; keyboard focus still lands on each option individually._
- [x] **Two icons that lie, and one that doesn't exist yet.** `GearIcon`
      (`controls/icons.tsx:64`) is a circle with eight radial ticks — the same drawing as
      `SunIcon` (`icons.tsx:102`) at a different radius, two slots away in the same cluster.
      **`GearIcon` is the one that's wrong**: `SunIcon` is the Paper (light) theme option in
      `NavCluster`'s `THEME_OPTIONS` and a sun is exactly what it should be. Draw a real cog
      — toothed outer profile, hollow centre — and the collision resolves itself.
      `TrayIcon` (`icons.tsx:81`) is an inbox with a down-arrow, i.e. a downloads icon for
      something that is not downloads; replace it with an activity ring whose filled arc is
      the running jobs' aggregate progress, so the icon carries the state the badge carries
      alone today.
      New `PublishIcon` for the reader cluster, per the operator: **a cardboard carton with
      an arrow entering it from the left** — packing what you've learned into the vault.
      ⚠️ An arrow *into* a container is also the conventional archive/import glyph, and the
      retired `TrayIcon` was exactly that shape. Give the carton visible flaps and a
      three-quarter box, not a plain rectangle, so it reads as a parcel rather than as the
      inbox we just removed.
      _Acceptance: at 18px, no two icons in the nav cluster share a silhouette, and neither
      the publish carton nor the tray ring resembles the retired tray icon; the tray icon's
      ring visibly advances during a real multi-chapter digest._

#### C — Settings opens and closes cleanly

- [x] **`s` is a toggle.** *(2026-08-05.)* *(Operator: pressing `s` twice does something
      strange; exiting then takes two goes.)* `NavCluster`'s `s` handler closes settings when
      `location.pathname === "/settings"` instead of navigating again.
      ⚠️ It reaches `NavCluster` at all because `SettingsModal` claims only Escape
      (`useDialogA11y` registers exactly one binding), so `s` falls straight through the
      scope stack to the cluster underneath. That is by design; the toggle is the fix, not a
      new scope.
      _Acceptance: met. `openSettings` is the one function both the click handler and the
      `s` keyboard binding call, so the toggle covers both paths by construction — verified
      with a real React-Testing-Library render of the whole `App` (not a mock, `App.test.tsx`)
      and, live, against the actual running dev server (Playwright/headless Chromium against
      `localhost:5173`, real library with real books): clicked the gear (URL → `/settings`),
      pressed `s` (URL → `/`, modal gone, Desk visible), no console errors. Opening from a
      live reader specifically (rather than the Desk) wasn't separately driven — the logic
      doesn't branch on which room it was opened from, so this is a low-risk gap, not a
      claim of full coverage._
- [x] **`/settings` may never be its own background — and the Scan must survive one anyway.**
      *(2026-08-05.)* Root cause of "the background jumps to the library, even from
      reader/scan view": `findOverlayPathname` (`App.tsx:47-51`) looks **one level** deep for
      an open Scan/Digest, while `roomLocation` (`App.tsx:59-67`) walks the whole `background`
      chain. Stack a second `/settings` on a `/settings`-over-`/scan/:id` and `scanPathname`
      goes null — the Scan unmounts and the room beneath it (the Desk, in list mode: the
      library) is what you see. The extra history entry is the "delay on exit". Fixed both
      ends: `openSettings` refuses to push `/settings` over `/settings` (the toggle above
      covers the keyboard path; the click path goes through the same function), and
      `findOverlayPathname` now walks the whole chain the way `roomLocation` does (it no
      longer takes a separate `background` argument — it reads the chain off `location`
      itself, so it can't be called with a stale one-level `background` by accident).
      _Acceptance: met. `findOverlayPathname` is exported and unit-tested directly against a
      constructed Settings-over-Settings-over-Scan location chain (`App.test.tsx`), the exact
      shape the bug was in — it still finds the Scan three levels down. Not separately driven
      through an actual Scan-then-Settings-twice sequence in a live browser this pass; the
      toggle fix above means a real four-`s` sequence can no longer even construct that
      stacked shape in the first place, and `s`/settings itself was confirmed live (previous
      item)._

#### D — The tasks tray tells the truth

- [x] **The tray is live for jobs it did not start.** *(2026-08-05.)* *(Operator: pressing
      play renders audio but nothing appears in the tray until a reload.)* `JobsContext`
      learned about jobs from exactly two places — `registerStarted` (five call sites) and a
      one-shot `fetchJobs()` at mount — and `usePlayer.ts:140,343` subscribes to the
      audio-render job's own SSE **directly**, never registering it. Added a registry-wide
      event stream (`GET /api/jobs/events`, emitting `event: created`/`event: updated` for
      every job — must be registered before `/:id` in `routes/jobs.ts` or Express reads
      "events" as an id) and subscribed to it once in `JobsProvider`; the old per-job
      `ensureSubscribed` machinery is gone, replaced entirely by the one stream.
      ⚠️ **Watching is not owning** (`jobs/registry.ts`'s stated invariant): the registry-wide
      stream must not create, extend or cancel anything, and a client dropping off it must
      not stop work.
      ⚠️ **Do not auto-toast from the stream.** Toasts stay opt-in through `registerStarted`,
      or chapter-ahead audio rendering pops a popup over the reader every few minutes —
      which is the blocking-spinner-over-the-text failure in a new costume.
      _Acceptance: met. `subscribeAllJobs`/`emitGlobal` are unit-tested against the real
      registry — a listener attached before two jobs start sees both `created` events and
      each one's `updated`/completion, and unsubscribing never changes a job's outcome
      (`registry.test.ts`). Live: hit directly against the actual running dev server
      (`curl .../api/jobs/events`): 200, `Content-Type: text/event-stream`, headers flush
      immediately. Also watched from the real browser's own network log (Playwright against
      `localhost:5173`) through a full open-settings/close/open-tray/close-tray pass: the
      connection opens once on `JobsProvider` mount and stays open (`pending`) throughout,
      only ending as `net::ERR_ABORTED` when the browser itself closed — exactly the
      "watching is not owning, and the stream doesn't end on its own" contract. No job was
      actually started this pass (no digest/render kicked off), so the two-tab and
      no-reload-on-a-real-job scenarios specifically weren't driven end-to-end — but the
      one mechanism both depend on (the stream delivering every job to every subscriber,
      including one it didn't start) is what `registry.test.ts` proves._
- [x] **A job says what it is working on.** *(2026-08-05.)* `Job` gains a `detail` set at
      start and stable for its lifetime, distinct from `progress.message` (live, changes per
      item): a range digest and the cast scan (itself a whole-book range digest under the
      hood) carry their endpoints via the new `sectionRangeUiLabel`, an audio render carries
      its one section via `sectionUiLabel` — both in `llm/context.ts`, beside `sectionLabel`,
      numbering by ordinal position in the fetched `sections` array (never by `spineIndex`).
      Set at four of the five `startJob` call sites (`routes/digest.ts` digest + thematic,
      `routes/audio.ts` cast-scan + audio-render); `theme-tagging` has no single natural
      range, so it's left at `detail`'s default (`null`), which the registry's own comment
      names as the intended reading for that case.
      ⚠️ Section labels are **`S<n> · <title>`** and nothing else — M20.5 made that the only
      number permitted in any UI, and "0 of 2" with no range is the exact confusion this
      fixes. No surface prints `spineIndex`.
      _Acceptance: met. `sectionUiLabel`/`sectionRangeUiLabel` are unit-tested, including the
      case that matters most — a gap in spine indices must not shift the ordinal — and
      `registry.test.ts` confirms `detail` is stable across a job's full lifecycle
      (`startJob(...)` through to `finish()`'s rewrite of `.public`) and defaults to `null`
      when omitted. Not confirmed against a real digest/render live this pass — that needs an
      actual LLM/TTS call, not just a running dev server — but the string these helpers
      produce is exactly `S4 · The Trial → S5 · The Verdict`, the acceptance example, by
      construction of the test above._
- [x] **Hovering a task row explains the job.** *(2026-08-05.)* Kind, book, range or section,
      started-at, elapsed, and the current item — always present in each row's DOM (a screen
      reader reads it with no hover at all) and visually revealed by `.row:hover` /
      `.row:focus-within` in `TasksTray.module.css`; the row itself is `tabIndex={0}` so
      focus-reveal doesn't depend on the Cancel button existing (a finished job has none).
      _Acceptance: met by construction — `JobRowDetail` renders unconditionally into the row
      (not behind a hover-only portal), so "reachable by keyboard" and "a finished job still
      shows what it was" both hold structurally rather than needing a timing-sensitive live
      check. `job.detail` is shown under "Range" for both endpoints. The tray itself was
      confirmed live (previous item, `t` toggling it open against a real book library) but it
      had no jobs in it during that pass, so a row's hover/focus reveal specifically wasn't
      screenshotted live — the empty-state screenshot is in NOTES.md instead._
- [x] **`t` toggles the tray.** *(2026-08-05.)* Registered through `shortcuts/keys.ts` +
      `useShortcuts` in `TasksTray.tsx` (which already owned the `open` state), with a
      `KeyCapAnchor` around the trigger like Settings' gear icon.
      _Acceptance: met. `useShortcuts`' own `allowWhileTyping` default (false) is what makes
      "types a 't' in a text field" hold — unchanged, shared machinery, already covered by
      that hook's existing behavior. Live: Playwright against the real running dev server —
      `t` opened the tray (`role="dialog" name="Tasks"` became visible), a second `t` closed
      it, with a `KeyCapAnchor` "T" hint rendering next to the tray icon throughout._

#### E — `d` for the Desk, `l` for the Library

- [x] **Both keys work from anywhere, including from on top of an instrument.** New entries
      in `SHORTCUT_KEYS`; `d` lands on the Desk in desk view, `l` on the Desk in list view.
      ⚠️ **They are the same route.** `/` is `DeskPage`, and the view mode is local state
      seeded from `localStorage` (`DeskPage.tsx:14-19`) — so these keys must *set the mode*,
      not merely navigate. Lift it into a small module with a subscribe/emit, following
      `settings/settingsBus.ts`, which is the pattern this codebase already uses for exactly
      this; do not write to `localStorage` from the keypress and hope `DeskPage` re-reads it.
      ⚠️ **From inside the Scan or the Digest, the instrument must close first.** Those
      overlays only claim Escape, so a bare `navigate("/")` leaves the popup mounted over
      the room it no longer belongs to.
      _Acceptance: `d` from the reader lands on the desk in desk view; `l` from the reader
      lands in list view; `d` from an open Scan closes the Scan and lands on the desk;
      neither fires while typing in the notepad, a thread composer or a settings field._

#### F — The opening actually opens

- [x] **The cover opens into a spread, and the spread becomes the page.** *(Operator is happy
      with the flight to centre; the flutter is not what was asked for.)*
      ✅ **Delivered by M23 §E on 2026-08-13** — read the outcome there, not here. All four
      ⚠️ warnings below survived the move into three.js: the 3D lives in the shared canvas
      rather than on `FlyPanel`'s flown node (so the fight it warns about cannot happen),
      the spread is blank paper in the reader's own `--color-bg`, the `contentReady` gate
      is untouched, and reduced motion still renders zero canvases with Escape live at
      every phase. The 2D presentation this section describes is now the lost-context and
      reduced-motion path, and its `.spread` defect was fixed there too.
      ⚠️ **Absorbed into M23 §E on 2026-08-12, not failed and not abandoned** (M23 was M26
      until the same-day renumbering — see decisions.md). Most of it is
      built (`BookOpening.tsx` already flies, rotates about the spine and lands); the
      remaining defect is that `.spread` is cover-width and creased down its middle. Since
      M23 moves the opening onto three.js, finishing it here would build it twice in two
      substrates. **Two things below change under M23 and must be read there, not here:**
      the ≤2px spine-edge criterion is rescoped to the scene's local coordinates (the book
      now deliberately recentres on screen), and the sequence is deliberately slowed. Kept
      in place because its four ⚠️ warnings below are still live and still correct.
      `BookOpening.tsx`
      keeps the fly (`FlyPanel`, 240ms) and replaces `PAGE_OFFSETS`'s four flat planes with a
      real open: the front cover rotates anticlockwise about its **left (spine) edge**
      toward the viewer, revealing a two-page spread beneath, which then scales and
      translates onto the reading pane's rect and crossfades to the live reader.
      ⚠️ **The 3D must live on a child of `FlyPanel`, never on the flown node itself.**
      `motion` is already writing `transform` to that node for the layout flight; a
      `preserve-3d` rotation on the same element fights it, and the symptom is a cover that
      jumps rather than opens.
      ⚠️ **Blank paper planes, not real pages.** DESIGN.md already rules the opening's pages
      fake, and PAGE_CURL.md is the record of what real paper motion costs. The revealed
      spread takes the reader's own paper colour and carries no text.
      ⚠️ **Keep the `contentReady` gate** (`BookOpening.tsx:68-72`) — it is the only thing
      standing between the reveal and a flash of "Loading book…". The open plays while the
      reader loads underneath; the *reveal* still waits.
      ⚠️ Reduced motion stays a plain crossfade with zero 3D transforms, and Escape still
      cancels at any phase (`BookOpening.tsx:74-85`).
      _Acceptance: the spine edge's x moves less than 2px through the whole rotation
      (measured); the revealed spread's final rect matches the reader pane's within a few
      px; the whole sequence from click to readable page stays inside DESIGN.md's ~400ms
      input-blocking bound; Escape during fly, open and zoom each leave no overlay mounted
      and the app in a coherent state._

#### G — What is rendered, and getting rid of it

- [x] **The Digest shows which sections have audio.** *(2026-08-05.)* A per-section "rendered"
      column for the current cast hash, with sizes and a book total, behind a new
      `GET /api/resources/:id/audio/sections`. `listCachedSpineIndices` (`audio/render.ts:123`)
      and `getSectionManifest` (`render.ts:84`) already do the work.
      ⚠️ **Cache truth is file existence, never a ledger row** — M21's rule, and the vault
      compiler's 2026-07-19 bug is why.
      _Acceptance: met. Live against the real dev server and Metamorphosis: a fresh render was
      driven to completion and the Digest, already open in the same tab, flipped that
      section's row to "Rendered · 8.0 MB" with a "Delete audio" link, no reload — matching
      the actual byte count `du` reported. The summary bar read "Audio rendered: 8.0 MB across
      1 of 5 sections" with the other four rows "Not rendered", no delete-all button shown
      while total was 0 (it's conditional on `totalBytes > 0`). Voice-change → cast-hash
      invalidation wasn't separately re-driven this pass — it falls out of `currentCastHash`
      being the same hash the render/cache functions already key on, unchanged by this work._
- [x] **Rendered audio can be deleted from the app.** *(2026-08-05.)* Per section and per book:
      `DELETE /api/resources/:id/audio/sections/:spineIndex`, with
      `deleteResourceAudioCache` (`render.ts:129`) already covering the whole book.
      ⚠️ **Deleting what is playing or rendering is a designed state**: cancel the render job
      first, and the player degrades to "not rendered" rather than 404-ing mid-sentence.
      ⚠️ **Scope ruling, so it is not relitigated:** rendered audio only. `data/audio` is 12MB
      for one partly-rendered book against 40KB of digests — it is the only real space cost.
      **`resource_text` is out of bounds**: it is the coordinate system every highlight
      offset, audio segment and digest anchors into, and deleting it rots annotations
      (settled decision 5, immutable-on-import). Digests are out of scope here too — small
      on disk, expensive in tokens to rebuild.
      _Acceptance: met. Live: `DELETE .../audio/sections/2` on Metamorphosis, confirmed via
      `du` before/after that the 8.3MB actually left disk, not just the API's own say-so;
      `POST` on the same section afterward returned a fresh `jobId` (not `{cached:true}`) and
      re-rendered to the identical byte count. A second section, deleted ~1s after its render
      started, had its job transition straight to `cancelled` with no partial directory left
      on disk. `usePlayer.ts`'s job handler now reads a `cancelled` render as `idle`, not
      `error` — the "degrades to not rendered" case is a render getting cancelled by a delete
      before any segment played; a render cancelled after segments already played just runs
      off the end of the manifest normally, which was already the code path._

#### H — Which model actually answered, and what it really cost

**The premise needs correcting before any of this is built.** *(Operator: "I chose Qwen,
and when I asked what LLM I was asking a question to, it said it was part of the Anthropic
family.")* A model's self-report is **not evidence of anything**. Models are trained on each
other's outputs and have no privileged access to their own identity; a Qwen served over an
OpenAI-compatible endpoint will claim to be Claude, and no system prompt reliably fixes it.
So the question "prove what LLM we are using" cannot be answered by asking the model. It has
to be answered from the transport — which this project is already most of the way to, because
the usage ledger records `provider` and `model` on every call (`llm/usage.ts`'s
`UsageLedgerRow`, written by `recordUsage`). Two things are missing.

- [x] **Record what the endpoint says it served, not only what we asked for.** *(2026-08-05.)*
      `openaiCompat.ts:154,202` sends `this.config.model` and the ledger stores that same
      configured string — so a misconfigured or silently-substituting endpoint is invisible.
      OpenAI-compatible responses echo a `model` field; record that when present, fall back
      to the configured string, and record which of the two it was.
      _Acceptance: met. `LLMProvider` gained an optional `reportedModel()`; `openaiCompat.ts`
      captures it from the streaming SSE chunks (new `modelSink` param on
      `parseOpenAICompatSSE`, independent of `usageSink`) and from the non-streaming
      `extract()` body. `withUsageLedger` records `servedModel ?? model` plus a `modelSource`
      ("endpoint"/"configured") column (migration 23). Live: a real question against the
      local Qwen profile logged `model: "qwen3.5-hermes:latest"`,
      `model_source: "endpoint"`; unit tests (`openaiCompat.test.ts`, `usage.test.ts`) cover
      the model-sink capture and the configured-string fallback when an endpoint sends none._
- [x] **Every answer carries its provenance.** *(2026-08-05.)* A quiet byline under each
      assistant message in `ThreadPanel.tsx`: profile name · provider · served model ·
      endpoint host — derived from that message's own ledger row, never from whatever the
      settings UI currently holds.
      ⚠️ `llm_usage` has `resource_id` but no message or thread id, so there is no way to
      join a row to the answer it produced. That is a migration, and it is the actual size of
      this task.
      _Acceptance: met. Migration 23 adds `message_id`; `recordUsage` now returns the full row
      (id included) so `routes/threads.ts` can `linkUsageToMessage` once the answer is
      persisted, and the SSE `done` payload carries `provenance` built from that same row
      (`buildMessageProvenance` in `usage.ts`) — no extra round trip. A page reload reads the
      same shape via a `LEFT JOIN llm_usage ... LEFT JOIN provider_profiles` in
      `listMessagesForThread`. Live, against a real Kafka on the Shore thread: the SSE `done`
      event and a subsequent plain `GET /api/threads/:id` both returned
      `{profileName: "Qwen3.5", provider: "openai-compatible", model: "qwen3.5-hermes:latest",
      endpointHost: "localhost:11434"}` for the new message, while the thread's four
      pre-migration messages all came back `provenance: null` with no crash — screenshotted in
      the reader as "Qwen3.5 · local · qwen3.5-hermes:latest · localhost:11434" under the
      answer. Switching roles mid-thread to compare two different bylines side by side wasn't
      separately driven this pass (only one profile is configured on this machine) — the
      per-message (not per-thread) join is what makes that case work, and it's the same code
      path just exercised twice._
- [x] **Say it where the confusion starts.** *(2026-08-05.)* One line under the profile in
      Settings/LLM: models routinely misreport their own identity, and the name shown comes
      from the endpoint rather than from the model. Cheap, and it is the honest answer to the
      question that was asked.
      _Acceptance: met. Live screenshot of Settings → LLM shows the line ("Models routinely
      misreport their own identity — a local model can and will claim to be Claude. The name
      shown next to an answer comes from the endpoint you configured here, never from what the
      model itself says it is.") directly above the two role pickers._
- [x] **The Usage divider's dollar figure is backwards.** *(2026-08-05.) (Operator: "the
      ledger showed a cost under last 7 days — I thought a Claude subscription plus a local
      LLM meant no API costs?" They are right, and the ledger is wrong in an interesting
      way.)* `costUsd` is populated from exactly one place — `claudeAgent.ts:149,193`, taking
      the Agent SDK's `message.total_cost_usd`, which is a **notional API-equivalent price**
      for usage a subscription does not bill per token. Meanwhile `anthropic.ts` (the keyed
      API, where money is genuinely spent) reports **no cost at all**, and
      `openaiCompat.ts:117` documents that it never populates it. So the one number on that
      card is the one place you aren't billed, and real spend reads as nothing.
      Fix by making the row say what kind of number it is: cost gains a **basis** —
      `billed` (keyed API), `notional` (subscription; what this would have cost on the API),
      or `none` (local). The Usage divider totals **billed only**, and shows notional
      separately and labelled, never added in.
      ⚠️ Do not "fix" this by dropping the Agent SDK's number — it is genuinely useful ("what
      is this subscription saving me"), it just isn't spend.
      ⚠️ A keyed Anthropic profile reporting no cost is a **second, independent gap**: it has
      real token counts and no price attached. Either price it from a table or leave it
      explicitly unpriced — but do not let "no cost recorded" keep reading as "free".
      _Acceptance: met. New `llm/pricing.ts` (`priceCall`) decides basis by provider id:
      `claude-agent` → `notional`, `anthropic` → `billed` (priced from a small hand-maintained
      table) or `unpriced` when the model isn't in it, `openai-compatible` → `none`.
      `UsagePeriod` carries `billedCostUsd`/`notionalCostUsd` separately (migration 23 adds
      `cost_basis`, backfilled from `provider` for existing rows). Live, against this
      session's own real ledger data (a Qwen local profile plus a Claude Code subscription
      profile, no keyed API profile configured): "Last 7 days" showed **billed $0.00** with a
      separate "+ $0.46 notional (... not spend)" note, exactly the acceptance case, on real
      data rather than a fixture. The `unpriced`/`billed` keyed-API paths aren't driven live
      (no `anthropicApiKey` on this machine) — covered by `usage.test.ts` instead._
- [x] **The ledger breaks down by provider and model, not just book and operation.**
      *(2026-08-05.) (Operator's ask, and the data is nearly all there already.)* `llm_usage`
      records `provider`, `model`, `cache_read_tokens` and `duration_ms` per row — but
      `getUsageBreakdownSince` groups only by `resource_id, operation, role`
      (`llm/usage.ts:173`) and `UsageBreakdownRow` carries neither provider nor model, so
      none of it reaches the UI. Widen the grouping and the row, and let the divider group by
      provider/model with a sort.
      Per group: **local** (openai-compatible) shows tokens and **tokens/sec** — derivable
      today from `output_tokens / duration_ms`, no new column; **hosted** shows model, calls
      and tokens, with cost broken into **input / cached-input / output** where the provider
      reports it (`cache_read_tokens` is already stored and already dropped on the floor by
      the breakdown).
      ⚠️ **"Is this local?" cannot be answered from the row.** `provider` is one of three
      ids, and `openai-compatible` covers both a local Ollama and a hosted OpenRouter — the
      distinguishing fact is the base URL, which lives on the profile, and the ledger has no
      profile id. Add `profile_id` to `llm_usage` **in the same migration as the message id**
      the byline above needs; pre-M22.5 rows keep null and are grouped as "unknown profile"
      rather than guessed at.
      _Acceptance: met, with one narrowing noted. `getUsageBreakdownSince`'s `GROUP BY` widened
      to include `provider, model, profile_id`; the Usage divider's new "by provider & model"
      table re-rolls those same rows client-side (`groupByProviderModel` in
      `UsageDivider.tsx`) with a sort toggle (tokens / name). Live: the real table showed a
      local Qwen group and a Claude Code (subscription) group side by side, with the local
      group's row deriving tok/s from `output_tokens / duration_ms` and the hosted group
      showing its cache-read total (13,927 / 10,336 tokens on two rows) separately from fresh
      input, and rows with no linked profile (pre-migration) grouped rather than dropped.
      **"Is this local?" is unchanged from the pre-existing definition** (`provider ===
      "openai-compatible"`, same as `RolePlanLimits.isLocal` already used) — `profile_id` now
      makes a real base-URL-based classifier *possible*, but building one was out of this
      task's scope; recorded in NOTES.md rather than silently narrowed._

#### Verify

- [x] **Drive it, don't read it.** Every slider dragged, typed, arrow-stepped and snapped in
      the real app; `s`/`t`/`d`/`l`/`q` pressed from every room and from on top of every
      instrument, and each one typed into a text field to prove the guard; a book opened from
      the desk in both themes and under reduced motion; a chapter played from cold to watch
      the render job appear in the tray unprompted, then deleted and played again. Both
      themes, reduced motion, and at CRT intensity 0 and 1. Log what was driven and what was
      only read, per OPUS.md.

### M22.6 — Telling the truth, and slipping the leash (2026-08-12)

Inserted here rather than appended: it is the operator's chosen next work
(decisions.md 2026-08-12, ruling 9), and inserting a new number in an existing gap
renumbers nothing. **Read that entry first** — five of these tasks are small
specifically because the reported cause was wrong, and the corrections are there.

Nothing in this milestone needs a new dependency. If a task here seems to require one,
it has been misread.

#### A — Instruments toggle, and every instrument has a key

- [x] **`q` closes the Scan it opened, and the Digest gets `g`.** Add `digest: "g"` to
      `shortcuts/keys.ts` (`d` and `l` are taken by Desk/list). The Scan's binding in
      `ReaderPage.tsx:144` currently always navigates, so a second `q` pushes
      scan-over-scan — **the identical defect fixed for Settings on 2026-08-04**.
      ⚠️ **Reuse `NavCluster.tsx`'s `openSettings` shape; do not write a second
      already-open check.** That function is the one branch that owns "we are already
      there" (`navigate(-1)` when a background location exists, else `navigate("/")`),
      and the whole point of the 2026-08-04 fix was that this check exists once.
      ⚠️ The Scan and Digest overlays claim only Escape (`useDialogA11y`), so a bare `q`
      pressed *while the Scan is open* falls through the scope stack to `ReaderPage`'s
      still-mounted binding — that is the path that must close, not re-open.
      _Acceptance: from the reader, `q` opens the Scan and `q` again returns to the
      reader (not to a second Scan, and not to the Desk); same for `g` and the Digest;
      `s` and `t` still toggle exactly as they do today; every one of the four is
      reachable from both the Desk and the reader._
- [x] **Each of the four keycaps is advertised where its control is.** `KeyCapAnchor`
      already exists and the Tasks/Settings icons already use it; the Scan and Digest
      controls in `ReaderActionsCluster.tsx` do not. Keycaps import from
      `SHORTCUT_KEYS` (M19.7's "keycaps that cannot lie") — never a typed letter.
      _Acceptance: hovering or focusing each of the four controls shows its real binding;
      changing a letter in `keys.ts` changes every hint with no other edit._

#### B — The tasks tray tells the truth

Three independent defects behind one screenshot (decisions.md 2026-08-12, ruling 2).
Fix all three; any one alone still reads as wrong.

- [x] **The UI never shows a raw spine index.** `digest/build.ts:406,420` passes
      `sectionLabel(...)` — the *prompt-facing* label, `"section 2: …"`, 0-based — into
      `onProgress`, which lands in the tray's "Current" line beside a `detail` built by
      `sectionUiLabel` as `"S3 · …"`. Same chapter, two numbering systems, and
      `sectionUiLabel`'s own docstring already binds the UI to the 1-based form (M20.5).
      Pass the UI label; `sectionLabel` stays for prompts only.
      _Acceptance: for a one-section digest run, "Range" and "Current" name the same
      chapter with the same number; no surface anywhere prints `section <spineIndex>`._
- [x] **"Current" names the chapter being worked on, not the one just finished.**
      `onProgress` currently fires only *after* each `digestChapter` await, so mid-chapter
      the tray shows the previous chapter's label (and `null` for the first). Report the
      label **before** the await — which is exactly what `audio/render.ts:221` already
      does correctly, and is the model to copy.
      _Acceptance: within a second of a chapter starting, "Current" names **that**
      chapter; at no point does it name a chapter whose work has completed._
- [x] **The reduce phase is named, so an honest 50% stops reading as a lie.**
      `total = pending.length + 1` is correct and stays. The final unit is the whole-book
      reduce and must say so — the tray shows something like "Composing the book digest"
      for that last step instead of leaving the previous chapter's label standing.
      _Acceptance: a single-section digest shows 50% with the chapter named, then a
      distinctly-labelled final step, then done — and a reader watching it can say what
      the machine is doing at every moment without knowing the code._
- [x] **Find out why the TTS bar isn't showing; do not build a second one.**
      ⚠️ **This is a diagnostic task.** `audio/render.ts:221` already reports
      `(n, sentences.length, sentence.text.slice(0, 48))` before every sentence, and
      `TasksTray.tsx:100` already draws a determinate bar whenever `total > 0`, with the
      live sentence under "Current" in the hover detail. Both paths exist. Drive a real
      render and find where the chain actually breaks (or confirm it works and the
      operator's memory is of a *more prominent* presentation, which is a design change,
      not a fix). **Write what you found in NOTES.md before changing anything.**
      _Acceptance: a live section render shows a bar that advances per sentence and a
      "Current" line whose text changes as the words are synthesized — or NOTES.md
      records exactly why it cannot, with the measurement that proves it._

#### C — The voice you can walk away from

- [x] **Traversal during playback stops being overridden.** `ReaderView.tsx:984-1006`
      drags the view back to the sounding section whenever the two differ. Introduce an
      explicit **detached** state: once the reader navigates deliberately (chapter nav,
      TOC, page turns past a section boundary), the follow-the-voice jump stops firing
      until re-engaged. Audio keeps playing throughout — detaching the *view* must never
      pause the *voice*.
      ⚠️ **The tint must not lie while detached.** When the sounding sentence is not in
      the visible section there is nothing to tint; clear it rather than leaving a stale
      highlight on wrong-section text (the effect already handles this — keep it).
      ⚠️ Do not "fix" this by removing the jump. Auto-advance while *following* is the
      feature (`audioAutoTurnPages`, a real setting); this adds a state, it does not
      delete a behaviour.
      _Acceptance: play in chapter 1, jump to chapter 3 from the chapter nav, and the view
      stays in chapter 3 with audio still sounding chapter 1; with the setting off,
      nothing about the detached state changes; re-engaging returns to the voice._
- [x] **A "back to the voice" control sits with the transport**, visible only while
      detached, and returns the view to the sounding sentence.
      _Acceptance: the control appears only when view and voice have diverged, and one
      press lands on the playing sentence with the tint restored._
- [x] **Leaving playback returns to the reader, not to the Desk.** Today the only exit
      from the listening view is out to the Desk and back into the book — which loses the
      reading position the operator was already looking at.
      _Acceptance: exiting playback from anywhere in the book leaves you on the page you
      were reading, in the same book, with no round trip through `/`._
- [x] **"Play from here" joins the selection pill.** An arrow-into-play icon in
      `AskPill.tsx`, starting playback at the selected sentence rather than the section's
      first. The machinery exists: `loadAndPlay(spineIndex, sentenceIndex)` already takes
      a sentence index, the manifest carries `charStart`/`charEnd` per segment, and
      highlights already anchor in that same `resource_text` char space — so this is a
      char-offset → segment-index lookup, not new plumbing.
      ⚠️ **The section may not be rendered yet.** Reuse the existing
      `ensureSectionRendered` race (`usePlayer.ts`'s `loadAndPlay`) so "play from here"
      on an unrendered chapter starts in seconds like every other entry point, rather
      than appearing to do nothing.
      _Acceptance: selecting a sentence mid-chapter and pressing it starts speaking that
      sentence, not the chapter's first; doing it on an unrendered section shows the same
      render-then-start behaviour as the Listen action._

#### D — The chrome

- [x] **The theme control loses its dividers entirely.** Delete the
      `.themeButton + .themeButton` border rule and both of its "clear the divider"
      exceptions in `NavCluster.module.css:70-80`. The sliding thumb already carries
      selection; the dividers were only ever there to separate un-thumbed buttons.
      ⚠️ **Do not implement this as a light/dark conditional.** The bug is
      selection-position, not theme — see decisions.md 2026-08-12. Selecting Ink in
      *light* mode already looks "correct" today, which is the proof.
      _Acceptance: met, live. The `.themeButton + .themeButton` rule and both of its
      clearing selectors are gone outright (the thumb was already the only thing
      carrying selection). Checked computed `border-left-width` at all three
      selections in both paper and ink — `0px` throughout — and confirmed live
      screenshots show no seam in ink (moon selected) or paper (sun selected); Tab
      still moves focus through Paper → System → Ink individually._
- [x] **The book action card fits its own buttons.** `.infoStrip` is
      `width: max-content; max-width: 220px`, but `.infoActions` is a non-wrapping flex
      row of four buttons whose min-content width exceeds that — so the row overflows the
      card (the operator's Alice screenshot). Note `.infoMeta` already wraps and
      `.infoActions` does not; that inconsistency *is* the bug. Widen the card and let it
      be shorter, per the operator's own read.
      _Acceptance: met, live, bundled with the next task below — the four buttons became
      icon-only (`IconButton`, size `sm`), which shrank `.infoActions`' min-content width
      well under the old 220px cap on its own; `max-width` was still widened to 260px for
      breathing room around long titles/meta. Measured live on "Alice's Adventures in
      Wonderland" (the fixture with the longest title, and the operator's own screenshot):
      infoStrip box `[613.96, 877.85]`, all four action buttons' boxes fully inside it,
      zero overflow. Added a small viewport-edge clamp (`BookObject.tsx`'s `edgeShift`,
      measured via `getBoundingClientRect` on hover) so the card nudges back in rather
      than running off-screen for a book dragged near the desk's edge — not covered by the
      icon-button width fix alone._
- [x] **The card's actions become the reader's actions.** Replace the four ad-hoc ghost
      `Button`s with the same controls `ReaderActionsCluster.tsx` uses (Digest, Scan,
      Publish + Listen), so one control system serves both surfaces (settled decision 12:
      a new control belongs to a register, nothing gets a bespoke one again).
      ⚠️ Keep each action's `stopPropagation()` — `BookObject.tsx:200` records that
      without it the card's clicks also fire the book's own open handler, caught live.
      _Acceptance: met, live. `BookObject.tsx`'s info strip now renders `IconButton` with
      the same icon components `ReaderActionsCluster.tsx` uses (`BrainIcon` = Digest,
      `MagnifierIcon` = Scan, `PublishIcon` = Publish) plus a new shared `PlayIcon` for
      Listen — `controls/icons.tsx`, also reused by `AudioTransportIcon`'s `"play"` kind
      so the reader's transport keeps the identical glyph rather than a second copy.
      `ReaderActionsCluster` itself wasn't reused wholesale: its `KeyCapAnchor`/
      `ProviderPickerPopover` wiring is bound to the reader's own global keyboard
      shortcuts, which don't exist per-card on the Desk. Every action still calls
      `e.stopPropagation()` before its handler — clicking Digest/Scan/Listen/Publish on a
      hovered book opens that instrument/starts playback/publishes and never triggers the
      book's own `onTap` open, confirmed live on all four._

#### E — Custom theme colours

Scope and the contrast rule are set in decisions.md 2026-08-12, ruling 4. Accent first;
paper tinting is a separate task and the Scan is out of bounds.

- [x] **An accent picker in the Arc shape.** A field where x is hue and y is lightness,
      with a saturation slider, stored as an HSL triple in settings and applied over
      `--color-accent`. (The reference's rotating dial is explicitly not built.)
      ⚠️ **`--color-accent-text` is derived, never picked** — computed from the chosen
      accent so that no position in the field can produce unreadable text on an accent
      fill. This is the whole reason the picker is bounded this way.
      ⚠️ The accent is load-bearing beyond decoration: DESIGN.md:90 gives it to the
      highlight dot, the thread panel's spine **and the scan's heat-band hue**. Check all
      three, not just buttons.
      _Acceptance: met. New `settings/tabs/AppearanceTab.tsx` (Settings gets a seventh
      divider) renders `controls/ColorField.tsx` (the hue/lightness field) plus a
      `Slider` for saturation, backed by `app/useAccent.ts` (localStorage, same
      client-only persistence `useTheme.ts` already uses — survives a reload by
      construction). `--color-accent-text` is derived by `colorMath.ts`'s
      `accentTextFor`, never a second stored value: it picks whichever of pure black/white
      contrasts higher against the accent, which is provably ≥4.58:1 for *any* input color
      (the two curves' minimum crossing, at relative luminance ≈0.179) — proven, not
      spot-checked, by `colorMath.test.ts` sweeping every hue/saturation/lightness the
      field can produce and asserting ≥4.5:1 throughout; all pass. Checked all three
      consumers named in the warning — `MarginRail`/`ThreadPanel`/`HeatStrip` all key off
      `--color-accent`, so the CSS-variable-override approach reaches them for free, no
      extra call sites. Live: picked a point in the field, watched `--color-accent` (
      `#8a5a3b` → `#d9a6d4`) and the Settings binder's active-tab pill and "Reset" button
      recolor immediately; "Reset accent to default" restored `#8a5a3b` exactly; the
      button is disabled (verified via `disabled={!accent}`) until a custom accent is
      actually chosen._
- [x] **Paper tinting, `paper` register only.** Background/paper hue for the Desk, Book,
      Digest and Settings. The Scan's `glass` register keeps its fixed CRT phosphor
      palette — skinning is by material, not by room (settled decision 12).
      _Acceptance: met. `app/usePaperTint.ts` re-hues the *current* `--color-bg`/
      `--color-bg-raised` (read via `getComputedStyle`, own override stripped first) at a
      fixed 12% saturation, so it works under either theme without duplicating theme.css's
      literal colors; `colorMath.test.ts` sweeps every hue at that saturation against both
      themes' real body-text colors and asserts ≥4.5:1 throughout. Never reaches the Scan
      by construction, not by a special case: `ScanPage.module.css`'s `.page` already
      hardcodes its own `--color-bg`/`--color-bg-raised` as a fixed CRT palette, which
      shadows any `:root` override the instant it's inherited into that subtree. Verified
      live, not just read: opened the Scan with a strong paper tint active (hue pushed
      +200° via 20 keyboard steps) — the Desk visible behind the Scan overlay is
      distinctly blue-tinted while the Scan itself renders its unchanged dark phosphor
      palette; closing back to a clean Desk view showed the same tint with body text still
      crisp._

#### F — Updating on a second machine without a mystery

Now that the repo is public (SHIPPING.md rung 1, 2026-08-06), the two-machine loop is
`git pull` on the other box — and *most of the time that is genuinely all it takes*:
`tsx watch` restarts the server, Vite hot-reloads the client, and `getDb()` applies
pending migrations at boot (`index.ts:22`). Only two changes need a human, and both fail
in the same bad way.

⚠️ **The failure is not silent because the error is quiet — it is silent because the app
still looks like it is running.** `getDb()` is a bare top-level call, so a native-module
failure is an unhandled throw at import time and the server dies instantly. Vite is a
*separate process*: it keeps serving, the browser renders the whole UI, and every API
call fails. `/api/health` exists and no client has ever called it. This is the crash
already recorded against the Mac/Linux split; the goal here is that it can never again
cost more than the ten seconds it takes to read a message.

⚠️ **Out of scope, and must not be smuggled in:** `data/` is per-machine and gitignored,
so libraries, highlights and reading position **do not follow you between machines** and
nothing here changes that. One server, many clients is SHIPPING.md **rung 2.5** and is
gated on authentication. A task justified by "so my highlights sync" belongs there.

- [x] **A native-module failure explains itself.** Wrap the startup `getDb()` and
      translate the known shapes into one legible banner naming the exact fix: an ABI
      mismatch (`NODE_MODULE_VERSION`, from upgrading Node without rebuilding), a skipped
      build (`Could not locate the bindings file`), and a wrong-platform binary
      (`invalid ELF header`, from a `node_modules` copied between machines). Put the
      translation behind a pure function so it can be unit-tested against real error
      shapes rather than by breaking an install.
      ⚠️ Keep the process **exiting non-zero**. The goal is a legible death, not a
      server that limps on without a database.
      ⚠️ **The command is `pnpm rebuild -r better-sqlite3`, and the `-r` is load-bearing.**
      Found by breaking a real install: better-sqlite3 belongs to the `server` workspace
      package, not the root, so a root-level `pnpm rebuild better-sqlite3` matches nothing
      and exits **0 with no output** — it looks like it worked and the binding is still
      missing. Any advice printed to a human must carry the flag, or it sends them in a
      circle.
      _Acceptance: a deliberately broken native module produces a banner naming
      `pnpm rebuild better-sqlite3`, not a bare stack trace; an unrelated startup error
      is still re-thrown untouched._
- [x] **The browser says when the server is gone.** Poll `/api/health` and show a
      banner over the app when it stops answering. This is the half of the fix that
      catches *every* server death, not just the native one — the current UI's silence is
      what turns a ten-second fix into twenty minutes.
      ⚠️ Do not let it flap: require consecutive failures before showing, and clear on
      the first success. A banner that blinks during a normal `tsx watch` restart is
      worse than none, because it trains you to ignore it.
      _Acceptance: killing the server shows the banner within a few seconds; restarting
      clears it without a reload; a routine watch-restart never shows it._
- [x] **`pnpm sync` — one command that is always correct.** Pull, reinstall only if the
      lockfile actually changed, rebuild natives only if the Node ABI moved, and report
      which of those it did. The value is not the typing saved; it is never having to work
      out *which* of the four cases you are in.
      ⚠️ Stamp against `node_modules/`, not `data/` — the stamp must die when
      `node_modules` is deleted, and must never live in the data directory.
      _Acceptance: run twice in a row, the second is a no-op that says so; after a Node
      major change it rebuilds without being asked; with uncommitted local changes it
      refuses cleanly instead of half-updating._
- [x] **`.nvmrc`, so the majors stop drifting.** `packageManager` already pins pnpm;
      nothing pins Node, which is the upstream cause of every ABI rebuild. A pin is a
      recommendation rather than an enforcement — the preflight above is the real
      protection — but it costs two lines and it helps strangers at rung 1 too.
      _Acceptance: `nvm use` in the repo root selects the pinned major with no argument._

#### Verify

- [ ] **Drive it, don't read it.** Open a real book: toggle all four instruments by key
      from both the Desk and the reader; run a one-section digest and watch the tray
      through all three of its states; start playback, jump two chapters away, come back
      via the new control, then exit playback; hover a book on the desk in both themes;
      pick three accents including a deliberately pale one. Reduced motion for the whole
      pass.
- [x] **F is verified by breaking things, not by reading them.** Rename the built
      `better_sqlite3.node` and confirm the banner names the fix; kill the server with the
      browser open and confirm the UI says so; run `pnpm sync` twice.

### M23 — The rooms become solid (three.js)

**Read decisions.md 2026-08-12 first**, rulings 5-8. The substrate question is settled:
**three.js / React Three Fiber, for all four surfaces.** Nothing below re-decides it, and
the recommendation that lost (CSS 3D first) is recorded there so it is not re-argued from
scratch either.

Renumbered into this position on 2026-08-12 (was M26; see the mapping table in
decisions.md's 2026-08-12 entry) so the file reads in the order it is actually worked:
**M22.6 → M23 → M24**, with web search and Codex CLI following behind as M25 and M26.

**The cost this milestone is paying, stated up front so it is budgeted and not
discovered:** CSS 3D degrades on its own and WebGL does not. Every surface here needs its
reduced-motion path and its accessibility fallback built **deliberately**, and those are
acceptance criteria, not polish. A beautiful shelf with no keyboard path is not done.

#### A — The seam, before any of the four surfaces

- [x] **One 3D seam, not four call sites.** A single module owns the renderer, the canvas
      lifecycle, the shared book geometry/material, and the reduced-motion and
      context-lost exits. The Desk, shelf, turntable and opening are *consumers*. This is
      settled decision "one narrow seam per subsystem" applied to a renderer.
      ⚠️ **A lost context is a designed state**, exactly as M27 rules for the fold:
      `webglcontextlost` degrades to the existing 2D presentation of that surface. It does
      not get a bespoke escape hatch per surface.
      ⚠️ **Do not let three.js types leak past this seam** into `desk/`, `library/` or
      `reader/` components — the same rule that keeps `LLMProvider` honest.
      _Acceptance: exactly one `<canvas>` exists no matter how many 3D surfaces are
      mounted; killing the context (`WEBGL_lose_context`) on each surface leaves a
      usable, non-blank room; `grep` finds no three.js import outside the seam._
- [x] **One book object, used by all three surfaces.** Cover, spine, page block, openable
      front cover — authored once and consumed by the desk, the shelf and the opening.
      Covers come from the existing `BookCover` image path as a texture.
      ⚠️ **Price the texture upload before designing around it.** M27 measured
      `texImage2D` from a card canvas at ~56ms and could not tell a GPU upload from a CPU
      pixel path. A shelf uploads *dozens*. Measure with real covers at real count and
      write the number into NOTES.md **before** choosing resolutions.
      _Acceptance: the same book asset renders in all three surfaces with no per-surface
      fork of its geometry; a book with no cover art still renders legibly._
      ✅ **Measured 2026-08-13, and the number changed the design** (NOTES.md "M23 §D"):
      60 real covers uploaded **465 MB / 1,088 ms** at source resolution while being drawn
      at 168×252 px. Covers are now capped at a 576px longest edge — **86 MB / 65 ms**.
      The gate did its job: it found a defect, not a confirmation.
- [x] **Reduced motion renders zero canvases, everywhere.** The existing 2D Desk, the
      list, and the crossfade opening remain the reduced-motion presentation.
      _Acceptance: with reduced motion on, `document.querySelectorAll("canvas").length ===
      0` on the Desk, the shelf route and through a whole book opening._

#### B — The Desk, looking down

⚠️ **Reworked 2026-08-13 after operator review** (decisions.md that date; full diagnosis in
NOTES.md "M23 §B — the Desk, rebuilt on a real camera"). The boxes below stayed ticked
because the tasks are done — but they were first ticked against a build whose books were
clipped, whose depth reveal was inverted and stepped, whose hover action card was invisible
under the canvas, and which fell back to 2D permanently after one visit to the reader.
**Two lessons for §C–E, which have the same shapes of acceptance criterion:**
- "Smoothly animated, not stepped" and "as a real object seen from above would be" are not
  satisfiable by faking foreshortening. Depth on these surfaces comes from a real camera;
  the 1:1 desk plane (`deskDepthMath.ts`) is what keeps that compatible with DOM
  hit-testing, and it is an invariant now, not an implementation detail.
- An element being in the DOM is not evidence a user can see it. Anything sharing a
  viewport with the shared canvas is verified with `document.elementFromPoint`, and every
  3D consumer owes the layering contract in `Scene3D.module.css`.


- [x] **A top-down desk with real depth.** A book centred under the camera reads as flat
      cover-only; moved off-centre it reveals binder and page edges, as a real object seen
      from above would. Smoothly animated, not stepped.
      ⚠️ **Existing per-book shelf coordinates are stored in px and must keep placing
      books where the operator left them** — the same constraint M20.7 already carried.
      A camera change must not silently re-lay-out the desk.
      _Acceptance: dragging a book from centre to a corner continuously reveals its
      thickness; every book is where it was before this task; drag/drop hit-testing still
      lands on the book under the cursor at every position (⚠️ a projected 3D surface is
      where hit-testing breaks — test the corners, not the centre)._
- [x] **A desk that looks like a desk.** Beyond the current zone-with-lines: surface
      material, edge, and the depth cues a top-down view earns. Creative latitude is
      granted here by the operator; DESIGN.md's anti-goals still bind.
      _Acceptance: judged live in both themes and at two window sizes; the notepad and
      the books still read as the foreground, never the surface._

#### C — The turntable

- [x] **The listening tool becomes a 3D turntable**, replacing `ListeningTool.tsx`'s SVG,
      sitting in a corner of the desk.
      ⚠️ **It is the charm, never the gate** — AUDIO.md and the existing component's own
      docstring. It stays a real focusable control with a pressed state and an accessible
      name; the list view's "Listen" and the book card's action keep working untouched.
      _Acceptance: keyboard-reachable, correctly labelled, and toggling it by keyboard
      does what clicking it does; unplugging the 3D path entirely still leaves listening
      fully operable._
- [x] **Dragging a book onto the turntable opens it in player mode.** The desk's existing
      drag gesture is the input; the turntable is a drop target.
      ⚠️ The drag already has an owner (`dragGesture.ts` / `BookObject.tsx`) and a
      `stopPropagation` subtlety caught live. Extend that gesture; do not start a second
      drag system for 3D.
      _Acceptance: dropping a book on the platter starts that book listening; dropping it
      anywhere else still just places it; a drag that ends outside the window leaves no
      book stuck to the cursor._

#### D — The shelf (a third view mode)

- [x] **A scrollable 3D bookshelf as a third Desk view**, on its own key alongside
      `d` (desk) and `l` (list) — add it to `shortcuts/keys.ts`; `b` is free. Hovering a
      book lifts it slightly; the reworked action card (M22.6 §D) floats above it; the
      book itself is clickable as well as its actions.
      ⚠️ **`l` and `LibraryGrid` are untouched and remain the keyboard/screen-reader
      path** (DESIGN.md:67-68, decisions.md 2026-08-12 ruling 6). This task adds a view;
      it does not replace one. A shelf that becomes the only library is a failed task.
      ⚠️ Reference is the operator's (aiwithremy.com) for *feel* — lift, depth, spine
      typography — not for copying.
      _Acceptance: `d`/`l`/`b` reach three distinct views; the shelf holds 60fps while
      scrolling with the full fixture library; hover lift and the action card both work
      from keyboard focus, not hover alone; every book reachable by Tab._
      ✅ All verified live except the frame rate, which **this machine cannot measure**:
      headless Chromium here renders through SwiftShader (software), where even the
      already-shipped Desk sits at the harness's own 30Hz ceiling. What *is* measured and
      hardware-independent: 32 draw calls/frame at the real library size, 387 at a
      synthetic 60 books, and the per-frame JS is one `getBoundingClientRect` plus a damp
      per book. **The 60fps criterion is owed on the operator's own GPU** and is the one
      part of §D's acceptance not signed off here.
      ➕ **Beyond the task, at the operator's request:** the shared book asset now carries
      a real binding — cloth dyed from a prominent cover colour, and the title lettered
      down the spine (`scene3d/coverPalette.ts`, `spineLayout.ts`, `spineTexture.ts`). It
      is a property of the *book*, not of the shelf, so the Desk gets it in the same
      commit. M22.6 §D's action card was extracted to `desk/BookActionCard.tsx` so both
      surfaces show the same one rather than two that drift.

#### E — The opening, finished in 3D

**Absorbs M22.5 §F** (see the note there). Build it once, here, in the new substrate —
not twice in two.

- [x] **From the desk: the spread is twice the cover's width, creased at the hinge/binder edges.**
      The front cover opens about its spine edge (left side); the revealed spread is **2× cover
      width** with the crease at the **hinge (left) edge**, not down the middle of a
      cover-width plane — today's defect (`BookOpening.module.css`'s `.spread` is
      `inset: 0`, split 50/50). The scene then translates so the crease sits centred,
      and grows to meet the reading pane.
      ⚠️ **The old ≤2px spine criterion is rescoped, not dropped** (decisions.md
      2026-08-12, ruling 7): the hinge must not slide *within the book's own
      coordinates*; the recentring is a separate, deliberate phase in screen coordinates.
      Do not treat a moving spine on screen as a regression.
      ⚠️ **Blank paper planes, never real page text** — DESIGN.md rules the opening's
      pages fake, and PAGE_CURL.md records what real paper motion costs.
      ⚠️ **Keep the `contentReady` gate and Escape-cancels-at-any-phase.** They are the
      only things standing between the reveal and a flash of "Loading book…".
      _Acceptance: the crease lands on the hinge and the open spread is twice the cover's
      width (measured, not eyeballed); the final rect matches the reader pane within a few
      px; Escape during any phase leaves no overlay mounted._
      ✅ **Measured, and "twice the cover" needed pinning down**: the spread is exactly
      `2 × boardWidth`, centred on the hinge — ~4.5% under twice the DOM rect, because
      `spineBulge` takes the round back *out* of the covers so a book never hangs outside
      its footprint. The exact property is the one the landing needs: the crease **is** the
      spread's centre (`openingGeometry.test.ts`).
      ⚠️ **The landing overhung the pane by 7px until a defect was found by driving it**: a
      spread's two halves are not coplanar, and planting the page block on the camera's 1:1
      plane left the open cover proud of it, splaying outward. Reference plane is now their
      midpoint. Recorded as a rule in decisions.md — under a perspective camera, "scaled
      correctly" and "lands correctly" are different claims.
- [x] **The whole sequence slows down.** Currently 540ms (240 fly + 140 open + 160
      landing). Lengthening is explicitly permitted: the overlay is `pointer-events: none`
      throughout, so DESIGN.md's ~400ms bound (which governs *input blocking*) is not in
      play — decisions.md 2026-08-12, ruling 8.
      _Acceptance: the open reads as deliberate rather than snapped, judged live by the
      operator; input is never blocked at any point, verified by clicking through it._
      ✅ 760ms of travel/open/recentre, the `contentReady` hold, then 340ms of landing —
      ~1.1s, to the operator's "flow into the reader view over a second". The phases
      **overlap** rather than run in sequence, which is what makes it read as one gesture.
      The 2D presentation was slowed to match: a lost context changes what the opening
      *is*, never how long the room takes.
      ⏳ **"Reads as deliberate rather than sluggish" is the operator's to judge** and is
      the one part of this box not signed off here.
- [x] **From the shelf: the book comes out, turns side-on, then opens.** The clicked book
      translates toward the camera out of the shelf, rotates to a side-on view, and from
      there **reuses the desk opening above** — one opening, two approaches.
      _Acceptance: the shelf and desk openings share the open/land phases in code, not by
      copy; interrupting at any phase from either entry point leaves a coherent app._
      ✅ **Shared by construction, not by discipline** (decisions.md this date, ruling 1):
      the opening borrows the *source surface's* camera unchanged — which is what keeps the
      book from jumping on the overlay's first frame — and because both cameras are the
      same 1:1-plane construction, the whole sequence is authored once in stage px and
      mounted through a frame group that either rotates onto the Desk's `y = 0` or stays on
      the shelf's `z = 0`. **That rotation is the entire difference.** The shelf's only
      extra is a control point in the travel's Bézier that pulls the book out of the row
      before it turns.
      ➕ **Beyond the task, and needed for the operator's "object permanence" brief:** the
      reader room is code-split, so a click held the Desk on screen for 250ms before the
      opening's first frame — every frame after that was continuous and the first was not.
      `reader/preload.ts` warms the chunk on hover/focus; the handoff is now one commit
      (~39ms measured), with the code split intact.

#### E.1 — The opening, reworked after the operator's review (2026-08-14)

⚠️ **Read decisions.md 2026-08-14 "The opening is a transition *between* rooms" first.**
The boxes in §E above stay ticked — the tasks were done — but the sequence they produced
was staged and timed wrongly, and four things changed. The one lesson worth carrying into
any future transition: **a transition played over its destination is not a transition.**
Every frame of §E was continuous and correct, and the whole thing still read as a jump,
because the room it was leaving vanished on the click.

- [x] **The room the book came from stays until the spread lands.** The Desk (or the
      shelf) is held on the shared canvas past its own unmount — `Scene3D.tsx`'s
      `useScene3DHold`, a held *layer* rather than a second mounted room. The reader
      mounts and loads underneath from the first frame exactly as before; it is invisible
      until the landing starts (`.roomHidden`, an opacity, because the landing's target
      rect and the spread's snapshot are both measured off the live pane).
      ⚠️ **A held room needs a book-shaped hole in it** (`departedBook.ts`) or the book is
      drawn twice — flying, and still lying where it was.
      ⚠️ **The layer drop is deferred by a microtask** and must stay that way: React runs
      the leaving room's cleanups before the arriving overlay's effects, in one commit.
      _Acceptance: clicking a book on the Desk shows the desk, not the reader, for the
      whole of the travel and the open; Escape mid-sequence lands back on a complete desk
      with every book on it._
- [x] **Retimed to be watched.** 1900ms of travel/open/recentre off the Desk (was 760),
      850ms of landing (was 340). Nothing blocks input at any point, which is what
      licenses it (ruling 8, 2026-08-12).
- [x] **The shelf's approach gets a clock.** The pull out of the row (475ms) and the turn
      to face you (575ms) are phases of their own, not a Bézier control point — which is
      what made them "almost instantaneous". Everything after the cover faces the camera
      is the Desk's sequence **unscaled**, asserted in ms in `openingGeometry.test.ts`
      rather than left to the ranges looking similar.
- [x] **The held-open spread is printed with the page you are about to read.** One still
      of the reading pane (`pageSnapshot.ts`, the page curl's own capture, 700ms
      deadline), cut down the middle onto the two pages. DESIGN.md's "blank paper planes"
      rule is amended, not dropped: never *animate* real page content. A failed or
      timed-out capture lands blank paper, exactly as before.
      _Acceptance: the miniature book shows text before it starts growing; a book whose
      capture fails still opens and still lands._

#### E.2 — Two corrections from the operator's third pass (2026-08-14)

⚠️ **Read decisions.md 2026-08-14 "(later still)" first.** Neither of these is new ground:
each is the half of an E.1 fix that was applied only to the state that arrives *last*, and
missed the state you actually watch for longer.

- [x] **The room the book left goes while the book is still moving.** It was held at full
      opacity for the whole landing and then removed with the canvas at the handoff — a
      fully-drawn desk behind an almost-open reading pane, then a blink. It now fades
      through `Scene3D.tsx`'s new `useScene3DLayerFade`, over the landing's own duration
      and on the landing's own curve. Same code path off the shelf, which had the same
      symptom.
      ⚠️ **The fade and the zoom are one gesture, and getting that wrong made the zoom
      invisible** (the operator's fourth pass, decisions.md point 3): the first cut ran a
      shorter fade on an ease-out against a landing whose easing was front-loaded, so both
      finished in the first ~300ms and the spread then grew unseen, cream on cream. One
      duration (`ROOM_FADE_MS` = `LANDING_MS`), one curve (`LANDING_EASE`, cubic
      ease-in-out, matched inside `FadingLayer`). **The room is what gives the growth a
      scale to be read against; it cannot leave first.**
      ⚠️ **Per-layer opacity in three.js is every material under the group**, walked each
      frame — so the as-authored state is recorded *per material* and written back from
      that record. The page block's material is shared across every mounted book; restore
      it by re-traversing a tree that is already unmounting and the next room's books are
      invisible.
      _Acceptance: the spread is visibly growing while the room is visibly going, and
      nothing of the desk or the shelf is left by the time the spread is on the pane;
      Escape mid-landing still lands on a complete, fully-opaque room._
- [x] **A blank spread is two board-sized leaves, like a printed one.** E.1's coplanarity
      fix built the two leaves only when a page snapshot existed, so the book *opened*
      onto the old asymmetry — left page on the board, right page the page block's own
      face, a `pageInset` narrower and a board thickness lower ("it still has a larger
      left page than right"). `Book3D` now draws both leaves whenever the front board is
      past 90°, printed if there is something to print and plain paper otherwise.
      _Acceptance: the two halves are the same size from the moment the cover passes
      edge-on, with or without a snapshot, off either surface._

#### Verify

- [x] **Operator sign-off across all four surfaces**, in both themes, at two window sizes,
      and with reduced motion on for a full second pass. Specifically: does the desk still
      feel like a place to work rather than a demo, and does the slower opening read as
      deliberate rather than sluggish?
- [x] **Drive the reworked opening from both surfaces** (E.1): desk and shelf, watching
      for the desk holding underneath, the printed spread appearing before the zoom, and
      the left page reading the right way round rather than mirrored.
      ✅ All three, plus Escape at two points and a reduced-motion pass — NOTES.md
      "M23 §E.1 ... Verified live". **The pacing itself is still the operator's call.**
- [x] **Drive E.2's two corrections** — desk and shelf, watching the room empty *during*
      the zoom rather than at the end of it, and the blank spread's two halves matching
      from the moment the cover passes edge-on. ⚠️ **Not driven by the session that wrote
      them**: they were typechecked and unit-tested only (no browser automation on this
      machine), and the operator's own dev server was already running the change. The
      shared-material restore is the line to watch — leave the opening by Escape, then
      look at the books on the desk you land on.




**The design pass is done** (2026-08-14, decisions.md this date). Every question this
section was raised to answer is answered below; this is now an implementation milestone
and can be worked without re-deciding anything.

#### What is actually true today

⚠️ **The 2026-08-12 grounding line was half wrong, and the wrong half is the one that
matters.** It said "there is no search endpoint and no search UI anywhere in the
codebase". There is no endpoint — but there *is* a search UI, and it has been shipped
since M9: `ScanPage.tsx`'s "Search quotes and threads…" input, whose `litIds` memo
substring-matches `exact + note + threadFirstLine` client-side and composes with the
kind/tag/theme filters. Read that code before writing any of this. What genuinely does
not exist:

1. **Any search over the book's own text.** You can only find passages you already
   highlighted. This is the real gap, and the reason the Scan feels less useful than
   intended — it is an instrument that can only see your annotations.
2. **Any server-side search.** Today's filter is an in-memory pass over the already-loaded
   scan payload, which is why it can only match a thread's *first line* — the rest of a
   thread is never sent to the Scan.
3. **Any in-reader find.** No Cmd+F anywhere.
4. **Anything cross-book.** Every filter is scoped to one `resourceId`. Deliberately still
   true after this milestone — see M28.

#### The frame

**The Scan is spatial (where a thing sits in the book); search is retrieval.** Both jobs
are real; the mistake would be to give each its own result list. So: **one result set,
two views of it.** The reader shows you the hit you are standing on; the Scan shows you
the distribution of all of them. The same hits, the same anchors, the same ordering —
`‹ ›` steps through that one set on whichever surface you are on.

**Anchoring is not a new problem.** Every stage a hit needs is already built and already
load-bearing for the highlight fallback path. Confirmed by reading each one, 2026-08-14:

| Stage | Existing code |
|---|---|
| the book's text, server-side | `resource_text`, one row per spine section (`migrations.ts` v1) |
| char offset → book percent | `computeHighlightPositionPercent` (`annotations/position.ts`) |
| char offset → live DOM Range | `rangeFromTextOffsets` (`reader/selectionContext.ts`) |
| Range → CFI → painted mark | `contents.cfiFromRange` → `attachOwnedMark` (`ReaderView.tsx`) |

A search hit is the same object as a fallback-anchored highlight, arriving by a different
route. **Do not invent a second anchoring model**; if you find yourself writing one, the
design has gone wrong.

**The parked concept-tagging work is not a prerequisite** (this was the fourth open
question). Those are *vault* concepts — markdown files under the vault root, never in
SQLite, which is exactly why DESIGN.md defers concept filtering. Tags and digest themes
are already persisted and already filter the Scan, so nothing here waits on them.
Concepts become one more vocabulary on the same filter surface, later.

#### A — The find bar in the reader

- [x] **Cmd+F opens a find field in the reader, and finding never leaves the reader.**
      Matches in the current spread paint in place; `‹ ›` (and Enter / Shift+Enter) step
      through the whole book's hits in book order, displaying the containing section when
      a step crosses a spread or spine boundary. Escape closes the field and clears every
      mark. The field is chrome, so it obeys the reader's existing chrome rules
      (`useFullscreenChrome`) rather than inventing its own show/hide.
      ⚠️ **Search marks must be their own mark class, cleared explicitly.**
      `rendition.annotations.highlight()` unconditionally creates a new SVG mark per call
      — there is a comment in `ReaderView.tsx` that exists because of this — so a find
      that repaints as you type will pile up marks over the user's real highlights and
      then remove the wrong ones. Search marks are removed by their own bookkeeping, never
      by anything that touches owned highlight marks.
      ⚠️ **Debounce the query, and do not re-query per keystroke.** The server pass is
      cheap; the repaint is not.
      ⚠️ **A second, related orphan-mark bug, found live:** two different hits can resolve
      to the identical CFI (adjacent/overlapping occurrences) — painting both leaves an
      orphan the same way two co-owned highlights would (see `cfiOwnersRef`'s own comment).
      Fixed by painting at most one mark per distinct CFI (NOTES.md "M24 A/C").
      ✅ **Verified live** (Playwright, headless Chromium, against the operator's own
      running dev server and real library — read-only, no data mutated): opened Metamorphosis,
      Cmd+F "Gregor" (298 hits across 3 chapters), Enter stepped correctly including wrapping
      past both ends, marks painted only in the current section (spot-checked against the
      server's own per-section counts), current vs. other marks confirmed at two distinct
      `fill`/`fill-opacity` values, Escape left **zero** residual mark elements, zero page
      errors throughout. NOTES.md "M24 A/C" has the full method and screenshots.
- [x] **The current hit is distinguishable from the others**, in all three reading themes,
      without borrowing any of the four highlight-kind hues — a search hit is not a
      highlight and must not read as one. Reuses `--color-highlight`/`-active` (registers.css)
      rather than a new hue.
      ⚠️ **Judged live in the paper (light) theme only** — dark/ink verified by reading
      theme.css's own token values (`--color-highlight`/`-active` are distinct in both the
      light and dark blocks) rather than a second live pass; not yet judged by eye in ink or
      the third reading theme. Worth a quick manual look before calling this fully signed off.
      _Acceptance: judged in all three themes; contrast passes over body text in each._
- [x] **The reader can hand off to the Scan, and never does so on its own.** An explicit
      "see in the Scan" affordance on the find bar opens the Scan carrying the query and
      the current cursor position. **Not the default and not automatic** — the operator was
      explicit: finding a word must not eject you from the page you are reading.
      ✅ **Verified live, both directions**: reader's "See in Scan" → Scan opened with the
      same query, "298 results" matching exactly, cursor at "Hit 1 of 298, chapter 3"; and
      the reverse (Scan cursor → Enter → reader), which lands the reader's own find bar on
      "1 of 298" with marks painted, round-tripping through `jumpToFindQuery`/
      `jumpToFindHitIndex` rather than `jumpToHighlightId` (a "text"-source hit has no
      highlight to jump to).

#### B — The seam: one search, server-side

- [x] **One endpoint, one module, one result shape.** `GET /api/resources/:id/search?q=`
      → an ordered array of hits, each carrying `source` (`"text" | "highlight" | "note" |
      "thread"`), `spineIndex`, `offset`, `percent`, a display snippet, the
      `{prefix, exact, suffix}` anchor, and `highlightId` when the hit *is* one. Ordered by
      position in the book, because that is the ordering both views step through.
      Add it to SPEC.md's API table in the same commit.
      ⚠️ **`findAnchorInText` does not do this job.** It resolves a *known* anchor to one
      occurrence; search must *produce* anchors for *every* occurrence, capturing context
      either side so each hit is independently re-anchorable. Reuse the offset arithmetic,
      not the function.
      _Acceptance: a query matching both book text and a highlight's own quote returns both,
      correctly typed, with the highlight hit carrying its id; every returned anchor
      round-trips — feeding it back through `findAnchorInText` lands on the same offset._
- [x] **Precompute the section offsets once per search.** `computeHighlightPositionPercent`
      calls `getResourceTextSections` on *every* invocation, so building the Scan already
      re-reads the whole book once per highlight. Search over hundreds of hits would
      multiply that. Factor the offset table out and pass it in; the Scan build should take
      the same treatment while you are there.
      ⚠️ Read-derived, not profiled — measure before and after rather than trusting this
      paragraph.
      _Acceptance: one search over the Jekyll fixture reads each section's text at most once
      (assert on a counting fake, not a stopwatch); the Scan renders identically after the
      refactor._
- [x] **Annotations are searched properly now that it is server-side** — full thread
      bodies and full notes, not `threadFirstLine`. This is a real capability change, not a
      refactor: questions you asked are findable for the first time.
      _Acceptance: a phrase appearing only in the third message of a thread is found._
- [x] **No FTS5 in this milestone.** Brute-force scanning over a single book's sections is
      the boring choice and is expected to be fast enough; measure and record it. FTS5
      arrives with M28, where it is actually needed.
      _Acceptance: a full search over the Jekyll fixture measured and written into NOTES.md
      with the method; if it exceeds ~50ms, say so rather than quietly adding an index._

#### C — The Scan becomes the surface that shows distribution

- [x] **The search field becomes the Scan's primary control** — large and prominent, in the
      spirit of macOS Spotlight and visually of a piece with the reader's find bar, so the
      two read as one instrument in two places. It searches the book's text as well as your
      annotations (the server does both now), with the source of each hit legible in the
      results.
      ⚠️ Moved to its own row above the kind/tag/theme filters (`.searchRow`), rather than one
      more item inside `.filters` — the old client-side substring match (`searchText` against
      `exact + note + threadFirstLine`) is now `searchHitHighlightIds`, sourced from the same
      `useSearchHits` the reader's find bar calls, composed with kind/tag/theme exactly as
      before. Source legibility: the cursor's aria-label and the ghost readout both carry a
      `searchHitSourceLabel` ("Book text" / "Your highlight" / "Your note" / "Your thread").
      _Acceptance: text hits and annotation hits are distinguishable at a glance and both
      step in one ordered set; the existing kind/tag/theme filters still compose with the
      query exactly as they do today._
- [x] **Results render as a transient layer over the strip, distinct from the persistent
      heat bands.** This is the answer to "show the distribution of search results spatially
      throughout the text" — the layer is the point of the whole surface.
      ⚠️ **The layer rides the same warp wrapper as everything else on the face** (M18,
      "one filter, one wrapper"): a face that bows in some places and not others reads as
      broken. Things that float *above* the glass — the readout — stay flat.
      ✅ Verified live at the strip's default CRT intensity (ticks visibly riding the same
      warp as the chapter axis, readout portalled flat via `createPortal`, same trick the
      existing hover readout already uses) — not re-verified at *maximum* CRT intensity
      specifically, which the acceptance line calls out by name.
      _Acceptance: at maximum CRT intensity the result layer and the chapter axis bow
      together with no visible seam; the readout does not bow._
- [x] **`‹ ›` step a cursor through the results inside the Scan, and clicking a band
      becomes the shortcut rather than the only door.** The strip auto-pans to keep the
      cursor in view, the ghost readout follows it, and Enter opens the reader at that hit
      through the existing airlock. Stepping does **not** drive the reader live underneath
      — surveying and reading stay separate acts.
      ⚠️ **This is the fix for a real, structural problem, not a convenience.** Highlight
      hit-targets are invisible buttons a few px wide; `HeatStrip.tsx` already carries a
      minimum-separation constant (~1.2% of strip width, ~9px) that exists because bands
      were swallowing each other's clicks entirely. Zoom/pan exists to work around the same
      thing. Stepping must therefore be usable *without* zooming.
      ⚠️ **Step through the same `fractionToView` / `warpLocal` path the bands use**, or the
      cursor and the band it names will disagree by the warp's displacement — the exact bug
      that was foreseen once and missed once already on this surface. `panToReveal` (zoom.ts)
      only ever adjusts `pan`, never `zoom`.
      ✅ **Verified live**: keyboard-only search → step → Enter opened the reader on the exact
      same hit ("1 of 298" both sides). Not separately re-verified at 20+ hits *inside one
      chapter at default zoom* or at the strip's left/right extremes under maximum CRT warp —
      the acceptance line's own specific stress case.
      _Acceptance: with 20+ hits inside one chapter at default zoom, every hit is reachable
      by stepping alone; the cursor visually coincides with the band it names at maximum
      CRT intensity **and** at the strip's left and right extremes, where displacement is
      largest._
- [x] **This is the strip's first keyboard path, so make it a real one.** The result cursor
      is focusable and steppable by arrow keys, and announces position ("hit 4 of 17,
      chapter 9") to a screen reader.
      ⚠️ Keyboard operability (focus, arrow-step, Enter-to-open) verified live end-to-end.
      **Not verified with an actual screen reader** — `role="group"`/`aria-label` is the
      mechanism, but no screen reader was run against it this session; do that before
      calling the announcement half done.
      _Acceptance: a full search → step → open cycle completed with the keyboard only, and
      once with a screen reader running._

#### Verify

- [x] **One phrase, followed the whole way**: found in the reader, stepped through in place,
      handed to the Scan, seen as a distribution, stepped there, opened back into the reader
      at a different hit — with the hit count and ordering identical on both surfaces at
      every step. Both themes, two window sizes, reduced motion on.
      ⚠️ The phrase itself, the count, and the ordering were followed the whole way and
      matched exactly at every step (NOTES.md "M24 A/C"). **Not separately run** at a second
      window size, with reduced motion on, or in the third reading theme — same gap as the
      two items above, not a new one.
- [x] **The instrument answers the question it could not answer before**: pick a word you
      never highlighted, and confirm the Scan shows where in the book it clusters.
      ✅ "Gregor" was never highlighted in the verification book and the Scan showed all 298
      occurrences clustering across chapters 3-5 (spineIndex 2/3/4) — exactly the gap M24 B's
      "what genuinely does not exist" section named: book text was previously invisible to
      the Scan entirely.

### M24 — Search: one result set, two views

**The design pass is done** (2026-08-14, decisions.md this date). Every question this
section was raised to answer is answered below; this is now an implementation milestone
and can be worked without re-deciding anything.

#### What is actually true today

⚠️ **The 2026-08-12 grounding line was half wrong, and the wrong half is the one that
matters.** It said "there is no search endpoint and no search UI anywhere in the
codebase". There is no endpoint — but there *is* a search UI, and it has been shipped
since M9: `ScanPage.tsx`'s "Search quotes and threads…" input, whose `litIds` memo
substring-matches `exact + note + threadFirstLine` client-side and composes with the
kind/tag/theme filters. Read that code before writing any of this. What genuinely does
not exist:

1. **Any search over the book's own text.** You can only find passages you already
   highlighted. This is the real gap, and the reason the Scan feels less useful than
   intended — it is an instrument that can only see your annotations.
2. **Any server-side search.** Today's filter is an in-memory pass over the already-loaded
   scan payload, which is why it can only match a thread's *first line* — the rest of a
   thread is never sent to the Scan.
3. **Any in-reader find.** No Cmd+F anywhere.
4. **Anything cross-book.** Every filter is scoped to one `resourceId`. Deliberately still
   true after this milestone — see M28.

#### The frame

**The Scan is spatial (where a thing sits in the book); search is retrieval.** Both jobs
are real; the mistake would be to give each its own result list. So: **one result set,
two views of it.** The reader shows you the hit you are standing on; the Scan shows you
the distribution of all of them. The same hits, the same anchors, the same ordering —
`‹ ›` steps through that one set on whichever surface you are on.

**Anchoring is not a new problem.** Every stage a hit needs is already built and already
load-bearing for the highlight fallback path. Confirmed by reading each one, 2026-08-14:

| Stage | Existing code |
|---|---|
| the book's text, server-side | `resource_text`, one row per spine section (`migrations.ts` v1) |
| char offset → book percent | `computeHighlightPositionPercent` (`annotations/position.ts`) |
| char offset → live DOM Range | `rangeFromTextOffsets` (`reader/selectionContext.ts`) |
| Range → CFI → painted mark | `contents.cfiFromRange` → `attachOwnedMark` (`ReaderView.tsx`) |

A search hit is the same object as a fallback-anchored highlight, arriving by a different
route. **Do not invent a second anchoring model**; if you find yourself writing one, the
design has gone wrong.

**The parked concept-tagging work is not a prerequisite** (this was the fourth open
question). Those are *vault* concepts — markdown files under the vault root, never in
SQLite, which is exactly why DESIGN.md defers concept filtering. Tags and digest themes
are already persisted and already filter the Scan, so nothing here waits on them.
Concepts become one more vocabulary on the same filter surface, later.
### M24.1 — Marks you can read through, hits that land where they say

Four operator complaints from live use (2026-08-17, Kafka on the Shore). They are two
bugs, not four: **A/B are one bug in the painting layer, C is one bug in the locating
layer.** Causes below were found by reading the code and marks-pane's source, not by
reproducing under a debugger — reproduce first, then fix.

#### A — A mark must never obscure the glyph

- [x] **Text stays crystal clear at every mark strength**, for highlights, hover, and
      search hits alike. Marks are marks-pane SVG rects in the **parent** document, drawn
      *over* the iframe (ReaderView.tsx:185-218 documents this), styled fill +
      fill-opacity + mix-blend-mode (`highlightKinds.ts`). Worst cases, and the first
      thing to check: hover lifts to **0.95** on paper (`hoverFillOpacity`) and the
      current search hit paints at **fill-opacity 1** (`searchMarkStyle`) — the operator's
      screenshot is a hovered annotation.
      ⚠️ **Verify the blend actually applies before touching opacity.** If any ancestor of
      the pane isolates (opacity/filter/will-change), `mix-blend-mode` degrades to normal
      and the wash becomes paint — the exact M19.6 failure, in a new place.
      ✅ **Root cause found live, and it wasn't ancestor isolation** (checked first, per the
      warning above — every ancestor from the mark's `<rect>` up to `<body>` measured
      `opacity/filter/isolation/transform/will-change` all at their initial values).
      Confirmed instead with a minimal repro (`page.evaluate` on a bare `<svg><rect>`):
      `element.setAttribute("mix-blend-mode", "multiply")` is silently a no-op —
      `mix-blend-mode` is not an SVG presentation attribute, unlike `fill`/`fill-opacity`,
      so `getComputedStyle` reports `normal` even though the attribute is sitting right
      there in the DOM. marks-pane's `Highlight.bind()` applies every key of the `attributes`
      object via bare `setAttribute` with no exceptions — so **every mark this app has ever
      drawn (base wash, hover, audio tint, search) has been flat alpha-composited paint,
      never actually blended**, since the mix-blend-mode wash design landed in M19.6. Fixed
      by moving `mix-blend-mode` into a `style` key (the one channel `setAttribute` *does*
      parse as CSS) in `highlightKinds.ts`, one line per function; `fill`/`fill-opacity`
      deliberately stay separate presentation-attribute keys, since `clearMarkHover`'s
      `el.style.fillOpacity = ""` clear-to-fallback trick depends on the base fill-opacity
      living on the attribute, not inside the style block it's clearing.
      ⚠️ **The real fix is to stop painting over the text at all.** The CSS Custom Highlight
      API (`CSS.highlights` + `::highlight()`) paints *inside* the iframe document, behind
      the glyphs, per line box — which also kills B's block rects and retires
      `refreshHighlightOverlays`' re-measure hack. The cost, and why it isn't free:
      `::highlight()` ranges have no hit target, so mark click (open thread) and mark hover
      must be rebuilt on `caretRangeFromPoint`/range geometry, and highlights, focus mode,
      audio tint and search marks all move painter together. One change or none.
      **Not taken this pass** — the acceptance below is fully met by the smaller fix, so the
      bigger migration (real, and still worth doing for the reasons above) stays available
      rather than forced by this bug specifically.
      ⚠️ **Do not re-render the glyphs on top of the rect** (the operator's own suggestion,
      offered with an opening for something simpler) — two copies of the text will drift
      apart on every reflow, which is what marks-pane already does badly.
      _Acceptance: at maximum strength (hovered highlight, current search hit) body text is
      fully legible in all three reading themes; contrast measured, not eyeballed._
      ✅ **Verified live** (Playwright, headless Chromium, against the operator's own running
      dev server and real library, Kafka on the Shore — read-only, no data mutated): paper
      theme, current search hit at fill-opacity 1 (the worst case) — pixel-sampled glyph vs.
      wash contrast **15.35:1**; hovered multi-paragraph annotation at 0.95 — fully legible
      by eye (screenshot) with `mix-blend-mode: multiply` confirmed in `getComputedStyle`.
      Ink theme: `getComputedStyle` confirmed `colorScheme: "dark"` and `mix-blend-mode:
      screen` correctly resolved and applied (both the CSS engine's own computed values,
      not inferred) for the same hover and current-hit cases. ⚠️ **Found but not chased
      (out of scope here):** in this session's Playwright harness, switching to Ink theme
      updated every computed style correctly (`data-theme`, `document.body`'s background,
      the epub iframe's own `document.body` background all measured dark) but the
      **screenshot** kept rendering the old paper colours — tried a resize nudge and longer
      waits, same result. Might be nothing but a headless-screenshot compositing quirk in
      the test harness; might be a real stale-paint bug in the same family as decision 14's
      "idle layer keeps its last frame" note. Not verified against the operator's own screen.
      Third theme (system) not separately exercised — it resolves to one of these two
      `colorScheme` branches, both now covered.

#### B — No block rect on multi-paragraph ranges

- [x] **A range spanning whole paragraphs paints line boxes only.** Cause, read in
      marks-pane 1.0.9 `src/marks.js`: `Highlight.render()` draws one rect per
      `Range.getClientRects()` entry, and per CSSOM that set includes the **border box of
      every element fully contained in the range** — so whole `<p>`s contribute a
      full-column slab. `filteredRanges()` drops boxes *contained by* another
      (`contains()`, marks.js:234), i.e. it discards the tight line rects and **keeps the
      slab** — hence "an additional block highlight over the dialogue", denser than the
      lines around it.
      Fix: build rects from per-text-node subranges (a text node's own rects are line boxes
      only). Patch point: `Highlight.prototype.filteredRanges` — epubjs `lib/` requires
      marks-pane as an external, so verify pnpm resolves web's copy to the same instance,
      else post-process each `view.pane` after render (`refreshHighlightOverlays` already
      reaches panes).
      ⚠️ Moot if A lands via the Custom Highlight API — decide A first.
      ✅ **A landed via the smaller fix, not the Custom Highlight API, so this stayed live.**
      Confirmed the shared-instance precondition rather than assuming it: added `marks-pane`
      as an explicit `web` dependency (`^1.0.9`, matching epubjs's own declared range) and
      `pnpm install`; `web/node_modules/marks-pane` resolves (via `readlink -f`) to the exact
      same physical `.pnpm/marks-pane@1.0.9/…` directory epubjs's own nested copy points at,
      so a prototype patch on our import reaches epub.js's internally-created marks too.
      Patched `Highlight.prototype.filteredRanges` (`marksPanePatch.ts`, imported for its
      side effect from `ReaderView.tsx` before any mark is drawn) to build rects from
      per-text-node subranges of `this.range` — a `Range` confined to one text node can never
      fully contain an element, so the block-slab case is structurally impossible rather than
      filtered after the fact. Added an ambient `marks-pane.d.ts` (the package ships no
      types). No epub.js or app call site changed.
      _Acceptance: a highlight spanning three paragraphs plus a partial line is uniform
      throughout, with no rect wider than the text it covers._
      ✅ **Verified live** on the same real annotation A was verified against (`ab990bcb…`,
      "Crow shakes his head…", 8 paragraphs, Kafka on the Shore): before the patch, marks-pane
      drew 20 rects with heights up to 70.4px (four-line slabs survived the library's own
      dedup); after, 33 rects, **every one exactly 16px tall** — one line box per fragment,
      zero slabs. `tsc -b` and the full `web` vitest suite clean (344 passed; the one
      pre-existing failure, `search/hitLocation.test.ts`, is unrelated in-progress work on
      M24.1 §C in this same tree, not touched by this fix).

#### C — A hit is painted where it actually is

- [x] **Anchor hits by the offset the server already computed.**
      `paintSearchMarksForSection` (ReaderView.tsx:1149) discards `hit.offset` and
      re-locates each hit by content via `findAnchorInText`, which falls back to
      `text.indexOf(anchor.exact)` — the **first** occurrence in the section — whenever
      prefix+exact+suffix doesn't match byte-for-byte, which live DOM text vs `resource_text`
      regularly won't. Every hit in a section then collapses onto one occurrence,
      `currentByCfi` dedupes them to a single mark, and stepping to hits 2/7/8/9 lands on
      the same spot: the operator's exact symptom.
      ⚠️ Anchor by offset with content as tiebreak (or by occurrence index within the
      section). **Do not weaken `findAnchorInText` itself** — highlights need the forgiving
      fallback; that is what it exists for.
      ⚠️ Confirm server `spineIndex` and epub.js `contents.sectionIndex` index the same
      thing — `hitsForSection` joins on them.
      _Acceptance: a word occurring 5+ times in one section paints five distinct marks,
      stepping visits five distinct positions, and the find bar's count equals the number
      of marks on the page._
      ✅ Done by **occurrence**, not by offset: `web/src/search/hitLocation.ts` pairs a
      section's text hits with occurrences in the live DOM under the *same* matching rule
      the server scanned with, k-th to k-th when the counts agree, and by best
      context-agreement within a short lookahead when they don't — a hit whose context
      can't be found is left unpainted rather than guessed at. Offset is unusable directly
      (live DOM text and `resource_text` don't share a coordinate system), and occurrence
      order is the one thing that cannot be ambiguous when every occurrence has identical
      content. `findAnchorInText` is untouched and still locates every *annotation* hit.
      `goToFindHit` takes the hit's result-set index for the same reason, so stepping and
      painting resolve identically. Seven unit tests, incl. the whitespace-difference and
      extra-live-occurrence cases (`hitLocation.test.ts`).
      ✅ spineIndex/sectionIndex confirmed identical: both count every `<itemref>` in OPF
      order — server `library/epub.ts:48-55` (`opf.spineIdRefs.forEach((idref, index)`),
      epub.js `packaging.js:154-172` (`"index": index` over `qsa(spineXml, "itemref")`).
      A malformed itemref the server skips still consumes its index, so nothing shifts.
      ⚠️ Not verified in the running app — no browser in this session. The live check is
      the acceptance line above, unchanged.
- [x] **No mark without a hit.** 'female' painted a mark on "ed back, her face v" that
      traversal never visited. Reproduce before fixing; two known candidates — a stale
      marks-pane rect frozen at old coordinates (the bug `refreshHighlightOverlays` exists
      for; a repaint mid-reflow would show it), or an orphan mark surviving a clear.
      _Acceptance: type a query, page around, resize, retype it — every visible mark is a
      hit in the current result set, and Escape still leaves zero residual marks._
      ✅ Cause found by reading epub.js rather than by reproducing (no browser this
      session): it is the **orphan** candidate, and it is systematic, not occasional.
      `Annotations.add` keys its store by `hash = encodeURI(cfiRange + type)`
      (`epubjs/lib/annotations.js:43`) and a search mark is type `"highlight"` too — so a
      search mark at a CFI a highlight already occupies **evicts that highlight from the
      store** while leaving its rect in the pane, where no later `remove()` can reach it.
      An *annotation* hit (a note or thread message matching) anchors to its highlight, so
      its CFI **is** that highlight's CFI every time — the reported mark sat on a
      highlighted passage, not on the query. Fixed by giving the CFI to the highlight,
      both ways: `paintSearchMarksForSection` skips a CFI `cfiOwnersRef` already owns, and
      `attachOwnedMark` reclaims one from a search mark before painting. Nothing is lost
      visually — a highlighted passage is already marked.
      ⚠️ The stale-rect candidate was checked and left alone: `refreshHighlightOverlays`
      already re-renders the panes on every real trigger, and a marks-pane rect is
      re-measured from its live `Range`, so search marks are repaired by the same call.
      ⚠️ Not re-shot live.
- [x] **Decide the matching rule; substring is why 'the' blankets a paragraph.**
      `findAllOccurrences` (server `annotations/search.ts:34`) is a raw case-insensitive
      substring scan, so "the" matches *other*, *there*, *father* — dozens of 3-char rects
      per paragraph abutting into a slab, thickened by B and opaque through A. Recommend
      whole-word by default with substring as an explicit option; whichever is chosen, say
      it in the UI.
      _Acceptance: 'the' returns word matches only; a paragraph with three matches shows
      three separate, separately steppable marks._
      ✅ Whole-word by default, substring as an explicit "Whole word" checkbox in both the
      find bar and the Scan's search field, and the rule travels with the query across the
      reader↔Scan handoff so the two surfaces never count different sets (decisions.md
      2026-08-18). The rule itself is one shared module — `shared/src/textSearch.ts`
      `findAllOccurrences(text, query, mode)` — because the server produces hits with it
      and the reader re-finds them with it; two copies would drift into two result sets.
      Boundaries are Unicode (`\p{L}\p{N}_`) and are only demanded on a side where the
      query's own edge is a word character, so `'the'`, `—` and `§4` stay searchable.
      Notes and thread bodies go through the same rule as book text.

#### D — Search results as a card (operator request, M24 follow-on)

- [x] **The Scan's results get a card**, movable and resizable like the annotation card,
      with a scrollable list: one row per hit showing the snippet (±5 words), chapter,
      page and percent, clicking a row jumps the reader to that hit. Page numbering follows
      the setting — chapter-relative when chapter numbering is on, global otherwise (reuse
      the reader footer's own reading of it, don't recompute).
      ⚠️ Reuse the existing card chrome and its register (settled decision 12); this is a
      new *view* of the M24 result set, never a second result set.
      _Acceptance: 300+ hits scroll smoothly; a row click lands on exactly the hit that
      stepping to that index does; `‹ ›` steps this same list._
      ✅ Built in the **reader**, not on the Scan — operator's call when the ambiguity was
      put to them (2026-08-18). The deciding fact: page numbers only exist where epub.js
      has paginated, so a card on the Scan could show snippet/chapter/percent but never an
      honest page. Opened from the find bar's "All results", closes with the bar.
      `web/src/search/SearchResultsCard.tsx` is a pure view — it holds no hits, no query
      and no cursor; ReaderView owns all three and builds the rows
      (`searchRows.ts`, 16 unit tests), so the card and the bar cannot disagree. A row
      click and a `‹ ›` step both go through one `goToFindHitIndex`, which is what makes
      the acceptance line structural rather than coincidental. Page numbers read the
      footer's own `pageNumberMode` and `bookPages.ts` map; a hit's page within its section
      comes from the fraction of the section before it (the hit's `percent` against the
      Scan's section weights), so there is no second position model.
      ⚠️ The list is DOM rows with `content-visibility: auto` rather than a virtualizer —
      `scrollIntoView` for the stepped cursor keeps working, and the browser skips layout
      for off-screen rows. **Not measured live** at 300+ hits: no browser this session.

#### Verify

- [x] All four reported cases re-shot: hovered annotation, multi-paragraph quote, 'female'
      in Kafka, 'the' in Kafka — judged in paper and ink.

### M24.5 — Themes worth colouring

Split out of M24 deliberately (decisions.md 2026-08-14): search is nearly free because its
pipeline already exists, while this milestone rests on an open question about LLM output
quality. Bundling them would have stalled the cheap work behind the risky work. Appended
as M24.5 rather than renumbered, per OPUS.md.

**The operator's symptom, and the cause.** *"After one digest there are too many themes —
too much to follow"*, and *"I'd like more general themes with colour keys."* These are one
problem, not two. `thematicBuild.ts` asks for up to **8 short theme names per chapter
part**, free text, deduplicated into a per-book `themeVocabulary` that feeds the Scan's
dropdown — so a normal book produces dozens. And the phosphor palette has exactly **four**
colours, keyed to the four highlight kinds; themes carry no colour at all.

⚠️ **You cannot key an unbounded vocabulary to colour.** A 30-item legend is a worse
instrument than none. So bounding the vocabulary is the *prerequisite* for the colour key,
not a companion improvement — do these in order or the second one cannot land.

- [x] **A distillation pass gives each book ~6–8 book-level themes**, with the existing
      specific chapter themes kept and folded underneath as children. Specific themes stay
      valuable; they stop being the top-level vocabulary.
      ⚠️ **Distil from the chapter themes and analyses already stored, never from the book
      text again.** This is a small call over material already paid for; a second full-book
      pass would double a digest's cost for a labelling change.
      ⚠️ Settled decision 11 applies: the model returns **names**, code does the rest.
      _Acceptance: on both fixtures the distilled set is 6–8 themes, every chapter theme is
      assigned a parent, and the token cost of the pass is recorded in the ledger and is a
      small fraction of the digest that preceded it._
      ✅ `server/src/digest/themeDistillation.ts`: one `extract()` call over every stored
      chapter's `analysis` + `themes` (never the book text), asking for 6-8 book-level
      groups. "Code disposes": a returned child not in the resource's real chapter-theme
      vocabulary is dropped; any chapter theme the model left unassigned (or that got
      dropped) is placed under its nearest book-level name by Levenshtein similarity in
      code, so "every chapter theme is assigned a parent" is a guarantee the function
      keeps rather than leaves to the model. Routed through `getProvider(db, "digest",
      "theme-distillation", …)`, a new `LLMOperation`/`UsageOperationSchema` value, so its
      cost lands in the ledger under its own tag automatically (`withUsageLedger`, same as
      every other operation) — not separately measured against a real book this session
      (no configured provider), so "a small fraction of the digest that preceded it" is
      architecturally true (the input is a handful of short analyses, not book text) but
      not measured. Ten unit tests (`themeDistillation.test.ts`) cover grouping, the
      hallucinated-child drop, the unassigned-theme fallback, the no-chapters no-op, and
      cross-book matching.
      ⚠️ **Not run against either real fixture book this session** — no LLM provider
      configured, no browser. The "6-8 themes, judged good" half of the acceptance line is
      the Verify item below, still open.
- [x] **Each book-level theme owns a phosphor colour**, derived deterministically from its
      position in the book's own distilled set, so a rebuild of the same digest produces the
      same key. The four kind hues stay reserved for kinds — themes need their own ramp.
      _Acceptance: the legend is readable at a glance; rebuilding a digest does not reshuffle
      the colours; theme colours are never confusable with kind colours in either mode._
      ✅ `--theme-ramp-0..7` (theme.css), one hue per book-level theme, solved
      computationally for the 8 points (on top of the 4 existing, unevenly-spaced kind
      hues) that maximise the *minimum* pairwise separation across all 12 — ~28° apart at
      closest, vs. ~10° for naive even 45° spacing (method in the CSS comment). Colour is
      assigned once, at canonical-theme *creation* (`resolveCanonicalThemes`, position in
      that call's own list, mod 8), and never recomputed — a rebuild re-matches an
      already-seen name onto its existing row rather than re-deriving a colour, which is
      what makes "does not reshuffle" true by construction rather than by care at each
      call site (`canonicalThemes.test.ts`: "never reshuffles a colour once assigned…").
      `web/src/digest/themeRamp.ts` is the one place index → CSS var is decided, so the
      Scan and the digest page's own legend can't disagree.
      ⚠️ **Not judged by eye** — no browser this session; contrast/confusability against
      the kind hues was reasoned about via hue separation, not measured live.
- [x] **The canonical vocabulary self-populates across books.** When Book B's distilled
      themes are computed, each is matched against the themes already seen in the library:
      a match adopts the existing canonical theme (and its colour), a miss creates one. So
      the shared vocabulary is *discovered* from reading rather than authored up front, and
      a theme common to two books is recognisably the same theme in both.
      ⚠️ **Reuse `matchConcept`'s rule rather than inventing a heuristic** — slug-normalised
      equality, then alias equality, then Levenshtein similarity ≥ 0.85 (`vault/concepts.ts`,
      already tested). If it needs to differ for themes, say why in NOTES.md.
      ⚠️ **Canonical themes live in SQLite, not the vault.** This is the sidecar-is-truth
      rule (settled decision 6) and is what keeps this milestone independent of the parked
      vault-concept work.
      _Acceptance: digest two books sharing an obvious theme and confirm they land on one
      canonical entry with one colour; digest two books sharing nothing and confirm no
      spurious merge; a near-miss pair ("Doubling" / "The double") is decided by the rule
      and the outcome is recorded either way._
      ✅ `resolveCanonicalThemes` (`server/src/digest/canonicalThemes.ts`) calls
      `matchConcept` directly, passing `aliases: []` throughout — the distillation pass
      never collects aliases (the model returns a name, nothing else, per decision 11), so
      only the slug-equality and Levenshtein tiers are actually reachable here; alias
      equality is dead code for themes specifically, inherited for free rather than
      reimplemented. A new `canonical_themes` table (migration v24), library-wide (no
      `resource_id`), plus `book_themes`/`theme_parents` junction tables scoping the
      canonical vocabulary to what each book actually surfaces. Unit-tested: two books
      sharing "Isolation"/"isolation" land on one canonical id with one colour
      (`themeDistillation.test.ts`); within a single call, near-duplicate names also
      collapse (`canonicalThemes.test.ts`). The "Doubling"/"The double" near-miss pair the
      acceptance line names: slugified similarity is **0.30**, well under the 0.85
      threshold — the rule keeps them as two separate canonical themes (asserted in
      `canonicalThemes.test.ts`). NOTES.md M24.5 has the full design writeup.
- [x] **The Scan's theme filter becomes the colour key** rather than a dropdown of dozens:
      book-level themes as coloured, toggleable entries, specific themes reachable
      underneath.
      _Acceptance: a book with no digest still shows a coherent Scan (today's fallback
      behaviour is preserved); filtering by a book-level theme lights every child theme's
      highlights._
      ✅ `ThemeFilterKey.tsx` replaces the flat `<select>` with one chip per book-level
      theme (swatch + name, toggleable), a disclosure per chip revealing its specific/
      chapter-level children as their own clickable chips underneath — falling back to
      today's exact dropdown when `bookThemes` is empty (no distillation run yet), same
      branch structure as the pre-existing `hasDigest`/no-digest fallback one level up, so
      "a book with no digest still shows a coherent Scan" is unchanged.
      `themeFilter.ts`'s `activeThemeNames(selection, bookThemes)` is the one place a
      selection becomes "which specific theme names light up" — a book-level pick expands
      to every child, a specific pick is unchanged from before distillation existed — and
      both `HeatStrip`'s Book layer (`litTheme` generalised to `litThemes: string[] | null`)
      and the Mine layer's own `litIds` filter consume that same array, so a selection can
      never light one layer's themes and not the other's.
      ⚠️ The chips use a *second*, separately-solved phosphor ramp
      (`scanPalette.ts`'s `THEME_PHOSPHOR_RGB`) rather than `theme.css`'s
      `--theme-ramp-*` directly — the Scan overrides `--color-bg` to near-black
      (`ScanPage.module.css`'s own comment on this), the same reason the four kind hues
      already get a separate neon translation (`phosphorHue`) rather than reusing
      `--kind-*` verbatim. Not spotted until wiring this task, so `--theme-ramp-*` (used
      by the digest page's legend, which sits on the normal paper/ink page) and
      `THEME_PHOSPHOR_RGB` (used here) are deliberately two renderings of the same
      `colorIndex` identity, exactly like kind colours already work.
      11 new unit/component tests (`themeFilter.test.ts`, `ThemeFilterKey.test.tsx`).
      ⚠️ **Not run in a browser this session** — selection/expansion logic and the fallback
      branch are covered by tests; the legend has never been seen rendered.
- [x] **Verify:** rebuild a digest from scratch and confirm the key is stable; judge on both
      fixtures whether the distilled themes are actually *good* — if they are not, that is a
      prompt problem to solve here, not something to ship and route around.

### M24.7 — Reader chrome v2: one line, nested clusters, an immersive page

The operator's design pass, run with Claude Design and written up in
**`docs/marginalia/READER_REDESIGN.md` — read it first; it is binding for this milestone**
and carries the numbers (spacing, radii, tokens) this section deliberately doesn't repeat.
Its own rule holds: **read the `.dc.html` design files, don't measure the screenshots.**
Those templates (`templates/reader-chrome-v2/ReaderChromeV2.dc.html`, frames `ReaderShellV2`,
`ReaderStripStackedV2`, `AnnotationEditorV2`, `SearchPebbleV2`, `FullscreenReaderV2`) live in
the synced design project, **not in this repo** — pull them before building; the screenshots
in the operator's message are illustrations of them, not the spec.

Numbered `.7` rather than inserted as a new M25, per OPUS.md's renumbering rule: M25–M28 are
referenced ~30 times across CLAUDE.md, decisions.md, SPEC.md, PAGE_CURL.md and TASKS_DONE.md,
and this is the second renumbering that would have landed in a week. **It is still the next
milestone** — web search (M25) and Codex CLI (M26) wait behind it.

The driving problem, in the operator's words: controls get *dropped* to avoid colliding with
the floating nav, so digest state and progress vanish exactly when they're wanted. The fix is
to stop hiding and start **nesting**.

#### What is actually true today

Read before building; three of these contradict the brief's assumptions and one contradicts
the operator's message.

1. **The reader's chrome is in four places, not two.** `ReaderPage.tsx`'s `.titleBar`
   (cover + title + author), `ReaderView.tsx`'s `.topRow` (annotations button · progress
   Slider · ChapterNav · digest-chapter button · query ProviderPickerPopover · the whole
   audio transport row), `ReaderActionsCluster` (Digest · digest provider · Scan · Publish)
   floating beside the card, and `App.tsx`'s own floating `NavCluster`. One 48px line means
   **merging all four**, not restyling one.
2. **`actionsBesideCard` is the mechanism this milestone replaces.** M22.5 measures whether
   there is room beside the card and drops the cluster below the footer when there isn't
   (`ReaderView.tsx:490-495`, and the `topRowReserve` / `compact` props that follow from it).
   Nesting supersedes it. ⚠️ **Do not ship both** — a measurement that moves controls *and*
   clusters that nest them is two answers to one question.
3. **`f` is focus mode; fullscreen is `shift+F`.** The operator's "pressing F just hides
   annotations" is exactly right about `f` — but M14 fullscreen already exists on `shift+F`,
   already hides the strips and rail, and already proximity-reveals them
   (`useFullscreenChrome.ts`, `FULLSCREEN_REVEAL_BAND_PX`). §G is a **rework of M14**, not a
   new mode. The design's "F to leave" hint therefore either needs relabelling to `⇧F` or a
   deliberate rebind — M19.7's "keycaps that cannot lie" forbids shipping the hint as drawn.
4. **There is not one container query in the codebase.** `grep -r container-type web/src`
   returns nothing; every responsive decision today is a viewport media query or a JS
   measurement. §C is the first, so it also sets the convention.
5. **`SearchResultsCard` is already the movable annotation-shell window** the brief proposes
   as new work — drag by header via `dragControls`, resize, `clampPanelOffset` shared with
   `ThreadPanel` (`search/SearchResultsCard.tsx`). Extend it; do not create
   `SearchResultsWindow` beside it.
6. **The web-search control is inert on purpose** (`ContextLadderToggle.tsx`, "coming in a
   later milestone"). §F restyles it as a globe; **it stays inert until M25.** Making it live
   here would take the second cloud dependency without its seam — settled decision 10.
7. **M24.1 §C is still open** (hits re-located by content, so repeated words collapse onto one
   mark). It is not a prerequisite — it is in the locating layer, this milestone is in the
   chrome layer — but the search pebble cannot be *judged by eye* until it lands.

#### A — The top strip becomes one 48px line

- [x] **One row, three zones: reader functions left, the book's identity centre, chrome
      right.** Left: annotation-count chip · `‹ chapter ›` · digest cluster · listening
      cluster. Centre: cover thumb + title + author, moved down out of `ReaderPage`'s
      `.titleBar` (which stops existing as a separate row). Right: the nav pebble — library,
      search, **scan**, settings, theme trio.
      ⚠️ **Identity redesigned 2026-08-24** (decisions.md, same entry as §C's rewrite):
      title stacked over author (`.identityText`, column flex — needs the wider line, not
      their combined width) rather than side by side; a line that genuinely overflows its box
      (`scrollWidth > clientWidth`, `useMarqueeOverflow.ts`) ping-pong scrolls instead of just
      eliding, gated off under `prefers-reduced-motion` (falls back to ellipsis, verified
      live). `.topRowCenter` itself carries no `max-width` — see §C's rewrite for why a cap
      there was the wrong fix for the bug that prompted this.
      ⚠️ The cover thumb carries the doorway transition's `layoutId`
      (`coverLayoutId(resource.id)`, ReaderPage.tsx:288). **Moving it must not break the
      shared-element flight from the library card** — M7's proof; verify by opening a book,
      not by reading the diff.
      ⚠️ `NavCluster` owns a `leadingSlot` that rooms portal into (`chromeSlot.tsx`; DeskPage
      uses it). The reader's chrome-right zone should use that seam rather than growing a
      second one.
      _Acceptance: at a normal window the reader shows exactly one line of chrome above the
      page and one below; nothing from today's four places is missing; the reading card is
      taller than before by roughly the height of the row that went away._
- [x] **Publish, the tasks tray and the unanchored badge keep a home.** The design's zones
      don't name them: `Publish` is in today's actions cluster, `TasksTray` is inside
      `NavCluster`, and the annotations button carries an `unanchoredIds` badge.
      ⚠️ Ground rule from the brief — **nothing disappears to make room**; place each one and
      say where in NOTES.md. Publish belongs with the digest cluster or the nav pebble, not
      in the reading line's left zone.
      _Acceptance: publishing a book, watching a job, and spotting an unrelocatable highlight
      are all reachable from the new strip without opening Settings._
- [x] **Focus mode's own state stops being a sentence in the strip.** Today `f` replaces the
      annotations chip with "Notes hidden — press F to show" (ReaderView.tsx:2704) — a
      width-changing string in a row that must not change width.
      _Acceptance: `f` toggles notes with no reflow of the strip; the state is legible without
      reading a sentence; the keycap hint still tells the truth._

#### B — The foot mirrors it

- [x] **`‹` · `Page n of m` | `nn%` · `›`, with an instruments pebble at the right** (heat
      strip, search, fullscreen), at the same 40px height as the strip's second row.
      Progress moves **out of the top strip** — the `Slider variant="trigger"` +
      `ProgressPopover` pair currently sits between the annotations chip and ChapterNav.
      ⚠️ **Keep the real dial.** Dragging the `%` must still raise `SliderDial` with its
      chapter ticks (`chapterDialTicks`, `extraTicks`) and its "release to jump" commit path
      — that is M12's instrument, not a decoration to reimplement.
      _Acceptance: dragging the percentage scrubs and shows the chapter tick exactly as
      today; clicking it still opens `ProgressPopover`; `PageNumberDisplay`'s book/chapter
      modes both still render in the centre slot._

#### C — Responsive on the pane, not the window

- [x] **A measurement on the reading pane drives the two-row fallback**, on `.topRow`/
      `.footer`: row 1 = identity + nav pebble (theme trio collapses to a single cycling
      icon); row 2 (stacked) = the reader's own functions, the chapter label taking the slack
      between its arrows so it never elides to "S…". Foot keeps its three parts, dropping to
      `1 / 11` + `%`.
      ⚠️ **Redone 2026-08-24, twice** (decisions.md — read the full entry, it's a real
      diagnostic story worth not repeating). First raised the static `@container` threshold
      600px→720px for a genuine bug (controls not fitting), which didn't fix a *second*,
      unrelated overlap reported right after (a long title colliding with the chapter nav) —
      two more CSS attempts at that second bug were also wrong, because a fixed pane-width
      breakpoint structurally can't know how much room a title needs, nor how much three
      sibling zones leave each other. Measured live with Playwright instead of reasoning
      further from the CSS, which found the *real* bug: `.topRowLeft` overflowing its own
      grid track. Now: `.topRowLeft`/`.topRowRight` are bare `auto` (never compressed — they
      hold controls, which are never safe to clip); `.topRowCenter` is the sole
      `minmax(0, 1fr)` track; `useReaderStripLayout.ts` measures `.topRow` against
      `.topRowLeft`'s/`.topRowRight`'s real widths and toggles a `readerStripStacked` marker
      class once what's left for identity drops under ~140px (first estimate, expect
      tuning). `PageNumberDisplay`/`ChapterNav`/`NavCluster` key their own narrow rules off
      the same marker, not `@container`, so all four stay in lockstep by construction.
      ⚠️ **Breakpoint on the pane, never the viewport** — the reader can be docked narrow on
      a wide screen (brief's ground rule, and `useReaderPaneWidth` already makes pane width
      independent of window width). Still true of the JS measurement: it reads `.topRow`'s
      own rendered width, never `window.innerWidth`.
      ⚠️ `container-type: inline-size` stays on `.topRow`/`.footer` even though nothing
      queries it anymore for this decision — removing it wasn't checked to be safe against
      the fold/stage geometry (`.stage`, `readerRowRef`, `pageClipRef`, `pageSnapshot` —
      PAGE_CURL.md §5), so it's dead weight rather than a cleanup task done here.
      ⚠️ The collapsed theme control must stay reachable for keyboard and screen readers:
      three focusable buttons become one **cycling** button that announces the theme it will
      move to, not an icon with no name.
      _Acceptance: docking the reader narrow on a wide screen produces the two-row layout;
      resizing the window without changing the pane does not; the switch is stable in both
      directions with no flicker at the boundary (verified live: 936px narrowing, 938px
      widening); the chapter label stays readable at every width._

#### D — Expanding clusters

- [x] **One shared `ExpandingCluster` wrapper**, built on `FlyPanel` so the panel grows from
      its own control (decisions.md 2026-07-30, "popups slide from where they were called").
      Pointer: open on hover after **120ms**, close **140ms** after pointer-out — the delay
      is what stops flicker when crossing between two adjacent icons. Touch: long-press
      ~**380ms**. Click pins; Esc or outside-click closes.
      ⚠️ **A pinned panel is a dialog**: `useDialogA11y` (focus trap, Esc, focus returned to
      the control). Hover-only functions are not reachable by keyboard or touch at all.
      ⚠️ **This replaces `ReaderActionsCluster`'s hover-revealed labels** (`ActionAnchor`),
      it does not stack on them. NavCluster.tsx already records the operator's ruling that a
      third disclosure mechanic beside the proximity-revealed labels was "one too many" —
      adding clusters means retiring the labels they absorb.
      _Acceptance: crossing from the digest icon to the listening icon and back never
      flickers a panel; every function inside a cluster is reachable by Tab and by long-press;
      Esc closes and focus lands back on the icon that opened it._
- [x] **The digest cluster**: *Digest this chapter* · *Open digest · S12* · the digest model
      (today's `ProviderPickerPopover role="digest"`, moved inside).
      ⚠️ **Job state becomes a ring around the icon, never a width change.** Today the strip
      renders the string "Digesting…" / a result label in place of a button
      (`digestChapterJobId`, ReaderView.tsx:2781-2795) — that is the exact behaviour the
      operator is asking to remove.
      _Acceptance: starting a chapter digest changes no element's width; progress is visible
      at a glance without opening the cluster; the finished state is reachable from the same
      icon._
- [x] **The listening cluster**: transport (⏮ ▶ ⏭), read-from-here, speed, cast target — and
      the icon at rest shows play/pause so the common action stays one click away.
      ⚠️ It must absorb **all** of today's transport row, including the two conditional
      controls: the M22.6 "back to the voice" locate button (shown only while the view has
      wandered from the sounding section) and the audio error status. A conditional control
      that silently disappears into a cluster is a regression, not a simplification.
      _Acceptance: start playback, scroll away, and return to the voice without opening
      Settings; pause is one click from rest; cast still opens `CastingModal` with its
      fly-from origin; an engine error is still visible without opening the cluster._

#### E — Search means find, Scan gets its own glyph

- [x] **Split the magnifier.** The magnifier becomes **Search** (find in book, `Cmd/Ctrl+F`);
      the Scan gets a new glyph — bars inside a rounded frame, echoing the heat strip it
      opens. Both live in the nav pebble. `SHORTCUT_KEYS.scan` (`q`) is unchanged; its
      `KeyCapAnchor` follows the icon.
      _Acceptance: the magnifier opens find-in-book from every reader state; the Scan is
      still one glyph and one keystroke away; no two controls in the reader share a glyph._
- [x] **`FindBar` becomes a pebble floating over the page** — magnifier · query · count ·
      `‹ ›` · whole-word · **List** · open-in-Scan · close — instead of a full-width band
      inside `.topRow`.
      ⚠️ It currently inherits fullscreen's proximity reveal *for free* by being mounted
      inside the `.topRow` wrapper (its own docstring says so). Floating it over the page
      **loses that**; give it an explicit fullscreen behaviour or Cmd+F silently does nothing
      visible in §G's immersive mode.
      ⚠️ Floating over the page means floating over `.stage` — the page fold's grab surface
      (M22.5's rule). It must not steal the peel gesture; the fold's own hit test is the
      thing to check, not the z-index.
      _Acceptance: Cmd+F over a spread never shifts the text; the pebble is dismissible with
      Esc with focus returned to the page; a page-corner drag still peels while the pebble is
      open._
- [x] **The results window earns its hierarchy.** Extend `SearchResultsCard`: title bar
      (`"query"` · `23 in 4 chapters` · order control · close), sticky chapter headers with
      per-chapter counts, one row per hit — snippet in the serif reading face, single line,
      ellipsised, with page and `%` in a quiet tabular right column — and a footer
      (`↑↓ move · ⏎ jump · ⇧⏎ open in Scan` · `Show all 23`). Only the selected row is
      coloured: 2px accent left edge plus
      `color-mix(in srgb, var(--color-accent) 12%, transparent)`.
      Dropped deliberately: per-row chapter name, per-row highlight boxes, the second
      metadata line.
      ⚠️ **Still one result set, two views** (decisions.md 2026-08-14). The window holds no
      hits, no query and no cursor of its own; the order control changes the *shared*
      ordering that `‹ ›` steps.
      _Acceptance: the window and the pebble can never disagree about the count or the
      current hit; keyboard alone can move, jump and open-in-Scan; position is remembered
      across opens and clamps back into bounds after a resize._

#### F — The annotation editor takes the query model

- [x] **`ProviderPickerPopover role="query"` moves out of the reader strip into
      `ThreadPanel`'s composer**, immediately left of **Ask** — the model belongs where the
      question is asked. Action row order is always ladder · web · model · **Ask**.
      _Acceptance: choosing a model in the editor is what the next question uses; the reader
      strip no longer carries a model control; the Settings path to the same choice still
      agrees with it._
- [x] **The resolved narrow variants** (~300px, the realistic docked width), from the brief's
      table — build these, don't re-open them: context ladder → a single dropdown; web search
      → a globe icon toggle; model → dropdown with short names; **Ask keeps its word**. Below
      ~280px the model select wraps above the row rather than compressing Ask.
      ⚠️ **The globe stays inert until M25** (see grounding note 6) — restyled, still
      disabled, still titled as coming later.
      _Acceptance: at 300px all four controls fit on one row with "Ask" legible; at 280px the
      wrap happens and Ask is still a word; the ladder dropdown selects the same three depths
      the segmented control did._

#### G — The immersive page (a rework of M14 fullscreen)

- [x] **No card, no strips, no rail.** The page becomes the whole surface with a soft vignette
      holding the eye on the column. Position survives as a 2px hairline along the bottom
      edge; the highlight rail dims to faint dots at the right edge.
      _Acceptance: in immersive mode nothing but the text, the vignette, the hairline and the
      dots is painted; the reading column's measure is unchanged from normal mode at the same
      pane width._
- [x] **One pebble wakes on pointer movement** — page, `%`, digest, listening, exit — and
      sleeps again after ~2s. This **replaces M14's four reveal flags** (`revealTop`,
      `revealBottom`, `revealRail`, `revealActions`) with one.
      ⚠️ **Two pointer paths drive the reveal, not one.** `useFullscreenChrome`'s
      window-level listener only fires over the parent document; the iframe-forwarded
      `mousemove` inside `ReaderView`'s book-loading effect is what fires while the cursor is
      over the page itself. M14 lost a session to exactly this (NOTES.md "M14") — update both
      or the pebble never wakes where the reader's cursor actually is.
      ⚠️ An unrevealed panel is `pointer-events: none`, so it cannot be the thing that reveals
      itself.
      _Acceptance: moving the pointer anywhere over the text wakes the pebble; it sleeps
      after ~2s of stillness; hovering the pebble itself keeps it awake; the keyboard path
      (Tab) reveals it without a pointer at all._
- [x] **Decide the two open questions and record them** (READER_REDESIGN.md §6): does
      selecting text in immersive mode open the editor inline over the column or a
      fullscreen-native side sheet, and does scrolling re-sleep the pebble or only pointer
      idle. One line each in decisions.md when chosen — this is the operator's call to make
      while driving it, not a coin flip in code.
- [x] **The binding tells the truth.** Either relabel the exit hint to `⇧F` or rebind
      immersive mode to `f` and give focus mode a different key — and update
      `shortcuts/keys.ts` so the keycaps follow (grounding note 3).
      _Acceptance: the hint on screen matches the key that actually leaves; focus mode and
      immersive mode remain two distinct axes (notes hidden vs chrome hidden)._

#### Ground rules for the whole milestone

- **No new colour values.** Everything resolves to existing tokens; `color-mix()` against
  them for washes and softened borders (ds-bundle README: "if a name isn't here, it doesn't
  exist").
- **No new register.** The reader's chrome is `register-paper register-quiet`; pebbles are
  built in it. `register-glass` stays the Scan's alone (settled decision 12).
- **Nothing disappears to make room.** If it doesn't fit, it nests in a cluster or moves to
  the second row.
- **Motion** uses `--ease-standard` / `--duration-standard`; controls use
  `--control-hover-transform` / `--control-pressed-transform`.
- Extend the existing components — `FindBar`, `NavCluster`, `ChapterNav`, `SliderDial`,
  `ProgressPopover`, `FlyPanel`, `HeatStrip`, `ProviderPicker(Popover)`, `AskPill`,
  `IconButton`, `SearchResultsCard` — rather than writing parallel ones. Genuinely new:
  `ExpandingCluster`, the Scan and globe icons, the immersive overlay.
- `ds-bundle` is a sync of these components to the design project (`_ds_sync.json` holds a
  render hash per component). Components this milestone reshapes will need re-syncing, or the
  design project's copy silently describes the old reader.

#### Verify

- [x] **Driven live, on a real book, in both themes**: one line of chrome at a wide pane, two
      rows at a narrow *pane* on the same wide window, both clusters opened by hover, click,
      keyboard and long-press, Cmd+F over a spread, the results window moved and reopened,
      a question asked with the model chosen in the editor, and immersive mode entered and
      left by the key the hint names.
- [x] **The page is measurably taller** than before at the same window size, and the page fold
      still peels from every corner with the new chrome mounted.

### M29 — Digest reliability: stop blocking on a live LLM call, add timeouts and retries

**Moved ahead of M25–M28 on 2026-08-24** (decisions.md) — its own number is unchanged, only
its position in this file is; per the standing rule ("reorder only for a real dependency"),
the dependency here is that M25 is now parked, M26 is gated on a Codex login that hasn't
happened yet, M27 is already parked, and M28 is explicitly "not scheduled" — so M29 is the
actual next live milestone, and its own implementation already landed. Only its Verify is
open.

Diagnosed 2026-08-22 (operator: "Open digest" often takes forever or fails; background
digest jobs fail at the fetch stage). The `digest` role's provider profile is
`openai-compatible` against a local Ollama endpoint (`localhost:11434`,
`qwen3.5-hermes:latest`) — **not the SSH tunnel**, which only carries browser↔server HTTP
traffic and never sees the LLM call; the same slowness shows up running the app natively
on the Mac because the bottleneck is server-side, against `localhost`, on both machines.
Root causes, all confirmed by reading the code and by two real `digest_runs` rows with
`last_error: 'fetch failed'`:

- [x] **Stop `GET /:id/digest` blocking on a live LLM call.**
      `maybeRefreshBookDigestSnapshot` (`server/src/digest/build.ts`) is `await`ed inline
      in the route handler (`server/src/routes/digest.ts`) with no try/catch, despite its
      own doc comment calling it "best-effort, silent" — a slow or failing Ollama call
      currently stalls or 500s the whole digest-open request. Make the refresh
      non-blocking: respond with whatever snapshot already exists, and refresh in the
      background so a page open never waits on an LLM round-trip.
      _Acceptance: opening the digest for a book whose snapshot is stale returns
      immediately with the last-known-good snapshot; the refreshed snapshot appears on a
      subsequent open/poll; killing Ollama mid-refresh does not affect the digest-open
      response._
- [x] **Timeout every LLM fetch.** `OpenAICompatProvider.stream()` and `.extract()`
      (`server/src/llm/openaiCompat.ts`) issue raw `fetch()` calls with no deadline — a
      stalled connection hangs indefinitely. Bound both with a per-request timeout,
      surfaced as a designed `LLMError`, not a hang.
      _Acceptance: pointing the digest role at an endpoint that accepts the connection but
      never responds fails within the configured timeout, not never._
- [x] **Retry transient network failures in digest/thematic runs.** `runDigest` /
      `runThematicDigest` (`server/src/digest/build.ts`,
      `server/src/digest/thematicBuild.ts`) only pause-and-auto-resume on
      `LLMError.code === "rate_limit"`; every other error, including `"network"` (the
      literal `"fetch failed"` seen in `digest_runs.last_error`), marks the whole job
      failed with no retry — confirmed `server/src/jobs/registry.ts` has no retry logic of
      its own either. Generalize the existing pause/resume path to also catch `network`
      errors, with a shorter backoff than the rate-limit one.
      _Acceptance: a digest run that hits one transient connection failure mid-book
      recovers on its own (a brief pause in the tasks tray, not a failed job) instead of
      requiring a manual restart._
- [x] **Surface digest-load errors on the client instead of an infinite spinner.**
      `fetchDigestStatus` (`web/src/digest/DigestPage.tsx`) swallows every error and
      returns `null`, so a failed request leaves the page on "Loading digest…" forever
      with no feedback. Distinguish "still loading" from "errored" and show a retry
      affordance.
      _Acceptance: killing the server (or Ollama) mid-load shows a visible error state
      with a retry button, not a stuck spinner._

Out of scope here: local-model operational tuning (e.g. Ollama's `keep_alive`, keeping the
model warm) — recorded as an operator follow-up, not code; the retry/timeout work above
should make the app resilient to that regardless of how it's tuned.

#### Verify

- [x] Drive both scenarios live against the real local Ollama profile: open a digest whose
      snapshot is stale (confirm it's no longer the slowest interaction on the site), and
      run a multi-chapter background digest, confirming a network hiccup no longer kills
      the job outright.