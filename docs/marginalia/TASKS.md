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

- [ ] `LLMProvider` interface + `LLMError` + provider registry reading settings
      (`llm/provider.ts`) — exactly per SPEC seam
- [ ] Anthropic implementation per SPEC (streaming, 2-block system with
      `cache_control` on book context, `messages.parse` + `zodOutputFormat` for
      extract, typed error mapping, refusal handling, debug log of cache reads)
- [ ] OpenAI-compatible implementation per SPEC (SSE parsing, extract with safeParse +
      one retry)
- [ ] Context builder (`llm/context.ts`): whole-book vs window logic, deterministic
      rendering + unit tests (determinism, budget respected, window centers on
      highlight)
- [ ] Settings API + settings page: provider picker, model, base URL, API keys
      (masked), vault path, context tokens; "Test connection" button that runs a
      1-token stream
- [ ] Dev CLI: `pnpm --filter server ask <resourceId> "<question>"` streams an answer
      to stdout (verifies the layer without UI)
- [ ] Unit tests: openaiCompat SSE parsing (mocked), context builder; manual: CLI ask
      against both a real Anthropic key and one OpenAI-compatible endpoint if available
- [ ] **Verify:** CLI ask on a fixture book returns a grounded streamed answer; second
      ask on same book logs `cache_read_input_tokens > 0` (Anthropic)

## M5 — Inline threads (the core interaction)

- [ ] `POST /api/threads` + `POST /api/threads/:id/messages` SSE endpoints per SPEC
      (persist on completion, abort on disconnect, error event contract)
- [ ] Thread panel UI: opens from the Ask pill, visually anchored to the highlight,
      question textarea, streamed markdown answer, follow-up input, collapse to margin
      marker
- [ ] Margin rail shows thread state (has-answer vs unanswered); reopening a book
      restores all threads collapsed; clicking a highlight or rail dot expands its
      thread
- [ ] Unconfigured-provider nudge state ("configure a provider" → link to settings)
- [ ] Streaming UX polish: token-by-token render without scroll jank, stop button
      (aborts SSE), error state with retry
- [ ] **Verify (the product moment):** read a chapter, highlight a passage, ask a real
      question, watch the answer stream inline; ask a follow-up; collapse it; flip
      pages; come back → thread is there. Do this for 15 minutes with a real book and
      note friction in docs/marginalia/NOTES.md

## M6 — Vault compiler

- [ ] Distill extraction call + schema (`vault/compiler.ts`) per SPEC
- [ ] Concept matching in code (`vault/concepts.ts`): slug/alias/Levenshtein rules +
      unit tests (match, no-match, alias hit)
- [ ] Note writers: reading note, concept note create/append-mention, `_Book.md`
      overview; `writeVaultFile` path-safety helper + unit test (rejects `../`)
- [ ] Idempotency: `publishes` ledger, unchanged-hash no-op, changed-hash rewrite,
      never touch untracked files
- [ ] `POST /api/resources/:id/publish` + UI: publish button on library card + in
      reader, result toast ("4 notes, 2 new concepts, 3 linked")
- [ ] **Verify:** against a scratch vault: publish a book with 3+ threads → folders/
      notes/concepts appear and open correctly in Obsidian; publish again → no changes;
      threads from a second book sharing a concept link to the SAME concept note

## M7 — Beauty & revisit pass

- [ ] Motion pass: panel open/close, pill appearance, page-turn feel (150–200ms
      ease-out, no jank)
- [ ] Library polish: covers extracted from EPUBs, annotated-book indicator (thread
      count), recently-read ordering
- [ ] Reader revisit affordances: "annotations" overview (list of all threads in book,
      jump-to), unanchored-highlight surfacing
- [ ] Dark mode audit across every view; focus-visible states; reduced-motion respect
- [ ] Error/edge audit: huge EPUB, EPUB with no metadata, provider down mid-stream,
      vault path unset → all degrade gracefully with designed states
- [ ] **Verify:** full walkthrough (import → read → highlight → ask → follow-up →
      publish → open vault in Obsidian) in both themes; fix anything that feels rough
      before calling v1 done
