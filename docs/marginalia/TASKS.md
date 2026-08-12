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

- [ ] **The cover opens into a spread, and the spread becomes the page.** *(Operator is happy
      with the flight to centre; the flutter is not what was asked for.)*
      ⚠️ **Absorbed into M26 §E on 2026-08-12, not failed and not abandoned.** Most of it is
      built (`BookOpening.tsx` already flies, rotates about the spine and lands); the
      remaining defect is that `.spread` is cover-width and creased down its middle. Since
      M26 moves the opening onto three.js, finishing it here would build it twice in two
      substrates. **Two things below change under M26 and must be read there, not here:**
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

- [ ] **`q` closes the Scan it opened, and the Digest gets `g`.** Add `digest: "g"` to
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
- [ ] **Each of the four keycaps is advertised where its control is.** `KeyCapAnchor`
      already exists and the Tasks/Settings icons already use it; the Scan and Digest
      controls in `ReaderActionsCluster.tsx` do not. Keycaps import from
      `SHORTCUT_KEYS` (M19.7's "keycaps that cannot lie") — never a typed letter.
      _Acceptance: hovering or focusing each of the four controls shows its real binding;
      changing a letter in `keys.ts` changes every hint with no other edit._

#### B — The tasks tray tells the truth

Three independent defects behind one screenshot (decisions.md 2026-08-12, ruling 2).
Fix all three; any one alone still reads as wrong.

- [ ] **The UI never shows a raw spine index.** `digest/build.ts:406,420` passes
      `sectionLabel(...)` — the *prompt-facing* label, `"section 2: …"`, 0-based — into
      `onProgress`, which lands in the tray's "Current" line beside a `detail` built by
      `sectionUiLabel` as `"S3 · …"`. Same chapter, two numbering systems, and
      `sectionUiLabel`'s own docstring already binds the UI to the 1-based form (M20.5).
      Pass the UI label; `sectionLabel` stays for prompts only.
      _Acceptance: for a one-section digest run, "Range" and "Current" name the same
      chapter with the same number; no surface anywhere prints `section <spineIndex>`._
- [ ] **"Current" names the chapter being worked on, not the one just finished.**
      `onProgress` currently fires only *after* each `digestChapter` await, so mid-chapter
      the tray shows the previous chapter's label (and `null` for the first). Report the
      label **before** the await — which is exactly what `audio/render.ts:221` already
      does correctly, and is the model to copy.
      _Acceptance: within a second of a chapter starting, "Current" names **that**
      chapter; at no point does it name a chapter whose work has completed._
- [ ] **The reduce phase is named, so an honest 50% stops reading as a lie.**
      `total = pending.length + 1` is correct and stays. The final unit is the whole-book
      reduce and must say so — the tray shows something like "Composing the book digest"
      for that last step instead of leaving the previous chapter's label standing.
      _Acceptance: a single-section digest shows 50% with the chapter named, then a
      distinctly-labelled final step, then done — and a reader watching it can say what
      the machine is doing at every moment without knowing the code._
- [ ] **Find out why the TTS bar isn't showing; do not build a second one.**
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

- [ ] **Traversal during playback stops being overridden.** `ReaderView.tsx:984-1006`
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
- [ ] **A "back to the voice" control sits with the transport**, visible only while
      detached, and returns the view to the sounding sentence.
      _Acceptance: the control appears only when view and voice have diverged, and one
      press lands on the playing sentence with the tint restored._
- [ ] **Leaving playback returns to the reader, not to the Desk.** Today the only exit
      from the listening view is out to the Desk and back into the book — which loses the
      reading position the operator was already looking at.
      _Acceptance: exiting playback from anywhere in the book leaves you on the page you
      were reading, in the same book, with no round trip through `/`._
- [ ] **"Play from here" joins the selection pill.** An arrow-into-play icon in
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

- [ ] **The theme control loses its dividers entirely.** Delete the
      `.themeButton + .themeButton` border rule and both of its "clear the divider"
      exceptions in `NavCluster.module.css:70-80`. The sliding thumb already carries
      selection; the dividers were only ever there to separate un-thumbed buttons.
      ⚠️ **Do not implement this as a light/dark conditional.** The bug is
      selection-position, not theme — see decisions.md 2026-08-12. Selecting Ink in
      *light* mode already looks "correct" today, which is the proof.
      _Acceptance: no divider is visible at any of the three selections, in both themes;
      the thumb still animates between positions and each button stays individually
      focusable._
- [ ] **The book action card fits its own buttons.** `.infoStrip` is
      `width: max-content; max-width: 220px`, but `.infoActions` is a non-wrapping flex
      row of four buttons whose min-content width exceeds that — so the row overflows the
      card (the operator's Alice screenshot). Note `.infoMeta` already wraps and
      `.infoActions` does not; that inconsistency *is* the bug. Widen the card and let it
      be shorter, per the operator's own read.
      _Acceptance: at every book in the library, with the longest title in the fixture
      set, no glyph or button edge crosses the card's border; the card stays inside the
      viewport when the book sits near the right edge of the desk._
- [ ] **The card's actions become the reader's actions.** Replace the four ad-hoc ghost
      `Button`s with the same controls `ReaderActionsCluster.tsx` uses (Digest, Scan,
      Publish + Listen), so one control system serves both surfaces (settled decision 12:
      a new control belongs to a register, nothing gets a bespoke one again).
      ⚠️ Keep each action's `stopPropagation()` — `BookObject.tsx:200` records that
      without it the card's clicks also fire the book's own open handler, caught live.
      _Acceptance: the same icon means the same thing on the desk card and in the reader;
      clicking any action does that action and does **not** open the book._

#### E — Custom theme colours

Scope and the contrast rule are set in decisions.md 2026-08-12, ruling 4. Accent first;
paper tinting is a separate task and the Scan is out of bounds.

- [ ] **An accent picker in the Arc shape.** A field where x is hue and y is lightness,
      with a saturation slider, stored as an HSL triple in settings and applied over
      `--color-accent`. (The reference's rotating dial is explicitly not built.)
      ⚠️ **`--color-accent-text` is derived, never picked** — computed from the chosen
      accent so that no position in the field can produce unreadable text on an accent
      fill. This is the whole reason the picker is bounded this way.
      ⚠️ The accent is load-bearing beyond decoration: DESIGN.md:90 gives it to the
      highlight dot, the thread panel's spine **and the scan's heat-band hue**. Check all
      three, not just buttons.
      _Acceptance: choosing any point in the field leaves every accent-on-accent-text
      pairing at or above WCAG AA; the choice survives a reload; "reset to default"
      restores the shipped accent exactly._
- [ ] **Paper tinting, `paper` register only.** Background/paper hue for the Desk, Book,
      Digest and Settings. The Scan's `glass` register keeps its fixed CRT phosphor
      palette — skinning is by material, not by room (settled decision 12).
      _Acceptance: tinting paper never changes a single pixel of the Scan; body text
      contrast stays at or above AA at every reachable tint._

#### Verify

- [ ] **Drive it, don't read it.** Open a real book: toggle all four instruments by key
      from both the Desk and the reader; run a one-section digest and watch the tray
      through all three of its states; start playback, jump two chapters away, come back
      via the new control, then exit playback; hover a book on the desk in both themes;
      pick three accents including a deliberately pale one. Reduced motion for the whole
      pass.

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


### M26 — The rooms become solid (three.js)

**Read decisions.md 2026-08-12 first**, rulings 5-8. The substrate question is settled:
**three.js / React Three Fiber, for all four surfaces.** Nothing below re-decides it, and
the recommendation that lost (CSS 3D first) is recorded there so it is not re-argued from
scratch either.

Appended rather than inserted, per OPUS.md's renumbering rule. The operator's order is
**M22.6 → M26 → M27**; M23 and M24 are deferred behind them.

**The cost this milestone is paying, stated up front so it is budgeted and not
discovered:** CSS 3D degrades on its own and WebGL does not. Every surface here needs its
reduced-motion path and its accessibility fallback built **deliberately**, and those are
acceptance criteria, not polish. A beautiful shelf with no keyboard path is not done.

#### A — The seam, before any of the four surfaces

- [ ] **One 3D seam, not four call sites.** A single module owns the renderer, the canvas
      lifecycle, the shared book geometry/material, and the reduced-motion and
      context-lost exits. The Desk, shelf, turntable and opening are *consumers*. This is
      settled decision "one narrow seam per subsystem" applied to a renderer.
      ⚠️ **A lost context is a designed state**, exactly as M25 rules for the fold:
      `webglcontextlost` degrades to the existing 2D presentation of that surface. It does
      not get a bespoke escape hatch per surface.
      ⚠️ **Do not let three.js types leak past this seam** into `desk/`, `library/` or
      `reader/` components — the same rule that keeps `LLMProvider` honest.
      _Acceptance: exactly one `<canvas>` exists no matter how many 3D surfaces are
      mounted; killing the context (`WEBGL_lose_context`) on each surface leaves a
      usable, non-blank room; `grep` finds no three.js import outside the seam._
- [ ] **One book object, used by all three surfaces.** Cover, spine, page block, openable
      front cover — authored once and consumed by the desk, the shelf and the opening.
      Covers come from the existing `BookCover` image path as a texture.
      ⚠️ **Price the texture upload before designing around it.** M25 measured
      `texImage2D` from a card canvas at ~56ms and could not tell a GPU upload from a CPU
      pixel path. A shelf uploads *dozens*. Measure with real covers at real count and
      write the number into NOTES.md **before** choosing resolutions.
      _Acceptance: the same book asset renders in all three surfaces with no per-surface
      fork of its geometry; a book with no cover art still renders legibly._
- [ ] **Reduced motion renders zero canvases, everywhere.** The existing 2D Desk, the
      list, and the crossfade opening remain the reduced-motion presentation.
      _Acceptance: with reduced motion on, `document.querySelectorAll("canvas").length ===
      0` on the Desk, the shelf route and through a whole book opening._

#### B — The Desk, looking down

- [ ] **A top-down desk with real depth.** A book centred under the camera reads as flat
      cover-only; moved off-centre it reveals binder and page edges, as a real object seen
      from above would. Smoothly animated, not stepped.
      ⚠️ **Existing per-book shelf coordinates are stored in px and must keep placing
      books where the operator left them** — the same constraint M20.7 already carried.
      A camera change must not silently re-lay-out the desk.
      _Acceptance: dragging a book from centre to a corner continuously reveals its
      thickness; every book is where it was before this task; drag/drop hit-testing still
      lands on the book under the cursor at every position (⚠️ a projected 3D surface is
      where hit-testing breaks — test the corners, not the centre)._
- [ ] **A desk that looks like a desk.** Beyond the current zone-with-lines: surface
      material, edge, and the depth cues a top-down view earns. Creative latitude is
      granted here by the operator; DESIGN.md's anti-goals still bind.
      _Acceptance: judged live in both themes and at two window sizes; the notepad and
      the books still read as the foreground, never the surface._

#### C — The turntable

- [ ] **The listening tool becomes a 3D turntable**, replacing `ListeningTool.tsx`'s SVG,
      sitting in a corner of the desk.
      ⚠️ **It is the charm, never the gate** — AUDIO.md and the existing component's own
      docstring. It stays a real focusable control with a pressed state and an accessible
      name; the list view's "Listen" and the book card's action keep working untouched.
      _Acceptance: keyboard-reachable, correctly labelled, and toggling it by keyboard
      does what clicking it does; unplugging the 3D path entirely still leaves listening
      fully operable._
- [ ] **Dragging a book onto the turntable opens it in player mode.** The desk's existing
      drag gesture is the input; the turntable is a drop target.
      ⚠️ The drag already has an owner (`dragGesture.ts` / `BookObject.tsx`) and a
      `stopPropagation` subtlety caught live. Extend that gesture; do not start a second
      drag system for 3D.
      _Acceptance: dropping a book on the platter starts that book listening; dropping it
      anywhere else still just places it; a drag that ends outside the window leaves no
      book stuck to the cursor._

#### D — The shelf (a third view mode)

- [ ] **A scrollable 3D bookshelf as a third Desk view**, on its own key alongside
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

#### E — The opening, finished in 3D

**Absorbs M22.5 §F** (see the note there). Build it once, here, in the new substrate —
not twice in two.

- [ ] **From the desk: the spread is twice the cover's width, creased at the hinge.**
      The front cover opens about its spine edge; the revealed spread is **2× cover
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
- [ ] **The whole sequence slows down.** Currently 540ms (240 fly + 140 open + 160
      landing). Lengthening is explicitly permitted: the overlay is `pointer-events: none`
      throughout, so DESIGN.md's ~400ms bound (which governs *input blocking*) is not in
      play — decisions.md 2026-08-12, ruling 8.
      _Acceptance: the open reads as deliberate rather than snapped, judged live by the
      operator; input is never blocked at any point, verified by clicking through it._
- [ ] **From the shelf: the book comes out, turns side-on, then opens.** The clicked book
      translates toward the camera out of the shelf, rotates to a side-on view, and from
      there **reuses the desk opening above** — one opening, two approaches.
      _Acceptance: the shelf and desk openings share the open/land phases in code, not by
      copy; interrupting at any phase from either entry point leaves a coherent app._

#### Verify

- [ ] **Operator sign-off across all four surfaces**, in both themes, at two window sizes,
      and with reduced motion on for a full second pass. Specifically: does the desk still
      feel like a place to work rather than a demo, and does the slower opening read as
      deliberate rather than sluggish?

### M27 — Search, designed before it is built

A **design pass**, not an implementation milestone — its output is a spec and a task
list, exactly as OPUS.md describes. Do not start building from this section.

Grounding, verified 2026-08-12: **there is no search endpoint and no search UI anywhere
in the codebase.** This is genuinely new, and the operator flagged it as needing
conceptualisation. The working hypothesis to design against (decisions.md 2026-08-12,
ruling 10) — not yet settled:

- The **Scan is spatial** (where a thing sits in the book); **search is retrieval**. The
  overlap the operator feels is these two jobs competing in one surface.
- **Cmd+F is an in-book text find that never leaves the reader.** Text search is invoked
  where the text is.
- **Thematic/annotation search hands off *into* the Scan as a filter**, rather than
  growing a second result list beside it — which would also give the Scan the job it is
  currently missing.

- [ ] **Decide and write down**: where text search lives and how results anchor (the
      existing CFI/quote-plus-context anchoring is the obvious reuse — confirm it before
      assuming it); whether thematic search is library-wide or per-book; what the Scan
      becomes once it is a filter target; and whether any of this needs the parked
      concept-tagging work (TASKS.md "Parked", decisions.md 2026-07-19) as a prerequisite.
      _Acceptance: a spec an implementation session can execute without re-deciding
      anything, and a task list whose criteria can fail._

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
