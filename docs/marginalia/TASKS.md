# Marginalia — Task List

Work strictly in order. Check items off (`[x]`) as you complete them and commit after
each task (small, focused commits). Each milestone ends with a **Verify** step — do it
for real (run the app, click the thing) before moving on; if verification fails, fix
before proceeding. Rules of engagement: docs/marginalia/SONNET_PROMPT.md.

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
      Two carried forward to M25, neither a defect in this task: **stutter is "less bad", not
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
      ➡️ *Moved to M25, 2026-08-03. Downgraded from blocker to loose end: the operator's
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
      ➡️ *Moved to M25 with the rest of the fold's leftovers, 2026-08-03. Left listed here so
      step 3's record stays complete.*

#### M20 step 4 — over the spine (the WebGL question) — **designed, then parked**

The design is done and settled (decisions.md 2026-08-03 step 4: WebGL is approved, and the
proof that a spine hinge is a cone the 2D model cannot express). **The operator parked the
implementation on 2026-08-03 after signing off the curl**, so it has moved out of M20
wholesale rather than sitting here half-checked.

➡️ **It is now `M25 — The paper fold, finished`, at the end of this file**, together with the
back-of-sheet ask and the two slide leftovers. Nothing was dropped and nothing needs
re-deciding; M25 is directly executable when it is picked up.

**M20 is complete** — signed off on the Mac 2026-08-03. The two unchecked boxes left above
are step 3's leftovers, both moved to M25 and both explicitly non-blocking; they are left in
place so step 3's record reads whole.


### M20.5 — The instrument case (the Scan and the Digest become instruments)

**Next up — M20 is complete and signed off (2026-08-03); its remaining refinements are
parked as M25.** This is an implementation milestone: everything below is decided, and a
Sonnet session executes it without re-deciding any of it.

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

### M24 Other
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

### M25 — The paper fold, finished (parked 2026-08-03)

**Parked by the operator on 2026-08-03**, immediately after signing off the shipped curl —
"happy to park the remaining M20 refinements for a later stage". Nothing here is undecided
and nothing here blocks anything else; it is the fold's remaining ambition, kept in one place
so it can be picked up cold.

Placed at the end deliberately: appending costs nothing, and renumbering M20.5-M24 to make
room would invalidate cross-references in five documents (OPUS.md's rule).

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
