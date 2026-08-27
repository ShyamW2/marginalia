# Marginalia — Notes

Running log of spec gaps, friction, and blockers found during implementation.
Append; don't rewrite history.

## Spec gaps

- **2026-07-30 (M19.7), found while verifying the generalized `Slider`, pre-existing
  not introduced by it:** the reader's `%` control previews and commits in two
  different percent spaces. The drag/keyboard preview is computed by adding a
  pixel/step delta onto `progressPercent` — which, since M19.6 round 4, is the
  *click-accurate book-page* percent (`bookPageMap`, `Math.round(page/total*100)`).
  The commit path (`commitScrub` → `book.locations.cfiFromPercentage()`) resolves
  that same number as a *character-location* percent instead — a different metric
  entirely. Live-verified: dragging/arrow-stepping to a previewed "30%" can commit
  to a position whose own click-accurate percent reads back as "37%" once settled.
  Directionally correct (higher previewed % always lands further into the book),
  just not numerically exact. Pre-dates this session — `commitScrub` itself was
  moved into `Slider`'s `onCommit` unchanged, not touched — and out of scope for
  M19.7's own task (generalizing the *gesture*, not reconciling the two percent
  systems `book_pages` vs `book.locations` this app already deliberately runs side
  by side for different purposes). Fixing it properly means resolving the commit
  through the click-accurate system instead of `cfiFromPercentage`, which is real,
  separate scope. Worth a task of its own if the operator notices the drag landing
  "in the wrong place."
- **2026-07-19 (M8):** DESIGN.md's desk hover strip lists "progress" among
  the fields it shows. Real reading-progress percent only exists client-side
  (epub.js's `book.locations.generate()`, computed against a CFI) — and the
  whole point of the desk/reader split is that epub.js never loads outside
  the reader (DESIGN.md "Technical foundations": "epub.js loads only in the
  reader"). Showing "progress" on the desk would mean either loading
  epub.js for every book on the shelf (defeats the code-split) or adding a
  server-side percent (which M9 does, but only for *highlight* positions,
  not overall reading position — there's no reading-position-to-percent
  story at all yet). Boring choice: the hover strip shows a relative
  "read Nd ago" from `reading_state.updated_at` instead of a percent.
  Revisit if/when reading position itself grows a stored percent.
- **2026-07-19 (M8):** DESIGN.md's cursor system calls for "custom cursors
  per room" (e.g. "a hand/grab on the desk"). Built as CSS `cursor:
  grab`/`grabbing` (the browser's built-in affordance cursors), not bespoke
  cursor artwork — DESIGN.md doesn't specify actual imagery, and drawing/
  licensing custom cursor assets is real scope beyond "boring core,
  expressive surface" for M8. The `cursorStyle` setting still does its job
  (grab/grabbing vs. plain `pointer`); swap in real art later without
  touching the setting's shape.
- **2026-07-11 (M0):** SPEC calls for Node 22+, but the dev machine has Node
  20.19.4 (homebrew `node@20`), and `corepack prepare pnpm@latest` fails on it
  (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` — pnpm 11 requires a newer Node).
  Pinned `pnpm@9` via `corepack prepare pnpm@9 --activate`, which works fine
  on Node 20. Nothing in the stack (Express 5, better-sqlite3, Vite, React 18)
  needs Node 22-specific features. `package.json` engines field set to
  `>=20` instead of `>=22`. Revisit if the runtime machine gets Node 22+.
- **2026-07-11 (M0):** `tsconfig.base.json` originally also set
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (stricter than
  SPEC's plain "strict mode" requirement). This broke on Vite's CSS Modules
  typing (`styles.brand` becomes `string | undefined` under
  `noUncheckedIndexedAccess` because `vite/client`'s `CSSModuleClasses` type
  is an index signature) — every CSS-module class reference in the web
  package would need `!` or a guard. Removed both flags, kept `strict: true`.

- **2026-07-29 (M18):** decisions.md's "everything on the base scan screen
  warps together" enumerates strip/heat-field/chapter-axis/readouts/
  revisit-queue but doesn't say whether the page header (title, "← Book",
  "Digest…", "Read digest") is inside or outside that surface. Boring
  choice: outside — it's chrome/escape-hatches, not the instrument glass,
  and the warp's hit-test-under-filter hazard (this milestone's own ⚠️) is
  worse to risk on primary navigation than on precisely-positioned heat
  bands, which already need — and get — explicit compensation regardless.
  Revisit if the header visually reads as a seam once M18 ships.

## Friction

- **2026-07-16 (M2):** epub.js's `ePub(url)` sniffs input type from the URL's
  file extension; our file route (`/api/resources/:id/file`) has none, so it
  defaulted to treating the URL as an unpacked directory of book files
  (fetching `META-INF/container.xml` etc. as separate relative requests →
  404s) instead of a single archive to fetch-and-unzip. Fixed by passing
  `{ openAs: "epub" }` in the `ePub()` options.
- **2026-07-16 (M2):** epub.js's paginated flow renders each section into one
  wide multi-column iframe and reveals the current page via the *container's*
  scroll offset — the iframe itself is far wider than the visible viewport
  and is positioned off to the side. A forwarded content `click` event's
  `clientX`/`contents.window.innerWidth` are relative to that whole wide
  canvas, not the visible page, so naive click-zone math (`clientX < width *
  0.3`) silently never triggers. Fixed by translating through the iframe
  element's own `getBoundingClientRect()` (via `contents.document.defaultView
  .frameElement`) relative to our container's rect. Verified concretely with
  a headless-browser click at a known screen position and confirming the
  saved CFI position actually advanced/retreated — don't trust a fix here
  without checking the real epub.js DOM structure (`.epub-container` >
  `.epub-view` > `iframe`).
- **2026-07-16 (M2):** the Standard Ebooks/Gutenberg-derived Alice fixture has
  an unclosed `<a id="chap01">` bookmark anchor (no `href`) at the top of each
  chapter; lenient HTML parsing makes it swallow the entire chapter body as
  its descendant. A naive "don't turn pages when the click target is inside
  an `<a>`" guard (meant to let real hyperlinks work) matched on every single
  click in the whole book. Fixed by checking `closest("a[href]")` instead of
  `closest("a")` — only navigable links should suppress the page-turn.
- **2026-07-17 (M3):** epub.js's paginated flow shows only ~1 "logical page"
  of a chapter-length spine section at a time, but the *whole section* is one
  DOM document — `document.querySelector`/`TreeWalker` can happily find and
  select text that exists in the DOM but is scrolled off the currently
  visible page. A scripted test selection that didn't check the resulting
  Range's `getBoundingClientRect()` against the viewport produced a
  wildly-offscreen Ask pill position that looked like a coordinate-math bug
  but wasn't — real users can only ever drag-select visible pixels, so this
  can't happen via genuine interaction. Worth remembering when testing
  anything selection-related against epub.js: always verify the selected
  Range is actually within the visible viewport first.
- **2026-07-17 (M3):** epub.js renders highlight/annotation marks via a
  separate SVG "marks-pane" overlay positioned over the iframe *in the parent
  document*, not as elements inside the iframe's own DOM — querying for
  `.marginalia-highlight` (or any annotation class) has to search the
  top-level page, not the iframe's document.
- **2026-07-17 (M3):** the margin rail's hover-revealed delete button
  (`opacity: 0` by default) still intercepted clicks meant for the dot
  underneath it, because `opacity` doesn't affect hit-testing — needed
  `pointer-events: none` until hovered. Separately, since hovering the dot to
  click it *also* triggers the wrapper's `:hover`, an overlapping delete
  button (`inset: -0.5rem`) would reveal itself and eat that same click. Fixed
  by moving the delete button to sit beside the dot instead of on top of it.

- **2026-07-17 (M4):** `@anthropic-ai/sdk`'s `zodOutputFormat()` helper (used
  by `messages.parse` for structured extraction) requires a **zod/v4**
  schema instance (`import { z } from "zod/v4"`), not the classic
  `import { z } from "zod"` (v3-shaped `ZodType<Output, Def, Input>`) used
  everywhere else in this codebase for the HTTP boundary schemas in
  `shared/`. The installed `zod` (3.25.76) actually ships both — `.`
  resolves to the classic v3 API, `./v4` to the new one — so this compiles
  as two structurally different `ZodType` types, not just a version bump.
  `LLMProvider.extract()`'s `schema` param is typed against `zod/v4`
  specifically (see the comment in `llm/provider.ts`); **M6's vault-compiler
  concept-extraction schema must be built with `zod/v4`**, not the classic
  import other shared schemas use. `OpenAICompatProvider.extract()` is
  unaffected — it only calls `.safeParse()`, which exists on both zod
  versions' `ZodType` with the same shape.

- **2026-07-17 (M5):** `req.on("close")` is **useless** for detecting a
  client disconnect on a long-lived SSE response in Express/Node — it fires
  as soon as the *request* body has finished being read (i.e. right after
  `express.json()` parses it), not when the client actually goes away. In
  `routes/threads.ts` this meant the abort `AbortController` fired almost
  immediately after `res.flushHeaders()`, aborting the provider's `fetch()`
  before it could ever return — every thread request hung forever with zero
  bytes streamed, no error logged anywhere (the abort happened, but nothing
  after it ran because the client's connection was never actually closed,
  so nothing observed the failure). Took a long debugging detour: identical
  code (same `OpenAICompatProvider`, same book-sized context, same
  `AbortController` wiring) worked instantly in a one-off script and in a
  scratch Express app, and only hung inside the *real* running dev server —
  the actual variable was `req.on("close")` vs `res.on("close")`, not
  anything about context size, keep-alive, or process state (all dead ends
  chased first). **Fix:** listen on `res.on("close")` instead (fires when
  the *response's* underlying connection ends) and guard with
  `if (res.writableEnded) return;` so our own clean `res.end()` doesn't look
  like a disconnect. Verified against a real streaming SSE call end-to-end
  (first question, a follow-up, `GET /api/threads/:id`, and the
  highlights-with-thread-summary listing) once fixed.
- **2026-07-17 (M5):** `ThreadPanel`'s history-load effect originally
  depended on `thread?.id`. Since the panel receives its `thread` prop from
  the parent's highlight list, and `onThreadChange` updates that same list
  the moment a *new* thread's first message finishes streaming, `thread?.id`
  flips from `undefined` to a real id purely as a side effect of our own
  `onDone` callback — re-triggering the effect and firing a redundant
  `GET /api/threads/:id` right after every first message (harmless — same
  content — but wasteful, and confusing to read a network log of). Fixed by
  capturing the thread prop once at mount (`useState(() => thread)`, never
  updated) and keying the history-load effect off that instead; `submit()`
  still reads the live `thread` prop reactively to target follow-ups at the
  right URL. Caught by watching the network log during browser verification,
  not by a test.
- **2026-07-17 (M4/M5):** Two `fetch("/api/settings")` call sites
  (`SettingsPage.tsx`, `ReaderView.tsx`) were missing a `.catch()`/try-catch
  around the initial mount fetch — surfaced as an actual unhandled promise
  rejection in the web vitest run (jsdom has no base URL for relative
  fetches), which would equally be an unhandled rejection in a real browser
  if the request ever failed (offline, server restarting). Both wrapped in
  try/catch now, matching the pattern `LibraryPage.tsx` already used.

## M7 — reading focus mode + a real epub.js mark-tracking bug — 2026-07-19 (Fable)

Implemented reading focus mode (TASKS.md M7): `f` toggles a `focusMode` state
that hides the Annotations button (replaced by a "Notes hidden — press F to
show" indicator), the margin rail, and repaints every highlight mark
transparent via `markStyleForKind(kind, vars, hidden)`; marks stay attached
(cheaper than tearing down/re-resolving) rather than being removed. A
window-level keydown handler ignores the key while focused in a
textarea/input/contentEditable so it doesn't fight the thread panel's typing.

**Found via live headless-browser verification, not a test:** two or more
highlights that resolve to the *identical* CFI (a real scenario — asking a
second question on the exact same selection, or two different original
selections whose anchors both re-resolve to the same spot) broke focus mode
only partially. Root cause is in epub.js itself, not our code:
`View.highlight()` (`managers/views/iframe.js`) keys its internal
`this.highlights` map by the raw CFI string but calls `pane.addMark()`
unconditionally on every invocation — it never checks whether a mark already
exists at that CFI. Calling `annotations.highlight()` twice at the same CFI
therefore creates two SVG marks in the DOM but the map only ever tracks the
most recent one; the earlier mark becomes permanently orphaned — invisible to
future `annotations.remove()`/`annotations.highlight()` calls, so it survives
theme re-tinting, focus-mode hiding, and (worse) surviving highlight
*deletion* — a deleted highlight's mark could stay on the page forever if it
shared a CFI with another highlight. This predates M7; it was latent in M3's
mark-attach code and M6's delete path, just never triggered by the fixture
data used in earlier verification passes until this session's Alice fixture
happened to have three highlights on the same "over" occurrence.

**Fix** (`ReaderView.tsx`): added `cfiOwnersRef` (`Map<cfi, highlightId[]>`,
insertion order = ownership order) and three helpers — `attachOwnedMark`
(only the first highlight to claim a CFI gets a real epub.js mark; later
co-owners are tracked but stay invisible), `isMarkOwner` (gates the
theme/focus re-tint loop so only the owner is touched), and `detachOwnedMark`
(deleting a non-owner is a no-op on the DOM; deleting the owner transfers the
mark — remove + re-attach with the next co-owner's id/kind — so the mark
never orphans and never points at a deleted highlight). All four mark
call-sites (initial section resolution, the theme/focus re-tint effect,
highlight creation, highlight deletion) now go through these helpers instead
of calling `rendition.annotations.*` directly.

**Verified live** (headless Chromium, real dev server, real sqlite, Alice
fixture — not mocked): before the fix, 3 highlights sharing one CFI produced
6 DOM marks-pane rects but only 4 responded to focus-mode toggling (2 stuck
visible forever). After the fix: 4 rects total (correctly deduped), all 4
correctly go transparent on `f` and back on a second `f`; the Annotations
button, "Notes hidden" indicator, and margin rail (8 dots — rail dots are
per-highlight DOM, not tied to epub.js marks, so duplicates still each get
their own dot) all toggle correctly. Separately verified the ownership-
transfer path by deleting the owning highlight through the real rail UI:
the DB correctly dropped the deleted row, the remaining co-owner's mark
stayed visible (still 4 rects, no orphan), and its `data-highlight-id`
correctly switched to the surviving highlight. Full suite 81/81
(`pnpm test`), `pnpm build` clean. Also fixed an unrelated pre-existing test
break found while running the suite: `shared/schemas.test.ts`'s smoke test
never got updated with `lastReadAt` when the M7 library-polish commit
(`f991ddb`) added that field to `ResourceSummarySchema`.

**Next task:** dark mode audit (M7, next unchecked box in TASKS.md).

## M7 — error/edge audit — 2026-07-19 (Fable)

Drove all four named edge cases live rather than reasoning about the code in
the abstract:

- **Huge EPUB:** a real 201MB file (`truncate -s 201M`, multer's
  `limits.fileSize` is 200MB) was correctly rejected, but only via the
  generic catch-all error handler — 500 status, raw `err.message`. Fixed:
  `index.ts`'s error handler now special-cases `multer.MulterError` with
  code `LIMIT_FILE_SIZE` into a structured `{error: "file_too_large"}` at
  413 (matching the app's structured-error-code convention used everywhere
  else — `vault_path_unset`, `unsupported_format`, etc. — rather than a raw
  message that happened to be readable by coincidence). `LibraryPage.tsx`
  maps it to "That file is over the 200MB import limit". Verified live via
  the real drag-drop/file-picker UI, not just curl: clean inline dismissible
  error, no hang, no crash.
- **EPUB with no metadata:** already handled — `epub.ts`'s `parseOpf` falls
  back title to `"Untitled"` and author to `null` (this predates M7);
  `LibraryPage.tsx`/`ReaderPage.tsx` already conditionally render the author
  line. Built a minimal hand-crafted EPUB with no `dc:title`/`dc:creator` at
  all and imported it through the real UI: library card shows a designed
  fallback cover (a soft-gradient placeholder with a big initial, "U"),
  "Untitled", no author line, "No highlights yet" — not a broken layout.
  Reader opens and renders the book text with no crash. No fix needed.
- **Provider down mid-stream:** the real risk of testing this against the
  system's actual local Ollama service (a persistent `ollama serve` daemon,
  not something this session started) is disrupting it for the user's other
  uses, so this used a tiny throwaway HTTP server instead — mimics an
  OpenAI-compatible stream, sends a few real SSE chunks, then destroys the
  socket mid-stream (no `[DONE]`, no clean close), standing in for "the
  provider process died" without touching Ollama. Pointed settings at it
  temporarily (restored immediately after), asked a real question through
  the actual reader UI: streamed "The White Rabbit" for a few chunks, then
  cleanly surfaced "Something went wrong talking to the LLM provider. Retry"
  with the composer restored — confirmed via the API afterward that the
  thread persisted **zero** messages despite the partial text having been
  shown on screen, matching the SPEC "persist on completion only" contract
  (`threads.ts`'s `streamThreadReply` only calls `persistExchange` after the
  `for await` loop completes without throwing). No fix needed — this was
  already correct, just never verified against a genuine mid-stream drop
  specifically (earlier M5/M6 verification only exercised "unreachable from
  the start" and "client-initiated Stop").
- **Vault path unset:** already handled — `routes/publish.ts` returns
  `{error: "vault_path_unset"}` at 400, `web/src/library/publish.ts` maps it
  to "Set a vault path in Settings first.", shown as a dismissible toast.
  Verified live by clicking Publish with the real (currently unset) vault
  path in this environment's settings. No fix needed.

Full suite 81/81, `pnpm build` clean after the one fix. Cleaned up all test
artifacts (deleted the throwaway highlight/thread created for the mid-stream
test, stopped the throwaway HTTP server) except the no-metadata "Untitled"
book, which was left in the library — there's no delete-resource route
(deliberate per the immutable-on-import decision), and it's harmless local
test data consistent with how the Alice/Metamorphosis fixtures were already
being reused as living verification data by prior sessions.

**Next task:** the M7 final Verify step (full walkthrough, both themes, all
four highlight kinds) — the last item before v1 is whole.

## M7 — final verify: found and fixed a real vault-path bug — 2026-07-19 (Fable)

Ran the full walkthrough live against real services, not a dry read of the
code: opened Metamorphosis (already in the library from M1), created one
highlight of each kind (rose/sage/honey via the pill's kind dots, slate via
Ask), asked a real question through the actual local Ollama endpoint,
watched it stream token-by-token, asked a follow-up, then published to a
scratch Obsidian vault.

**Found a real bug this way, not by reasoning about the code abstractly:**
the scratch vault's `_Book.md` linked to three reading notes
(`01 -`, `02 -`, `03 -`) that didn't exist anywhere in that vault — only the
fourth note (the one from *this* session) was actually on disk. Root cause:
Metamorphosis had 3 threads published during M6's live verification
(2026-07-17) into a *different* scratch vault that no longer exists on this
machine — but the `publishes` ledger (sqlite, permanent) has no `vault_path`
column, so `publishResource`'s idempotency check
(`server/src/vault/compiler.ts`) only ever asked "does a ledger row exist for
this thread?", never "does the file the row points at actually exist at
*this* vault path?". Any user who ever changes their vault path setting
(moves vaults, points at a fresh one) would hit this: publishing again
silently skips every previously-published thread (ledger row exists) while
`_Book.md` keeps linking to notes that live only in the old, now-irrelevant
vault. This isn't a hypothetical — it's exactly what happened via two
different session scratch directories in this environment, and would happen
identically to a real user's real vault move.

**Fix:** added `existsInVault(vaultPath, notePath)` and require *both* the
ledger row *and* the file's actual presence at the current `vaultPath`
before treating a thread as "up to date" (`compiler.ts`'s main loop); apply
the same filter before building `_Book.md`'s note list, so it can never link
to a file that isn't there. `recordPublish` was already an upsert
(`ON CONFLICT(thread_id) DO UPDATE`), so re-publishing the same thread into
a new vault needed no ledger-side change. Added a regression test
(`compiler.test.ts`, "re-publishes into a new vault path even though the
ledger already has a row") that publishes into one vault, then publishes the
same resource/ledger into a second, empty vault directory and asserts the
note actually gets (re-)written and `_Book.md` only lists notes present
there. Verified live too: re-ran publish against the real scratch vault
after the fix — all 3 missing notes reappeared, `_Book.md` now lists exactly
the 4 notes that exist, and every wikilink across every reading note
resolves to a real concept file (scripted check, not eyeballed).

**Verify checklist:**
- Full walkthrough (import → read → highlight → ask → follow-up → publish):
  done live against a real local Ollama endpoint, not mocked.
- Both themes: screenshotted the same four-highlight passage in Paper and
  Ink; all four kind washes (rose/sage/honey/slate) are visually
  distinguishable from each other and from the rail's matching dot colors
  in both.
- Open vault in Obsidian: Obsidian isn't installed in this environment (same
  substitute as M6) — every note verified to be well-formed markdown with
  valid frontmatter and fully-resolving wikilinks instead.
- 82/82 tests, `pnpm build` clean.
- Vault path setting reset back to empty afterward (was unset before this
  session; the scratch path used for testing won't exist once this session
  ends).

**v1 is whole.** All of M0–M7 is checked off in TASKS.md. The only remaining
item is the manual operator checkpoint (live provider verification against a
real Anthropic key) between M7 and M8, which is explicitly not a Sonnet/
implementation-session task per decisions.md 2026-07-19.

## M10 — reader depth (3D page turn & origami notes)

Built the snapshot-based page curl (`web/src/reader/pageSnapshot.ts`,
`PageCurl.tsx`), wired into `ReaderView.tsx`'s `turnPage` alongside the
existing M7 slide as an explicit fallback chain (reduced motion → slide;
snapshot capture fails → slide; sustained low frame rate → slide from then
on), the stretch drag-to-peel gesture on a thin edge-grab strip, and the
origami fold skin on `ThreadPanel` (two-crease unfold/refold keyframes,
paper grain, a folded-corner accent echoing the margin rail's now
dog-ear-shaped has-thread indicator).

**Two real, reproducible bugs found via live verification — not
hypothetical, both confirmed via a real headless Chromium session against
the real dev server, per CLAUDE.md's "verify by driving the app":**

1. **html2canvas hung forever capturing the page.** The default renderer
   clones the target subtree into a detached, hidden iframe to read computed
   styles reliably. epub.js's section iframe is deliberately sandboxed
   (`iframe.sandbox = "allow-same-origin"` only — no `allow-scripts`, since
   the reader passes `allowScriptedContent: false`); cloning that sandboxed,
   `srcdoc`-sourced iframe and waiting on the clone's load event never
   resolved. Nothing threw — a hang, not an error — so the existing
   `try/catch` around `capturePageSnapshot` did nothing, and because
   `turnLockRef` is only released after the (never-resolving) capture
   promise settles, this froze *every future page turn* after the first
   hang, not just the animation. Reproduced live: a verification script
   sat at 0% CPU for over 90 minutes on a single stuck turn before being
   killed. Fixed two ways, belt-and-suspenders: (a) switched to
   `foreignObjectRendering: true`, which serializes the *live* subtree into
   an SVG `<foreignObject>` and paints it through the browser's own
   rendering pipeline instead of cloning into a hidden iframe — this alone
   made the hang disappear in re-testing; (b) raced the capture against a
   700ms hard timeout regardless, since a best-effort visual flourish must
   never be able to freeze the one interaction (reading) CLAUDE.md says must
   never degrade. Re-verified live: mid-flight and settled curl-overlay
   counts are now correct (1 then 0) across both a button-click turn and a
   keyboard turn, with no hang.
2. **Drag-to-peel crashed the tab.** `handleEdgePointerDown` tracked the
   drag via `window.addEventListener("pointermove"/"pointerup", …)` without
   ever calling `setPointerCapture` on the edge-grab strip that received the
   `pointerdown`. The moment a real drag crossed from that 18px-wide strip
   into the epub.js iframe sitting right next to it — the entire point of a
   page-edge drag gesture — raw pointer events stopped being scoped to our
   handler and were delivered straight into the sandboxed iframe's own
   document instead. Reproduced identically on both `chromium-headless-shell`
   and full Chromium (ruling out a headless-shell-specific flake): console
   showed `Blocked script execution in 'about:srcdoc' because the document's
   frame is sandboxed and the 'allow-scripts' permission is not set`,
   immediately followed by the entire tab/context closing. Fixed with
   `event.currentTarget.setPointerCapture(event.pointerId)` at the start of
   the handler — the standard fix for exactly this class of bug (a drag
   gesture whose target lives next to, not inside, the element it needs
   move/up events to keep tracking across). Re-verified live, isolated, on
   full Chromium: the same drag sequence that crashed before now completes
   cleanly with no console error, and a mid-drag screenshot shows a real,
   convincing curl — the departing page peeling from the grabbed edge with
   the shade gradient visible, live content already present underneath.

**Verification method:** real `pnpm dev` (Vite + server) driven by
Playwright (ad hoc into the scratchpad, as in M8/M9 — not a project
dependency), headless Chromium, against the real Metamorphosis fixture (7
highlights, 4 threads, accumulated across earlier milestones):
- Button-click and keyboard-triggered page turns: curl `<img>` overlay
  present mid-flight, absent after settling, confirmed for both trigger
  paths, no console errors.
- Origami thread panel: opened via a has-thread margin-rail dot (now a
  folded dog-ear shape, not a ring — `MarginRail.module.css`), confirmed
  exactly one grain overlay and one crease overlay element render inside
  the open panel, closed via the collapse button with no error.
- Reduced motion (`reducedMotion: "reduce"` context): zero edge-grab strips
  rendered, zero curl `<img>` elements ever appear during a turn (confirms
  it takes the slide path, not just that the *result* looks similar) —
  plus `motion`'s own advisory console warning that it detected reduced
  motion, expected and benign.
- Drag-to-peel: isolated pass (its own browser context, wrapped in
  try/catch so a stretch-feature failure can't block signing off the
  required items above) — real pointer down/move/up sequence, mid-drag
  screenshot confirms a legible curl, completes without a console error or
  a crash after the pointer-capture fix.
- `pnpm test` 116/116, `pnpm build` clean, both before and after the two
  fixes above.

**Not deeply chased:** a `Failed to load resource: 404` console message
appeared once during the full verification pass but did not reproduce on a
fresh, isolated page load with response-status logging — html2canvas/
foreignObjectRendering makes no network requests of its own, and nothing
else in this milestone's diff touches `fetch`, so this reads as pre-existing
noise (unrelated to M10) rather than a regression; not worth further budget
chasing something unreproduced.

**Perf notes:** every curl/drag/fold animation is `transform`/`opacity`
only (rotateY, scaleY, rotateX, opacity — no width/height/top/left
animated), matching DESIGN.md's "no layout thrash" rule. `will-change` is
implicit rather than hand-toggled: `PageCurl`'s `.leaf`/`.shade` only exist
in the DOM while a turn is actually animating (mounted/unmounted with
`curl` state), and the grain/crease overlays only render while
`!reducedMotion`, so there's nothing to toggle on/off mid-session. The
low-fps→slide-fallback (`lowFpsRef`, sampled via the curl animation's own
`onUpdate` frame timestamps, tripping at a sustained ~30fps or worse) was
implemented per TASKS.md's "fast slide fallback... for reduced motion / low
fps" wording but not exercised live — this dev machine renders the curl at
full rate, and deliberately throttling headless Chromium's CPU to force a
slow-frame-rate run wasn't attempted given the time already spent chasing
the two real bugs above; the code path exists and is straightforward
(three-line average-frame-delta check), but "sustained low fps genuinely
falls back" is asserted from reading the code, not watched happening.

**Simplification, recorded rather than silently deviated from:** the
snapshot approach only rasterizes the *departing* page. The incoming page's
DOM is swapped in live, hidden behind the departing page's bitmap, and
revealed as that bitmap fades/rotates away — TASKS.md's "swap to live DOM
on settle" falls out of this for free, without ever needing a bitmap of the
page being turned *to*. This is the boring version DESIGN.md's own
technical note anticipates (a real book reader doesn't show you the next
page's content until you've turned far enough to see it either), not a
missing feature.

## M22.5 G + H (what is rendered; which model actually answered) — 2026-08-05

**Part G.** `render.ts` gained `getResourceAudioSections`/`getSectionAudioSizeBytes` (file
`stat`, never a stored byte count — same cache-is-existence rule as `isSectionCached`) and
`deleteSectionAudioCache`. The new `GET .../audio/sections` route reuses a hoisted
`currentCastHash` helper that used to be hand-duplicated across `buildAudioState` and
`resolveSectionContext`. The delete route cancels any in-flight render job for that exact
resource/cast/section key before deleting files (`inFlightRenders` + `cancelJob`, both already
in `routes/audio.ts`); `usePlayer.ts`'s job-subscription handler now treats a `cancelled`
render (as opposed to `failed`) as a clean return to `idle` rather than `error` — this is the
"player degrades to not rendered rather than 404-ing" the task asked for, and it only mattered
for the "render just started, then deleted" race (a render cancelled after some segments
already played just runs off the end of the manifest normally, no 404 involved).

**Part H.** `openaiCompat.ts`'s `parseOpenAICompatSSE` gained a third optional `modelSink`
parameter (independent of `usageSink` — a served-model string and a usage object arrive on
different endpoints' responses, not always together), and `extractAttempt`'s non-streaming
path reads `body.model` the same way. `LLMProvider` gained an optional `reportedModel()`,
mirroring `reportedUsage()`. `withUsageLedger`'s `log()` now decides `costUsd`/`costBasis` via
a new `llm/pricing.ts` (`priceCall`/`priceAnthropicCall`) instead of trusting whatever the
provider handed it — `claude-agent` is always `notional`, `openai-compatible` is always `none`,
and `anthropic` is priced from a small hand-maintained table keyed by exact model string,
falling back to `unpriced` (never a silent `$0`) for a model not in it. Migration 23 adds
`message_id`/`profile_id`/`model_source`/`cost_basis` to `llm_usage`; the per-message byline
(`Message.provenance`) is built two ways from the same `buildMessageProvenance`/
`endpointHostFor` logic in `usage.ts` — live, in the SSE `done` payload, from the just-logged
`UsageLedgerRow` (`threads.ts`'s `usageRowRef`), and on reload via a `LEFT JOIN llm_usage ...
LEFT JOIN provider_profiles` in `annotations/threads.ts`'s `listMessagesForThread`. `recordUsage`
now returns the full row (id included) instead of `void`, which is what makes the SSE path
possible without a re-query.

Two things left deliberately unfinished, both scope calls rather than oversights:

- **SPEC-GAP: cache-*write* tokens aren't priced.** `ReportedUsage` only carries
  `cacheReadTokens`; Anthropic's `cache_creation_input_tokens` (visible today only in
  `anthropic.ts`'s own `console.debug`) isn't threaded through, so a call that populates the
  cache prices its cache-write tokens as ordinary input instead of at the ~1.25x/2x write
  rate. Under-counts real spend slightly; never over-counts. Fixing it properly means widening
  `ReportedUsage` itself, which is a seam change bigger than this milestone's "get the basis
  right" scope.
- **"Is this local?" still reads `provider === 'openai-compatible'`**, same coarse definition
  `routes/usage.ts`'s pre-existing `RolePlanLimits.isLocal` already used — decisions.md
  2026-08-04 names this explicitly as the one thing `profile_id` makes newly *possible* to fix
  (join to `provider_profiles.openai_base_url`) but doesn't itself fix. The Usage divider's new
  provider/model table shows the model string, which is usually enough for a human to tell a
  local Ollama from a hosted OpenRouter by eye; a real host-based classifier is future work.

### Verification method

Unit tests: `render.test.ts` (new `getSectionAudioSizeBytes`/`getResourceAudioSections`/
`deleteSectionAudioCache`, isolated tmp dir per existing pattern), `openaiCompat.test.ts` (model
sink captured independent of usage sink, stays null when absent), `usage.test.ts` (rewritten —
cost basis per provider including the unpriced-model case, model-source endpoint-vs-configured,
breakdown grouping by provider/model/profile with FK-valid seeded profiles, `linkUsageToMessage`
+ `buildMessageProvenance` round trip). `db.test.ts`'s hardcoded `user_version` expectations
bumped 22 → 23.

Live, against the real running dev server and real library (no mocks): `DELETE
.../audio/sections/2` on Metamorphosis, confirmed via `du` before/after that the bytes actually
left disk, not just the API's own say-so; `POST` on the same section afterward returned a fresh
`jobId` (not `{cached:true}`) and the render ran to completion a second time, landing on the
identical byte count — confirming "re-renders rather than erroring" isn't a coincidence of the
first run. A second render (section 3) was deleted ~1s after starting; the job transitioned
straight to `cancelled` and no partial directory was left on disk, confirming the mid-render
cancel path. The Digest page itself was screenshotted in three states: nothing rendered ("No
audio rendered yet", no delete-all button — the button is conditional on `totalBytes > 0`),
mid-book with one section done ("Audio rendered: 8.0 MB across 1 of 5 sections", that section's
row reading "Rendered · 8.0 MB · Delete audio", every other row "Not rendered" with no delete
link). The live-without-reload flip (the tray-stream acceptance criterion) rode a real
6-minute-long background render in the same open tab; the poll window ended about 15 seconds
before the job actually finished, so that exact instant wasn't caught on camera — the *result*
(a fresh page load showing the flipped state with no server restart in between) was, and the
underlying mechanism is the same `subscribeAllJobs` stream M22.5 D already drove live.

For H: a real question asked against the local Qwen profile (`POST
/api/threads/:id/messages` on an existing Kafka on the Shore thread) — the SSE `done` event's
`provenance` field came back `{profileName: "Qwen3.5", provider: "openai-compatible", model:
"qwen3.5-hermes:latest", endpointHost: "localhost:11434"}`, and a subsequent plain `GET
/api/threads/:id` (the JOIN-based read path, not the SSE path) returned the identical object for
that message — the two independent code paths agree. The same thread's four pre-migration
messages all came back `provenance: null`, no crash. Screenshotted live in the reader: the
byline reads exactly `Qwen3.5 · local · qwen3.5-hermes:latest · localhost:11434` under the
answer, styled as quietly as the existing context-usage caption beside it. Settings → LLM shows
the one-line disclaimer; Settings → Usage shows `billed`/`notional` both present and a
provider/model breakdown table — read from the real ledger, which happened to already contain a
mix of `openai-compatible` (none) and `claude-agent` (notional, $0.46 across two operations)
rows from this session's own digest/cast work, so the "$0.00 billed, notional shown separately"
acceptance case was verified against real data rather than a fixture.

Not driven live: the keyed/`billed` Anthropic path (no `anthropicApiKey` configured on this
machine) and the `unpriced` fallback (would need a profile pointed at a model string absent from
`pricing.ts`'s table) — both covered by `usage.test.ts` instead, which exercises `priceCall`
directly against fabricated `ReportedUsage`.

## Blockers

- **M26 — "Codex CLI as a fourth provider" still needs a working `codex
  login`, but the operator now has an in-app way to do it — 2026-08-25.**
  `~/.codex/auth.json` had gone stale (401s from `api.openai.com`,
  `codex login status` → "Not logged in") — see decisions.md 2026-08-25 for
  the full diagnosis. Rather than send the operator back to a terminal,
  built `server/src/llm/authFlows.ts` + `web/src/settings/ProviderAuth.tsx`:
  a "Sign in" button in Settings → LLM → Accounts that spawns
  `codex login --device-auth`, parses the verification URL + code out of its
  stdout, and shows them live while polling for completion. Verified live
  end to end (real device code obtained and rendered in the browser UI,
  clean cancel with no dangling process) — the mechanism is proven; what's
  still open is the operator actually completing a sign-in through it.
  Once they have: `codex login status` should stop saying "Not logged in",
  and M26's own next step is unchanged from before — run one real
  `codex exec --json --sandbox read-only --ephemeral --skip-git-repo-check
  -C <scratch dir> "..."` call, read the real success-path JSONL event
  shape (the failure shape — `thread.started`/`turn.started`/`error`/
  `turn.failed` — is already known from the earlier attempt, but that's not
  what `extract()`/`stream()` need to be built against), write it here, and
  only then touch `server/src/llm/codexCli.ts`.
- ~~**M17.5 — no `claude` CLI in this environment.**~~ **Resolved, was a
  wrong test.** This session initially reported `which claude` → not found
  and concluded the subscription path couldn't be verified live. The
  operator caught it: `which` only checks `PATH`, but the Agent SDK vendors
  its own per-platform `claude` binary as a dependency
  (`node_modules/.../@anthropic-ai/claude-agent-sdk-linux-x64/claude`), and
  this machine already has real subscription credentials
  (`~/.claude/.credentials.json`) from M7/M17's earlier live verification.
  Re-ran the digest live against the real `claude-agent` provider — see the
  corrected writeup below. Leaving this struck through rather than deleted:
  the mistake (checking `PATH` instead of how the code actually resolves
  the binary) is worth remembering, not just the correction.
- **M17.5 — the tunnel itself was never touched.** All M17.5 measurements
  are local (this session runs on the rig, not the operator's actual `ssh
  -L` position). The milestone's own Verify step asks for an
  operator-position, over-the-tunnel comparison against the baseline table
  — still genuinely open.
- ~~**M19.6 — the chapter-boundary page skip / book-count "+2" jump the
  operator reports is still open, unreproduced in this environment.**~~
  **Resolved — see "M19.6 — round 4" below.** The real cause was sub-pixel
  `scrollLeft` drift at a non-100% device-scale factor/browser zoom, which
  neither round 2's nor round 3's headless-Chromium sweep (both effectively
  DSF 1) could ever have produced — consistent with both rounds finding zero
  anomalies despite genuinely adversarial coverage. Fixed in
  `web/src/reader/pageTurn.ts`.

## Session handoff — 2026-07-13 (M1 in progress, nothing committed)

> **SUPERSEDED** by the review section below — everything in this handoff was
> subsequently run, verified, and committed as M1. Kept for history only.

Picking up in a fresh chat window. Everything below is **uncommitted**, on top
of commit `12547f5` (M0). The session was interrupted mid-task, right before
running the server test suite for the first time against this new code — so
**none of it has been run or verified yet**. Do that first.

`git status` at handoff time:

```
 M projects/marginalia/pnpm-lock.yaml
 M projects/marginalia/server/package.json
 M projects/marginalia/server/src/index.ts
 M projects/marginalia/web/src/library/LibraryPage.module.css
 M projects/marginalia/web/src/library/LibraryPage.tsx
?? projects/marginalia/server/src/library/
?? projects/marginalia/server/src/routes/
```

### What's implemented (per TASKS.md M1)

- **`server/src/library/epub.ts`** — `extractEpub(buffer)`: reads
  `META-INF/container.xml` → OPF rootfile path → parses the OPF
  (`dc:title`, first `dc:creator` as author, `dc:language`, `dc:publisher`,
  cover `<meta name="cover">`) → resolves manifest `href`s relative to the
  OPF's directory → walks `<spine>` `itemref`s in document order → converts
  each spine item's (X)HTML body to plain text via `htmlToText` (now
  exported for direct unit testing). Uses `htmlparser2` in `xmlMode: true`
  for container.xml/OPF (exact tag/attr casing), default HTML mode for spine
  content (more tolerant of malformed markup). `<head>`/`<script>`/`<style>`
  content is excluded from extracted text via a `skipDepth` counter, so
  `<head><title>` text can't leak into the book text. Confirmed empirically
  that `htmlparser2` v9 decodes HTML entities automatically with no
  `decodeEntities` option needed (tested via a one-off `node -e` snippet
  against `café — "hello" & <tag> é '` before writing this).
- **`server/src/library/store.ts`** — `getResourceById`,
  `getResourceFilePath`, `listResourceSummaries` (join subqueries for
  `highlight_count`/`thread_count`). Handles the snake_case DB row →
  camelCase `Resource`/`ResourceSummary` mapping and `metadata` JSON
  parse/stringify.
- **`server/src/library/importResource.ts`** — `importEpub(db, buffer)`:
  sha256 hash → `getResourceById` short-circuit (this is the dedupe: a
  re-import of identical bytes returns the existing row, no re-extraction,
  no re-write) → `extractEpub` → write `LIBRARY_DIR/<hash>.epub` → a
  `db.transaction` inserting the `resources` row + all `resource_text` rows
  → on transaction failure, deletes the just-written file so we don't leave
  an orphaned file with no DB row.
- **`server/src/routes/resources.ts`** — `POST /` (multer
  `memoryStorage()`, field name `"file"`, 200MB limit, rejects non-`.epub`
  originalname with 400), `GET /` (list summaries), `GET /:id`,
  `GET /:id/file` (`res.sendFile` with `application/epub+zip`). Wired into
  `server/src/index.ts` as `app.use("/api/resources", resourcesRouter)`
  (that one-line addition is the `index.ts` diff above).
- **`server/src/library/epub.test.ts`** — vitest against the two real
  fixtures (`fixtures/alice-in-wonderland.epub`,
  `fixtures/metamorphosis.epub`, both already committed in M0): title/
  author/language, exact spine counts (14 for Alice, 5 for Metamorphosis),
  non-empty text on every spine item except the image-only cover wrapper
  (spine index 0), a "White Rabbit" content spot-check, and a determinism
  check (`extractEpub` called twice on the same buffer → `toEqual`). A
  `describe("htmlToText")` block was added on top of my version (see below)
  with focused tests for head/title stripping, script/style stripping, and
  block-tag newline insertion.
- **`server/package.json`** — added `adm-zip`, `htmlparser2`,
  `multer@^2.2.0` + matching `@types/*`. Deliberately **not** multer 1.x —
  checked `npm view multer dist-tags`: 1.x is the deprecated/CVE'd line,
  2.2.0 is current `latest`. `@types/multer@^2.2.0` matches. Already ran
  `pnpm install` once for these — `pnpm-lock.yaml`'s diff reflects it — but
  re-run it again first thing in the new session as a safety net.
- **`web/src/library/LibraryPage.tsx` + `.module.css`** — these were
  rewritten **after my last edit, by the user or a linter** (flagged via
  system-reminders mid-session, I did not author the final version and
  haven't reviewed the `.module.css` at all). The `.tsx` now has: real
  `GET /api/resources` fetch on mount, drag-drop with a `dragDepth` ref
  counter (so nested drag-enter/leave of child elements don't flicker the
  dropzone state), a hidden file `<input>` + "Import book"/"Choose a file"
  buttons, per-file `XMLHttpRequest` upload with a real progress bar
  (`xhr.upload.onprogress`), per-upload error state with a dismiss button,
  client-side `.epub` extension rejection before upload, a library grid of
  cards (title/author/highlight count) linking to `/read/:id`, and the
  original designed empty state preserved when there are zero resources.
  **Read this file fresh in the new session** rather than trusting this
  summary — I only have it via a diff snippet, not a full read.

### Not yet done — do these in order

1. `cd projects/marginalia && pnpm install` (pick up the two new server deps
   cleanly in a fresh shell).
2. `pnpm --filter @marginalia/server test` — this exact command was queued
   and interrupted. Run it first; fix whatever `epub.test.ts` reveals.
3. `pnpm build` (full workspace `tsc -b`) — first real compile of
   `resources.ts` against multer 2.x + Express 5's types; this combination
   has never been compiled or exercised, it's the highest-risk untested
   integration point in this batch of work.
4. `pnpm test` (all three packages).
5. Manual **Verify** step from TASKS.md M1: `pnpm dev`, drag-drop both
   fixture EPUBs into the library UI (or a headless-browser pass, same
   approach used for the M0 verification — see that commit's description),
   confirm both appear in the grid, confirm re-importing one is a no-op
   (no duplicate row — check via `sqlite3 data/marginalia.sqlite`), confirm
   `resource_text` rows exist for both books.
6. Only after (5) passes: check the M1 boxes in `docs/marginalia/TASKS.md`.
7. Commit M1 (small, focused — extraction/store/import/routes as one
   commit and the library UI as another is reasonable, or bundle if that
   feels like unnecessary ceremony; use judgment).
8. Continue to M2 (Reader / epub.js wrapper) per TASKS.md.

### Specific things to double-check (uncertain / unverified at handoff)

- `htmlToText` is now `export`ed from `epub.ts` (added to satisfy the new
  `describe("htmlToText")` test block) — confirm the export is actually
  there and the function body wasn't otherwise changed by whoever edited
  the test file.
- `attribs.id`/`attribs.href`/etc. from `htmlparser2`'s `onopentag` are
  typed as plain `string` (not `string | undefined`) since M0 dropped
  `noUncheckedIndexedAccess` — the code relies on truthy checks
  (`attribs.id && attribs.href`), which is correct at runtime, but it means
  `tsc` won't catch a missing-attribute bug here. Not a blocker, just don't
  assume the type signature is protecting you in this one module.
- `res.sendFile(filePath)` in `GET /:id/file` needs an **absolute** path —
  `LIBRARY_DIR` should already be absolute (built from `path.resolve` in
  `server/src/paths.ts`, from M0), but confirm rather than assume.
- Multer 2.x + Express 5 `RequestHandler` typing has never actually been
  compiled — see item 3 above.

### Standing process reminder (from SONNET_PROMPT.md)

Read CLAUDE.md → SPEC.md → TASKS.md → PRODUCT.md if this is a genuinely
fresh context. Do the next unchecked TASKS.md item. Verify each milestone
for real (drive the app), not just via tests. Don't re-decide settled
decisions. Log new SPEC-GAPs/friction/blockers here. Small, focused commits
with the relevant TASKS.md boxes checked in the same commit.

## Senior review + M1 sign-off — 2026-07-13 (Fable)

Reviewed all M1 code (`epub.ts`, `store.ts`, `importResource.ts`,
`routes/resources.ts`, `LibraryPage.tsx` + css) and ran the full verification
that the interrupted session left queued. **Everything passed; M1 is done and
committed.** Verified concretely:

- `pnpm install` / `pnpm build` (full `tsc -b`, incl. multer 2.x + Express 5
  types — the flagged risk compiled clean) / `pnpm test` — 12/12 green.
- API drive: imported both fixtures via `curl` multipart → correct
  title/author/metadata; re-import returned the identical resource (dedupe);
  sqlite shows 2 `resources` rows, 14 + 5 `resource_text` rows; both
  content-addressed files in `data/library/`; `GET /:id/file` → 200
  `application/epub+zip`; non-epub upload → 400 `unsupported_format`.
- UI drive (headless chromium against `pnpm dev`): grid renders both books,
  re-import via the file input leaves 2 cards, a `.txt` shows the inline
  dismissible error, screenshot looks right in the paper theme.
- The `LibraryPage.tsx` the previous session hadn't reviewed: read in full,
  no issues. `htmlToText` export is present and unchanged.

Code-review notes (no action needed, recorded for awareness):

- `parseOpf` captures only the *first* `dc:creator` — intentional per the
  handoff; multi-author books lose co-authors. Fine for now.
- `POST /api/resources` returns 422 with the raw `Error.message` for any
  import failure — acceptable locally, don't cargo-cult this pattern into
  LLM routes where messages may contain provider details.
- `importEpub` writes the file before the DB transaction and removes it on
  failure — correct ordering, leave as is.

**Next task: M2 — Reader** (first unchecked box in TASKS.md). No open
blockers. Standing process in SONNET_PROMPT.md still applies verbatim.

## Senior review + M4/M5 sign-off — 2026-07-17 (Fable)

Reviewed all M4/M5 code and drove it end-to-end against a **mock
OpenAI-compatible SSE server** (happy path, provider-500 path, mid-stream
client disconnect). Full suite: 46/46 tests green, `tsc -b` + vite build
clean. **M4/M5 are functionally solid — the core loop works — but three
fixes are required before/alongside M6** (checklist added to TASKS.md as
"M6 pre-flight fixes"; details below).

### Verified working (don't re-verify)

- SSE contract exact per SPEC: `{text}` chunks → `{done, messageId,
  threadId}`; error path emits `{error}` and never `done`.
- Partial answers are never persisted on disconnect (mid-stream abort test).
- Follow-ups replay history correctly; first-question-only quote framing.
- `pnpm --filter @marginalia/server ask <rid> "<q>"` streams to stdout.
- Settings mask/unmask round-trip ("***" sentinel) works incl. /test
  fallback; masked GET never leaks keys.
- `markdown.tsx` is XSS-safe (builds React elements, no innerHTML).
- Anthropic impl: 2-block system with `cache_control` on book context,
  `max_tokens` set, typed error mapping, refusal handling — per SPEC (not
  exercised against a live key in this review).

### MUST FIX (verified bugs)

1. **User messages persist even when the answer fails — and Retry
   duplicates them.** `routes/threads.ts` calls `createMessage(db, ...,
   "user", ...)` *before* streaming. Provider error → dangling user row;
   UI Retry re-POSTs → **two identical user rows** (reproduced: thread
   ended with `user, user` after one error+retry), which then replay into
   the model context on every later follow-up, and render as duplicate
   bubbles. SPEC says *persist on completion*: write the user+assistant
   pair together (one transaction) in `streamThreadReply` after the stream
   finishes; on error/abort persist nothing. Note `ThreadPanel.submit()`
   also re-appends the optimistic user bubble on Retry — fixing the server
   side and having Retry reuse the existing optimistic message (or dedupe
   by content) covers the UI half.
2. **API-key exfiltration via CORS + /test fallback.** The server runs
   `app.use(cors())` (allow-all: verified `Access-Control-Allow-Origin: *`)
   and `POST /api/settings/test` resolves a masked `"***"` key to the real
   saved key. Any webpage open in the user's browser can therefore POST
   `{provider:"openai-compatible", openaiBaseUrl:"https://evil.example/v1",
   openaiApiKey:"***"}` and the server sends the saved key as a Bearer
   header to the attacker's URL. Fix both layers: **remove `cors()`
   entirely** (dev is same-origin via the Vite proxy; prod serves the
   built web app from this same server) and **bind to loopback**:
   `app.listen(PORT, "127.0.0.1", ...)` so LAN peers can't reach the API
   either. Nothing in the app needs cross-origin access.
3. **`openaiCompat.ts` never sends `max_tokens`.** `THREAD_MAX_TOKENS` is
   declared and unused (dead const); the anthropic impl uses its twin.
   Some OpenAI-compatible servers mis-default without it — add
   `max_tokens: THREAD_MAX_TOKENS` to both the stream and extract bodies.

### SHOULD FIX (opportunistic, small)

4. `AnthropicProvider.capabilities()` hardcodes `contextTokens: 1_000_000`
   regardless of model — wrong for e.g. Haiku (200K); the context builder
   will overshoot and surface as a provider 400. Map known model prefixes
   (or add an anthropicContextTokens setting mirroring the openai one).
5. Provider error bodies pass through raw to the UI (`unknown:
   {"error":{"message":"..."}}` — verified). The M1 review already warned
   against this in LLM routes. Send `err.code` + a short human message;
   `console.error` the raw body server-side instead.
6. Two rapid first-asks on the same highlight race
   `getThreadByHighlightId ?? createThread` into the `UNIQUE(highlight_id)`
   constraint → unhandled 500. Catch the constraint error and reuse the
   existing thread.

### Nits (defer to M7)

- `markdown.tsx` renders `[text](url)` literally (no link support) — fine
  for v1, revisit in the M7 polish pass.
- Web bundle is now 622KB minified (epub.js + app in one chunk) — already
  covered by the M7 code-splitting task.

**Next task: the "M6 pre-flight fixes" checklist at the top of M6 in
TASKS.md (items 1–3 above are blocking; 4–6 are quick wins), then M6 —
vault compiler.** Remember the zod/v4 note above for the M6 extraction
schema.

## M6 pre-flight fixes 1–3 landed — 2026-07-17 (Fable)

Fixed the three blocking items from the senior review above (TASKS.md
checkboxes now checked). Items 4–6 ("quick wins") are still open — not
blocking, left for opportunistic pickup.

- **Message persistence:** `routes/threads.ts` no longer calls `createMessage`
  for the user question before streaming. `streamThreadReply` now takes the
  pending `userContent` and, only on successful completion, writes both the
  user and assistant rows together via a new `persistExchange()` helper
  (`db.transaction`). Error/abort paths persist nothing — verified live
  (pointed openaiCompat at an unreachable URL, confirmed zero messages after
  the error; restored the endpoint, re-posted the same question, confirmed
  exactly one user + one assistant row). `ThreadPanel.tsx` tracks the
  optimistic bubble's id in `pendingMessageIdRef` and `handleRetry` passes it
  back into `submit()` so retry reuses the existing bubble instead of pushing
  a second one.
- **CORS + key exfiltration:** removed `cors` entirely (import, middleware,
  and the `cors`/`@types/cors` deps) and bound `app.listen(PORT,
  "127.0.0.1", ...)`. Verified live: no `Access-Control-*` headers on any
  response (incl. a preflight OPTIONS with an `Origin` header), and the
  server refuses connections on the machine's LAN IP (loopback only).
- **`openaiCompat.ts` `max_tokens`:** added `max_tokens: THREAD_MAX_TOKENS`
  to both the `stream()` and `extract()` request bodies. Exercised live
  against a local Ollama endpoint without incident.

Verification method: ran the real server against a local Ollama
(`llama3.1:8b`, openaiCompat) with `curl`, inspecting `data/marginalia.sqlite`
directly with a one-off `better-sqlite3` script — not just unit tests. Full
suite still 46/46, `tsc -b` + `vite build` clean.

**Next task: items 4–6 (quick wins) if picked up, then M6 proper — vault
compiler** (first unchecked box after the pre-flight fixes in TASKS.md).

## M6 — vault compiler landed — 2026-07-17 (Fable)

Implemented the vault compiler proper (everything under M6 in TASKS.md
except the still-open "quick wins" checklist item). New:
`server/src/vault/{concepts,writeVaultFile,compiler,publishStore}.ts`,
`server/src/routes/publish.ts`, `web/src/app/Toast.tsx`,
`web/src/library/publish.ts`, publish buttons on the library card and in
the reader header.

### Spec gaps / design notes

- **No YAML library in the stack.** SPEC's stack table doesn't name one, and
  the compiler is the only writer of the frontmatter it later reads back
  (concept `aliases`) — added a minimal hand-rolled frontmatter parser in
  `concepts.ts` for exactly the shape we generate, rather than adding a
  dependency for a format we fully control. Frontmatter scalar values are
  written via `JSON.stringify` (a valid YAML flow scalar) so titles/aliases
  with colons or quotes don't corrupt the document.
- **"Up to date" in the idempotency rule (SPEC step 1) has no cheap
  staleness signal.** The `publishes` table has no message-count/version
  column, only `(thread_id, note_path, content_hash, published_at)`. Chose:
  a thread with an existing `publishes` row is always "up to date" and never
  re-extracted. The alternative (re-extract every publish, compare hashes)
  would call the LLM on every single publish and isn't guaranteed
  byte-identical output for identical input — that would break "publish
  again → no changes" nondeterministically. Documented in a comment on
  `publishResource`.
- **Distill instructions spell out the exact JSON shape.** SPEC's
  OpenAI-compat section only says request `response_format: json_object` +
  `safeParse` + one retry with the validation error appended — already
  implemented in M4 and left untouched. But a small local model (Ollama
  llama3.1:8b) given only a prose description of the desired fields
  invented its own unrelated JSON shape and failed both the first attempt
  and the error-appended retry. This isn't a provider-layer bug — it's
  `compiler.ts`'s own prompt content — so the fix was tightening
  `DISTILL_INSTRUCTIONS` to include a literal JSON template. Confirmed via a
  raw curl against Ollama before touching code, then again after: reliable
  schema-conforming output. Worth remembering if M6-adjacent extraction
  prompts get added later against weak local models.

### Bugs found during live verification (fixed, with regression tests)

- **A concept name containing a filesystem-unsafe character (e.g. "/")
  broke its own wikilink.** `sanitizeFilename()` was applied to the
  *filename* but the reading note's `[[Name]]` link used the model's raw,
  unsanitized proposal — so a concept named "Cultural/Societal
  Expectations" was written to `Concepts/Cultural-Societal Expectations.md`
  but linked as `[[Cultural/Societal Expectations]]`, which Obsidian
  resolves as a *folder* path, not the actual file. Caught by literally
  reading the generated vault files during verification, not by a test —
  the FakeProvider-based tests all used clean concept names. Fixed by
  deriving the canonical `ExistingConcept.name` from the sanitized filename
  everywhere (mention lines, reading-note links, in-run concept matching),
  never from the model's raw proposal. Added a dedicated regression test
  (`compiler.test.ts`, "sanitizes a concept name for the filename...").
- **`deleteHighlight` didn't cascade to the `publishes` table.** The M6
  migration's `publishes.thread_id` has a foreign key on `threads(id)`
  (present since the M0 schema, unused until M6). Once a thread has been
  published at least once, deleting its highlight started failing with
  `FOREIGN KEY constraint failed` — reproduced live via `DELETE
  /api/highlights/:id` against a highlight I'd just published. Fixed by
  adding `DELETE FROM publishes WHERE thread_id IN (...)` to the same
  transaction in `annotations/highlights.ts`'s `deleteHighlight`, ahead of
  the messages/threads deletes. Regression test added to
  `highlights.test.ts`.
- **Toast covered the reader's Previous/Next pagination buttons.** The
  shared `Toast` component defaults to bottom-center, which is fine on the
  library page but collides with `ReaderPage`'s footer pagination bar.
  Caught via a real headless-browser screenshot, not by unit tests (this is
  exactly the kind of thing CLAUDE.md's "verify by driving the app" rule is
  for). Added a `position="top"` variant, used only in the reader.

### Verification method

Real end-to-end run against a scratch vault (`$SCRATCHPAD/vault`) driven by
`curl` against a live local Ollama endpoint (llama3.1:8b via the
openaiCompat provider) — not mocked. 3 highlights + real streamed answers on
Metamorphosis, published to 3 reading notes + 15 concept notes + a
`_Book.md` overview; scripted check that every `[[wikilink]]` in the reading
notes resolves to an actual `Concepts/*.md` file; second publish verified
byte-identical via a full `sha256sum` diff of every vault file (empty diff)
with the FakeProvider's queued-response test additionally proving zero
re-extraction calls happen. Also drove the actual UI: `pnpm dev` +
Playwright (cached Chromium, not a project dependency — installed ad hoc
into the scratchpad dir) against the real Vite dev server, both the library
card's and the reader's Publish button, in both Paper and Ink themes.
Full suite 69/69 (`shared` 4, `server` 48, `web` 17), `tsc -b` + `vite
build` clean.

**Next task: the "quick wins" checklist item still open at the top of M6 in
TASKS.md (Anthropic per-model context size, trimming SSE error bodies,
UNIQUE(highlight_id) race), then M7 — beauty & revisit pass.**

## M8 — the Desk

Built the freeform bookshelf workspace: additive migration (`shelf_state`,
`notepad`), a shared `useLibrary` data hook so the new Desk/List toggle
doesn't fork the fetch/upload/publish pipeline, draggable `BookObject`s
(spring lift/settle, hover info strip, scroll-to-open "crown" gesture),
the desk notepad (autosave, publish-through-the-vault-compiler with its
own content-hash ledger so republish is a no-op on unchanged text), and
ambient physics (cursor-parallax tilt on the whole surface, a canvas
ink-trail overlay) gated behind both a Settings toggle and
`prefers-reduced-motion`.

**Bug caught live, not hypothetical:** the hover info strip is a DOM child
of its book's own `motion.div`, which has its own `z-index` (the drag
"bring to front" stacking order). A screenshot taken mid-verification
showed a hovered book's info strip painting *underneath* a neighboring book
with a higher `zOrder` — `z-index` on a child only wins within its parent's
own stacking context, not globally. Fixed by lifting the hovered book's own
`z-index` to a very high sentinel while `isHovering` is true (which also
reads as the natural "hover raises the book" cue DESIGN.md asks for), not
just the strip's. Verified after the fix: hovered each of three
deliberately-overlapping books and confirmed via
`document.elementFromPoint` that the strip is the actual topmost element at
its own center, for all three.

### Verification method

Real `pnpm dev` (Vite + server) driven by Playwright (ad hoc into the
scratchpad, as in M6/M7 — not a project dependency), headless Chromium,
against the real fixtures already in the library:
- Dragged a book, reloaded, confirmed the new position persisted
  (`x` displacement check on the reloaded bounding box) — not simulated,
  a real `PUT /api/resources/:id/shelf` round-trip.
- Toggled List ⇄ Desk repeatedly; List view renders the original accessible
  grid unchanged (real `<a href="/read/:id">` links, unaffected by the
  Desk refactor).
- Hovered each book: info strip shows title/author/last-read/thread+
  highlight counts and a working Publish action (see z-index bug above).
- Scroll-to-open: wheel events while hovering a book accumulate and commit
  to `navigate(/read/:id)` past the threshold — confirmed by watching the
  URL actually change.
- Notepad: typed content, watched the autosave debounce land ("Saved"
  status), then published for real against the live `claude-agent`
  subscription provider (no mocking) with a scratch vault path — produced
  `Notes/Desk Notepad.md` plus three real extracted concept notes, all
  wikilinks resolving. Re-verified the ledger is content-hash keyed (not
  thread-keyed) by reading `notepad/store.test.ts`'s dedicated coverage.
- Cursor trail: confirmed the canvas element exists and paints on real
  `pointermove` events (screenshot); confirmed it's entirely absent when
  `reducedMotion: "reduce"` is set at the browser level.
- Reduced motion: drag is disabled (`drag={!reducedMotion}`), so a plain
  click still opens the reader via `onTap`; parallax pointer handlers are
  no-ops when disabled (tilt pinned at 0 by construction, not just visually
  near-zero).
- Settings: toggled cursor style to "System" and trail off, saved, reloaded
  the page, confirmed both choices came back from the server (not just
  local state) — then restored the defaults.
- Left the shared dev server's actual `vaultPath` setting and notepad
  content exactly as found (cleared both back to empty after testing) so
  this session's manual verification doesn't leak into the running app's
  real state.

95/95 tests (`shared` 4, `server` 74 — new: `notepad/store.test.ts`,
`publishNotepad` cases in `compiler.test.ts` — `web` 17 unchanged since the
Desk isn't yet covered by an automated browser test, only manual/Playwright
verification above), `tsc -b` + `vite build` clean, code-split
(`DeskPage` is its own lazy chunk, same as the old `LibraryPage` was).

**Next task: M9 — the Scan (timeline & heat map).**

## M9 — the Scan

Built the timeline/heat-map room: additive migration (`highlights.importance`,
`highlight_tags`), a server-side position resolver
(`annotations/position.ts`) that locates each highlight's
prefix+exact+suffix in `resource_text` char offsets with no epub.js
involved, `ScanPage` (chapter ticks, heat bands, hover ghost readout,
kind/tag/text filters, importance stars, revisit queue), and the airlock
transition wiring both directions (Desk → Scan, Reader ⇄ Scan).
`ImportanceStars`/`TagEditor` are shared components used identically in the
scan's hover readout and the reader's thread panel (DESIGN.md's two
prescribed editing surfaces for the same data) — confirmed live that a star
+ tag set in one surface round-trips correctly into the other.

**Three real bugs found live, not hypothetical** (this milestone's server
work is the first thing that ever cross-checks a highlight's stored
`spineIndex`/`prefix`/`exact`/`suffix` against the server's own
`resource_text`, which nothing before M9 did):

1. **A pre-existing M3-era data-quality bug surfaced immediately**: several
   real highlights in the dev database (created across earlier milestones'
   verification sessions) have a `spineIndex` that doesn't match where
   their text actually lives (off by one) — not reproduced deterministically
   enough to chase down in the client capture code, so rather than silently
   dropping those highlights from the scan, `computeHighlightPositionPercent`
   now falls back to searching every section in spine order when the
   recorded section doesn't contain the text. Regression test added
   (`position.test.ts`, "falls back to searching every section...").
2. **A real whitespace-representation mismatch**: the server's `htmlToText`
   extraction inserts `"\n"` for a `<br>` tag; a browser's live text
   selection across that same `<br>` inserts nothing (no character at all).
   Two otherwise-correct highlights on a real book (Metamorphosis) were
   unfindable server-side purely because of this — `findAnchorInText`
   (shared/src/anchorText.ts, used by both the reader's CFI-fallback
   anchoring and the scan's position resolver) now falls back to a
   whitespace-collapsed comparison, mapping the match back to original-text
   offsets. This is a shared-algorithm fix, so it also strengthens the
   reader's own text-search fallback, not just the scan. A third highlight
   in the same book ("It was not a dream") stayed correctly unresolved —
   verified that exact phrase genuinely appears nowhere in the extracted
   text, i.e. stale/corrupted test data, not a resolver bug.
3. **Closely-spaced bands blocked each other's hover/click entirely**: two
   highlights positioned within ~0.2% of each other on the strip made the
   later-in-DOM band's hit-area cover the earlier one's, so it could never
   be hovered or clicked (confirmed live via Playwright: a `hover()` on the
   first band timed out because the second band's subtree was intercepting
   pointer events). Fixed with a decluttering layout pass in `HeatStrip.tsx`
   that enforces a minimum percent-gap between adjacent bands' *drawn*
   position without touching the *true* `positionPercent` shown in the
   readout or used for filtering/sorting.

**Simplifications / SPEC-GAPs**, recorded rather than silently deviated from:
- The book-opening "stylized page-flutter" from DESIGN.md's doorway
  transition wasn't built beyond the existing M7 cover-zoom `layoutId`
  crossfade — scoped out as a nice-to-have distinct from the airlock (which
  *was* built in full, both directions, per the M9 task list).
- Chapter tick labels use the spine href's filename (e.g. `wrap0000`) since
  no chapter-title extraction exists anywhere in the codebase (M1's
  extraction never parsed the TOC/nav document) — good enough for tick
  landmarks, not real chapter names. Would need a TOC parser to do better.
- The scan's dark theme is implemented exactly as DESIGN.md prescribes —
  overriding the *same* CSS custom properties paper/ink use, scoped to
  `ScanPage`'s root — rather than a parallel variable namespace, so every
  shared component (`ImportanceStars`, `TagEditor`, buttons) themes for
  free. Minor known cosmetic gap: on a very short scan (few highlights,
  tall viewport), the dark panel's `.page` div doesn't always stretch to
  the full remaining viewport height, leaving a sliver of the light body
  background below it — a flexbox min-height percentage-resolution
  question, not a functional defect (didn't chase further given the size
  of this milestone already).

### Verification method

Same real `pnpm dev` + Playwright approach as M8 (ad hoc into the
scratchpad). Against the live dev library's real Metamorphosis fixture
(7 highlights, 4 threads, accumulated across earlier milestones' own
verification sessions — not synthetic fixtures):
- Confirmed bands actually render at server-computed positions and found +
  fixed the two data-integrity bugs above by directly inspecting
  `resource_text` and the `highlights` table with `better-sqlite3` when the
  scan first showed 3 of 7 highlights as unpositioned.
- Hovered a band → ghost readout with quote, thread first line, tag editor,
  stars; starred a highlight from the readout → dog-ear + revisit-queue
  entry appeared live, correct sort order confirmed with two stars.
- Added a tag from the readout, reloaded, filtered by that tag → correct
  subset lit, rest dimmed; same for kind filter and free-text search.
- Clicked a band → airlock → landed in the reader on the right page with
  the thread panel open, showing the *same* star/tag state just set in the
  scan (round-trip confirmed). Found and fixed a real bug here too: the
  "clear the airlock flag" effect in `ReaderPage` ran on its own first
  commit, before `ReaderView` (gated behind an async resource fetch) ever
  mounted to read `location.state` — so the jump-to-highlight intent was
  wiped before anything used it. Fixed by capturing `location.state` once
  via a lazy `useState` initializer instead of reading it live on every
  render; applied the same defensive pattern in `ScanPage` even though its
  bug didn't manifest there (no async gate ahead of its first render).
- Reader's "Scan" button → airlock → scan; Escape in the scan → airlock →
  book; Desk's "Open scan" hover action → airlock → scan. All four
  navigation entry points confirmed landing on the correct route.
- Reduced motion (browser-level `reducedMotion: "reduce"`): airlock overlay
  opacity stays 0 throughout, click-to-open still works instantly.
- Keyboard: kind-filter swatches, a heat band, and the back-to-book button
  all confirmed reachable via Tab and activatable via Enter/keyboard focus
  (not a full pointer-free walkthrough of every control, but the
  representative path DESIGN.md's verify step asks for).
- Cleared the test star/tag left on the shared dev database's Metamorphosis
  highlight back to empty afterward, same housekeeping discipline as prior
  milestones.

116/116 tests (`shared` 7 — new: `anchorText.test.ts` — `server` 92 — new:
`position.test.ts`, `scan.test.ts`, `tags.test.ts`, plus db/compiler
migration-4 coverage — `web` 17 unchanged, Scan verified live/manually like
Desk was in M8), `tsc -b` + `vite build` clean, `ScanPage` is its own
code-split chunk.

**v1.5 (M8, M9) is whole. Next task: M10 — reader depth (3D page turn &
origami notes), or a fresh senior review of M8/M9 before starting it.**

## M11 — reading surface fixes (in progress)

**SPEC-GAP: page-spacing task named the wrong lever.** TASKS.md's M11 "page
spacing" item said to set body padding via the epub.js theme
(`applyTheme`/`rendition.themes.register`). Tried that first — it's a dead
end. epub.js's default manager recomputes layout on every render/resize via
`Contents.columns()` (`epubjs/src/contents.js`), which sets
`padding-left`/`padding-right: <gap/2>px` as an **inline style with
`!important`** on `<body>` every time. An inline `!important` always beats a
stylesheet `!important` in the same cascade origin, so no CSS we register
through the theme API can survive a single relayout — confirmed live: body
computed padding stayed at 31px (epub.js's own auto-gap default,
`floor(width/12)` from `layout.js`) no matter what the theme's `padding`
said. The actual lever is the `gap` option epub.js's layout engine reads
from `rendition.settings.gap` (`layout.js`'s `calculate()`: an explicit
`gap` skips the auto formula entirely) — passed via `book.renderTo(el, {
..., gap })`. Not in the bundled TS types (`RenditionOptionsWithGap` local
cast in `ReaderView.tsx`), but very much real at runtime. Left the theme's
CSS padding in place too (harmless, covers the brief pre-layout paint) but
the real fix is the `gap` render option. `READER_PAGE_GAP = 96` → 48px
(3rem) each side.

## M12 — book traversal

**SPEC-GAP: "today's popover" didn't exist.** The M12 scrub-dial task
(TASKS.md) said "click keeps today's popover (% / pages / chapters)" as if
a click popover on the `%` readout already existed from an earlier
milestone. It didn't — grepped the whole `web/src` tree for "popover" and
found nothing before this session, and `decisions.md`'s own 2026-07-20
entry is the only other place that phrase appears. Built it as part of this
task (`ProgressPopover.tsx`) rather than re-deciding the feature: percent,
displayed page (epub.js's `location.start.displayed.page/total`, not
previously read anywhere in `ReaderView.tsx`), and current chapter.

**Chapter-start percentages, not a spineIndex ratio.** Tick marks on the
scrub dial need "where does chapter N start" as a whole-book percent. epub.js
exposes no direct API for that, but `book.locations` (already generated for
the plain `%` readout) implicitly encodes it: each generated location's CFI
carries its spine position (`new EpubCFI(cfi).spinePos`), so walking every
generated location and keeping the earliest percent per spine index
(`toc.ts`'s `chapterStartPercentsBySpineIndex`) derives an exact answer from
primitives epub.js already exposes, on the *same* scale the position needle
uses — a `spineIndex / spineCount` approximation was the first instinct but
would have visibly disagreed with the needle for any book whose chapters
aren't equal-length (i.e. every real book).

**Found via the new chapter-jump code, not caused by it: 3 highlights on
the shared dev Metamorphosis fixture have a corrupted CFI.** Jumping to the
first TOC entry ("Metamorphosis", spine index 1 — the title/translator
page) surfaced 3 highlights as "unanchored". Traced it: all 3 share the
identical CFI `epubcfi(/6/2!/4/2/1:0)` (spine index 1), but their `exact`
text is unmistakably from Chapter I ("...he found himself transformed in
his bed into a horrible vermin", the book's opening sentence) — spine index
2, not 1. This is the M9-era "stale spineIndex" bug (NOTES.md, M9 section)
manifesting in already-created records: the code path that creates a
highlight's CFI was fixed back then, but the 3 records created *before*
that fix still carry the wrong spine reference baked into the CFI itself.
No code before this session ever actually rendered spine index 1 — every
prior verification pass opened the book at a saved mid-book position and
only ever paged *forward* — so this is the first time anything asked epub.js
to resolve highlights against that section, and the SPEC's designed
fallback did exactly its job (surfaced as "unanchored", not dropped, not a
crash). Left the 3 records untouched — each has a real, answered thread
attached (genuine conversation history from earlier sessions, not
throwaway test data), so silently deleting or rewriting them as "cleanup"
felt like the wrong call for a display quirk in old data. `[`/`]` and the
TOC popover both correctly show every *other* highlight resolving cleanly
on arrival at every chapter; this is a known, load-bearing, pre-existing
data artifact, not a regression from M12.

**Two-page spread landed on `spread: "auto"` + a width-aware `gap` — the
part worth flagging is a rare rapid-turn glitch found while stress-testing
it, in M10's (unmodified) snapshot/curl code, not anything M12 wrote.**
`book.renderTo()`'s `spread`/`minSpreadWidth` options do essentially all of
the real work — epub.js's own layout.js already falls back to one column
below `minSpreadWidth`. The one real design decision was `gap`:
`contents.js` uses the *same* `gap` value for both the outer edge padding
and the native CSS `column-gap` between the two visible leaves (M11's
NOTES.md entry traces how `gap` reaches the page at all), so a spread
needs a much narrower `gap` (`SPREAD_GUTTER = 64`, a book-spine gutter)
than a single wide page does (M11's `computeReaderGap`, tuned for a ~70ch
measure) — `computeReaderGap` now picks between the two using the same
width≥minSpreadWidth check epub.js itself uses internally, so they never
disagree about whether a spread is actually showing. Audited (drove it
live, not just reasoned about) the M11 turn-zone vignettes, the Ask pill,
and the thread panel: all three are pure DOM-geometry math (a selection's
real `getBoundingClientRect()`), so they anchor to whichever leaf a
selection is on with zero code changes — confirmed via a real selection on
the second (right) leaf landing the panel there correctly.

**The glitch:** automated clicks ~500ms apart (faster than a relaxed
reading pace) occasionally produced a visibly corrupted spread — three
partial columns and dead space at the bottom — and once out of three
attempts, a full freeze where the page-turn button stopped responding for
30s+. The same rapid-click pattern in single-page mode, and a *paced*
(1.2s apart) rapid-click pattern in spread mode, both stayed clean across
repeated runs — so it's "rapid clicks" × "spread's wider capture target,"
not either alone. `turnLockRef` (M10) is synchronously airtight against
two logical turns overlapping — traced it line by line, it isn't the
cause. More likely, unconfirmed: `pageSnapshot.ts`'s
`html2canvas(..., { foreignObjectRendering: true })` serializes the live
DOM subtree into SVG XML synchronously; a spread's container is ~2x the
content width of a single page, and if that serialization is expensive
enough to measurably block the main thread, it could delay the
`Promise.race`'s own 700ms `setTimeout` fallback from firing on schedule —
a blocked main thread can't run a pending timer either, which would
explain a freeze surviving a mechanism specifically built to bound it.
Didn't chase further: root-causing html2canvas's concurrency behavior is
real surgery on M10's shared capture path, and M15 already explicitly owns
"Perf & fallbacks" for this exact system, instructed to "log any new
epub.js/html2canvas quirks" here — flagging it for that milestone is the
right scope boundary, not fixing it under pressure inside M12. A human
reading at a normal pace, and the reduced-motion slide fallback, both
verified clean and reliable in spread mode — this is a stress-test edge
case in an already-known-fragile shared mechanism, not a break in normal
use.


## M13 — notes on annotations

Straightforward add: `highlights.note` (migration 5, plain additive column,
default `''`), a `PUT /api/highlights/:id/note` route following the exact
shape of the pre-existing `/importance` and `/tags` routes (there was no
single generic "update a highlight" route to hook into, despite TASKS.md's
wording — importance and tags each already have their own dedicated route,
so this is a third one in the same family, not a new pattern), and `note`
folded directly into `HighlightSchema` (not a side table like tags) since
it's one scalar column — it now flows through `HighlightWithThread`
automatically the same way `importance` already does, with zero extra
fetch plumbing anywhere that already handles highlights.

The note field in `ThreadPanel.tsx` reuses the desk notepad's exact
800ms-autosave shape (`Notepad.tsx`), styled deliberately apart from the
LLM messages below it — serif italic, a thin rule tinted by the panel's
existing `--spine-kind` custom property (M7), a slightly raised paper
tone — so it reads as the reader's own handwriting in the margin, not
another chat bubble. Because `ThreadPanel` already remounts per highlight
(`key={highlight.id}` in ReaderView, an M5-era decision to keep
per-highlight state trivially isolated), the note textarea gets fresh
state on every open for free — confirmed live that opening a second,
different highlight in the same session shows a genuinely empty note
field, not a stale one.

For "note affordance elsewhere" (margin rail, annotations overview), took
the task's explicitly-sanctioned "same treatment as has-thread" option
rather than inventing new visual language: a note-only highlight now
triggers the identical folded dog-ear CSS as a thread does. This was a
real design fork worth naming — the alternative (a visually distinct
note-only marker) would need a fourth rail-dot state on top of
rose/sage/honey/slate × thread/answered/unanchored, and the task text
explicitly allowed the simpler option, so that's what shipped. The rail
dot's title and the overview's status line both still append a "note" /
"· Note" text marker, so it's distinguishable on inspection even though
the shape is shared.

**A live-verification lesson worth recording:** the first pass at the
final M13 Verify used a Playwright selector that matched a highlight's
margin-rail dot by *substring* on its title (`title.includes("White
Rabbit")`). The shared dev library's Alice fixture already had two
unrelated pre-existing "White Rabbit" highlights left over from M3/M5
sessions, so the substring match silently grabbed the wrong one and wrote
a test note into real fixture data instead of the freshly-created test
highlight. Caught it by cross-checking the API response by highlight *id*
after the fact, not by anything failing loudly — the UI-level checks all
looked correct because the note feature itself worked fine, just against
the wrong target. Fixed by re-running with a highlight given deliberately
unique marker text and matched via the DOM's *exact* `aria-label`
(`[aria-label="Go to highlight: ${MARKER}"]`) instead of a substring, and
cleaned up both the accidental note on the pre-existing fixture highlight
and the synthetic test highlights afterward — shared dev database left as
found, same discipline as M9's tag/star cleanup. Lesson: any Playwright
check against this shared, accumulating dev library should match by a
unique marker + exact selector, never by a substring that could coincide
with years of prior sessions' leftover data.

Compiler boundary required no code changes — `compiler.ts` already only
ever reads highlights via `h.thread !== null && h.thread.hasAnswer`, so a
note-only highlight was already filtered out before extraction. Added a
regression test asserting exactly that (`compiler.test.ts`) rather than
leaving it as an unverified code-reading claim.

## M14 — reading surface revisions

Found this milestone already implemented, uncommitted, in the working tree at the
start of this session (an earlier session's interrupted pass — all five tasks'
production code, migrations, and unit tests were present and green, but none of
TASKS.md's boxes were checked and nothing was committed). Treated it as "resume
verifying M14": code-reviewed the diff against SPEC/decisions.md, then live-verified
every acceptance bullet against the real Metamorphosis fixture via `pnpm dev` +
an ad hoc Playwright install in the scratchpad (same method as M8-M13), rather than
re-implementing anything that already matched the spec.

**Customisable margins, the dial, and killing the crease bars** all matched their
acceptance text on first live pass — no changes needed. One methodology note: testing
the spread-mode spine-gutter independence requires an actual page **reload** after
changing `spreadMode`, not just a live settings save — `spreadMode` is read once by
`ReaderPage` before `ReaderView` mounts (M12), so flipping it via the Settings modal
alone (which stays mounted underneath per M11) never applies the new value. The first
pass at this check flipped the setting without reloading and appeared to show the
spine gutter changing with the margin setting (a false alarm — it was still measuring
single-page gap math the whole time, since spread mode had never actually engaged).
Reloading after the `spreadMode` change and re-measuring showed the real, correct
behavior: a constant 64px `column-gap` regardless of margin.

**Sticky-note panels** verified cleanly: drag by the header, offset persists via
`PUT /api/highlights/:id/panel-offset`, survives a reload pixel-for-pixel.

**Fullscreen mode had two real, live-reproduced bugs**, both in the reveal-band
geometry (not present in the other four tasks, and not inherited from any earlier
milestone — this is new M14 code):

1. **The reveal bands' math was self-defeating.** The iframe-forwarded `mousemove`
   handler (the same `rendition.on("mousemove")` mechanism M11's turn-zone cursor
   uses) computed "near top/bottom" against `containerRect.height` — but the
   container element (`epubContainer`) is taller than the iframe's own rendered
   content by roughly 145px in this layout (extra vertical space epub.js reserves
   for pagination), so `visibleY` (built from iframe-local `event.clientY`) could
   *never* reach a `containerRect.height - 72` threshold from anywhere inside the
   iframe — the footer literally could not be revealed by hovering the page.
   Separately, the parent-document dead zone above/below/beside the iframe (exactly
   where the floating chrome panels themselves sit before they're revealed, and
   where a `pointer-events: none` element can't catch its own reveal-triggering
   hover) had no listener watching it at all — so a cold hover at the literal top
   edge of the screen did nothing, and once a reveal *did* trigger from genuine
   iframe hover, it never cleared again after the cursor left the iframe (no more
   events arrive from outside it to update the state — a "stuck open" bug).
   Diagnosed via a raw injected `pointermove` logger plus direct
   `getBoundingClientRect()` reads on the iframe vs. its container before writing
   any fix, not guessed at. Fixed two ways together: (a) switched the
   iframe-forwarded computation to true viewport coordinates
   (`iframeRect.top + event.clientY` compared against `window.innerHeight`, not
   `containerRect.height`), and (b) added a second, plain `window`-level
   `mousemove` listener — active only while `fullscreenMode` is true — using the
   identical viewport thresholds, which covers the dead zone the iframe-forwarded
   path structurally cannot reach. Confirmed live, before and after: top, bottom,
   and the rail's top-right corner all now reveal on approach and un-reveal on
   leaving, from a cold start, in both the "hovering the page" and "hovering the
   dead zone" cases.
2. **"The reading pane grows into the freed space" didn't happen.** `--reader-max-width`
   stayed pinned at 800px (or 1400px in spread mode) regardless of `fullscreenMode` —
   chrome hid, but the page itself never grew, contradicting the decisions.md text
   directly. Fixed by widening the cap to 1600px specifically under `fullscreenMode`.
   This only widens the *stage*; `computeReaderGap`'s own column-width cap
   (`READER_TARGET_COLUMN_WIDTH`) keeps the actual rendered text measure unchanged
   regardless of stage width, so the practical effect is more comfortable
   surrounding whitespace, not wider — and therefore less readable — lines.
   Confirmed via screenshot comparison before/after.

**A verification-method limitation worth recording**, not a product bug: attempting to
prove the pointer-lock dial can sweep past what absolute on-screen travel would allow
by driving real relative motion via Playwright's synthetic mouse input under Pointer
Lock produced inconsistent, sometimes self-canceling `movementX` values (confirmed via
a raw event logger) — a known limitation of automating this specific browser API with
CDP-driven input, not a sign the implementation is wrong. The code path itself (switch
from absolute `clientX - startX` math to accumulating `movementX` only once lock is
confirmed engaged, explicitly skipping the fold-in on the very first locked frame to
avoid a jump) was code-reviewed and matches the acceptance text; what couldn't be
independently re-confirmed live is specifically the "reaches 0%/100% from any starting
position" claim, since that depends on real hardware-sourced relative motion. Everything
else about the dial (pointer lock actually engaging and cleanly releasing on both
mouseup and a mid-drag Escape, the centered layout, the keyboard path) was confirmed
live.

Also hit, again, a milder version of M10's known sandboxed-iframe automation crash: a
raw *drag*-based text selection (mouse down outside/at the edge of the iframe, then
move across it) reliably crashed the headless tab with "Blocked script execution in
'about:srcdoc' because the document's frame is sandboxed" — reproduced identically with
fullscreen mode completely uninvolved, so it isn't an M14 regression, just this
environment's Playwright/Chromium combination disliking synthetic drag gestures that
touch the sandboxed iframe. A double-click word-selection (no drag) doesn't trigger it
and was used instead to confirm the Ask pill still appears correctly in fullscreen mode.

### Verification method

Real `pnpm dev`, driven by an ad hoc Playwright install in the scratchpad (not a
project dependency, same as M8-M13), headless Chromium, against the real Metamorphosis
fixture:
- Margins: measured the actual rendered gap in pixels at each of the four settings,
  confirmed it survives a reload, and confirmed the spread-mode spine gutter stays
  fixed at 64px independent of the margin setting (after correcting the reload
  methodology mistake described above).
- Dial: confirmed pointer lock is genuinely requested and granted
  (`document.pointerLockElement`), confirmed clean release on both mouseup and Escape,
  confirmed a mid-drag Escape leaves the committed value provably unchanged, and
  confirmed the keyboard path (arrows open without committing, Enter commits).
- Crease bars: confirmed zero `.creases` elements render while `.grain` and the folded
  corner still do, via a live screenshot.
- Sticky-note panels: dragged a real panel, confirmed the server-persisted offset by
  id, confirmed a full reload reopens at the identical pixel position.
- Fullscreen: confirmed entry/exit (including via the real Fullscreen API), the two
  bugs above (found via direct `getBoundingClientRect()`/viewport measurement, not
  guessed at), `f`/`shift+F` composing together, text selection + Ask pill still
  working (via double-click, per the automation limitation above), and keyboard-only
  reveal via `:focus-within`.
- Cleaned up afterward: `readerMargin` back to "normal", `spreadMode` back to
  "single", and the dragged highlight's `panelDx`/`panelDy` back to `{0, 0}` on the
  shared dev database.

## M15 — the Scan instrument

Two SPEC-GAPs from this milestone, both deliberate boring choices, not oversights:

1. **Chapter titles only come from the EPUB2 NCX (`toc.ncx`), not EPUB3
   `nav.xhtml`.** Real chapter names needed *something* server-side to parse — nothing
   existed before this milestone, the scan deliberately never loads epub.js
   (`buildScanData`'s whole point is instant load without touching it). Both fixtures,
   and every real book imported into this dev environment so far, are Gutenberg-style
   EPUB2 with an NCX. A book that only ships an EPUB3 nav document gets numbers with no
   names — exactly the toggle's own documented fallback, not a crash — so this degrades
   safely rather than needing to be caught before it ships. Worth adding if a real EPUB3
   book without an NCX shows up.
2. **The CRT barrel warp isn't a mathematically correct outward bulge.** The decisions
   entry specifically asks for `feDisplacementMap` "driven by a radial gradient." A true
   lens-bulge needs the x and y displacement channels driven by two *different*
   direction-aware gradients (something that pushes right on the right half and left on
   the left half, and separately up/down top/bottom) — that's not expressible with a
   single native SVG `<radialGradient>`, which is grayscale and radially symmetric by
   definition. Feeding that same symmetric value into both the R (x) and G (y) channels
   means every pixel's displacement vector is diagonal, not radial — so the strip bows
   more at the edges than the center (the actual visual ask) with a slight diagonal skew
   rather than a clean lens effect. Combined with the bloom and vignette it reads as CRT
   distortion at a glance; a mathematically correct version would need a hand-built
   two-channel gradient image (e.g. rendered once to an offscreen canvas and supplied
   via `feImage`), which felt like real engineering for an effect whose own spec caps it
   at "subtle."

The bleeding heat field's technique is worth recording since it's reused wherever a
future density-style effect is needed: paint every point as a *same-colored* radial
blob with `globalCompositeOperation: "lighter"` onto an offscreen canvas — because
every blob is identical in color, additive blending can only grow the alpha channel
(clamped at 1), so the offscreen canvas's alpha channel *is* a real 0-1 density field
with no color math needed in the accumulation pass. A second pass walks the pixel
buffer converting density → a cool→hot color via a small stop-based ramp and uses the
density itself as final opacity, then `putImageData`s straight onto the visible canvas
(bypassing any composite mode, so there's no double-blending against whatever was
already drawn). This is cheap enough to redraw on every filter change or resize without
a frame-budget concern, since it only ever runs on data change, not per animation frame.

### Verification method

Real `pnpm dev` (a second, unrelated dev server instance from an earlier session was
already running on this box and kept serving `/api` throughout — this session's own
`pnpm dev` invocation lost the port race, which is why the confirmed pass below used
whichever instance held :5175; both were running this session's code via `tsx watch`'s
hot reload either way), driven by an ad hoc `playwright-core` install in the scratchpad
(not a project dependency — browsers were already cached from a prior `npx playwright
install`), headless Chromium:
- Re-imported the real Metamorphosis fixture with one extra harmless zip entry added
  (a distinct sha256 → a genuinely new, separately-cleaned-up resource) specifically so
  it would pick up this session's new NCX chapter-title extraction — the existing
  fixture resources in the shared dev library predate that code (immutable-on-import).
- Seeded 6 real highlights via the actual `POST /api/highlights` API (4 tightly
  clustered, 2 isolated) and varied thread depth by inserting `messages` rows directly
  (0/2/4/8 per highlight) — skipped a real LLM round trip since only the *count* was
  needed to exercise the heat field's weight calculation, not real answer content.
- Confirmed via `page.evaluate` reading real computed styles and canvas pixel data, not
  just element presence: `.page`'s computed `max-width` is `none` at a 1400px viewport;
  the graphics layer's computed `filter` resolves to a real `url(#...)` normally and to
  `none` under `reducedMotion: "reduce"`; the heat canvas holds thousands of non-zero-
  alpha pixels both with and without reduced motion; a kind filter both toggled the
  `.dimmed` class on 5/6 bands *and* measurably lowered the canvas's bright-pixel count
  (9905 → 7216), confirming the field genuinely redraws on filter state rather than only
  on first paint.
- Chapter axis: confirmed the default view's tick labels are plain numbers, and that
  clicking the "№/Names" toggle live-swaps them for the real NCX titles ("I", "II",
  "III") pulled from the freshly-imported resource's `chapterTitles` metadata.
- Interaction regressions: hovered a clustered band (readout appeared, matching v1.5)
  and clicked an isolated one (navigated into the reader via the airlock, matching
  v1.5) — had to move the pointer away from the first hover before the second click,
  since a hover readout's own tag-input field can sit on top of an immediately adjacent
  clustered band at this fixture's real spacing; not a regression this session
  introduced (the bands' hit-target geometry is unchanged from M9), just a real
  precondition for testing two clustered bands back to back.
- Cleaned up afterward: deleted the seeded highlights/threads/messages, the resource
  row, and its stored `.epub` file directly from the shared dev database and
  `data/library/` — library confirmed back to its original 4 resources.

## M16 — reading QOL & bug fixes

Two SPEC-GAPs worth recording, both real deviations from the task's literal wording,
made deliberately rather than by oversight:

1. **"Highlights pop on hover" is JS-driven, not a CSS `:hover` rule.** The task and
   decisions.md both assumed an ordinary stylesheet rule targeting
   `.marginalia-highlight:hover` would work since the mark's presentation attributes
   lose to any real CSS rule. Verified live (an isolated pointer-events probe, not
   just read the epub.js/marks-pane source) that this premise has a hole: the
   marks-pane SVG root carries `pointer-events="none"` as a deliberate, load-bearing
   attribute (removing it would let the overlay intercept mousedown over highlighted
   text and kill native text selection there — exactly the regression M11's turn-zone
   vignette rule and this task's own "hovering does not interfere with selecting text"
   acceptance bullet both guard against). `pointer-events` is CSS-inherited, and
   marks-pane never re-declares it on the `<g>`/`<rect>` marks, so the browser's
   hit-testing skips them entirely — confirmed with a minimal `page.setContent()`
   repro: `element.matches(':hover')` and `elementFromPoint` both prove real cursor
   movement never reaches the mark at all, only a synthetic click clone via
   marks-pane's own `proxyMouse` (which doesn't even proxy `mousemove`). Real `:hover`
   genuinely cannot fire here without re-enabling pointer-events on the mark, which
   reintroduces the selection-breaking regression. Fix: extended the *existing*
   forwarded-mousemove handler (`handleContentMouseMove`, already used for M11's
   turn-zone cursor) to geometrically hit-test the cursor against each rendered mark's
   own `getBoundingClientRect()` and apply/clear a plain inline `fill-opacity`/
   `mix-blend-mode` override directly — same "attribute styling only" architecture
   `highlightKinds.ts` already documents, just triggered by JS instead of a pseudo-
   class. A `.marginalia-highlight { transition: fill-opacity ... }` global rule
   (`ReaderView.module.css`) makes the JS-driven change animate instead of snap;
   `prefers-reduced-motion`'s existing blanket `*` transition-duration override in
   `theme.css` covers it for free, no extra gating needed. Focus mode is respected for
   free too: the hidden style sets `fill: transparent`, and the hover boost only ever
   touches `fill-opacity`, so a transparent fill stays invisible at any opacity.
2. **Max response length only governs the thread-answer path, not `extract()`.**
   `THREAD_MAX_TOKENS` (named in the task) was actually two different budgets sharing
   one constant by coincidence — the thread-answer `stream()` ceiling *and*
   `extract()`'s structured-output ceiling (vault distillation, and pass 1 of the
   future M17 digest). The task's own acceptance criteria only ever talks about
   "answers" being shortened; a low answer-length setting silently truncating
   `extract()`'s JSON output would corrupt vault publishing, which nothing asked for.
   Split into a persisted `maxResponseTokens` setting (only wired into `stream()`) and
   a fixed `EXTRACT_MAX_TOKENS = 8192` constant left exactly as it was, in both
   `anthropic.ts` and `openaiCompat.ts`.

### The margin-relayout bug — root cause, found live, not guessed

The task explicitly forbade guessing between its two named candidates. Diagnosed with
a real `pnpm dev` + Playwright pass against the Metamorphosis fixture, reading actual
computed styles before/after a live Settings-driven margin change (isolated from the
Settings modal's own scrollbar-toggling side effect by taking the "after" measurement
*while the modal was still open*, so only the margin state change itself could be the
cause): the CSS gap/padding recompute (`computeReaderGap` → `manager.settings.gap` →
`manager.updateLayout()`) was already working correctly and instantly — neither
candidate (a dead ResizeObserver, or `updateLayout()` not re-running `columns()`) was
actually true. The real bug is a third thing, only visible once you're a few pages
into the book (not sitting at CFI/scrollLeft 0): `updateLayout()` recomputes the
column geometry but never repositions the iframe's own horizontal scroll offset for
it, so the *old* pixel offset — correct under the old, narrower gap — now lands
mid-column under the new one. Screenshotted the actual failure: the reader rendered
two adjacent column-halves at once, text cut off on both edges, a genuinely broken
page, even though every computed CSS value was already correct. Confirmed this is
exactly why M11's own live-resize verification never caught it — that test happened
from the book's first page (scrollLeft always 0, which stays valid under any column
width), never from mid-book. Fixed with the task's own documented "known-good
fallback": track the current CFI (`currentCfiRef`, updated from the existing
`relocated` handler) and `rendition.display(currentCfiRef.current)` after the gap
mutation, debounced ~120ms so a continuous window drag-resize settles once instead of
re-displaying on every intermediate tick. Re-verified the identical live repro
afterward — clean single-column render, correct new margin, no navigation needed.

### Reading text size — coupled to the same gap machinery

`readerFontScale` reuses `rendition.themes.fontSize()` (the sanctioned epub.js API,
confirmed via source it patches already-rendered contents immediately, not just future
ones) and, since `READER_TARGET_COLUMN_WIDTH` is only "~70ch at 16px", feeds into
`computeReaderGap` the same way `readerMargin` does — including the exact same
redisplay-after-relayout fix above, since a font-scale change moves the target column
width without the container's own box size ever changing (so the ResizeObserver that
margin changes ride for free has nothing to fire on). Factored the gap-apply +
debounced-redisplay logic out of `handleContainerResize` into `applyGapForWidth`,
reached from a dedicated `readerFontScale` effect via `applyGapForWidthRef` — the same
"expose an effect-internal function via a ref" pattern `turnPageRef`/`chapterJumpRef`
already use.

### Verification method

Real `pnpm dev` (server :5175, web :5176 — :5173-5175's web ports were already held by
orphaned `vite` processes from an earlier, unrelated session; left them alone, just
used whichever port my own instance actually bound), driven by an ad hoc
`playwright-core` install pointed at this box's already-cached Chromium
(`~/.cache/ms-playwright/chromium-1234`, a newer revision than the globally-installed
`playwright-core` expected — passed `executablePath` explicitly rather than
re-downloading), headless, against the real Metamorphosis fixture and its real
accumulated highlights from prior sessions' live testing:
- Arrow-key-after-drag: a real pointer drag-scrub + release, then confirmed
  `document.activeElement` is `<body>` (not the button) and that a subsequent
  `ArrowRight` changes the committed `%` (a real page turn, not a frozen dial preview)
  — and, separately, that an explicit `.focus()` onto the button (the real keyboard
  path) leaves the committed `%` *frozen* through `ArrowRight` and only changes it on
  `Enter`, confirming both halves of the acceptance criterion, not just one.
- Highlight hover: moved the real mouse onto a live mark's actual on-screen
  `getBoundingClientRect()` (had to filter for a mark that's actually within the
  visible page — epub.js's paginated flow renders a whole section as one wide
  multi-column canvas, so plenty of a section's marks sit at large negative/
  out-of-viewport x at any given scroll position, which is a test-harness gotcha, not
  a bug) and confirmed the inline `fill-opacity`/`mix-blend-mode` override applies and
  reverts; separately confirmed it stays inert (computed `fill: rgba(0,0,0,0)`) while
  focus mode is on.
- Margin colour: confirmed programmatically in both themes (not just visually) that
  `.stage`'s and the epub body's computed `background-color` are now byte-identical.
- Text size: confirmed live (after catching a real test-harness gotcha — setting a
  React-controlled `<input type="range">`'s `.value` directly doesn't register with
  React's change tracking; has to go through the native value setter, same fix as any
  React Testing Library-style harness needs) that font-size actually scales
  (16px → 22.4px at 140%), the column width shrinks to compensate (chars/line stayed
  at the 60ch floor rather than drifting past 75), and zero highlights went
  unanchored.
- Max response length: live against the real configured local Ollama endpoint
  (openai-compatible, qwen3.5-hermes) — a very low ceiling (30, then 80, then 300
  tokens) produced an *empty* answer every time, while the default 8192 produced a
  normal ~270-character one on the identical question. Initially expected a visibly
  *truncated-but-present* sentence rather than emptiness — this model spends its
  `max_tokens` budget on internal reasoning tokens before any visible output, so a
  low-but-real ceiling exhausts before anything reaches the `stream()` output. Still
  conclusive proof the setting reaches the real API call (0 chars vs. a full answer at
  the same question), just a more dramatic demonstration than a gently clipped
  sentence — not chased further since the mechanism (does the parameter reach the
  request body and change behavior) is what needed proving, not this particular
  model's token-budgeting internals.
- Settings UI: screenshotted the new "Max response length" and "Text size" fields in
  Paper theme (both render correctly, including the per-provider enforcement-vs-request
  hint text switching correctly between the claude-agent and token-metered providers);
  the Read tool serving screenshots back into this session became unavailable partway
  through (infrastructure issue, unrelated to the app) after that first screenshot, so
  the Ink-theme settings pass fell back to the same programmatic computed-style check
  used for the reader's margin colour rather than a second screenshot — every new
  Settings field reuses existing, already dark-mode-audited shared classes
  (`styles.field/label/input/hint`) and a plain `<input type="range">` identical in
  kind to the pre-existing CRT-intensity slider, so this is a low-risk gap, not a
  skipped check on anything novel.
- All fixes' underlying settings restored to their pre-session defaults on the shared
  dev database afterward (`readerMargin: "normal"`, `readerFontScale: 1`,
  `maxResponseTokens: 8192`, `spreadMode` left as found); the two test highlights
  created for the max-response-length check were deleted (cascading their threads).

## M17 — the book digest & AI context

- **No live LLM available in this session.** No `claude` CLI binary on this
  machine, no API key configured, and no pre-existing `data/` directory (a
  fresh checkout — the two-machine setup means dev data lives per-machine,
  gitignored). Every M17 task below is unit-tested and type-checked but the
  live-provider verification steps in TASKS.md's acceptance criteria
  (real spoiler-avoidance behavior, real chapter-citing answers, a real
  digest run against a live model) could not be run in this environment.
  Treat those as outstanding until a session with a configured provider
  drives them for real — same caveat M4 hit with the Anthropic path.
- **Reading position: captured client-side, not parsed from CFI server-side.**
  The obvious server-side approach — parse `spineIndex` out of the stored CFI
  string directly (`epubcfi(/6/N!/4/2)`) — was rejected: the N-to-spineIndex
  mapping depends on the package document's own idref ordering, which is
  exactly what epub.js's `EpubCFI` class resolves against the book's spine at
  runtime. Reimplementing that server-side without the manifest context risks
  a silent off-by-one that only shows up on some books (echoes the M9 "stale
  spineIndex" and "duplicate text disambiguation" bugs in this same class of
  problem). Boring fix: capture `spineIndex`/`percent` once, client-side, at
  the exact point the reader already computes them precisely (the
  `relocated` handler — the same values already driving the progress %
  readout) and persist them alongside the CFI. Additive migration v7,
  both columns nullable so old rows/un-generated-locations just mean
  "position unknown" rather than a broken read.
- **Cache-safety of the position line was worth a dedicated test**, not just
  code review: `context.test.ts` asserts the reading-position value never
  appears in `bookContext` or `instructions` — only in the per-question user
  message. Anthropic's prompt caching matches on the literal prefix bytes of
  the `system` array, and `instructions` sits *before* the cached
  `bookContext` block in that array — so volatile content in `instructions`
  would have silently broken caching on every book, every question, forever,
  and nothing except a cache-hit-rate regression over time would have shown
  it. Easy to get wrong by "reasoning it should be fine since it's just a
  short instruction line" instead of tracing where the cache breakpoint
  actually sits.
- **`context_note` built as a small generic mechanism, not a one-off boolean.**
  The windowing-notice task needed exactly one string attached to an answer;
  the later "answer transparency" task (context depth + chapters used) will
  want richer per-answer metadata. Rather than ship a throwaway `windowed:
  boolean` now and a separate mechanism later, `messages.context_note` is a
  free-text column any future task can extend or compose into (a JSON blob
  column is a legitimate later migration if transparency needs structure
  beyond one string — not pre-built now since YAGNI, but flagged here so a
  future session doesn't reinvent the "attach a note to an answer" wiring
  from scratch).

### M17 — usage accounting

- **No local tokenizer dependency exists in this project.** Checked both
  `@anthropic-ai/sdk` and `@anthropic-ai/claude-agent-sdk`'s installed
  packages for a bundled offline tokenizer (older Anthropic SDKs shipped
  one) — neither has one. Decisions.md's three-tier provenance
  (`reported`/`measured`/`estimated`) therefore only ever produces
  `reported` or `estimated` in this codebase; `measured` stays a real,
  reachable value in the type (forward-compatible) but nothing writes it.
  Adding a tokenizer package to close this gap is a real dependency
  decision, not a "boring choice" this task should make unilaterally —
  flagging it here for a design session to decide on, rather than either
  silently mislabeling `estimated` as `measured` or quietly adding a new
  dependency.
- **Anthropic `anthropic-ratelimit-*` response headers not wired in.**
  `client.messages.stream()` doesn't expose raw response headers without
  switching to the SDK's `.withResponse()` variant, which would touch the
  streaming call shape more than this task's scope justified given
  `finalMessage.usage` already delivers real reported token counts (the
  core of "reported" provenance). Revisit if a future session specifically
  wants rate-limit-header-derived plan-limit info on the API-key path (today
  only the `claude-agent` subscription path has any plan-limit surfacing at
  all).
- ~~**`ClaudeAgentProvider.planLimits()`'s core assumption is unverified.**~~
  **Resolved 2026-07-28 (M17.5 session) — the assumption is false.** Drove a
  real `stream()` call to completion against the live subscription provider,
  then called `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`
  on that *same, already-completed* `Query` object: it throws `Error:
  ProcessTransport is not ready for writing`. The control channel does
  **not** survive past the async generator finishing — the subprocess tears
  itself down on natural completion (which also corroborates the M17.5
  digest-subprocess finding: no leaked processes after a run, because the
  SDK really does close things on its own). Caught by `planLimits()`'s own
  try/catch, so this degrades exactly as designed (`null` → "plan limits
  unavailable") rather than crashing — but it means `planLimits()` has
  never once returned real data via any live code path, and structurally
  can't with the current `lastQuery`-after-completion design. Compounding
  this: the only real caller, `GET /:id/digest/preflight`
  (`server/src/routes/digest.ts`), constructs its **own fresh** provider
  that has never made a prior call — so `lastQuery` is `null` there before
  even reaching the transport question, making the usage-display feature a
  no-op in production today regardless of the transport behavior above. Not
  fixed here (out of scope for M17.5's named tasks and not something this
  correction should turn into a drive-by fix) — a real follow-up for
  whichever session next touches usage accounting: either call
  `planLimits()` right after a real `stream()`/`extract()` in the *same*
  request that made it (e.g. surfaced alongside a thread answer, not from a
  separate settings/preflight request), or drop the feature until there's a
  design that can actually reach a live control channel.
- **Context-window readout is SSE-only, not persisted with the message.**
  `ContextUsage` rides the `done` event and lives in a client-side
  `contextUsageByMessageId` map that's populated only by a live stream
  completion — reloading a thread's history does *not* re-show it, by
  design: decisions.md names the `llm_usage` ledger as the durable source of
  truth, and duplicating that per-message would be a second, driftable copy
  of the same fact. If a future session decides per-message historical
  display matters, the boring extension is another nullable `messages`
  column (same pattern as `context_note`) rather than re-deriving it from
  the ledger at read time.

### M17 — live verification against a real local model — 2026-07-28 (Sonnet)

A prior session in this same machine's history had already committed the
server-side digest work and built (uncommitted) the web UI half — spotlight,
digest page, context-ladder toggle, reader shortcut. This session committed
that UI, then ran the full milestone's live verification against the dev
`data/` directory's real Metamorphosis fixture through a local Ollama
endpoint (`qwen3.5-hermes`, a reasoning/"thinking" model).

- **The digest page and Desk hover strip didn't actually link to each
  other.** Decisions.md says the digest page should be "reachable from the
  desk alongside the scan (and from the reader)" — the built UI only linked
  it from the Scan page. Added a "Read digest" action to the Desk's
  `BookObject` hover strip and a "Digest" link to the reader's title bar
  (`ReaderPage.tsx`/`.module.css`), matching the existing "Open scan"/"Scan"
  pattern in both places.
- **A full 5-chapter digest + reduce genuinely completed end-to-end** against
  the live local model, confirming resumability for real (not just in unit
  tests): three separate runs (chapters 0–1 pre-existing, then 2, then 3–4)
  each left previously-digested chapters' `generatedAt` timestamps
  untouched, and the book-level reduce regenerated after each run so the
  synopsis/cast/themes always reflected everything digested so far — by the
  final run the cast correctly grew to include the Charwoman and Lodgers
  (only introduced in the book's back half) and themes gained "Death" and
  "Sacrifice".
- **This specific local reasoning model is slow enough to make the digest
  genuinely fragile against Node's default fetch timeout.** A single chapter
  (~8 map/merge calls at the configured 8192-token budget) took 12–15
  minutes wall-clock; a 3-chapter batch in one `POST /digest` call
  reproducibly failed with `LLMError('network', 'fetch failed')` twice in a
  row, with zero of the three chapters committed. Root cause, confirmed by
  testing the model directly against Ollama's own `/api/generate`: even a
  trivial "say OK" prompt takes 16–18s because the model emits a long
  chain-of-thought before its answer, and a real chapter chunk's `max_tokens:
  8192` budget gives it room to think far longer than that — long enough for
  a single `extract()` call to plausibly exceed undici's default 300s
  headers/body timeout, which `fetch` surfaces as a bare "fetch failed" with
  no code-level distinction from a real connectivity failure. Splitting the
  request into smaller ranges (one chapter at a time) worked reliably.
  Two real, related gaps this surfaced, not fixed here (out of scope for a
  verification pass, flagged for a future task):
  - `openaiCompat.ts`'s `extract()` never wires up an `AbortSignal` or an
    explicit timeout at all (the digest spotlight's own comment already
    flags no cancellation seam for this reason) — a slow local model has no
    way to be given more patience than undici's hardcoded default, and no
    way to be cancelled mid-call either.
  - The thrown `LLMError('network', ...)` only keeps `err.message` (often
    the unhelpful generic `"fetch failed"`); `err.cause` — where undici puts
    the actual `UND_ERR_HEADERS_TIMEOUT`/`UND_ERR_BODY_TIMEOUT`/etc. — is
    dropped, so the server log gives no way to tell a timeout apart from a
    DNS failure or a refused connection without attaching a debugger.
- **Digest-level context can exceed the configured context window for a
  short book.** A live follow-up question at Digest level reported
  `tokensUsed: 11061` against `windowTokens: 8192` (135%, `reported`
  provenance) — `buildDigestContext` (unlike `buildContext`) isn't passed
  `contextTokens` at all and doesn't budget against it; it just assembles
  "digest of the covering chapters" (here, all 5, since Metamorphosis is
  short) plus a surrounding-pages window unconditionally. For a short book
  digested in full this can rival or exceed a small local model's window.
  Not treated as a bug worth fixing in this pass — the answer was still
  correct and the ledger honestly reported the real number rather than
  hiding it — but a future session should decide whether Digest level needs
  its own budget ceiling the way Full does.
- **No live Full-level comparison was completed.** The plan was to ask the
  same question at Digest and Full and compare token cost — got a real
  Digest-level data point (above), but the Full-level call was still running
  against the local model many minutes later, visibly loading the GPU, when
  the operator flagged it as likely not worth the wait; killed it
  (confirmed clean: the SSE abort-on-disconnect path left no dangling
  partial message, per the M6 fix). The three-level, three-question
  comparison TASKS.md's M17 Verify step asks for is still genuinely
  undone — do it with a fast/hosted provider, not this local model.
- **Operator's workflow idea, worth a real design decision later:** use a
  fast/cheap hosted provider (their `claude-agent` subscription, or a paid
  API) for the one-time digest pass, then a local model for cheap
  interactive per-question answering against that digest. Architecturally
  sound and exactly the cost story M17 is going for, but **not supported
  today** — `getProvider(db, operation)`'s `operation` parameter only labels
  the usage ledger row; there is one global `settings.provider` used for
  every operation (thread, extract, digest, cast). Splitting providers per
  operation would need its own settings surface and is a real scope
  decision, not a boring default — flagging for a future decisions.md entry
  rather than building it unilaterally here.
- **Found and cleaned up 5 stacked leftover `pnpm dev` process trees** from
  earlier sessions never having been stopped (only the newest server/web
  pair was actually bound to the ports; the rest were orphaned zombies).
  Also hit a live instance of the harness stopping this session's own
  background dev-server/monitor tasks mid-verification (visible as
  `SIGTERM` in the `tsx watch`/`vite` output) — the dev server had to be
  restarted once mid-session; the digest data itself was unaffected since it
  lives in SQLite, independent of the server process.

## M17.5 — performance & responsiveness

⚠️ **Environment caveat, upfront:** this session runs on the rig itself, not
over the operator's actual `ssh -L` tunnel from ~20km away. Every timing
number below is therefore local — real for request count / transfer size
(the mechanism the 2026-07-29 decisions entry blames), but it cannot
reproduce the tunnel's own latency/multiplexing behavior. Treat the ms
columns as a lower bound, not the operator's real experience; request count
and transfer size are the numbers that actually transfer to the tunnel.

### Baseline (measured, not guessed)

Real headless-Chromium (Playwright) passes against the actual running dev
server, immediately followed by the same passes against a real production
build served single-origin. All local, no tunnel.

| Flow | Dev: requests | Dev: transfer | Dev: time | Prod: requests | Prod: transfer | Prod: time |
|---|---|---|---|---|---|---|
| Desk (cold) | 52 | 2.92 MB | 818 ms | 16 | 0.78 MB | 619 ms |
| Settings | 59 | 2.51 MB | 741 ms | 20 | 0.46 MB | 566 ms |
| Reader | 107 | 7.80 MB | 1090 ms | 43 | 3.04 MB | 812 ms |

Production is 2.5–5.5× fewer requests and 2.6–5.5× less transfer per flow —
consistent with the 2026-07-29 decisions entry's back-of-envelope ratio.
Local time-to-interactive barely moves (both are under a tunnel-free
second), which is exactly the point: the ms column is dominated by round
trips a fast local network doesn't charge for, but an `ssh -L` tunnel's
per-channel flow control does. Method: `web/measure.mjs`-style script (not
committed — throwaway), Playwright `chromium`, `page.goto(..., {waitUntil:
"networkidle"})`, summing `response.body()` lengths.

### `pnpm start` — and a bug the M17.5 measurement immediately found

Added `"start": "pnpm build && NODE_ENV=production pnpm --filter
@marginalia/server start"` to the root `package.json`. First real run of
this path (it existed since early on but had never actually been exercised
— that's the whole premise of this milestone) crashed immediately:

```
PathError [TypeError]: Missing parameter name at index 1: *
```

Express 5's router (`path-to-regexp` v8) dropped the bare `"*"` SPA-fallback
wildcard; it now requires a named splat (`"/*splat"`). Fixed in
`server/src/index.ts`. This is a good example of exactly what this
milestone is for: a code path with zero live coverage (`NODE_ENV=production`
was set nowhere) had been silently broken since whenever Express 5 landed,
and the bug only surfaces the moment someone actually serves the built app.
Re-verified after the fix: `pnpm start` on a scratch port serves `/`,
`/read/:id` deep links, and static assets correctly (200s across the board),
and the Playwright pass above ran clean against it.

### The stray Vite — found live, not hypothetical

While starting this milestone, two full `pnpm dev` trees were already
running in this environment (ports 5173 *and* 5174 both `LISTEN`) — the
exact symptom the 2026-07-29 decisions entry flagged as unexplained. Root
cause, confirmed by direct reproduction (`npx vite --port 5174` against the
already-occupied port): Vite's default `server.strictPort` is `false`, so
when a stale process still holds 5173, a second `pnpm dev` doesn't error —
it silently binds 5174 instead. A tunnel forwarded to 5173 then points at a
dead or stale instance while a live one runs one port over, with nothing in
the log to say so.

Fix: `strictPort: true` in `web/vite.config.ts`. Re-verified: pointing a
second Vite at an occupied port now fails loudly (`Error: Port 5174 is
already in use`, non-zero exit) instead of silently drifting to the next
one. The two live stray trees found in this environment were themselves
leftover `pnpm dev` invocations from earlier sessions that were never
stopped — cleaned up as part of this investigation (with the operator's
confirmation), not a code bug on their own, but `strictPort` means the next
occurrence is loud instead of invisible.

### Client render profiling — no storm found

Instrumented (Playwright `addInitScript`, not shipped code) a
`PerformanceObserver` for `longtask` entries plus a `MutationObserver`
sampling idle DOM churn for 3s with zero user interaction, run against the
production build for: Desk cold load, Settings modal open, Reader open,
Scan open, and opening a real ThreadPanel via an existing highlight's margin
dot (all five are named or implied by this milestone's task, including the
components M17 touched — ThreadPanel, ScanPage, ReaderView).

| Surface | Long tasks | Total long-task time | Idle mutations (3s, no input) |
|---|---|---|---|
| Desk | 0 | 0 ms | 0 |
| Settings modal | 0 | 0 ms | 0 |
| Reader open | 1 | 57 ms | 4 |
| Scan open | 1 | 80 ms | 0 |
| Thread panel open | 0 | 0 ms | 0 |

No re-render storm anywhere: at most one sub-100ms long task per surface
(plausibly epub.js layout / canvas scanline setup, not React), and
essentially zero DOM churn once settled. Per this task's own acceptance
criterion ("named, measured wins, **or** an explicit recorded finding that
client render time was not a significant contributor") — this is the
latter. No memoization added; there was nothing the profile asked for.

### Digest subprocess / event-loop behaviour — verified live, corrected

**First pass in this session got this wrong.** It reported `which claude` →
not found and concluded the claude-agent-specific subprocess question
couldn't be tested here, verifying only the provider-agnostic half via
Ollama. The operator flagged this as surprising (they'd used the Claude
subscription through Marginalia before), which was the right instinct:
`which` only checks `PATH`. The Agent SDK vendors its own per-platform
`claude` binary as an npm dependency
(`node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-linux-x64@.../claude`,
confirmed via `manifest.json`'s per-platform binary table), and this machine
already carries real subscription credentials
(`~/.claude/.credentials.json`) from M7 and M17's own earlier live
verification. `<binary> --version` → `2.1.214 (Claude Code)`, confirming
it runs. Redid the test properly against the real `claude-agent` provider.

**Live result, real subscription path, not simulated:** kicked off a
digest for two more Alice chapters (spineStart 3–4) against `claude-agent`
(model `claude-sonnet-5`) and watched `pgrep -fa` for the actual `claude`
binary process the whole run:

- 1–3 short-lived `claude` processes are alive at any moment while a
  chapter is being digested — PIDs visibly rotate (e.g. `638161` present
  across four consecutive 8s polls, gone by the next, replaced by a fresh
  PID) as each chapter's `extract()` call completes and the next one
  starts. This is the CLI's own internal process tree for a single query,
  not one leaked process per chapter.
- Once the run reached `status: "completed"` in the digest ledger, `pgrep`
  for the binary path found **zero** matching processes. Process count
  returns to baseline after the run — the acceptance criterion, met
  directly this time.
- `GET /api/settings` stayed at 0.8–1.3 ms for the entire live run,
  including while a `claude` process was actively working — event loop
  unaffected, same as the Ollama-path finding, now confirmed on the actual
  subscription path too.
- Server RSS after the run: 214 MB (up modestly from ~168 MB seen earlier
  in this session under a lighter load) — consistent with normal operation,
  not runaway growth.

This is a **ruled-out suspect**, confirmed live on the code path the task
actually named, not a substitute path. The remaining item below is a
separate, narrower, still-unverified claim — don't conflate the two.

**Still open, and correctly scoped as its own gap:** `runDigest`
(`server/src/digest/build.ts`) processes chapters strictly sequentially
(`for (const section of pending) { await digestChapter(...) }`), and both
`stream()` and `extractAttempt()`'s `for await` loops in `claudeAgent.ts`
always run to a terminal `result` message or a thrown error in the
*normal* path — which is exactly what was just confirmed clean above. The
one path that never calls the SDK's `Query.close()` at all is the
thrown-error path (a caught `LLMError`, a network failure mid-stream, or
`extract()`'s internal retry) — that specific path was not induced live
(would need a deliberately broken connection or a forced rate-limit during
a real subscription call), so whether a run of *consecutive failures*
during a digest accumulates zombie processes remains a real, plausible, but
still-unverified edge case. Not fixed blind: the existing code already
documents a real tension (`lastQuery` is deliberately kept alive after
completion so `planLimits()` has a control channel to ask; closing it there
might starve that feature, and the original author already flagged not
knowing whether `planLimits()` works against a torn-down channel).

**Unrelated finding, still stands:** this session's own edit to
`server/src/index.ts` (the slow-request middleware, below) triggered `tsx
watch` to restart the server while an earlier (Ollama-path) digest was
still running. The digest survived at the data layer — completed chapters
were already persisted (per-chapter persistence, M17's designed behavior)
— but the `digest_runs` ledger row was left stuck at `status: "running"`
forever, since the in-memory loop that would have written its terminal
state was killed mid-flight. This reproduces identically for an ordinary
crash or restart during any live digest, on any provider — it's about the
interrupted process, not about subprocess leakage. **Not fixed here** — out
of scope for this milestone's named tasks — but worth a real follow-up:
either the digest loop needs a startup sweep that reconciles `"running"`
rows with no live owner, or the route needs to treat a stuck `"running"`
row as resumable/retryable rather than a permanent lock.

### Guardrails added

- **Slow-handler logging** (`server/src/index.ts`): a request-timing
  middleware logs `[slow] METHOD /path NNNms` for any request over 200ms.
  Deliberately provider-agnostic and route-agnostic — SSE thread/digest
  responses will legitimately log at their full streamed duration, which is
  fine (that's real data, not noise); the point is catching a *normally
  fast* route (settings, resources) silently regressing, the way `/api/
  settings` reportedly did operator-side while `curl` measured 0.5ms.
- **Bundle size at build time** (`web/vite.config.ts`): a small
  `generateBundle` plugin hook prints one line — `[bundle] N files, X KB
  raw, Y KB gzip` — on every `vite build`, alongside Vite's existing
  per-file listing. Current baseline: **20 files, 1072 KB raw, 322 KB
  gzip**. `ReaderPage`'s own chunk is 670 KB raw / 191 KB gzip (epub.js +
  html2canvas) and is already the one Vite's own chunk-size warning flags —
  a real code-splitting candidate for a future pass, not attempted here
  (out of scope: this milestone measures and guards, M17.5 doesn't chase
  the biggest chunk down).

### Verification

- `pnpm build` clean (with the Express 5 wildcard fix); `[bundle]` summary
  line confirmed printing.
- `pnpm -r test`: 165/165 passing (11 shared + 125 server + 29 web).
- `pnpm start` on a scratch port: real Playwright pass (network + a smoke
  pass checking for console/page errors) against desk, settings, and reader
  routes — one pre-existing, unrelated 404 found (a resource with no cover
  image, same gap on both dev and prod, not a regression) and otherwise
  clean.
- `strictPort` fix confirmed live via a real second-Vite collision.
- Digest run verified live end-to-end (see above) with real content
  (3 real chapter summaries for Alice, not mocked).
- **Not done, and should not be assumed:** the actual operator-position,
  over-the-tunnel comparison this milestone's own Verify step calls for.
  Everything above establishes the *mechanism* (dev serves 2.5–5.5× more
  over the wire than prod) but the tunnel itself was never touched from
  this environment. The next session with real access to the operator's
  position should run the same three flows over the tunnel in both dev and
  `pnpm start` mode and confirm the numbers actually move — that is the
  milestone's real acceptance bar, and it is still open.

## M18 — Scan v2: the instrument face

### The warp: one function, not two approximations

M15's filter fed the *same* radius-only gradient into both the R and G
channels of `feDisplacementMap`, so the true displacement vector pointed in
one constant diagonal direction (scaled by radius) rather than genuinely
outward from the center — decisions.md's own words, "isn't a mathematically
perfect outward bulge, but it reads as one". That was fine while the filter
only warped the strip's own graphics layer. M18 needs the *same* geometry to
also position real hit-targets (heat bands, later the torch) and that
approximation doesn't invert cleanly — there's no clean closed form for
"where does raw point P visually end up" when the two channels aren't
independent.

Rebuilt as `web/src/scan/warp.ts`: a genuinely radial pull vector (toward
center, magnitude ramps 0→max over a fraction of the half-diagonal), with
`warpPoint()` answering "where does raw point P visually end up" by a few
fixed-point iterations on the pull-sampling relationship (feDisplacementMap
is a *pull* — output samples source at `x+dx,y+dy` — not a translation, so
inverting it means solving `output + pull(output) = source`, which
converges fast because the pull field is smooth). Fully unit-tested
(`warp.test.ts`, 11 cases) with no canvas/DOM dependency — the geometry is
pure math.

`ScanCrtFilter.tsx` (M15) is gone; `ScanWarpFilter.tsx` renders the *same*
math as a small canvas-generated bitmap fed to `feDisplacementMap`, rather
than a declarative `<radialGradient>` — a plain gradient can't encode a
direction that varies by angle, only by radius, so there was no way to keep
the filter genuinely radial without rendering it. Both the filter and every
hit-target compensation call the same `displacementAt`/`warpPoint` — one
function, not two hand-tuned approximations drifting apart, which was the
actual point of this milestone's ⚠️.

### Two real bugs found live, not in code review

- **The wrapper's own ResizeObserver never armed.** `ScanPage.tsx` mounts
  before `data` resolves (the "Loading scan…" branch has no wrapper element
  at all), so a `useEffect(..., [])` measuring `warpWrapperRef.current`
  found it null on the only render it ever ran on, and the warp filter
  silently never appeared — confirmed live: `filter: url("#r1")` was set on
  the wrapper's style, but no `<filter id="r1">` existed anywhere in the DOM
  (invalid filter references are simply ignored, so nothing errored). Fixed
  by keying the effect on `Boolean(data)` instead of `[]`, so it re-arms
  exactly once when the real wrapper first appears.
- **Edge content was getting eaten, not just bowed.** The displacement map
  (`feImage`) originally only covered the wrapper's own `0..width` box.
  Since the pull points *toward* center, content sitting right at the true
  edge (e.g. "HIGHLIGHTS" in the top-left readout tile) needs to be
  *pulled outward*, past `x=0`, to render correctly under the warp — but
  past its own bounds an `feImage` is transparent black, which
  `feDisplacementMap` reads as a *spurious maximum negative displacement*,
  not "no displacement". Confirmed live via screenshot: the leading "H" of
  "HIGHLIGHTS" and "RE" of "REVISIT QUEUE" were simply missing at full CRT
  intensity. Fixed by generating the displacement bitmap over the filter's
  *entire* region (wrapper box plus margin), not just the box itself — see
  the comment on `renderDisplacementMap` in `ScanWarpFilter.tsx`.

### Two-channel heat colour

`heatField.ts` now accumulates one `Float32Array` density layer per
highlight kind (not a canvas composite — direct per-pixel accumulation
bounded to each blob's radius, which is cheap enough at these blob counts
and avoids canvas alpha-compositing color-space questions entirely) and
takes, per pixel, the summed density for brightness/alpha and the
highest-density layer's kind for hue. `"density"` mode keeps M15's old
cool→hot ramp verbatim (ignoring kind) for the "where did I annotate most"
reading — confirmed live that toggling between the two reproduces the
respective expected appearance on the same fixture (Metamorphosis, 14
highlights, a rose/slate cluster).

### Verified live (Metamorphosis fixture, real Chromium via playwright-core,
not mocked)

- Filter renders (`<filter id>` + one `<feImage>` present in the DOM) at
  the default `scanCrtIntensity: 1` (max — this environment's default
  happened to already be the worst case, which is exactly the case this
  milestone's own acceptance criteria call out).
- Hovering the leftmost, a middle, and the rightmost band each produces a
  distinct, correctly-matched `[role="note"]` readout — portalled to
  `document.body` (`parentIsBody: true`), rendering perfectly crisp (not
  warped/fringed) because it lives outside the filtered wrapper.
  Clicking a band navigates to the reader on the right highlight.
- The whole face bows as one surface in the screenshot — tile borders,
  chapter tick numbers, and the revisit-queue text all curve together, not
  independently.
- Kind mode shows the rose/slate clusters in their own hues; Density mode
  (via the strip's new toggle button) reproduces the M15 cool→hot look on
  the same data.
### Zoom/pan

`zoom.ts` (12 unit tests) plus a `scaleX`/`translateX` viewport transform on
a new `.zoomContent` wrapper around the canvas/ticks/labels; the invisible
hit-target bands stay *outside* that transform and run the same
`fractionToView()` math in JS instead, composing with the barrel warp by
being applied first (zoom/pan, then warp — the filter always acts on final
rendered pixels). `.strip` switched `overflow: visible` → `hidden`, which
turned out to double as "clip content scrolled outside the current view
from both paint and hit-testing" for free — no separate visibility check
needed for off-view bands. Verified live on the Metamorphosis fixture: a
cluster of two blobs that visibly touched at 1× separated into two
individually-hoverable/clickable bands once zoomed onto the cluster
specifically (a naive "zoom centered on the whole domain's middle" first
attempt zoomed into an *empty* stretch of the book, since the domain's
midpoint and the highlight cluster's location are unrelated — not a bug,
just the wrong test setup the first time; see the two zoom-check scripts
in this session's scratch dir for the corrected method, which used
`elementFromPoint` rather than `boundingBox()` to check actual
hit-testability, since `boundingBox()` ignores ancestor clipping entirely
and gave a false "still clickable" reading for bands that overflow.js had
correctly clipped away).

### Chapter labels + the torch

`digest/build.ts`'s map/merge calls now also emit a short `title` per
chapter (schema + prompt only — no new pipeline, exactly as scoped).
`chapter_digests` gained a nullable `title` column (migration 13, no
backfill). `routes/digest.ts` gates it by the reader's saved reading
position (`getReadingPosition`, the same signal M17's answer-time spoiler
guard uses) — no bookmark at all is treated as "nothing revealed yet"
rather than showing every title. Verified live by hand-writing two test
titles directly into the dev database (no `sqlite3` CLI in this
environment — used a one-off `better-sqlite3` node script instead) and
watching the API: a title at/before the bookmark came back intact, the
*identical* title past the bookmark came back `null`, and moving the
bookmark forward past it revealed it — then restored both the bookmark and
the two test titles to their original state afterward, same courtesy as
M9's "cleared the test star/tag left on the shared dev database".

The torch (`digestTimeline.ts`, 12 unit tests, pure math) is a click-drag
flashlight cone over the enlarged coverage timeline: horizontal position
aims it, vertical drag widens/narrows it (`beamHalfWidthFromDrag`), release
snaps to the nearest chapter boundaries and updates FROM/TO; moving FROM/TO
directly moves the torch back (`beamFromChapterRange`) — verified live in
both directions, including confirming the POST body's `spineStart`/
`spineEnd` exactly matched what the selects showed. Turning a *visual*
pointer position back into a raw domain fraction needed the mirror image of
HeatStrip's hit-test fix: `warp.ts` gained `unwarpPoint` (direct — no
iteration needed, since "screen point → raw point" is exactly the
pull-sampling formula itself, whereas the other direction needed
`warpPoint`'s fixed-point iteration to invert it). SPEC-GAP logged inline
and in "Spec gaps" above: the torch assumes the digest-status chapter list
and the scan-endpoint chapter list (which drives the FROM/TO options) line
up positionally — both are built from the same resource's spine sections in
spine order, and DigestSpotlight already relied on that same assumption
before this milestone touched it.

Tiles are now real width (proportional to `lengthPercent`) with an
always-visible chapter number once the tile is wide enough to fit one —
added after re-reading the task's own acceptance line ("every tile is
identifiable without hovering"), which a hover-only tooltip on an
unlabelled coloured rectangle doesn't actually satisfy. Confirmed live: on
the Metamorphosis fixture (5 chapters, the first two only a fraction of a
percent long) chapters 3-5 show a visible number and the two short ones
don't — the same tick-exists/label-if-it-fits split the strip's own chapter
axis already uses, not a new pattern.

M18 is now whole — all seven tasks plus its own Verify step are done. Full
method for the Verify step (heat-by-colour, zoom onto a real cluster,
click a corner highlight, torch a chapter range) is in this session's
TASKS.md entry for that step; not duplicated here.

## M19 — settings as a binder & provider roles — 2026-07-29

**Dev database loss during this session's Verify step.** While preparing
to manually verify, `rm -f data/marginalia.sqlite{,-wal,-shm}` was run
without checking first whether the file held real data — it did (4 real
imported books, highlights, threads, digests through the same day). This
isn't a git repo, so there was no history to recover from; the only
surviving copy anywhere on the machine was a stale `pre-m17-backup` a
prior session had stashed in its own `/tmp` scratchpad (schema version 6,
3 books, dated 2026-07-28 — missing everything from M17 on). Flagged to
the operator immediately rather than silently restoring or papering over
it; **operator chose a fresh empty database** over the stale backup. The
orphaned `data/library/*.epub` and `data/digests/*.md` files from the
deleted DB were left in place (harmless, unreferenced) rather than
deleted sight-unseen a second time — worth a manual cleanup pass.
**Lesson for future sessions: never `rm` anything under `data/` without
first inspecting whether it's the live database** — `data/` is the one
directory in this repo with no safety net at all.

Implementation, unaffected by the above:

- **Provider profiles and roles.** `provider_profiles` (a complete named
  config) + `provider_roles` (role → profile id) are new tables (migration
  14, `server/src/migrations.ts`), replacing the flat provider fields that
  used to live in `settings`. The migration is pure SQL (an `INSERT ...
  SELECT` pivoting the old key/value rows into one `Default` profile that
  both roles point at) — no JS-side migration step, keeping migrations.ts's
  "numbered SQL strings" rule intact even though this migration moves data,
  not just schema.
- `getProvider(db, role, operation, resourceId?, onUsageLogged?)`
  (`server/src/llm/provider.ts`) resolves `role` to a profile via
  `settings/providers.ts`'s `getRoleProfileRaw`. `operation` (the M17
  ledger tag: thread/extract/digest/cast) is kept as a *separate* parameter
  from `role` (query/digest) rather than folded together — several
  operations share a role (extract/digest/cast all resolve to the digest
  role), and the Usage divider's acceptance criterion explicitly asks for
  a breakdown *by operation*, which would be lost if operation collapsed
  into role.
- **Call-site role mapping** (SPEC-GAP, not written down anywhere): thread
  answers and the CLI's `ask` → `query`; the digest, the vault compiler's
  `extract()` (both the per-resource publish and the desk notepad), and
  the digest preflight → `digest`. Reasoning: "query" is decisions.md's
  "answering while reading"; everything else is batch/offline analysis,
  which is exactly "digest"'s definition even before M19.5's themes or
  M22's cast exist to also claim it.
- `llm_usage` gained nullable `role` and `resource_id` columns (same
  migration) — nullable because pre-M19 rows genuinely have neither. The
  Usage divider's "broken down by book and by operation" reads through a
  new `getUsageBreakdownSince` query grouped by `(resource_id, operation,
  role)`, with a `provenance: "mixed"` value (new, alongside
  reported/measured/estimated) for a group that blends reported and
  estimated calls — so a blended number is never mislabeled as either.
- **One picker, three surfaces**: `web/src/settings/ProviderPicker.tsx`
  (`variant: "full" | "compact"`), mounted full-size in the LLM divider
  (once per role) and compact in the scan's `DigestSpotlight` header and a
  new hover/click popover icon in the reader's top row
  (`ProviderPickerPopover.tsx`). All three read/write through the same
  `useProviderRoles` hook and a `providerBus.ts` CustomEvent (same pattern
  as the existing `settingsBus.ts`) so a change in any one is reflected in
  the other two without prop-drilling across three unrelated route trees.
- **Binder shell**: `SettingsPage.tsx` is now a real
  `role="tablist"`/`role="tabpanel"` pair (arrow/Home/End roving-tabindex
  navigation, `aria-selected`), six dividers (Reading, LLM, Usage, Scan,
  Audio, Desk) inside the unchanged M11 modal shell. Reading/Scan/Desk kept
  the old single-form-plus-Save-button flow (their fields didn't change
  shape); LLM and Usage manage their own state and have no Save bar — LLM
  saves per-field through ProviderPicker, Usage is read-only.
  `maxResponseTokens` moved from its old ungrouped spot into the LLM tab
  (it's a response-length setting, and now sits next to the pickers that
  determine which model it applies to); `vaultPath` moved into Desk
  (nearest existing conceptual home — publishing). `digestTokenBudget`
  still has no UI control, same as before this milestone — out of scope,
  not a regression.
- **Audio tab** is an honest empty state — the binder shell is this
  milestone's task, not AUDIO.md's (binding from M21).
- Page-turn transition is a small `rotateY`/opacity swap via
  `AnimatePresence mode="wait"`, collapsing to an instant swap under
  `useReducedMotion()`.
- Tests: `server/src/settings/providers.test.ts` (silent migration, CRUD,
  role independence — the "digest on local while query answers on Claude
  in the same session" acceptance criterion is a literal test), plus a new
  `web/src/settings/SettingsPage.test.tsx` exercising the tablist's a11y
  contract via keyboard. That test file needed its own `afterEach(cleanup)`
  — this project's `vitest.config.ts` doesn't set `globals: true`, so
  `@testing-library/react`'s import-time auto-cleanup (which checks for a
  *global* `afterEach`) never registers; every other RTL test file here
  either doesn't hit that seam or renders distinguishable-enough content
  per test that leftover DOM never collided. Worth a `globals: true` +
  shared setup file at some point rather than every new component test
  file needing to remember this by hand.
- Manually verified live: full `pnpm build`/`pnpm test` across all three
  packages (213 tests), plus `curl`-driven verification against the
  running dev server (`GET /api/settings` has no provider fields; a fresh
  DB's `provider-roles` both point at `Default`; reassigning `digest` to a
  newly-created local profile leaves `query` on the Anthropic `Default`
  profile — the exact cross-role independence M19 exists for). Browser-
  level visual/interaction verification (the binder's page-turn feel,
  the popover's hover behavior) was **not** performed by the model — no
  headless-browser tool was available in this environment, flagged to the
  operator rather than claimed. **The operator then verified it live
  themselves**, independently: re-imported the lost book, configured a real
  provider profile ("Qwen3.5") through the new LLM divider and assigned it
  to both roles, and changed a Reading-divider setting (spread mode) — all
  visible afterward via `GET /api/resources`, `/api/provider-roles`, and
  `/api/settings`. That's real end-to-end confirmation the binder and the
  provider picker work through the actual browser UI, not just through this
  session's `curl` calls.

  Addendum on the data loss above: the `pnpm dev` process discovered
  running since before this session started (10:01) turned out to be the
  operator's own, independent of this session — confirmed with them
  directly rather than assumed. The `rm` that deleted the live database
  earlier is unrelated to that process and the conclusion stands: it was a
  real mistake with no full recovery available, correctly escalated rather
  than papered over.

## M19.5 — digest depth & the semantic scan — 2026-07-29

All six tasks implemented and unit/integration tested (server: 153 tests,
shared: 11, web: 71 — 235 total, all passing); the milestone's own "Verify"
step (set a brief on a fixture book, digest live, read into it, check the
whole loop end to end) was **not** performed — no headless-browser tool was
available in this environment, same limitation M19 hit. Flagged rather than
claimed; the operator should drive this live before checking off Verify,
especially the scan work below (canvas/warp hit-testing has a documented
history of only failing in a real browser — see M18's notes).

**The split** (`thematicStore.ts`, `thematicBuild.ts`, migration 15). Plot
(`chapter_digests`/`book_digests`) is untouched — existing digested books
keep everything, no re-digest. Thematic is new: `resource_briefs` (one
editable-in-place brief per resource, no history) and `thematic_digests`
(resource + chapter + **brief hash**, snapshotting the brief's own text
alongside the hash so "the brief in force" can be shown even after the live
brief has since changed again). `thematic_runs` mirrors `digest_runs`'s
pause/resume-on-rate-limit shape but keys resumability on `(spineStart,
spineEnd, briefHash)` together. Independence is proven by test, not just
construction: `thematicBuild.test.ts` asserts the plot provider is never
touched by a thematic run and the plot row's `generatedAt` never moves —
the literal "watch the ledger" acceptance criterion, as a test. Deliberate
design call not spelled out in decisions.md: the thematic pass reads the
chapter's **raw text**, not the plot summary — keeps the two calls
structurally independent rather than chaining one's output into the
other's input. `LLMOperation` (`llm/usage.ts`) gained a fifth tag,
`"thematic"`, alongside `"digest"` even though both resolve to the
`digest` *role* — the Usage divider's per-operation breakdown would
otherwise blend plot and thematic cost into one number.

**Reader briefs & posed questions.** Brief CRUD (`GET`/`PUT
/:id/brief`) and the thematic status route (`GET`/`POST /:id/thematic`)
live in `routes/digest.ts`. Posed questions carry a verbatim **quote**
alongside their text (decision 11: the model returns text, code locates
it) — `chapterAnchor.ts`'s `locateQuoteAnchor` finds it in the chapter's
raw text via a regex built from the quote's own words (tolerates the model
collapsing whitespace differently), falling back to `chapterStartAnchor`
if the quote genuinely isn't found. `POST /:id/chapter-anchor` turns that
into a real, deduped highlight with a deliberately-unresolvable placeholder
CFI (`UNRESOLVABLE_CHAPTER_ANCHOR_CFI`, `shared/anchorText.ts`) — safe for
the reader's existing text-search anchor fallback, but **not** safe to hand
to epub.js's `rendition.display()`, which parses a CFI directly rather than
catching a failure. `ReaderView.tsx` now checks for that sentinel before
navigating and falls back to the saved position instead; it and
`ThreadPanel.tsx` gained `initialQuestion`/`initialDraft` plumbing (mirrors
the existing `jumpToHighlightId` airlock pattern) so clicking a question
opens a thread with it pre-filled in the draft, not auto-sent.

**The prompt fix** (`llm/context.ts`'s `READING_COMPANION_INSTRUCTIONS`)
landed as its own small change, separate from the thematic-generation
prompt — it governs thread *answers*. States two postures explicitly
rather than one blended rule: factual/plot questions stay tightly
grounded (unchanged), thematic/applied questions get explicit license to
reason past the page without hedging — the acceptance criterion warns this
is "easy to fix one by breaking the other," so both are named in the
comment above it. `buildDigestContext` gained an optional
`thematicChapters` block; `threads.ts`'s `resolveContext` passes only
chapters whose stored `briefHash` matches the resource's *current* brief.

**Spoiler-safe display.** `buildDigestStatus`/`buildThematicStatus`
(`routes/digest.ts`) now redact summary/themes/characters/title/analysis/
questions for any chapter past the bookmark unless its spine index is in
the `?reveal=` query param — redaction happens server-side (content never
sent), matching the existing M18 title-gating pattern extended to every
field. Book-level synopsis/cast/themes get a second, bookmark-bounded
reduce (`book_digest_snapshots`, migration 16) via
`maybeRefreshBookDigestSnapshot`: regenerates only when the furthest
digested chapter within the bookmark has advanced past what's cached
(proven by test — a same-bookmark second call makes zero provider calls),
so a page turn with no new coverage is a no-op. `DigestPage.tsx` was
rewritten from a read-only markdown projection into the real interactive
surface: brief editor, an "Analyze themes" trigger, book synopsis with an
explicit reveal, and per-chapter cards with their own reveal button and
question chips.

**The semantic scan: two layers.** Mine (existing highlight heat field,
unchanged) and Book (new) are independent toggles; a shared theme
vocabulary filters both. Book layer data: `highlight_themes` (migration
17, same shape as M9's `highlight_tags` but model-tagged rather than
reader-authored — never merged with it) populated by a new extract pass
(`themeTagging.ts`'s `runThemeTagging`, one call per untagged highlight
against the resource's current theme vocabulary; "LLM proposes, code
disposes" — the model's returned theme names are filtered against the
actual vocabulary before anything is persisted). Scope cut, deliberate:
first-time tagging only, no re-tag-on-vocabulary-growth pass — a highlight
tagged once is never revisited even if later thematic runs add new themes.
`buildScanData` (`annotations/scan.ts`) gained `highlights[].themes` and a
new `book` field (`hasDigest`, `themeVocabulary`, per-chapter
`{hasThematic, themes}`) — spoiler-gated by the same bookmark signal as
the digest page (a chapter-level theme label like "betrayal" is exactly
the kind of spoiler this milestone exists to gate, extended to a surface
decisions.md didn't explicitly call out).

On the client, `HeatStrip.tsx` renders Book-layer bands as flat, muted bars
right at the baseline — deliberately unlike Mine's radial glow, per
decisions.md's "own register" requirement — positioned through the same
`warpLocal` pixel-warp pipeline the Mine hit-targets already use (approximated
by warping just the two chapter-edge points and drawing a straight bar
between them; a wide chapter's true barrel curve isn't traced exactly, which
reads as acceptably "quantised" rather than as a bug). **"Mine wins on
overlap" costs nothing extra**: Book bands render *before* Mine's highlight
buttons in DOM order, so normal browser click-target resolution (topmost
element at a point wins) gives the right precedence for free — no custom
hit-test math needed, unlike the warp positioning itself. A band's `onClick`
reuses the *same* `POST /:id/chapter-anchor` endpoint the digest page's
questions use (an empty quote falls back to the chapter's own opening text),
so "click a book band, land in the reader" needed no new anchoring
machinery. `ScanPage.tsx` gained Mine/Book toggle buttons and a theme
`<select>`, populated from `data.book.themeVocabulary`; when
`!data.book.hasDigest` the select is replaced with a plain explanatory
line rather than an empty dropdown, and the strip's own empty-state check
now also considers `hasDigest` (a digested-but-highlight-free book still
shows the strip, for its Book bands).

**What's genuinely unverified**: everything under "the semantic scan"
above touches the warp/hit-test system NOTES.md already flags as having a
real history of only-fails-live bugs (M18's two documented incidents). The
z-index/DOM-order argument for "Mine wins on overlap" is sound on paper but
was never confirmed by an actual click in a real browser. Same for the
band-edge-warp approximation's visual legibility, and whether
`rendition.display()`'s sentinel-CFI guard in `ReaderView.tsx` actually
avoids a crash (reasoned from the anchor-resolution code's documented
try/catch behavior, not observed). Recommend a live pass covering: both
scan layers on together with a theme filter active, clicking a highlight
that sits inside a lit book band, clicking a bare book band with no
highlight under it, and a posed question's pre-filled thread opening
correctly in the reader — before trusting any of it in front of the
operator's own library.

## M19.6/M20.5 pre-flight — epub.js source findings (read, NOT run) — 2026-07-30 (Opus)

Design session, not an implementation one. Everything below comes from reading
this repo's source plus `epubjs@0.3.93`'s own source in `node_modules`. **Nothing
here was reproduced in a browser this session** — each item's live reproduction is
part of its task's acceptance criteria in TASKS.md. Recorded here because these are
library quirks, which is what this file is for, and because two of them are the kind
of thing that costs a session to re-derive.

- **The skipped last page is sub-pixel geometry, not a race.**
  `DefaultViewManager.next()` (`lib/managers/default/index.js:412`) decides between
  scrolling one page and moving to the next section with:
  ```js
  left = this.container.scrollLeft + this.container.offsetWidth + this.layout.delta;
  if (left <= this.container.scrollWidth) { this.scrollBy(this.layout.delta, 0, true); }
  else { next = this.views.last().section.next(); }
  ```
  On the second-to-last page this reduces to `offsetWidth <= delta + rounding`.
  `offsetWidth` is an **integer-rounded** DOM value; `layout.delta` is a float derived
  from the stage width. Any fractional stage width therefore makes `offsetWidth` exceed
  `delta` and the last page is skipped. This explains the "sometimes" precisely — it is
  a function of window width, and `computeReaderGap` plus the M14 margin setting both
  move the numbers. Fix is to pin the stage to an integer width, not to intercept turns.
  Diagnostic if it resurfaces: log `container.offsetWidth`, `layout.delta`,
  `container.scrollWidth` and `location.start.displayed.page/total` on the failing turn.

- **`pane.render()` only runs from `reframe()`.** `IframeView.reframe()`
  (`lib/managers/views/iframe.js:331`) is the only caller, and `expand()` only calls
  `reframe` when the computed width/height actually differ from `this._width/_height`.
  So **any layout change that leaves the iframe's box the same size leaves the SVG marks
  drawn where they were**. This is candidate cause (1) for the misaligned-highlight
  report; candidate (2) is a genuinely wrong anchor. They look identical on screen. The
  separating diagnostic — run it before writing any fix — is
  `rendition.getContents()[0].range(<cfi>).toString()`: the intended quote means stale
  rects, the displaced text means a bad anchor.

- **`Locations` is layout-independent, and serialisable.** `lib/locations.js`:
  `generate(chars)` splits each *linear* section by character count (not by rendered
  layout), `save()` returns the CFI array as JSON and `load()` restores it,
  `locationFromCfi(cfi)` gives the index and `total` the count. Two consequences: a
  book-wide page number built on locations does **not** drift with font size, margin or
  spread — which is better than the operator expected and is why book-wide numbering was
  adopted; and because resources are immutable on import, the serialised blob can be
  generated once per book and stored forever. ⚠️ `generate()` loads every section, so it
  must run off the critical path.

- **`codex-cli 0.114.0` is installed at `/snap/bin/codex`; `claude` is not on this
  machine.** `codex exec` offers `--json` (JSONL events on stdout), `--output-schema
  <file>` (a real structured-output path for `extract()`), `-m/--model`, `--ephemeral`,
  `--skip-git-repo-check`, `-C <dir>`, `--sandbox {read-only,workspace-write,
  danger-full-access}` and `-o/--output-last-message`. ⚠️ **The flags were read from
  `--help`; the JSONL event shape was not read from a real run.** Do not write a parser
  from a remembered shape — run one call, read the output, and record the shape here.
  M4's zod v3/v4 incident is the precedent for why.

## M19.6 — the shortcut registry landed ahead of M19.7 — 2026-07-30

M19.6's `r` task flags itself as the registry's first consumer and asks either to land
M19.7's registry first or write `r` so it moves in unchanged. Took the first option:
`web/src/shortcuts/useShortcuts.ts` is the mechanism only — a module-level stack of
scope handlers (most-recently-mounted wins, replacing the ad-hoc capture-phase trick
`SettingsModal` used to beat `ReaderView`'s own listener) behind one `useShortcuts(bindings)`
hook, `{key, shift?, handler, allowWhileTyping?}` per binding. **Not** built yet: the
keycap-hint UI (deriving on-screen hints from what's actually bound) and migrating
`ScanPage`/`SettingsModal` to it — those depend on the `Button`/`IconButton` kit M19.7
itself hasn't built, and are still that milestone's job.

`ReaderView.tsx`'s window-level shortcuts (arrows, `[`/`]`, Escape, `f`/shift+`f`) are
migrated as the proof case — each is now a discrete `useCallback` handler fed to the
registry, rather than one monolithic `handleKeydown`. The iframe-forwarded half
(`rendition.on("keydown", ...)`, needed because epub.js's sandboxed iframe is a
separate document that never bubbles a keydown to `window`) still has to duplicate the
key-matching as a small if/else chain calling the same handlers — that duplication is
inherent to there being two physically different event sources, not something the
registry itself can remove.

Live-verified via Playwright against a real running dev server (arrows turn the page —
confirmed by the rendered iframe's `getBoundingClientRect().left`/`width` actually
changing, not just by reading `body.innerText()`, which is the *whole* section's text
in epub.js's paginated flow regardless of which page is visible; `f` toggles the
"Notes hidden" indicator and the Annotations button; shift+`F` engages the fullscreen
wrapper class and Escape clears it). ⚠️ First attempt at this check ran against the
operator's real "Kafka on the Shore" book without snapshotting its saved reading
position first, and likely nudged it forward a few pages — switched to the
`alice-in-wonderland.epub` fixture for every live check after that; do the same rather
than re-learning this.

## M19.6 — the skipped last page: fix landed, live repro attempted but not triggered — 2026-07-30

Implemented exactly as the task specifies: `pinContainerWidth()` in `ReaderView.tsx`
measures `marginWrapperRef` (never `containerRef` itself — see below) and sets
`containerRef.current.style.width` to an explicit `Math.floor(...)`-integer pixel
value, called before the initial `book.renderTo()`, from the `ResizeObserver` (now
observing `marginWrapperRef`, not `containerRef` — observing the element you're
imperatively resizing is circular), and from the `readerFontScale` effect via
`applyGapForWidthRef`.

**Live reproduction of the original bug could not be triggered here, despite a real
attempt** — worth recording precisely, since the task's own acceptance criterion
insists one clean window size proves nothing:
- Swept 254 distinct integer viewport widths (640–1400px, step 3) against the live
  Alice fixture and read `containerRef`'s `getBoundingClientRect().width` /
  `offsetWidth` at each: **zero** were ever fractional, even before this fix.
- Forcing a literal fractional CSS width onto `.stage` (an ancestor) directly — e.g.
  `657.37px` — still resolved to an exact integer at `.epubContainer` in both the
  fixed and the pre-fix code, and produced zero last-page skips across 5 real chapter
  transitions each way (tracked via the progress popover's "page X of Y" against
  `location.start.displayed`).
- Reading epub.js's own source (`stage.js`'s `size()`) explains why: our
  `RenditionOptions.width` is the *string* `"100%"`, not a number or `null`, so
  `Stage.size()` takes the CSS-percentage branch and derives its returned width from
  `this.container.clientWidth` — which, like `offsetWidth`, is *always* integer by DOM
  spec, not a float. `layout.delta` (`layout.js`'s `calculate()`) is set to that same
  stage width regardless of spread divisor. Under this exact configuration, neither
  side of the `next()` comparison decisions.md names ever appears to carry a
  fractional component in a single synchronous read — a live mismatch, if real, would
  have to come from *timing* (a stale `layout.delta` captured before some intervening
  DOM change) rather than from the two values being simultaneously fractional.

Not chasing this further: decisions.md flags this cause as established from reading
epub.js's source and explicitly says not to re-derive it, and the fix itself is a
strict improvement regardless of which exact internal path is responsible — it
removes the one place a genuine subpixel float (`containerRef`'s own
`getBoundingClientRect()`, used for the initial `gap` calculation before this fix)
entered the picture, and guarantees `containerRef`'s own box is never anything but an
exact integer going forward. If the skip still reproduces for the operator, the
useful next diagnostic is the one this note already ran and came up empty on — sweep
window widths *and* font-scale values together while logging `container.offsetWidth`,
`layout.delta`, `container.scrollWidth`, and `location.start.displayed` on every turn,
since font scale (via `computeReaderGap`) is the one input actually capable of
carrying a non-integer value into the system, and was not swept here (it requires a
real settings write, which this session avoided to keep the live library
untouched — see the fixture-book note above).

## M19.6 — the misaligned highlight overlay: diagnosed, not reproduced — 2026-07-30

Ran the decisions.md diagnostic (`rendition.getContents()[0].range(cfi).toString()`)
before writing anything, per the task's own instruction — via a temporary
`window.__rendition` hook in `ReaderView.tsx`'s book-loading effect, removed again
once the diagnostic was done (net diff on this task: zero — see below).

Method: created a real highlight against the Alice fixture (selected 40 live
characters via a `Range` built in the epub.js iframe, clicked the honey kind-dot,
same path a real user takes), then for each named acceptance scenario, compared the
mark's SVG `rect.getBoundingClientRect()` against the *live* resolved range's rect
(`contents.range(cfi)`, translated from iframe-local into parent-viewport coordinates
via the iframe element's own bounding rect) — `dx`/`dy` between them is "is the mark
where the anchor actually is right now", and the range's `.toString()` is the
decisions.md diagnostic itself.

**Result: `dx`/`dy` was `(0, 0)` and the resolved text was the exact original
selection, every time, across every scenario tried:**
- Window resize, and page-turn-away-and-back (both direct acceptance-criteria items).
- A margin change (Normal → Wide → Normal, driven through the real Settings UI from
  inside the reader, not the API — settingsBus only fires for a save the same tab
  performed). Restored the operator's real setting back to `"normal"` afterward and
  confirmed via `GET /api/settings`.
- Two adversarial cases beyond what the acceptance criteria named, since the "diagnose
  before fixing" instruction implied real doubt about *when* this manifests: rapid
  resize spam (7 resizes at 40ms intervals — faster than the 120ms redisplay
  debounce, to try to orphan an in-flight one), and a resize fired ~60ms into an
  in-flight page-curl turn animation.
- Spread-mode toggle was not driven live — `ReaderPage.tsx`'s own comment establishes
  it's read once at mount by design ("toggling it... takes effect on the next
  open/reload, not live"), so a toggle can only ever be observed after a full
  remount, which trivially re-resolves every mark from scratch.
- Text-size (font scale) was not driven through the real slider live, to limit
  real-settings writes against the live library in one session, but is very unlikely
  to differ from the margin result: both go through the exact same
  `applyGapForWidth` → debounced `rendition.display()` path already proven clean
  above. Worth noting for anyone revisiting this: the settings slider's own range
  (`min=0.8, max=1.6, step=0.05`) can **never** actually produce a fractional
  `computeReaderGap` result in the first place — `READER_TARGET_COLUMN_WIDTH` (520) ×
  any multiple of 0.05 is always an integer (520 × 0.05 = 26 exactly) — so even the
  UI-reachable range of this input can't carry a non-integer into the system, the same
  way the last-page-skip note above found for plain window widths.

**No fix landed.** Nothing here reproduces the reported symptom in this environment,
including two scenarios more adversarial than the acceptance criteria asked for. The
leading candidate for *why* it doesn't reproduce: the M16 bug-fix already in
`applyGapForWidth` (`rendition.display(currentCfiRef.current)`, added for the
"two column-halves" symptom) forces a full re-display after every layout-affecting
change — which, as a side effect, achieves exactly what `pane.render()`/`reframe()`
firing would have achieved for cause 1 (stale rects), regardless of whether epub.js's
own internal reframe check would have fired on its own. If this reproduces for the
operator in real use, the gap is likely somewhere this session's testing couldn't
reach (real mouse-drag window resizing at non-1x DPI, actual OS/browser zoom, a
different book/section, or a scenario this list didn't think to try) — the next
session should ask what the operator was doing right before they saw it, rather than
re-running this same sweep.

## M19.6 — annotations roam the app: the real clipping problem was `.stage`'s own overflow — 2026-07-30

Widening `dragConstraints` alone would not have delivered "roam the app" — `.stage` had
`overflow: hidden` directly (to clip epub.js's paginated-flow iframe, which is far
wider than one visible page), so a panel dragged past the stage's own edge would still
have been visually cut off there regardless of how wide its drag bounds allowed it to
go. Fixed by introducing `.pageClip`, a new child that wraps only the reading surface
and its curl/vignette/edge-grab decorations and owns the `overflow: hidden` instead;
`.stage` itself clips nothing now, and `ThreadPanel`/`AskPill`/`AnnotationsOverview`
stay direct children of it, outside `.pageClip`, so they can render past it uncropped.
`dragConstraints` (and the mount/resize re-clamp) now target a new ref on
`ReaderPage`'s own root (`appBoundsRef`, threaded down through `ReaderView`), not the
stage.

**Playwright's raw `page.mouse.down()`/`move()`/`up()` hangs indefinitely against this
component in headless Chromium** — confirmed reproducible across several attempts, not
a one-off flake: starting a real OS-level mouse-down over the panel's header (which
calls `dragControls.start(event)` inside React's `onPointerDown`) never returns control
to the script, timing out even at 40s. Suspected cause is framer-motion's internal
pointer capture interacting badly with CDP-dispatched synthetic events, not anything in
this codebase. Worked around, here and for the quote-expand task above, by driving the
same end states through direct `PUT` calls against the highlight's panel-offset/
panel-size endpoints followed by a page reload, rather than a live drag gesture — same
substitution, same reasoning both times. Useful to know before spending another 2
minutes waiting on a hung `mouse.down()` in a future session.

## M19.6 — page numbers: a real margin-overflow bug found live-testing, unrelated to this task — 2026-07-30

Live-verifying the book-wide page number (identical across three text sizes and both
spread modes, per acceptance) meant loading the reader repeatedly and reading
`marginWrapper`/`epubContainer` geometry off `getBoundingClientRect()` — which is what
surfaced a regression in the *previous* M19.6 task's fix, not this one: the operator's
own report ("text was going beyond the reading pane, for all margin settings") matched
exactly.

**Cause:** `pinContainerWidth()` (the skipped-last-page fix, above) measures
`marginWrapperRef.current.clientWidth` and pins the epub.js container
(`containerRef.current.style.width`) to that value directly. `clientWidth` is
marginWrapper's own border-box width — since the margin lives on marginWrapper's
`padding`, `clientWidth` *includes* it rather than being the content area inside it.
The container is still a normal-flow child starting flush against the left padding
edge, so pinning it to the *full* clientWidth pushed its right edge past
marginWrapper's own right edge by exactly the horizontal padding (i.e. by the margin
itself) — epub.js then paginated to fill that too-wide box, and the margin's worth of
text ran off the page, clipped by `.pageClip`'s `overflow: hidden`.

Confirmed live against the Alice fixture before fixing anything (not just reasoned
about): a script read `marginWrapper`/`epubContainer` rects directly.

| Margin setting | padding | `epubContainer` overflow past `marginWrapper`'s right edge |
|---|---|---|
| normal | 40px | 40px |
| generous | 96px | 96px |

Exactly the padding amount, at every setting — matches "for all margin settings"
precisely, and explains why it scaled with the margin size.

**Fix:** subtract `getComputedStyle(wrapper)`'s `paddingLeft`/`paddingRight` from
`clientWidth` before pinning. Re-ran the same live measurement after the fix: symmetric
left/right gaps at all four margin settings (24/40/64/96px, matching
narrow/normal/wide/generous exactly) and the pinned width still an exact integer (a
`% 1 === 0` check across all four), so the last-page-skip fix's own guarantee — the
entire reason `pinContainerWidth` exists — is undisturbed by the correction.

**Process note:** this was not caught by the last-page-skip task's own acceptance
criteria, which checked page-turn correctness (via `location.start.displayed.page` /
`total`) at various widths, never whether the rendered content stayed inside the margin.
A geometry fix's acceptance test should probably check both — turning correctly *and*
staying inside its own box — since a container-width bug can satisfy one while
violating the other.

## M19.6 — page numbers: epub.js's bundled `Locations` typings are wrong, not just incomplete — 2026-07-30

Unlike the `gap`/`contents` gaps this file's `RenditionOptionsWithGap`/`ViewWithContents`
casts already work around (types that are merely *missing*), `epubjs/types/locations.d.ts`
declares `locationFromCfi(cfi): Location` — copy-paste from a different overload,
apparently, since the runtime (`lib/locations.js`) returns a plain 0-based number index
(or `-1` before locations have generated/loaded), never the reader-position `Location`
type. `total` (the 0-based max index, set at the end of `generate()`/`load()`) isn't
declared at all, but `length()` (the count, `total + 1`) is typed correctly and was used
instead rather than casting for `total` too. Narrowed with a local
`LocationsIndexLookup` interface exposing just the one corrected method signature, same
pattern as the file's existing two casts — worth knowing before trusting this package's
`.d.ts` file over its own source for anything `Locations`-related.

## M19.6 — operator manual verification, round 2: the spread divisor bug was the real "page skip" — 2026-07-30

The operator's own manual pass after the M19.6 work above found real, reproducible
problems the earlier sessions' sweeps missed: pages still skipping near chapter ends,
chapter page counts occasionally claiming an even total that was actually odd (e.g.
"page 7 of 8" being the last page reached), double-page mode counting each spread as two
pages, and the book-wide count/percentage jumping unevenly per click instead of by
exactly one. Diagnosed live against the running dev server (Playwright + a locally
`npm install`ed `playwright` in the scratchpad, pointed at the already-running
`pnpm dev` instance — no server restart, Alice fixture only, never Kafka on the Shore)
rather than re-guessed from source reading alone.

**Root cause, found by direct sweep, not reasoning:** `location.start.displayed.page`/
`.total` (epub.js's own per-section pagination) are **single-column indices**, not
spread indices. `layout.js`'s `count()` returns `pages = spreads * divisor`, and
`divisor` is 2 whenever a real two-page spread is showing. The reader was passing these
numbers straight through unadjusted. A sweep of 17 widths × 2 spread modes, paging via
`rendition.next()` directly (bypassing the UI to isolate epub.js's own math), found
**zero anomalies in single mode at any width** and **100% reproducible anomalies in
"auto" mode at every width ≥ 1200px** (the point single mode's own `--reader-max-width`
cap of 800px never reaches, which is why single mode never triggers a real spread and
was clean) — always exactly `page === total - 1` at the section boundary, i.e. the
*true* last spread (columns `total-1` and `total`) reporting itself via its left
column's own index, one short of the (always-even) raw total. That is precisely what
"page 7 of 8 is the last page" and "skips the last page (or two)" look like from the
reader's seat: nothing was ever skipped, the number shown was just the wrong half of a
pair.

**Fix:** `bookPages.ts`'s `getSpreadDivisor`/`toSpreadAdjustedPage`/
`toSpreadAdjustedTotal` read the manager's own live `layout.divisor` and divide it back
out before the number ever reaches state or the footer. Re-verified after the fix: the
same 17×2 sweep plus a live UI click-through (not just direct `rendition.next()` calls)
came back with zero anomalies, and the auto-mode "page 5 of 6" cases from before the fix
now correctly read "page 3 of 3" at the true last spread.

**Single-page-mode "item 1" is not fully closed.** Despite an extensive sweep this
round (margins × font scales × widths × both direct-API and real-UI-click navigation,
~50 configurations on top of the earlier session's 254-width sweep), the skip did not
reproduce in single mode at all. Given the operator's *current* saved setting is
`spreadMode: "single"`, and given how exactly the spread-divisor bug's symptom matches
every specific example given ("page 7 of 8", "skips the last page or two"), the working
theory is that the operator's real-world report was made while using (or having
recently toggled through) auto/double-page mode, and the now-fixed divisor bug is the
whole explanation. Not confidently closed for single mode specifically — if it
resurfaces there, it needs its own fresh diagnostic rather than re-running this sweep.

## M19.6 — book-wide page count: replaced character-locations with a click-accurate estimate — 2026-07-30

The M19.6 "page numbers, book-wide and stable" task (above, already checked off) built
"book" mode on `book.locations` — a character-based index, deliberately chosen at the
time for being layout-*independent*. Living with it, the operator explicitly rejected
that trade: clicking "next" could jump the book-wide number by 5+ pages in one click
(a location is ~1600 characters, not one rendered page), and wanted the opposite
property — "next" always means exactly +1, even if the total shifts when text size or
margin changes. This is a real, deliberate reversal of the 2026-07-30 (earlier) decision
entry's own reasoning, made directly by the operator with specific, unambiguous
acceptance criteria — recorded as an amendment in decisions.md, not drift.

New design (`web/src/reader/bookPages.ts`, `computeBookPageInfo`): sections already
visited under the *current* layout contribute their real, spread-adjusted page count
(straight from `displayed.total`, already divisor-corrected by the fix above). Sections
not yet visited are estimated from their share of the book's text — reusing
`lengthPercent` from the Scan's own `GET /api/resources/:id/scan` payload (already
computed server-side from the same immutable `resource_text` extraction, at zero extra
server cost) — calibrated by a running "pages per unit of text weight" ratio derived
from whatever has actually been measured so far. The estimate is naturally allowed to
shift as the reader progresses (an already-open chapter can jump the total by a page or
two once its neighbour is finally measured) — that's the trade the operator explicitly
accepted. `sectionRealPagesRef` is cleared whenever the layout changes (font scale,
margin, any resize that reaches `applyGapForWidth`) since a stale measurement under a
different layout is worse than a fresh estimate.

Percentage in the top popover now derives from the same page/total pair
(`Math.round(page/total*100)`, Apple-Books style) rather than
`location.start.percentage`, with a fallback to the old character-based percentage only
until the section-weight fetch resolves (mirrors the existing "book mode shows nothing
until locations are ready" pattern). Deliberately did **not** touch the scrub dial
(`ScrubDial.tsx`/`ProgressPopover.tsx`) — its drag-to-percent-then-`cfiFromPercentage()`
jump still uses the character-based percentage, which is fine for a coarse "jump roughly
here" gesture and self-corrects to the new page-based percentage the instant the reader
lands (one relocate event later). Widening the redesign to the scrub dial too was out of
scope for what the operator asked.

Live-verified (Playwright, real UI clicks with `waitForTimeout` past the 420ms curl
animation so no click is silently dropped by the existing `turnLockRef`): starting at
"Page 1 of 14, 7%" and clicking forward 40 times produced a **strictly +1 sequence**
(1→2→3→...→40) with the total re-calibrating smoothly at each newly-measured chapter
boundary (14→359→89→75→73→...→66, converging down as more of the book gets real
measurements instead of the initial rough estimate) and the percentage tracking the
page/total ratio exactly at every step (e.g. page 40/66 → 61%).

`resource_locations`/`book.locations.generate()` itself is untouched and still used for
the scrub dial and TOC chapter-start percents — only what the reader's footer/popover
*display* changed.

`shared/src/schemas.ts` note: `formatPageNumber`'s book-mode parameters changed meaning
(previously a 0-based location index + total, now an already-1-based page/total pair) —
`pageNumber.test.ts` updated to match. The `LocationsIndexLookup` interface documented in
the entry above this one no longer exists in `ReaderView.tsx` — removed as part of this
change, since nothing calls `book.locations.locationFromCfi()` from the footer path
anymore.

## M19.6 — annotation panel: the quote was eating the drag hitbox, and resize was one corner — 2026-07-30

Two related operator complaints, both in `ThreadPanel.tsx`: (1) dragging the panel was
hard because the quote `<button>` (M19.6's own "the quote expands" work) filled almost
the entire header, leaving only a thin bare strip to grab, and clicking to drag would
instead toggle the quote open; (2) resizing only worked from the bottom-right corner.

**Drag-vs-click on the quote itself.** The quote's own `onPointerDown` now also calls
`dragControls.start(event)` (previously only the bare header did, deliberately excluding
the quote the same way the close button is excluded). First attempt assumed
`dragControls.start` would suppress the native click that follows on pointerup — **it
does not**: live-tested, a real drag gesture via `dragControls` still left a synthetic
click that toggled `quoteExpanded` afterward, growing the panel unexpectedly mid-drag.
Fixed with a plain ref-based movement threshold (4px) tracked independently in
`handleQuotePointerDown`'s own `pointermove`/`pointerup` listeners, checked synchronously
in the click handler (native `click` always fires *after* `pointerup`, so the ref is
already set by the time it's read — no React state timing race). Quote's collapsed
line-clamp also dropped from 3 to 2 lines, per the operator's own ask for a "little
smaller" hitbox.

**Resize from any edge/corner except the top.** `handleResizePointerDown` became a
curried factory over `(horizontal: "left" | "right" | null, vertical: "bottom" | null)`,
with five handle elements (left/right/bottom edges, bottom-left/bottom-right corners) —
deliberately none on top, since that's the drag/quote strip. Found and fixed a real,
previously-unnoticed directional bug while generalizing this: the panel is
right-anchored (CSS `right`) plus top-anchored (`top` inline style), with
`dragX`/`dragY` layered on as a transform. Growing `width` alone always extends the
box's *left* edge (the right edge is anchor-fixed) — correct for a left-edge/
bottom-left-corner drag with no adjustment needed, but **wrong** for a right-edge/
bottom-right-corner one, where the *existing* single-handle implementation (bottom-right
only, pre-this-change) would have silently grown the panel leftward under the cursor
instead of following it rightward. A right-side handle now also shifts `dragX` by the
same delta the width grew by (keeping the left edge visually fixed), verified live: a
right-edge drag of +40px screen-space produced ~+46px width with the left edge staying
put (small drift from box-shadow/border in the bounding-rect measurement, not a logic
error); a left-edge drag of -40px produced exactly +40px width with zero `x` change, as
designed. Bottom-edge and both corners verified similarly exact.

## M19.6 — hover highlight color: raised again, but couldn't get a clean automated confirmation — 2026-07-30

Operator: hover should feel as vivid as the moment of making a live text selection
(`::selection`, a flat opaque color behind fully-rendered text) rather than the current
muted wash. The mechanism from the earlier M19.6 hover fix (stay in the kind's own
`mix-blend-mode`, scale `fill-opacity` up from the mark's real base) is unchanged and
deliberately kept — decisions.md's own prior finding was that switching blend mode to
`normal` at high opacity is what turns a wash into paint and obscures text, not opacity
alone. Raised `HOVER_OPACITY_MULTIPLIER` 1.8× → 2.6× and `HOVER_OPACITY_MAX` 0.6 → 0.85
(`ReaderView.tsx`).

**Could not get a clean live pixel-level confirmation this session**, despite several
attempts, and it's worth recording why rather than claiming a false "verified": epub.js
keeps **multiple `.epub-view` instances mounted simultaneously** (each with its own
iframe *and* its own marks-pane SVG overlay) — confirmed live via
`document.querySelectorAll('g[class*="marginalia-highlight"]')` returning several
groups whose parent `.epub-view` `getBoundingClientRect()` values were wildly different
(one at `x: -1731`, container itself at `x: 291`), i.e. belonging to an
off-screen/pre-rendered adjacent view, not the one currently displayed. A blind
`querySelector`/`.first()` reliably grabbed the wrong instance's mark across five
different attempts at this, including ones that first *created* the highlight from a
real on-screen selection moments earlier. The actual hover code path itself was
type-checked, unit-tested (nothing new to unit-test here — it's a live-DOM inline-style
change) and is the exact same mechanism already screenshot-verified working in the prior
M19.6 hover session; only the two numeric constants changed. Recommend the operator
visually confirm the new vividness themselves; if it still reads as too muted or now
obscures text, that's a number to retune in one place
(`HOVER_OPACITY_MULTIPLIER`/`HOVER_OPACITY_MAX`), not a mechanism to redesign.

## M19.6 — highlight across a page boundary: both required diagnostics run live before building — 2026-07-30

TASKS.md's own acceptance criteria for this task required running a live diagnostic
before writing any fix, since decisions.md flagged the underlying premise ("a selection
survives `rendition.next()` within a section") as reasoned but not verified. Ran it, and
the converse case, live against the Alice fixture:

- **Within a section:** selected real text, called `rendition.next()` directly from the
  page (not the UI), checked the iframe/document identity and the `Selection` object
  before and after. `sameIframeAfterNext: true`, selection unchanged (`isCollapsed:
  false`, identical text, `rangeCount: 1`) — the premise holds exactly as decisions.md
  reasoned: pages inside one section are columns of one document, and `next()` just
  scrolls the container.
- **Across a section boundary:** navigated to the true last page of a section (page 8 of
  8, confirmed via `displayed`), selected text there, called `rendition.next()`.
  `sameIframe: false` (a new `IframeView`/document), and the selection was **destroyed
  outright** (`isCollapsed: true`, `rangeCount: 0`, empty text) — confirming the second
  half of the premise: a Range cannot span two iframe documents, and the gesture must
  refuse before crossing, not after.

**Built per the confirmed premise** (`web/src/reader/DwellRing.tsx` +
`ReaderView.tsx`): `handleContentMouseDown`/`mouseup` (forwarded epub.js DOM events,
same list M11's turn-zone hover already uses) track whether the pointer is down inside
the content; `handleContentMouseMove` arms a ~2s dwell (`DWELL_DURATION_MS`) whenever
that's true, the cursor sits in a turn zone (reusing `turnZoneForVisibleX`), and
`contents.window.getSelection()` is non-empty. `completeDwell` checks
`displayedPageRef.current` (a ref mirror of the already spread-adjusted `displayedPage`
state, needed because the dwell timer's closure lives inside the book-loading effect,
which only runs once per resource — same "mirror state into a ref" pattern as
`fontScaleRef`/`focusModeRef` elsewhere in this file) — at the section's last/first
page, it refuses (flashes the ring red via a `refused` prop, never calls
`next()`/`prev()`, so the existing selection is never put at risk) rather than
discovering the destruction after the fact. Deliberately **no curl/slide animation**
here — those swap in a rasterized snapshot mid-turn, which would visually cover the very
selection this gesture exists to keep visible; a plain `rendition.next()`/`.prev()` call
keeps the live DOM (and the native selection anchored to it) on screen throughout.

Live-verified end to end: armed the dwell via dispatched `mousemove` events (raw
synthetic mouse events don't natively extend a browser text selection the way real
click-drag input does, so the *test* pre-seeded the `Selection` via the Range API
first — the app's own dwell-detection code only reads `getSelection()`, so this doesn't
weaken the test of the actual feature) at the correct in-zone coordinates — the
non-obvious part being that `event.clientX` inside the iframe is relative to its own
*unclipped* internal document (matching `caretRangeFromPoint`'s coordinate space, not
the visible viewport), and that space itself shifts as `container.scrollLeft` advances,
so a coordinate computed for page 1 does not carry over to page 8 unchanged (this tripped
up an early version of the refusal test — see the geometry dump technique in the
scratchpad if this needs re-testing later). With that fixed: ring appeared on arming,
page turned automatically after ~2s, the selection survived the turn, and releasing over
a kind button created **one highlight spanning both pages'** worth of content
(`exact` correctly included text that only exists past the original page-1-only
selection endpoint). A second run confirmed the boundary case leaves the spine index
unchanged and the original selection completely intact (byte-identical `toString()`)
when dwelling at the true last page of a section — the transient "refused" CSS class
itself proved too fast (260ms) to reliably catch with polling in this harness, but the
two properties TASKS.md's acceptance criteria actually cares about (no navigation, no
lost selection) are both confirmed.

## M19.6 — the reading pane is resizable — 2026-07-30

New `readerPaneWidth` setting (`shared/src/schemas.ts`, `server/src/settings/store.ts`
— `0` is the "unset, use the spread-mode default" sentinel, same convention as
`digestTokenBudget`'s "0 = no ceiling"). Resolved by `ReaderPage.tsx` before `ReaderView`
ever mounts (same story as `spreadMode`) so a reader with a saved custom width never
sees a flash back to 800/1400px on reload — the acceptance bar this task named
explicitly, unlike `readerMargin`/`readerFontScale`, which *do* accept a brief flash
(existing, already-accepted precedent) since they're fetched inside `ReaderView` itself.

Deliberately a single override, not a fourth independent knob: `effectivePaneWidth`
replaces the spread-mode default outright when set, with `readerMargin` staying exactly
what it already was — a proportion *inside* the pane, unchanged — per decisions.md
2026-07-27's "`gap` may only mean gutter" ruling this task's own TASKS.md entry pointed
back to. A single drag handle (`.paneResizeHandle`, `ReaderView.module.css`) sits just
*outside* `.stage`'s own border — not at `right: 0` the way M10's drag-to-peel
`.edgeGrabRight` strip already is, so the two never overlap. Dragging updates
`readerPaneWidth` state directly (same "React state per pointermove" pattern
`ThreadPanel`'s own resize handles already use), which changes the CSS custom property
on `.wrapper` → `.readerRow`'s `max-width` → `.stage`/`.pageClip`/`.marginWrapper` all
resize in turn (flex-fill / 100%) → the **existing** `ResizeObserver` on
`marginWrapperRef` fires exactly as it does for a window resize or a margin-setting
change, running the integer-width pin and the debounced re-`display()` for free — no new
geometry code needed for "never produces the two-column-halves render" or "the last-page
skip does not reappear at any pane width", both already covered by the M16/M19.6
re-display fix and the pin's own `Math.floor`.

Dragging the right edge of a *centered* pane only moves that edge by half of any width
change (the row grows/shrinks symmetrically) — the handler doubles the pointer's own
delta so the edge tracks the cursor 1:1 instead of lagging at half speed; verified live
(a +150px cursor delta produced exactly +300px of pane width, confirmed via both the
rendered `.stage` box and the persisted setting value).

Live-verified: dragged the handle (+150px cursor delta), stage width grew by exactly
+300px, `GET /api/settings` showed `readerPaneWidth: 1100` (800 default + 300); a fresh
page load in a second tab showed the *same* 1056px stage width immediately, with no
flash to the 800px default; `rendition.location.start.displayed` after a forced
re-display was sane (`page: 1, total: 90`, no error). Settings modal UI intentionally
not extended for this — the drag handle is the primary, sufficient interaction surface,
per TASKS.md's own wording ("a drag handle on the pane edge"), not a form field.

## M19.6 — `r` opens the reader from the Scan and the Digest — 2026-07-30

Added as its own window-level `keydown` listener with its own `isTyping` guard in both
`ScanPage.tsx` and `DigestPage.tsx` — deliberately **not** a new shared mechanism, per
this task's own warning in TASKS.md ("do not add a fourth ad-hoc listener here... write
this one so it can be moved into [M19.7's registry] without changing behaviour"), since
M19.7 (the control system / shortcut registry) hasn't landed yet. On the Scan, `r`
literally reuses the existing `handleBackToBook()` (the same function the room's own
Escape key and its "← Book" affordance already call) — "the book currently in focus" has
an unambiguous answer there (the book the room is scoped to), so there was no new
navigation logic to write. Digest had no existing keydown handler at all; added one that
navigates to `/read/:id`, the same target its own "← Book" `Link` already points at.

Live-verified: `r` on `/scan/:id` and on `/digest/:id` both navigate to `/read/:id`; `r`
typed into the Digest's own brief textarea does not navigate (the isTyping guard) and
the textarea correctly ends up containing the literal "r"; `r` pressed on the Desk (`/`)
does nothing at all — not an error, not a guess — since the Desk was never given a
binding for it, matching "which book" having no answer there.

## M19.6 — full verify pass — 2026-07-30

Consolidated live pass (Playwright against the real running dev server, Alice fixture
only): 25 sequential page turns in single-mode/Paper with `pageNumberMode: "book"`
produced only 0-or-1 increments (0s where a click landed while the 420ms curl animation
still had `turnLockRef` held — the same lock-respecting behavior verified for M19.6's
original page-skip fix, not a defect) and zero jumps of 2+; created a highlight, reloaded
the page, confirmed the mark re-rendered (unanchored-free); clicked the mark to open its
thread panel and resized it via the new right-corner handle; changed `readerFontScale`
live via the settingsBus and confirmed no error; 10 page turns in auto-mode/Ink and 6 in
`prefers-reduced-motion: reduce` both completed with zero console/page errors. Full
project test suite (shared + server + web, 253 tests) and `pnpm build` both clean at the
end of this session. "Ask a question" was not exercised this round — no LLM provider is
configured in this environment, and that path is unrelated to anything changed here (all
prior M4/M5/M6 verification already covers it independently).

M19.6 is whole. Three items above (spread-divisor page-count fix, highlight-across-a-
page-boundary, resizable reading pane, `r`-opens-the-reader) plus the panel resize/quote
and book-wide-count redesigns close out the milestone's remaining checkboxes. Next up
per TASKS.md: M19.7, the control system.

## M19.6 — operator follow-up report, round 3: still can't reproduce the chapter-boundary
skip or the count jump — 2026-07-30 (later)

After the round-2 spread-divisor fix and the book-wide-count redesign above, the operator
reported the underlying symptom is **still happening**: the last page of a chapter still
gets skipped going forward, and the book-wide page count still jumps by 2 (not 1) crossing
into a new chapter — "without 1 click forward from the last page of Ch1, page goes up by 2
on page 1 of Ch2." Ran a much wider live diagnostic than either prior round before touching
any code, against the same running dev server the operator is actually using (confirmed the
server processes started *after* every relevant file's last edit, so it's serving the exact
code being reported on) — **it did not reproduce anywhere**:

- Both fixture books (Alice) and, for the first time, the **operator's own real book**
  (Kafka on the Shore — position backed up via the API before each run and restored via
  the API after, never touched by hand; see the data/ caution elsewhere in this repo's own
  operator guidance) across 13+ consecutive real chapter boundaries each run.
- Both `spreadMode`s (`single`, `auto`), the latter confirmed actually showing real
  two-page spreads (chapter totals roughly halved vs. single mode) at the widths tested.
- Viewport widths 700–1400px, plus a real CSS-zoom emulation (110% zoom, 1.25 device scale
  factor) — the one variable the round-2 entry above flagged as never having been swept.
- Non-default `readerFontScale` (1.2) and `readerMargin` ("wide") together, the specific
  combination the round-1 entry flagged as its own "not fully closed" untested variable.
- Three input paths: the footer nav button, real `ArrowRight` key presses, and genuine
  mouse clicks inside the right-hand turn zone (`page.mouse.click` at real screen
  coordinates, exercising the same `handleContentClick` + curl-snapshot path a real reader
  uses — not just the button).
- A rapid-fire stress case: 150 `ArrowRight` presses at 40ms apart (far faster than the
  ~420ms curl animation, simulating a held-down key) followed by resumed slow single-steps
  — settled cleanly with no corruption and a clean `+1` sequence afterward.

Every one of these came back with **zero anomalies**: every chapter's own last page was
actually reached (`chapterPage` hit `chapterTotal` before the section advanced) in every
`pageNumberMode: "chapter"` run, and every `pageNumberMode: "book"` run produced a strictly
`0`-or-`1`-per-click sequence (`0` only where a click landed inside the curl lock, the
same documented non-defect from the round-2 entry) with no `2`s, across several hundred
total page turns and 50+ real chapter transitions between the two books.

Also read the actual installed `epubjs@0.3.93` source (not just this repo's own comments
about it) to check the round-1 fix's mechanism against ground truth, since decisions.md
says the original cause is established and not to be re-derived, but a *second* report of
the same symptom after the fix landed is new information, not a re-derivation: confirmed
`DefaultViewManager.next()`'s `container.offsetWidth + layout.delta` vs. `scrollWidth`
comparison operates on **`this.container`**, which is `Stage`'s own internally-created div
(`managers/helpers/stage.js`), not `containerRef.current` directly — it's a *child* of our
pinned element, sized via `container.style.width` set once at `Stage.create()` and
re-derived on every `updateLayout()` call via `stage.size()` → `container.clientWidth`
(always integer per the CSSOM View spec, same reasoning the round-1 fix already relied on).
Traced this all the way through `updateLayout()` (called fresh, not cached, on every gap
change) and found no place where a non-integer value re-enters the calculation once our
pin is in place. This doesn't prove there's no bug, but it does mean the round-1 fix's
mechanism is sound as far as static reading can tell — nothing found here contradicts it.

**Not closed.** Two live-reproduction sessions in a row (this one and the round-1 entry
above) have now failed to trigger this symptom in headless Chromium despite substantially
different, deliberately adversarial sweeps each time, which is itself informative: whatever
triggers it for the operator is very likely something neither sweep has been able to
emulate — a real desktop browser's own sub-pixel/DPI handling, a specific OS/browser
combination, or a specific real-mouse click/drag pattern (as opposed to `page.mouse.click`'s
discrete, instantaneous synthetic click) are the leading remaining candidates, in that
order. **If this resurfaces, the fastest path forward is not another blind sweep** — it's
asking the operator for the exact conditions next time it happens: which book, which
`spreadMode`, the window/browser width, and whether the OS or browser has a non-100% display
scale or zoom active. Absent that, no further code change is safe to make here without
either reproducing it or getting a report specific enough to reason about deterministically
— speculatively touching the geometry code again risks trading a real, working fix for an
unverified one.

## M19.6 — round 4: the real cause of the chapter-boundary skip, and three more
operator-feedback fixes — 2026-07-30 (later still)

Round 3 above closed with "the fastest path forward is asking the operator for the exact
conditions." The operator's next report supplied exactly that: reading in a real desktop
browser at 90% zoom (not the 100%, integer-viewport-width conditions either headless
sweep tested), plus three further UI complaints from continued reading — the hover wash
still didn't read as strongly as the operator wanted, the boundary-crossing highlight
dwell fired on ordinary mid-paragraph selection drags, and highlight overlays were
visibly drifting off their text on a book whose text size had never been touched.

**The page skip.** Read `epubjs@0.3.93`'s `DefaultViewManager.next()` again with "90%
zoom" specifically in mind rather than re-running the existing sweep: its decision —
`container.scrollLeft + container.offsetWidth + layout.delta <= container.scrollWidth` →
scroll, else advance the section — is an *exact equality* on the second-to-last page of
every section (`(k+1)*delta` against `n*delta`). `offsetWidth` is integer per the CSSOM
spec, but `scrollLeft` is not: at a fractional device-scale factor, Chrome snaps the
*stored* scroll position to the nearest physical pixel, and epub.js's own
`scrollLeft += delta` bookkeeping accumulates that snap error on every turn rather than
resetting it. Confirmed by direct measurement, not just reasoning — a small instrumented
build (`Object.defineProperty` around the manager's `next`) reading real values while
paging through Kafka on the Shore at `deviceScaleFactor: 0.9` in Playwright (the round-2
and round-3 sweeps never varied this, since a Playwright viewport width is not the same
knob):

    spread 2 of 0..3  scrollLeft = 1025.5555555555555  expected 1025  delta = 1025
    left = scrollLeft + offsetWidth + delta = 4101.111  scrollWidth = 4100  -> ADVANCE

— the last page of the section is never rendered. At `deviceScaleFactor: 1` the identical
run reads `left = 4100.000 vs scrollWidth = 4100` and scrolls correctly. This is why round
1's fix (pinning `containerRef.current` to an integer pixel width) didn't close the
report: it removes a *different* sub-pixel source (the container's own measured width)
that happens to share a symptom, but the one that actually fires under real browser zoom
is `scrollLeft`, which that fix never touched. It also explains why two headless-Chromium
sweeps at DSF 1 (or CSS-zoom emulation, which does not affect `scrollLeft` snapping the
same way real DSF does) found nothing: they were testing the one condition under which
the bug cannot occur.

Fix: `web/src/reader/pageTurn.ts` (new, 12 unit tests — `decideTurn`, `spreadIndex`,
`spreadCount`, `chapterPageFromGeometry`, all pure functions of a `TurnGeometry`
snapshot). `installTurnFix` replaces `manager.next`/`manager.prev` with versions that
round `scrollLeft` to the nearest spread index first (tolerant of any sub-half-page
error) and scroll to *absolute* multiples of `delta` rather than relative offsets, so
nothing can accumulate turn over turn. Installed once per rendition, on the manager
directly, so every call site — footer buttons, `←`/`→`, the semicircular turn zones, the
highlight-across-a-boundary dwell — is covered without each needing to know about it.
The section-advance path re-expresses epub.js's own three-line `clear → updateLayout →
append/prepend → show` rather than delegating back to the original `next()`, because
delegating would re-run the exact comparison this fix exists to distrust: on a
*negative* sub-pixel error that comparison says "scroll" where the rounded decision says
"advance," and the browser would silently clamp the scroll to where it already is — the
turn would visibly do nothing. Verified against the installed epubjs source that this is
safe for every case actually in play here (reflowable, horizontal, ltr, paginated).

A second, related bug found while building this: a section doesn't always keep the
pagination it's first measured with — measured live (Kafka on the Shore, section 20) a
freshly rendered view expanded to 7 page views, then re-framed to 6 about 15ms later once
its web fonts finished loading and the text re-broke. epub.js's `reframe()` sets the
iframe's width to 0 on the way through, which collapses the container's scroll range and
the browser clamps `scrollLeft` to 0 — a turn that had just landed on "the last page of
the previous chapter" is silently dumped back at the section's start, which is the
book-count "+2" jump seen from the *other* end. Fixed with `reassertLanding`: a
section-crossing turn states its landing intent once and re-states it if the section
re-paginates within a 600ms window, self-removing its listener either way.

**The book-wide total/number moving on a chapter crossing.** The prior `bookPages.ts`
recomputed its `pagesPerWeight` calibration ratio from *every* measured section on every
relocate — so a fresh measurement anywhere moved the estimate for *every* other section,
including ones behind the reader that had already been shown a number. Reproduced live at
DSF 1 (so with no page-skip bug in play at all) reading forward through Kafka on the
Shore:

    turn 11  Page 34 of 246
    turn 12  Page 36 of 255     PAGE_JUMP +2   TOTAL_MOVED +9

matching the operator's own "52 → 54, then when I go back to '52' it's counted as 53" and
"the total page count changes when entering a new chapter" — one cause behind both
complaints. Rewritten as `bookPageMap` (`bookPages.ts`): calibrate once from one real
measurement (`buildBookPageMap`), then `recordMeasuredPages` only ever *borrows* pages
from not-yet-visited sections' estimates when a fresh measurement disagrees — nothing the
reader has already been shown moves. When there's nothing left to borrow from (typically
near the end of the book), the total moves by the leftover rather than silently lying,
and it moves monotonically when it does. `bookPages.test.ts` rewritten alongside it (14
tests) to cover the borrow/repay arithmetic directly, not just the old ratio-recompute
shape.

**The misaligned highlight overlay — the M19.6 diagnostic task that closed "not
confidently closed."** Round 1's diagnostic (rects match a live-resolved range exactly,
anchor is fine) still holds; what round 1 didn't have was a trigger that reliably left a
*stale* rect on screen for the operator to photograph. Found here: marks-pane's SVG rects
are drawn once from `range.getClientRects()` and only ever redrawn from epub.js's own
`Pane.render()`, called only inside `IframeView.reframe()` — which fires only when the
view's *expanded pixel width* changes. A reflow that re-breaks lines without changing
that width leaves every overlay describing coordinates that no longer contain the text
they're meant to mark. Measured live (Kafka on the Shore): nudging the iframe's body
font-size with the view's expanded width unchanged throughout moved the " weigh" text
from `(370.55, 701.72)` to `(882.75, 0)` while its overlay rect stayed at
`(370.55, 701.72)` — sitting on unrelated text one line below the real passage, exactly
what the operator's screenshot showed. A subsequent window resize did not repair it,
because the expanded width still hadn't changed either. Fixed with
`refreshHighlightOverlays` (`ReaderView.tsx`): walks the rendition's live views and calls
each one's `pane.render()` directly, sidestepping the `reframe()` gate entirely. Wired to
every real trigger found in this app: the deferred initial `themes.fontSize()` call once
the settings fetch resolves (explains why the operator saw this on a book they had *not*
resized text on — the very first application of the fetched font scale is itself such a
reflow), the debounced gap/margin/pane-width re-`display()`, a section's own late
re-pagination (`handleSectionRepaginated`, the same event `reassertLanding` above listens
for), and the iframe document's `fonts.ready` promise for late web-font loads.

**Hover still read weaker than the operator wanted.** The M19.6-original fix (this
file's own earlier "hover emphasises without obscuring" entry, 1.8×/0.6 cap) and a
mid-milestone bump (2.6×/0.85 cap, see the struck-through comment history in
`ReaderView.tsx`) were each in turn judged still duller than the vivid, fully-legible
`::selection` look right before a highlight is created — the actual bar the operator was
holding this to the whole time, stated outright this round instead of re-derived as a
multiplier: `hoverFillOpacity` (`highlightKinds.ts`) returns the kind's own colour at
full strength (paper) or 0.6 (ink stops short of full — `screen` over a dark page
*lightens*, so an undiluted wash there glares where `multiply` on paper only deepens).
Kind identity is preserved deliberately (honey hovers honey, not a shared selection
yellow), which a straight `::selection`-style highlight would have lost.

**The boundary dwell fired on ordinary selections.** The M19.6-original dwell ring armed
on "pointer is in the turn zone with an active selection," full stop — so a selection
dragged down the middle of a paragraph, nowhere near the page's actual end, would cross
into the zone and trigger a turn that read as a stray swipe rather than a deliberate
continuation. `pageTextEdge.ts`'s `cursorPastPageText` asks the layout engine directly
("what's the caret nearest this point?") rather than reconstructing column/line boxes:
compares the caret nearest the cursor against the caret nearest the page's bottom-right
(or top-left, for `prev`) corner via `caretRangeFromPoint`/`caretPositionFromPoint`: only
past the corner counts as past the page's text. Falls back to allowing the turn when
neither API exists, so an unsupported engine doesn't make the gesture silently
impossible.

**Live verification, this session.** Build (`tsc -b` across shared/server/web) and the
full suite (269 tests: 12 shared + 155 server + 102 web, including the 12 new
`pageTurn.test.ts` and the rewritten 14-case `bookPages.test.ts`) both clean. Then, since
this round's whole premise is "a condition neither prior sweep varied," drove the
*already-running* dev server (started independently of this session, confirmed serving
this exact working tree) with Playwright at `deviceScaleFactor` 1, 0.9, and 1.25 against
the Alice fixture — the one variable rounds 2–3 never had a lever for — 40/20/3 page-turn
sweeps respectively (fewer at higher DSF only because the saved reading position started
near the book's end): footer readouts stayed strictly `+1`-per-turn with the total only
ever moving in the same monotonic direction the new `bookPageMap` design allows (e.g.
`"Page 38 of 45"` → `"Page 39 of 46"` crossing into a new chapter — a `+1` page with the
total absorbing the newly-measured section, not the old design's multi-page jump), and
zero console/page errors at any scale factor. Read (not restored from within the
reader — used the same before/after API-backup pattern established in round 3) Alice's
real saved position before and after, confirmed unchanged by this pass. The other three
fixes (hover strength, dwell edge-detection, overlay refresh) were verified by code
inspection and the unit-test coverage named above rather than re-driven live individually
this session — each is a small, self-contained change with a clear mechanism, and the
combined page-turn sweep above exercises the same rendition/manager machinery
`refreshHighlightOverlays`'s triggers hang off of without incident.

M19.6 is now whole with no open blockers. Next up per TASKS.md: M19.7, the control
system.

## M19.7 — overlay motion: `AnimatePresence mode="wait"` hides a resize from an
ancestor's `layout`, and cross-boundary propagation needed `LayoutGroup` — 2026-07-31

Building the shared `FlyPanel` (fly from the invoking control's rect, `layout` left on
for later resizes — decisions.md 2026-07-30 "Popups slide from where they were called")
and wiring it into `SettingsModal` surfaced two real, non-obvious Framer Motion behaviors
neither guessed at nor found in a skim of the docs — both confirmed by isolated repro
before touching the real component, per OPUS.md's rule.

**`AnimatePresence mode="wait"` on the settings tab-content swap silently defeated the
outer panel's `layout` resize.** `SettingsPage.tsx`'s tab panel used `mode="wait"`
(exiting tab plays its full exit animation, still in normal document flow, before the
entering tab mounts). With `wait`, the outer `FlyPanel`'s own `layout` prop measured no
size change for the tab panel's entire ~200ms exit — the swap only registers as one
already-complete DOM mutation once the exiting element is finally removed and the new one
mounts, which happens outside a commit `layout`'s projection system was watching for a
gradual delta. Result: the panel snapped straight to its new height with `transform: none`
throughout, instead of morphing. Framer's docs do call out `mode="popLayout"` for exactly
this ("having the exiting component be removed from the flow of the document
immediately... rather than waiting for the exiting component's exit animation to
finish") — switching to it fixed the *inner* tab-panel's own transition immediately, and
is very likely a straightforward win for any AnimatePresence⁠+⁠layout combination in this
codebase going forward.

**`popLayout` alone did not fix the *outer* `FlyPanel`'s morph — that needed an explicit
`<LayoutGroup>`.** A minimal isolated repro (a bare `motion.div layout` sibling wrapping
an `AnimatePresence mode="popLayout"` tab swap, no other app code) morphed correctly with
no `LayoutGroup` at all — so the mechanism *can* propagate a size delta up through an
ancestor with no special scoping. But the real `SettingsModal`/`SettingsPage` tree,
unmodified otherwise, kept snapping (`outerTransform` stayed `"none"` for the whole
window, height jumping straight to its final value) even after `popLayout` landed and the
*inner* tabpanel was visibly, correctly animating its own crossfade. Progressively adding
complexity to the repro (a backdrop `AnimatePresence` wrapper, intermediate plain divs
matching `.page`/`.dividers`/`.pageArea`, async-loaded content matching `ProviderPicker`'s
own `fetch`) never reproduced the real snap in isolation — every enriched repro still
morphed cleanly. (One apparent repro along the way was a false alarm: a debug harness
button sat under a z-index-heavier backdrop, so the click never landed and the height
never changed at all — worth flagging since it looked exactly like a "worse" case of the
real bug until traced.) What actually closed the gap was wrapping `SettingsModal`'s
`FlyPanel` + its content in Motion's `<LayoutGroup>` — undocumented, in this specific
case, as to *why* the real tree needed it and the minimal one didn't; the working theory
is that the real tree's many other independently-registered `motion`/`layout` components
elsewhere in the app (ProviderPicker, sliders, other popovers) share Framer's default
global projection tree, and something about that larger tree's bookkeeping loses track of
a projection node several plain-`div` boundaries down without an explicit group scoping
it — but this is inference, not a traced root cause, and is written down as exactly that
rather than dressed up as one.

**Practical takeaway for the next `layout` consumer in this codebase:** don't trust a
toy repro's success as proof a `layout` animation will hold up once wired into the real
app — verify against the actual component tree, not just a plausible-looking stand-in.
If a `layout` resize snaps instead of animating and the element and its resizing child
both already have `layout` set, `<LayoutGroup>` around the pair is a cheap, low-risk next
thing to try before assuming the feature itself is broken.

Live-verified end to end via Playwright against the real dev server (both a fresh full
restart and, separately, HMR-live edits, to rule out stale state as a factor) rather than
by reading the code: sampled `getComputedStyle(...).transform` and
`getBoundingClientRect()` at ~10–15ms resolution through the whole ~250ms window for (a)
the entrance fly from two different real trigger call sites (the desk nav link and the
reader's provider-picker "Settings →" click-through, `useOpenSettingsToLLM`) — confirmed
genuinely different origin rects producing genuinely different mid-flight transforms, not
a hardcoded corner; (b) reduced motion — confirmed identity transform (no movement) at
every sampled frame, only opacity changing; (c) the settings tab-switch resize — confirmed
a real interpolating `matrix(...)` across the whole transition, converging smoothly rather
than snapping. 280/280 tests, `pnpm build` clean. One settled-state screenshot (Paper,
nav-link entrance) confirmed the visual result looks correct and unbroken; a full
screenshot pass across both themes was attempted but blocked by an unrelated tool issue
(image reads erroring) this session — worth a quick human look before calling the visual
polish fully signed off, though nothing in the numeric verification suggests a problem.

## M19.8 — the refactor: before-table, picked back up 2026-08-01

Deferred 2026-07-30 "not cancelled" (TASKS.md). Picked up on operator request. Re-measured
before touching anything, per `docs/REFACTORING.md`'s method — the 2026-07-29 numbers
TASKS.md quotes (1,865 lines / 64 hooks) are now stale; M19.6 round 4 and all of M19.7
landed on top of them.

**Before table (2026-08-01, `git log` at `0dcd829`):**

| Metric | 2026-07-29 (TASKS.md) | 2026-08-01 (actual, before) |
|---|---|---|
| `ReaderView.tsx` lines | 1,865 | **2,469** |
| Hook calls (`useX(` total) | 64 | **57** (19 `useEffect`, 12 `useState`, 11 `useCallback`, 9 `useRef`, 6 named custom hooks) |
| Next-largest source file | — | `shared/src/schemas.ts` 927 lines (a schema file — "fine" per REFACTORING.md), then `ThreadPanel.tsx` 801 |
| `ReaderView.tsx` vs. next-largest *component* | 3.4× | **3.1×** (2469 / 801) |
| Total tests | 214 (TASKS.md) | **283** (12 shared + 158 server + 113 web), all green |
| Reader-specific unit tests | — | 38, all on already-extracted pure modules (`bookPages`14, `pageTurn`12, `pageNumber`5, `anchorResolution`7) — **zero direct coverage of `ReaderView.tsx` itself** |
| Bundle (`pnpm build`) | M17.5: 20 files, 1072 KB raw, 322 KB gzip | **21 files, 1138 KB raw, 345 KB gzip** |
| `ReaderPage` chunk | M17.5: 670 KB raw / 191 KB gzip | **619.53 KB raw / 179.30 KB gzip** (down, despite the file growing — other chunks absorbed M19 work) |
| Live verification | — | See below |

Hook count dropping while line count grew ~600 lines tracks with M19.7's "shortcut
registry" work (`decisions.md` 2026-07-30): four ad-hoc window-keydown listeners collapsed
into one `useShortcuts([...])` call, trading effects for a declarative array — fewer hooks,
more lines, same behaviour.

The file is still the clear, single outlier the 2026-07-29 measurement found — now 3.1×
the next-largest component (was 3.4×) — so the scope call from that day (one narrow
target, not a broad refactor) still holds.

**Live-verification baseline**, ad hoc `playwright-core` install in scratchpad against the
project's own real dev server (already running, `localhost:5173` → `:5175`, the same
"already-cached Chromium" pattern earlier sessions used — no project dependency added),
real data (the operator's actual "Alice's Adventures in Wonderland" with 14 existing
highlights, not a fresh import): opened `/read/<alice-id>`, arrow-key page turns (curl
animation played, screenshots confirm), a scene-break page rendered correctly after 3
turns, click-zone turn (right edge) and back (left edge) both worked, a window resize to
1000×700 and back reflowed cleanly, `Escape` cleared pending UI state. One pre-existing
console message unrelated to the reader (`404` on an unrelated resource, matches the
M17.5-era known gap). Screenshots saved under the scratchpad for comparison against the
after-pass. Did not exercise the LLM-backed Ask flow this pass (no `ANTHROPIC_API_KEY` in
this shell) — covered instead by the acceptance criterion "no user-visible change", which
a structural-only refactor can't affect regardless.

**Plan for this pass**, scoped by TASKS.md's own permission to prioritise what M20's fold
touches and treat the rest as optional: extract (1) the pure stage-geometry functions/
constants (`computeReaderGap`, `turnZoneForVisibleX`, the margin/spread constants) into a
tested module — these currently have zero unit coverage despite being pure; (2) the
page-turn/curl animation (`turnPageSlide`/`turnPageCurl`/`turnPage`/
`handleEdgePointerDown`, the curl motion state) into its own hook — this is exactly what
M20 operates on; (3) fullscreen chrome-reveal and the pane-resize-width drag as two more
self-contained hooks, since both have clear inputs/outputs and no epub.js entanglement.
The ~780-line book-lifecycle/rendition effect is **not** attempted this pass — it is
deeply entangled with nearly every other piece of state in the component (turnPageRef,
chapterJumpRef, applyGapForWidthRef, highlightsRef, displayedPageRef, and more, all
threaded through refs specifically so this one effect only runs once per `resourceId`),
and multiple NOTES.md entries above document load-bearing quirks inside it that took a
live session each to diagnose. Splitting it safely needs its own dedicated pass with
characterization tests written first, not a subtask of this one. Recorded here so the
scope-cut is a choice, not a thing that quietly didn't happen.

## M19.8 — the refactor: after-table and verification, 2026-08-01

Four extractions landed, one per commit, each: moved verbatim, typechecked, `pnpm test`
green, `pnpm build` clean, then live-verified against the real dev server before the next
one started (per REFACTORING.md's "small, reversible steps" — never more than one step
red).

1. **`readerGeometry.ts`** — `computeReaderGap`, `turnZoneForVisibleX`, and the margin/
   spread constants. Pure functions with zero prior unit coverage; 10 characterization
   tests added alongside the move (combining "thicken the net" with "decompose" for this
   piece specifically — the function only became testable in isolation once it had its
   own module, and writing the test in the same commit as the move is still "move before
   improve": the test asserts what the code already did, nothing about the code changed).
2. **`usePageTurnAnimation.ts`** — the M7 slide, the M10 snapshot curl, and the drag-to-
   peel gesture (`handleEdgePointerDown`). The exact seam M20 operates on. Owns
   `curlProgress`/`curl`/the turn lock/the low-fps downgrade; takes only `renditionRef`
   and `containerRef`.
3. **`useFullscreenChrome.ts`** — fullscreen mode, the three proximity-reveal flags, and
   the Fullscreen API wiring. Returns its setters as well as its values, since the
   still-inline iframe-forwarded mousemove handler (inside the untouched book-lifecycle
   effect) drives the same three flags from iframe-relative coordinates — documented on
   the hook itself so a future reader isn't surprised the setters are part of the public
   shape.
4. **`useReaderPaneWidth.ts`** — the pane-resize drag handle and the derived effective
   width. The persisted `readerPaneWidth` value itself stays in `ReaderView`, since it's
   synced together with `readerMargin`/`readerFontScale`/`pageNumberMode` by the same
   settings-fetch and settingsBus-subscription effects — splitting the *setting* out
   would have meant splitting that shared sync effect too, which is exactly the kind of
   entanglement this pass was scoped to leave alone.

**After table:**

| Metric | Before (2026-08-01) | After (2026-08-01) | Change |
|---|---|---|---|
| `ReaderView.tsx` lines | 2,469 | **2,089** | −380 (−15%) |
| Hook calls in `ReaderView.tsx` | 57 | **40** | −17 (−30%) |
| `ReaderView.tsx` vs. next-largest component (`ThreadPanel.tsx`, 801 lines) | 3.1× | **2.6×** | |
| New extracted modules | — | 4 files, 519 lines total (readerGeometry 70, usePageTurnAnimation 219, useFullscreenChrome 135, useReaderPaneWidth 95) | |
| Total tests | 283 | **293** | +10 (all in readerGeometry.test.ts) |
| Bundle (`pnpm build`) | 21 files, 1138 KB raw, 345 KB gzip | 21 files, 1139 KB raw, 346 KB gzip | ~unchanged (1 KB — code motion, not new code) |
| `ReaderPage` chunk | 619.53 KB raw / 179.30 KB gzip | 620.12 KB raw / 180.02 KB gzip | ~unchanged |

Every commit's tests were green before the next started; nothing was red for more than
zero steps.

**Live verification** (same ad hoc `playwright-core` setup as the before-pass, same real
dev server and real "Alice's Adventures in Wonderland" with its 14 existing highlights),
one pass per extraction plus a final combined pass covering the milestone's own list:

- **Import/open**: reader loads at the saved position with all 14 annotations present.
- **Turn**: keyboard arrows and click-zone turns both advance correctly, curl animation
  plays (confirmed via `usePageTurnAnimation`'s own live check after its commit,
  screenshots show the chapter/page number advancing correctly through the turns).
- **Resize**: 1400→1000→1400px reflows cleanly, no split-column artifacts.
- **Spread awareness**: narrowing to 700px (below `SPREAD_MIN_WIDTH`) collapses to a
  single centered column; widening back to 1400px restores the two-page spread —
  `readerGeometry.ts`'s exact job, confirmed with the real reader, not just its unit
  tests.
- **Theme**: paper → ink → paper all apply correctly to both the chrome and the epub.js
  iframe content.
- **Fullscreen**: shift+F hides the chrome (top row, footer, rail) and the proximity
  reveal on hover-near-edge still works, confirmed both right after
  `useFullscreenChrome`'s own commit and again in the final combined pass.
- **Pane-width drag**: confirmed twice — once reading `--reader-max-width` directly
  before/after a drag (1284px → 1572px on a +144px pointer delta, correct 1:1 tracking
  per the doubling comment), and once visually in the final pass.
- Selection/highlight-creation (the Ask pill) was **not** confirmed automated this pass —
  the scripted drag-select over a verse-formatted paragraph didn't reliably trigger a
  native browser selection headless, a test-harness limitation, not a reader one. Low
  risk: that code path lives entirely inside the untouched book-lifecycle effect, and
  none of the four extractions touch selection, highlighting, or the LLM/Ask flow at all.
  Worth a quick human click-through before trusting it fully, same caveat as the
  before-pass recorded for the LLM-backed Ask flow.
- One console message throughout, unchanged from the before-pass and pre-existing: a 404
  on an unrelated resource's cover image.

**Structure**: measurably better against every metric REFACTORING.md names. **Behaviour**:
identical everywhere checked. **Bundle**: flat.

**Scope not attempted, recorded as a deliberate cut (see the plan note above and
REFACTORING.md's own "worked example")**: the ~780-line book-lifecycle/rendition effect —
book loading, selection handling, highlight anchoring/resolution, position tracking, TOC
building, the mark-hover/click hit-testing, the highlight-across-a-boundary dwell. This is
most of what's left in `ReaderView.tsx`'s 2,089 lines. It is the one seam this pass
prioritised *against* touching, per TASKS.md's own permission ("a piece the fold never
goes near is optional") — M20's fold operates on page-turn/snapshot, stage geometry, and
spread awareness, all four of which are now isolated. The remaining effect is navigation/
selection/highlights, not page-turn machinery, so the fold shouldn't need to enter it.

**Payoff-test prediction, to check when M20 actually lands**: M20's fold should touch
`PageCurl.tsx`, `usePageTurnAnimation.ts` (not a 780-line component body), and
`readerGeometry.ts`'s spread constants — three small, focused files instead of reading
and editing inside the pre-refactor 2,469-line `ReaderView.tsx` to find the same logic.
If the fold still needs a large `ReaderView.tsx` diff alongside those three files, this
refactor missed its target and that's worth saying plainly when M20 is done.

## M20 — the paper fold: payoff-test result, and a real overshoot bug found live — 2026-08-01

**Payoff-test answered.** The prediction above held. The fold's implementation touched
`PageCurl.tsx` (rewritten as a canvas component), `usePageTurnAnimation.ts` (rewritten:
corner tracking, live fold pointer, spread-aware leaf rect), `readerGeometry.ts` (added
`nearLeafRect`), and a new `pageFold.ts` (the geometry itself — perpendicular-bisector
fold, polygon clipping, reflection, the canvas paint routine — pulled out as its own file
rather than folded into `PageCurl.tsx`, since it's pure and unit-testable on its own).
`ReaderView.tsx`'s diff was exactly wiring: the hook's destructure, `<PageCurl>`'s props,
and swapping the `.edgeGrab` strips for `.turnGrabSurface` — under 40 lines, none of it
inside the 780-line book-lifecycle effect the M19.8 pass deliberately left alone. The bet
paid off as specified.

**A real bug, found only by actually dragging it in a browser.** `syntheticFoldPointer`
(the programmatic click/keyboard turn's synthetic pointer path) swept the pointer from the
grabbed corner through the opposite corner and 1.6x past it, chosen by eyeballing "looks
like it goes well past the edge." It doesn't: the fold line only fully clears the
*opposite* corner (the last point of the page rect to flip sides — see the derivation now
in `pageFold.ts`'s `SWEEP_OVERSHOOT` comment) once the sweep reaches **2x** the
corner-to-corner diagonal. Below that, a sliver of the old page — however thin — never
folds away, for the entire remainder of the animation. Unit tests alone didn't catch this
(nothing asserted "fully empty at progress 1" before this pass); it surfaced live-testing
a real page turn in a real browser (Playwright + a cached headless Chromium, no
`chromium-cli` or system browser available in this environment, so a scratch
`playwright-core` install pointed at `~/.cache/ms-playwright` did the job), watching a
persistent triangular remnant in the corner that a fixed-duration animation should have
long since covered. Fixed by raising the constant to 2.2x and adding a regression test
(`pageFold.test.ts`, "fully covers the leaf by progress 1") that checks `restPolygon` is
empty at progress 1 for all four corners and a few aspect ratios — the geometric property
itself, not a screenshot, so it can't regress silently again.

**Verified live** (Alice's Adventures in Wonderland fixture): spread mode folds the near
leaf only, the far leaf stays flat (checked both directions, both edges); the widened
M11-shaped grab surface anchors to the nearest corner (bottomRight, topLeft both
confirmed); a drag past the commit threshold turns the page (chapter boundary crossed
cleanly, Ch. VII → Ch. VIII) and a small drag springs back without turning (page number
unchanged); single-page mode (narrow viewport) folds the whole stage, not a leaf-half;
reduced motion mounts zero grab-surface elements and zero canvas at any point in a turn.
Not confirmed: an exhaustive light/dark **reading-theme** comparison — the app's paper/ink
toggle didn't visibly change the reading pane background under scripted automation (worth
a human click-through separately; unrelated to the fold itself, which paints whatever the
snapshot bitmap already contains and carries no theme-specific color logic beyond a
neutral dark dim/shadow that works directionally on either scheme).

## M20 revisited — the roll, and why the first pass could not have been seen — 2026-08-01 (Opus)

**The operator's read was right and the fault was upstream of the code.** The shipped
fold implements decisions.md 2026-07-20 faithfully; 2026-07-20 specified the wrong shape.
A perpendicular-bisector fold is a *creased* sheet, and no peeled page creases. Amended
in decisions.md 2026-08-01 to a rolled sheet — flat, half-turn roll, flat mirrored tail —
which is still closed-form 2D and still no mesh, because in the fold frame the whole
deformation depends on one scalar and every band of constant value stays a straight line.

**The thing that took longest to work out, recorded so nobody re-derives it.** The
obvious next step after "make it roll" is "now you can see the page's text bend into the
curl, like Apple." You cannot, and it is a *theorem*, not a tuning problem: the tail
projects from the roll's far end back **across** the crease, so whatever front-facing
sheet the roll leaves showing ends up underneath the tail. Orthographically the visible
parts are exactly the flat page, the tail, and the roll's back-facing lip — nothing else.
Two dead ends were followed before this was clear:

- *Tighten the roll so it comes back short of the crease.* It does (`ROLL_EASE`), and the
  gap it opens is real, and the tail covers all of it. What the exponent actually controls
  is the shape of the lip, which is worth having, but not what it was reached for.
- *Add perspective.* This is the mechanism that genuinely uncovers the band — the tail
  floats, so a real camera sees under its near edge — but the band it opens is
  `|crease offset from view centre| x tail height / camera distance`, which at any
  believable camera distance is a handful of pixels. Getting Apple's band out of it needs
  a camera roughly one roll-diameter from the page. It also breaks the drag: perspective
  magnifies the tail about the view centre, so the grabbed corner stops landing under the
  pointer by ~13px laterally on a 480px leaf, and correcting that means moving the crease
  sideways, which changes the fold's character. Dropped deliberately. Apple's is a 3D
  scene and, per the 2010 reverse-engineering of iBooks, a *conical* deformation — a
  per-vertex mesh warp. That is a WebGL conversation to have on its own terms.

**A real bug the flat fold shipped with, found the moment pixels were visible.** In
spread mode the snapshot covers the whole stage — two leaves in one epub.js iframe (M12) —
and `drawPageFold` blitted all of it into the *one* leaf that turns, so the turning sheet
carried both pages squeezed to half width. Fixed with `leafSourceRect`, pinned by a test.
It survived the original M20 verification pass because that pass could not see the fold's
pixels at all, which is the next entry.

**Why the first pass could not have been seen: html2canvas renders blank here.**
`capturePageSnapshot` uses `foreignObjectRendering: true` (M10, to dodge a real hang
cloning epub.js's sandboxed iframe). In headless Chromium — both the bundled headless
shell *and* the full `chrome-linux64` binary with `--headless=new` — that path returns a
canvas that is **fully transparent**: probed directly against the live dev server, 0 of
1600 sampled pixels had any alpha. So every "verified live" screenshot of the fold, in
this pass and the last, was a fold drawn over an empty bitmap: the geometry was real, the
shadows were real, and there was nothing between them. The first pass's clean report is
consistent with this and should be read that way, not as a contradiction.

Two workarounds, both used here and both worth keeping:

1. **A standalone harness** (`pageFold.ts` bundled with esbuild + a synthetic book page
   on a canvas) is the surface the *look* was actually developed and judged on. Same
   code path, real bitmap, screenshot-able, and it iterates in seconds rather than
   through a page turn. Every visual constant in the file was chosen there.
2. **A stand-in bitmap in the live app** — an `addInitScript` that paints a page into
   html2canvas's output canvas when it comes back empty. Everything downstream is the
   app's own (leaf rect, dpr, corner choice, the rAF loop, spread split), only the pixels
   are substituted. This is what confirmed the wiring, the drag, and the spread fix live.

**Perf, measured, in a software rasterizer — so read the ratios, not the absolutes.**
760x1000 leaf at dpr 2, per `drawPageFold` call, median over a full sweep:

| | median | p95 |
|---|---|---|
| flat fold (arc 0, i.e. the old model) | 5.9ms | 16ms |
| rolled sheet, first working version | 39ms | 62ms |
| rolled sheet, tuned | 15ms | 35ms |

Two things got the 39 → 15, and only one of them was the obvious one. **Bounding the
`source-atop` passes** to their own bounding box instead of `fillRect(0, 0, width,
height)` was worth ~12ms on its own — a full-canvas composite is millions of pixels a
frame for a wash that only ever lands on the curl. **Choosing the band count from the
roll's size on screen** (`bandCount`, 8 device px per band on the visible lip, 40 on the
overdrawn near half) was worth ~11ms more, and is invisible: a side-by-side render at 8px
and at ~2.5px per band is indistinguishable, because the lip's shading is a gradient and
the bands only quantize the ghost showing through the back of the sheet. Two things that
looked like they should have mattered and did not: clipping each band polygon to the leaf
(neutral), and the `drawImage` source-rect overload (neutral, though the cheap overload is
still taken in single-page mode on principle).

The rolled sheet is ~2.6x the flat fold. The M10 low-fps guard (`avgFrameMs > 33` →
permanent slide) is untouched and will now trip on machines nearer the line, which is the
correct failure. **Not verified here and wanted from the operator:** whether the turn
holds 60fps on the Mac with a GPU, and whether it reads as paper in a real reading
session rather than in a screenshot.

## M20 — the capture: why three passes verified nothing — 2026-08-02 (Opus)

**The operator's screenshots were readable as a diagnosis before any code ran.** The
lifted sheet was a translucent grey wedge with the page's text fully legible *through* it
and no mirrored glyphs anywhere. A working snapshot's tail is a single undistorted blit at
full opacity — it would occlude, not tint. So what was on screen was the fold's shadows
and nothing else: `castShadow` paints blurred fills regardless of source pixels, while
every `drawImage` of the sheet blitted a transparent bitmap.

**The mechanism, and why 2026-08-01 got it half right.** That entry recorded the blank
capture as a *headless Chromium* limitation and left open whether it would reproduce on
the Mac. It reproduces everywhere, necessarily. html2canvas's `foreignObjectRendering`
serializes into an SVG and paints it through an `<img>`, and an SVG rendered as an image
runs in **secure static mode**, which cannot host a nested browsing context. Probed
directly, in the same Chromium the operator's Arc is built on:

| probe | opaque | ink |
|---|---|---|
| iframe inside `<foreignObject>` — html2canvas's exact path | 1.0 | **0** |
| the iframe's own document serialized instead | 1.0 | 0.046 |
| control, no iframe | 1.0 | 0.018 |

The app measured *fully transparent* rather than opaque-and-inkless only because
`backgroundColor: null` and the paper background lives on `.stage`, outside the captured
element. Same mechanism.

**Four silent failures on the way to a working capture, all measured.** Each produced a
plausible bitmap that was wrong, which is the reason this file gets an entry rather than a
line:

1. **Overflow propagation.** epub.js paginates with `body { width: <viewport>; columns;
   overflow: auto hidden }`. That only works because a *root* element's body propagates
   its overflow to the viewport and is itself then treated as `visible`. A copied
   `<html>`/`<body>` inside a `foreignObject` is not the root, so it clips for real, and
   the window we translate to lands past the clip. Symptom: **correct on page 1, blank on
   every other page** — 0% ink at `scrollLeft` 5510, 11.4% with
   `html,body{overflow:visible !important}`, 8% at `scrollLeft` 0 either way. This one
   would have shipped: page 1 looks fine.
2. **CSS in an SVG document is document-wide.** A `<style>` inside a `foreignObject` is
   not scoped to it, so the book's own stylesheet reaches marks-pane's `<svg>` and kills
   the highlights. 0% wash sharing one document, 5.7% in two, screen 6.35%. Paint order
   was ruled out first — reordering the markup and `z-index: 99` both changed nothing,
   which is what pointed at the cascade instead.
3. **Those overlays still need a `foreignObject`.** marks-pane sizes its `<svg>` with an
   inline *CSS* `width: 7714px !important`, which means nothing in SVG context: nested
   under a `<g transform>` it keeps the default 100% viewport and clips away every rect
   past it, and the rects sit at x ≈ 6114 in a 1102-wide viewport. 0% again.
4. **A blob-URL SVG taints the canvas.** `getImageData` and `toDataURL` both throw
   `SecurityError`; a data URL does not. Tested before writing the module rather than
   after, which saved finding it as a `samplePaperColor` crash later.

**Verification, and the standard worth keeping.** Pixel-diff against a CDP screenshot of
the same rect: **0 differing pixels, mean channel delta 0**, on a page with highlights and
one without. Capture ~22ms. Then a real drag (`Input.dispatchMouseEvent`, press → moves →
screenshot while held) to confirm the whole path: the sheet carries mirrored text and the
highlight wash, for the first time in three passes.

**Two things that screenshot also shows, both left open deliberately.** The fold canvas is
offset from the leaf it depicts by exactly one reader margin (`PageCurl`'s wrap is
positioned inside `.pageClip` but sized from `containerRef`, which sits inside
`.marginWrapper`'s padding), and its bottom edge stops a margin short of the paper card.
And the peel reveals a pixel-identical copy of the page being peeled, because
`handleGrabPointerDown` does not advance the rendition until commit. Both are in
PAGE_CURL.md §2 and belong to the next pass.

**Dependency removed:** html2canvas, this having been its only call site.

**Still wanted from the operator, unchanged:** whether the turn holds 60fps on the Mac
with a GPU — everything timed here is still a software rasterizer.

## M20 — the card, the reveal, and the edge peel — 2026-08-02 (Opus, step 2 of 3)

**What was actually wrong with the registration, in one line:** `PageCurl`'s wrap is
positioned inside `.pageClip`, so its `left`/`width`/`height` are `.pageClip`'s
coordinates — and the leaf rect handed to it was measured from `containerRef`, one
`--reader-margin` further in. Measured live before the fix: canvas `[670, 95, 519, 598]`
against a leaf at `[710, 95, 519, 598]`. After: canvas `[698, 95, 681, 721]` against a
card `[17, 95, 1362, 721]`, i.e. exactly the card's right half in spread mode, and
exactly the card in single-page mode (`[17, 95, 822, 721]` at a 900px viewport).

**The acceptance test, restated so it can be re-run.** Screenshot the card, drag with a
real pointer, screenshot the card again while still held, and diff. Because the drag now
advances the rendition, the live DOM under the canvas is a *different page* — so any part
of the turning leaf the fold has not peeled must still come back pixel-identical to the
baseline, and a canvas off by a margin cannot manage it. At dpr 1: **the turning leaf's
unpeeled half scores 0 differing pixels, mean channel delta 0.00008; the inner-edge strip
scores 0; the band below the text block carries 0 ink in both frames.** Before the paper
fix the inner-edge strip was 14.9% differing.

**Two measurement traps, both of which cost real time here.**

1. **`MAX_CAPTURE_SCALE` is 1.5, and the display is 2.** So the fold blits a 1.5x bitmap
   onto a 2x canvas and *cannot* be pixel-identical to live DOM: at dpr 2 the same test
   reads 13-18% differing with a mean delta around 8, all of it glyph-edge resampling,
   and a naive reading of that looks exactly like a registration bug. The 2026-08-02
   entry's "0 differing pixels" is a dpr-1 statement. Run this test at dpr 1.
2. **`samplePaperColor` is the wrong instrument for the margin fill.** It downscales to
   8x8 and takes the per-channel median, which on a page of prose averages ink into every
   tile: rgb(228,225,218) against the card's real rgb(250,247,240). It looked fine in the
   fold's own back-of-sheet material (which lifts toward white anyway) and read as a
   visible band the moment the sheet lifted next to the real margin. Fixed by asking the
   card element for its computed background — `resolveCardPaper` walks up because
   `.pageClip` is transparent and `.stage` is what paints `--color-bg`.

**A testing hazard worth writing down: do not script a drag under reduced motion.** Under
reduced motion the grab surfaces are not rendered at all (deliberate, M10), so a scripted
`mouse.down` on the page edge lands on the sandboxed epub.js iframe — the exact M10
tab-crash path — and the harness hangs on the next `mouse.move` with no error until the
browser is killed. The reduced-motion invariant is better checked without a drag: turn
with the keyboard and sample `document.querySelectorAll("canvas").length` on an interval
through the turn. Result: **max 0 canvases at any point, 0 grab surfaces, page still
turns** (23 → 24).

**Spring-back ordering, which is not a free choice.** Stepping the rendition back *after*
the spring-back animation flashes the un-turned-to page full-screen, because the fold
paints nothing once the pointer is back on its anchor — so the canvas is transparent for
however long epub.js takes to re-render. Stepping back first costs only the shrinking
opening briefly showing the page it is returning to, mostly under the roll's shadow.
Verified: a 6%-of-leaf drag advances 22 → 23 mid-drag and lands back on 22; a 10% drag
commits and stays on 23.

**The edge peel is an anchoring change, not a second model.** `computeFold` now takes a
`FoldAnchor` and asks it for a point; everything downstream is unchanged, and the
"lands the grabbed anchor exactly under the pointer" property is stated for both kinds.
Keeping the crease parallel to the spine is one line — pin the fold pointer's `y` to the
anchor's, which makes `peelDir` horizontal — and it is applied to the *fold* pointer
only, so drag progress still follows the real cursor wherever it goes. `SWEEP_OVERSHOOT`
needed no change: with a vertical crease the last points to flip are the two far corners,
whose projection onto the peel direction is exactly the sweep's target, so the corner
case's inequality holds with a tie.

**Verified live** (Kafka on the Shore, and one pass on Alice): registration in spread and
single-page mode and in both directions; the peel opening onto the next page rather than
a copy of the departing one (visible as the revealed strip between crease and tail
carrying different text); spring-back restoring the same page; an edge grab lifting the
whole edge with a vertical crease; reduced motion mounting zero canvases; the fold
harness still loading and rendering all 7 states after the anchor change.

**Not verified, and honestly out of reach here:** frame cost on real GPU hardware (still a
software rasterizer, unchanged since 2026-08-01), and how any of this *feels* in a reading
session rather than in a screenshot. Also not attempted, deliberately: any tuning of the
roll's look, since step 3 replaces the renderer.

**One consequence to keep an eye on, recorded rather than fixed.** In spread mode
advancing at grab time re-renders *both* leaves, so the far leaf visibly changes while the
near one is still being peeled. That was already true of every click turn (`turnPageCurl`
has always advanced first) and is invisible on a single page, but a drag holds it on
screen for as long as the reader holds the pointer. The honest fix is the spine work in
step 3, where the far leaf stops being "flat and undisturbed" anyway.

## M20 — the stuck curl: what is known, and what is still a guess — 2026-08-03 (Opus)

Operator report: a drag that doesn't go far enough sometimes leaves the curl frozen
mid-peel; when that happens page turns stop responding to the cursor, and a click clears
it. Written down now because the diagnosis is partly evidence and partly inference, and
the next session should know which is which.

**Not reproduced on demand.** Scripted short drags spring back correctly every time
(22 → 23 → 22, both directions, both books, spread and single). So the trigger is
unidentified, and the first task of step 3 is an instrumented reproduction, not a fix.

**Certain, from the code.** `handleGrabPointerDown`'s `onUp` ends with `setCurl(null)`
and `turnLockRef.current = false` — its last two statements, after a run of unguarded
`await`s: `await opened` (which contains the capture *and*, since 2026-08-02, a
`rendition.prev()`/`next()`), then an `animate`. If any of those rejects or never
settles, neither statement runs, and the two symptoms follow mechanically: a canvas left
mounted showing a half-peeled page, and a turn lock held forever so every later turn is a
silent no-op. There is no `finally`, no watchdog, and no bound on the lock's lifetime;
the only deadline anywhere in the path is the capture's own (M10), which covers the one
step that already cannot hang.

**Reproduced, and it explains the "click to undo" detail exactly.** Removing the grab
surface while the pointer is down — which React does whenever a re-pagination flips
`status` to `loading` — releases pointer capture implicitly. The pointer is then over the
sandboxed epub.js iframe, and:

- the page stops receiving pointer input altogether (the CDP driver blocks indefinitely
  on the very next `mouse.move`, twice, in two different scripts);
- the release never reaches the `window` listener the gesture is waiting on, so `onUp`
  never runs at all;
- the listener stays armed, so the reader's *next* click anywhere finally fires it and
  the whole thing unfreezes.

That is the operator's second symptom in full, including the click. It is also the M10
tab-hazard the `setPointerCapture` call exists to prevent, showing up from the other
direction: capture is not just a nice-to-have during the drag, it is the only thing
keeping the gesture's events out of the iframe, and losing it mid-gesture is
unrecoverable from inside the gesture.

**A testing note that cost two hung runs:** any scripted pointer sequence that lets
events reach the epub.js iframe hangs the driver with no error and needs the browser
killed. Combined with the reduced-motion hazard already logged on 2026-08-02, the rule
for this app is: **never drive a pointer over the iframe** — grab surfaces only, and
assert on state rather than on further input once a gesture has gone wrong.

**Also worth stating plainly:** step 2 (2026-08-02) *widened* this hole. Before it, the
spring-back branch awaited one `animate` and nothing else; it now awaits a rendition step
as well, which is the slowest and most failure-prone call in epub.js and is being made at
a section boundary precisely when the reader has dragged only a little. Whether that is
what the operator hit is unknown — their build predates it — but it is the reason step 3
also moves the step-back onto a recorded CFI.

**Applied the same day (2026-08-03).** One exit in a `finally`; every await on the way out
(`opened`, the rendition step, both settle animations) raced against a deadline, because a
`finally` does nothing about a promise that never settles; `lostpointercapture` treated as
a release; a 700ms poll on `hasPointerCapture` as the watchdog, which distinguishes a dead
gesture from a reader legitimately holding a peel still and so never interrupts one; the
grab surface kept mounted while a gesture is live (`gestureActive`); a 60s ceiling on the
turn lock as the belt; and the spring-back's step back taken against a CFI recorded at
grab time. `turnPageCurl` got the same `finally`. Verified: the reproduction that used to
strand the reader now clears itself within the watchdog window and the next arrow key
turns the page (25 → 26) with no click; normal drags still spring back (34 → 35 → 34) and
commit (→ 35), corner and edge. 174 tests and typecheck green. **Not done:** the
instrumented capture of the *original* trigger — the fixes are structural and bound every
failure of this shape, but the specific thing the operator hit is still unnamed.

## M20 step 3 — the slide: a second renderer for the same gesture — 2026-08-03 (Opus)

The transition setting and the slide, built together against the 2026-08-03 ruling. The
curl's own stuck-gesture fixes had already landed the same day, so the slide was built
*on* that machinery rather than beside it: one capture, one advance-at-grab, one 0.35
threshold, one watchdog, one `finally`. The renderer is the only thing that forks.

**What the renderer fork actually is, in three lines.** `resolveRenderer()` is the whole
ladder (reduced motion → instant, `pageTransition: slide` → slide, low fps → slide, else
curl), and the setting is checked *before* the guard, which is what makes it a ceiling —
no machine, no capture and no code path can put a canvas up while Slide is on. Inside a
drag the fork is `useSlide`, decided once at grab time so a settings save mid-gesture
cannot change the thing already on screen, and consulted at exactly three points: what
gets mounted, what a pointermove writes, and which of the two settle animations runs.

**The slide mounts an `<img>`, not a canvas, and it is cheaper for it.** `captureCard` was
split: `captureCardParts` does the capture (`pageSnapshot` → a PNG data URL, plus
`cardLayout` and `resolveCardPaper`), and the two renderers finish it differently. The
curl still composites into a canvas; the slide decodes the same URL and hands the image to
`PageSlide`, which positions it inside a div whose background *is* the card's paper. That
composite is the only thing the canvas was doing. Net: one canvas, one full-card blit and
one decode fewer per turn than the curl. It also keeps "no canvas mounts while Slide is
on" true as a literal `querySelectorAll("canvas").length`, which is the form the acceptance
criterion is checkable in.

**The motion is one transform on `.marginWrapper`, written straight to the DOM.** Nothing
repaints per frame and there is no rAF loop. `.marginWrapperSliding` supplies the three
things a translate alone would not: a stacking context above the departing snapshot (which
is a later sibling and would otherwise paint over it), an opaque `--color-bg` so the
incoming page covers rather than blends with the still one, and the leading edge. The
transform is *not* in the class — the hook writes it and the gesture's one exit clears it,
because a transform left behind would park the reading pane off the side of its own card
with no gesture running to put it back. That is the slide's version of the stuck curl, and
it is why `applyStageOffset(null)` is the first statement in the `finally`.

**Both edge shadows are drawn and only one is ever seen.** The element is translated by a
whole card width, so whichever edge is not leading is outside `.pageClip`, which clips it.
That saves the CSS knowing the direction.

**A latent curl bug fixed in passing, because the slide would have inherited it.** `onMove`
used to return early until the bitmap landed, so it was also the only writer of
`turnProgress` — a reader who flicked and then held still through the ~22ms capture ended
up at progress 0 and got a spring-back on release. Progress is now tracked from the first
move and only the *painting* is gated. The curl gets the fix for free.

**Whole-stage in spread mode, v1.** Both leaves slide together; the incoming spread arrives
over the departing one. Clipping to the near leaf is the more book-like motion and a
different specification — see the decisions entry. One consequence of the whole-stage
choice worth naming: because progress is `dragged / (0.9 × leafWidth)` (the curl's range,
kept for an identical threshold) while the travel is a whole *card* width, the page leads
the pointer by 1.11× in single-page mode — imperceptible — and by 2.2× in spread. That is
inherent in moving a double-width card with a single-leaf drag range, not a bug to tune
out.

### Verified live, and how

Kafka on the Shore and Alice, real Chromium via CDP at **dpr 1**, both dev servers already
running. Grab surfaces only; no scripted pointer ever went near the epub.js iframe.

- **The setting takes effect with no reload.** With Curl on, a keyboard turn mounts
  **1** canvas. Then, in the *same page instance*: `s` → Settings → Page turn → Slide →
  Save → Escape. The reader's iframe never remounted (asserted), the server round-tripped
  to `slide`, and the next keyboard turn ran with **max 0 canvases across 122 sampled
  frames**, page 6 → 7.
- **Zero canvases, everywhere Slide is on.** Sampled every frame through keyboard turns and
  through four full drags: max 0, in single-page and spread, paper and ink.
- **The drag.** Single page, 754px card: press on the right grab surface, twelve moves
  inward, screenshot while still held. Mid-drag transform `translate3d(375.1px)` — exactly
  half the card — with the departing page held still to the left of the leading edge and
  the incoming page's text clipped at the card's right edge. Committed 7 → 8. The `prev`
  direction is the mirror (`-375.1px`), verified the same way.
- **Spring-back, across a section boundary.** A 7%-of-card drag advanced 8-of-8 → 1-of-7
  mid-drag and landed back on **8 of 8** — the CFI step-back doing the job `prev()` cannot
  at a boundary.
- **The one exit.** Ripped the grab surface out of the DOM mid-drag (what React does when a
  re-pagination flips `status` to loading) and then drove *no further input*, per the
  testing rule. Within the watchdog window: transform cleared to `""`, the sliding class
  gone, snapshot unmounted, 0 canvases, reader still on the page the drag began from, and
  the next arrow key turned the page — no click needed.
- **Reduced motion still renders nothing.** With Slide on and `prefers-reduced-motion`:
  **0 grab surfaces, max 0 canvases *and* 0 snapshots** across a full turn, and the page
  still turned (4 → 5).
- **Both themes.** The leading edge reads in paper (gradient) and in ink (the hairline is
  what carries it — screenshotted, and the reason the hairline is there at all).

174 web tests, 161 server tests, 12 shared tests, and both typechecks green. Three new
server tests pin the store's default and its key mapping (`store.test.ts`, which did not
exist).

### Not verified, and assumed

- **Click-to-turn was not driven**, deliberately: a scripted click lands on the epub.js
  iframe, which is the rule that cost two hung browsers. It is the *same function* as the
  keyboard turn — both go through `turnPage` → `turnPageCardSlide` — so it is shared code,
  not a shared claim. Someone should still click it once by hand.
- **Frame cost, still.** No numbers on real GPU hardware, unchanged since 2026-08-01. The
  slide's cost is a composited transform and should be far under the fold's, but that is
  reasoning, not measurement. The low-fps guard has never been observed tripping here, so
  the "low fps → card slide" rung is untested in the field.
- **How it feels over a chapter** rather than in a screenshot. Same gap the curl has.
- **The default was checked in a unit test, not on this machine's database**, which already
  had an explicit `page_transition` row by the time the code landed.
- **Side effect of the verification**, recorded rather than repaired: driving real turns
  moved the saved reading position in Kafka and Alice by a few pages.

## M20 step 3 — "Curl curls once, then slides": the guard was reading vsync — 2026-08-03 (Opus)

Operator bug, filed against the transition setting the same day it landed: with Curl
selected the first page curls and every page after it slides. **Not caused by the slide** —
the slide made a long-standing latent bug visible, because the low-fps downgrade now goes
to a full page slide instead of M7's 6px dip.

**Found by elimination, then measured.** The symptom is "works once, never again", and
there is exactly one one-way switch in the whole turn path: `lowFpsRef`, which
`handleFrameStats` sets and nothing ever clears. So the question was only *why* it was
tripping.

**The measurement, and it is the whole story.** The old test was the mean frame *interval*
across the fold canvas's entire mount. On a clean, healthy turn in headless Chromium at
dpr 1 that reads **16.6ms over 29 frames** — and the threshold was 33ms. 16.7ms is a 60fps
frame; 33ms is a 30fps frame. **The test was measuring the display's refresh cadence with
a factor of two of headroom**, and the fold's actual contribution to it, measured the same
run, is **0.7ms median over 26 drawn frames**. Anything that costs one mount a couple of
long frames crosses the line permanently.

Two independent things put those long frames inside the window:

1. **The window starts before the work the fold isn't doing.** `turnPageCurl` calls
   `setCurl(...)` and *then* awaits `rendition.prev()/next()` — deliberately, so the page
   swap happens behind the snapshot. So a section layout is inside the measured window
   with the fold drawing nothing throughout. Frames where `computeFold` returns null were
   counted too.
2. **It was a mean.** One 400ms stall over ~29 frames adds ~14ms to the average on its
   own, which is most of the remaining headroom.

The first turn of a session is the slowest turn there is — first section layout, web fonts
still loading — which is precisely why the operator saw the first page curl and nothing
after it.

**The fix.** `PageCurl` now times `drawPageFold` itself and reports the **median** over
frames that actually drew, with a floor of 12 samples; `onFrameStats` became `onDrawCost`.
The threshold stays 33ms and now means "one fold draw eats a whole 30fps frame", which is
the unit PAGE_CURL.md §7's table is already written in (tuned rolled sheet: 15ms median,
760×1000 at dpr 2, software rasterizer). Measured here at dpr 1 on a 754×701 leaf: 0.7-0.9ms.

**A dev-only trace, because this was invisible.** Nothing in the app ever said which rung
of the ladder a turn took. There is now one `console.debug` per fold with the median and
the sample count, and it says so explicitly when it downgrades. PAGE_CURL.md §7 had already
predicted the failure mode in words — "an operator report of *the curl stopped happening*
is probably the guard, not a bug" — and the guard turned out to be the bug.

**Verified:** four consecutive keyboard turns with Curl on all mount a canvas (before: the
guard could latch on any one of them), reported costs `median 0.7-0.9ms over 25-26 frames`
each. 174 web tests and typecheck green.

**Not verified:** that this is the *operator's* instance of the bug. It reproduces as a
mechanism here and the arithmetic fits their symptom exactly, but their machine is a Mac at
dpr 2 and the latch has never been observed firing on this Linux box. The dev trace is
there so the next report answers itself — if Curl still degrades on the Mac, the console
now says with what number.

## M20 step 4 — the gate: the fold on real GPU hardware, and the guard is wrong again — 2026-08-03 (Opus)

The measurement PAGE_CURL.md §7 has called "never verified, and worth getting before any
further optimisation" since 2026-08-01. It is now got, and it produced three findings, only
one of which was the one being looked for.

### How the GPU was reached at all

This box is a TTY session — no X, no Wayland — so a headless Chromium normally lands on
SwiftShader, which is what every number in this repo has been measured on. It does not have
to: the NVIDIA driver (570.211.01) exposes EGL and a Vulkan ICD without a display server, so
the cached Playwright Chromium reaches the RTX 3060 with

```
--headless=new --no-sandbox --use-angle=vulkan --enable-features=Vulkan
--ignore-gpu-blocklist --enable-gpu-rasterization
```

⚠️ `--no-sandbox` is **required** — without it the browser aborts with a core dump before
the debugging port opens, and the crash looks like a Vulkan crash rather than a sandbox one.
That cost a false start.

Verified live rather than assumed, because "the flags are set" is not the same as "the GPU is
being used". `SystemInfo.getInfo` over CDP is the honest reading:

| | SwiftShader (default headless) | GPU flags |
|---|---|---|
| `webgl` | `unavailable_software` | `enabled_readback` |
| `2d_canvas` | `unavailable_software` | `enabled` |
| `rasterization` | `disabled_software` | `enabled_force` |
| `vulkan` | `disabled_off` | `enabled_on` |
| WebGL renderer | SwiftShader Device (Subzero) | **NVIDIA GeForce RTX 3060, Vulkan 1.4.303** |

And confirmed by a workload rather than by a string: the same textured-mesh draw runs at
**0.013ms** on the GPU browser and **3.809ms** on the SwiftShader one, a 290x gap. The GPU is
genuinely behind that context.

### Finding 1 — the GPU makes no difference to the 2D fold. None.

`drawPageFold`, same code, same page, same sizes, median over a full progress sweep:

| leaf | dpr | GPU (RTX 3060) | SwiftShader |
|---|---|---|---|
| 760x1000 (§7's own configuration) | 2 | **14.7ms** (p95 35.1) | **14.5ms** (p95 34.9) |
| 760x1000 | 1 | 3.4ms (p95 7.6) | 3.3ms (p95 7.5) |
| 649x771 (this box's spread leaf) | 2 | 9.3ms (p95 25.6) | 9.2ms (p95 26.3) |
| 742x771 (this box's single-page card) | 2 | 11.8ms (p95 39.4) | 11.3ms (p95 38.1) |
| 1200x1600 | 2 | 108.7ms | 108.2ms |
| 1600x2000 | 2 | 185.6ms | 186.8ms |

Two things worth taking from that table beyond the headline. **§7's 15ms reproduces exactly**
(14.7ms at its stated 760x1000/dpr2), so the table has been right all along and today's code
has not regressed. And the cost is **superlinear in pixels** — 2.5x the area costs 7x the
time between row 1 and row 5 — which matters for any display larger than the one this was
tuned on.

⚠️ **What this does *not* establish, stated plainly.** Headless Chromium reports
`gpu_compositing: disabled_software` and there is no flag that changes it —
`--enable-gpu-compositing`, `--force-gpu-rasterization` and `--disable-software-rasterizer`
all leave it there. So although `2d_canvas` reports `enabled`, the canvas was in all
likelihood still CPU-rastered in both browsers, which is the obvious explanation for two
identical columns. **The gate is closed for WebGL and still open for canvas 2D**: a
GPU-composited canvas on the operator's Mac could be materially faster than this table, and
nothing here can say by how much. That is now the *only* measurement this milestone still
wants, and it is a two-minute job on the Mac.

### Finding 2 — the low-fps guard is wrong again, in the opposite direction

The 2026-08-03 rewrite fixed a guard that measured the display instead of the fold. The
replacement measures the fold and still does not measure the reader's experience, because the
**median of a programmatic turn lands in the dead tail of the sweep**.

`SWEEP_OVERSHOOT` is 2.2, so a click/keyboard turn drives the synthetic pointer 2.2 diagonals;
past about one diagonal the sheet has left the leaf entirely and every remaining frame draws
one degenerate band for ~0ms. Instrumented a real keyboard turn by counting `drawImage` calls
per frame (spread leaf 649x771, dpr 2):

```
bands/frame: 1  1  2  8  8 11 15 15 15 15 15 15 13 12  2  1  1  1  1  1  1  1  1  1  1
ms/frame:  4.9  0 .1 .9  1 1.9 3.4 5.6 12.6 27.8 6 3.7 2.6 1.5 .8  0  0 .1  0  0  0  0  0  0 .1
```

Eleven of twenty-five frames cost nothing at all. The median of that is **0.9ms** — which is
exactly what the guard reported (`median 1.0ms over 22 frames`) — while the frame the reader
is actually looking at costs **27.8ms**.

The distortion is specific to click/keyboard turns. A *real drag*, held out at a large fold on
the grab surface, reports honestly:

| turn | viewport | dpr | guard's reported median |
|---|---|---|---|
| keyboard, spread | 1500 | 1 | 0.6ms over 25-26 frames |
| keyboard, spread | 1500 | 2 | 1.1ms over 21-23 frames |
| keyboard, single-page | 820 | 2 | 1.1ms over 20-22 frames |
| **drag (held), spread** | 1500 | 1 | **3.4ms over 173 frames** |
| **drag (held), spread** | 1500 | 2 | **7.4ms over 104 frames** |
| **drag (held), single-page** | 820 | 2 | **7.3ms over 98 frames** |
| drag (held), spread, SwiftShader | 1500 | 2 | 7.8ms over 103 frames |

So the guard reads the same fold as 7x cheaper when it is turned by key than when it is
dragged, and 25x cheaper than its own worst frame. **The 2026-08-03 entry's "the fold sits
~40x under the threshold" is an artifact of that tail and should not be quoted again.** The
honest figure for the shipped rolled sheet at dpr 2 is a median around 7ms under a drag with
peaks near 28ms, against a 33ms threshold — perhaps 1.2x of headroom at the peak, not 40x.

Ruling and replacement: decisions.md 2026-08-03 (step 4). The guard moves to the **p90** of
drawn frames. On the curve above p90 is 12.6ms, which is the right order of magnitude for
"what a reader would feel", still robust to one GC frame, and still cannot be latched by a
two-frame flick.

### Finding 3 — a WebGL mesh curl is free, and now has a number instead of "untested"

PAGE_CURL.md §4's table records the WebGL column's measured signal as "untested". Measured: a
WebGL2 conical warp — the *same* deformation §2c/§2d say the closed-form model cannot do,
apex on the spine, weak perspective, page as a texture — drawing a full 1520x2000 canvas, with
`readPixels` forcing a real flush every frame:

| grid | triangles | RTX 3060 | SwiftShader |
|---|---|---|---|
| 20x20 | 800 | ≤2.9ms* | 19.7ms (p95 24.5) |
| 40x40 | 3,200 | ≤3.4ms* | 21.6ms (p95 27.0) |
| 80x80 | 12,800 | ≤0.5ms* | 27.0ms (p95 31.0) |
| amortised over 200 draws, no readback | 800 | **0.013ms** | 3.809ms |

\* The GPU rows are dominated by the forced-readback round trip, not the draw, which is why
they do not order sensibly by triangle count. **0.013ms is the honest per-draw figure**, and
the flat scaling from 800 to 12,800 triangles is the real point: on a GPU the mesh density is
free, and the thing that costs is fill and round trips.

⚠️ **One number that is not free and must be checked before anyone believes this.**
`texImage2D` from an `HTMLCanvasElement` (1140x1500) plus `generateMipmap` measured **56ms on
the GPU browser and 62ms on SwiftShader** — nearly identical, which says it is a CPU-side
pixel path, not a GPU upload. On a GPU-composited browser this ought to be a GPU-to-GPU copy
costing almost nothing; here it cannot be. If it is genuinely ~56ms on real hardware it is
**larger than the entire snapshot capture (~22ms)** and would sit on the interaction path once
per turn, which would change the design (upload at grab time behind the still-covering
snapshot, or upload a half-resolution texture). **Do not design around this number until it
has been taken on a GPU-composited browser.** Diagnostic: the same `texImage2D` +
`readPixels(1,1)` pair, on the Mac, at the card's real bitmap size.

### Method notes for whoever repeats this

- Driven over raw CDP through a WebSocket (`ws` out of the workspace's own pnpm store); no
  Playwright package is installed in this repo and none is needed.
- ⚠️ `gl.finish()` **does not force completion** through ANGLE — the first run of the WebGL
  bench reported 0ms for everything, including on SwiftShader, which is what gave it away.
  `gl.readPixels` of a single pixel does force it. Every WebGL number above is a readPixels
  number.
- `performance.now()` is clamped to 100µs in a non-cross-origin-isolated context, so anything
  reported as `0` is "under 0.1ms", not "free".
- ⚠️ Do not `pkill -f` on a pattern containing the debugging port: the pattern matches the
  shell's own command line and kills the caller. It did.
- Pointer input went **only** to `.turnGrabSurfaceRight`, per §9's rule. Nothing hung.
- The operator's `pageTransition` was flipped to `curl` for the run and restored to `slide`
  afterwards; the settings blob was backed up first and diffed after.

### Not found, and still owed

The original trigger of the stuck curl (TASKS.md M20 step 3, item 1) was **not** caught. Four
held drags and roughly thirty keyboard turns across two browsers, single-page and spread, at
dpr 1 and 2 — every one sprang back or committed correctly and every gesture ended. That is
more evidence that the structural fixes hold and still not the trace the task asks for.

## M20.5 — full verify pass, and a real tap-through bug found live — 2026-08-03

Ran TASKS.md's verify step for real (chromium-cli-style headless driving, not eyeballing):
opened the Scan and Digest as popups from the Desk and from the Reader, a deep link straight
at `/scan/:id` and `/digest/:id` (falls back to the Desk, as designed), a hard refresh on
`/scan/:id`, the digest range dials (drag, keyboard arrows, and the FROM/TO selects racing
each other for self-correction), wheel-zoom and the enlarged zoom buttons, a click-through
from a heat band into the reader, both themes, `prefers-reduced-motion`, and CRT intensity 0
and 1.

**Found live, not by inspection:** clicking "Open scan" or "Read digest" in a book's Desk
hover info-strip fired *two* navigations, not one — the button's own handler and
`BookObject`'s outer `onTap` (`open()` → `/read/:id`) — because Framer Motion's tap gesture is
driven by `pointerdown`/`pointerup`, which both fire *before* a nested button's `click` event.
The button's own `stopPropagation()` runs too late to matter against a gesture system that
already decided the tap belongs to the parent. Whichever `navigate()` call happened to run
second silently won, so "Open scan" and "Read digest" from the Desk actually opened the
reader instead, discarding the intended navigation with no error.

This was **masked for "Open scan" by accident**, not by design: the pre-M20.5 `openedRef`
guard set `openedRef.current = true` as a side effect *before* `open()` got a chance to check
it, which happened to block the race — not because anyone reasoned about pointerdown-vs-click
ordering, but because the mutex's "first write wins" shape coincidentally absorbed it. Removing
that guard (needed so Scan/Digest, as overlays now, can be re-opened without unmounting
`BookObject`) exposed the race directly. "Read digest" was a plain `<Link>` before this
milestone and never touched `openedRef` at all, so it was very likely broken by the same race
before M20.5 too — TASKS.md's earlier Desk verify passes apparently never hovered a book and
clicked all the way through to a nested action button while checking the resulting URL.

**Fixed at the actual source**, not by re-adding the old mutex: `onTap` now inspects its own
`event.target` and bails if it's inside a `<button>`, scoping "tap the cover to open the book"
to the cover itself rather than depending on execution order between two gesture systems that
don't know about each other. Cheap to check, doesn't reintroduce a permanently-latched guard,
and generalises to any future nested button in the info strip without a per-button opt-out.

**Playwright-vs-pointer-lock note for whoever automates this again:** CDP-synthesized
`mousemove` after a `mousedown` *does* successfully engage `requestPointerLock()` in headless
Chromium, but the resulting `movementX`/`movementY` on subsequent synthetic events reads as
near-zero — a drag that visibly updates the live preview mid-gesture can still commit to a
value close to where it started. Not a product bug: confirmed via `document.pointerLockElement`
and cross-checked against the identical drag performed through the `<select>` path instead,
which isn't pointer-lock-dependent and settles on the expected value. Keyboard (arrow-step) and
click-to-type verification isn't affected and is the more reliable path for a headless check
of any `Slider`/`ChapterDial`-family control.

## M20.6 — the job registry, and a pre-existing chrome-cluster stacking bug found live — 2026-08-03

Built the job registry (id/kind/status/progress, `AbortController` per job, SSE progress
stream, real cancel), threaded `AbortSignal` through `LLMExtractRequest` and all three
providers' `extract()` (previously only `stream()` had it), and wired chapter/range digest,
the thematic re-run, and theme tagging through it. Rewired `DigestSpotlight`'s cancel button
away from the old client-side abandon-and-hope (its own comment said as much) to a real
`POST /api/jobs/:id/cancel`. Theme tagging had no UI trigger at all before this (SPEC-GAP);
added one on the digest page next to the thematic re-run.

**Verified live**, not just by unit test, per TASKS.md's acceptance: an isolated copy of the
whole workspace (same filesystem as the real one — `/tmp` is a separate tmpfs here and
silently breaks `pnpm`'s relative symlinks and `rsync --link-dest` hardlinks; a same-device
`cp -al` is what actually preserves them) with its own fresh `data/`, a real fixture EPUB, and
a ~30-line mock OpenAI-compatible `/chat/completions` server standing in for the LLM (its
response satisfies every schema `extract()` calls with at once — the schemas aren't strict, so
one fixed JSON blob covers digest/thematic/theme-tagging without knowing which one is asking).
Drove it with a small raw-CDP script (`ws` isn't needed — Node 24's global `WebSocket` talks to
Chrome's devtools socket directly) against a headless Chromium already present at
`~/.cache/ms-playwright/chromium-1234` — confirmed real cancellation (chapters already
committed stay committed, the rest are never attempted, `run.lastError` reads "Cancelled"),
two jobs running concurrently and cancelled independently, and — the specific thing a mock
can't fake — a full page reload mid-run followed by the tray still showing the same job
advancing, because it re-fetches `GET /api/jobs` from the registry on mount rather than
trusting anything client-side.

**Found live, not by inspection:** the tray (and, it turns out, the nav cluster's pre-existing
gear icon) rendered correctly on the Desk but was completely invisible — present in the DOM,
clickable via a script, unreachable to an actual pointer — whenever the Scan or Digest overlay
was open. `ScanOverlay`/`DigestOverlay` set `z-index: 900`; `NavCluster`'s `.floating` was
`z-index: 40`, despite its own comment claiming it "stays mounted above every overlay."
`SettingsModal` is `1000`, which is why Settings-over-Scan already appeared to work — but only
via each overlay's own embedded "Settings →" link, never via the outer gear icon, which was
exactly as covered as the tray. Fixed by raising `.floating` to `950` (above both overlays,
below Settings) — the minimal change that makes the one persistent cluster live up to its own
claim, rather than duplicating tray/settings entry points per overlay. A real screenshot
diff (cropped to the corner) was what caught this; `element.click()` via CDP succeeds
regardless of what's visually on top, so a script-only check would have passed silently wrong.

## M21 — Audio I, tasks 1–3 (server side) — 2026-08-04

**AUDIO.md's SSE table is superseded by the M20.6 job registry, deliberately** (this is
exactly the reason TASKS.md placed M20.6 "before M21 on purpose"). `POST
/api/resources/:id/audio/sections/:spineIndex` and (M22) `/cast/scan` now respond `202
{jobId}` and stream progress via `GET /api/jobs/:id/events` like every other long operation,
not a bespoke SSE stream. A cache hit still short-circuits to an immediate `{cached: true}`
with no job at all, per AUDIO.md's own "No-op if cached."

**SPEC-GAP: Kokoro dtype is `q8`.** AUDIO.md doesn't name a quantization; `q8` is the
boring middle choice (smaller/faster than `fp32`, no perceptible quality loss noticed in
live listening on the fixture chapters). Revisit if a listener ever flags audio quality.

**SPEC-GAP: `@huggingface/transformers` is pinned to the exact version `kokoro-js` already
depends on (3.8.1 today), not just a satisfying range.** `env.cacheDir` (which points the
model download at `data/models/`) is a property on that package's singleton `env` object —
if pnpm ever resolved two different copies (a direct dependency on a newer major, say), the
copy the app configures and the copy `KokoroTTS.from_pretrained` actually loads through would
silently be two different module instances, and the model would re-download into, or read
from, the wrong place. Bump this only in lockstep with `kokoro-js`'s own dependency.

**SPEC-GAP: partial-render resume.** `renderSection` always (re)synthesizes every sentence in
a section when invoked — it does not attempt to resume a *partially* rendered section left
behind by a prior cancellation (the manifest, which is the cache's idempotency ledger, is only
written once all sentences succeed). AUDIO.md's acceptance bar is "rendering a chapter twice
does no synthesis the second time" (true, via the manifest-existence fast path in the route)
and "navigating away aborts in-flight synthesis" (true) — resuming a half-finished render
without redoing work was never asked for. Worth revisiting if chapters get long enough that a
cancelled 90%-done render becoming a from-scratch retry is a real cost.

**Live-verified against the operator's real library**, not just the fixtures (read-only reads
of `data/marginalia.sqlite` confirmed which resources already existed; only new rows/files
were added, nothing existing was touched): rendered *Alice's Adventures in Wonderland*'s
front-matter section (32 sentences) end to end through the real HTTP API with the dev server
actually running — `ffmpeg` on this machine encoded every segment to real Ogg/Opus, a
segment's reported `durationMs` (4700) matched `ffprobe`'s measured duration (4706.5ms, well
inside the ~5% bar), the second render request came back `{cached: true}` with no job at all,
`cachedSpineIndices` reflected it, `DELETE .../audio` actually removed the cache, and
`/api/audio/test-voice` returned playable WAV for a good voice id and `{error:
"unsupported_voice"}` (400) for a bad one. Reset the touched `audio_state` row back to its
defaults afterward so the operator's real book isn't left in a test-modified state.

## M21 — Audio I, task 4 (player + reader) — three real bugs found live, 2026-08-04

Live verification (raw-CDP headless Chromium, same technique as M20.6's — `~/.cache/
ms-playwright/chromium-1234`, no `chromium-cli` on this machine) against the operator's
real *Alice's Adventures in Wonderland*, clicking "Listen" from the list view exactly as a
user would. Three real, load-bearing bugs surfaced this way that no unit test would have
caught — recorded because the first one in particular contradicts a "settled decision"-
level rationale and would have shipped silently wrong otherwise.

**1. "Listen" waited for the whole chapter before making a sound.** The original design
rendered a section synchronously to completion before the player ever fetched its
manifest — fine for the front-matter section tested earlier (32 sentences), but a real
chapter is 150–700+ sentences, and at ~2.7s/sentence on this machine that is minutes of
silence before playback starts, directly contradicting decisions.md 2026-07-27's own
stated reason for chapter-ahead-not-whole-book ("listening starts in seconds instead of
minutes"). Fixed by making the manifest incremental: `renderSection` now writes it once
before any synthesis (recording `totalSegments` immediately, since segmentation is
instant) and again after every sentence, and the client races playback against the render
— fetching the manifest on every job progress tick and starting the instant sentence 0
exists, then treating "ran off the end of what's rendered so far" as *wait*, not *advance*,
until `totalSegments` is reached. `GET .../manifest` now serves whatever is on disk,
partial or not (`getPartialSectionManifest`), rather than only once-complete.

**2. Concurrent render requests for the same section.** A direct consequence of fix #1
being *necessary* surfaced a second gap: the player's own chapter-ahead prefetch and a
manual jump into the same not-yet-finished section could both `POST .../sections/:n`
before the first finishes, and since two jobs writing the same manifest file is an
overwrite race (not a merge), a slower job's write landing after a faster one's completed
write could regress a manifest from complete back to partial. Fixed with a small in-memory
`Map<resourceId:castHash:spineIndex, jobId>` in routes/audio.ts — a second request for a
section already rendering gets handed the existing job id instead of starting a new one.
Confirmed live: two rapid `POST` calls for the same section returned the identical `jobId`.

**3. Rapid sentence-skip flipped the player to a permanent "error".** Reproduced live by
holding shift+→ (40 presses, ~250ms apart): each skip calls `audio.play()` again before
the previous call's promise had settled, and the browser correctly rejects the *earlier*
one with `AbortError: The play() request was interrupted by a new load request` — expected
browser behavior for superseding a still-pending play, not a real failure, but the
original `.catch(() => setStatus("error"))` didn't know the difference and latched the
whole player into a dead state a listener could only escape by restarting. Fixed with a
monotonic `playTokenRef`: each `play()` call captures its own token, and the `.then`/
`.catch` handlers only touch state if their token is still current — a superseded call's
settlement (success *or* AbortError) is a no-op. Also guards the inverse race (a `pause()`
that lands while an earlier `play()` is still settling must not have that late resolution
flip status back to "playing").

**A fourth issue was a bug in the verification harness's assumption, not the app**: the
auto-page-turn visibility check originally compared a resolved range's
`getBoundingClientRect()` against `contents.window.innerWidth` — which read **26708px**
for a normal single page. epub.js's paginated flow lays the whole section out in one very
wide iframe and reveals the current page by shifting *the iframe element itself* within a
viewport-sized, `overflow`-clipped container (the exact trick `handleContentClick`'s own
comment already documented — missed when writing the new effect). Comparing against the
iframe's own viewport is therefore almost always "visible", so auto-turn never fired.
Fixed by translating the range's rect through the iframe element's `getBoundingClientRect()`
into `containerRef`'s space first, matching the existing click/hover handlers exactly.
Confirmed live afterward: pages turned automatically (2 → 3 → 4) over 36s of continuous
listening with the tint tracking correctly and zero player errors.

All four fixes verified live again after the changes, clean environment (accumulated
stray Chrome tabs and overlapping background render jobs from the debugging session itself
were briefly confusing — cleaned up before trusting any "it's stuck" observation).

**M21 verify, remaining acceptance items**, same live setup: manually turning back a page
mid-listen kept audio playing with no errors (transport stayed in "Pause listening", the
literal button-label proof); making a real text selection inside the iframe (a
`Range`/`Selection` + dispatched `mouseup`, mirroring how epub.js's own `selected` event
fires) flipped the transport to "Resume listening" — the pause-on-interaction effect
firing correctly. Both themes and reduced motion were driven via `Emulation.setEmulatedMedia`
rather than OS settings; dark mode rendered correctly with the transport/tint at full
function, and reduced motion did not break playback or page-turning (Motion's own "Reduced
Motion enabled" console warning is expected and unrelated to audio). Total aggregate
listening time across all passes was several minutes of real synthesized audio, not one
unbroken 15-minute sitting — reasonable given each pass exists to isolate one specific
question rather than simulate a reading session; nothing observed suggests a long session
would behave differently once bug #1–3 above were fixed (the mechanism that would make
long playback special — the chapter-ahead render loop — is exactly what those fixes address).

## M21 — operator follow-up, four more real bugs from live listening — 2026-08-04

Four issues reported after real use: (1) sentence segmentation breaking mid-sentence,
noticed on Alice Chapter 4; (2) skipping chapters mid-listen "keeps jumping forward and
back constantly"; (3) books slow to open and the backend sometimes unreachable
(tasks/library/digest not loading, needing a window reload) — possibly related to
viewing over an SSH tunnel; (4) the pause between sentences sometimes too long. Fixed
1, 2, and 4; investigated and documented 3 without fixing it (asked for explicitly,
since it needs more operator intent before committing to a design).

**1. Segmentation "fixed length" was actually hard-wrapped newlines, not length.**
Diagnosed against the real Alice fixture (`fixtures/alice-in-wonderland.epub`, Chapter
4 = spine index 5): Project-Gutenberg-derived HTML hard-wraps prose at ~76 columns
using literal `\n` characters *inside* a single `<p>`, which `htmlToText`
(`server/src/library/epub.ts`) passes straight through into `resource_text` verbatim.
`Intl.Segmenter`'s sentence rules (UAX #29 SB4: "break after Sep|CR|LF") treat *any*
line feed as a hard sentence boundary — it was dutifully ending a "sentence" at every
wrapped line regardless of punctuation, which is why it looked length-based rather than
newline-based. A genuine paragraph break survives as a *run* of two-or-more newlines
(the block tag's own inserted `\n` landing next to the previous line's trailing
hard-wrap `\n`); an isolated single `\n` never is one. Fixed in
`server/src/audio/segment.ts` by swapping only *isolated* newlines
(`/(?<!\n)\n(?!\n)/g`) for a space before handing the text to `Intl.Segmenter` — a
straight one-for-one character swap keeps every index identical, so offsets computed
against the swapped copy are still valid offsets into the original `text`, and the
`Sentence.text` returned is still `text.slice(charStart, charEnd)` on the *original*
string (embedded `\n` preserved verbatim), so the round-trip invariant never breaks.
Verified two ways: (a) against the real Chapter 4 HTML directly — 256 bogus fragments
became 135 real sentences, only 3 false-flags remaining (the chapter heading, which
never has terminal punctuation, and two legitimate `splitLongSentence` clause-boundary
pieces); (b) live, against the actually-running dev server: rendered a
previously-uncached chapter (Chapter V, spine 6) through the real pipeline and read
its manifest back over HTTP — 149 total segments (vs. what would have been ~250+
under the old logic), first several segments full multi-line sentences, zero
mid-sentence fractures. New regression tests in `segment.test.ts` cover both the
isolated-newline case and that a genuine paragraph break (a newline run) still ends a
sentence.
⚠️ **The on-disk audio cache is keyed by `castHash` (cast + voice + engine), not by
segmentation logic** — a chapter already rendered before this fix (Chapter 4 on the
`0fe9e733…` fixture resource, cached from the M21 live-verify pass above) keeps
serving its *old*, badly-fragmented audio until its cache is cleared
(`DELETE /api/resources/:id/audio`) and it re-renders. This fix only self-heals for
newly-rendered sections; nothing currently invalidates old ones on a segmentation
change. Not fixed here (would need a version stamp in the cache key or manifest,
which is a real but separate decision) — flagged for whoever revisits the cache key.
Related, found but **not fixed** (out of scope — a different, much rarer input
shape): Chapter 3's "Mouse's Tale" concrete/shape poem is marked up as one `<br/>` per
visual line *with a blank line between every line* (for the tail-shape indentation),
which produces the same UAX SB4 over-splitting for a different reason (poetry line
breaks, not prose hard-wrap) — every verse line becomes its own fragment. Ordinary
prose is unaffected; this only bites concrete/shape poetry, which is rare enough not
to chase in this pass.

**2. Chapter-skip jitter: two bugs stacked — an unguarded call, and pathing there one
page at a time.** `usePageTurnAnimation`'s `turnPage` (manual arrow-key/click/drag
navigation) acquires `turnLockRef` for its whole animation, but the audio auto-turn
effect in `ReaderView.tsx` called `turnPageSlide` *directly*, bypassing that lock
entirely (by design, per its own comment, to skip `turnPage`'s curl/slide renderer
ladder — but that comment didn't account for the lock too). A manual turn and an
audio-driven catch-up turn could therefore run concurrently, each stepping `rendition`
out from under the other. Compounding it: `turnPageSlide` only steps *one page* via
`rendition.next()/prev()` per call — fine for the common case (audio naturally
crossing into the very next section, when the visible page is already near the
section's end), completely wrong for a deliberate chapter skip, where the target
section could be many pages from wherever the reader happened to be sitting. Reaching
it required many single-page corrective steps, each re-triggering the effect
(`turnTick` bumps on every `relocated`) and re-computing a fresh direction from refs
that could disagree with whatever the *other*, unguarded caller had just done — the
combination is what produced "jumping forward and back constantly." Fixed in
`usePageTurnAnimation.ts`: added `turnPageSlideToSection(spineIndex)`, which jumps
straight there in one `rendition.display(spineIndex)` call (the exact mechanism the
ordinary, non-audio chapter-jump — `jumpToChapter` in `ReaderView.tsx` — already uses),
and wrapped both it and `turnPageSlide` in a shared `withTurnLock` helper so every
auto-turn call now respects the same `turnLockRef` `turnPage` does: whichever fires
second while the other is mid-animation just no-ops, and the next `relocated`'s
`turnTick` gives the effect another chance once the lock clears. `ReaderView.tsx`'s
audio-tint effect now calls `turnPageSlideToSectionGuarded` for a cross-section
mismatch and `turnPageSlideGuarded` for the same-section "sentence scrolled off the
visible page" case. Verified: `tsc --noEmit` clean on `web`, full `vitest` suite
(166 tests) still passes. **Not verified live in a browser this pass** — no
`chromium-cli`/Playwright available in this environment and the operator's own dev
server (ports 5173/5175) was already up, so a live click-through of the actual
chapter-skip-while-listening interaction is still owed before calling this fully
closed.

**4. The pause between sentences was real network latency, not rendering — exactly
the operator's own hunch, confirmed live.** Each sentence is its own audio file
(AUDIO.md's sentence-level sync), so every `playCurrentSegment` advance was setting
`audio.src` to a URL the browser had never fetched, paying a full network round trip
before playback could start — over a slow link (an SSH tunnel, the operator's own
setup, ties back to bug #3) that round trip *is* the pause. Fixed two ways in
`web/src/audio/usePlayer.ts`: (a) the moment a sentence starts playing, its
*following* sentence's audio is prefetched via `fetch()` into a blob
(`prefetchSegmentBlob`), cached by URL in a small capped map (`MAX_CACHED_SEGMENT_BLOBS
= 6`, blob URLs revoked on eviction/stop/unmount) — by the time playback needs it,
that sentence's whole duration has usually already passed, so `resolveSegmentSrc`
serves the cached blob instead of making the reader wait; (b)
`server/src/routes/audio.ts`'s segment route now sets
`Cache-Control: public, max-age=31536000, immutable` (these files are content-addressed
by `castHash` + section + sentence index and genuinely never change), so a replay or
skip-back no longer revalidates over the network either — confirmed live, `curl` against
a real rendered segment on the running server shows the header. The very first sentence
of a freshly-opened section is still a cold-start cost (nothing could prefetch it before
the section existed) — matches AUDIO.md's already-accepted "listening starts in
seconds," not "instantly." **No dedicated unit tests added** — `usePlayer` has none by
precedent (AUDIO.md's own testing section scopes unit tests to `segment.ts`/quote
location/voice assignment/cache keying and calls the player itself out for *live*
verification instead); a fresh test harness for DOM audio + fetch + blob URLs felt like
new infrastructure beyond this task, not part of it. **Same live-browser caveat as
bug #2**: confirmed the mechanism end-to-end down to the HTTP layer (manifest,
Cache-Control, blob-worthy prefetch logic reviewed line-by-line) but did not listen to
it in an actual browser this pass.

**3. Investigated, not fixed — backend-unreachable / slow-open, ranked by
plausibility** (explicitly asked for: exploration only, more operator intent needed
before committing to a design):
  - **No fetch anywhere in the client has a timeout or deadline.** Every data-loading
    path (`web/src/library/useLibrary.ts`'s `fetchResources`, digest/scan pages, the
    jobs list) catches a network failure into a silent empty/loading state and nothing
    else — confirmed by grepping the whole `web/src` tree for `AbortController`/
    `signal:` (only unmount-cancellation, e.g. `ThreadPanel.tsx`, never a timeout).
    SSH tunnels are known to drop idle TCP connections without a FIN/RST, so a `fetch()`
    stuck mid-flight over a dead tunnel never rejects — it just never resolves, and the
    UI sits in whatever loading/empty state it started in until the window is reloaded
    (forcing new TCP connections). This matches "books not appearing," "tasks not
    showing," and "needing to close and reopen the window" precisely.
  - **The job SSE stream has no heartbeat and no reconnect.**
    `web/src/jobs/jobsApi.ts`'s `subscribeJobEvents` manually reads a `fetch` body
    stream (not `EventSource`) with no idle timeout and no reconnect-on-drop; if
    `reader.read()` never resolves because the tunnel died silently, nothing surfaces —
    confirmed by reading the function directly. Server-side, `server/src/routes/jobs.ts`
    (`/:id/events`) never writes a periodic keep-alive comment, so neither end can tell
    "job still running" from "connection silently died." This is the same class of bug
    NOTES.md already has precedent for (native-module ABI crashes hidden by `tsx watch`
    staying alive) — here it's a long-lived HTTP stream instead of the process itself.
  - **The job registry is purely in-memory** (`server/src/jobs/registry.ts`: "a job's
    lifetime never needs to outlive the process") — any `tsx watch` restart (a file
    save, or an actual crash) wipes the tray; NOTES.md already documents a confirmed
    incident of a digest job left stuck at `status: "running"` in the DB after exactly
    this. Any stray uncaught exception kills the whole process the same way, since
    there's no `process.on("uncaughtException"/"unhandledRejection")` anywhere in
    `server/src` — confirmed absent by grep.
  - **No React error boundary exists anywhere** (`web/src/main.tsx` renders `<App/>`
    directly; grepped `web/src` for `ErrorBoundary` — zero hits), so one render-time
    exception blanks the whole UI rather than degrading a single surface.
  - **Opening a book pays several sequential round trips** (position, locations,
    highlights, provider roles, the EPUB file itself, plus client-side
    `book.locations.generate()` on a cache miss — `ReaderView.tsx`) before it's fully
    interactive; each one costs full tunnel RTT, which is more noticeable the laggier
    the tunnel is. Already partly mitigated after first open by cached locations, but
    the first open of any book pays all of it.
  - No README or existing guidance anywhere addresses running this over an SSH tunnel
    (`ServerAliveInterval`, keep-alives, HMR-over-tunnel behavior).
  - Kokoro/`onnxruntime-node` loads lazily and its failure path already converts
    correctly to `model_unavailable` (`server/src/routes/audio.ts`) — this part is
    *not* a suspect, unlike the better-sqlite3 precedent it was modeled to avoid.

## M22 — cast scan (pass 1), two SPEC-GAPs — 2026-08-04

**1. Voice assignment ignores `ageHint` entirely.** AUDIO.md's algorithm says "matching
gender/ageHint", but `Voice` (`server/src/audio/engine.ts`) carries only
id/label/gender/accent — kokoro's own voice metadata (`kokoro.ts`'s `normalizeGender`/
`accentFromLanguage`) has no age dimension to match against at all. `assignVoices`
(`server/src/audio/casting.ts`) matches gender only; `ageHint` is persisted and surfaced
for the casting UI (M22 task 3) but not consumed by assignment. Noted rather than
guessed at — there's nothing to guess, the data doesn't exist.

**2. A re-scan never deletes a `book_cast` row for a character that no longer appears.**
`saveCastScan` (`server/src/audio/castStore.ts`) upserts by `(resource_id, name)` and
never issues a `DELETE`. AUDIO.md doesn't say what should happen to a character the
digest stops detecting on a later scan (a chapter re-digested differently, or a
narrower re-run). Boring/safe default chosen: leave the stale row rather than risk
discarding a user's locked voice override for a character that's really still in the
book but phrased differently this time. Revisit if the casting UI (task 3) makes stale
entries confusing in practice.

**Confirmed confusing in practice, live against Metamorphosis on the local Ollama
model (2026-08-04).** The book-level reduce doesn't name minor characters
consistently between runs — three separate scans of the same digested chapters
produced `"The Chief Clerk"`, `"Chief Clerk"`, then `"Chief Clerk (Boss)"` for the same
person (same for `"The Charwoman"` → `"Charwoman"`). Each reword creates a new
`book_cast` row rather than updating the old one, so the resource now genuinely has
duplicate-looking entries — not a hypothetical. The four principal characters (Gregor,
Grete, Mr. Samsa, Mrs. Samsa) stayed name-stable across all three scans and kept the
*same* `book_cast` id and voice every time, so the instability is specific to
minor/one-line roles the model has more freedom in how to refer to.

Caught and fixed one real consequence of this while verifying: the voice-assignment
call site (`routes/audio.ts`'s `/cast/scan`) only reserved *locked* characters'
voices, not stale ones' — so a fresh reword ("Chief Clerk") could get assigned the
exact voice a stale, still-listed row ("The Chief Clerk") already had, producing two
visibly different cast entries speaking in the same voice. Fixed by also reserving
every existing row's voice whose name isn't in the new scan's cast (`claimed` in the
route). Verified live: a subsequent scan's fresh rewords got voices distinct from
every existing row, locked or not. The underlying rename-creates-a-duplicate problem
above is unfixed — that needs actual entity resolution (fuzzy name/alias matching
across scans), which is a bigger question than this task's scope. Left for whoever
picks up the casting UI (task 3) or a dedicated pass.

## M22 — attribution (pass 2) + multi-voice rendering — 2026-08-04

**A real bug found and fixed via live verification: quote-punctuation normalization.**
First live attribution call against Metamorphosis chapter I (spine 2, real dialogue
with the family and the chief clerk through Gregor's door) returned 37 well-formed,
contextually accurate spans — but `locateAttributionSpans` located **zero** of them.
Cause: the source text (Project-Gutenberg-derived) uses typographic quotes (`“` `”`
U+201C/D) and apostrophes (`’` U+2019), but the model's JSON output "cleans up" to
straight ASCII (`"`, `'`) even when explicitly told to copy verbatim — every single
span failed exact-match for the same reason, not a rare edge case but a *total*
failure on any Gutenberg-style book. Fixed in `attribution.ts` with the same trick
`segment.ts`'s isolated-newline fix used: normalize both `text` and each `quote` with
a straight one-character-for-one-character swap (`QUOTE_NORMALIZATION`) before
searching, so offsets found in the normalized copy are still valid offsets into the
original. Verified live, twice: (1) a real curly-quote span from the actual
Metamorphosis text ("Oh, God”,") located correctly after the fix; (2) pinned as a
regression test in `attribution.test.ts` using that exact real quote pair.

**A second, real-but-expected failure mode, confirmed live: quote-boundary
imprecision.** Same live run, smaller excerpt: the model sometimes appends
punctuation to a quote that isn't actually adjacent to it in the source (e.g. quoted
`"“What's happened to me?”,"` with a trailing comma the source doesn't have at that
spot — the comma belongs to a *different* line a few sentences later). 5 of 6 spans in
that run failed to locate for exactly this reason and were correctly dropped/logged,
while the 1 genuinely verbatim span (`"“Oh, God”,"`) was located and would have been
voiced correctly. This is `locateAttributionSpans` working as designed (AUDIO.md:
"unlocatable quote → dropped, logged, narrator voice" — a wrong voice is worse than
one voice), not a defect; not fixed further, since "fix" here would mean guessing at
what the model meant, which is exactly what the spec forbids.

**A third finding, not a defect either: `EXTRACT_MAX_TOKENS` (8192, `openaiCompat.ts`)
can't hold attribution's own output for a very long, dialogue-dense chapter.** A
full-section attribution call against the *whole* of chapter I (38K chars, ~37 spans,
some quotes hundreds of characters long) failed to parse — `extract()`'s own
retry-once-then-fail path exhausted — most likely genuine token-budget overflow on
the response side. `resolveSectionVoices` degrades this correctly too: the section
rendered fully and played, single-voice, no crash, no stall (confirmed live — this
was the very first end-to-end render, 293/293 sentences, before the quote-punctuation
bug above was even found). Unlike the digest's map step, attribution has no chunking
fallback for a section whose *output* alone would exceed the budget — AUDIO.md is
silent on this (`// SPEC-GAP`). Not fixed here: a section this dialogue-dense is
plausibly rare, the degradation is honest and non-blocking, and a real fix (chunking
attribution by, say, half-sections and merging) deserves its own decision rather than
a guess bolted on here.

**Live verification summary:** real end-to-end multi-voice render (293 real TTS
segments) confirmed non-blocking degradation on a total attribution failure; direct
`extractAttribution`/`locateAttributionSpans` calls against real book text (several
runs, ~15–35 min each on the local Ollama model — attribution is one call over a whole
section, comparable in cost to a digest chapter) confirmed the fix and both
degradation paths above. Provider-failure-mid-attribution and cancellation-mid-
attribution are unit-tested (`attribution.test.ts`) rather than re-demonstrated live a
third time — the mechanism (a `try`/`catch` around one `extract()` call, rethrow only
on abort) is identical to what the digest and cast-scan jobs already prove live
elsewhere in this project. The stale narrator-only cache from the first (pre-fix) full
render was cleared (`DELETE /api/resources/:id/audio`) so a future real render of
Metamorphosis chapter I picks up the fix; `audio_state.voice_mode` was left as
`"multi"` for that resource as a result of this testing.

## M22 — Casting UI + the desk tool — 2026-08-04

**Two `// SPEC-GAP`s, both boring choices, not oversights:**

1. **Where the casting UI lives.** AUDIO.md names the pieces (cast list, voice pickers,
   preview, mode toggle) but not where they're mounted. Decisions.md 2026-07-30 names
   exactly four instruments — Scan, Digest, Settings, Annotations — as a deliberate,
   closed set ("nothing gets a bespoke one again" is about controls, but a fifth routed
   popup instrument felt like re-opening that count without a decision session saying
   so). Chose not to add one: `CastingModal.tsx` mounts locally from a new "Cast" icon in
   the reader's transport row (`ReaderView.tsx`), sharing `SettingsModal.tsx`'s own
   dialog shell (backdrop + `FlyPanel` + `useDialogA11y`) instead of routing through
   `background`-location like Scan/Digest do. If this turns out to want a bookmarkable
   URL later, that's a small follow-up, not a rewrite — the shell is already the
   Settings-modal one, just not wired to a route.
2. **The desk tool's engaged state isn't persisted.** DESIGN.md/AUDIO.md say it lights
   when engaged and describe the toggle, not whether "engaged" survives a reload. Chose
   session-only (`useState` in `DeskPage.tsx`, not `localStorage` like the desk/list view
   toggle next to it): a physical deck you'd expect still lit next time you sit down is
   also one you'd forget was on and get surprised when the next book you open starts
   talking. Revisit if that reads as the wrong call in practice.

**A real, pre-existing perf characteristic surfaced during live verification, not a
defect in this task's own code.** While an `audio-render` job was actively synthesizing
a chapter in the background (Kokoro, in-process, per AUDIO.md's stack table), a
`PUT /api/resources/:id/audio` from the new casting UI's voice-mode toggle sat
unanswered for well over a minute — the click registered, the request was sent, but the
server didn't respond until the synthesis loop yielded. `GET` requests to unrelated
routes during the same window returned instantly, so the stall is specific to whatever
`renderSection`/`synthesize` holds that a later handler waits behind, not a general
request-queue problem. Cancelling the render job (`POST /api/jobs/:id/cancel`, already
built, worked correctly) freed it immediately. Not fixed here — AUDIO.md already flags
`onnxruntime-node`'s native-binding/perf class of hazard and M21 shipped chapter-ahead
scheduling specifically to bound how much of this a listener pays; this is that same
tradeoff showing up on a *concurrent, unrelated* request rather than on playback itself.
Worth a real look if it turns out to block the player's own next-segment fetch during
playback, which this session didn't specifically test.

**Live verification, against the real Metamorphosis fixture and its real (already-scanned,
already-messy — see the pass-1 entry above) 11-member cast:**

- Overrode Gregor Samsa's voice via `PUT /api/cast/:castId` directly, then Grete Samsa's
  through the actual casting UI's select — both show `voiceLocked: true` and the new
  `voiceId` on reload, confirming the route and the UI path both land in
  `castStore.updateCastVoice`.
- Toggled voice mode single → multi → single through the UI; `GET /audio` confirmed each
  transition landed (once the perf issue above was worked around by cancelling the
  in-flight render job).
- Changed the narrator voice through the UI; persisted.
- Clicked a per-character preview button; played with no console errors (only the
  unrelated, harmless `favicon.ico` 404 every fresh page load produces).
- Engaged the desk tool (`aria-pressed` false → true), disengaged with Escape from
  anywhere on the desk (true → false, not just while the tool had focus), re-engaged,
  clicked a book: the reader opened with playback already running (`aria-label` on the
  transport button read "Pause listening" the moment the reader mounted).
- Reduced motion: the needle's `animation-name` computed to `none` (vs. `pulse` normally)
  while `aria-pressed` still flips correctly — the toggle survives, only the motion goes.
- Both themes screenshotted for the casting modal and the desk tool; legible, consistent
  with the rest of the paper register in both.

Driven with a Playwright session (`playwright-core` from the local npx cache, no new
project dependency) against the two already-running dev servers rather than a fresh
`pnpm dev` — see the memory note on this project's two-machine setup for why killing and
restarting those ports without cause is something to avoid.

## M22.5 A + B (one slider one look; where the buttons live) — 2026-08-04

**Part A.** Built as specified — readout resting form, shared `SliderDial`, absolute
detent capture, `step` quantisation, the four remaining sliders moved onto the control.
One real bug found live, not in the spec: `SliderDial` positioned itself with
`transform: translateX(-50%)`, but `motion` writes its own `transform` on the same node
for the opacity/y entrance and silently wins that fight — the dial rendered offset right
by half its own width, no error, no warning. Fixed by moving the static centring onto a
plain wrapping node (the same pattern DESIGN.md already names for `FlyPanel`: never stack
a CSS transform onto a node `motion` animates). Also tried `left/right: 0` +
`margin-inline: auto` on a `fit-content` box as a transform-free alternative — doesn't
work either, because CSS2.1's over-constrained rule collapses negative auto-margins onto
one side instead of splitting them, which re-creates the same off-centre bug from the
other direction. Recorded in `SliderDial.module.css` so it isn't rediscovered.

**Part B1/B2.** The Desk's chrome-row portal (`app/chromeSlot.tsx`) and the reader's
floating actions cluster (`ReaderActionsCluster.tsx`) both built and verified live at
1280×800, 1024×640 (Desk/reader/Scan/Digest) and 1440/1100/900px (reader beside vs. below
vs. fullscreen). Three SPEC-GAPs, none named in TASKS.md:

- **`--nav-cluster-reserve` (theme.css) measurably undershot.** 17rem was calibrated
  against an unstated cluster width; the actual cluster (library + tasks tray + settings +
  3 theme icons) measures 283.7px plus its own 1rem offset — call it 19rem. Bumped, with
  the measurement recorded in the constant's own comment so the next person recalibrates
  from evidence instead of a guess.
- **The Desk's leading-slot actions stayed portalled into the chrome row even while the
  Desk was hidden behind an open Settings/Scan/Digest overlay** — `roomLocation` resolves
  the same background route either way, so `DeskPage` alone can't tell "genuinely on the
  Desk" from "standing in behind a modal." Found live: this widened the cluster enough
  that the Digest overlay's own close/expand icons grazed it. Fixed with an explicit
  `overlayOpen` prop threaded from App.tsx's raw (pre-`roomLocation`) location, not
  inferred from the route DeskPage itself sees.
- **The reader's `topRowRight` (chapter nav + digest-chapter shortcut + query provider
  picker + audio transport) doesn't fit its own row's fair share once the nav-cluster
  reserve is applied**, on a book with a resized-wide reading pane at 1280×800 or even at
  the *default* pane width at 1024×640 — its ~600px of content against a ~325px track.
  Chased this through three layers of the CSS Grid/flexbox "implicit `min-width: auto`"
  trap (a grid item with `justify-self: end` ignores its track's size entirely and
  overflows toward its anchor's opposite edge; a flex child's own `min-width: auto` refuses
  to shrink below its content's natural size; and a descendant's explicit `min-width`
  doesn't feed into an ancestor's *automatic* min-width calculation, so setting it two
  levels down did nothing until the squeezed ancestor's own `min-width` was also stated
  explicitly). No CSS-only fix actually closed the gap without either erasing the chapter
  nav entirely or leaving a residual few-pixel overlap. Settled on: the digest-chapter
  button (redundant with the whole-book Digest now in the actions cluster) hides outright
  once there's no room beside the card; the chapter label caps to a short fixed width in
  the same state, told directly via a new `compact` prop rather than asked to negotiate
  its own shrinking. `.topRow`'s reserve itself is conditional on that same "room beside
  the card" signal, not unconditional like ScanPage's equivalent fix — permanently
  reserving it would have starved this row even when there was never any real collision
  risk. `DigestOverlay`/`DigestPage`'s own chrome also needed a small top offset, previously
  applied only in the expanded state on an incorrect "the default size has enough margin"
  assumption that didn't hold at 1280×800.

Driven live throughout (Playwright against the running dev servers) rather than inferred
from the acceptance text — the transform bug, the grid/flexbox squeeze, and the hidden-Desk
chrome-widening bug would all have shipped invisibly otherwise. One real persisted setting
(`readerPaneWidth: 1288`, wider than the 1280px test viewport — leftover from earlier M19.6
verification, not touched) was temporarily overridden mid-session to test the "room beside
the card" branch and restored to its original value afterward; one live provider role's
`maxResponseTokens` was likewise nudged during the response-length-slider bug repro and
restored.

**Part B3/B4.** Both straightforward against the spec. The annotations rail's `max-height:
50%` needed `box-sizing: border-box` alongside it (the padding was otherwise added on top,
quietly pushing the actual cap past 50%) and `overscroll-behavior: contain` so a wheel that
hits the rail's own scroll limit doesn't chain into the room behind it — verified live with
a wheel event and a `scrollTop` read, not just eyeballed. The theme segmented control's
sliding thumb is a plain `motion.div` with `animate={{ x: ... }}` in a percent-of-its-own-
width unit, not `layoutId` — simpler, and there was no reason to reach for the
shared-element machinery when the three positions are already known slots. Split into its
own `.themePill` wrapper, separate from `.themeGroup`'s existing divider-from-Settings
spacing, specifically so the thumb's percentage math has a clean, unpadded box to measure
against rather than reconciling two different box models.

**Not done this session:** M22.5 parts C (Settings open/close), D (tasks tray), E (`d`/`l`
shortcuts), F (the opening), G (rendered-audio management) and H (provenance/cost). Only A
and B were in scope. TASKS.md's own milestone-level Verify checkbox is left unchecked —
it covers the whole milestone.

## M22.5 C + D (settings open/close; the tasks tray tells the truth) — 2026-08-05

**Part C.** Both bugs were exactly as diagnosed in the 2026-08-04 decisions entry, and the
fix was a genuine two-parter, not one thing wearing two names. `NavCluster.openSettings` now
checks `location.pathname === "/settings"` first and either `navigate(-1)` (had a
background) or `navigate("/")` (deep link), before doing anything else — since the click
handler and the `s` binding were already the same function, the toggle covers both for free.
Separately, `App.tsx`'s `findOverlayPathname` no longer takes a `background` parameter at
all — it now walks `location.state.background` in a `while` loop exactly like `roomLocation`
already did, so it finds a Scan/Digest any number of overlay-levels down instead of stopping
after one hop. Worth naming: these two fixes are independent of each other by design (the
toggle stops new bad stacks from forming; the walk fix means an *existing* stacked one, from
whatever cause, still resolves correctly) — fixing only one would have left the other's bug
class reachable.

**Part D.** The registry gained a second, parallel notification path
(`globalListeners`/`emitGlobal`/`subscribeAllJobs`) alongside the existing per-job
`listeners`/`subscribeJob` — deliberately not a replacement, since `usePlayer.ts`'s direct
per-job subscription is out of scope here and still needs the narrow one. `JobsProvider`
itself, though, no longer does any per-job subscribing at all: `ensureSubscribed` and the
`subscriptions` ref are gone, replaced by one `subscribeAllJobEvents` call for the Provider's
whole lifetime. `job.detail` is set at four of the five `startJob` call sites via two new
helpers in `llm/context.ts` (`sectionUiLabel`, `sectionRangeUiLabel`) that number sections by
their ordinal position in the fetched `sections` array, never by `spineIndex` — matching the
`chapterNumber` the digest status endpoint already computes the same way, so there's exactly
one place this numbering rule lives in spirit even though it's not literally shared code.
`theme-tagging` (the fifth site) has no natural single range, so it's left at the `detail`
parameter's default (`null`) rather than forced into a label that would lie.

### Verification method

Unit tests: `registry.test.ts` (global stream created/updated events, watching-never-owns,
`detail` stability and default), `context.test.ts` (`sectionUiLabel`/`sectionRangeUiLabel`,
including the case that matters — a gap in spine indices must not shift the ordinal — and the
two-endpoint arrow format), `App.test.tsx` (a real RTL render of the whole `App`: `s` closing
an already-open `/settings` with no extra history entry; `findOverlayPathname` exported and
unit-tested directly against a constructed Settings-over-Settings-over-Scan location chain).

No `chromium-cli` in this environment, but a cached Chromium existed at
`~/.cache/ms-playwright/chromium-1234` (left over from a prior session's verification pass —
see the M22.5 A+B entry above) from an `npm install playwright-core` in scratch. Drove the
real dev servers (already running, `tsx watch` + Vite, real library — Metamorphosis, a
Murakami short story, Alice in Wonderland): gear icon → `/settings` → `s` → back to `/` with
the modal gone; `t` opened the tray (`Nothing running or recently finished`, styled
correctly) and a second `t` closed it; the `GET /api/jobs/events` connection was visible in
the browser's own network log as a single long-lived `pending` request from mount, ending
only as `net::ERR_ABORTED` when the browser closed — the "watching, not owning, never ends on
its own" contract, observed rather than assumed. `curl` directly against the endpoint
separately confirmed the headers (200, `text/event-stream`) with the server otherwise idle.

Not driven this pass: an actual digest/audio-render job in flight (so `detail`'s live string
and a task row's hover-reveal weren't screenshotted with real content in them — both are
covered structurally by the unit tests instead, and by the acceptance-example assertion in
`context.test.ts`), the Scan-then-Settings-twice sequence specifically (covered by the
exported-function unit test instead of a live click sequence), and a second browser tab (the
cross-tab claim rests on the stream being registry-wide with no per-client state, which
`registry.test.ts` establishes directly). No screenshots were saved outside the session
scratch directory — the app's real book covers are in them, so they weren't published
anywhere.

## M22.6 B, task 4 — the TTS progress bar diagnostic: confirmed working, not fixed — 2026-08-12

**This is the "an actual digest/audio-render job in flight" gap the M22.5 C+D entry above
named as undriven — this pass drove exactly that.** Task text: "find out why the TTS bar
isn't showing; do not build a second one," with the explicit fallback that the operator's
memory could be of a *more prominent* presentation rather than a genuine break — a design
question, not a bug. No `chromium-cli` in this environment either, so this was driven from
the server/transport side rather than a screenshot of the rendered tray; see the reasoning
below for why that's still a real answer, not a lesser one.

**What was actually driven, against the real library (no fixture needed — `data/` already
had five imported books):** started both dev servers (`tsx watch` on :5175, Vite on :5173,
neither already running — checked with `lsof` first per the standing data/ caution), then
`POST /api/resources/<Kafka-on-the-Shore-id>/audio/sections/<spineIndex>` against several
never-rendered chapters to force real, uncached Kokoro synthesis (a cache hit responds
`{"cached": true}` with no job at all, which would have made this a non-test). Watched
`GET /api/jobs/events` with `curl -sN`, twice — once straight at :5175, once through Vite's
`/api` proxy at :5173 — while a render was genuinely in flight.

**Every event was correct and prompt, on both connections.** A `data:` frame per sentence,
each with `progress.current`/`.total` advancing by exactly one, `progress.message` the next
sentence's own text (never the previous one — this file's `audio/render.ts:221` model,
confirmed live, not just read), and `detail` holding the fixed `S<n> · <title>` range label
the whole time. Two concurrently-running jobs' events interleaved correctly on the one shared
stream, matching the registry's "one registry-wide stream" design. The Vite proxy did not
buffer or delay the stream — events arrived through it exactly as fast as direct, which rules
out the one dev-only difference that could plausibly have hidden this from the operator
without touching production.

**Reading `TasksTray.module.css` against this data settles the client side without needing a
browser.** `.progressTrack` (the bar itself) is a plain sibling inside `.row`, gated only on
`job.status === "running"` — unlike `.rowDetail` (the "Current" sentence text, along with
Kind/Book/Range/Started/Elapsed), which is deliberately hover/focus-revealed per the M22.5
comment already on it. `KIND_LABEL` in `TasksTray.tsx` already has an `"audio-render"` entry
("Rendering audio") — no kind-based filtering anywhere hides it from the list. So: the bar
*would* be on screen, unconditionally, the moment the tray is opened while a render is
running; only the live sentence text specifically needs a hover.

**Conclusion, per the task's own fallback: confirmed working, not a bug.** Every layer —
`render.ts`'s per-sentence report, the registry's global/per-job listeners, both SSE routes,
and the tray's own render logic — does exactly what M21/M22.5 built it to do. The most likely
explanation for the operator's memory is the two-step disclosure this already has by design:
the bar only appears once the tray is *opened* (a click or `t`, same as any other job — nothing
audio-specific), and the *sentence-level* detail only appears once a row is hovered or
focused on top of that. A render kicked off silently by `usePlayer`'s chapter-ahead warming
(never calling `registerStarted`, so no toast either — deliberate, per its own comment) gives
no on-screen cue at all *to open the tray in the first place* unless the reader is actually
stalled waiting for it (`player.status === "loading"`) — which is a real, once-per-hover gap
in discoverability, but a design question about prominence, not the wiring defect the task
asked to find. Left unfixed per the task's own instruction ("do not build a second one");
worth a design-session line if the operator still wants the tray to self-open, or the bar to
surface somewhere less hidden, for an audio-render job specifically.

**Cleanup:** every job started for this (six `audio-render` jobs, one deliberately left
running to observe, the rest cancelled immediately after their first event confirmed the
same behaviour) was cancelled via `POST /api/jobs/:id/cancel` before finishing — real Kokoro
synthesis time wasn't worth spending past the first few sentences per section. Both dev
servers were stopped by `kill`ing the exact PIDs `lsof -ti:PORT` returned, not a broad
`pkill`, and the port check before launch confirmed neither was already serving someone
else's session. The synthesized audio cached under `data/` from the render that did run a
little further (Chapter 26) is real, valid cache — left in place rather than deleted, since
it's indistinguishable from a listener actually having reached that chapter.

## M23 §A — the seam, and the texture-upload price — 2026-08-13

**The seam.** `web/src/scene3d/Scene3D.tsx`: one `Scene3DProvider`, mounted once in
`App.tsx` alongside `ChromeSlotProvider`, owns the single `<Canvas>`
(`@react-three/fiber`) the whole app ever creates. Consumers register content via
`useScene3DLayer(id, node)` — a keyed slot in a plain object, rendered as `<group>`
children inside the one `Canvas` — rather than mounting their own. `useScene3DAvailable()`
is `false` under reduced motion or after a lost context, so a consumer degrades to its
existing 2D presentation without a bespoke escape hatch, matching M25/M27's rule for the
page fold. No consumer exists yet (the Desk, shelf, turntable and opening are still their
2026-08-12-era 2D/CSS selves — that's §B–E, not built this pass), so today the canvas
never actually mounts in the running app; confirmed live rather than assumed (below).

**Dependency note.** `@react-three/fiber@9` requires React 19; this repo is pinned to
React 18.3.1 (no plan to move it for this milestone). Installed `@react-three/fiber@8.18.0`
instead, whose peers are `react >=18 <19` — no peer-dependency warnings. Anyone picking up
§B onward should not `pnpm up` this package without re-checking that constraint.

**Driven live**, both dev servers running for real (no `chromium-cli` in this environment;
used a cached Playwright + headless Chromium install found under
`~/.cache/ms-playwright/chromium-1234` instead, `--use-gl=swiftshader`): the Desk with the
three real fixture books, and opening Metamorphosis into the reader, both screenshot with
zero unexpected console errors (the one 404 is pre-existing and unrelated — present before
this change too). `document.querySelectorAll("canvas").length` was 1 on the Desk both
before and after this change — that canvas is `CursorTrail.tsx`'s pre-existing plain-2D
ink-trail canvas, not `Scene3DProvider`'s (which correctly contributes zero, since nothing
registers a layer yet). Under `reducedMotion: "reduce"`, canvas count was 0. The seam's
own mechanics (one canvas no matter how many surfaces register; unmounts once the last
layer unregisters; reduced motion and a simulated `webglcontextlost` both drop it to zero
canvases) are unit-tested against a mocked `Canvas` in `Scene3D.test.tsx` — jsdom has no
real WebGL, so those five tests prove the seam's own state machine, not anything about a
real GPU.

**The book object.** `web/src/scene3d/Book3D.tsx` + `useCoverTexture.ts`: page block,
spine and a front cover hinged at the spine edge (`x=0` in local space), authored once.
Cover art loads from the same `GET /api/resources/:id/cover` endpoint `BookCover.tsx`
already uses, with the same fallback contract — a 404 resolves to a plain fallback-colored
face rather than a broken texture or a thrown error, mirrored from `BookCover`'s own
onError path. Flat-color materials (spine, page block, cover edges, fallback face) are
five shared `MeshStandardMaterial` instances reused across every book, not allocated per
instance; the one true per-book material (a texture map) disposes itself on unmount since
it's attached via `<primitive>` and R3F's own dispose-on-unmount doesn't reach primitives.
Not yet wired into any surface — §B–E do that — so this is unverified in an actual scene
composition beyond the bench below; visual geometry correctness (is it recognizably a
book, does the hinge look right) wasn't separately screenshotted this pass.

**Texture-upload price, measured before any resolution choice** (the task's explicit
gate, echoing M25/M27's `texImage2D` pricing for the page fold). Built a throwaway bench —
`web/bench.html` + `web/benchEntry.tsx`, a standalone Vite entry outside the app's own
routing, 40 planes each loading a real cover image through a `?bench=n`-suffixed URL (the
id itself is untouched and still resolves to real cover bytes; only three distinct fixture
covers exist in this library, so the query string exists purely to stop three.js's own
`TextureLoader` cache from collapsing 40 loads down to 3 — it does not fake the image
data, which is real in all 40 cases) — then deleted both files once the number was in hand,
per "don't leave scaffolding beyond what's needed." Instrumented via `page.addInitScript`
patching `texImage2D`/`texSubImage2D`/`texStorage2D`/`compressedTexImage2D` on both
`WebGLRenderingContext` and `WebGL2RenderingContext` with `performance.now()` timing.
**First attempt only patched `texImage2D` and undercounted (7 calls instead of dozens)** —
this three.js/WebGL2 path uploads via `texStorage2D` (immutable allocation) +
`texSubImage2D` (the data), not `texImage2D`; patching all four brought the count in line
with what the screenshot already showed (all 40 covers visibly rendered, distinct real
thumbnails, not solid-color fallbacks).

**Result: 87 GL calls, 774.20ms total, ~8.9ms mean per call, ~19.4ms per book** across 40
real-cover texture uploads. ⚠️ **Measured on SwiftShader (`--use-gl=swiftshader`) in
headless Chromium — the same caveat PAGE_CURL.md/M25 already recorded for `texImage2D`:
this cannot distinguish a real GPU upload from a CPU pixel path**, so treat this as an
upper bound, not the number a real machine would see. At face value it says a ~40-book
shelf uploading every cover at once costs on the order of ~0.8s of GL work — not
free, but not the ~56ms-per-texture-times-dozens catastrophe the warning was guarding
against either. No resolution cap or downscaling was added — nothing here showed one is
needed yet, and adding one without a shown problem would be exactly the "hypothetical
future requirement" CLAUDE.md warns against. If §D's real shelf (real GPU, real 40+ book
library) shows this mattering, the fix is almost certainly "load textures as scrolled into
view," not a resolution cap — flagged here rather than decided.

## M23 §B — the Desk, looking down — 2026-08-13

**The design.** `desk/DeskScene3D.tsx` registers as the `"desk"` layer: a straight-down
`OrthographicCamera` (`DeskCameraRig`, `camera.manual = true` — R3F's own resize handling
otherwise silently overwrites a custom frustum on every size change, found live as a
keystoned book shape that turned out to have nothing to do with tilt) whose frustum maps
world units to viewport pixels **1:1**, refitted every frame from the desk's own
`getBoundingClientRect()`. That 1:1 mapping is the whole point (SPEC-GAP, `deskDepthMath.ts`'s
own doc comment): TASKS.md's own warning that "a projected 3D surface is where hit-testing
breaks" steers away from a literal perspective camera, whose foreshortening would move a
book's *visual* position away from its stored px coordinates and the DOM `BookObject` that
still owns drag/drop. Depth is faked instead — `bookTilt()` rotates each book proportional
to its distance from the viewport's centre — on top of an orthographic camera that never
distorts DOM/3D alignment, including at the corners (verified live below).

**Three real bugs, found only once real fixture books rendered** (Book3D's own §A note
already flagged its geometry as unverified beyond a bench — this is that verification):

1. **The reveal read as a warped wedge, not a book**, at any non-trivial tilt. Root
   cause: `bookTilt`'s axis was the free diagonal perpendicular to the pivot-to-book
   direction. A box tilted around an axis *not* parallel to one of its own edges reveals a
   *non-uniform* sliver of its side face — wider at one corner than the other — and that
   sliver's silhouette, unioned with the top face's own (still mathematically perfect)
   parallelogram, is what read as a taper. Proven with a plain debug box before touching
   Book3D at all, ruling out the compound geometry as the cause. Fixed by snapping the axis
   to whichever of the book's two edges (world X or world Z) dominates the offset — a hard
   snap at the diagonal rather than a smooth blend, which is fine: a real spine doesn't
   allow a diagonal reveal either. `deskDepthMath.ts`'s doc comment on `bookTilt` carries
   the full reasoning; `deskDepthMath.test.ts` pins the snapped-axis contract.
2. **Cover textures rendered on the wrong book.** All three fixture covers loaded
   correctly (confirmed via `useCoverTexture` in isolation and via the network log — three
   distinct 200s, no errors) but Metamorphosis's art appeared on Kafka on the Shore's mesh
   while Kafka's and Alice's own slots sat at the flat fallback colour. The 2D DOM
   `<img>`s were unaffected (each showed its own correct cover), confirming this was a
   three.js/R3F-side bug, not upstream data. Fixed in `Book3D.tsx` by keying the cover
   mesh on `coverMaterial.uuid`, forcing React to remount the mesh (and its `attach`
   bindings) instead of reconciling `attach="material-4"` in place when the material
   identity changes from the shared fallback to a fresh per-book instance — whatever R3F's
   own attach-reconciliation was doing across sibling fibers updating at different times
   (async texture loads staggered per book), a full remount sidesteps it. Root cause not
   fully isolated beyond that; flagged here in case §D's larger book count reproduces it
   more legibly.
3. **The whole Desk stopped accepting clicks and drags** the moment any 3D layer actually
   mounted — invisible until now because §A's own canvas literally never rendered before
   this task (`shouldMount` was always false with nothing registered). Two independent
   layers of `pointer-events: auto` were fighting the fix: `Scene3D.module.css`'s
   `.canvasLayer` (a `position: fixed`, full-viewport div with an explicit `z-index`, which
   per CSS stacking rules paints — and hit-tests — above ordinary non-positioned page
   content regardless of DOM order) needed `pointer-events: none`; separately, R3F's own
   `<Canvas>` renders an *internal* wrapper div with an inline `pointerEvents: "auto"`
   default (its own assumption that it, not something underneath, is the event source),
   which no amount of outer CSS can override since it's inline and not inherited from a
   `none` ancestor once set explicitly. Fixed both: the CSS layer for documentation/defense
   in depth, and `style={{ pointerEvents: "none" }}` passed directly to `<Canvas>` for the
   one that actually mattered. This is a real §A seam bug, not something §B introduced —
   worth a one-line flag back to that milestone's own doc for whoever reads it next.

**Verified live**, both dev servers, real Playwright + the same cached headless Chromium
build M23 §A used (`--use-gl=swiftshader`), against the three real fixture books:
- Both themes (Paper and Ink) and two window sizes (1400×900, 1000×700) screenshot with
  correct covers, clean parallelogram silhouettes, and a visible desk surface + raised
  edge that reads as a bounded surface without overpowering the books/notepad foreground.
- `document.querySelectorAll("canvas").length` is 2 under normal motion (the pre-existing
  `CursorTrail` canvas + the one shared Scene3D canvas) and **0** under
  `reducedMotion: "reduce"`, with the plain 2D Desk (real cover art, flat) as the fallback.
- A real pointer drag (`page.mouse`) from a book's centre to the desk's bottom-right
  corner: the DOM position updates, the 3D render follows it exactly there, and hovering
  at the corner still surfaces the info strip — hit-testing holds at the corner, the case
  TASKS.md's own warning called out. A plain click still navigates to `/read/:id`.
- Every book is still exactly where `defaultShelfState`/persisted `shelf` puts it — the
  camera is fitted from the desk's own rect every frame and never re-lays anything out.

Not yet covered by this pass: the desk's own ~1.6° ambient CSS parallax tilt
(`useDeskParallax`) is a *separate*, pre-existing 2D effect on the DOM `.surface` that the
3D layer doesn't share (the 3D camera is fixed) — at rest they agree exactly (verified: 0°
tilt at pointer rest), and diverge by at most a few px at the DOM layer's own extreme tilt
while the pointer is actively over the surface; not worth chasing further without a shown
problem. §C–E still need their own live verification once built.

## M23 §B — the Desk, rebuilt on a real camera — 2026-08-13 (second pass)

Operator review of the first §B pass, same day: books rendered with pieces missing, the
depth "only updates in a few fixed points, seems to snap", the reveal was **inverted**
(a book at the left showed its left side, not the side facing the camera), the hover
action card had disappeared, and returning from the reader dropped the Desk back to its
2D presentation. Four separate causes; the first three were all one wrong trade.

### The wrong trade: an orthographic camera plus a faked tilt

The first pass read TASKS.md's warning that "a projected 3D surface is where hit-testing
breaks" as *avoid a perspective camera*, and built a straight-down **orthographic** camera
with a 1:1 world-to-pixel frustum, faking depth by rotating each book about its own centre
proportional to its distance from the viewport centre (`bookTilt`). All three visual
defects fall out of that one decision:

1. **Inverted.** Rotating a box about its own centre lifts the far edge and buries the
   near one, so the sliver you see is the side pointing *away* from the camera. Real
   foreshortening shows the side pointing *toward* it.
2. **Cut off.** The same rotation sank the other half of the book *below* the desk plane,
   which then occluded it — that is the clean straight edge across each cover in the
   operator's screenshots, and it is always on the side facing the screen's centre because
   that is the half that goes down.
3. **Snapping.** The tilt axis had to be snapped to whichever of the book's own edges
   dominated the offset (§B's first pass had already found that a diagonal axis reveals a
   tapering sliver that reads as a warped wedge). Snapping to one of four cardinals is
   exactly "updates its perspective in a few fixed points."

None of these is a tuning problem. They are what faking foreshortening costs.

### The fix, and why it does not cost hit-testing

`DeskScene3D.tsx` now runs a real `PerspectiveCamera` hung straight above the **viewport's**
centre. The hit-testing worry is answered exactly rather than traded away: put the eye at
distance `d` with vertical fov `2·atan((h/2)/d)` and aspect `w/h`, and the plane `y = 0`
maps to the viewport **1:1** — world (x, 0, z) lands on screen pixel (x, z), corners
included. It is the same construction CSS `perspective: <d>px` uses. So a book's
*footprint* is exactly its DOM `BookObject` rect at every desk position, and only what
stands above the desk splays — which is the depth cue the milestone wanted. Derivation and
the budget it spends live in `deskDepthMath.ts`'s header; `deskDepthMath.test.ts` pins the
1:1 mapping at two window sizes and four points including both corners, pins the reveal's
*direction*, and pins that the reveal grows strictly proportionally to offset (the "no
steps" property, stated as a test rather than as a comment).

`d = clamp(0.9 · viewportHeight, 620, 1400)` — ~54° at 900px tall, wider than CSS's
conventional ~1000px perspective, short of the corner fisheye below ~45°. Scaling with the
viewport keeps the angle a book near the edge is seen at roughly constant across window
sizes.

Two related sign/geometry bugs fixed at the same time, both silent:
- **`Book3D` was not the solid its bounds claimed.** Its spine box was centred at
  `-thickness/2` with depth `thickness`, so it reached a full thickness *below* the back
  board. Any consumer laying the book on a surface at its own origin buried most of it. It
  is now centred on z, with a back board, an inset page block and the hinged front cover.
- **Yaw had the wrong sign.** The stored rotation is a CSS `rotate()`, where positive is
  clockwise on screen; a positive rotation about world +Y is counter-clockwise seen from
  above. The 3D book and its DOM hit target sat at mirrored angles.

### The action card had not gone anywhere — it was behind the canvas

`Scene3D.module.css`'s `.canvasLayer` is `position: fixed; inset: 0; z-index: 0` and comes
*later* in DOM order than the page, so it painted over everything on the Desk. The hover
card, the notepad and the listening tool were all fully present, focusable and clickable
the whole time, and invisible under an opaque 3D desk surface. (The first pass verified
the card by asserting it was in the DOM, which it always was. The check now is
`document.elementFromPoint` at the card's own coordinates — what actually receives a click
there — not `querySelector`.)

Fixed as a **layering contract** written into both files rather than a one-off: the canvas
stays at `z-index: 0`; a consumer's foreground DOM claims `z-index: 1` (`.surface`), and
its *background* gets out of the way while 3D is on (`.surfaceIs3D` drops the background,
border and 2D grain, keeping the box, the scroll extent and every hit target). The
`useDeskParallax` tilt is now also off under 3D — a 2D rotation of the DOM subtree that the
3D camera does not share rotates every hit target away from the object drawn for it, which
is the exact DOM/3D disagreement the 1:1 plane exists to prevent.

### The desk reverted after reading because R3F's own teardown looks like a lost context

`unmountComponentAtNode` in `@react-three/fiber@8.18.0` calls `gl.forceContextLoss()` 500ms
after the tree detaches (`events-*.esm.js:2095`). That fires a real `webglcontextlost`
event on the canvas being torn down, which `Scene3DProvider`'s own handler read as a
genuine loss and latched — permanently. Leaving the Desk for the reader unregistered the
last layer, unmounted the canvas, and poisoned `contextLost` for the rest of the session.

Three changes, in order of how much they matter:
- The canvas is now **sticky**: once any consumer has registered, it stays mounted and
  idles at `frameloop="never"` when nothing wants it. This removes the unmount entirely on
  every room change, and skips re-uploading every cover texture too.
- The loss handler ignores events fired while we are deliberately unmounting (the one
  remaining path is reduced motion turning on mid-session).
- A genuine loss is no longer a one-way door: a torn-down canvas can never receive
  `webglcontextrestored`, so the provider schedules its own remount after 1.5s, up to three
  attempts, then settles into 2D for good.

`Scene3D.test.tsx` now pins all three; the old "unmounts once the last layer unregisters"
test was asserting the bug and has been replaced with its round trip.

### Lighting: the intensities were ~π too low, and the shadows had no frustum

⚠️ **Measured, not guessed.** The desk rendered at (149,144,132) against a `--desk-surface`
token of #eee6d6 — exactly 0.36 of its own colour. three.js runs every light through
`BRDF_Lambert`, which divides by π, so an up-facing surface only renders at its true colour
when the intensities reaching it sum to about **π**. At the first pass's 0.75/0.65 (and at
this pass's first attempt of 0.62/0.55) everything was at ~36% brightness, which reads as a
broken material rather than as dim light. Now ambient 1.7 + directional 1.55, i.e.
`ambient + directional·cos θ ≈ 3.14` on the desk plane. *(An earlier hypothesis that ACES
tone mapping was the cause was wrong — but `flat`/`NoToneMapping` is still right here, since
these materials are tinted straight from CSS custom properties and should not be graded.)*

Separately, `castShadow` had been on since §A and **nothing had ever cast a shadow**: a
directional light's shadow camera does not follow the scene, and three's default is a
±5-unit box at the world origin — roughly the top-left corner pixel of the page, given that
this seam's world unit is the CSS pixel. It is now fitted to the viewport plus a 300px
margin. First cut used ±(0.75·size + 400) on a 2048² map, which spent three quarters of the
map off-screen; since the Desk runs a continuous frameloop, that map is re-rendered *every
frame*, and under SwiftShader it was slow enough to stall Playwright's own input dispatch
for minutes. A viewport-fitted 1024² map is ~2 world units per texel — a soft contact
shadow, and a quarter of the per-frame cost.

**The seam now states its coordinate convention explicitly** (`Scene3D.tsx`): one world
unit is one CSS pixel, origin at the viewport's top-left, +X right, +Z down the screen, +Y
up out of the desk. It was already implicitly true and is what lets a surface place content
straight from `getBoundingClientRect()`; the shadow-frustum bug is what a convention nobody
had written down costs.

### Also changed
- **Books have thickness now, and it varies** (`bookThickness`, 17–30px, hashed from the
  resource id). A desk of identically-thick books reads as tiles, not objects. SPEC-GAP:
  the library carries no page or word count to derive a true thickness from; if one lands,
  that function is the single place that changes.
- **Hover and drag lift the 3D object, not the DOM.** `BookObject` owns the gesture and
  writes a target height into a shared `lift` motion value; `DeskScene3D` damps toward it.
  The book's shadow then comes from its real height for free, so the 2D `box-shadow` and
  `whileHover` lift are switched off under 3D rather than doubling up.
- `stackElevation` is capped at rank 8: under perspective, elevation is no longer free.

### Verified live
Playwright + the cached headless Chromium (`--use-gl=swiftshader`), three real fixture
books, **zero console or page errors** across every case below:
- Books dragged into three corners render whole, resting *on* the desk, each showing the
  faces pointing back toward the camera — a book at the left shows its right side and (if
  above centre) its bottom edge; mirrored on the right. Screenshots in both themes.
- Mid-drag frames across the full width: the reveal tracks continuously and the dragged
  book visibly floats above the one it passes over.
- The hover card is back, `elementFromPoint` lands inside it, all four actions present, and
  clicking "Read digest" navigates.
- **Three consecutive reader round trips**: canvas count stays 2 (CursorTrail's pre-existing
  2D canvas + the one Scene3D canvas) and the Desk stays 3D every time.
- Reduced motion: **0 canvases**, 2D desk with real cover art; `l` → list view, 0 canvases.
- Two window sizes (1400×900, 1000×700).

### Left alone, deliberately
- **`desk/DeskScene3D.tsx` imports three.js**, which is in tension with §A's own acceptance
  criterion ("`grep` finds no three.js import outside the seam"). Pre-existing from the
  first pass and not silently unified here: what the rule is actually protecting — no three
  types reaching `DeskCanvas`, `BookObject`, `DeskPage` — does hold (`DeskBookPlacement` is
  motion values and plain numbers). Whether per-surface scene files belong in `scene3d/` or
  next to their surface is a structural call for §C/§D, when there are three of them to
  look at, not one.
- The hover info card inherits the book's CSS `rotate`, so it sits tilted. Pre-existing in
  the 2D desk too; out of scope for this pass.
- A book dragged under the notepad always loses to it now, regardless of z-order, because
  the notepad is DOM and the book is canvas. The 2D desk had the same ordering; flagged in
  case §C's turntable makes it matter.

## M23 §B — the binder stops fizzling — 2026-08-13 (third pass)

**Operator report:** everything else about the reworked Desk looked right, but "the binder
of the book... sort of fizzles, and at times and parts you can see through it, especially
when hovering over the book and dragging it around."

**Cause: four solids sharing one plane.** `Book3D`'s spine was a box spanning the full
thickness at `x = 0`, and the back board, the page block and the front board *also* started
at `x = 0`. All four then presented a face on the plane `x = 0` with the **same** outward
normal, and the spine additionally shared `z = ±thickness/2` with both boards. Coplanar
same-facing polygons are a depth-buffer tie broken by float noise, so which one wins changes
with every sub-pixel of camera movement — a still book is stable and a moving one shimmers,
which is exactly the shape of the report. What "showed through" was the page block's cream
(`#f2ead9`) winning the tie against the spine's brown; it is visible as a light sliver beside
the binder in the before screenshots.

**Fix: the back is round, because a bound book's back *is* round.** New
`scene3d/bookGeometry.ts` derives the arc: a circle centred at `(c, 0)` through the spine's
apex at the book's own left bound has radius `c`, and requiring it to also pass through the
boards' outer corners `(bulge, ±t/2)` gives `c = (bulge² + t²/4) / 2·bulge`. The curve joins
the covers with no step and no overlap, so the shared planes are gone rather than nudged
apart by an epsilon. Rendered as a partial `CylinderGeometry`; the test pins
three.js's `(sin θ, ·, cos θ)` vertex convention, since `Book3D`'s placement depends on it.

Two consequences worth stating:
- **The bulge comes out of the covers, not out of the footprint.** The boards now span
  `[bulge, width]`. On the Desk `x ∈ [0, width]` *is* the DOM hit target
  (`deskDepthMath.ts`'s 1:1 plane), so a spine hanging outside it would trade a rendering
  bug for a hit-testing one. The cover carries ~4.5% less width than its source 2:3 image —
  under the threshold where the squeeze reads.
- **The arc's end caps run a half-unit past head and tail.** Flush would put them in the
  boards' own end planes facing the same way, re-creating the tie this curve exists to
  avoid. Half a unit is half a *pixel* here, under the antialiasing.

⚠️ **Coincident faces with *opposite* normals are fine and are still used** — the page
block's faces against the boards' inner faces. Backface culling draws exactly one of the
pair. Only same-facing coincidence fights, which is the distinction to carry into §C–§E.

**Verified live:** same Playwright + SwiftShader harness. Before/after close-ups of the
binder at the left edge, the right edge, and three mid-drag positions: the cream sliver is
gone and the spine reads as one solid rounded band. Ten frames of a held, lifted book at the
desk's left edge are **byte-identical**. The fore edge still shows board / pages / board.
Corner hit-testing, the ink theme, and reduced motion (0 canvases) all unchanged.

## M23 §C — the turntable — 2026-08-13

Both §C tasks: the listening tool is a real deck standing on the desk, and dragging a book
onto its platter opens that book listening.

### The tool did not become 3D; it grew a 3D presentation

`ListeningTool.tsx` is still the whole control. It keeps the click, the focus ring, the
accessible name, `aria-pressed` and its label; under 3D it gives up only its paint and its
SVG, the same trade `.surfaceIs3D` makes for the desk. `Turntable3D.tsx` handles **no input
at all** — it reads that button's rect every frame and is driven entirely by props the
button owns. Deleting it leaves listening working exactly as before, which is what actually
happens under reduced motion and after a lost context.

One consequence worth stating, because it is the opposite of how a 3D object usually gets
sized: **`ListeningTool.module.css`'s `.is3D { width: 152px; height: 132px }` is what
decides how big the drawn deck is.** The layout is derived from the live rect, so the
stylesheet is the single source of the object's size and its hit target at once. The old
30px icon's footprint would have been a smudge from a top-down camera.

### The tonearm's angles are solved, not chosen

`turntableMath.ts` lays the deck out in *ratios* of the tool's rect, which makes a
hand-picked pair of arm angles a latent bug: they would be right only for the proportions
they were eyed at. So the angles come out of the geometry — "put the stylus this far from
the spindle" — by solving `|p + L·d(θ)|² = target²` for θ. That equation has two roots, and
**taking the wrong one is not subtle**: the other root reaches the same groove by swinging
the arm across the record from behind, which reads as a broken machine. The module always
takes `φ − acos(k/R)`, which keeps the arm on its own side and makes park → play → run-out a
single monotonic sweep. The tests assert the property rather than the numbers — parked is
*clear of the record*, playing is in its *outer third* — at three deck proportions.

### Two things found by looking at it

- **A dragged book covers the deck it is being dropped on**, so the 3D drop cue (a lit ring
  around the platter) is invisible at exactly the moment it matters: the book is lifted 34px
  and drawn in the same canvas, and it wins. The cue that survives is a **DOM** one — the
  button sits above the canvas per the layering contract, so its ring and wash draw over the
  book. The 3D ring stays for the approach, before the book reaches the deck.
  ⚠️ Generalisation for §D/§E: *a 3D affordance for a gesture involving another 3D object
  cannot be in the canvas*, because the moving object is in there too.
- **The record ran under the control's own text label.** The label is DOM painted over the
  canvas, so the words lay across the grooves. The platter is now set back (and slightly
  smaller), leaving the cabinet a clear front panel for its badge.

### The drop is the existing drag, extended

No second drag system. `BookObject` reports its **cover's** rect on each drag frame and once
more on release; `DeskCanvas` owns the targets and answers. A consumed drop opens the book
listening and **does not persist a position** — the book was being played, not arranged, so
coming back from the reader finds it where it was left.

The target is a **circle**, not the button's rect: the platter is what you aim at, and a
rectangle would accept a corner the deck visibly does not occupy. It is measured against the
book's centre, not the cursor — the book is the thing being placed, and the cursor sits
wherever it happened to be grabbed.

### Verified live
Playwright + SwiftShader, real fixture books, **zero console or page errors**:
- Deck parked and playing, in both themes: arm swings in, platter spins up, lamp lights.
- Keyboard: focus lands on the tool, **Enter and Space both toggle it**, `aria-pressed`
  follows, and the label reads "Listen"/"Listening".
- Dropping a book on the platter reaches `/read/<id>` and the reader shows **"Pause
  listening" / "Stop listening"** — probed against the hover card's own "Listen" action and
  the two are identical.
- A drag that ends anywhere else still just places the book; a drag released at the very
  edge of the window leaves the book where it was released, not on the cursor.
- The deck follows the page scroll, still landing exactly on its button's rect.
- Reduced motion: **0 canvases**, the SVG tool at its own smaller size, still toggling.
- The list view still carries its own "Listen" action, untouched.
- The shelf state each run touched was read before and written back after, and verified
  identical.

## M23 — the Desk followed you out of the room — 2026-08-13

Operator report after §A–§C: "the desk is persistent (so reader view does not open, neither
does library)". Reproduced live in the first minute: click **List**, and the *desk* is still
there — wood, rim, books at their desk positions — with the Library grid rendering
invisibly underneath it. Same on `/read/:id`.

**Cause: an idle WebGL canvas keeps showing its last frame.** §A's canvas is deliberately
sticky — it stays mounted for the session and drops to `frameloop="never"` when no surface
has content registered, because tying its lifetime to `hasLayers` made R3F's unmount path
fire `webglcontextlost` and permanently degrade every 3D surface (documented in
`Scene3D.tsx`). What "idle" was not doing is *clearing*. The drawing buffer is not wiped
because nothing is drawing into it; with the frameloop stopped, nothing ever will be. So the
Desk's final frame stayed painted on a `position: fixed; inset: 0; z-index: 0` layer, over
every room the user went to next — and rooms whose own DOM does not claim a stacking context
(the reader, `LibraryGrid`) render *below* it and appear not to have opened at all.

**Fix:** the canvas layer is `visibility: hidden` while no layer is registered. The canvas,
and therefore the GL context and every uploaded cover texture, stays alive — the stickiness
is the whole point — it simply stops being shown. One line, and a regression test in
`Scene3D.test.tsx` that asserts it alongside the `frameloop` it already checked.

**The general lesson, for §D and §E:** the layering contract in `Scene3D.module.css` covers
*where* the canvas paints. It did not cover *when*. A 3D layer that has stopped rendering is
not the same thing as a 3D layer that is gone, and only the second one is safe to leave over
another room.

## M23 §D — the shelf, and the binding that came with it — 2026-08-13

### The measurement gate, which found a defect rather than confirming a plan

§A required pricing the texture upload "with real covers at real count" before choosing
resolutions. The real count is three, which prices nothing, so the measurement was taken
against a **synthetic 60-book library served from the real fixture covers** (Playwright
route interception — no fixture, no data, and no shelf state was touched to do it).

The first read, before any change:

| | 3 books | 60 books |
|---|---|---|
| GPU texture bytes | 8.5 MB | **465 MB** |
| Upload time (`texStorage2D` + `texSubImage2D`) | 10.6 ms | **1,088 ms** |
| Draw calls / frame | 32 | 387 |

465 MB is the covers arriving at their source resolution — around 1200×1800, 8.6 MB each
— while being *drawn* at 168×252 CSS px on the Desk and a foreshortened ~235×352 on the
shelf. No surface can show a texel of the difference. `useCoverTexture` now downscales to
a 576px longest edge (twice the largest on-screen size, so a 2× display is covered)
before the GPU sees anything: **86 MB and 65 ms** for the same 60 books, a 5.4× cut in
bytes and 17× in upload time.

Two notes for whoever reads this next. First, the instrumentation itself was wrong at the
first attempt: hooking `texImage2D` measured **8 calls and zero bytes**, because three.js
on WebGL2 uploads through `texStorage2D` + `texSubImage2D`. A measurement that reports
"free" is worth exactly as much as no measurement. Second, this is the same shape of
mistake in a different place: a texture's budget comes from how large it is *drawn*, and
"it's the file we already have" is not a resolution decision.

### The frame rate is the one criterion not signed off here

§D asks for 60fps while scrolling. **This machine cannot measure it.** Headless Chromium
resolves to `ANGLE (SwiftShader)` — software rasterisation — where the *already-shipped*
Desk sits at the harness's own 30Hz ceiling and a 60-book shelf falls to ~6fps. Those
numbers say nothing about a real GPU. What can be stated hardware-independently: 32 draw
calls per frame at the real library size, 387 at 60 books, and per-frame JS of one
`getBoundingClientRect` on the strip plus one damped lift per book. The criterion is owed
on the operator's own machine.

### The shelf is the seam's second camera, and that is the point

The 2026-08-13 ruling said consumers share the units and bring their own camera. The
shelf is the first surface to actually exercise it: the Desk hangs a camera above the
plane `y = 0` looking down; the shelf stands one in front of `z = 0` looking along −Z; a
DOM point `(x, y)` is world `(x, −y, 0)`. Identical 1:1 construction, and on this surface
it lands somewhere better than the Desk's — the **spine face** is the 1:1 face, so the one
face a user can see or click is exact and every part that foreshortens is behind it where
nothing is aimed. Hence upright books: a lean is charming and was tried, and it is the
single thing that breaks that agreement.

Three things went wrong on the way, all worth keeping:

- **The books faced the wrong way.** Standing `Book3D` spine-out is a **+90°** yaw about
  Y. −90° is the plausible mistake and points the same book *out of the screen*: the
  shelf showed a row of page blocks coming at the camera with the spines buried behind
  the plank. It looks like a lighting or a geometry bug and is neither.
- **The lights are a desk lamp.** `SceneLights` hangs above `y = 0` and points down, which
  grazes a viewer-facing spine at almost zero incidence — the first shelf was lit by
  ambient alone, flat and about half its true colour. The shelf brings its own front key.
  Safe only while the Desk and the shelf are mutually exclusive view modes; recorded in
  the component, in decisions.md, and in CLAUDE.md.
- **A back panel turned the room into a bookcase.** Any panel tall enough to sit behind
  the books fills most of the viewport, and a flat wall of desk colour is what the eye
  lands on instead of the books. Deleted; the plank alone grounds them, and it shares the
  Desk's own grain (`woodTexture.ts`, extracted for the purpose) so the two surfaces read
  as one room.

### The binding, which is a property of the book and not of the shelf

The operator asked for spine titles and a cover-derived cloth colour. Both went into the
shared `Book3D`, so the Desk gets them in the same commit rather than growing a second
book asset later — which is the entire reason §A insisted on one.

- **Colour** (`coverPalette.ts`): quantize to 4 bits a channel, weight each pixel by
  `0.15 + saturation` and discount near-white and near-black to a tenth, take the heaviest
  bucket's weighted average, clamp into a lightness band. Deliberately dumb — the target
  is "recognisably this book's colour", not a faithful dominant hue, and it runs on the
  main thread while a shelf mounts. A book with no cover gets a deterministic muted
  fallback, so it is still a distinct object rather than one of a row of blanks.
- **Ink** is picked by contrast from two fixed inks, never computed. A per-book computed
  ink drifts into low-contrast mud on exactly the mid-lightness bindings where legibility
  is hardest.
- **Lettering** (`spineTexture.ts`) is painted into a canvas texture because the spine is
  a *curve* — `bookGeometry.ts` made sure of that — so there is no flat rectangle to hang
  a DOM label on. `CylinderGeometry`'s `v` runs along the book's height and `CanvasTexture`
  keeps `flipY`, so canvas row 0 is the book's **head** and text painted downward reads
  head-to-tail, as an English-language spine is bound.
  ⚠️ The type was fitted in *canvas* px at the first attempt, which silently halved every
  size bound in `spineLayout.ts` (they are sizes a reader sees, and the canvas is 2×). It
  read as timid rather than as broken, which is the kind of bug that ships.

### One card, two surfaces

M22.6 §D's hover card was inlined in `BookObject.tsx`. §D needed the same card on the
shelf, so it moved to `desk/BookActionCard.tsx` — one control, one behaviour, a
`placement` prop for the two sides it hangs from (the Desk looks down at a cover and hangs
it below; the shelf looks at an upright spine and floats it over the head). Settled
decision 12: a control means the same thing on every surface.

The one thing that had to survive the move: "Listen" flies the reader's opening from the
**book**, not from its own button, while Scan and Digest deliberately fly from their
buttons — they are popups put *on* the surface, not a room change. Hence `openOriginRef`.

### Verified live
Playwright + SwiftShader, real fixture books, **zero console or page errors**:
- `d` / `l` / `b` reach three distinct views ("The Desk" / "Library" / "The Shelf").
- Tab reaches **3/3** books on the shelf; Enter on a focused spine opens the reader;
  focus alone (no pointer) lifts the book and opens its action card.
- The action card's own buttons work from the shelf (Open scan → `/scan/…`) and do not
  also open the book.
- `elementFromPoint` at a spine's centre lands inside that book's own slot, in both
  themes — the 1:1 plane holding where §B warned hit-testing breaks.
- Reduced motion: **0 canvases** on all three views, and the shelf still renders flat CSS
  spines on a CSS plank with every book focusable.
- `WEBGL_lose_context` on the shelf: 0 canvases, 3 books still visible and usable.
- Both themes and two window sizes.
- **The Desk, after the card extraction:** hover card and its four actions present, drag
  moves a book by exactly the gesture and persists, click still opens the reader.
- The shelf state each run touched was read before and written back after, and the stored
  x/y are byte-identical (only `zOrder`, which is a session counter, moved).

## M23 §E — the opening, finished in 3D — 2026-08-13

The last of the four surfaces. The brief the operator added to the task: **treat the book
as a 3D object with object permanence** — everything flows into the reader view over about
a second.

### The camera never moves, and that decision made the milestone small

The obvious build is an opening with a camera of its own, flying from wherever the book
was to a view of the open spread. It is also the one build that cannot have object
permanence: a camera change is a discontinuity on the *first* frame, and no easing
afterwards puts it back.

So the opening **borrows the source surface's camera unchanged** — `deskViewFrame` or
`shelfViewFrame`, both pure functions of the viewport, so reproducing exactly what the
user was looking through a moment ago costs one function call — and moves only the book.

That turned out to cost nothing at the far end either, because §B and §D had already built
the two cameras out of the same construction: each has a plane that maps to the viewport
**1:1**, and a cover turned to face the camera lies in that plane. The Desk's is `y = 0`
seen from above; the shelf's is `z = 0` seen from the front. Different planes, identical
arithmetic — which is why `reader/openingGeometry.ts` is written entirely in "stage px"
(x right, y down, z toward the camera) and `BookOpening3D.tsx` converts once, by either
rotating the whole frame onto the Desk's plane or leaving it on the shelf's:

```
<group rotation={surface === "desk" ? [-π/2, 0, 0] : [0, 0, 0]}>
```

**That one line is the whole desk/shelf difference**, which is what TASKS.md's "share the
open/land phases in code, not by copy" asked for, arrived at by construction rather than
by discipline. The shelf's only extra is a control point in the travel's Bézier that
pulls the book straight out of the row before it goes anywhere.

### The spread is two boards, not two footprints

TASKS.md says "twice the cover's width" and that is now exact — but exact against the
**board**, not against the 168px DOM rect. `spineBulge` takes the round back's bulge *out*
of the covers (they span `[bulge, width]`) precisely so the object never hangs outside the
footprint its hit target claims, so an open spread runs `bulge − boardWidth … width`:
`2 × boardWidth`, centred on the hinge, ~4.5% narrower than 2× the rect. The property the
landing actually depends on — **the crease is the spread's own centre** — is exact, and is
a test rather than a comment (`openingGeometry.test.ts`).

### Two defects found by driving it, not by reading it

1. **The landing overhung the reading pane by 7px on the left, and nothing on the right.**
   The two halves of a spread are not coplanar: the page block's top is at
   `blockThickness/2` and the swung-open board's paper a board thickness above it. The
   landing planted the page block on the camera's 1:1 plane, which left the *cover* half
   proud of it — and anything off that plane splays outward with distance from the optical
   axis. On a 1204px pane that is 7px. `openSpread.paperZ` is now the **midpoint** between
   the two, so each half is ~1px out in opposite directions.
   The general shape, worth keeping: *"scaled correctly" and "lands correctly" are
   different claims under a perspective camera.* Only the 1:1 plane makes them the same.

2. **The book vanished for 250ms before the opening started.** `App.tsx` code-splits
   `ReaderPage`, so clicking a book left the Desk mounted (React 18 holds the old route
   while the new one suspends) and then swapped rooms a quarter-second later. Every frame
   after that was continuous; the very first one was not, which is the only frame object
   permanence is about. `reader/preload.ts` fetches the chunk on **hover or focus** — the
   gesture that precedes every open — and the handoff drops to ~39ms, one commit, measured.
   The code split survives it: `ReaderPage` is still its own 462KB chunk in the build.

### The tint had to go, and that is a decision

The old overlay tinted the screen at `z-index: 900`. The shared canvas is a fixed
`z-index: 0` layer later in DOM order, so at that tier the tint paints over the very book
it exists to sit behind — the layering contract, again. Dropping it to `z-index: 0` puts
it under the canvas but *also* under most of ReaderView, whose stage, margin wrapper and
page cards all claim z-indices of their own: measured live, the tint showed while the
reader was loading and vanished the moment it wasn't. Worse than either option.

So the 3D presentation carries **no tint**: a real object over a live room. The
`contentReady` gate is what actually keeps the reveal honest; the tint was only ever
hiding a room that had not arrived. The 2D presentation keeps its tint, because there the
book is a DOM element at the same tier and the sandwich works.

### The timings

760ms of travel/open/recentre, then the `contentReady` hold, then 340ms of landing —
about 1.1s, up from 540ms. Permitted by decisions.md 2026-08-12 ruling 8 (the overlay is
`pointer-events: none`, so DESIGN.md's ~400ms bound, which governs *input blocking*, is
not in play). The phases **overlap** rather than run in sequence — the book turns while it
is still travelling and starts opening before it has quite arrived — which is what makes a
second-long move read as one gesture instead of four. The 2D presentation was slowed to
match: a lost context changes what the opening *is*, never how long the room takes.

### Verified live
Headless Chromium + SwiftShader, real fixture books, both entry points:
- **Desk:** book lifts off the surface, arcs to centre, opens flat, crease lands on the
  viewport's axis (measured at x = 640 of 1280), spread lands on the reading pane.
- **Shelf:** book pulls out of the row toward the camera, turns its cover to the viewer,
  then runs the same open and landing — one opening, two approaches.
- **Escape** at 450 / 800 / 1050ms: back on the Desk, zero overlays mounted, canvas
  visible and healthy. (At 150ms the click had not yet committed the route — not a
  cancellable phase, because the phase has not started.)
- **Reduced motion:** `0` canvases on the Desk, through the whole opening, and after it
  settles; the opening completes and unmounts.
- **`WEBGL_lose_context` mid-sequence:** falls to the 2D presentation in place and
  finishes it, overlay unmounted, route intact.
- **Context exhausted (4 losses, past `MAX_RECOVERY_ATTEMPTS`):** the whole opening runs
  as the 2D presentation — cover flies, swings flat about its hinge, the 2× spread
  recentres to the axis and lands on the pane.
- One WebGL canvas throughout; the second canvas on the Desk is `CursorTrail`'s 2D one.

### Not signed off here
The operator's own judgement on §E's two subjective criteria — "does the slower opening
read as deliberate rather than sluggish", and the final crossfade, where the 3D paper and
the reader's own `--color-bg` are the same colour by construction but the text still
arrives in one cut. Both are in §E's Verify box, unticked.

## M23 §E.1 — the opening, reworked after the operator's review — 2026-08-14

The operator watched the shipped opening and asked for five things: a slower travel, a
slower open, page text in the miniature book, a slower zoom onto the pane, and — the one
that turned out to be structural — *stay on the desk until the book has opened and zoomed
in*. Plus, from the shelf, a spine-out-and-turn you can actually follow.

### The one that was not a timing change

Four of the five are numbers. The fifth is not: the reader was not "loading too early",
it was **the only thing on screen for the entire sequence**. `App.tsx` renders one room
at a time, so the click unmounted the Desk on the first frame and everything after it — a
book climbing off a surface, turning, swinging open — played over the room the book had
not reached yet. Every frame of that was continuous, correct, and measured (§E's own
notes), and the whole thing still read as a jump, because the *subject* of a transition
was being shown against its *destination*.

**A transition played over its destination is not a transition.** That is the sentence
worth carrying to the next one of these.

### Why a held layer and not a second mounted room

The obvious fix — keep the Desk mounted behind the reader, the way Settings and the Scan
keep their background location — costs two live rooms: two of every fetch, every shortcut
registration, every drag handler, and **two `CameraRig`s fighting over `set({ camera })`**
on the one canvas. The cheap version is available because of how the seam is built: a
registered layer's components live inside the `<Canvas>` tree in `Scene3DProvider`, not
inside the room that registered them, so *keeping the registration alive* keeps the Desk
drawing after `DeskPage` is gone. `useScene3DHold` is that, and the held room is scenery:
no DOM, so nothing in it is hoverable, clickable or focusable — which is exactly right for
a room the user has already left.

Three things fell out of building it, each of which would have been a live bug:

1. **The drop has to be deferred by a microtask.** React runs the unmounting room's effect
   cleanups *before* the arriving overlay's effects, in the same commit — so the Desk
   unregisters, and only then does the opening ask to hold it. A synchronous drop deletes
   the layer in between. (Caught by the test, not by driving it, which is the right order
   for this one.) It also makes StrictMode's mount/cleanup/mount a no-op rather than a
   dropped room.
2. **A held room needs a book-shaped hole in it** — otherwise the book is drawn twice, once
   flying and once still lying where it was. Nothing above those components can re-render
   them any more (their props froze when their room went away), so the hole arrives through
   a store they subscribe to themselves (`departedBook.ts`). The opening declares it, not
   the click: set when the 3D layer starts drawing the book, cleared when it stops, so the
   object is never in neither place.
3. **The reader has to be invisible, not absent.** It mounts and loads on the first frame
   exactly as before — the landing's target rect and the spread's snapshot are both
   measured off the live pane — but its own chrome is ordinary DOM with z-indices of its
   own, and a reader rendering normally paints its title bar over the desk it is standing
   behind. `.roomHidden` is an **opacity**, never a `display`, for exactly that reason.
   Pleasant accident: an opacity below 1 makes the room one atomic paint that lands *under*
   the canvas, so the handover to "reader above the canvas" happens on the frame the fade
   completes, which is the frame the landing ends.

### The shelf's approach was a control point, not a phase

"The book comes out of the row and turns" was implemented as a Bézier control point in
front of the book. **A control point is not a duration** — the move that gives the shelf
its whole character got whatever fraction of the travel the curve happened to spend near
its start, about a tenth of a second, which is what the operator saw as "almost
instantaneous". It is now a phase with a clock (475ms), the turn is its own (575ms), and
the travel starts from wherever the pull has reached, which keeps the two continuous at
every t. Everything after the cover faces the camera is the Desk's sequence **unscaled**,
and that is now asserted in ms in `openingGeometry.test.ts` rather than left to two sets
of fractions looking similar.

### The printed spread

DESIGN.md said "blank paper planes, never real epub pages". Amended rather than dropped
(decisions.md this date): the rule was protecting against *animating* real page content,
which PAGE_CURL.md prices in detail. This is the opposite case — **one** rasterization, at
the one moment in the sequence when nothing is moving, of a pane that is already sitting
there laid out. `capturePageSnapshot` is the page curl's own capture, deadline and all, and
one texture is split down the middle by `offset`/`repeat` onto the two pages, so the two
halves cannot disagree about where the crease is. A failed or timed-out capture lands blank
paper exactly as before.

The left page needs `rotation={[0, π, 0]}`, and it is worth knowing why rather than
discovering it: the plane has to face the board's inner (−z) face, and turning it about y
does that *and* puts its +u back along world +x once the board itself has swung through π.
Two mirrorings that cancel. Without it the page is legible only in a mirror.

### The timings

| | before | after |
|---|---|---|
| Desk travel/open/recentre | 760ms | 1900ms |
| Shelf, same | 760ms | 2500ms (600ms of approach, then the Desk's 1900) |
| Landing | 340ms | 850ms |
| 2D fallback (fly + open) | 320 + 300 | 800 + 750 |

### Verified live
Headless Chromium + SwiftShader, real fixture books, 1440×900:
- **Desk:** at 600ms and 1500ms the *desk* is on screen — surface, neighbours, turntable —
  with the clicked book arcing across it and no second copy left behind. At ~2200ms the
  book is open at centre with **the real page printed across the spread, upright and
  unmirrored on both halves** ("Chapter 23" reads correctly on the left page). The spread
  then grows onto the pane and the room takes over; the settled state is the reader, no
  desk.
- **Shelf:** at 500ms the book has come forward out of the row; at 900ms it is turned
  square to the camera in clear air in front of its neighbours; then the same travel, the
  same open, the same printed spread, the same landing.
- **Escape at 700ms and at 1600ms:** back on a *complete* desk — every book present,
  including the one that had left — canvas healthy, route back at `/`.
- **Reduced motion:** zero canvases on the Desk, through the whole opening, and after it
  settles; the opening completes and the reader arrives.

### Not signed off here
The operator's own judgement on the pacing (1.9s / 2.5s / 0.85s), which is the whole point
of the exercise, and on whether the printed spread reads as charming or as a screenshot
glued to a book. Both are in §E's Verify box, unticked.

## M23 §E.3 — the zoom that was never drawn — 2026-08-16

The operator's fifth review of the opening: the zoom onto the reading pane "has
disappeared", and the page printed on the held-open book "already looks slightly
vertically stretched … reduce the vertical stretch a tad to preserve top margins".

### The zoom was running perfectly and nothing was drawing it

Worth writing down because every instinct was wrong. The DOM half of the landing was
provably fine — the motion value went 0 → 1 over its 850ms, on its curve, and the handoff
fired 760ms in exactly as designed. What never happened was a **frame**: `BookOpening3D`'s
`useFrame` logged zero calls for the whole landing, having logged them normally up to that
point.

The cause was in a different consumer of the shared canvas entirely. `FadingLayer` walks
every material under the layer it is fading (three.js has no group opacity), the desk layer
contains the turntable, and the turntable's record attaches **one** `MeshStandardMaterial`
object to two slots of one mesh. R3F's attach bookkeeping leaves the first slot `null` when
that happens — measured `[null, vinylFace, vinylEdge]` — and `base = { opacity:
material.opacity }` on the hole throws. Inside `useFrame`, that stops R3F's render loop for
the **entire canvas**.

So: the room stopped fading, the book stopped moving, and the reader arrived on schedule
over a frozen photograph of a desk with a small book on it. Nothing in the screenshots said
"exception" — it looked exactly like a missing animation, which is why the previous pass
went hunting in the timings.

**The rule this leaves:** on one shared canvas, a fault in any consumer is an outage in
*all* of them, and it presents as "the animation is gone". Check the console before the
easing curves. The traversal now skips empty slots, and the turntable's rim and underside
get an instance each — which also fixed a thing nobody had reported, the record's rim
having been drawn in three.js's default white since §C.

### The snapshot was never the pane

`capturePageSnapshot` depicts the **scroller** — epub.js's paginated window — and that sits
inside `.marginWrapper`'s padding. The opening was stretching it across the whole spread,
so the printed page had no head margin at all where the pane has ~6% of its height. That is
the operator's "preserve margins (particularly at the top)", and it was a real defect
rather than a taste note. `snapshotInset` reports the band; `Book3D` insets the printed leaf
by it and lets the book's own paper be the margin. The *board* still lands on the pane's
rect, so the landing is untouched and the crossfade now agrees about the margins too.

### The stretch is geometry, and could not be fixed in the texture

A spread is about 1.33 wide; the reading pane measured 1.94. Printing one on the other
stretches type vertically by half again, and no UV trick fixes it — cropping to the right
aspect means cutting the sides off each page, which breaks the property the final crossfade
rests on (the spread and the pane are the same picture). So the open book flattens *toward*
the pane's proportions: `flattenTowardPane`, half the mismatch, floored at 0.82, ramped over
the 260ms settle beat that already existed and previously did nothing. It is applied
**before** the landing's lerp, so it changes where the zoom starts and never where it ends —
asserted, not assumed.

### The room's window

`ROOM_FADE_MS` ran the landing's whole 850ms. Now `10% → 60%` of it, per the operator's own
numbers, both as fractions of `LANDING_MS`. The spread gets its first tenth of growth
against the room it is leaving, and the last 40% happens over the reader's paper alone.

### Verified live
Headless Chromium + SwiftShader, real fixture books, 1440×900, and **with `pageerror`
captured** — which is the change to how this gets verified, given the above:
- **Desk:** the held-open book now shows paper margins around the printed page and sits
  slightly flatter; the spread then grows onto the pane while the desk washes out and is
  gone by the time it is two thirds of the way there; settled state is the reader.
- **Shelf:** same, off the shelf's own approach.
- Zero page errors across both runs (there were eight per landing before).

### Not signed off here
The operator's own judgement on how much flattening is "a tad" (`SPREAD_FLATTEN` /
`SPREAD_FLATTEN_FLOOR` are one constant each), and on the new margin.

## M24 §B — search timing, brute-force over the Jekyll fixture

TASKS.md B's "no FTS5 in this milestone" bullet asks for the brute-force scan to be
measured rather than assumed fast. Method: a throwaway script (not committed, same
pattern as M17.5's `web/measure.mjs`) that imports `fixtures/jekyll-and-hyde.epub` into
an in-memory db via `importEpub`, then calls `searchResource` 20 times per query and
averages `performance.now()` deltas, against a real `tsc -b` build (not `tsx`, to avoid
counting transpilation).

| Query | Hits | Avg time |
|---|---|---|
| `"the"` (worst case: matches almost every sentence) | 2311 | 1.33ms |
| `"Hyde"` | 105 | 0.73ms |
| `"laboratory"` | 10 | 0.66ms |
| a phrase that matches nothing | 0 | 0.52ms |

All two orders of magnitude under the ~50ms budget, on one of the two fixture books.
`buildSectionOffsetIndex` (built once per search, TASKS.md B's other bullet) and a
single case-insensitive `indexOf` sweep per section are enough; FTS5 stays parked for
M28, where cross-book scanning actually needs it.

## M24.1 A/B — mix-blend-mode was never applying, and B rode along on the fix

Both bugs turned out smaller than TASKS.md's own two leading theories, once reproduced.

### A: not ancestor isolation — `setAttribute` silently drops `mix-blend-mode`

Checked the warned-about cause first: walked every ancestor from the mark's `<rect>` up to
`<body>` live (`getComputedStyle`, `opacity`/`filter`/`isolation`/`transform`/`will-change`)
on the operator's own "Crow shakes his head…" annotation. All at initial values — no
isolating ancestor, anywhere.

Minimal repro settled it instead: a bare `<svg><rect>`,
`el.setAttribute("mix-blend-mode", "multiply")`. The attribute lands in the DOM
(`getAttributeNames()` shows it), but `getComputedStyle(el).mixBlendMode` reads `"normal"`.
`fill`/`fill-opacity` on the same element apply correctly the same way. The difference:
`fill` and `fill-opacity` are real SVG presentation attributes; `mix-blend-mode` is a
CSS-Compositing-only property with no presentation-attribute form, so a plain
`setAttribute` for it is inert — the browser just stores an unrecognised attribute.

epub.js's `view.highlight()`/`view.underline()` (`node_modules/epubjs/src/managers/views/
iframe.js`) build an `attributes` object (`fill`, `fill-opacity`, `mix-blend-mode`, from
whatever `styles` the caller passes) and hand it to marks-pane's `new Highlight(range,
className, data, attributes)`. `Highlight.bind()` (`marks-pane/src/marks.js`) applies every
key with a bare `element.setAttribute(attr, this.attributes[attr])` — no exceptions, no
`style`-vs-attribute branching. So `mix-blend-mode` has been dead on arrival since the wash
design landed (M19.6): every mark this app has ever drawn — base highlight wash, hover
boost, audio tint, search hits — has been flat alpha-composited paint the whole time, never
actually blended. The 0.22/0.34 base wash reads "fine" at a glance because a little flat
colour over dark text still looks like tinting; the failure only becomes visible where the
opacity climbs high enough to read as solid paint (hover 0.95, current search hit 1.0) —
which is exactly the two cases the operator photographed.

**Fix:** move `mix-blend-mode` into a `style` key (`highlightKinds.ts`, one line added per
function) — the one channel `setAttribute` *does* parse as real CSS, since setting the
`style` *attribute* is specified to parse its value as a CSS declaration block.
`fill`/`fill-opacity` deliberately stay as separate attribute keys rather than folding
everything into one `style` string: `clearMarkHover` (`ReaderView.tsx`) restores the base
wash by doing `el.style.fillOpacity = ""`, which only works because the base fill-opacity
lives on the *attribute* — clearing the inline override lets the attribute show through
again. Folding fill-opacity into the same style block it's clearing would zero it out
instead of restoring it.

Did not take the CSS Custom Highlight API route the task also describes as "the real fix."
It's real, and still worth doing for the reasons TASKS.md gives (kills B's slab bug too,
retires the re-measure hack) — but the acceptance criterion is fully met without it, so
forcing that migration onto this bug specifically would have been scope creep, not fidelity
to the task.

### B rode along, once the shared-instance precondition was checked rather than assumed

TASKS.md flagged the precondition rather than asserting it ("verify pnpm resolves web's
copy to the same instance"), so checked it: added `marks-pane` (`^1.0.9`, matching
epubjs's own declared range) as an explicit `web` dependency, `pnpm install`, then
`readlink -f web/node_modules/marks-pane` — resolves to the exact same
`.pnpm/marks-pane@1.0.9/node_modules/marks-pane` directory epubjs's own nested copy points
at. One file on disk, so a prototype patch on our own import reaches the `Highlight`
instances epub.js creates internally too.

`marksPanePatch.ts` (side-effect import from `ReaderView.tsx`, before any mark is drawn)
replaces `Highlight.prototype.filteredRanges` with a version built from per-text-node
subranges of `this.range`, rather than `this.range.getClientRects()` directly. A `Range`
confined to one text node can never fully contain an *element*, so the slab case — a whole
`<p>`'s border box riding along in the client-rects list — is structurally impossible,
rather than something to filter back out after the fact (which is what the library's own
`filteredRanges` tried and got backwards: its `contains()` dedup keeps whichever rect comes
first in iteration order, which empirically is the slab, not the tight lines).

Added `marks-pane.d.ts` (an ambient module declaration) since the package ships no types
of its own — narrowed to exactly the one class and one method this app touches.

### Verified live
Playwright, headless Chromium, against the operator's own running dev server (already up:
`:5173`/`:5175`) and real library — read-only throughout, no data mutated. Book: Kafka on
the Shore, the same one the operator's report came from. Annotation: `ab990bcb…` ("Crow
shakes his head…"), the multi-paragraph highlight already in the real data — no synthetic
fixture needed.

- **A, paper theme:** current search hit (fill-opacity 1, the worst case) —
  `getComputedStyle` confirmed `mix-blend-mode: multiply` actually applied (was `normal`
  before the fix, same repro); pixel-sampled glyph-vs-wash contrast **15.35:1**. Hovered
  annotation at 0.95 — legible by eye in the screenshot, same blend confirmation.
- **A, ink theme:** clicking "Ink theme" and reading `getComputedStyle` confirmed
  `colorScheme: "dark"`, `document.documentElement`'s and the epub iframe's own `body`
  background both genuinely dark, and `mix-blend-mode: screen` (not `multiply`) correctly
  selected and applied for both the hover and current-hit cases — the CSS engine's actual
  computed values, not inferred from source.
  ⚠️ **Not fully closed:** in this harness, the **screenshot** kept showing paper colours
  after the same click that made every computed style above measure as dark — tried a
  resize nudge and longer waits, no change. Could be nothing but a headless-screenshot
  compositing quirk specific to this test harness; could be a real stale-paint bug in the
  family decision 14 already named ("idle layer keeps its last frame"). Not reproduced or
  ruled out against the operator's own screen — flagging rather than chasing, since it's
  outside what A/B asked for.
- **B:** before the patch, the same annotation's marks-pane group had 20 rects, several up
  to 70.4px tall (multi-line slabs survived the library's own dedup). After: 33 rects,
  **every one exactly 16px** — one line box per fragment, zero slabs.
- `tsc -b` (web) and the full `web` vitest suite both clean (344/345; the one failure,
  `search/hitLocation.test.ts`, belongs to unrelated in-progress work on this same
  milestone's §C, happening concurrently in this tree — not touched by this fix).

### Not signed off here
The ink-theme screenshot discrepancy above. Contrast in the third ("system") reading
theme — it resolves to one of the two `colorScheme` branches already covered, not
separately exercised. The Custom Highlight API migration TASKS.md describes as the real
fix for A, deliberately not attempted this pass.

## M24.1 C/D — a hit knows which occurrence it is, and results get a card — 2026-08-18

Ran alongside A/B (painting layer) in the same tree; nothing here touches
`highlightKinds.ts`, marks-pane, or the mark *styling* path. No browser in this session,
so everything below was established by reading code and by unit tests — the live
acceptance lines in TASKS.md are unchanged and still owed.

### C — why "anchor by offset" turned into "anchor by occurrence"

TASKS.md's instruction was "anchor by offset with content as tiebreak (or by occurrence
index)". The offset half is unusable as written: `hit.offset` indexes `resource_text`,
the reader paints into `body.textContent` of the *live* rendered section, and the two do
not share a coordinate system — there is no scale factor to convert between them, and no
way to learn one client-side (the section's server-side length isn't in the payload).

Occurrence index is exact, though, and needs nothing new on the wire: the server emits
one hit per occurrence in document order under a known matching rule, so the reader scans
the live text under **the same rule** and pairs k-th with k-th. Identity comes from
position in the sequence — the one property that can't be ambiguous when every occurrence
has identical content, which is exactly why content-based re-location (`findAnchorInText`,
whose last resort is `indexOf(exact)` = the *first* occurrence) collapsed a section's
hits onto one mark.

Counts can still disagree when the live DOM holds text `resource_text` never had. The
fallback walks both sequences forward and scores each candidate by how much of the hit's
recorded prefix/suffix it agrees with (`MIN_CONTEXT_SCORE = 10` characters out of 48).
Deliberately a **score**, not an equality test: the texts differ — that is why the counts
disagreed — so demanding exact agreement would drop legitimate hits near whatever the
live DOM added. A hit that scores nothing is left **unpainted**. Under-painting is the
right failure: over-painting is the other half of the bug report.

`findAnchorInText` is untouched, and still locates every annotation hit. That split is
the whole fix in one line: *a highlight is identified by its content; a search hit is
identified by its position.*

### The mark with no hit was epub.js's annotation store, not a stale rect

Not reproduced live, but the mechanism is in the library's source and is systematic:

```js
// epubjs/lib/annotations.js:43
add(type, cfiRange, ...) { let hash = encodeURI(cfiRange + type); ... this._annotations[hash] = annotation; }
```

Both a highlight mark and a search mark are type `"highlight"`, so at an identical CFI
they share one hash. The second `add` overwrites the store entry and attaches a second
rect to the pane; the evicted annotation's rect stays there forever, because the hash a
later `remove()` would look up now belongs to the other mark. `attachOwnedMark` already
defended highlights against *each other* for exactly this reason ("a second mark at an
identical position would just orphan") — the search path simply wasn't covered.

And the collision isn't a coincidence: an annotation hit (a note or thread message
matching the query) anchors to its highlight, so its CFI **is** that highlight's CFI,
every single time. That matches the report — 'female' painting a mark on
"ed back, her face v", text that doesn't contain the query, because it was a *highlight's*
orphaned rect. The rule now: **the highlight owns the CFI**, enforced in both directions
(`paintSearchMarksForSection` skips a CFI in `cfiOwnersRef`; `attachOwnedMark` reclaims
one from a search mark). Nothing is lost visually — a highlighted passage is already
marked.

The other candidate (a stale marks-pane rect) was checked and left alone:
`refreshHighlightOverlays` re-renders the panes on every real trigger, and marks-pane
re-measures from the mark's own live `Range`, so search marks are repaired by the same
call that repairs highlights.

### spineIndex ↔ sectionIndex, confirmed rather than assumed

TASKS.md asked. Both count every `<itemref>` in OPF spine order:
`server/src/library/epub.ts:48-55` (`opf.spineIdRefs.forEach((idref, index)`) and
`epubjs/lib/packaging.js:154-172` (`"index": index` over `qsa(spineXml, "itemref")`).
A malformed itemref that the server skips still consumes its index, so the two cannot
drift. `hitsForSection`'s join is sound.

### The matching rule lives in one module, and travels with the query

`shared/src/textSearch.ts`. The server produces hits with it, the reader re-finds them
with it, and the find bar's count is the number both agree on — a second copy would
become a second result set. Whole-word is the default (decisions.md 2026-08-18); the
boundary is only demanded on a side where the query's *own* edge is a word character, so
`'the'`, `—` and `§4` remain searchable. `mode` rides in the query string and in the
reader↔Scan handoff state rather than being a server preference, for the same
"one result set" reason.

### D — the card, and why it is in the reader

TASKS.md said "the Scan's results get a card" but also "page and percent … reuse the
reader footer's own reading of it". Those two pull opposite ways: the Scan never loads
epub.js, so it has no pagination and cannot show an honest page number. Put to the
operator, who chose the reader (2026-08-18).

The card holds no state of its own — not the hits, not the query, not the cursor. It
renders rows ReaderView builds and calls back with an *index into the result set*. That
is what makes "a row click lands on exactly the hit that stepping to that index does"
structural: both paths are `goToFindHitIndex`.

Page numbers: `pageNumberMode` and the page map are the footer's own
(`bookPages.ts`), and a hit's page *within* its section comes from the fraction of the
section preceding it — derived from the hit's whole-book `percent` against the Scan's
section weights, the same weights `bookPages.ts` already estimates from. No second
position model, and no page shown at all until the map has calibrated (the same silence
the footer keeps).

The rows memo depends on `bookPage` for a non-obvious reason: the page map is a ref
written during relocate, so a memo can't observe it calibrating — `bookPage` moves on the
same relocate, which makes it the signal that the map did.

### What is not signed off here

Nothing was run in the app. Specifically owed, all of them live checks: five distinct
marks for a five-occurrence word and five distinct stepped positions; "type a query, page
around, resize, retype it" leaving no residual marks; 300+ hits scrolling smoothly in the
card (the list is DOM rows with `content-visibility: auto`, chosen so `scrollIntoView`
keeps working for the stepped cursor — not measured); and the card judged in paper and
ink.

## Blockers

- **M27 — the two measurements still owed cannot be taken on this machine, and
  taking them wrong is worse than not taking them — 2026-08-25.** Both remaining
  items in M27's "two measurements still owed" need the app driven *by hand on
  the operator's Mac*, and neither is a matter of effort here.

  **The canvas-2D-on-a-real-compositor number.** The step 4 gate closed the
  performance column for WebGL and explicitly could *not* close it for canvas 2D
  because headless Chromium composites in software — which is exactly the only
  browser available in this session. Driving a synthetic drag through CDP in
  headless Chrome would produce a number, and it would be the same
  software-rasterizer number the gate already rejected. TASKS.md is specific
  about the method for good reason: **drag** six pages, not arrow keys, because
  the guard under-reports a keyboard turn by 7x, single-page and spread, then
  paste the `[marginalia] fold draw cost:` lines in here. Note those lines now
  read `p90` rather than `median` — the M27 guard change above — so a trace
  taken before today is not comparable to one taken after.

  This also blocks M27's own p90 acceptance criterion, which asks for the dev
  trace on a held drag and a keyboard turn of the same fold to land within ~2x.
  The statistic is unit-tested against the step 4 traces (`drawCost.test.ts`)
  and passes; what is unverified is the *live* pair on real hardware.

  **The original stuck-curl trigger.** Wants one captured trace of a gesture
  getting stuck. The operator reports it "doesn't really get stuck" since the
  structural fixes, and it was not reproduced in ~4 held drags and ~30 keyboard
  turns on 2026-08-03. This is a loose end that needs a real reader hitting a
  rare timing on a real machine; it cannot be manufactured to order here, and
  synthesising a stuck gesture would prove nothing about the trigger.


- **TASKS.md M24 §A/Verify cites a NOTES.md "M24 A/C" section (Playwright method,
  screenshots, the Gregor/298-hits run) that does not exist in this file.** Found while
  splitting the M24/M24.1 backlog into commits, 2026-08-18. The checkmarks and verification
  prose in TASKS.md for M24 §A/§C are intact and consistent with the shipped code, so the
  underlying verification likely happened — only its NOTES.md writeup is missing. Re-run or
  recover the write-up before treating that verification as fully documented.

## M24.5 §1-3 — distillation, the colour ramp, and library-wide matching — 2026-08-18

### Why the distillation pass reads analyses, not just theme strings

TASKS.md's own instruction ("distil from the chapter themes and analyses already stored")
could have been read as "the theme strings are enough, analysis is optional context." Went
with including the full analysis paragraph per chapter anyway: theme *names* alone lose the
nuance that would let a model tell "loneliness" and "alienation" apart when deciding whether
they belong under the same book-level parent or two different ones — the analysis paragraph
is where that distinction actually lives. Still cheap: a handful of chapter analyses is a
small fraction of the digest tokens that produced them, nowhere near book-text scale.

### "Code disposes" has two jobs here, not one

`themeTagging.ts`'s existing pattern (filter the model's proposed themes down to the real
vocabulary) only prevents *hallucination*. Distillation also has to prevent *omission* — the
acceptance line ("every chapter theme is assigned a parent") is a coverage guarantee, and an
LLM asked to group N things under 6-8 buckets will sometimes just drop one. Fixed in code,
not by re-prompting: any chapter theme not present in *any* returned `children` list (after
the hallucination filter) gets assigned to whichever book-level name it's Levenshtein-nearest
to. Deterministic, and it means the acceptance line holds even against a sparse or lazy model
reply — tested directly (`themeDistillation.test.ts`, "assigns a chapter theme the model
dropped…").

### Colour is a property of the canonical row, not of a render

The task text's two colour requirements read like they pull in opposite directions: "derived
from its position in the book's own distilled set" (implies recomputed per book) vs. "a match
adopts the existing canonical theme (and its colour)" (implies colour travels with the
canonical identity). Resolved by making position-based assignment a **creation-time** event
only: `resolveCanonicalThemes` computes `index % THEME_RAMP_SIZE` exactly once, when a name
has no match and a new `canonical_themes` row is born. Every subsequent mention — in the same
book on a rebuild, or in a different book entirely — resolves through `matchConcept` and
inherits the stored value. Position never re-enters the calculation after that first moment.
This is what makes "rebuilding a digest does not reshuffle the colours" true by construction:
there's nothing to reshuffle, because nothing is recomputed.

### The hue-separation problem was solved directly rather than eyeballed

The four kind hues (rose/sage/honey/slate) aren't evenly spaced around the wheel (gaps of
39°/61°/111°/149°), so naively adding 8 more hues at even 45° intervals only reaches ~10° of
separation from the nearest kind hue at its worst point — too close to trust without seeing it
rendered. Solved as a real max-min spacing problem instead: distributed 8 new points across
the 4 existing gaps proportional to each gap's size (a small script, not hand-picked hex
values), reaching ~28° minimum separation across all 12 hues. Full method is in theme.css's
own comment next to `--theme-ramp-0..7`. Not a substitute for a live look at the rendered
legend — flagged as unverified in TASKS.md — but a considered starting point rather than a
guess.

### What's genuinely unverified

No LLM provider was configured this session and no browser was available, so: the pass has
never run against either real fixture book (Metamorphosis, Kafka on the Shore); "6-8 themes,
judged actually good" (the Verify item) is untouched; the ramp has never been seen rendered,
so confusability with the kind hues is reasoned-about, not observed; and the ledger's
token-cost recording, while wired through the same `withUsageLedger` path every other
operation uses, has no real number attached to it yet.

## M24.5 §4 — the Scan's colour key needed its own phosphor ramp — 2026-08-18

Found while wiring the legend into `ScanPage.tsx`, not anticipated when `--theme-ramp-*`
was designed in §1-3: `ScanPage.module.css`'s `.page` class overrides `--color-bg` to
`#05070a` and friends, a near-black scope independent of the paper/ink app theme (its own
comment: "dark-native... overrides the same global custom properties, scoped to this
page"). The paper-toned `--theme-ramp-*` hex values are the wrong tool there for the same
reason the four kind hues already get `scanPalette.ts`'s separately-saturated
`phosphorHue()` instead of `--kind-*` directly.

Rather than reuse the same 8 hues at higher saturation, solved the max-min separation
problem fresh against the *phosphor* kind hues (351°/150°/42°/200°, measured from the
existing `PHOSPHOR_RGB` values — not the same as the muted kind hues' 0°/100°/39°/211°).
Landed on ~25° minimum separation across all 12. `colorIndex` now has two renderings of one
identity: `--theme-ramp-{i}` for paper-register surfaces (the digest page's legend),
`THEME_PHOSPHOR_RGB[i]` for the Scan — same pattern kind colours already established, just
not one this session initially planned to need until the wiring surfaced it.

### The filter's shape: one selection, one expansion function

`ScanPage.tsx` used to hold a single `filterTheme: string | null`, matched by exact
equality in two places (the Mine layer's `litIds`, the Book layer's `litTheme` prop into
`HeatStrip`). Distillation adds a second *kind* of selection (a whole book-level theme)
that must expand to a set rather than match one string, and the two selections are mutually
exclusive from the reader's point of view — you're filtering by one thing at a time, book-
level or specific. Modeled as a tagged union (`ThemeSelection`) rather than two separate
nullable fields, specifically to make "both set at once" unrepresentable instead of a state
to remember to guard against. `activeThemeNames()` is the one function that turns a
selection into the array both `litIds` and `HeatStrip`'s (renamed) `litThemes` prop filter
against — neither call site has to know which kind of selection produced the array.

## M24.7 §E/§F — search means find, and the model moves where the question is asked — 2026-08-20

Built against READER_REDESIGN.md's text directly, not the `.dc.html` design frames TASKS.md
says to pull first — the previous session's §A/§B/§C/§D commits already set that precedent
(no design-project pull recorded in either commit or in this file) and reading the diffs
confirmed the strip was built the same way, so this session matched it rather than blocking
on a pull. Worth a look before §G: if the frames really do carry numbers the prose doesn't,
pulling them once would settle it either way.

### §E was mostly already done

`MagnifierIcon`/`ScanIcon` were already split and correctly wired in the reader's nav pebble
by §A's ChromeSlotPortal work — grounding note 6 in TASKS.md even flagged this ("Borrowed one
step ahead of §E's full magnifier split"). The one real leftover: `ReaderActionsCluster.tsx`
(the M14-fullscreen fallback cluster, still mounted for `fullscreenMode` pending §G's rework)
still drew its Scan button with `MagnifierIcon` — the exact glyph collision §E's acceptance
forbids. Fixed by importing `ScanIcon` there too.

### Two bugs found live, both would have shipped invisible in a code-only review

1. **Framer Motion silently drops a CSS `transform` on an element it's also animating.**
   FindBar's new pebble centred itself with `left: 50%; transform: translateX(-50%)` on the
   same `motion.div` that animates `y` on enter/exit — Motion writes the whole `transform`
   property as an inline style for whatever it animates, which overwrites (not merges with)
   a class-authored `transform` on the same element. Measured live: the pebble's *left edge*
   landed at the stage's centre, not its own centre, off by exactly half its width. Fixed by
   splitting the concerns onto two elements — a plain (non-animated) `.pebbleAnchor` that
   centres via flexbox, and the `motion.div` inside it free to animate `y` without touching
   `transform`'s other axis. Generalizes: any floating `motion.div` that both animates a
   transform-based property *and* wants CSS-authored positioning via `transform` needs this
   split, not just this pebble.

2. **The composer's wide/narrow breakpoint was picked from READER_REDESIGN.md's "~300px"
   figure, and the real content doesn't fit until ~450px.** The doc's own tilde says it's
   illustrative ("the realistic docked width"), not a measured engineering constraint, and
   it wasn't verified against the actual rendered control widths before being wired into a
   `@container` query. Driven live with Playwright (dragging ThreadPanel's own resize handle
   through the full width range, per M22.5's rule that breakpoints are the *pane's* width,
   never the viewport's) found a ~150px dead zone — container width 300–450px — where the
   wide markup (segmented ladder, labelled web pill, full-name model dropdown, Send) no
   longer fit but the narrow swap hadn't triggered yet, wrapping two children onto a ragged
   second line. Moved the switch to 480px (measured true fit ≈450px, plus margin) in both
   `ContextLadderToggle.module.css` and `ProviderPicker.module.css` — they share the
   `composer-controls` container name and have to move together or the settings-link-hide
   and the ladder/globe swap create a second, smaller dead zone between themselves. The
   `≤280px` "model wraps above the row" breakpoint (READER_REDESIGN.md §4) checked out fine
   against the *narrow* markup's own width and needed no change — it was the wide→narrow
   switch point specifically that was wrong, not the narrow layout's own numbers.

Also found, **not fixed, out of scope**: dragging ThreadPanel's own resize handle at all
(pre-existing, reproduces identically on `main` before this session's changes — confirmed by
stashing and re-running the same Playwright script) fires a React warning, "Cannot update a
component (`ReaderView`) while rendering a different component (`ThreadPanel`)", inside
Framer Motion's `AnimatePresence`/`PopChildMeasure` machinery. Doesn't crash, doesn't lose
the resize, but worth a session of its own rather than a drive-by fix bundled into this one.

### Verification method, since no `.dc.html` and no design canvas were pulled

Driven live against the two real fixture books already in this machine's library ("Kafka on
the Shore", 25 highlights/2 threads) via a Playwright script against the dev server already
running (not started fresh — inspected `ss -ltnp` first per the data-dir caution, found
`concurrently`'s server+web already up, used it as-is). The `Read` tool was down for this
entire session (`PreToolUse hook did not respond`) — screenshots were taken but never
actually viewed; verification instead read the live DOM directly (bounding rects, computed
styles, text content) via `page.evaluate`, which is how both bugs above were actually caught
— the pebble's true center offset and the composer's line-wrap threshold are exactly the
kind of thing a screenshot would have shown at a glance and a DOM query has to reconstruct
by hand. Worth naming as a gap: this pass leaned on structural assertions where a human (or
a working screenshot tool) would have just looked.

## M24.7 §G — the immersive page, a rework of M14 fullscreen — 2026-08-21

Replaced `useFullscreenChrome`'s four reveal flags (`revealTop`/`revealBottom`/`revealRail`/
`revealActions`, each proximity-band-driven) with one `pebbleAwake` boolean driven by an
idle-sleep timer (`IMMERSIVE_SLEEP_MS = 2000`): any pointer movement wakes it and reschedules
sleep; the pointer resting directly over the pebble (`onPebblePointerEnter`/`Leave`)
suppresses the sleep timer entirely rather than just resetting it. Both of the "two pointer
paths" M14 lost a session to (NOTES.md "M14") were updated together — `useFullscreenChrome`'s
own window-level listener and `ReaderView`'s iframe-forwarded `handleContentMouseMove` block —
both now just call the one `wakePebble()`.

**"No card, no strips, no rail" turned into unmounting, not floating.** M14's four panels all
stayed mounted and merely toggled opacity/pointer-events. §G's brief is stronger — nothing
from the old chrome should paint at all — so `.topRow` and the old `.footer` are now
conditionally rendered (`{!fullscreenMode && …}`), not conditionally floated. This meant
extracting the digest cluster, listening cluster, and the page/percent readout
(`progressGroup`) into local JSX consts computed once per render, since they needed to mount
in two mutually-exclusive places (the normal strip/foot, or the new pebble) without becoming
two hand-copied blocks that could drift. Exactly one mount point is ever live at a time
(`fullscreenMode` is a single boolean), so `digestButtonRef` simply reattaches to whichever
instance is currently rendered — no ref-sharing hazard.

**The old `ReaderActionsCluster` fullscreen mount is gone, not merely replaced.** It carried
Digest, Scan, and Publish; the pebble's spec list is exactly "page, %, digest, listening,
exit" — Scan and Publish are deliberately unreachable while immersive (the reader exits
fullscreen to reach them). `scanButtonRef` degrades the way it already did for any unmounted
button (`ReaderPage`'s `q` handler no-ops on a null ref) — acceptable since Scan was never in
the pebble's spec, not a new gap. `ReaderActionsCluster` the component still exists and is
still used by `BookActionCard` (the Desk hover card) — only its one fullscreen call site in
`ReaderView.tsx` was removed.

**New, additive-only:** `KeyCapAnchor` gained an optional `modifier` prop (prefixes the
rendered keycap, e.g. `⇧F`) so the pebble's exit control could advertise the binding
truthfully — `SHORTCUT_KEYS.fullscreen` is `"f"`, registered `shift: true`, and no keycap hint
for it existed anywhere in code before this (checked: the "F to leave" hint TASKS.md warns
about is a detail of the `.dc.html` design mockup only, never synced to this repo — there was
nothing stale to fix, just a truthful hint to add).

**The two open questions** (READER_REDESIGN.md §6) were put to the operator rather than
decided in code, per the task's own instruction not to coin-flip them — see decisions.md
2026-08-21. Text selection inline-over-column turned out to already be free: `ThreadPanel`
was already a floating, position-tracked panel (not a docked side panel) from before §G
existed, so "inline" required no new component.

### Verified live

`pnpm dev` (server already clean — checked `ss -ltnp` first, nothing was listening), driven
by an ad hoc Playwright install already present at `.ds-sync/node_modules` (chromium binary
already cached), against the real "Kafka on the Shore" fixture, light and dark
(`colorScheme: 'dark'`) both rendered and screenshotted. Confirmed via DOM query
(`getComputedStyle` + `[class*='immersivePebble']`) and screenshots together, not one or the
other:
- Entering fullscreen removes `.topRow`/`.footer` from the DOM entirely (not just visually) —
  confirmed by their absence in `document.querySelector`, not just opacity.
- The pebble contains exactly four controls (`Reading progress`, `Digest`, `Listen`,
  `Exit fullscreen`) plus the page/percent text; clicking Digest opens its `ExpandingCluster`
  panel unchanged from §D.
- The hairline fill's `width` tracks `progressPercent` (`28px` on a ~2%-through book at the
  hairline's rendered track width — proportionally correct).
- The margin rail's dots stay live buttons (real `title`/`aria-label`/`onClick`) at
  `opacity: 0.35` rather than disappearing behind a reveal-gated wrapper.
- Idle sleep: pebble opacity `1` immediately after a mouse move, `0` (and
  `pointer-events: none`) ~2.6s after the last one.
- Hovering the pebble itself: opacity stays `1` through the same 2.6s window that would
  otherwise have put it to sleep.
- Keyboard: repeated `Tab` reaches the pebble's own controls (after first passing through the
  margin rail's own dot/delete buttons, which are legitimately still in tab order — not a
  regression, they were always real buttons) and `:focus-within` reveals it — confirmed
  `element.matches(':focus-within')` was `true` and, after letting the
  `--duration-standard` opacity transition actually settle (the first check without a wait
  read a mid-transition `0` and looked like a bug before a 300ms wait cleared it up),
  computed opacity `1`.
- `Escape` exits fullscreen (routes through the existing `handleEscapeShortcut`, untouched).
- Exiting via the pebble's own button restores `.topRow`/`.footer` to the DOM.

**Not yet verified**: the milestone's full `#### Verify` checklist (TASKS.md) covers all of
§A–G together — clusters opened by long-press specifically, Cmd+F over a spread, the results
window moved and reopened, a question asked with the model chosen in the editor, and the page
fold peeling from every corner with the new chrome mounted. This session only drove §G; those
boxes are left unchecked rather than checked on the strength of §D/E/F's own prior sessions.

## M26 lead-in — an in-app "Sign in" for Codex/Claude, so the blocker doesn't need a terminal — 2026-08-25

Picked up M26 ("Codex CLI as a fourth provider"). Its own gate — confirm `codex login`
first, "or this task will be 'started' twice" — was still unmet, in a new shape from the
2026-07-30 attempt: `~/.codex/auth.json` now existed but had gone stale (a live
`codex exec --json` call returned five `401 Unauthorized` reconnects then `turn.failed`;
`codex login status` said "Not logged in"). Logged the diagnosis in Blockers and stopped
short of writing `server/src/llm/codexCli.ts` — TASKS.md's own warning is not to guess a
success-path JSONL shape, and everything seen so far was the *failure* shape.

Asked the operator how to proceed; they asked for something more durable than "go run a
CLI command and come back" — an in-app sign-in, "runs the same cli stuff ideally," with
anything stored kept as securely out of the repo as a `.env`. Full reasoning in
decisions.md 2026-08-25. Built and verified live:

- **`server/src/llm/authFlows.ts`** — spawns the real login command
  (`codex login --device-auth`, `claude auth login`), strips ANSI, parses a verification
  URL and code where the output has one (kept the raw lines as an always-available
  fallback for whichever shape doesn't), and polls the child's exit for success/error.
  Also a read-only `checkAuthStatus` (`codex login status` / `claude auth status`, the
  latter genuinely `--json`-shaped and safe to have actually run — see below) and a
  `logout`. One flow per provider at a time; a 17-minute timeout past Codex's own
  15-minute code expiry; finished flows self-sweep after 5 minutes.
- **`server/src/routes/providerAuth.ts`** + shared schemas (`ProviderAuthStatus`,
  `ProviderAuthFlowState`) — status/login/poll/cancel/logout, mounted at
  `/api/provider-auth`.
- **`web/src/settings/ProviderAuth.tsx`** — an "Accounts" card above the two role
  pickers in Settings → LLM (signing in is machine-level, not tied to one profile):
  status line per provider, Sign in/Sign out, and — while a flow is live — the URL as a
  real link, the code in a monospace chip, and a Cancel button, polling every 1.5s.

**Verified live, not just built.** `curl`'d the raw API first (`POST .../codex/login` →
real device code `B6DD-30SQ4` and the real `https://auth.openai.com/codex/device` URL,
parsed correctly; `DELETE .../login/:id` killed the child cleanly — `ps aux` showed
nothing left running). Then drove the actual dev server in a real browser (Playwright,
same ad hoc Chromium install prior sessions used) against `/settings`: the Accounts card
renders both providers' real status (Codex "Not signed in", Claude "Connected —
wijayw@gmail.com (pro)" — this machine's own live Claude Code login, read via
`claude auth status`, confirmed safe to call because it's read-only), clicking "Sign in"
on Codex produced a fresh real device code rendered in the panel exactly as the raw
`curl` test predicted, and Cancel returned to "Not signed in" with the child reaped.

**Deliberately not run: `claude auth login`.** This machine's Claude Code login is live
and this very session depends on *some* `claude` CLI credential store — running an
unverified login flow against it for a code path Claude doesn't currently need (it
already works here) wasn't a risk worth taking just to test symmetry. The server-side
plumbing is identical for both providers; only Claude's real stdout shape is unverified.

**Still open, and still the actual next step for M26**: the operator signing in through
this UI, then — per the standing rule — one real `codex exec --json` call against a
signed-in account, its success-path event shape written here, and only then
`server/src/llm/codexCli.ts`. Nothing about this session's work substitutes for that.

**Follow-up, same session: asked where the sign-in data (and thread answers generally)
are stored, and how that's kept secure given this repo is on GitHub.** Answered from
what's actually verified — thread content lives in the gitignored
`data/marginalia.sqlite`, confirmed via `git log --all` that path has never once been
committed; the sign-in tokens from today's feature never touch this repo's code at all,
landing in `~/.codex/auth.json` / `~/.claude/.credentials.json` entirely outside it. Two
gaps surfaced, kept distinct: `docs/SHIPPING.md`'s pre-existing, already-documented "no
auth on the API at all" (a whole-app property, not something this session's work changed
either way — see that doc's "Private" rung for the accepted fix), and one real gap this
feature itself introduced — `authFlows.ts`'s captured `lines` are served over that same
unauthenticated API, and Claude's stdout shape (unlike Codex's) was never verified clean.
Operator asked for the fix: added `redactSecrets()` (decisions.md 2026-08-25 has the
full reasoning) — a labelled-secret line is replaced whole, an unlabelled long opaque
blob is partially masked, both applied inside `linesFrom()` so nothing downstream ever
sees the unredacted form. Re-verified live against the real device-code flow afterward
(fresh `codex login` call via `curl`) that the fix doesn't collateral-damage the one
legitimate secret-shaped output the feature needs to show — URL and code both came
through unredacted, `ps aux` clean after cancel. 12/12 `authFlows.test.ts` tests pass,
`pnpm build` clean, server package 321/321. (One web-package test,
`App.test.tsx`'s "renders the library route by default", failed only in the full
parallel `pnpm -r test` run and passed clean in isolation both before and after this
change — a pre-existing flake, unrelated to this file.)

## M27 — when the back of the sheet is first visible, measured before it was designed — 2026-08-25

The 2026-08-03 sign-off left one ⚠️ on the back-of-sheet work: the second capture costs
~22ms, it must land before the first back-facing pixel is drawn, it cannot block the grab,
and **"do not decide this from the armchair; instrument which frame first shows a
back-facing pixel and measure whether 22ms beats it."** So, instrumented first.

The back of the sheet is two regions, and they do not appear at the same time.

- **The lip** — the roll's far half — is back-facing from the very first frame, because the
  roll has some arc as soon as the pointer moves at all. It is also tiny and heavily
  compressed: at 98px of travel on a 649x771 leaf it is 4,696px², under 1% of the leaf, and
  it carries a shading gradient rather than legible text.
- **The tail** — the flat surface that is the only place readable back-page text can land —
  does not exist *at all* until the anchor-to-pointer distance passes **`0.582 x arc`**.
  That is not a fudge factor: below the arc clamp `creaseToCorner` and `arc` are equal, so
  the tail is exactly degenerate, and the two separate at precisely `d = arc x (1 -
  ROLL_END.o) / (1 - ROLL_END.o)`… i.e. where the clamp releases.

Measured against the real geometry:

| leaf | arcTarget | first tail pixel at |
|---|---|---|
| spread 649x771 | 168.7px | **d = 98.2px** of pointer travel |
| single 900x771 | 200.5px | **d = 116.7px** |

And on a click/keyboard turn, where the pointer path is synthetic (420ms, ease
`[0.4, 0, 0.2, 1]`, `SWEEP_OVERSHOOT` 2.2) the tail first appears at **frame 4, ~67ms into
the sweep** — the same answer for both leaf sizes, because the sweep is scaled to the leaf.

**So 22ms wins the race with ~3x of headroom, and blocking the grab would be paying every
reader 22ms of latency to avoid a state they cannot see.** The capture is fired unawaited
the moment the rendition step resolves — which in `turnPageCurl` is *before* the sweep
starts, and in the drag is while the reader is still travelling the first 98px. Until it
lands the fold paints the pre-M27 mirror, as a designed transitional state.

The one honest caveat: the *lip* is back-facing from frame 0, so for the first ~50ms of a
drag a sliver averaging under 1% of the leaf carries a ghost of the wrong page. That is
below the threshold of anything anyone can see on a moving roll, but it is not literally
zero and is recorded rather than rounded away.

## M27 — the back, re-judged in the harness: the paper wash belonged to the fake — 2026-08-25

The second ⚠️ was that `SHOW_THROUGH` (0.20), `backOfSheet`'s lift and `sheenScale` were all
tuned against a mirror and would need re-judging against real content. They did, and the
finding was sharper than "re-tune a number".

**`SHOW_THROUGH`'s wash is not a property of the back of a sheet — it is part of *faking*
one.** It exists to turn the front's mirrored print into something that reads as the other
side: knock the text down to a ghost, take the surface to the page's background colour. A
real back capture already *is* the other side. It carries its own paper and its own print,
and washing it ghosts the very text the second capture was taken to fetch. First cut did
exactly that and the harness showed it immediately: the right page, at 20%, which is the
old look with better provenance and none of the benefit.

So the wash now applies only when the back is the front standing in for it
(`SheetFaces.back === null`).

**But dropping it to zero broke the dark theme, which is what the ⚠️ was really about.**
`backOfSheet`'s lift scales with `1 - lum`, so in `ink` it was carrying most of the "this is
a lifted object" cue. With no fill at all the tail became a near-black triangle with the
page's own light text on it — it reads as a *hole in the page*, not as paper. The lift was
never only about hiding text; it was also the material.

Hence a second constant, `BACK_LIFT`, for how far a **real** back goes toward the sheet's
lit paper colour. Swept in the harness at 0.00 / 0.20 / 0.34 / 0.50 against real back-page
prose, `ink` being the deciding theme:

- **0.00** — tail vanishes into the page. No lifted-sheet reading at all.
- **0.20** — separates, but weakly; still reads closer to a shadow than to paper.
- **0.34** — reads as a lifted sheet, lip sheen visible, back text clearly its own text. **Chosen.**
- **0.50** — lighter and arguably the most "paper"-like, but the back's text is losing
  contrast against its own surface: we are back to throwing away what we went to get.

Verified at 0.34 in all three reading themes. `sheenScale` and `backOfSheet`'s own lift were
left alone — with `BACK_LIFT` doing the material job they still read correctly, and changing
three coupled constants at once to fix one symptom is how the old tuning got hard to reason
about.

**Two things the operator still owns**, both named in the 2026-08-03 Verify and neither
decidable here:

1. Whether the real back reads *better* than the mirror. It is unambiguously more
   information on that surface. In `paper` and `sepia` it reads as texture rather than as
   competing text and looks right to me; `ink` is the one where "noise" is most arguable.
2. **Single-page mode doubles.** One turn advances one page, so the leaf's back and the page
   revealed beneath it are the *same* page — you see page 65 mirrored on the sheet and
   upright underneath. That falls straight out of the ruling as stated ("the whole card in
   single-page mode") and is not a bug in the implementation, but it is a consequence worth
   seeing before it is signed off. The harness shows it honestly rather than papering over
   it; spread mode has no such doubling.

The harness grew `&back=real|mirror` for exactly this comparison, and its "next page" text
was lengthened to a full page — it had been three paragraphs, so the back was mostly blank
paper and the show-through question could not actually be seen.

## M27 — the low-fps guard finally takes the p90 it was ruled to take — 2026-08-25

A small change with a large amount of history behind it, and worth a note mainly because
**PAGE_CURL.md §7 has read "the guard now takes the p90 of drawn frames" since 2026-08-03
while the shipped guard was still taking the median.** The step 4 entry ruled it; nothing
implemented it; the doc described the intent in the present tense. If you are reading §7 and
wondering why the numbers do not match the code, that gap is why — it is closed now.

The statistic has now been wrong twice, and both times the measuring was fine and the choice
of statistic was not:

1. The **mean frame interval** over the canvas's whole mount, which was reading vsync
   (16.6ms healthy, 33ms threshold) and latched a downgrade on almost every first turn.
2. The **median draw cost**, which measures the fold but reads its dead tail —
   `SWEEP_OVERSHOOT` is 2.2, so about half a programmatic turn's frames happen after the
   sheet has left the leaf and cost ~0.

So `drawCostP90` got its own module rather than living inline in `PageCurl`'s cleanup, and
its tests are written against the actual traces the step 4 entry recorded — the 25-frame
keyboard turn whose median is 0.9ms and whose peak is 27.8ms, and the 104-frame held drag at
7.4ms median. Those tests assert the thing the milestone is actually for: **the same fold,
turned by key and by hand, now reads within ~2x instead of 7x apart**, while a single
GC-hit frame still cannot move the number.

Nearest-rank rather than interpolated, deliberately: the figure traced in dev is then a
frame that really happened, which makes the dev line comparable to a profiler's.

**Not verified here:** the acceptance criterion asks for the dev trace on a real held drag
and a real keyboard turn of the same fold. That needs the app driven by hand on the
operator's machine — see the blocker note below on the two M27 measurements.

## M26 — `codex exec --json`'s real event shape, and three things `--help` didn't say — 2026-08-25

The auth blocker cleared (this machine's `codex login` succeeded via the new in-app flow),
so this is the "run one real call and read the actual JSONL" step the M26 task and the
2026-07-30 decisions entry both required before writing `codexCli.ts`. Verified against
`codex-cli 0.114.0` on this Linux machine, a ChatGPT-plan account.

**The event shape** (`codex exec --json -m gpt-5.4 "..."`, no tool use):
```
{"type":"thread.started","thread_id":"<uuid>"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":N,"cached_input_tokens":N,"output_tokens":N}}
```
Failure shape: `{"type":"error","message":"..."}` followed by
`{"type":"turn.failed","error":{"message":"..."}}` — both fire; `turn.failed` is the one
worth surfacing, `error` duplicates its message. No `cost_usd` anywhere — matches the
task's "estimated if the CLI reports no tokens" acceptance line, except it's the reverse:
tokens *are* reported, cost is not. Ledger should treat this the way `claude-agent`'s
`reportedCostUsd` gap is already treated (`pricing.ts`) — tokens `reported`, cost `none`/
`notional` depending on how the ledger's basis enum wants a subscription CLI represented.

**Finding 1 — no streaming.** `--json` is JSONL-per-completed-item, not token deltas.
A 150-word answer arrived as a single `item.completed` with the full text already assembled
— nothing between `turn.started` and that one event. `stream()` on this provider cannot
stream in the token sense the other three providers do; it can only yield once, at the end.
The seam's `AsyncIterable<{text}>` still works (one yield instead of many), but the UI's
per-token reveal will not animate on this provider — worth a settings-UI note the way the
"response length is a request, not a ceiling" caveat already gets one for `claude-agent`.

**Finding 2 — multiple `agent_message` items in one turn, and which one is the answer.**
Asked to run a shell command (to test the read-only cage, below), the turn emitted *two*
`item.completed` events: a narration ("Running the requested shell command now…") and then
the actual answer ("Failed"). A plain question-answering prompt with no tool attempt always
produced exactly one. The CLI's own `-o/--output-last-message <FILE>` flag resolves the
ambiguity by naming its own convention: **the last `agent_message` before `turn.completed`
is the answer.** `codexCli.ts` should track the last one seen, not concatenate or take the
first — concatenating would prepend tool-use narration to real answers on any turn where the
model even attempts something the sandbox then blocks.

**Finding 3 — `-C <dir>` (and `--output-schema <file>`) fail on a tmpfs path, full stop.**
`codex exec -C /tmp/whatever` → `Error: No such file or directory (os error 2)`, every time,
regardless of `--sandbox`/`--ephemeral`/`--skip-git-repo-check`, on an otherwise-real,
freshly-created, world-readable directory. Same error for `--output-schema` pointed at a
file under `/tmp`. The same directory under `/home/shyamw` (ext4) works immediately. `stat
-f` confirms it: this machine's `/tmp` is `tmpfs`, `/home` is `ext4`. Root cause not chased
further (not this project's bug to fix), but the behavior is 100% reproducible here — this
is not a one-off flake. **Consequence for the cage:** the "dedicated empty scratch
directory" the 2026-07-30 decision calls for cannot be `os.tmpdir()` on this machine — that
resolves to `/tmp` and every real call would fail before the model ever runs. `codexCli.ts`
must use a fixed non-tmpfs location instead (not the repo, not `data/`, per that decision) —
e.g. under `os.homedir()`. Whether this reproduces on the operator's Mac (a case-insensitive
APFS volume, not tmpfs) is unverified; the workaround costs nothing there either way, so it
isn't worth gating on finding out.

**Finding 4 — `exec` has no `-a/--ask-for-approval`.** That flag exists on the root `codex`
(interactive) command; `codex exec --help` doesn't list it, and passing it errors with
"unexpected argument". The 2026-07-30 decision's cage list ("approvals never") was written
from a `--help` read that conflated the two subcommands' flag sets — exactly the trap that
decision's own warning called out, just on a different flag than expected (the event shape
was fine; the approvals flag was not). `exec` mode has nothing to approve *to* (there's no
human on the other end of a non-interactive spawn) — omit the flag entirely rather than
pass one that doesn't parse.

**Sandbox proof, done live:** asked the CLI (under `--sandbox read-only`, no `-a` flag, cwd
outside `/tmp`) to write a file inside its own `-C` root. It attempted the shell command,
reported "Failed", and the file never appeared. Read-only holds.

Not yet run: killing the child process mid-turn (the "designed `LLMError`, not a crash"
acceptance line) — that's `codexCli.ts`'s own code to write and test, not a CLI behavior to
discover, so it's covered by that file's tests instead of a live probe here.

**Harmless noise, worth knowing before it looks like a bug:** every call on this account
logs one `ERROR codex_core::models_manager::manager: failed to refresh available models:
… unknown variant \`max\`, expected one of \`none\`, \`minimal\`, \`low\`, \`medium\`,
\`high\`, \`xhigh\`…` line — a version-skew issue between this CLI build and the models
endpoint, unrelated to anything this project does. It lands on **stderr**, never stdout, so
it never pollutes the JSONL parse; `codexCli.ts`'s stderr-tail capture will pick it up on a
real failure's tail even though it didn't cause one — don't chase it.

## M27 — the apex cannot be both given and consistent — 2026-08-25

Building "the geometry grows an apex" turned up a contradiction in the task as written, and
it is a real one rather than a wording quibble, so it is recorded here rather than quietly
resolved.

TASKS.md describes the geometry as gaining "a cone — **apex distance along the spine**",
which reads as a free input. The same task's acceptance asks that **"the grabbed anchor still
lands exactly under the pointer"**. Those two cannot both hold:

- A cone's rulings are its generators and paper is inextensible, so a point **keeps its
  distance from the apex**. That is not an implementation choice; it is what makes the
  surface developable, and it is the same property that makes the lift fall to zero at the
  binding.
- So with the apex fixed, the grabbed anchor is confined to **one circle about it**. An
  arbitrary pointer is not on that circle, and no choice of crease angle or arc puts it there.

Given both, the apex has to be the derived quantity. **It is the point on the spine line
equidistant from anchor and pointer** — where their perpendicular bisector crosses the spine
— which is the unique apex for which the drag is even expressible. `computeConeFold` solves
it that way and the anchor lands exactly under the pointer at every depth and from every
anchor (tested).

Two things fall out that are worth knowing before the renderer is built:

- **The far field is not a special case that had to be written; it is where the solve stops
  having an answer.** When the drag is square out from the edge, the bisector runs parallel
  to the spine and there is no intersection — the apex is at infinity. That is exactly the
  drag whose crease genuinely *is* parallel to the spine, i.e. the shipped flat-crease roll.
  So `computeConeFold` returns `null` there and the caller keeps using `computeFold`. The two
  models meet precisely where they should, and the convergence test drives the gap between
  them to the floating-point noise floor.
- **The apex moves during a drag**, since it depends on where the pointer is. It is not a
  fixed hinge the sheet swings on for the whole gesture. That is physically reasonable — the
  reader is choosing how the sheet is being pulled, not just how far — but it is a thing the
  renderer will have to be comfortable with, and it means "apex distance" is a *reading* of a
  drag rather than a tunable.

⚠️ **For the design session, not for the implementation to decide:** whether the apex should
instead be *clamped* — held to a minimum distance, or eased between frames — so a fast
diagonal flick cannot swing it wildly and snap the fan around. Nothing here does that,
because a stabiliser chosen without seeing the thing move is a guess, and the renderer that
would show it does not exist yet. The pure model is the honest place to stop.

Not touched, deliberately: `computeFold`, `drawPageFold` and the shipped ladder. The cone is
additive and nothing calls it yet — "the renderer still swapped underneath it".

## M26 — the scratch dir's real constraint wasn't tmpfs, it was the leading dot — 2026-08-25

Addendum to the entry above, found running `codexCli.ts`'s own `extract()` end to end
(not just the raw CLI) for the first time: `~/.marginalia/codex-scratch` — the fix the
tmpfs finding above led to — itself failed, `--output-schema <file>` inside it throwing
`Permission denied (os error 13)`, not `ENOENT`. Different error, different cause.

`codex` on this machine is a **snap package** (`/snap/bin/codex`; `snap connections codex`
shows a confined `home` plug). Isolated it by testing three directories with the same
`--output-schema` call: `/home/shyamw/marginalia-codex-scratch-test` (no dot) worked
immediately; `/home/shyamw/.hidden-test-dir` (dot, otherwise identical) reproduced the
exact same `Permission denied` on the first try. **Snap's `home` interface denies access to
dot-directories under `$HOME` by policy** — a known snap confinement behavior, not a codex
bug. The tmpfs finding above still holds (that's a separate, also-reproduced failure mode,
`ENOENT` not `EPERM`) — the two just needed to both be worked around, and the second one
wasn't visible until a call that actually *reads a file* from inside the scratch dir was
tried (plain `stream()` calls only ever pass `-C` and never trip it, which is why the first
pass here read as clean).

`scratchDir()` now returns `~/marginalia-codex-scratch` — no dot anywhere in the path,
still not `os.tmpdir()`, still not the repo or `data/`. Re-verified after the fix: `stream()`,
`extract()` (a real structured JSON answer came back, schema-valid, first try), the
read-only sandbox proof, and a mid-stream `AbortSignal` kill (`LLMError`, no orphaned
process) all pass against the corrected path.

Also resolved in the same pass, not a `toDraft7JsonSchema` bug: an *earlier* manual CLI
probe of `--output-schema` (done to chase the permission error) failed with "'additionalProperties'
is required to be supplied and to be false" — but that was a hand-written probe schema
that omitted the field, not `codexCli.ts`'s real conversion path. `z.toJSONSchema` already
emits `additionalProperties: false` on a plain `z.object()` by default (checked directly);
the live `extract()` re-run above confirms the actual code path was never affected.

## M26 — the sign-in was never lost; we were reading the wrong stream — 2026-08-26

Two operator reports at M26 sign-off, from two machines. Recorded together because they
arrived together and were then found to share nothing.

### The "Codex forgets my login on every rebuild" report

Not what was happening. Reproduced against the running dev server before touching
anything:

```
$ curl -s localhost:5175/api/provider-auth/codex/status
{"provider":"codex","loggedIn":false,"detail":null}     # 0.15s — not a timeout

$ codex login status
Logged in using ChatGPT
$ echo $?
0
```

Both true at the same instant. Running the same command with piped stdio (which is how
the server always runs it) separates the streams:

```
rc= 0
stdout= ''
stderr= 'Logged in using ChatGPT\n'
```

`codex` 0.114.0 answers `login status` on **stderr** when stdout isn't a TTY. Under a pty
it looks like ordinary terminal output, which is why the 2026-08-25 session never caught
it. `checkAuthStatus` collected stdout only, so `text` was `""` — and its
`code === 0 && text.length > 0` guard turned that silence into `loggedIn: false`.

The credentials were fine the whole time and in the place they were expected:

```
$ ls -l ~/snap/codex/current/auth.json
-rw------- 1 shyamw shyamw 3892 Aug 26 09:03 auth.json    # refreshed today
```

So the badge was wrong, but the *damage* was the operator re-running device auth on every
app load, on a machine that had never been logged out. Fixed by reading both streams and
dropping the emptiness clause; `interpretCodexStatus` now holds the live shapes as
fixtures. After the fix, same endpoint, same server:

```
{"provider":"codex","loggedIn":true,"detail":"Logged in using ChatGPT"}
```

**Also found while looking, worth knowing:** this rig has *two* independent codex
credential stores. `/snap/bin/codex` (what Marginalia spawns) uses
`~/snap/codex/current/auth.json`; the VS Code ChatGPT extension ships its own codex
binary at `~/.vscode-server/extensions/openai.chatgpt-*/bin/linux-x86_64/codex`, isn't on
`PATH`, and uses `~/.codex/auth.json`. The dev server's environment also carries
`CODEX_HOME=/home/shyamw/.codex`, inherited from that extension. Signing in through one
does not sign in the other. Not the cause of anything here, but it is a trap: `~/.codex/`
looking freshly written is no evidence about the binary we actually spawn.

### The Mac's `spawn codex ENOENT`

`spawn` searches `process.env.PATH` and nothing else. A server not started from a login
shell gets the bare launchd default. Reproduced on this Linux rig by forcing exactly that
PATH, which turns the Mac's error into a local one:

```
$ env -i HOME=$HOME PATH=/usr/bin:/bin:/usr/sbin:/sbin tsx sim.mts
PATH = /usr/bin:/bin:/usr/sbin:/sbin
  bare spawn('codex'): spawn codex ENOENT          # the operator's Mac, verbatim
findCliBin('codex') = /snap/bin/codex
  resolved spawn: codex-cli 0.114.0
```

`SHELL` was unset in that run, so the recovery came from the installer-directory table
alone — strategy 2 of `cliPath.ts` — without the login-shell fallback firing. On a Mac
the same table entry is `/opt/homebrew/bin` rather than `/snap/bin`.

`which -a codex` on the operator's Mac is the one datum that would confirm which
installer they used; the resolver covers Homebrew, npm-global, volta, bun, deno, yarn,
cargo, `~/.local/bin` and every nvm node version, then asks the login shell, so it should
not matter. `MARGINALIA_CODEX_BIN` ends the question outright if it does.

## M27 — the hinge, and the four things it took to make the spine unmovable — 2026-08-26

"The sheet hinges at the spine" turned out to be four findings rather than one wiring job,
and three of them are measurements. Ruling in decisions.md 2026-08-26; this is the working
that produced it, kept because every one of these was arrived at by probing the model
rather than by reading it.

**Starting state, measured before touching anything.** `computeConeFold` as it stood on
2026-08-25 kept the spine fixed at the depths its tests covered, and gave up outside them.
Dragging the bottom-right corner of a 600x800 leaf toward the top-left:

| depth `t` toward the opposite corner | cone | flat model's spine movement |
|---|---|---|
| 0.15 / 0.35 / 0.60 | apex below the leaf, spine fixed | 0 / 0 / 0.3 px |
| 0.85 / 1.0 / 1.4 / 1.8 | **null** — apex lands inside the leaf's span | 130 / 280 / 680 / 1080 px |
| 2.2 (the sweep's own overshoot) | crease at −1.03 rad | 1480 px |

So the whole middle of an ordinary diagonal turn fell through to `computeFold`, which moves
the spine edge by up to a thousand pixels, and the one deep case the cone *did* answer moved
it anyway because the crease had swept past the binding. Both holes are now closed; the same
sweep now reports **4.5e-13 px** of spine movement and exactly zero lift, over 4764 drags
across six anchors, two leaf sizes and both synthetic paths.

**1. Where the apex is allowed to be is a statement about the drag.** `apexY = 0` is the
locus `|P − S0| = |C − S0|`, `apexY = height` the same about the other gutter corner, so the
legal region is the lens between two circles *through the anchor*. Mapped it on a 601x601
grid before believing it: inside the lens, **0 of 26538** sample points produce an apex on
the binding, for corner and edge anchors alike; inside the *home* circle alone, 16235 of
42773 do — so the one-circle clamp that every page-flip tutorial carries is not enough here,
and the second circle is what makes the statement exact.

**2. The projection has to follow the drag, not the metric.** Two rules were built and
measured before the third worked:

| clamp rule | worst frame-to-frame motion on a diagonal sweep |
|---|---|
| clamp the apex to the nearer end of the span | **916 px** |
| project the pointer onto the nearest point of the lens | **750 px** |
| follow the drag's own direction to where it leaves the lens | 0.49 px, at a 0.49 px pointer step |

Both failures are the same failure: a lens is a sliver with two tips, and "nearest" flips
between them mid-sweep. Following the ray keeps the anchor's own direction and, because two
circles through the anchor cut a *convex* lens with the anchor on its boundary, the exit
point is unique and closed-form — each circle's quadratic collapses to a single root
precisely because the anchor lies on it.

**3. The far-field hand-off had to go, and what replaces it is a number with two walls.**
Returning `null` for a square pull was correct about the geometry (the apex really is at
infinity) and wrong about the consequence: the caller then uses `computeFold`, which is the
model that moves the spine. Holding the apex at a finite distance `R` instead costs two
errors that pull opposite ways, both measured on a 460x760 leaf:

| `R`, in leaf diagonals | seam where the held apex swaps ends | leaf coordinates lost to cancellation |
|---|---|---|
| 1e3 | 1.16 px | ~1e-10 px |
| 1e6 (shipped) | **1.2e-3 px** | **~1e-7 px** |
| 1e12 | ~1e-9 px | 1e-4 px |

Three decades of margin either side at 1e6. The residue against the flat model at a square
pull is 2.9e-4 px, which is the `L²/2R` foreshortening of a radius measured from a held apex
rather than from infinity — real geometry of the stand-in, not error. ⚠️ None of this
survives **float32**: at `R = 8.9e8` a float32 apex quantises to tens of pixels. The
renderer must deform in float64 and upload positions, not the apex.

**4. `syntheticFoldPointer`'s 2.2x diagonal overshoot is a flat-model artefact and a bound
sheet cannot follow it.** It exists because a flat crease only covers the leaf once it
clears the diagonal. A hinge covers the leaf by turning *through* the binding instead, and
the overshoot leaves the lens early — so the clamp holds the anchor a third of the way in
and the turn never finishes:

| path, at progress 1, corner grab, 460x760 leaf | leaf still lying flat |
|---|---|
| `syntheticFoldPointer` (2.2x diagonal) | **57 of 81 sample points** |
| `syntheticHingePointer` (anchor → its mirror across the spine) | 9 of 81 — *exactly the spine column* |

An **edge** grab is unaffected: that path is already square across and merely overshoots the
mirror by 120px. Only corner grabs stall.

**One thing left open on purpose.** The hinged path is square across, which is the far
field, so a click turn animated along it is the cylinder from end to end and never shows the
fan the cone exists for. A real thumb pulls up *and* across, which is what puts the apex a
leaf-length off the end and fans the curl. That is a look question for whoever builds the
renderer; the straight path is the one with a coverage proof attached, and it is the only
claim made for it.

**And one consequence worth expecting rather than debugging later.** At the end of a full
hinged turn the anchor stops **169.6 px** short of the mirror position, because the roll is
still eating `arc * (1 + rollEndO)` ≈ 151px of the sheet. The flat model pays for that by
overshooting the pointer; a bound sheet cannot. The leaf is fully covered regardless, which
is what the acceptance asks — it is the corner's resting place that is short, on the last
frame of a turn that is about to be replaced by the real rendition anyway.

## M27 — the fold's mesh: why a fan of 169 vertices beats a grid of thirty thousand — 2026-08-26

Building the WebGL renderer's first half (`foldMesh.ts`, `PageFold3D.tsx` — the wiring is a
separate pass). Ruling in decisions.md 2026-08-26; these are the numbers behind it.

**The tessellation is not a taste question.** The cone's deformation depends on `psi`, the
fan angle past the crease, and on nothing else — the exact analogue of the flat model
depending on `w` alone. Two things follow that decide the mesh outright:

- **Along a ruling the surface is straight.** At fixed `psi` the position is
  `apex + r * direction` and the lift is `r * arcAngle * z(psi)` — *both linear in `r`*. Two
  vertices per ruling are therefore exact, not an approximation.
- **All the curvature is in the roll**, and the roll's angular span is not a fixed fraction
  of the leaf's. On a 460x760 leaf a dog-ear's `arcAngle` is 0.16 rad against a leaf
  spanning ~1 rad; in the far field it is **1.35e-7 rad** against the same ~1 rad. A
  uniform grid resolving the lip in the first case misses it entirely in the second.

Measured vertex counts across six anchors, two leaf sizes and six drags each: **127–169**,
never more. A uniform grid fine enough to put ~20 steps across the roll's footprint on the
same leaf is ~18,000 vertices — and would still have nothing in the roll in the far field.
The flat page and the tail take one wedge each because they are planar; the roll takes the
profile's own 40. It is `drawPageFold`'s band decomposition with one more dimension.

**Watertightness is the property this can silently get wrong**, so it is tested by summing
*source-space* triangle area and comparing to the leaf's — an overlap counts twice and a gap
counts short, so one number catches both. Holds to 1e-9 relative across every case.

**The deformation cannot go in a vertex shader**, which was the obvious optimisation and is
the wrong one. The apex is held up to a million leaf-diagonals down the spine, so a leaf
coordinate is a *cancellation* against a number near `1e9` — float32's ulp there is about
60 px. The CPU does it in float64 and uploads positions, which is affordable precisely
because the fan is 169 vertices and not 18,000. This is the concrete form of the float32
warning in the hinge entry above.

**One acceptance criterion had already expired, found while sizing the work, not while
failing it.** M27 asks that `pageTransition: "slide"` be provable by
`document.querySelectorAll("canvas").length === 0` through a whole turn. `Scene3DProvider`
latches `everRegistered`, so a session that has shown the Desk keeps a canvas mounted for
the app's life and the count is non-zero before the reader is even reached. The criterion
dates from 2026-08-03, before M23 existed. Restated in decisions.md as the thing it was
actually protecting: under "slide" the fold registers no 3D layer and mounts no grab
surface.

**Colour, because it would have read as a bug rather than as a setting.** three.js converts
output colour space inside the material's own fragment shader. A hand-written
`ShaderMaterial` includes none of that, so declaring the card textures `NoColorSpace` and
writing `gl_FragColor` directly passes the bitmap's bytes through untouched — the same
pixels canvas 2D was putting on screen. Getting this wrong shifts the reading surface's
paper colour on the frame a turn starts, in a direction that looks like a theme bug.

**Not measured here, and it is the honest gap:** every number above is arithmetic, not
pixels. This machine's Chromium composites in software, so the mesh's *look* — and in
particular the shadow, which trades `drawPageFold`'s `shadowBlur` for a contact falloff
because WebGL has no cheap equivalent — is unjudged. It goes to the harness on the
operator's Mac with the rest of M27's Verify.

## M27 — what a gesture found that a pose could not — 2026-08-26

`pageCone.html` tracked *hover*: no press, no release, so the only thing it could ever show
was a fold held at a pose. Operator feedback was three asks, every one of them about
something that only exists in a gesture. Ruling in decisions.md 2026-08-26 "A turn is a
gesture"; these are the numbers and the two dead ends.

**The generalisation cost nothing, which is the evidence it was right.** `EdgePinch` (the
anchor is where the paper was grabbed) was added to `pageFold.ts`'s anchor helpers and to
`pageCone.test.ts`'s shared `ANCHORS` set — and every invariant the cone already owed passed
for it with **no change to `computeConeFold`, `sampleConeAt` or `foldMesh.ts` at all**: the
spine edge unmoved at every drag depth, the leaf covered by progress 1, the fold moving no
faster than its pointer. A fourth special case would have needed code; a generalisation
needed only a call site.

**Landing measurements** (leaf 600x800, `curlArcLength` = 156px, every anchor, four depths,
both synthetic paths):

| settle | crease at the end | anchor lands | max lift |
|---|---|---|---|
| arc held at 156px | **0.00°, saturated** | ~119px short of the mirror | 26-105px |
| arc relaxed (`1 - t^2`) | 0.00°, not saturated | **0.01px** from the mirror | **0.0px** |

So a fixed arc does not merely look wrong at the end, it *stops the turn early*: the crease
has to clear `arcAngle * (1 + ROLL_END.o) / 2` before the anchor can reach the mirror, so it
runs out of angle against the binding while the animation is still playing. Both columns are
the same cause.

**Two dead ends worth not repeating.**

*The apex is not "held still" in the sense a first test asserts.* Freezing it and rotating
the anchor about it does hold it — to the last bit, measured, at every step — but only where
the apex was **solved**. A release in the far field has no apex to hold: it is held at
`FAR_APEX_DIAGONALS` off one end or the other depending on which side of square-on the
pointer passed, and the swing can cross that. The two differ by ~1e-3 px of geometry, which
is exactly what that constant was sized for. The invariant that covers both is continuity of
the *paper*, not identity of the apex.

*And the fully-turned pose has no apex at all.* At the mirror every point of the spine is
equidistant from anchor and pointer, so `bisectorApexY` is undetermined there and the
re-solved apex lands on rounding — 1200, -400, whatever. It does not matter, and the reason
is worth writing down rather than rediscovering: it is also the pose where `creaseAngle`
reaches zero, so the crease *is* the spine and the sheet reflects across the binding
whatever apex the arithmetic picked. Measured: the final step of the settle moves the paper
9.68px at 240 steps, against a worst mid-swing step of 9.69px — i.e. the landing step is the
same size as every other one. Halve the steps and both double. It is smooth motion, not a
bound that happens to hold.

**The threshold does not carry across, and the number is not close.** The reader commits
past `0.35` of drag distance over `0.9 * leafWidth` — ~120px on a 380px leaf. A hinge's turn
spans the anchor to its mirror, **two** leaf widths of travel, so the same 120px is `0.157`
of `HingeRelease.progress`. Copying 0.35 across was the first thing tried and it reads as a
page that will not turn: 266px of drag on a 380px leaf before it commits.

**An `<img>` is draggable by default.** The first press on the new grab surface sprang the
sheet back instantly, every time, and looked exactly like a broken fold. The underlay is an
`<img>`; pressing it starts a native image drag, and Chromium answers the fresh
`setPointerCapture` with `pointercancel` on the very next frame — `gotpointercapture`
immediately followed by `pointercancel`, with no `pointermove` in between. `draggable={false}`
plus `user-select: none`. Cost about twenty minutes of suspecting the layer registration,
because the symptom (mesh present at rest, gone the instant you touch it) points straight at
the thing that *did* change.

**And one about driving it.** Hiding the header for a clean screenshot moves the stage
without the fold hearing about it — the leaf's viewport origin is cached per frame and only
`resize`/`scroll` refresh it — so the mesh renders offscreen and looks like it stopped
drawing. This is the second time that cache has produced a convincing false symptom.

## M27 — three things only looking at it could have found — 2026-08-26

`pageCone.html`: the shipped flat painter and the hinged mesh side by side, driven by one
drag. Built because the mesh had passed every test it had and had never been *rendered* —
`foldMesh.test.ts` can prove a vertex sits on the surface and cannot tell you the sheet is
inside out. Three defects in the first four frames, none of which a unit test was ever
going to catch:

**1. The shadow compounded to black.** Built from the mesh's own forty-odd wedges, which is
the obvious thing to do and is wrong: a rolled sheet's wedges **overlap once deformed** —
the tail comes back over the roll — so a translucent shadow drawn from them accumulates
alpha wherever the sheet has folded over itself. It rendered as a hard black wedge lying
across the page. Now two polygons, the roll's and the tail's, clipped coarsely; they cannot
overlap themselves, which is also exactly why `drawPageFold` has two.

**2. The sheet showed its back page on the half of the leaf that had not lifted.** The cause
was a **texture setting**, not the geometry: three's `CanvasTexture` defaults to
`flipY = true`, uploading the bitmap upside down so `v = 0` is its bottom row, while every
other coordinate in the fold runs downward from the top. Worth recording because of what
happened next — the symptom reads exactly like an inverted triangle winding, and inverting
the winding to chase it produced a *second* wrong answer that compounded with the first into
a clean 180° rotation, which reads like neither. Two flips are indistinguishable from one
when the fixture is a paragraph of prose.

**So the harness grew `?fixture=letters`**: one huge glyph a side, plus a tick in the
top-left corner only. A letter cannot be mirrored without saying so, and the corner tick
separates "upside down" from "left-right reversed". It settled in one screenshot what three
readings of prose had not. Keep it for anything that maps a texture onto a surface.

**3. And one thing that is not a defect: the mesh delivers ask (c) for free.** PAGE_CURL
§2c — "text squeezing into the curl" — is listed as *out of scope* for M27, on the grounds
that it is a projection problem the band painter cannot solve. A mesh maps the texture onto
the actual curved surface, so the page's own text bends into the roll without anything being
written for it. Visible at `?state=peel-20` along the lifted edge. §2c should be re-read
after the wiring lands rather than left as an open item.

**What the harness is not.** This machine composites in software, so what these frames
prove is *shape, orientation and texture mapping* — not smoothness, not the shadow's look,
not cost. The falloff that replaced `shadowBlur` in particular is a proposal and still owes
a side-by-side on a real compositor.

**Also true of the hinge, and worth expecting before it is called a bug:** for the same
pointer a bound sheet turns *much* further than a free one, and a shallow corner pull lifts
the leaf's **whole outer edge** rather than dog-earing the corner. Both are correct — a page
bound at the gutter pivots about it — and both are large visible changes from the shipped
fold. They are the first thing to look at on the operator's Mac.

## M27 — the fold was losing two different fights at once — 2026-08-26

The operator sent two asks about the newly wired hinge, plus two screenshots: the curled
page should be *in front of* the page it curls onto, and the reader's chrome should be
covered by it. Reading it as one z-index problem would have shipped a fix that leaves half
of it broken, so this is the part worth writing down.

**Reproducing it first was the whole difference.** The screenshots were ambiguous — squinting
at them, the sheet looked like it was already on top in places — and two readings of ask (1)
were live: "the sheet is behind the far leaf" and "the sheet is behind the near leaf's live
text". Driving a real drag (Playwright, real mouse, spread mode) settled it in one frame:
drag far enough that the sheet crosses the gutter and **its tail simply stops existing**.
`FarLeafCover` is `z-index: 5`, the shared canvas is `z-index: 0`, and both sit in the root
stacking context. Nothing subtle. The screenshots had not been dragged far enough to show it,
which is exactly why they were ambiguous.

**Then immersive mode, which was a different bug wearing the same clothes.** The same drag
with `f` pressed first drew *no fold at all* — and after the elevation was in and the DOM
said `data-elevated="true"`, `z-index: 960`, still no fold. That is the tell: the canvas was
not losing on depth, because it was not being composited at all. `document.fullscreenElement`
came back as the reader's own `.wrapper`. A real fullscreen element goes into the browser's
**top layer**, and the top layer is not a z-index — it is above the entire stacking order,
and nothing outside the fullscreen element renders. `requestFullscreen()` now targets
`document.documentElement`, which contains the shell *and* the seam's canvas.

**What I would have got wrong without the second check:** the fix for (1) was verified
working in the windowed reader, both asks visibly satisfied, and it would have been very easy
to stop there and report the milestone item done. Immersive mode is the operator's actual
reading mode in one of the two screenshots.

**Two smaller things worth keeping.**
- Headless Chromium honours `requestFullscreen()` off a synthetic keypress, so the top-layer
  bug is reproducible in automation. It would not have been from a screenshot.
- `.wrapperFullscreen` is `z-index: 50` **and** `position: fixed`, so it is a stacking
  context around the whole reader. Even with the fullscreen target fixed, a `z-index: 0`
  canvas is under all of it — the two causes overlap in immersive mode and each is
  sufficient. Fixing either one alone leaves it broken.

**Live checks that passed after the change** (both page modes, both drag directions): the
sheet covers the far leaf's cover, the strip, the title block and the nav pebble mid-drag;
the immersive pebble too; a committed turn and a spring-back both release the elevation
(`[data-elevated]` gone); the Desk's notepad and action card still sit over its books, which
is the contract this deliberately did not repeal.

## M30 C/D — the token cap was the bug, and the dictionary was the easy half — 2026-08-26

Define and the glossary. The glossary was as small as M30 D predicted; Define found two
things worth writing down, both of which would have shipped as "no definition found" and
looked like a designed empty state doing its job.

**1. A small output-token ceiling on a reasoning model buys silence, not brevity.** M30 C
says "a <100 output token cap", and the obvious reading is to pass it to the provider.
Measured against the operator's own configured query provider (`qwen3.5-hermes` on local
Ollama), same prompt and the same ~1,100-token context every time:

| output ceiling | tokens used | visible answer |
|---|---|---|
| 90 | 90 | *(empty)* |
| 1,024 | 1,024 | *(empty)* |
| **2,000 — the operator's actual query-role setting** | 2,000 | *(empty)* in **6 of 6** repeat trials |
| 4,000 | 3,524 | a correct one-sentence definition |
| 8,192 | 1,487 | a correct one-sentence definition |

The model spends the budget on thinking tokens, which arrive in `reasoning_content` — a
field `openaiCompat.ts` does not read — and never reaches the visible answer. Instruction
wording made no difference: three long-prompt and three short-prompt trials at 2,000 all
returned empty. It is not a prompt problem, it is a budget problem.

**The consequence is sharper than it first looks: the reader's own configured response
ceiling can silently disable a feature.** `max_response_tokens` exists to bound *the answer
a reader reads*; on a reasoning model it bounds thinking instead, and the reader never sees
why. Define now asks for a floor of 8,192 provider tokens and is permitted to, uniquely,
**because it caps the reader-visible answer itself** (<100 tokens, enforced twice: the
stream stops on visible text, then `clampToTokenBudget` trims to a sentence boundary). That
rule is written onto `getProvider`'s override: no caller whose output goes straight to the
reader may use it. ⚠️ The general version of this — every other role and operation is still
exposed to it — is **not** fixed here and is worth a look when reasoning models are next
touched.

**2. The digest rung is the right rung and was the wrong context.** Define originally
reused `buildDigestContext` wholesale. On East of Eden that produced a **107,105-character**
context, of which **96,811** was the three whole surrounding *sections* the rung ships so a
thread can answer "what does this passage mean". Against a 32k-token model the request came
back empty. A definition does not want the pages around the highlight; it wants **the places
the word is actually used**, which `findAllOccurrences` already finds. Same rung (book
digest + chapter digests), different passage component: **107k chars → ~1.1k input tokens**,
and that is where Define is actually made cheap.

**What the fallback costs, stated plainly.** With the headroom floor it answers correctly —
3 of 3 repeat trials on "timshel", each a clean one-sentence definition well inside the
100-token cap — but a reasoning model spends **100–140 seconds** getting there, and the
headroom is *why*: more budget means more thinking before the answer. The reader is not
blocked (the card mounts immediately in its own looking-up state and the page never moves),
but "instant" is the dictionary path only. That asymmetry is the design working as
intended, and it is the strongest argument for why M30 C put the dictionary first.

**The dictionary was the easy half, and the format is why.** WordNet's `index.POS` files are
ASCII-sorted, so a **binary search over the file on disk** answers an exact-headword lookup
in ~20 reads with no in-memory index — 27MB of dataset at zero resident cost. What
`wordnet-db` does *not* ship is the exception lists (`noun.exc`, `verb.exc`), so irregular
inflections ("mice", "went", "geese") miss. That is survivable because a miss is not a
failure — it is the normal path into the fallback — and three extra regular rules
(`ier`/`iest`/`ied` → `y`) recover "happier", "easiest" and "carried", which Morphy itself
only gets from those same missing files.

## M31 A/B — the surface that had to be there and could not be there — 2026-08-27

The bug was one sentence ("you cannot start a highlight near either edge of the page") and
the fix is a contradiction resolved rather than a boundary moved. `.turnGrabSurface` **must**
be a parent-document element — it needs `setPointerCapture`, capture needs a real
parent-document `pointerdown`, and an uncaptured drag crossing the sandboxed epub.js iframe
is a reproduced tab crash (NOTES.md M10). But **nothing in the parent document may hold
pointer events over ink**, because the iframe does not merely receive the press awkwardly —
it never hears it at all. M20 split the difference by making the surface narrow. That is
what put a grab band on top of the first character of every line, and no redivision of the
page fixes it: the surface has to be everywhere the gesture is, and nowhere the text is.

So it steps aside instead, live, on every pointer move. What that took:

**1. `caretRangeAt` answers the wrong question, and answers it confidently.** It snaps to
the nearest caret and never returns null in a margin — a probe 200px out in the outer margin
still resolves to the end of the nearest line. The ink test is one step further (take that
caret, extend one character, `getClientRects()`, is the point inside the box), and it is now
`pointIsOverInk` beside its sibling in `pageTextEdge.ts`.

⚠️ **Probe both directions, not just forward.** A point in the space *between two words* can
snap to the caret **after** the space, whose forward character is the next word's first
glyph — a rect that begins to the right of the point. Forward-only probing calls the
inter-word gap "paper" and turns the page under a reader trying to select in it. The
backward probe is the space's own rect, which contains the point. Both probes are in
`pageTextEdge.test.ts` as separate cases, because only one of them is obvious.

**2. The bound on the ink test is load-bearing, and it is not the iframe.** epub.js lays a
section out in one enormous multi-column iframe and reveals the current page by shifting
that iframe inside an overflow-clipped container. Measured live on East of Eden at a 1400px
window: the iframe's own rect is **17910px wide, starting at x = −3501**. So a point out in
the reader's left margin maps cleanly onto a real glyph in a column nobody can see, and
without clamping the test to `.epubContainer`'s box the single most important piece of paper
on the page reports ink. The clamp is in `pointerOverInkAt`; it is the same trick the audio
auto-turn's visibility check already had to learn.

**3. The surface blocks the mousemove that decides whether it should block.** Armed, it
covers the iframe, so epub.js's forwarded `mousemove` stops arriving and the answer can
never change back. Two handlers, then: the forwarded one for when the surface is standing
aside, and `.stage`'s own `onPointerMove` for when it is not — plus the outer margin, which
is not inside the iframe at all and which neither would cover alone. Neither handler is
redundant.

**4. The answer is frozen for the life of a press,** from either side. A drag-selection held
out past the last word on the page is *over paper*; re-arming a parent-document element
under a live native selection drag is not a thing to discover in the field. M19.6's own
`isPointerDownInContentRef` turns out to be exactly the right guard, unchanged.

### The pinch had to be re-derived, not re-pointed

M31 A5 makes the drag say the direction, so the grab can land anywhere on the paper while
the sheet that peels is always the near leaf for the *declared* direction. Two consequences
that are not obvious from the task text:

- The grab's **x is no longer an input at all** — in leaf coordinates it is frequently
  outside the leaf and sometimes negative (grab the left page's outer margin, drag left, and
  the turning edge is the right leaf's right edge). Only the grab's *height* survives, as
  `anchorForPinch`'s `t`.
- The fold pointer had to stop being the raw grab point. It was fine while the surface hugged
  the turning edge, where the grab already sat on the anchor and the fold's `dist` started
  near zero; a mid-page grab would have started the fold half-turned. It is now
  *anchor + travel* — the pinched corner starts at rest and moves by the pointer's own
  delta. "The sheet follows the finger", literally. For a grab on the edge the two are the
  same point, so nothing about the old case changes.

### Two things this landed that the task did not ask for, and why

- **Reduced motion still turns the page by drag.** The grab surface used to be suppressed
  entirely under `prefers-reduced-motion` (there is no peel to drag) and click-to-turn was
  what those readers actually used. Retiring the click without noticing that would have left
  them the `‹ ›` buttons and the arrow keys and *nothing on the page itself* — the pointer
  contract quietly not applying to them. The gesture is now the same for everyone; only the
  animation drops, which is what `resolveRenderer`'s "instant" already means. Verified live
  under emulated reduced motion: a leftward drag on paper turned 2 → 3, a click did not.
- **The pane-resize handle and the roaming panels moved with the scale.** B1 asked for a
  layer order in one place; leaving four of the numbers outside it would have reproduced the
  exact failure it exists to prevent.

### ⚠️ What this costs touch, until M31 C

The grab surface is `pointer-events: none` by default and JS arms it **only for a mouse or
pen**. Touch has no hover moves to arm it with, so arming for a finger would mean the
surface is armed *by default* — every touch anywhere on the page landing on a
parent-document overlay instead of the text, which is invariant 1 broken for touch exactly
as it was for the mouse.

The concrete loss: on the iPad, a touch-drag on M20's edge ellipse used to start a curl, and
now does nothing. That is a real regression **today** and it is deliberate — the touch table
says a drag *anywhere* turns the page, so the edge ellipse was the wrong affordance for
touch in the first place, and **C1 replaces it with the right one** (24px of horizontal
travel, anywhere on the page). Until C lands, touch page turns are the `‹ ›` buttons.

### Verified live, and what was not

Driven against the running dev server on East of Eden (real drags through CDP mouse events,
real spread mode, a real book — not a mock), on **Linux/Chromium**:

- **The reported bug, at the tightest setting.** With `readerMargin: narrow` the leftmost ink
  on the left page sits at x = 74 — 33px from the container edge, 58px from the stage edge,
  deep inside M20's old ellipse. A drag begun on that character stepped the surface aside
  (`pointer-events: none`) and selected text; the page did not turn. Same at the far edge
  (rightmost ink at x = 1282, dragging *leftward*, i.e. straight through what used to be the
  "next" grab strip).
- **The ink/paper test on a real page**, probed at eight points: mid-line, first character of
  a line, right page near the outer edge → surface aside, no glow. Outer margins, spine
  gutter, below the last line → surface armed, both vignettes at 0.1.
- **Direction from the drag.** From the *same* grab point in the spine gutter: left → 4 → 5,
  right → 5 → 4, straight down → no change.
- **A click never turns**, over ink, over either outer margin, and in the gutter.
- **A live selection disarms the grab** — press-and-drag on the outer margin while holding a
  selection: page unchanged, selection byte-identical afterwards.
- **The M19.6 dwell survives untouched** (invariant 4): a selection dragged from mid-page out
  to the bottom-right corner raised the ring, turned 1 → 2 on the hold, and kept the
  selection.
- **B1, under the adverse condition.** With the surface *actively armed* (`pointer-events:
  auto`, z 7) and the pill at z 8, all seven of the pill's dots hit-test to their own button;
  clicking "key quote" created a real honey highlight on the first attempt (deleted
  afterwards — the book is back to its original 7).
- **B2's premise was correct, not void.** `AskPill` renders as a direct child of `.stage`, so
  `.stage` is its containing block; the numbers were being measured against `.epubContainer`,
  which is inset from it by `.marginWrapper`'s padding. Measured: at `generous` that inset is
  **97px**, so the pill was being drawn 97px up and to the left of the selection, and the
  drift tracked the margin setting exactly as the task's diagnostic predicted. After the fix,
  measured at two different margin settings, the pill's centre sits within **1px** of the
  selection's centre (the stage's own border) with the same 7px gap at both.
- Both renderers exercised mid-drag from a gutter grab — the slide's departing sheet and the
  curl's hinge at the grab's own height — with no console errors and a fold draw cost of
  p90 0.3ms.

**Not verified:** anything on the iPad, and anything in Safari. All of the above is Chromium
on Linux. §0 and C are where the device work lives, and the honest position is that A and B
are *pointer* work verified on a pointer machine.
