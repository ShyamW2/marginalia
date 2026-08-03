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
(`e1239b3`) added that field to `ResourceSummarySchema`.

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

## Blockers

- **M19.7 — "Codex CLI as a fourth provider" needs `codex login` first,
  which is the operator's call, not this session's.** `codex-cli 0.114.0`
  is installed (`/snap/bin/codex`), but there is no `~/.codex/` directory at
  all on this machine, confirming the task's own warning: the CLI has never
  been run here. TASKS.md is explicit that confirming this is step one,
  "or this task will be 'started' twice" — and the task's *next* step after
  auth is to run one real call and read the actual JSONL event shape before
  writing any provider code against it (the zod v3/v4 `extract` incident,
  M4, is the standing reason not to guess a remembered API shape here).
  Skipped rather than half-built: a provider written against a guessed
  event shape, with no way to run it, would very likely need rewriting once
  someone actually reads the real output — the exact mistake this task's
  own warning exists to prevent. Every other M19.7 task was independent of
  this one and is done; picking this back up costs nothing once
  `codex login` has been run — start with one `codex exec --json` call
  against a scratch prompt and write the real event shape here before
  touching `server/src/llm/codexCli.ts`.
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
of commit `f4e7b9d` (M0). The session was interrupted mid-task, right before
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

**Before table (2026-08-01, `git log` at `aa4b3fa`):**

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
