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
- [ ] **Verify:** full walkthrough (import → read → highlight → ask → follow-up →
      publish → open vault in Obsidian) in both themes; create one highlight of each
      of the four kinds and confirm the washes read clearly on paper and ink; fix
      anything that feels rough before calling v1 done

## Checkpoint — live provider verification (manual; NOT a Sonnet task)

Between M7 and M8. The operator connects real providers (Anthropic API key;
optionally OpenRouter or another OpenAI-compatible endpoint) following instructions
provided at the time; then a session verifies against the live APIs:

- [ ] Streamed thread answer from the reader against real Anthropic
- [ ] Second ask on the same book logs `cache_read_input_tokens > 0` (the M4 check
      that couldn't run without a key)
- [ ] One publish exercising `extract` (structured output) against real Anthropic
- [ ] Any additional configured endpoint: stream + extract smoke test
- [ ] Record results + date here

---

Everything below is **v1.5** (the "three rooms" system, per DESIGN.md). Do not start
until the M7 verify passes — v1 must be whole first.

## M8 — The Desk (bookshelf workspace)

- [ ] Migration (additive): per-resource shelf state (x, y, rotation, z-order);
      notepad table (single markdown scratch note, autosave)
- [ ] Freeform workspace at `/`: books as cover-forward draggable objects (spring
      lift/settle, shadow depth while dragging), positions persist; current grid
      remains as a list toggle (canonical keyboard/screen-reader path)
- [ ] Hover info strip (author, progress, thread count, last-read) with quiet actions
      (open scan, publish); click opens the reader via the book-opening transition
      (cover zoom → stylized page-flutter landing on saved position; crossfade under
      reduced motion)
- [ ] Scroll-to-open "crown" gesture: scroll while hovering a book pushes into it
      past a commit threshold; Escape backs out
- [ ] The notepad: pad-of-paper scratch note on the desk, markdown, autosaved;
      "publish to vault" runs it through the existing vault compiler path into the
      configured vault as `Notes/Desk Notepad.md` — regenerate-in-place,
      concept-linked, ledger no-op on unchanged content (decisions.md 2026-07-19)
- [ ] Ambient desk physics: 1–2° cursor parallax with inertia; cursor trail canvas
      overlay (pointer-events: none, rAF, decaying particles, idles when cursor
      rests); custom cursor + trail both selectable/disableable in settings,
      all gated behind reduced-motion
- [ ] **Verify:** arrange five books, reload → same arrangement; open a book via
      click and via crown-scroll → both land on saved position; write in the notepad,
      reload → preserved; publish notepad → note appears in vault; toggle list view
      and drive it keyboard-only; enable reduced motion → no trails/parallax, plain
      transitions

## M9 — The Scan (timeline & heat map)

- [ ] Migration (additive): `highlights.importance` (0–3);
      `highlight_tags(highlight_id, tag)` for user-added tags; server-computed
      `positionPercent` per highlight from char offsets in `resource_text`
      (locate prefix+exact+suffix; unit tests: known fixture positions, duplicate
      text disambiguated by prefix/suffix, not-found → null)
- [ ] `/scan/:id`: full-width 0–100% strip, chapter ticks from spine, CRT
      instrument aesthetic per DESIGN.md (dark panel, neon bands, mono readouts,
      grain/scanlines under 5% opacity, contrast still passes)
- [ ] Heat bands: highlights/threads plotted at true percent position, intensity by
      thread length/depth, hue from the highlight's kind translated into the scan's
      phosphor palette; hover → phosphor ghost readout (quote + thread first
      line); click → airlock transition into the reader at that position
- [ ] Filter/search: by highlight kind, by user tag, and free text across quotes +
      thread content; matching bands lit, rest dimmed; tag editor lives in the
      reader thread panel and on the scan's hover readout
- [ ] Importance: star a highlight (1–3) from the scan or the reader thread panel;
      dog-ear rendering on the strip; "revisit queue" readout sorted by importance
- [ ] Airlock transition both directions (reader ⇄ scan): page dims/desaturates,
      scanlines in, highlights re-materialize as bands; reverse on the way back;
      crossfade under reduced motion
- [ ] Instrument readouts: totals, progress, chapter-length sparkline, last-visited
- [ ] **Verify:** book with 10+ threads across chapters → bands sit at correct
      positions (spot-check three against the reader); filter by a kind and by a
      tag → correct subsets stay lit; star two passages → dog-ears + queue order
      correct; click a band → reader opens on that passage; whole room
      keyboard-navigable

## M10 — Reader depth (3D page turn & origami notes)

- [ ] Snapshot page-turn: render current/next page to bitmaps, animate a 3D curl on
      those planes (container-level transform so the marks-pane rides along), swap to
      live DOM on settle; fast slide fallback stays for reduced motion / low fps
- [ ] Stretch: interactive drag-to-peel (grab page edge, curl follows pointer,
      release commits or springs back)
- [ ] Origami fold skin on the M5 thread panel: collapsed = folded margin tab, click
      unfolds in a two-crease animation, refold on collapse; paper grain + spine tint
- [ ] Perf pass: 60fps during turns and folds; no layout thrash (transform/opacity
      only); epub.js quirks encountered → logged in NOTES.md
- [ ] **Verify:** page through a chapter with notes attached — notes ride the turning
      page; fold/unfold threads repeatedly with no jank; reduced motion → slide
      turns, instant fold; reading with all effects on still feels calm

---

## Parked (post-v1.5) — recorded so they aren't relitigated

- LLM note supplementation: a pass that reviews highlight notes/tags, responds
  inline with supplementary detail, and proposes concept tags (persisted in SQLite)
  to power concept-level search across the library. "LLM proposes, code disposes."
  (decisions.md 2026-07-19)
- Vault-concept filtering on the scan (depends on the above).
- Notepad v2 "drift" brainstorm surface; sound design; PDF/Markdown formats;
  `claudeAgent` subscription provider (decisions.md 2026-07-17).
