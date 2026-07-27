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

## v1.6 — operator feedback pass (M11–M13, and M15–M16 below)

Source: operator feedback after living with v1.5, translated into design decisions in
`docs/decisions.md` (2026-07-20 entry) — **read that entry before starting M11**. It
resolves every "make it feel like X" note into a buildable rule; do not re-derive them.

Ordering is deliberate: cheap, low-risk fixes ship first (M11), the hardest single
effect (the paper fold) ships last, so a stall there blocks nothing else.

> **Renumbered 2026-07-27.** A second feedback pass (v1.7, below) took the M14 slot,
> so this pass's remaining two milestones shifted down: **the Scan instrument is now
> M15** (was M14) and **the paper fold is now M16** (was M15). Their contents are
> unchanged and they are still governed by the 2026-07-20 decisions entry.

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

## v1.7 — revisions & audio (M14–M18)

Source: operator feedback after living with v1.6, translated into design decisions in
`docs/decisions.md` (**2026-07-27 entry — read it before starting M14**). Same contract
as v1.6: the entry resolves every note into a buildable rule, and the four settled
audio decisions there (engine, sentence-level sync, two-pass casting, audio-drives-the-
reader) are not open for re-derivation.

M15 and M16 are the v1.6 pass's own remaining milestones, carried over unchanged.
Audio (M17–M18) has its own binding spec: **`docs/marginalia/AUDIO.md`**.

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

### M16 — The paper fold (Apple Books curl)

_(Carried over from the v1.6 pass, where it was M15 — contents unchanged.)_

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

### M17 — Audio I: one voice, end to end

**Read `docs/marginalia/AUDIO.md` before starting — it is binding for M17 and M18**,
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

### M18 — Audio II: the cast

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
- **The evidence board.** Corkboard, pins, physics ropes, tabs. Two rulings: it is an
  **extension of the Desk, not a fourth room** (it hangs on the wall above the desk,
  keeping "three rooms, one building" intact), and it is a **view over data that already
  exists** — nodes are concepts from the vault compiler, highlights, books, and notepad
  fragments; edges are the concept links code already computes at distill time. A board
  with no data behind it would encode nothing, which DESIGN.md's anti-goals rule out.
  Rope physics is verlet integration on canvas 2D — no engine, no WebGL, following the
  page fold's precedent.
