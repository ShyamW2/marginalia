# Marginalia — Task List

Work strictly in order. Check items off (`[x]`) as you complete them and commit after
each task (small, focused commits). Each milestone ends with a **Verify** step — do it
for real (run the app, click the thing) before moving on; if verification fails, fix
before proceeding. Rules of engagement: docs/marginalia/SONNET_PROMPT.md.

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
| M23 | — | Web search (added 2026-07-28) |

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
      also carries the **web-search control, present but inert** until M23.
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


## v1.9 — the global overhaul (M19.6, M19.7, M20.5, M20.6, M20.7)

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
- [ ] **The two token sliders.** Context length **per profile** (log2, 1024 → 200K,
      detenting on powers of two) and max response length **per role** (250 → 10000,
      linear) — query and digest separately, since one profile can serve both roles and a
      per-profile length could not express "same model, longer digests". Additive
      migration; existing values carry over untouched.
      ⚠️ Both `claude-agent` and `codex-cli` cannot enforce a response ceiling — it is a
      request in the system prompt. The field must keep saying so, per role.
      _Acceptance: set digest to 8000 and query to 1000 on the same profile and watch the
      ledger show the difference; existing settings survive the migration; a local model's
      context slider actually changes what `capabilities().contextTokens` returns._
- [ ] **Codex CLI as a fourth provider.** `server/src/llm/codexCli.ts` behind the existing
      seam — no new call sites — spawning `codex exec --json` with `--output-schema` for
      `extract()`. **Caged, and the cage is part of the provider:** `--sandbox read-only`,
      approvals never, `--ephemeral`, `--skip-git-repo-check`, `-C <dedicated empty scratch
      dir>`, and a scrubbed environment. See the 2026-07-30 decisions entry for why this
      bounds settled decision 2 rather than breaking it.
      ⚠️ **The real gate is auth, and it is not satisfied on this machine.** There is no
      `~/.codex/` directory at all as of 2026-07-30, so the CLI has never been run here —
      the operator must `codex login` before any of this can be verified, and no amount of
      implementation gets around it. Confirm that first, or this task will be "started"
      twice.
      ⚠️ **Then run one real call and read the actual JSONL**, then write the
      event shape into NOTES.md. The flags above were read from `--help` on
      `codex-cli 0.114.0`; the event schema was not, and this project has already lost a
      session to trusting a remembered API shape (NOTES.md, M4).
      _Acceptance: a thread answers end to end on Codex; `extract()` returns schema-valid
      JSON via `--output-schema`; killing the CLI mid-stream surfaces a designed `LLMError`,
      not a crash; the sandbox flags are proven by asking it to read a file in the repo and
      confirming it cannot; usage lands in the ledger with honest provenance (`estimated`
      if the CLI reports no tokens)._
- [ ] **Verify:** open every overlay in the app from every entry point that opens it,
      operate every new control with the keyboard only, and switch registers by moving
      between the desk, the reader and the scan. Both themes, reduced motion. The bar is
      the same one M19 set for settings: **judge honestly whether it is pleasant, and fix
      what feels clumsy before checking this off.**

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

- [ ] **Baseline the metrics before touching anything.** Record: `ReaderView.tsx` size and
      hook count (currently **1,865 lines**, 64 hook calls), test count (currently 214),
      bundle size and chunk count (M17.5 put this in the build output), and the current
      live-verification result for the reader. Into NOTES.md.
      _Acceptance: a before-table exists that the after-table can be compared against._
- [ ] **Thicken the net where it's thin.** Characterization tests for reader behaviour
      with no unit coverage — capturing what the code **currently does**, oddities
      included. If today's behaviour is strange, the test records the strangeness; you are
      proving you changed nothing.
      _Acceptance: the new tests fail if page-turn, selection, or position behaviour
      changes, and pass against today's code without modifying it._
- [ ] **Decompose `ReaderView.tsx`** along the seams already implicit in it — book
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
- [ ] **Verify:** the after-table against the before-table, plus a full live reader pass —
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

- [ ] **Fold geometry on canvas.** Replace `PageCurl.tsx`'s rigid spine hinge
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
- [ ] **Grab anywhere in the outer band.** Retire the 18px `edgeGrab` strips; the
      M11 semicircular zones become the grab surface, and the fold anchors to
      whichever corner is nearest the grab point (so grabbing low-right folds the
      bottom-right corner up, not the whole right edge). **Keep
      `setPointerCapture`** — see the M10 notes and NOTES.md: without it a drag
      crossing into the sandboxed epub.js iframe crashed the tab outright. This is a
      real, reproduced crash, not a theoretical one.
      _Acceptance: folds initiate from any corner region; a drag that travels across
      the iframe never leaks events into it; release still commits past threshold or
      springs back below it._
- [ ] **Spread-aware.** In two-page mode the fold canvas is sized and positioned to
      the **near leaf only**, not the whole stage.
      _Acceptance: in spread mode the right leaf folds away revealing the next leaf,
      while the left page stays flat and undisturbed._
- [ ] **Perf & fallbacks.** One canvas, redraw only while a fold is live, target
      60fps; keep the existing reduced-motion and low-fps slide fallbacks and the
      snapshot-capture timeout (a stalled capture must never freeze reading — see
      M10). Log any new epub.js/html2canvas quirks in NOTES.md.
      _Acceptance: sustained 60fps through a fold on the dev machine; reduced motion
      still renders zero canvas/fold elements; a failed snapshot degrades to a slide._
- [ ] **Verify:** page through a chapter by folding from several different corners,
      with notes attached and in both single and spread modes — the paper reads as
      paper, notes ride the folding sheet as they do today, and reading with the
      effect on still feels calm.

### M20.5 — The instrument case (the Scan and the Digest become instruments)

**Read the 2026-07-30 decisions entry's "Scan and Digest stop being rooms" section
first.** This changes DESIGN.md's thesis from three rooms to **two rooms and four
instruments**, deliberately and by amendment — and it spends the airlock's full-screen
form. That is settled; do not re-derive it, and do not try to keep both.

- [ ] **The Scan becomes a popup in a CRT television.** The existing scan panel renders
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
- [ ] **`q` opens the scan** for the book in focus, through M19.7's registry. Larger base
      type throughout the panel — it is smaller than a full page now and was already at the
      edge of comfortable.
      _Acceptance: `q` types "q" in a text field; the scan's smallest readout passes
      contrast and is legible at the popup's default size, warped, at full CRT intensity._
- [ ] **Barrel distortion scales further with CRT intensity.** Raise `MAX_PULL_PX` in
      `warp.ts` — the single knob, by design, and everything that must land where it looks
      (heat bands, hit targets, the torch's successor) already derives from it.
      ⚠️ M18's legibility bound is **not** repealed: contrast still passes, and intensity 0
      still means zero displacement. Larger type pays for some of the extra warp; it does
      not license unbounded warp.
      _Acceptance: at maximum intensity every readout is still legible and clicking a band
      near a **corner** (not the centre) still selects that band — verified with
      `elementFromPoint`, per the M18 note, not bounding-box math._
- [ ] **Rebuild zoom as a domain transform, and add scroll-to-zoom.** Delete the CSS
      `scaleX` on `.zoomContent` — it is what stretches the axis text and the heat bitmap.
      Labels position through `fractionToView()` like the book bands already do, and the
      heat canvas is redrawn at the zoomed domain. Then wheel-over-the-strip zooms about
      the cursor, with the existing buttons kept and enlarged as the keyboard/pointer-free
      path.
      _Acceptance: axis labels are pixel-identical in shape at every zoom level; the heat
      field is sharp when zoomed in, not stretched; wheel-zoom keeps the domain point under
      the cursor fixed; zooming does not scroll the page behind the popup._
- [ ] **The digest range picker becomes analog dials.** Replace the torch with FROM/TO
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
- [ ] **The Digest becomes a popup too, with honest labels.** `/digest/:id` renders over the
      current room with an expand-to-fullscreen control, same routing pattern. Every chapter
      is labelled **`S<n> · <title>`** — the number is the section ordinal the code already
      computes, and calling it a chapter is what produced "Chapter 5" for the real Chapter 1.
      ⚠️ `S<n>` is the **only** number that appears in any UI. If a surface still prints
      `spineIndex`, change it in this pass — two numbering schemes side by side is worse
      than the wrong one alone. Spoiler gating on titles (M19.5) is unchanged.
      _Acceptance: the same section shows the same `S` number in the digest, the scan axis,
      the range dials and the reader's chapter nav; no surface anywhere shows `spineIndex`._
- [ ] **The reader's digest button gets the treatment.** M19.7's icon button, with the
      **existing** `ProviderPickerPopover` mounted on it for the `digest` role on hover
      (the query-role picker is already mounted in the reader top row — this is a second
      mount of a built component, not a new picker).
      _Acceptance: the digest role can be changed from the reader and the change is
      immediately reflected in settings and on the scan; the popover is reachable by
      keyboard and does not assume hover exists._
- [ ] **Verify:** open the scan and the digest as popups from every room that can open
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

- [ ] **The job registry.** One server-side registry — id, kind, resource, status,
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
- [ ] **The tasks tray.** A dismissible progress popup per running job, and a persistent
      tray button (browser-downloads-style) listing running and recently finished work with
      per-job cancel.
      ⚠️ **Dismissing a popup must never cancel the job.** They are different verbs, and
      conflating them is how someone loses a forty-chapter digest.
      _Acceptance: dismiss the popup, navigate to another room, and the tray still shows
      the job advancing; cancel from the tray and it stops; a job that finishes while the
      tray is closed is visible in it afterwards._
- [ ] **Every long operation goes through it.** Chapter digest (reader), range digest
      (scan), thematic re-run, theme tagging. No surface keeps a bespoke blocking spinner.
      _Acceptance: each of the four can be started, watched, and cancelled from the tray;
      starting one from the reader and cancelling it from the scan works._
- [ ] **Verify:** run two jobs at once on a real book, cancel one, let the other finish,
      reload the page mid-run, and confirm the tray tells the truth throughout.

### M20.7 — The desk and the opening

- [ ] **A desk you'd want to work at.** Wood grain on the surface, a paper-textured
      notepad, and a desk that is **taller** — `DeskCanvas.module.css` pins
      `min-height: 640px`, which is why it sprawls sideways and never goes down the page.
      Size it to the viewport with room to scroll.
      _Acceptance: on a tall window the desk fills the height; existing per-book shelf
      coordinates still place books where the operator left them (they are stored in px —
      confirm nothing re-lays-out on first load); the grain is a texture, not an image
      request that blocks first paint._
- [ ] **The opening.** DESIGN.md's signature transition, finally built: the clicked book's
      title/cover moves to centre, the book opens, and the view zooms into the reader with
      the page filling the pane.
      ⚠️ Under reduced motion this is a plain crossfade, and it must be **interruptible** —
      Escape backs out at any point (DESIGN.md's motion rules). Nothing may block input for
      more than ~400ms.
      _Acceptance: opening a book from the desk lands on the saved position with no flash of
      an unstyled or wrong page; interrupting mid-animation leaves the app in a coherent
      state, never half-transitioned._
- [ ] **Per-room cursors, including the reader's.** DESIGN.md already specifies the cursor
      system and the `cursorStyle` setting already exists — this builds it: hand/grab on the
      desk, a fine nib or pen in the reader, reticle in the scan, selectable in settings with
      a "system" opt-out.
      ⚠️ The reader's cursor is written onto the epub.js iframe's own body (the one thing we
      are allowed to touch in there) and must not fight the existing turn-zone `w-resize`/
      `e-resize` cursors — decide the precedence and write it down.
      _Acceptance: the cursor changes at every room boundary and reverts on "system"; the
      turn zones still show their directional cursor; nothing leaks a cursor into a
      neighbouring surface after the pointer leaves._
- [ ] **Verify:** open three different books from the desk, drag them around, write in the
      notepad, and go desk → reader → scan → desk in one pass. Both themes, reduced motion.

### M21 — Audio I: one voice, end to end

**Read `docs/marginalia/AUDIO.md` before starting — it is binding for M21 and M22**,
the way SPEC.md is for the core. The vertical-slice rule applies: a book you can listen
to in one voice, with the page following along, before any casting exists.

- [ ] **The `TTSEngine` seam + Kokoro implementation.** `server/src/audio/engine.ts`
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
- [ ] **Sentence segmentation.** `server/src/audio/segment.ts` per AUDIO.md: operates on
      `resource_text` per spine index and returns char offsets **into that exact
      string** (the same coordinate system `annotations/position.ts` already uses).
      `Intl.Segmenter` with the book-specific fixes — abbreviations, initials, and
      ellipses must not split; short sentences merge; over-long ones split at a clause.
      _Acceptance: unit tests per AUDIO.md's list, including the offset round-trip
      (`text.slice(charStart, charEnd) === segment.text`) on real fixture chapters._
- [ ] **Render pipeline + cache.** Section renderer writing
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
- [ ] **Player + follow-along in the reader.** Sequential segment playback in the
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
- [ ] **Verify:** listen to 15 minutes of a real fixture book in one voice while doing
      normal reading things — pause, highlight, ask, turn back a page, resume. Note
      friction in NOTES.md. Both themes, reduced motion, and focus mode.

### M22 — Audio II: the cast

- [ ] **Cast scan (pass 1).** User-initiated `POST /api/resources/:id/cast/scan` (SSE)
      running AUDIO.md's `CastSchema` extract through the **existing** LLM seam and
      context builder — no new provider code — then persisting the cast (`book_cast`
      migration). Deterministic code-side voice assignment from `engine.voices()`:
      narrator first, then by line-count hint and appearance order, matching gender/age,
      never reusing a voice while an unused compatible one remains.
      _Acceptance: a scan of a real fixture book produces a sane cast with distinct
      voices; re-running it is stable (same input → same assignment); a provider failure
      mid-scan leaves no half-written cast._
- [ ] **Attribution (pass 2) + multi-voice rendering.** Per-section `AttributionSchema`
      extract, on demand and cached with the section's audio. **The model returns the
      quoted string; code locates it** by exact search — never offsets from the model
      (CLAUDE.md settled decision 2). Unlocatable quote, unknown speaker, or a failed
      call all degrade to the narrator voice, and a whole failed section degrades to
      single-voice without blocking playback.
      _Acceptance: dialogue in a chapter of Metamorphosis is spoken in character with
      the narrator carrying everything else; killing the provider mid-attribution keeps
      audio playing in one voice; unit tests cover verbatim match, repeated identical
      quotes resolving in order, and the unlocatable case._
- [ ] **Casting UI.** Cast list with per-character voice pickers (preview button speaks
      a sample line), narrator voice, and the single/multi voice-mode toggle. A user
      override sets `voice_locked` and **must survive a re-scan**; changing any
      assignment invalidates the rendered audio by changing `castHash`, which must not
      require deleting anything by hand.
      _Acceptance: override a voice, hear the change on the next chapter, re-scan, and
      confirm the override held; switching multi→single→multi doesn't re-render audio
      that's already cached under the same hash._
- [ ] **The desk tool.** The tactile listening-mode object per DESIGN.md and AUDIO.md: a
      real focusable button with an accessible name and pressed state (not a div), lit
      while engaged, so opening any book opens it in audio mode. Escape or a second click
      disengages. The list view's "Listen" action from M17 remains the canonical keyboard
      path — the tool is the charm, not the gate.
      _Acceptance: engage the tool, click a book, it opens listening; the engaged state
      is unmistakable; the whole flow is also completable from the keyboard without ever
      touching the tool; reduced motion removes its animation, not its function._
- [ ] **Verify:** scan the cast on a dialogue-heavy fixture, listen to a chapter in
      multi-voice, override a voice, and listen again. Confirm every M17 behaviour
      (tint, auto-turn, pause-on-interaction, position) is unchanged in multi-voice mode.

### M23 — Web search

Scoped out of M17 deliberately (decisions.md 2026-07-28 later): it needs its own seam,
not a flag, and it is a **second cloud dependency** — which amends CLAUDE.md's
"local-first: no cloud dependencies except the LLM endpoint itself". Permitted,
per-provider, **off by default, never silently on**.

- [ ] **The seam.** One narrow `WebSearch` interface (`search(query) → results`,
      `fetch(url) → text`), with implementations chosen by provider capability: the
      Anthropic API's server-side web tool; the Agent SDK's built-in WebSearch (which
      means relaxing `tools: []` on that path — a deliberate, documented exception, still
      read-only, still no file access); and a direct implementation (Brave/Tavily API key,
      or a local SearXNG instance) for endpoints with nothing of their own, so local
      models are not permanently excluded.
      _Acceptance: the same question with web enabled works on all three provider paths;
      disabling it removes the capability entirely, not just the UI._
- [ ] **Wire the M17 toggle.** The inert web control in the thread composer becomes live,
      per-thread, off by default and never remembered as on across books.
      _Acceptance: enabling it visibly changes the answer and the ledger's token count;
      results are cited in the answer with their source URLs._
- [ ] **Cost and trust.** Web results are context: they go through the ledger like
      everything else, and cited sources are shown so an answer's grounding is inspectable.
      _Acceptance: a web-enabled answer records its extra tokens; every claim drawn from
      the web is attributable to a listed source._
- [ ] **Verify:** ask a question needing outside knowledge on each provider path, with
      web off and on; confirm off costs nothing extra and on is fully attributed.

## Parked (post-v1.5) — recorded so they aren't relitigated

- LLM note supplementation: a pass that reviews highlight notes/tags, responds
  inline with supplementary detail, and proposes concept tags (persisted in SQLite)
  to power concept-level search across the library. "LLM proposes, code disposes."
  (decisions.md 2026-07-19)
- Vault-concept filtering on the scan (depends on the above).
- Notepad v2 "drift" brainstorm surface; sound design; PDF/Markdown formats.
  _(The `claudeAgent` subscription provider was parked here on 2026-07-17 but was
  un-parked and shipped on 2026-07-19 — see that decisions.md entry and
  `server/src/llm/claudeAgent.ts`. No longer parked.)_

## Future arcs (v2+) — shape decided, not scheduled

Recorded 2026-07-27 so the shape is settled before anyone starts and the real gate on
each is visible. Full reasoning: decisions.md 2026-07-27, "Future arcs". **These are
not milestones — do not start them from this list.**

- **Drawing on pages.** Strokes anchor to a **spine section in that section's own flow
  coordinates**, never to a page — pages aren't durable (font size, window width, the
  M14 margin setting, and spread mode all repaginate), so a page-anchored stroke is
  guaranteed to rot. Stored per section as simplified, quantized, gzipped SVG path data,
  one row per section that has drawings, fetched on section load exactly as highlights
  already are — so drawing on one page cannot grow the rest of the book's metadata.
  Explicitly **rejected**: rendering pages as images to draw on, which would destroy
  selection, highlighting, search, and reflow. Split into two independent projects:
  pointer-drawing on the desktop is buildable today; the iPad/Pencil version starts by
  undoing M6's deliberate loopback-only binding (LAN exposure + pairing/auth, probably a
  native shell) and PRODUCT.md lists multi-device as out of scope — that decision has to
  be taken on purpose, first.
- **Notebook chat.** Must be framed as "**the notepad is the prompt**" — a chat scoped
  to the notepad's contents (plus, optionally, the book behind it), anchored to
  something the reader wrote. A free-floating chat box contradicts a standing discipline
  ("the highlight is the prompt") and would need that rule overturned deliberately in
  CLAUDE.md, not by drift.
- **The spotlight as a literal torch** (decisions.md 2026-07-29). A cartoon flashlight
  beam on the scan, aimed by click-drag along the timeline and widened/narrowed by
  up/down — iOS-18-flashlight-style, drawn for the VHS/CRT aesthetic. However it looks,
  it is still a *range picker* and must resolve to whole chapters (M17's storage unit),
  with the numeric readout remaining the canonical keyboard path. Trap: a torch drawn
  inside M18's warped base layer must be positioned through the **same barrel mapping**
  as the heat bands, or the beam points somewhere other than where it lands.
- **A scrolling manuscript mode** (decisions.md 2026-07-29). ⚠️ Reopens a settled
  decision — PRODUCT.md records that pagination won in M2. The cost is not the
  scrolling: **every reader effect since M10 assumes pages** (snapshot turns,
  drag-to-peel, the M20 fold, turn zones, spread, the margin-vs-gutter model), so this
  is a *second reading mode with its own affordances*, not a toggle. Highlights and
  anchoring carry over (they are CFI/text-based); little else does. Decide between
  epub.js's per-section `scrolled-doc` and a genuinely continuous manager **before**
  building — they are different products.
- **A speed reader (RSVP)**, framed as accessibility (decisions.md 2026-07-29). Must
  reuse M21's sentence/word segmenter rather than growing a second chunker, and must save
  position through the existing reading-position path so reading, listening, and
  speed-reading never lose each other's place. Comes with requirements, not just a WPM
  slider: instant pause-to-annotate, rewind by sentence, wide speed range, and a
  lower-intensity alternative in the same feature (moving line-guide or bionic-style
  emphasis) since RSVP helps some readers and harms others. "Lines per minute" is a
  teleprompter and depends on the scrolling mode above.
- **The evidence board.** Corkboard, pins, physics ropes, tabs. Two rulings: it is an
  **extension of the Desk, not a fourth room** (it hangs on the wall above the desk,
  keeping "three rooms, one building" intact), and it is a **view over data that already
  exists** — nodes are concepts from the vault compiler, highlights, books, and notepad
  fragments; edges are the concept links code already computes at distill time. A board
  with no data behind it would encode nothing, which DESIGN.md's anti-goals rule out.
  Rope physics is verlet integration on canvas 2D — no engine, no WebGL, following the
  page fold's precedent.
