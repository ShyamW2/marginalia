# Marginalia — Task List

Work strictly in order. Check items off (`[x]`) as you complete them and commit after
each task (small, focused commits). Each milestone ends with a **Verify** step — do it
for real (run the app, click the thing) before moving on; if verification fails, fix
before proceeding. Rules of engagement: docs/marginalia/SONNET_PROMPT.md.

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
      fully-drawn desk behind an almost-open reading pane, then a blink. It now fades on
      its own clock (`ROOM_FADE_MS` = `HANDOFF_DELAY_MS`, so it is empty at the instant
      the spread reaches the pane and the handoff takes over), through `Scene3D.tsx`'s new
      `useScene3DLayerFade`. Same code path off the shelf, which had the same symptom.
      ⚠️ **Per-layer opacity in three.js is every material under the group**, walked each
      frame — so the as-authored state is recorded *per material* and written back from
      that record. The page block's material is shared across every mounted book; restore
      it by re-traversing a tree that is already unmounting and the next room's books are
      invisible.
      _Acceptance: nothing of the desk or the shelf is left by the time the spread is on
      the pane; Escape mid-landing still lands on a complete, fully-opaque room._
- [x] **A blank spread is two board-sized leaves, like a printed one.** E.1's coplanarity
      fix built the two leaves only when a page snapshot existed, so the book *opened*
      onto the old asymmetry — left page on the board, right page the page block's own
      face, a `pageInset` narrower and a board thickness lower ("it still has a larger
      left page than right"). `Book3D` now draws both leaves whenever the front board is
      past 90°, printed if there is something to print and plain paper otherwise.
      _Acceptance: the two halves are the same size from the moment the cover passes
      edge-on, with or without a snapshot, off either surface._

#### Verify

- [ ] **Operator sign-off across all four surfaces**, in both themes, at two window sizes,
      and with reduced motion on for a full second pass. Specifically: does the desk still
      feel like a place to work rather than a demo, and does the slower opening read as
      deliberate rather than sluggish?
- [x] **Drive the reworked opening from both surfaces** (E.1): desk and shelf, watching
      for the desk holding underneath, the printed spread appearing before the zoom, and
      the left page reading the right way round rather than mirrored.
      ✅ All three, plus Escape at two points and a reduced-motion pass — NOTES.md
      "M23 §E.1 ... Verified live". **The pacing itself is still the operator's call.**
- [ ] **Drive E.2's two corrections** — desk and shelf, watching the room empty *during*
      the zoom rather than at the end of it, and the blank spread's two halves matching
      from the moment the cover passes edge-on. ⚠️ **Not driven by the session that wrote
      them**: they were typechecked and unit-tested only (no browser automation on this
      machine), and the operator's own dev server was already running the change. The
      shared-material restore is the line to watch — leave the opening by Escape, then
      look at the books on the desk you land on.

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

#### A — The find bar in the reader

- [ ] **Cmd+F opens a find field in the reader, and finding never leaves the reader.**
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
      _Acceptance: a query with hits in three different chapters steps through all of them
      in order, forwards and backwards, wrapping at each end; closing the bar leaves zero
      residual marks (assert on the mark count, not by eye); the user's own highlights are
      visually unchanged throughout and still clickable after the bar closes._
- [ ] **The current hit is distinguishable from the others**, in all three reading themes,
      without borrowing any of the four highlight-kind hues — a search hit is not a
      highlight and must not read as one.
      _Acceptance: judged in all three themes; contrast passes over body text in each._
- [ ] **The reader can hand off to the Scan, and never does so on its own.** An explicit
      "see in the Scan" affordance on the find bar opens the Scan carrying the query and
      the current cursor position. **Not the default and not automatic** — the operator was
      explicit: finding a word must not eject you from the page you are reading.
      _Acceptance: the Scan opens with the same query, the same hit count, and the cursor
      on the same hit; no path exists by which typing in the find bar opens the Scan._

#### B — The seam: one search, server-side

- [ ] **One endpoint, one module, one result shape.** `GET /api/resources/:id/search?q=`
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
- [ ] **Precompute the section offsets once per search.** `computeHighlightPositionPercent`
      calls `getResourceTextSections` on *every* invocation, so building the Scan already
      re-reads the whole book once per highlight. Search over hundreds of hits would
      multiply that. Factor the offset table out and pass it in; the Scan build should take
      the same treatment while you are there.
      ⚠️ Read-derived, not profiled — measure before and after rather than trusting this
      paragraph.
      _Acceptance: one search over the Jekyll fixture reads each section's text at most once
      (assert on a counting fake, not a stopwatch); the Scan renders identically after the
      refactor._
- [ ] **Annotations are searched properly now that it is server-side** — full thread
      bodies and full notes, not `threadFirstLine`. This is a real capability change, not a
      refactor: questions you asked are findable for the first time.
      _Acceptance: a phrase appearing only in the third message of a thread is found._
- [ ] **No FTS5 in this milestone.** Brute-force scanning over a single book's sections is
      the boring choice and is expected to be fast enough; measure and record it. FTS5
      arrives with M28, where it is actually needed.
      _Acceptance: a full search over the Jekyll fixture measured and written into NOTES.md
      with the method; if it exceeds ~50ms, say so rather than quietly adding an index._

#### C — The Scan becomes the surface that shows distribution

- [ ] **The search field becomes the Scan's primary control** — large and prominent, in the
      spirit of macOS Spotlight and visually of a piece with the reader's find bar, so the
      two read as one instrument in two places. It searches the book's text as well as your
      annotations (the server does both now), with the source of each hit legible in the
      results.
      _Acceptance: text hits and annotation hits are distinguishable at a glance and both
      step in one ordered set; the existing kind/tag/theme filters still compose with the
      query exactly as they do today._
- [ ] **Results render as a transient layer over the strip, distinct from the persistent
      heat bands.** This is the answer to "show the distribution of search results spatially
      throughout the text" — the layer is the point of the whole surface.
      ⚠️ **The layer rides the same warp wrapper as everything else on the face** (M18,
      "one filter, one wrapper"): a face that bows in some places and not others reads as
      broken. Things that float *above* the glass — the readout — stay flat.
      _Acceptance: at maximum CRT intensity the result layer and the chapter axis bow
      together with no visible seam; the readout does not bow._
- [ ] **`‹ ›` step a cursor through the results inside the Scan, and clicking a band
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
      that was foreseen once and missed once already on this surface.
      _Acceptance: with 20+ hits inside one chapter at default zoom, every hit is reachable
      by stepping alone; the cursor visually coincides with the band it names at maximum
      CRT intensity **and** at the strip's left and right extremes, where displacement is
      largest._
- [ ] **This is the strip's first keyboard path, so make it a real one.** The result cursor
      is focusable and steppable by arrow keys, and announces position ("hit 4 of 17,
      chapter 9") to a screen reader.
      _Acceptance: a full search → step → open cycle completed with the keyboard only, and
      once with a screen reader running._

#### Verify

- [ ] **One phrase, followed the whole way**: found in the reader, stepped through in place,
      handed to the Scan, seen as a distribution, stepped there, opened back into the reader
      at a different hit — with the hit count and ordering identical on both surfaces at
      every step. Both themes, two window sizes, reduced motion on.
- [ ] **The instrument answers the question it could not answer before**: pick a word you
      never highlighted, and confirm the Scan shows where in the book it clusters.

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

- [ ] **A distillation pass gives each book ~6–8 book-level themes**, with the existing
      specific chapter themes kept and folded underneath as children. Specific themes stay
      valuable; they stop being the top-level vocabulary.
      ⚠️ **Distil from the chapter themes and analyses already stored, never from the book
      text again.** This is a small call over material already paid for; a second full-book
      pass would double a digest's cost for a labelling change.
      ⚠️ Settled decision 11 applies: the model returns **names**, code does the rest.
      _Acceptance: on both fixtures the distilled set is 6–8 themes, every chapter theme is
      assigned a parent, and the token cost of the pass is recorded in the ledger and is a
      small fraction of the digest that preceded it._
- [ ] **Each book-level theme owns a phosphor colour**, derived deterministically from its
      position in the book's own distilled set, so a rebuild of the same digest produces the
      same key. The four kind hues stay reserved for kinds — themes need their own ramp.
      _Acceptance: the legend is readable at a glance; rebuilding a digest does not reshuffle
      the colours; theme colours are never confusable with kind colours in either mode._
- [ ] **The canonical vocabulary self-populates across books.** When Book B's distilled
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
- [ ] **The Scan's theme filter becomes the colour key** rather than a dropdown of dozens:
      book-level themes as coloured, toggleable entries, specific themes reachable
      underneath.
      _Acceptance: a book with no digest still shows a coherent Scan (today's fallback
      behaviour is preserved); filtering by a book-level theme lights every child theme's
      highlights._
- [ ] **Verify:** rebuild a digest from scratch and confirm the key is stable; judge on both
      fixtures whether the distilled themes are actually *good* — if they are not, that is a
      prompt problem to solve here, not something to ship and route around.

### M25 — Web search

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

### M26 — Other (Incorporating other LLMs)
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

### M27 — The paper fold, finished (parked 2026-08-03)

**Parked by the operator on 2026-08-03**, immediately after signing off the shipped curl —
"happy to park the remaining M20 refinements for a later stage". Nothing here is undecided
and nothing here blocks anything else; it is the fold's remaining ambition, kept in one place
so it can be picked up cold.

Renumbered to M27 on 2026-08-12 as part of the operator's fixes → 3D → search reordering
(mapping table in decisions.md's 2026-08-12 entry); still parked and still last — the
renumbering doesn't change that.

#### The operator's own ask, and the cheapest thing here

- [ ] **The back of the sheet shows the leaf's real other side, not a mirror of its front.**
      Right leaf curling → the page *after*; left leaf curling → the page *before*. **Read the
      2026-08-03 "sign-off" decisions entry** — the ask is physically exact and adopted as
      stated. The bitmap is already on screen: the drag advances the rendition at grab time,
      so the back of the sheet is the **post-advance card** — its left half for `next`, its
      right half for `prev`, the whole card in single-page mode. No hidden rendition and no
      second epub.js instance.
      **This does not touch `pageFold.ts`'s geometry at all** — the tail keeps `alpha = -1`,
      because a real book's back page *is* mirror-reversed when you fold the sheet toward you.
      Only the sampled bitmap changes. It is also **independent of everything below**, so it
      can be pulled forward on its own if the fold's shape is never revisited.
      ⚠️ **Instrument before deciding the timing.** The second capture costs ~22ms (§5) and
      must land before the first back-facing pixel is drawn, without blocking the grab.
      Measure which frame first exposes back-facing pixels and whether 22ms beats it; if it
      does not, the fold paints today's mirror until the real back arrives, as a designed
      transitional state. Do not guess this.
      ⚠️ **Re-judge the back-of-sheet constants in the harness**, not the app: `SHOW_THROUGH`
      (0.20), `backOfSheet`'s lift and `sheenScale` were all tuned against a mirror. The
      physically honest result is the back's own text *plus* the front's mirrored ghost, which
      is more on that surface than it has ever carried and could read as noise.
      _Acceptance: mid-drag in spread mode the lifted right leaf carries page N+1's text
      (mirror-reversed), not page N's; the same for `prev` and N-1; single-page likewise; all
      three reading themes judged in the harness before the app._

#### The two measurements still owed

- [ ] **The canvas-2D-on-a-real-compositor number.** Still not taken — the step 4 gate closed
      this column for WebGL and could not close it for canvas 2D, because headless Chromium
      composites in software. Open the reader with Curl, **drag** six pages (not arrow keys —
      the guard under-reports a keyboard turn by 7x), paste the `[marginalia] fold draw cost:`
      lines into NOTES.md. Single-page and spread.
- [ ] **Still catch the original stuck-curl trigger** (carried from step 3). The structural
      fixes bound every failure of that shape and the operator now reports it "doesn't really
      get stuck", so this is a loose end rather than a defect. Not reproduced in ~4 held drags
      and ~30 keyboard turns on 2026-08-03.
      _Acceptance: one captured trace of a stuck gesture, in NOTES.md._

#### The low-fps guard, which is a live bug independent of the rest

- [ ] **Move the guard from the median to the p90 of drawn frames**, keeping the ≥12-sample
      floor and the 33ms threshold. **Two independent reasons**: measured, the median of a
      keyboard turn is 0.9ms while its worst frame is 27.8ms and a held drag of the same fold
      is 7.4ms — and the operator reports residual stutter on a Mac the guard reads as 1.1ms.
      The guard cannot currently notice what the operator can see. This is a small change in
      `PageCurl.tsx`'s cleanup plus a test, and it needs none of the WebGL work below.
      _Acceptance: the dev trace on a held drag and on a keyboard turn of the same fold report
      within ~2x of each other, where today they differ by 7x._

#### Over the spine — designed in full 2026-08-03, never started

**Read the 2026-08-03 (step 4) decisions entry first**, then PAGE_CURL.md §2d (the proof that
a spine hinge is a cone and a cone is not expressible in the shipped model), §4 (the resolved
fork and the six things insisted on up front) and §7 (the GPU numbers, and why the low-fps
guard is wrong a second time). The design question is settled: **WebGL is approved.** Nothing
below re-decides it.

Scope, in the order it should be built. (The roll's operator sign-off, which used to gate
this, was given on 2026-08-03; the canvas-2D measurement it was paired with is listed above.)

- [ ] **The geometry grows an apex.** `pageFold.ts`'s pure half gains a cone — apex distance
      along the spine — with the renderer still swapped underneath it. Every existing property
      survives as the far-field (apex-at-infinity) degenerate case, exactly as the bisector
      survived into the roll. ⚠️ **One test changes meaning and must be rewritten, not
      deleted:** "keeps an edge peel's crease parallel to the spine" is false under a hinge,
      where the crease converges on the apex; it becomes a statement about the far-field limit.
      _Acceptance: `pageFold.test.ts` green with the apex pinned at infinity, plus new cases at
      finite apex — the grabbed anchor still lands exactly under the pointer, the leaf is still
      fully covered by progress 1, and the spine edge does not move at any drag depth._
- [ ] **The sheet hinges at the spine, and the spine is the edge opposite the grab.** The
      gutter in spread mode, the card's other edge in single-page — so both modes keep one
      model, which §2d previously assumed they could not. The gutter-side corners cannot curl
      away.
      _Acceptance: at every drag depth and from every anchor, the two corners on the spine edge
      are within a pixel of where they started, in single-page **and** spread._
- [ ] **The WebGL renderer, with the ladder terminating at the slide.** Stage-wide canvas;
      `nearLeafRect` keeps only its "which half of the snapshot is turning" job
      (`leafSourceRect` already separates the concerns, so this part is small); the far leaf is
      live DOM under a transparent canvas and takes the sheet's shadow, drawn by the renderer
      and never composited into the bitmap. **`pageSnapshot.ts` is not touched** (§5).
      ⚠️ **A lost context is a designed state**: `webglcontextlost` degrades to the slide
      through the gesture's *existing* one exit (§9) — the `finally`, the deadline on every
      await, the pointer-capture watchdog, the turn lock's maximum lifetime. It does not get
      its own escape hatch.
      ⚠️ **Price `texImage2D` from the card canvas before designing around it.** It measured
      ~56ms here — larger than the entire snapshot capture — but measured the same on
      SwiftShader, which says it was a CPU pixel path rather than a GPU upload. If it is real
      on the Mac, the upload moves to grab time behind the still-covering snapshot, or the
      texture drops to half resolution.
      _Acceptance: `pageTransition: "slide"` still holds as a ceiling —
      `document.querySelectorAll("canvas").length === 0` sampled every frame through a whole
      turn; reduced motion still renders zero canvases and zero grab surfaces; killing the
      context mid-drag (`WEBGL_lose_context`) springs the page closed and the next keyboard
      turn works._
- [ ] **The new renderer reports the same honest cost unit** as the p90 guard above, or the
      low-fps rung becomes decorative for WebGL exactly as it currently is for canvas 2D.
      _Acceptance: a WebGL turn traces a p90 draw cost over ≥12 drawn frames, same format._
- [ ] **Retire `drawPageFold` once the WebGL path is signed off on the operator's machine**,
      and not before. Until then it is the renderer; after the swap it is the safety net for
      exactly one milestone. The geometry module stays either way.
      _Acceptance: the fold ladder is WebGL → slide, and no second fold painter is left behind._

Deliberately out of scope, per the entry: ask (c) (text squeezing into the curl — a
*projection* problem, not a shape one, and a separate task); the 60-line "perspective on the
tail and roll only" middle option (it buys nothing toward the spine and would be spent inside
a painter being retired); RTL reading direction.

#### Verify

- [ ] **Operator sign-off on the finished fold**, on the Mac, in all three reading themes and
      both page modes — and specifically on the two things the 2026-08-03 sign-off left open:
      is the stutter gone, and does the real back of the sheet read better than the mirror did
      (it is not obviously true — more information on that surface could read as noise).

### M28 — Universal search (the successor to M24, shape only)

Named on 2026-08-14 so M24 can be scoped honestly and so its result shape is chosen with
this in mind. **Not scheduled**, and deliberately after M24.5 — cross-book parallels are
only legible once themes have a shared vocabulary to be parallel *in*.

The operator's ask: *"a universal search where you can search attached Obsidian vaults and
annotations in other books too, to draw parallels."*

- The Obsidian half is **not speculative**. The vault is already a real directory this
  server reads and writes, with concept files carrying names and aliases
  (`server/src/vault/concepts.ts`). It needs an index and a result surface, not an
  integration.
- **This is where FTS5 earns its place** (M24 deliberately does without). Scanning one
  book brute-force is fine; scanning a library is not.
- **It does not belong on the Scan.** The Scan is one book's instrument; a cross-book
  result surface belongs to the Desk. Growing it sideways out of the Scan would re-create
  exactly the "two jobs competing in one surface" problem M24 was raised to fix.
- The gate before anything is built: **what does a cross-book hit open**, and what makes a
  parallel worth surfacing rather than a coincidence of vocabulary?

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
