# Marginalia — Notes

Running log of spec gaps, friction, and blockers found during implementation.
Append; don't rewrite history.

## Spec gaps

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

## M19.5 — digest depth & the semantic scan (in progress) — 2026-07-29

Backend groundwork landed first, in the order the checklist implies: the
plot/thematic split has to exist before briefs or questions can be built on
top of it, and the prompt fix is small and self-contained. Not yet started:
the digest-page/reader UI for briefs and posed questions, spoiler-safe
display, and the scan's second layer — flagged rather than rushed, since
the scan work in particular is its own multi-part effort (canvas rendering,
hit-testing, an extract pass, a shared theme vocabulary) comparable in size
to M18.

- **The split** (`server/src/digest/thematicStore.ts`,
  `thematicBuild.ts`, migration 15). Plot (`chapter_digests`/`book_digests`)
  is untouched — existing digested books keep everything, no re-digest, per
  acceptance. Thematic is new: `resource_briefs` (one editable-in-place
  brief per resource, no history) and `thematic_digests`
  (resource + chapter + **brief hash**, snapshotting the brief's own text
  alongside the hash so "the brief in force" can be shown even after the
  live brief has since changed again). `thematic_runs` mirrors
  `digest_runs`'s pause/resume-on-rate-limit shape but keys resumability on
  `(spineStart, spineEnd, briefHash)` together — resuming under a since-
  changed brief must not silently continue the old brief's run.
- **Independence, proven by test, not just by construction.**
  `thematicBuild.test.ts` asserts the plot provider is never touched by a
  thematic run and the plot row's `generatedAt` never moves — the literal
  "watch the ledger" acceptance criterion, as a test rather than a manual
  check. Re-running under an unchanged brief is a true no-op (call count
  test); changing the brief makes the prior row stale
  (`isThematicStale`, hash comparison) and the next run regenerates exactly
  that chapter with the new brief's text attached.
  Deliberate design call not spelled out in decisions.md: the thematic pass
  reads the chapter's **raw text**, not the plot summary — an intentional
  redundancy that keeps the two calls structurally independent rather than
  chaining one's output into the other's input, which would have made "do
  not build them as one call" true in name only.
  `LLMOperation` (`llm/usage.ts`) gained a fifth tag, `"thematic"`, sitting
  alongside `"digest"` even though both resolve to the `digest` *role* —
  the Usage divider's per-operation breakdown would otherwise blend plot
  and thematic cost into one number, which is exactly the distinction this
  milestone exists to draw.
- **The prompt fix landed as its own small change**
  (`llm/context.ts`'s `READING_COMPANION_INSTRUCTIONS`), not folded into
  the thematic-generation prompt — it governs thread *answers*, a different
  call site. Rewritten to state two postures explicitly rather than one
  blended rule: factual/plot questions stay tightly grounded (unchanged
  behavior), thematic/applied questions get explicit license to reason past
  the page without hedging. Both are asserted by name in the comment above
  it, because the acceptance criterion warns this is "easy to fix one by
  breaking the other" — a blended rewrite would have silently done that.
  `buildDigestContext` (same file) gained an optional `thematicChapters`
  parameter, rendered as a new "THEMATIC READING" block alongside the
  existing chapter-summaries block; `threads.ts`'s `resolveContext` passes
  only chapters whose stored `briefHash` matches the resource's *current*
  brief, so a stale analysis (from a brief the reader has since changed)
  never silently grounds a live answer.
- Not yet live-verified in a browser — no UI exists yet for any of this
  (brief has no editor, thematic analysis has no display, nothing calls the
  new `/thematic` or `/brief` endpoints from the client). The route/store/
  pipeline layer is covered by 6 new automated tests (5 `thematicBuild`,
  1 `context`) plus the existing suite (219 tests total across the
  workspace, all passing) — genuine coverage of the acceptance criteria
  that are data-level, but the UI-facing acceptance criteria for briefs,
  posed questions, spoiler-safety, and the scan's two layers remain open.


  than guessed around.
