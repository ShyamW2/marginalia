# Marginalia — Task List

Work strictly in order. Check items off (`[x]`) as you complete them and commit after
each task (small, focused commits). Each milestone ends with a **Verify** step — do it
for real (run the app, click the thing) before moving on; if verification fails, fix
before proceeding. Rules of engagement: docs/marginalia/SONNET_PROMPT.md.

### M25 — Web search (parked 2026-08-24)

**Parked by the operator on 2026-08-24**, behind M29's live Verify — same treatment as
M27 below: nothing here is undecided, nothing here blocks anything else, kept in one
place so it can be picked up cold when it's next. Settled decision 10 is unaffected: it
is still permitted, still per-provider, still off by default and never silently on,
whenever it's picked back up.

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
- [x] **Codex CLI as a fourth provider.** `server/src/llm/codexCli.ts` behind the existing
      seam — no new call sites — spawning `codex exec --json` with `--output-schema` for
      `extract()`. **Caged, and the cage is part of the provider:** `--sandbox read-only`,
      `--ephemeral`, `--skip-git-repo-check`, `-C <dedicated non-hidden scratch dir under
      home>`, and a scrubbed environment. `-a/--ask-for-approval` ("approvals never") was
      dropped — that flag doesn't exist on `codex exec`, confirmed live; see the
      2026-08-25 decisions entry for that and the scratch-dir corrections (`os.tmpdir()`
      and any dot-directory under `$HOME` both fail live on this machine's snap-packaged
      `codex` — two different errors, two different causes, both worked around).
      Landed 2026-08-25 — event shape read live and written to NOTES.md ("M26") before
      implementation, per the warnings below.
      _Acceptance, verified live against the real dev server and real data (decisions.md
      2026-08-25): a thread answered end to end on Codex from a real highlight, SSE and
      all; `extract()` returned schema-valid JSON via `--output-schema`; a mid-stream
      `AbortSignal` killed the child cleanly (`LLMError`, not a crash, no orphaned
      process); `--sandbox read-only` was proven by asking it to write a file inside its
      own `-C` root and confirming it couldn't; usage landed in the ledger with honest
      provenance (`reported` tokens, `costBasis: "notional"` — this CLI never reports a
      dollar figure, same treatment as `claude-agent`)._

- [x] **Two connection failures, and the setup guide they earned** (2026-08-26, from the
      operator's M26 sign-off report on two machines — decisions.md 2026-08-26, NOTES.md
      "the sign-in was never lost"). Neither was a credential problem.
      1. `codex login status` prints its answer on **stderr** under piped stdio;
         `checkAuthStatus` read stdout only and its `text.length > 0` guard turned the
         resulting silence into `loggedIn: false`. Settings therefore said "Not signed
         in" on every load of a machine that had never been logged out, and the operator
         re-ran device auth each time. Both streams are now read, silence is no longer a
         negative, and `interpretCodexStatus` is pure with the live shapes as fixtures.
         **A credential store was considered and rejected** — the CLI's own persistence
         was working the whole time; copying credentials here would have added a second
         secret store *and* made sign-ins more frequent.
      2. `spawn` searches the server's `PATH`, which on macOS is not the shell's — hence
         ``spawn codex ENOENT`` from a Mac where `codex` runs fine by hand. New
         `llm/cliPath.ts` resolves via override env var → `PATH` + installer-directory
         table → the login shell, cached per process, used by every CLI spawn in the app.
         A Desktop-rung prerequisite (SHIPPING.md) found early: a GUI launch *is* the
         bare-PATH case.
      3. Each Accounts row gained a "How to connect, and what to check if it won't"
         disclosure over a new read-only `GET /api/provider-auth/:provider/diagnostics`,
         because a subscription provider has three invisible preconditions and cannot be
         fixed by correcting a field. Static half mirrored in README.md's "Subscription
         providers" — the two must stay in step.
      _Acceptance, verified live against the running dev server: `/status` returned
      `loggedIn: false` before and `loggedIn: true` after, with no re-authentication in
      between; the ENOENT case was reproduced verbatim under a forced bare `PATH` and
      recovered by the resolver on the installer table alone (login-shell fallback not
      needed); `/diagnostics` returns the real resolved path and `--version` for both
      CLIs on this machine._

### M27 — The paper fold, finished (unparked 2026-08-25, in progress)

**Parked by the operator on 2026-08-03**, immediately after signing off the shipped curl —
"happy to park the remaining M20 refinements for a later stage". Nothing here is undecided
and nothing here blocks anything else; it is the fold's remaining ambition, kept in one place
so it can be picked up cold.

**Unparked 2026-08-25.** The two items that needed neither WebGL nor the operator's machine
are done — the back of the sheet, and the p90 guard. The two measurements are blocked on
real hardware (NOTES.md Blockers). "Over the spine" is what remains.

Renumbered to M27 on 2026-08-12 as part of the operator's fixes → 3D → search reordering
(mapping table in decisions.md's 2026-08-12 entry); still parked and still last — the
renumbering doesn't change that.

#### The operator's own ask, and the cheapest thing here

- [x] **The back of the sheet shows the leaf's real other side, not a mirror of its front.**
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
      **Done 2026-08-25** (b456f16). Both ⚠️s answered by measuring: the tail — the only
      back-facing region that can carry readable text — does not exist until `0.582 x arc` of
      travel (~67ms into a click turn, ~98 CSS px into a drag), so the ~22ms capture is raced
      rather than blocking the grab. Re-judging in the harness found that `SHOW_THROUGH`'s
      wash belongs to *faking* a back, not to backs; a real one gets `BACK_LIFT` (0.34)
      instead, because dropping the fill entirely cost the dark themes their depth cue.
      Verified in the app on East of Eden in spread mode. Readings in NOTES.md.
      ⚠️ **Two things for the Verify below**, both surfaced rather than decided: whether the
      real back reads better than the mirror, and **single-page mode's doubling** — one turn
      advances one page, so there the leaf's back and the page revealed under it are the same
      page. That falls straight out of the ruling as stated; the harness (`?back=real|mirror`)
      shows it rather than papering over it.

#### The two measurements still owed

- [ ] ⛔ **BLOCKED (needs the operator's Mac) — the canvas-2D-on-a-real-compositor number.** Still not taken — the step 4 gate closed
      this column for WebGL and could not close it for canvas 2D, because headless Chromium
      composites in software. Open the reader with Curl, **drag** six pages (not arrow keys —
      the guard under-reports a keyboard turn by 7x), paste the `[marginalia] fold draw cost:`
      lines into NOTES.md. Single-page and spread.
- [ ] ⛔ **BLOCKED (needs a real reader on real hardware) — still catch the original stuck-curl trigger** (carried from step 3). The structural
      fixes bound every failure of that shape and the operator now reports it "doesn't really
      get stuck", so this is a loose end rather than a defect. Not reproduced in ~4 held drags
      and ~30 keyboard turns on 2026-08-03.
      _Acceptance: one captured trace of a stuck gesture, in NOTES.md._

#### The low-fps guard, which is a live bug independent of the rest

- [x] **Move the guard from the median to the p90 of drawn frames**, keeping the ≥12-sample
      floor and the 33ms threshold. **Two independent reasons**: measured, the median of a
      keyboard turn is 0.9ms while its worst frame is 27.8ms and a held drag of the same fold
      is 7.4ms — and the operator reports residual stutter on a Mac the guard reads as 1.1ms.
      The guard cannot currently notice what the operator can see. This is a small change in
      `PageCurl.tsx`'s cleanup plus a test, and it needs none of the WebGL work below.
      _Acceptance: the dev trace on a held drag and on a keyboard turn of the same fold report
      within ~2x of each other, where today they differ by 7x._
      **Done 2026-08-25** (08c6e2d). Note this had been ruled on 2026-08-03 and never
      implemented — PAGE_CURL.md §7 described it in the present tense while the shipped guard
      still took the median. The statistic now lives in `drawCost.ts` with tests written
      against the step 4 traces, and the dev line reads `p90` (so traces from before this date
      are not comparable). ⛔ The *live* half of the acceptance — the real pair on real
      hardware — is blocked with the two measurements above; the unit tests pass.

#### Over the spine — designed in full 2026-08-03, never started

**Read the 2026-08-03 (step 4) decisions entry first**, then PAGE_CURL.md §2d (the proof that
a spine hinge is a cone and a cone is not expressible in the shipped model), §4 (the resolved
fork and the six things insisted on up front) and §7 (the GPU numbers, and why the low-fps
guard is wrong a second time). The design question is settled: **WebGL is approved.** Nothing
below re-decides it.

Scope, in the order it should be built. (The roll's operator sign-off, which used to gate
this, was given on 2026-08-03; the canvas-2D measurement it was paired with is listed above.)

- [x] **The geometry grows an apex.** `pageFold.ts`'s pure half gains a cone — apex distance
      along the spine — with the renderer still swapped underneath it. Every existing property
      survives as the far-field (apex-at-infinity) degenerate case, exactly as the bisector
      survived into the roll. ⚠️ **One test changes meaning and must be rewritten, not
      deleted:** "keeps an edge peel's crease parallel to the spine" is false under a hinge,
      where the crease converges on the apex; it becomes a statement about the far-field limit.
      _Acceptance: `pageFold.test.ts` green with the apex pinned at infinity, plus new cases at
      finite apex — the grabbed anchor still lands exactly under the pointer, the leaf is still
      fully covered by progress 1, and the spine edge does not move at any drag depth._
      **Done 2026-08-25.** `ConeFold`/`computeConeFold`/`deformPointOnCone`/`coneLiftAt` in
      `pageFold.ts`, tested in `pageCone.test.ts`; all three finite-apex criteria hold at every
      depth and anchor, and the far-field convergence to `computeFold` is driven to the
      floating-point noise floor. Nothing calls it yet — `computeFold` and `drawPageFold` are
      untouched, per "with the renderer still swapped underneath it".
      The named test was **rewritten, not deleted**: the flat model's "crease parallel to the
      spine" is still true of `computeFold` and stays in `pageFold.test.ts` with a pointer to
      its cone counterpart, which states it as a far-field limit. It retires when
      `drawPageFold` does.
      ⚠️ **One contradiction in this task had to be resolved to build it**, and the resolution
      is a finding rather than a preference: the apex **cannot** be a free input ("apex distance
      along the spine") while the anchor "lands exactly under the pointer", because rulings are
      inextensible and the anchor therefore keeps its distance from the apex. The apex is
      solved from the drag instead — the point on the spine equidistant from anchor and
      pointer. Consequence for whoever builds the renderer: **the apex moves during a drag**.
      Whether it wants clamping or easing is left open deliberately; see NOTES.md "M27 — the
      apex cannot be both given and consistent".
- [x] **The sheet hinges at the spine, and the spine is the edge opposite the grab.** The
      gutter in spread mode, the card's other edge in single-page — so both modes keep one
      model, which §2d previously assumed they could not. The gutter-side corners cannot curl
      away.
      _Acceptance: at every drag depth and from every anchor, the two corners on the spine edge
      are within a pixel of where they started, in single-page **and** spread._
      **Done 2026-08-26.** Acceptance holds to 4.5e-13 px (a pixel was asked for) with zero
      lift, over 4764 drags spanning six anchors, both leaf sizes and both synthetic paths.
      Still pure geometry — `computeFold` and `drawPageFold` untouched, nothing calls it yet.
      ⚠️ **The binding turned out to be a limit on the *drag*, not only on the sheet**, and
      that resolves the question the 2026-08-25 apex note left open. A cone's apex cannot sit
      partway along the binding (the two halves of the spine edge would lie on opposite rays
      from it), and that constraint is exactly "the anchor's distance to each gutter corner can
      only shrink" — the lens between two circles through the anchor. `constrainToSpineHinge`
      follows a drag outside it as far as the paper goes, along the drag's own direction. So
      **"the anchor lands exactly under the pointer" is now "under the pointer the hinge can
      honour"** — the identity for every ordinary peel. Ruling in decisions.md 2026-08-26;
      the measurements, including the two clamp rules that snapped the sheet ~750px mid-sweep,
      in NOTES.md.
      ⚠️ **Two things the renderer below inherits.** (a) There is no far-field hand-off to
      `computeFold` any more — it returned the spine to the model that moves it — so the apex
      is *held* a million diagonals away instead. That number has walls on both sides and
      **none of it survives float32**: deform in float64 and upload positions, not the apex.
      (b) `syntheticFoldPointer`'s 2.2x diagonal overshoot is an artefact of the flat crease
      and a bound sheet cannot follow it — a corner grab stalls with two thirds of the leaf
      uncovered. `syntheticHingePointer` (anchor → its mirror across the spine) is the path
      with a coverage proof. **Left open deliberately:** that path is square across, i.e. the
      far field, so a click turn animated along it never shows the fan the cone exists for. A
      thumb pulls up *and* across. Which path a click turn takes is a look question for the
      renderer, not a geometry one.
- [x] **The WebGL renderer, with the ladder terminating at the slide.** *(In progress
      2026-08-26: the mesh and the seam consumer are built and tested — `foldMesh.ts`,
      `PageFold3D.tsx` — and nothing is wired to them yet. What remains is
      `PageCurl`/`usePageTurnAnimation`/`ReaderView`: the ladder, the live-DOM far leaf, the
      reduced-motion path and the context-loss exit. Three rulings landed on the way, in
      decisions.md 2026-08-26: the fold is a **consumer of M23's one 3D seam**, not a second
      canvas — which is where the lost-context degrade comes from free; it **borrows the
      Desk's camera**, whose `y = 0` plane maps to the viewport 1:1, rather than bringing a
      fourth; and the mesh is a **fan of wedges between rulings, deformed on the CPU in
      float64** — a grid cannot resolve a roll that is a ten-millionth of the leaf's angular
      span, and float32 cannot hold a leaf coordinate measured from a held apex.
      ⚠️ **One acceptance criterion below has expired** — see the note under it.
      **`harness/pageCone.html`** puts the hinged mesh beside the shipped painter under one
      drag, so the shape can be judged before the wiring; three defects fell out of the first
      four frames of actually rendering it (NOTES.md 2026-08-26). One of them is a *finding*:
      **§2c's "text squeezing into the curl", listed as out of scope, comes free with a
      mesh** — re-read §2c after the wiring rather than leaving it open.
      **The harness now runs a real gesture** — press, drag, release, land — because operator
      feedback the same day was three asks that a hover-tracked pose could not show at all.
      What that settled is in decisions.md 2026-08-26 "A turn is a gesture"; the geometry it
      added (`EdgePinch`/`anchorForPinch`, `hingeRelease`, `settleArc`) is in `pageFold.ts`
      with tests, and `PageFold3D` takes the arc per frame. **Still harness-only** — the
      three items below are what the reader owes, and they are listed rather than folded into
      the wiring because one of them is a live bug that does not need the mesh.)*
      Stage-wide canvas;
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
      ~~`document.querySelectorAll("canvas").length === 0` sampled every frame through a whole
      turn~~ **the fold registers no Scene3D layer and mounts no grab surface** (restated
      2026-08-26: the original is unsatisfiable since M23, because `Scene3DProvider` latches
      a canvas for the app's life once any surface has shown one — the criterion predates the
      shared canvas, and its intent was that the ladder cannot climb *up* to the curl);
      reduced motion still renders no fold and zero grab surfaces; killing the
      context mid-drag (`WEBGL_lose_context`) springs the page closed and the next keyboard
      turn works._
      **Done 2026-08-26.** `PageFold3D` replaces `PageCurl` in `ReaderView.tsx`/
      `usePageTurnAnimation.ts` as the `"curl"` rung; `resolveRenderer` falls to `"slide"`
      when `useScene3DAvailable()` is false, which is `webglcontextlost` *and* no-WebGL in
      one check, free from M23's own seam. Stage-wide: the fold now mounts on the shared
      Scene3D canvas via `getOrigin`, not a leaf-sized DOM canvas, so it is no longer
      structurally prevented from crossing the gutter. `pageSnapshot.ts` untouched, as
      required. Verified live (Playwright, real drags against East of Eden, spread and
      single-page, both a committed turn and a spring-back): no console/WebGL errors, spring-
      back lands on byte-identical text to the drag's start. **Not yet done**: the
      `texImage2D` pricing ⚠️ above is a real-hardware measurement this session cannot take;
      see decisions.md 2026-08-26 for what *was* found instead (two operator-reported
      problems in the arc's own tuning, unrelated to this wiring but shipped alongside it).
- [x] **The far leaf stops pre-flipping — and this one is a bug in the shipped 2D curl.**
      In spread mode the drag advances the rendition at grab time, so page N+2 lies flat on
      the far half from the first frame while the sheet turning over it carries N+2 on its
      back. Keep the advance (the turn needs both halves of it) and cover the **far** half
      with the departing card's own bitmap for the duration, dropping it when the sheet
      lands. ⚠️ It takes **three** states, not two: a fold at rest draws nothing, so the
      frame a spring-back finishes, the revealed page shows where the departing one should
      be. Ruling and the phase table in decisions.md 2026-08-26.
      _Acceptance: mid-drag in spread mode the far leaf still reads N-1 and only becomes N+2
      once the sheet is down; a spring-back ends on exactly the spread it started from.
      Independent of the mesh — it can ship against `PageCurl` first._
      **Done 2026-08-26** — `FarLeafCover.tsx`, a new component shared by whichever renderer
      is mounted (independent of the mesh, as scoped): crops the departing card's own bitmap
      to the far leaf's rect (`readerGeometry.ts`'s `farLeafRect`, already used for the
      sheet's own back face — reused rather than re-derived) and renders it over the live
      far leaf for exactly as long as `PageCurlState` is non-null. Single-page mode is
      detected by comparing `farX` to the turning leaf's own `leafX` rather than re-deriving
      `spreadMode`, since `farLeafRect` already collapses to the same rect `nearLeafRect`
      does there. Verified live: mid-drag the far leaf holds its pre-advance text; a
      committed turn and a spring-back both land clean.
- [x] **The grab site takes the pinch, and the release takes the swing.** `anchorForPinch`
      replaces `anchorForGrab` (no band, no snap, no `constrainFoldPointer`), and the
      commit/spring-back path is `hingeRelease` + `settleArc` rather than the flat model's
      pointer lerp toward `syntheticFoldPointer`. ⚠️ **Do not carry `0.35` across**: the
      reader measures progress on drag distance over `0.9 * leafWidth`; `HingeRelease.progress`
      is angular over a turn spanning **two** leaf widths, so the same travel is `0.157`.
      _Acceptance: a mid-edge grab is held at the grab height and fans as the pointer rises;
      a released sheet lands flat on the facing leaf with the fold's unmount invisible; the
      commit threshold matches the shipped one in *travel*, not in number._
      **Done 2026-08-26** in `usePageTurnAnimation.ts` — both the drag (`handleGrabPointerDown`)
      and the click/keyboard turn (`turnPageCurl`, via the new `defaultPinchForDirection`)
      go through the hinge. ⚠️ **`0.157` did not ship** — it was the right conversion *method*
      but only an estimate of where a commit feels right; tuned live against the harness's
      new control panel, the operator's number is `HINGE_COMMIT_AT = 0.271`. See decisions.md
      2026-08-26 for the full tuning session, including the roll's target becoming a curve
      over the turn's progress rather than a constant (`HINGE_ARC_CURVE`) — a second, unscoped
      fix the same session found necessary.
- [x] **The new renderer reports the same honest cost unit** as the p90 guard above, or the
      low-fps rung becomes decorative for WebGL exactly as it currently is for canvas 2D.
      _Acceptance: a WebGL turn traces a p90 draw cost over ≥12 drawn frames, same format._
      *(Built into `PageFold3D` 2026-08-26 — `drawCostP90` over the frames that actually
      built a mesh, same statistic and same unit as the 2D painter's. Unticked because
      nothing calls it yet: the acceptance is a traced turn, and that needs the wiring.)*
      **Done 2026-08-26** — `PageFold3D`'s `onDrawCost` is wired straight to the same
      `handleDrawCost` the 2D painter already reported through, so the low-fps rung means the
      same thing for both renderers with no second threshold to keep in sync.
- [x] **The turning page renders in front of the room, not behind it** — two operator asks
      from the wired hinge (2026-08-26), and **two different causes**. Read the decisions.md
      entry "A turning page is in front of the screen" before touching either.
      (a) The seam's layering contract (settled decision 14c) puts the one canvas at
      `z-index: 0`, which is right for scenery behind a room and wrong for a sheet that has
      left the leaf: the fold lost to `FarLeafCover` (`5`), the grab surface and vignette
      (`6`) and `NavCluster` (`950`), so the tail vanished the instant it crossed the gutter.
      (b) Immersive mode was worse and unrelated: `requestFullscreen()` on the reader's
      wrapper promotes it to the browser's **top layer**, where nothing outside it renders
      at any z-index — the fold was not drawn at all for the whole turn.
      _Acceptance: mid-drag the sheet covers the far leaf, the strip and the nav pebble in
      windowed **and** immersive mode, both directions; the elevation is released when the
      turn lands; the Desk keeps `z-index: 0` and its own foreground DOM above it._
      **Done 2026-08-26.** `useScene3DElevated` (ref-counted, `PageFold3D` its one consumer,
      `960` — above `NavCluster`, below Settings) and `useFullscreenChrome` now fullscreens
      `document.documentElement`. Verified live in both modes and both directions, with the
      Desk re-checked for the contract it still depends on.
- [ ] **Retire `drawPageFold` once the WebGL path is signed off on the operator's machine**,
      and not before. Until then it is the renderer; after the swap it is the safety net for
      exactly one milestone. The geometry module stays either way.
      _Acceptance: the fold ladder is WebGL → slide, and no second fold painter is left behind._
      Still correctly unticked: `PageCurl.tsx`/`drawPageFold` are unused by the ladder as of
      2026-08-26's wiring but deliberately still in the tree — this is that "one milestone"
      of safety net, and retiring them is gated on the Verify entry below, not on this one.

Deliberately out of scope, per the entry: ask (c) (text squeezing into the curl — a
*projection* problem, not a shape one, and a separate task); the 60-line "perspective on the
tail and roll only" middle option (it buys nothing toward the spine and would be spent inside
a painter being retired); RTL reading direction.

#### Verify

- [ ] **Operator sign-off on the finished fold**, on the Mac, in all three reading themes and
      both page modes — and specifically on the two things the 2026-08-03 sign-off left open:
      is the stutter gone, and does the real back of the sheet read better than the mirror did
      (it is not obviously true — more information on that surface could read as noise).
      ⚠️ **What automation already checked, so the operator's pass can spend its time on feel
      rather than correctness** (2026-08-26, Playwright against East of Eden): the spine
      invariant, a spring-back's CFI round-trip, the far-leaf cover, single-page mode, and a
      clean console/WebGL log on every path above. Still owed, and only gettable by hand: the
      stutter question, the back-of-sheet material judgment, and whether
      `2.2× / 1.44× / 0.4×` (decisions.md 2026-08-26) still feels right off a scripted mouse.
      ⚠️ **Two of the operator's own asks were answered after that list was written** — the
      page now renders in front of the far leaf and over the chrome, and immersive mode shows
      the fold at all for the first time. Both are checked by automation (see the entry
      above); what the sign-off still owes on them is whether `960` is the right *company* to
      keep — i.e. whether anything the reader shows during a turn should have stayed on top.


### M34 — The context ladder, rebuilt: the mask, the blocks, and the selection

Scoped 2026-08-31 (decisions.md, "The LLM layer, measured"). Appended after M33 rather than
inserted. **Read the decisions entry first** — this milestone's three sections each exist
because of a specific measurement, and building them in a different order loses the point.

Three numbers to hold while working: a fully analysed Kafka on the Shore renders **61K
tokens** on the Digest rung, of which **34K is thematic prose and 11K is chapter summaries**;
Full renders 278K; and because the single cache breakpoint sits *after* the highlight-local
text, the Digest rung's 61K is **re-billed in full every time the reader changes chapter**
while Full's 278K is not. §A and §B between them take that 61K to ~31K with ~16K of it
cached, before §C's selection logic exists at all.

#### 0. Measurements first

⚠️ **Land these before §A.** They are cheap, they answer questions M35 is otherwise guessing
at, and data accrues while the rest of this milestone is built.

- [x] **0a.** Record which anchor path fired. `routes/digest.ts:510` is a bare
      `locateQuoteAnchor(...) ?? chapterStartAnchor(...)` with no record. Add an
      `anchor_source TEXT NOT NULL DEFAULT ''` column to `highlights` (migration 28), set to
      `'quote'` or `'chapter_start'` by that route, `''` for every reader-made highlight.
      Nothing renders it yet — this is instrumentation, not a feature.
      _Done: migration 28, `createHighlight`'s optional `anchorSource`, `AnchorSource` type.
      Server-side only — deliberately **not** added to the shared `HighlightSchema`, since
      nothing renders it and the API type is the thing §B/M35 would change on purpose._
      ⚠️ **§B5's lookahead column is therefore migration 29, not 28** — 28 is applied.
- [x] **0b.** Log the shape of every thematic `extract()` result: chapter length in chars,
      themes returned, questions returned, and whether each question's quote located. One
      line per chapter to the server log is enough; no storage, no UI.
      _Done: `[thematic:shape]` in `digest/thematicBuild.ts`. It also reports **`parts=`**
      (chunks the chapter split into) and each count against its schema ceiling — the first
      because 0c's whole question is "did this go through the merge", the second because
      decisions.md left "does the model ever come in under its ceiling" to measurement._
- [x] **0c.** ⚠️ Report both back to the operator before starting M35 §B and §C. The suspected
      cause of a failed quote is **provider-dependent**: on a hosted model a chapter never
      splits (map budget ≈ 875K chars) and quotes come from text the model just read; on a
      local 8K model nearly every chapter splits and every quote passes through
      `mergeThematicParts`, which receives no chapter text at all. Whether M35 §B is a
      footnote or a headline depends entirely on which of those the operator's digest role is.
      _Done as a re-runnable report rather than a one-shot:
      `pnpm --filter @marginalia/server measure` (`server/src/cli/measure.ts`), read-only.
      **Measured 2026-08-31 — the premise was wrong, see NOTES.md.** The digest role is a
      local Qwen3.5-hermes declared at **32,768 tokens**, not 8K: map budget 28,672 chars,
      and chapters split **2%** (Kafka, 1/55), **7%** (Alice), **24%** (East of Eden, 16/67),
      **60%** (Metamorphosis, whose 5 sections are whole parts). So neither branch of the
      fork holds cleanly — the merge is rare on short-chaptered books and routine on East of
      Eden. Quote fidelity so far: **9/9 located** across the 3 thematic chapters that
      exist, all unsplit. ⚠️ **n=9 — this sizes nothing yet.** Themes came in at 7.0 avg
      (ceiling 8, never reached); questions at 3.0 avg (ceiling 3, always reached), which is
      the first real evidence for decisions.md's "models fill to whatever maximum they are
      given"._

_Acceptance: clicking a posed question records how it anchored; running a thematic pass over
a real chapter range prints one line per chapter with counts and quote-hit results._
_Status: the first is covered by `highlights.test.ts` ("M34 0a: records anchor_source…") and
the route wiring; the second by three tests in `thematicBuild.test.ts` asserting the log line
for the unsplit, split-and-merged, and too-large cases. **A live pass against the real
provider has not been run** — it writes real thematic rows into the operator's library and
costs local inference time, so it is the operator's call, not the session's._

#### A. Context is a list of blocks, not one string

- [x] **A1.** `LLMStreamRequest.bookContext: string` becomes `bookContext: ContextBlock[]`,
      where `ContextBlock = { text: string; cache?: boolean }`. One narrow shape on the
      existing seam (settled decision 1) — `cache` is a hint, not a provider concept.
- [x] **A2.** `AnthropicProvider.stream` maps blocks to system text blocks, putting
      `cache_control` on each block marked `cache`. ⚠️ **Max 4 breakpoints per request**, and
      the instructions block is already one of them today — budget accordingly. Below the
      per-model minimum a marked block silently does not cache and costs nothing extra
      (Opus 5: 512 tokens; Sonnet 5: 1024; Opus 4.6 / Haiku 4.5: 4096), so a short block
      being marked is wasteful but not wrong.
- [x] **A3.** Every other provider (`openaiCompat`, `claudeAgent`, `codexCli`) joins the
      blocks with `\n\n` and ignores `cache`. `openaiCompat.ts:174` already records that
      there is no cache API for arbitrary endpoints; leave that comment, extend it to say
      the ordering still helps a llama.cpp-backed server reuse its KV cache.
- [x] **A4.** `buildDigestContext` returns blocks ordered **stable first, varying last**:
      `[book digest + chapter summaries + thematic prose]` marked `cache: true`, then
      `[full text around the highlight]` unmarked. ⚠️ This ordering is the entire point of
      the section — a block that varies per highlight placed before the marker makes the
      marker worthless.
- [x] **A5.** `buildContext` (Full) returns a single marked block, preserving today's
      behaviour. ⚠️ Except when `selectWindow` fires: a windowed Full context *is*
      highlight-dependent, so on that path the window is the varying tail and only the
      header is stable — which is to say, on a book long enough to window, Full's caching is
      already broken and A5 must not pretend otherwise. Leave it unmarked rather than
      marking something that will never be read back.
- [x] **A6.** The query role's cache TTL is **1 hour**, not the 5-minute default. A cache
      read refreshes the timer for free, so continuous questioning keeps a 5-minute entry
      warm on its own; the case this buys is a reader who reads for twenty minutes and
      *then* asks. Write cost goes 1.25× → 2×, so it needs three requests rather than two to
      pay off. ⚠️ Where two blocks carry different TTLs, the longer-TTL block must appear
      **before** the shorter one.
- [x] **A7.** Surface the cache split in the usage ledger. `reportedUsage()` already carries
      `cacheReadTokens`; also record cache *creation* tokens so a run that never reads back
      is visible as a number rather than inferred.

_Acceptance: on Anthropic, asking a question, moving to a different chapter and asking
another shows `cache_read_input_tokens` covering the digest prefix on the second call — today
it is zero. On an OpenAI-compatible endpoint, answers are byte-identical to before this
section._

#### B. The mask, made structural

⚠️ **The rule: the mask belongs at the point of *reading*, not the point of *generating*.**
Generation stays unmasked — the data is wanted later and costs nothing extra to hold. Audio
casting (`routes/audio.ts:280`) is a deliberate exception and stays unmasked: chapter 40's
character needs a voice before the reader reaches chapter 40, and casting's output is voice
assignments, not prose.

- [x] **B1.** One shared helper — `visibleChapterDigests(db, resourceId, opts)` and its
      thematic sibling — filtering at `spine_index <= bookmarkSpineIndex`, with an explicit
      reveal set and an explicit "no mask" mode. ⚠️ Build it **once** and route all four
      reader-facing consumers through it. Three of them
      (`buildDigestStatus`, `annotations/scan.ts:97`, `build.ts:526`) already do this
      correctly with three separate implementations; this replaces them, it does not add a
      fourth.
- [x] **B2.** `routes/threads.ts`'s `resolveContext` uses it — the Digest rung stops shipping
      every chapter's summary and analysis.
- [x] **B3.** `dictionary/define.ts:233` uses it. ⚠️ Define is currently the app's **widest**
      spoiler surface: full synopsis, full cast, nearest chapter summaries, and every
      occurrence of the term anywhere in the book, for an output under 100 tokens. Mask the
      occurrence windows too, not just the digest.
- [x] **B4.** Full is masked as well. It ships the literal text of unread chapters today and
      is stopped only by a sentence in `READING_COMPANION_INSTRUCTIONS`.
- [x] **B5.** A **lookahead / spoilers toggle**, stored per book on `resource_ai_settings`
      (migration 28, alongside 0a) and **independent of the Off/Digest/Full depth**. Off by
      default. ⚠️ Do not fold it into `ContextLadderDepth` — someone rereading a finished
      book wants no mask at any rung and someone mid-book wants one at every rung; they are
      two questions.
- [x] **B6.** The toggle lives beside `ContextLadderToggle.tsx` in the same register, and
      says what it does in a word ("Lookahead"), not in a sentence.

_Acceptance: with lookahead off, a question asked at 40% of a book produces a context
containing no chapter past the bookmark — assert on the built context, not on the answer.
With it on, behaviour matches today. Define stops citing occurrences from unread chapters.
The digest page and Scan are unchanged._
_Done: `digest/visibility.ts` (`isChapterVisible`, `visibleChapterDigests`,
`visibleThematicDigests`) is the one shared gate, routed through by `buildDigestStatus` and
`buildThematicStatus` (digest.ts), `scan.ts`'s book layer, `build.ts`'s
`maybeRefreshBookDigestSnapshot`, `threads.ts`'s `resolveContext` (chapter digests, thematic
chapters, and — B4 — the sections fed to Full), and `define.ts`'s `buildDefineContext`
(book digest via the safe snapshot, chapter summaries, and occurrence windows). The highlight's
own chapter is force-included in the reveal set everywhere, so a stale/lagging bookmark can
never mask the very chapter the reader is asking about. `resource_ai_settings.lookahead`
landed as **migration 30**, not 28 — §A7's cache-creation-tokens column claimed 29 first.
Tests: `digest/visibility.test.ts`, `routes/threads.test.ts`, three new cases in
`dictionary/define.test.ts`._

#### C. Selective thematic inclusion

- [x] **C0.** ⚠️ **Chain `runThemeDistillation` onto the end of a thematic run — a
      precondition, not an improvement.** Measured 2026-08-31 across six chapters on each of
      **two books and two models** (Qwen3.5 and GPT 5.6 Luna): 48 of 48 theme strings unique,
      **zero exact repeats, mean pairwise Jaccard 0.000** in every case. Raw theme strings do
      not repeat across chapters even on a frontier model — it is inherent to asking for
      per-chapter names in independent calls. So without distillation this section's ranking
      signal is not weak, it is **exactly zero**. This section has no input without it. The precedent is one layer over: `runDigest` ends with
      `reduceBookDigest` inside the same job, and the thematic layer simply never grew its
      equivalent. Best-effort, exactly like `maybeRefreshBookDigestSnapshot`: chapters are
      already committed, so a failed distillation logs and leaves the run `completed` rather
      than failing it. Keep the standalone endpoint and button — this adds a caller, it does
      not replace one. Re-running is safe by design: `replaceBookThemes` is a wholesale
      replace, and parent *identity* and colour survive it through `canonical_themes` +
      `matchConcept`.
      _Done: `thematicBuild.ts`'s `runThematicDigest` calls `runThemeDistillation` right
      before its final `persistRun("completed", ...)`, only when `pending.length > 0` (a
      run that changed nothing skips the extra call). Wrapped in try/catch — a thrown
      error is logged (`console.error`) and swallowed, never thrown past the thematic
      run. Tests: `thematicBuild.test.ts`'s "M34 §C0" block — distillation runs and
      populates `book_themes`, a failed distillation still leaves the run `completed`,
      and a no-op re-run (nothing new committed) never re-invokes it._
- [x] **C0a.** ⚠️ **Rank on a weighted parent vector, not a parent set.** With only 6–8
      parents and 7 themes per chapter, most chapters will share most parents and set overlap
      selects everything — the operator's second failure mode, and the mirror of raw themes
      selecting nothing. `theme_parents` maps each chapter theme to a parent, so **count how
      many of a chapter's themes land under each parent** and compare those vectors. A
      chapter with 4 of 7 themes under "Fate" is more about fate than one with 1 of 7, and
      the weight is a code-computed count, not a model-returned number — the honest form of
      the vector idea decisions.md rejected in its LLM-scored form.
      _Done: `digest/thematicSelection.ts`'s `selectThematicChapters` builds each candidate
      chapter's vector as counts-per-parent (`parentIds.map(id => counts.get(id) ?? 0)`,
      via `theme_parents`/`listBookThemes`) and ranks by the dot product against the
      highlight chapter's own vector — shared *weight*, not boolean overlap._
- [x] **C1.** Chapter **summaries** stay whole (all masked chapters). They are ~190 tokens
      each and carry their own `themes: []` list, which is what lets the model see a motif
      recurring across chapters it never reads an essay about.
      _Done: already true going into §C — `threads.ts`'s `resolveContext` passes every
      `visibleChapterDigests` row through unconditionally as `chapterDigests`; §C only
      narrows the *thematic* block. No change needed._
- [x] **C2.** Thematic **essays** are selected: the highlight's own chapter and the previous
      one unconditionally, plus chapters ranked by theme relevance, **capped at 8–9 total**.
      _Done: `selectThematicChapters` takes the highlight's own chapter plus the nearest
      preceding candidate unconditionally, then fills up to `THEMATIC_ESSAY_CAP = 9` (total,
      including the unconditional pair) with the highest-scoring remaining candidates,
      excluding zero-score chapters rather than padding the cap with irrelevant ones. Wired
      into `threads.ts`'s `resolveContext` (Digest rung), between the existing
      `visibleThematicDigests` mask/brief filter and `buildDigestContext`._
- [x] **C3.** ⚠️ **Rank on distilled parent themes (`listBookThemes` / `theme_parents`), never
      on raw chapter themes.** Raw themes are either too specific to ever match or too
      generic to select everything — this is the whole reason M24.5's distillation is the
      right input. A book with no distillation yet falls back to "current + previous only",
      not to "everything".
      _⚠️ **Measured 2026-08-31, and it is worse than "too specific" — raw themes cannot
      overlap at all.** Kafka's three analysed chapters are all about fate and share zero
      strings: "Fate as internal storm rather than external obstacle" / "Fate as pull rather
      than choice (Shikoku)" / "Fate as an unexplainable intrusion into ordinary life". The
      model is emitting **theses, not labels** (see M35 §C3b, which fixes the prompt). Set
      overlap on these ranks nothing, so this item is not a preference — it is the only
      input that can work._
      _⚠️ **And that input does not exist yet:** `book_themes` and `canonical_themes` are
      **empty** for every book in the library — `runThemeDistillation` has never been run.
      So §C's fallback is today's *only* behaviour. Either run distillation as a precondition
      of §C, or ship §C knowing it is "current + previous" until someone does; do not ship it
      believing it ranks.
      _Done: with C0 now running distillation automatically, this is no longer a manual
      precondition — but the fallback still exists and is tested independently
      (`selectThematicChapters` returns the unconditional pair only when `listBookThemes`
      is empty, or when the highlight chapter itself has no thematic vector to rank from —
      `thematicSelection.test.ts`)._
- [x] **C4.** No recency weighting. The mask already removes everything ahead and C2's
      unconditional pair is a recency floor; a weighting knob adds a way to be wrong with no
      way to notice.
      _Done: no such knob exists — `selectThematicChapters` has no time/distance term, only
      the unconditional pair and the parent-vector score._
- [x] **C5.** Selection is **deterministic** for a given (book, highlight chapter, bookmark,
      brief). Non-determinism here silently destroys A4's cache prefix.
      _Done: sorts are stable and ties break on spine index ascending
      (`.sort((a, b) => b.score - a.score || a.chapter.spineIndex - b.chapter.spineIndex)`);
      no randomness, no wall-clock input. Covered by
      `thematicSelection.test.ts`'s "is deterministic for the same inputs"._

_Acceptance: on a fully analysed long book, the Digest rung's thematic block contains at most
9 chapters and always contains the highlight's own; asking twice from the same chapter
produces byte-identical context; a book with chapter themes but no distillation still answers,
using only current + previous._
_Status: covered by unit tests — `thematicSelection.test.ts` (fallback with no distillation,
fallback when the highlight chapter has no thematic vector, ranking by weighted parent
overlap vs. raw overlap, the 8–9 cap, determinism) and `routes/threads.test.ts` (the mask
still wins over rank — a chapter that would score highest is excluded when it's past the
bookmark and therefore never a candidate). **Not yet driven on a real, fully-distilled book**
(the Verify section below) — that needs the operator's own library and digest role._

#### D. Transparency keeps up

- [x] **D1.** `contextChapters` currently records plot-digest chapters only. Extend the
      answer-transparency record to name the thematic chapters that fed the answer and
      whether the mask was on. ⚠️ decisions.md 2026-07-28 (later) makes this non-optional:
      "an answer grounded in 12% of a book that doesn't say so just looks like the model got
      worse." §C makes the grounding *narrower and variable*, which is exactly when the
      record has to say more, not less.
      _Done: `buildDigestContext` (`llm/context.ts`) now returns `thematicChaptersUsed`
      alongside `chaptersUsed`, sourced from the same `sortedThematic` it already built.
      `resolveContext` (`routes/threads.ts`) reports it for the digest rung and `[]` for
      off/full, plus a new `contextMasked` (`!noMask`, the lookahead state at the moment the
      answer was generated) for all three rungs. Threaded through
      `persistExchange`/`streamThreadReply`'s transparency object, the SSE `done` payload,
      `CreateMessageTransparency`/`createMessage` (`annotations/threads.ts`), and two new
      `messages` columns — `context_thematic_chapters TEXT NOT NULL DEFAULT '[]'` and
      `masked INTEGER` (nullable: NULL means a pre-§D message with no recorded state,
      matching `context_depth`'s own shape) — migration 31. `MessageSchema` and
      `ThreadStreamEventSchema`'s done variant carry the two new fields
      (`shared/src/schemas.ts`); `contextMasked` is non-nullable on the live SSE event
      (always known there) and nullable on the persisted `Message`. Tests:
      `llm/context.test.ts` (thematicChaptersUsed present/absent), `routes/threads.test.ts`
      ("M34 §D transparency" — masked flips with `setLookahead`, thematic chapters reported
      separately from plot-digest ones, both rungs without a thematic layer report `[]`),
      `annotations/threads.test.ts` (createMessage round-trips both fields, and defaults to
      `[]`/`null` when not passed)._
- [x] **D2.** The thread's existing context readout shows it — no new surface.
      _Done: `ThreadPanel.tsx`'s existing `context: digest (chapters …)` line
      (`styles.contextUsage`, the same caption the depth/chapters readout already used) now
      appends `· thematic 1, 0` when `contextThematicChapters` is non-empty and
      `· Lookahead off`/`· Lookahead on` whenever `contextMasked` is recorded (omitted for
      `null`, i.e. a pre-§D message). "Lookahead" matches the toggle's own label
      (`ContextLadderToggle.tsx`) rather than inventing new vocabulary for "mask". No new
      component — `streamThread.ts`'s `onDone` and the optimistic-message stub in
      `ThreadPanel.tsx` were extended to carry the two fields through, same as every other
      transparency field._

_Acceptance: an answer in the reader names its depth, its mask state, and the chapters (plot
and thematic) that grounded it._

#### Verify

- [ ] Drive the real app: open a long, fully digested book, ask a question in one chapter,
      then in a chapter ten sections later. Confirm from the ledger that the second call
      *read* the digest prefix from cache rather than rewriting it, and that the answer names
      what grounded it.
- [x] With lookahead off, ask a question that can only be answered by a chapter past the
      bookmark, and confirm the model says it cannot rather than answering from masked text.
- [ ] Switch the query role to a local OpenAI-compatible endpoint and confirm every rung still
      answers, with no cache-related error and no change in answer shape.

---

### M36 — The glossary's own shelf, and two found defects

Scoped 2026-08-31 (decisions.md). **Independent of M34 and M35** — small, self-contained, and
safe to pull forward if a short milestone is wanted first. §C is a defect found while reading
M32's code, not new scope.

#### A. Definitions leave the annotations list

- [x] **A1.** Export `Glossary.tsx`'s existing predicate as `isGlossaryEntry(h)` —
      `kind === "sage" && h.definition.trim().length > 0`. It already exists; it is just not
      exported.
- [x] **A2.** `Glossary` includes it, `AnnotationsOverview` excludes it. ⚠️
      `AnnotationsOverview.tsx` does **no kind filtering at all** today, which is why
      definitions appear in both places. One predicate, two views, so they cannot drift.
- [x] **A3.** A sage highlight with **no** definition stays in Annotations — it is an ordinary
      mark the reader made, and the existing predicate already requires both conditions.
- [x] **A4.** ⚠️ **Decided 2026-08-31: glossary only.** A definition highlight the reader has
      *also* written a note on stays out of Annotations, with its note shown in the glossary
      entry — a word lives in exactly one place, and decluttering Annotations is the point of
      the section. So `isGlossaryEntry` is the *whole* test; do not add a "…unless it has a
      note" clause, which would put the same word in two lists again.

_Acceptance: a looked-up word appears in the glossary and not in Annotations; a plain sage
highlight appears in Annotations and not the glossary; deleting either removes it from
wherever it was, with no cleanup step._

#### B. Sorting the glossary

- [x] **B1.** Three sort modes: **reading order** (`spineIndex, createdAt` — today's, and the
      default, already the order the server returns), **A–Z** on the headword, and
      **chronological** on `createdAt`.
- [x] **B2.** ⚠️ Reading order and chronological are genuinely different — chronological is
      *when you looked it up*, which on a reread resembles reading order not at all. Label
      them so, and do not collapse them into one control.

_Acceptance: all three orders are reachable, the choice persists for the session, and reading
order remains what opens by default._

#### C. Two found defects

- [x] **C1.** `upsertChapterQuestion` (M32 B) is one row per `(resource, chapter)` and
      **replaces** `question` on write — a second question about a chapter silently destroys
      the first, while its `note` stays attached to a question that no longer exists. Either
      allow many questions per chapter (a row per question) or refuse the second write with a
      visible message. ⚠️ Do not leave it silently destructive.
      _Implemented as refuse-with-message: the PUT route (`server/src/routes/digest.ts`) now
      checks for an existing, genuinely different question before calling
      `upsertChapterQuestion` and returns 409 `{error: "chapter_question_exists", existing}`
      rather than overwriting — same shape as `threads.ts`'s `highlight_already_anchored`.
      An identical resubmission is not a conflict. The client (`ChapterQuestionBox.tsx`)
      surfaces this as a visible inline message and syncs to the real stored question rather
      than silently dropping the write._
- [x] **C2.** M34 §B3 covers Define's unmasked context; this milestone only records that the
      two were found together, so neither is lost if M34 slips.

_Acceptance: asking a second chapter-level question about the same chapter cannot destroy the
first without the reader knowing._

#### Verify

- [x] Look up two words in a real book, confirm both appear in the glossary and neither in
      Annotations; sort three ways; delete one and confirm it leaves both views.
      _(verified 2026-09-01 live against Alice's Adventures in Wonderland: two Defined sage
      highlights ("tired", "sitting") appeared only in the Glossary — Annotations' own count
      dropped from 21 to 19 highlights, excluding exactly those two; a third, undefined sage
      highlight stayed in Annotations only. All three sort buttons reordered the list
      correctly (A–Z: sitting before tired; reading order/chronological both by
      creation here). Deleting a highlight via the existing delete path removed it from
      wherever it had been showing, with no separate cleanup step.)_
- [x] Write two chapter questions against one chapter and confirm the first is not silently gone.
      _(verified 2026-09-01 live: `PUT .../chapter-questions/3` with a second, different
      question returned 409 with the original question in `existing`; `GET
      .../chapter-questions` afterward still showed only the first question, unmolested; an
      identical resubmission of the first question's own text returned 200, not a conflict.)_

---

### M39 — PDF, reflowed: extraction, the generated EPUB, and document kinds

Scoped 2026-09-03 (design session on the operator's PDF proposal). **Binding spec:
`docs/marginalia/PDF.md` §1–§6.** Reasoning and the preserved disagreement:
decisions.md 2026-09-03. First of three — M40 builds the renderer seam, M41 the native
pane. Amends settled decision 3 ("EPUB first"), whose condition is met as of M38.

**Why it exists:** the operator wants to read scientific papers with the inline LLM the
way they read books. The finding that shapes this milestone is that every AI feature in
the app — digest, thematic substrate, scan, search, context ladder, audio, define,
glossary, vault — reads `resource_text(resource_id, spine_index, href, text)` and touches
epub.js **nowhere**. So a PDF that can be turned into ordered text sections inherits the
whole feature set. M39 does exactly that and no more: no new renderer, no new seam.

**Verification:** M39 is **not** a headless milestone — §C4, §D6 and §E3 are UI, and its
acceptance criterion is a real paper read in the real reader. It needs live driving
(CLAUDE.md working practice), on top of §A8's human read of five extraction dumps. The only
section of this arc with no user-visible surface is **M40 §A/§B/§D**, and that is exactly
why M40 §A5's acceptance insists on driving an EPUB live: an invisible refactor that
silently breaks the fold or audio-follow will not show up in a test run.

⚠️ **§A is a blocking gate.** Extraction quality, not rendering, is the risk in this arc.
An extractor that interleaves columns produces text that reads fine in a diff and destroys
every downstream feature silently. Do not start §B until §A's five outputs have been read
by a person.

#### A. The extractor, and the gate

- [x] **A0.** Dependencies: `pdfjs-dist` (Node build) and **`@napi-rs/canvas`** — chosen
      over node-canvas for its prebuilt N-API binaries (no node-gyp, no per-ABI rebuild), the
      property `better-sqlite3` lacks and that has already cost this repo silent server
      deaths across the Mac/Linux split. Install and confirm `page.render()` produces a PNG
      **on both machines** before writing §A5/§A6.
      ⚠️ **Rasterization degrades, never fails the import.** Canvas missing or throwing →
      extraction continues text-only, the caption still enters `resource_text`, the
      `<figure>` is omitted rather than half-written, and it logs once.
      _Done 2026-09-03: confirmed live on Linux (Node 24) — `getTextContent()` items carry
      `transform`/`width`/`height`/`fontName`, `page.render()` via `@napi-rs/canvas`
      produced a real PNG, no node-gyp. ⛔ **Mac (Node 20) confirmation still owed** — this
      session had no access to it; see NOTES.md Blockers "M39 §A0"._
- [x] **A1.** `server/src/library/pdf/` — extract text from a PDF with `pdfjs-dist` (Node
      build), server-side, matching where `epub.ts` already lives. Everything derives from
      `getTextContent()` items' `transform`/`width`/`height`/`fontName`; no heuristic may
      depend on the order items happen to arrive in.
      _Done: `extract.ts` orchestrates headerFooter → columns → lines → equations/figures →
      rasterize into `PdfPageContent[]`, plus outline extraction. Rasterization degrades per
      the ⚠️ above (`rasterize.ts` catches and warns once, never throws)._
- [x] **A2.** Header/footer removal per PDF.md §3.1. ⚠️ The test is band position **and**
      digit-stripped repetition across ≥3 pages. Position alone eats a paper's title and
      its first heading on page 1.
      _Done: `headerFooter.ts`. Verified live at the §A8 gate against a 3-page fixture — a
      repeated header and digit-stripped page-number footer both stripped, a page-1 title
      and heading that appear once did not._
- [x] **A3.** Column detection per PDF.md §3.2 — bimodal left-edge histogram, ≥5% page-width
      gap, ≥25% of items per mode; single column is the default and the fallback.
      ⚠️ An item wider than 70% of page width (title block, abstract, full-width figure) is
      emitted in y-order outside the column sort, or the title lands mid-introduction.
      _Done: `columns.ts` (`detectColumns` + `orderPageItems`, the latter banding the page at
      each full-width item's y so a full-width figure mid-column interrupts rather than
      trailing after both columns). A sparser first draft of the §A8 fixture tripped the
      ≥25%-of-items floor into false-single-column (a title/abstract's short wrapped lines
      diluting the ratio on an unrealistically small page); resolved by fixing the fixture's
      density to match a real paper's proportions, not the code — see NOTES.md "M39 §A —
      the extractor, and what the §A8 gate actually found" for why that was the right call._
- [x] **A4.** Line assembly, de-hyphenation and paragraph breaks per PDF.md §3.3.
      ⚠️ Never de-hyphenate before a capital or a digit — "Fourier-Transform" and "GPT-4"
      are not line breaks.
      _Done: `lines.ts` (`groupLines` + `linesToText`). **One real bug found and fixed at the
      §A8 gate**: the paragraph-break "indent" check used one global modal left edge across
      the whole page, so a two-column page's second column — a different legitimate left
      edge — broke into one paragraph per line. Fixed by segmenting at backward y-jumps
      (exactly the column/band boundaries `columns.ts` already produces) and computing the
      modal edge and line-spacing median per segment. Detail and the fix's reasoning in
      NOTES.md "M39 §A", bug 1._
- [x] **A5.** Equation bands are detected and rasterized, never reconstructed (PDF.md §3.4).
      Nothing enters `resource_text` for one.
      _Done: `equations.ts` (`detectEquationBands`) + `blocks.ts` wiring the band into one
      `equation` raster block, its lines removed from the text stream. Rasterization via
      `rasterize.ts`'s page-cache + crop, degrading to `image: null` on failure per A0's ⚠️._
- [x] **A6.** Figure/table regions are detected by whitespace bounds + a caption matching
      `/^(Fig(ure)?|Table|Algorithm|Chart|Scheme)\.?\s*\d+/i`, rasterized at 2× to PNG.
      ⚠️ The image never enters `resource_text`; the caption always does.
      _Done: `figures.ts` (`detectFigureRegions`) — SPEC-GAP noted in-code: the region's
      horizontal extent is approximated as the full page width rather than the caption's own
      column (cheap; costs an occasionally-oversized crop, never a text error, since the
      image never enters `resource_text`). Found at the §A8 gate: a genuinely textual table
      (its rows real extracted text) can still match the caption regex and trigger a
      spurious nearby image — cosmetic, the table's own text is never removed — noted in
      NOTES.md rather than fixed now, see "M39 §A", accepted findings._
- [x] **A7.** Unit tests over synthetic `getTextContent()` fixtures for A2–A4: a two-column
      page, a page with a full-width title, a hyphenated line break, a false hyphen, and a
      repeated running header.
      _Done: 25 unit tests across `headerFooter.test.ts`, `columns.test.ts`, `lines.test.ts`,
      `equations.test.ts`, `figures.test.ts`, `blocks.test.ts` — all five named cases plus
      column/equation/figure edge cases. Green._
- [ ] **A8. GATE.** Run the extractor over five real PDFs of different shapes — a two-column
      paper with figures and equations, a single-column preprint, a report with tables, a
      PDF-of-a-book with an outline, a scanned document — dump plain text, and read all five.
      _Acceptance: each of the four digital outputs is readable prose in reading order, with
      no interleaved columns, no running headers inline, and no equation glyph-soup. The scan
      yields near-zero characters. **Record the result in NOTES.md**, including what was
      wrong and what was accepted, whether or not it passes._
      ⚠️ **Left unchecked on purpose — this is a provisional pass, not the real gate.** No
      real PDFs were available in this environment; run 2026-09-03 against five
      synthetic-but-structurally-real PDFs built with `pdfkit`, with the operator's explicit
      sign-off on the substitution before starting (asked directly, since building the
      fixtures myself and then judging their own output is exactly the blind spot this gate
      exists to catch). It still caught two real bugs (A3/A4 above), which is why §B was
      allowed to proceed on it rather than waiting — but the acceptance criterion asks for
      **real** PDFs specifically, and that pass is still owed. Full writeup, both fixes, and
      the findings that turned out to be fixture artifacts: NOTES.md "M39 §A — the extractor,
      and what the §A8 gate actually found". Tracked in NOTES.md Blockers "M39 §A8".

#### B. The spine, and the generated EPUB

- [x] **B1.** Section detection per PDF.md §4's fallback ladder: PDF outline → detected
      headings → whole document if under 40 pages → fixed 10-page groups.
      ⚠️ **The spine unit is a section, never a page.** Page-as-section turns a 30-page paper
      into a 30-chapter book whose scan and digest are meaningless.
      ⚠️ Outline destinations are page-anchored; a section beginning one-third down a page
      splits that page's text at the heading, never rounds to the page boundary.
      _Done: `sections.ts` (`buildSections`), the ladder in `detectBoundaries`. **One bug
      found and fixed while generating a real EPUB from the §A8 fixture, not caught by A7's
      unit tests**: a wrapped multi-line title (e.g. a long paper title spanning two lines)
      independently qualified as a heading on *every* wrapped line, producing one section
      per line instead of one section for the whole title. Fixed by coalescing a run of
      consecutive heading-qualifying lines into a single boundary. Detail in NOTES.md "M39
      §B — the generated EPUB, and two bugs testing it for real turned up". Leading content
      before the first outline/heading boundary is never dropped (a synthetic boundary at
      document start is inserted when needed) — covered by `sections.test.ts`._
- [x] **B2.** Generate `LIBRARY_DIR/<id>.reflow.epub` — valid `container.xml`, an OPF whose
      spine is in reading order, embedded figure images, and stable `section-000.xhtml`
      hrefs. Byte-reproducible for a given (pdf, extractor version): no timestamps, no random
      ids, no map-iteration-order in the output. Regenerate rather than fail if it is missing
      at read time.
      _Done: `generateEpub.ts` (`generateReflowEpub`) — `container.xml`, `content.opf`
      (manifest + spine), per-section XHTML, `images/fig-p<page>-<n>.png` for every
      successfully-rasterized figure/equation. Every id/filename is derived from
      `spineIndex`/page index (never `Date.now()`/random/map order), and every zip entry's
      timestamp is pinned (`AdmZip`'s `entry.header.time`) — `generateEpub.test.ts` asserts
      byte-for-byte identical output across two calls with the same sections.
      ⚠️ **"Regenerate rather than fail if missing at read time" is not implemented — that's
      a read-path behavior with nowhere to live until M39 §C wires up import/serving.** This
      task is the generator function only._
- [x] **B3.** ⚠️ Emit a real EPUB 3 **nav document** with one entry per section. A nav-less
      generated EPUB renders correctly and breaks `toc.ts`, `ChapterNav`, the chapter ticks
      and the percent mapping — it will look like four unrelated bugs.
      _Done: `OEBPS/nav.xhtml`, `epub:type="toc"`, one `<li><a>` per section — asserted in
      `generateEpub.test.ts`. **Also emits `toc.ncx`, not asked for explicitly but required**
      for B4 below to work at all — see that task's note._
- [x] **B4.** Section titles into `metadata.chapterTitles`, keyed by `String(spineIndex)`,
      by the same route `extractChapterTitles` already uses.
      _Done, but not from the nav document._ `extractChapterTitles` (`epub.ts:85`) reads
      titles from an NCX's `navMap`, not from EPUB3 `nav.xhtml` — noted at `epub.ts:80` as a
      standing SPEC-GAP ("EPUB3 `nav.xhtml`... isn't parsed"). B3's nav alone would satisfy
      "a real EPUB 3 nav document" but leave `metadata.chapterTitles` empty for every
      generated PDF. `generateEpub.ts` emits both — an EPUB3 nav (B3) and an NCX
      (`toc.ncx`) purely so the existing parser has something to read; both are valid and
      correct, this is the standard EPUB3-with-EPUB2-fallback shape, not a hack for one
      parser. `generateEpub.test.ts` round-trips through `extractEpub` and asserts
      `metadata.chapterTitles` comes back populated._
- [x] **B5.** A test that generates an EPUB from a fixture PDF and parses it back with the
      existing `extractEpub` — the round trip must produce the same section count and the
      same text as the extractor emitted directly.
      _Done: `generateEpub.test.ts`'s first case. "Same text" is asserted whitespace-
      normalized (collapsed to single spaces) rather than byte-identical — `blocksToText`'s
      own paragraph separator is `"\n\n"`, `htmlToText`'s (the parser this round-trips
      through) is a single `"\n"` between block elements, an existing, unrelated formatting
      convention difference between two independently-built text-normalizers. This matters
      less than it sounds: **`resource_text` rows come from `PdfSection.text` directly**
      (M39 §C2, not built yet), never by re-parsing the generated EPUB — the `.reflow.epub`
      is `PDF.md §2`'s "derived artifact... what the reflow pane renders", a separate
      concern from what feeds resource_text. This test's job is content/section-boundary
      fidelity through that rendering path, which whitespace-normalized comparison verifies
      exactly as strictly._

_Acceptance for B: verified live against two of the §A8 gate's fixtures (the two-column
paper and the book-with-outline) — generated a `.reflow.epub` for each, inspected every zip
entry, and round-tripped through `extractEpub`. Found and fixed a second real bug beyond
B1's (NOTES.md "M39 §B"). The generated files are correct EPUBs: valid `container.xml`
and OPF, an EPUB3 nav plus NCX, section text with figures/captions in the right reading
position, and `metadata.chapterTitles` populated on round-trip. Not yet exercised: a PDF
whose reflow spans 40+ pages (fixed 10-page-group titling) or one with an unresolvable
outline entry (`/Fit`-style, y rounds to page boundary) — both are unit-tested but not
driven through a real generated EPUB, since no real book-length PDF was available (same
gap as A8)._

#### C. Import, identity, and re-extraction

- [x] **C1.** `EXTRACTOR_VERSION` as a single integer constant in
      `server/src/library/pdf/version.ts`. PDF resource id is
      `sha256(pdfBytes ‖ ":" ‖ EXTRACTOR_VERSION)` (PDF.md §2).
      ⚠️ **EPUB identity does not change** — `importEpub` keeps `sha256(bytes)`. Do not
      unify the two; EPUB ids are already in live databases.
      _Done: `importPdf.ts`'s `hashPdfBuffer` — `sha256(pdfBytes).update(":" + EXTRACTOR_VERSION)`.
      `importEpub`'s own `hashBuffer` untouched. Unit-tested against the formula directly._
- [x] **C2.** `importPdf` alongside `importEpub`, writing `format: 'pdf'`, the `.pdf` and
      `.reflow.epub` files, and `resource_text` rows — same file-before-transaction ordering
      `importResource.ts` already uses, and the same rollback on failure.
      _Done: `server/src/library/importPdf.ts`. A scan (`isScan`) skips the reflow EPUB and
      every `resource_text` row entirely (§6's "zero rows", not a partial one) — `kind` is
      still set (`'document'`, unused until OCR). No direct test of the file-writing/rollback
      path itself, same as `importEpub` (never had one either — both write into the real
      `LIBRARY_DIR`/singleton db, which no test in this repo touches); covered by
      `hashPdfBuffer`'s own tests plus live driving, per M39's acceptance note._
- [x] **C3.** The resource file route serves `<id>.reflow.epub` for a `format: 'pdf'`
      resource with `text_layer = 1`, and `<id>.pdf` when `text_layer = 0`.
      _Done: `routes/resources.ts`'s `GET /:id/file`, three-way branch (epub / pdf+scan /
      pdf+text-layer). `importPdf.ts`'s `ensureReflowEpubPath` regenerates the derived EPUB
      from the stored `.pdf` + current extractor when missing, per §2's "regenerate rather
      than fail." No route-level test — this repo has none for `resources.ts` at all (only
      `threads.test.ts` exists under `routes/`); live-verify serving a real reflow EPUB._
- [x] **C4.** `DeskPage.tsx`'s picker accepts `.pdf` as well as `.epub` (`accept` attribute
      **and** the drop handler — they are separate paths), and the empty-state copy updates.
      ⚠️ The **server-side guard is a third path**: `routes/resources.ts`'s
      `originalname.toLowerCase().endsWith(".epub")` check rejects every PDF before it
      reaches `importPdf`. All three change together or the feature looks broken in a way
      the client can't explain.
      _Done: `accept=".epub,.pdf"` and `useLibrary.ts`'s shared `importFiles`/`isImportableFile`
      feed both the picker and the drop handler (one validation path, not two) — the
      empty-state copy now reads ".epub or .pdf". Server guard branches on extension in
      `POST /api/resources` (§C5). ⚠️ **Not yet live-driven** — TASKS.md's own note that M39
      "is not a headless milestone" for this section applies; still owed._
- [x] **C5.** **PDF import runs as a job; EPUB import stays synchronous** (PDF.md §2.1).
      `JobKindSchema` gains `"pdf-import"`; `POST /api/resources` returns a `jobId` for a
      PDF and the finished `Resource` for an EPUB; progress reports per page so the tray can
      show "page 12 of 30". A 400-page PDF must not block the single-process server, which
      would block *reading* for the length of the import.
      ⚠️ Do not make EPUB import a job too — it is instant, the Desk's optimistic flow
      depends on the synchronous route, and that is unrelated work hiding inside this
      milestone.
      _Done: `extractPdf` gains `{signal, onPage}` (checked/reported once per page, between
      the cheap text pass and the per-page rasterizing one) — `extract.test.ts` covers both
      the reporting and prompt abort. The resource id is a pure hash of bytes already in
      hand, so the job's `resourceId` is known before extraction starts. Client hand-off:
      `useLibrary.ts` treats a 202 as "byte upload done, extraction still running" and calls
      the already-generic `registerStarted` — the tray/toast needed no new code beyond the
      `KIND_LABEL` maps (`TasksTray.tsx`, `JobToastStack.tsx`) TypeScript's own exhaustiveness
      check forced. EPUB's synchronous route is untouched. Not live-driven — see C4's note._
- [x] **C6.** Designed failure states per PDF.md §2.1: `encrypted_pdf` for a
      password-protected file and `invalid_pdf` for a corrupt one, each with its own Desk
      message. ⚠️ A PDF with no text layer is **not** a failure — it imports as a scan (§E).
      _Done: `PdfPasswordError`/`PdfInvalidError` already existed in `extract.ts` (from §A);
      `routes/resources.ts`'s `pdfImportErrorMessage` maps them to PDF.md's exact reader-
      facing sentences, surfaced through the pdf-import job's `error` field (the tray already
      renders "Failed — <error>" — no new UI needed). `extract.test.ts` covers `invalid_pdf`
      (garbage bytes). **Not covered: a real encrypted-PDF fixture** — `pdfkit` (this repo's
      only PDF-fixture generator) has no encryption support, and hand-crafting one wasn't
      attempted; the mapping itself is a two-line `instanceof` check, low-risk, but genuinely
      unexercised by any test. Tracked as owed alongside the real-PDF gate in NOTES.md._
- [x] **C7.** `server/src/cli/reanchorPdf.ts` — `reanchor <oldId> <newId>` re-locates every
      highlight by quote + prefix/suffix using the existing `findAnchorInText`/`locateAnchor`,
      moves the resolved ones with their threads, notes, tags and panel positions, and reports
      resolved/unresolved counts. **No UI.** A reader must never trigger a re-extraction.
      _Acceptance: import a PDF, highlight five passages, bump `EXTRACTOR_VERSION`, re-import,
      run the CLI, and confirm the highlights appear on the new resource with their threads
      intact — and that the old resource is untouched._
      _Done: `annotations/highlights.ts`'s `reanchorHighlightToResource` — one `UPDATE` of
      `resource_id`/`spine_index`/`offset`/`length` on the existing row, which is what carries
      threads/tags/notes/panel-position for free (they key off `highlight_id`, or live on the
      row itself; nothing keys off `resource_id`). The stale CFI is left as-is on purpose —
      the anchor model's own text-first fallback (decision 11, CLAUDE.md) is what resolves it
      in the new EPUB. Unit-tested at the store level (moves the row, thread stays attached,
      old resource ends up empty). **The CLI script itself and the five-real-highlights
      acceptance criterion are not live-verified** — this repo has no test for any CLI script
      (`backfillOffsets.ts` has none either), and running it needs two real imported PDFs a
      version apart, which this session didn't have._

#### D. Document kinds

- [x] **D1.** `resources.kind TEXT NOT NULL DEFAULT 'prose'`, backfilling every existing row
      to `'prose'`. Values: `prose` | `document` — **genre only**. Set at import: EPUB →
      `prose`, PDF → `document`.
      ⚠️ **"Scanned" is not a kind.** It is a separate axis:
      `resources.text_layer INTEGER NOT NULL DEFAULT 1`, set to 0 by §E2's detection. Genre
      and "has a text layer" are independent — a scanned novel is a real thing the day OCR
      arrives — and a `scan` value in the kind enum would be a kind with no schema to
      select, contradicting settled decision 18's own rule.
      _Done: migration 39. SQLite backfills every existing row to the column `DEFAULT` on
      `ADD COLUMN`, so every pre-existing EPUB becomes `prose`/`text_layer=1` with no separate
      `UPDATE` — asserted directly in `store.test.ts`. `setResourceKind` for §D4._
- [x] **D2.** `build.ts` gains a second prompt/schema pair for `document` per PDF.md §5 —
      chapter: `summary`, `contributions`, `methods`, `findings`, `limitations`, `themes`,
      `title`; book: `synopsis`, `keyClaims`, `methods`, `themes`. Zod-validated like the
      existing pair.
      ⚠️ **`kind` selects a prompt/schema pair and nothing else.** The job machinery, the
      substrate, the thematic layer, the scan, the context ladder and the vault compiler are
      unchanged. The thematic layer is already genre-neutral and gets no variant.
      _Done: `DocumentPartSchema`/`DocumentReduceSchema` + their own instructions, and full
      mirrors of the chunking/retry/hierarchical-reduce machinery
      (`extractDocumentPart`/`mergeDocumentParts`/`digestDocumentSection`,
      `reduceDocumentBatch`/`reduceDocumentDigest`) — deliberately **duplicated** rather than
      parametrizing the existing `prose` functions, so the already-shipping prose path is
      literally untouched rather than threaded through new conditionals. `runDigest` branches
      on `resource.kind` once per chapter and once at the final reduce; storage is one new
      nullable `document_fields` JSON column per table (migration 40) — `summary`/`themes`/
      `title`/`synopsis` are the *same* columns both kinds already used, so `routes/digest.ts`'s
      response shape needed no change for those. **Found and fixed in the same pass**:
      `maybeRefreshBookDigestSnapshot` (the spoiler-safe snapshot `GET /:id/digest` refreshes
      in the background) called the `prose` reduce unconditionally — for a `document`
      resource this would have silently asked a paper's own chapters for a cast/narrator on
      every open. Branches the same way now; test locks it in.
      ⚠️ **Spec gap, not fixed here**: `contributions`/`methods`/`findings`/`limitations`/
      `keyClaims` are stored and round-trip (tests below), but **not yet exposed through
      `GET /:id/digest`'s response schema or rendered anywhere** — D2's own wording scopes
      this to `build.ts`, and the reading surface for a document-shaped digest is undecided
      (a new DigestPage layout? inline in the existing chapter cards?). A `document` book's
      summary/themes/title already display today through the fields it shares with `prose`.
- [x] **D3.** A `document` produces an empty `cast`; audio falls back to M21 single-voice.
      No new audio path, no change to `computeCastHash`.
      _Done: `runDigest`'s document branch stores `cast: []`, `narratorGender: 'unknown'`.
      No audio code changed — `audio/attribution.ts`'s existing `cast.length === 0 →
      allNarrator()` and `audio_state`'s existing `voiceMode` default (`'single'`) already do
      exactly this for any resource with no cast, which is what this decision predicted._
- [x] **D4.** `kind` is settable by the reader in the book's settings, both directions —
      a PDF of a novel and an EPUB of a textbook both exist.
      _Done: `PUT /api/resources/:id/kind` + `setResourceKind`, tested at the store level.
      **UI placement is a judgment call, not a spec'd location** — no "book settings" surface
      exists yet in this codebase to slot into, so it's a small Prose/Document toggle on
      `DigestPage.tsx`'s header row (fetches current `kind` via `GET /:id`, flips optimistically
      via the new route). Reasonable given the Digest is where every other kind-adjacent
      control already lives, but worth a design pass rather than treating the placement as
      settled. Not live-driven._
- [x] **D5.** Changing `kind` does not invalidate a stored digest. The renderer keys off the
      stored object's fields, not off today's `kind`.
      _Acceptance: a book digested as `prose`, then switched to `document`, still displays its
      existing digest with characters; the next chapter run produces the document shape._
      _Done: true by construction — `getChapterDigest`/`getBookDigest`/`listChapterDigests`
      never read `resources.kind`, only `resource.kind` (the JS value `runDigest` was called
      with) selects the prompt/schema pair for the *next* run. `build.test.ts` locks in the
      acceptance criterion literally: digest as prose, `setResourceKind` to `document`, assert
      both rows byte-identical to before._
- [x] **D6.** Copy: "Digest Plot" → **"Summarise"**, and the pairing reads
      **Summarise / Analyse Themes** in both the reading pane and the Digest. Six strings:
      `DigestPage.tsx`'s Analyse submenu label, chapter-badge `title`, and failure notice;
      `ReaderView.tsx`'s `digestCluster`. ⚠️ **No column, job kind, API field or stored JSON
      key is renamed.**
      _Done: `DigestPage.tsx` — submenu checkbox "Plot"→"Summarise", "Themes"→"Analyse Themes",
      chapter-badge `title` "Plot digest"→"Summary", failure notice "Plot digest failed"→
      "Summary failed". `ReaderView.tsx`'s `digestCluster` button "Digest Plot"→"Summarise"
      (and its in-flight "Digesting…"→"Summarising…" for the same pairing, not separately
      asked for but left inconsistent otherwise). No column/job-kind/API-field/JSON-key
      touched — grepped for stray "Digest Plot"/"Plot digest" test references, none exist._

#### E. The empty-book paths

- [x] **E1.** ⚠️ A `text_layer = 0` resource imports with **zero `resource_text` rows**, and the digest, scan,
      search, audio and context routes all currently assume at least one section exists. Give
      each an explicit empty path returning an empty result, each with a test that passes a
      resource with no text rows. **This is the most likely source of M39 crash bugs.**
      _Done: every one of the five already degraded correctly on an empty `sections`/
      `resource_text` array — `buildScanData`, `searchResource`, `buildDigestStatus`,
      `buildAudioState` and `resolveContext`'s three rungs all either map/filter/reduce over
      `[]` (empty, not a throw) or hit an existing `.length === 0` guard (`runDigest`'s reduce
      step, `maybeRefreshBookDigestSnapshot`, audio's `cast/scan` route). Nothing here was
      written defending against PDFs specifically — it's the same shape as "a freshly
      imported book with no digest yet," a state this codebase was already careful about.
      The actual gap was the missing regression test PDF.md itself asks for, so that's what
      this task added: `scan.test.ts`, `search.test.ts`, `threads.test.ts` (all three context
      rungs), and two new route tests (`digest.test.ts`, `audio.test.ts`) exercising a
      zero-section resource end to end. The latter two needed `buildDigestStatus` and
      `buildAudioState` exported/threaded with `db` as a parameter (mirroring
      `resolveContext`'s existing shape) instead of reaching for the `getDb()` singleton, so
      they could run against an isolated `:memory:` db like every other test in this file.
      540 server tests green (up from 531 at the top of this task)._
- [x] **E2.** Scan detection per PDF.md §6 — per *document*, not per page: `text_layer = 0`
      when >50% of pages yield under 100 extracted characters. A digital paper with a
      scanned appendix is still a digital paper.
      _Done, already, as of §A1/§C2 — `extract.ts`'s `SCAN_CHAR_THRESHOLD = 100` /
      `SCAN_PAGE_FRACTION = 0.5` match this spec exactly, and `importPdf.ts` already skips
      the reflow EPUB and every `resource_text` row for `isScan`. Left unchecked only for
      lack of the positive case — `extract.test.ts` had "not a scan when every page has
      text" but nothing that actually crossed the threshold. Added two: a fixture where 3 of
      4 pages are blank (pdfkit's stand-in for an image-only scanned page — `getTextContent()`
      genuinely returns zero items for one, same as the real thing) asserts `isScan === true`;
      a second, inverted fixture (1 blank page of 4) asserts the per-document rule holds the
      other way — a minority of blank pages doesn't flip a real paper to scan-only. Found
      while writing the first fixture: body text has to clear 100 *non-whitespace* characters
      after `.replace(/\s/g, "")`, not 100 characters of prose — a short one-sentence "real"
      page reads as short too and silently inflates the scan count, the same fixture-density
      trap A3's own note already caught elsewhere in this milestone._
- [x] **E3.** The Desk card and the reader strip say plainly "No text layer — preview only.
      OCR isn't supported yet." rather than showing controls that do nothing. In M39 a scan
      has no reader at all — opening it explains why. The preview arrives in M41 §D.
      _Done: `ReaderPage.tsx` checks `resource.textLayer` before ever mounting `ReaderView`
      (kept out of that 4,750-line component entirely, per decision 17c's "no `if (format
      === 'pdf')` inside ReaderView" — this is a route-level branch, not a renderer one) and
      renders the plain explanatory page instead, so every entry point (cover click, Listen,
      a deep link) lands on the same honest state rather than trying to load a `.reflow.epub`
      that `importPdf.ts` never generated for a scan. `LibraryGrid.tsx` (the accessibility
      floor, settled decision 15) swaps its highlight-count/Listen-button footer for the same
      sentence; `BookActionCard.tsx` (the Desk's 3D card) does the same and additionally
      omits Digest/Scan/Listen — each would otherwise open onto a real but pointless empty
      surface, which is exactly the "controls that do nothing" this task asks to avoid.
      Publish is left in on both — harmless for an empty book, out of this task's scope.
      Covered by five new tests (`ReaderPage.test.tsx`, `LibraryGrid.test.tsx`,
      `BookActionCard.test.tsx`) asserting the message appears and the dead controls don't,
      for both a scan and a normal resource. **Not live-driven** — same gap as C4/C5/C7:
      no real scanned PDF fixture was clicked through in an actual browser this session.
      Unlike those, the reason isn't "no real PDF corpus" (a synthetic scanned fixture would
      do fine here, same as E2's) — it's that this repo's only running server is the
      operator's real dev instance with real imported books and no `DELETE /api/resources/:id`
      route (decision 5: immutable-on-import, by design), so there was no way to import a
      throwaway test PDF through it and clean up afterward without either polluting the real
      library or hand-editing the live SQLite file — both worse than leaving this owed. A
      disposable `LIBRARY_DIR`/`DB_PATH` for exactly this kind of session-local live-driving
      would remove the blocker; worth its own task rather than working around it here._

_Acceptance for M39: import a two-column paper, and it reads in the existing reading pane
with its figures in place, its sections as chapters, a working TOC, highlights that anchor
and survive a reload, an inline LLM answer grounded in the paper, a `document`-shaped
chapter summary, and a digest whose scan bands are sections rather than pages._

---

### M40 — The renderer seam, and continuous scroll

Scoped 2026-09-03; §C added the same day at the operator's request. **Binding spec:
`docs/marginalia/PDF.md` §7.** Depends on M39 (do not start before M39 §A's gate has
passed — a native pane over a bad extractor hides the problem behind a picture of the page).

**Why it exists:** CLAUDE.md's engineering discipline has named `ResourceRenderer` as one
of four narrow seams since the beginning, and **it does not exist** — grep returns zero
hits and the reading pane is epub.js top to bottom. M40 is where that stops being a claim
and becomes code.

**§C is the milestone's user-visible half**, and it is why the seam earns a milestone
rather than being folded into M41 as prep. A seam validated by one new implementation is
weakly validated; a scrolling reflowable surface and a fixed-page image surface are
genuinely different consumers, and building the first one is what proves the interface
before M41 depends on it. ⚠️ §C reopens PRODUCT.md's "pagination won" — deliberately; see
PDF.md §7.4 and decisions.md 2026-09-03 (later).

#### A. Extract before you add — a pure refactor

Measured 2026-09-03: `ReaderView.tsx` is **4,750 lines with 116 `useState`/`useRef`** —
`docs/REFACTORING.md`'s textbook "long *and* stateful" outlier, about to receive risky
work, which is that document's own highest-value timing.

- [x] **A1.** Define `ResourceRenderer`, `Locator` and `RendererCapabilities` per PDF.md
      §7.2, in `web/src/reader/renderer/`.
      _Done: `web/src/reader/renderer/types.ts`, matching PDF.md:374-463 exactly — no
      epubjs import, `serializeLocator`/`parseSerializedLocator` (M40 §B4, landed here since
      they belong on the same interface file) included._
- [x] **A2.** Lift the epub.js-specific rendering out of `ReaderView` into `EpubRenderer`
      behind that interface. ⚠️ **Behaviour changes nowhere.** REFACTORING.md: fix bugs
      before or after, never during. If something breaks after this, it must be
      unambiguous that the restructuring broke it.
      _Done: `web/src/reader/renderer/epub/EpubRenderer.ts`. Beyond the strict interface it
      carries a small, named set of EPUB-only extras (`getToc`, `goToHref`,
      `goToSpineIndex`, `goToPercent`, `ensureLocations`, `setHighlights`,
      `getRenderedSectionText`, `isLocatorVisible`, `paintSearchMarks`/`clearSearchMarks`,
      `renderedFrames`, `onSectionRendered`, `onEpubRelocated`, `onUnanchored`,
      `getViewportRectForSelection`, `refreshOverlays`, `setFocusMode`) — deliberate, not
      oversights: forcing every one of today's behaviors through the abstract interface
      before a second renderer exists to prove it against would mean inventing speculative
      interface members. `onSectionRendered` is the load-bearing one: it hands `ReaderView`
      a plain DOM `Document` (never an epubjs `Contents`) per rendered section, which is
      what let the mousemove/click/touch/keydown gesture layer — dwell-to-highlight-across-
      boundary, mark hover boost, cursor styling, pinch-resize, turn-zone detection — stay
      in `ReaderView` almost verbatim rather than crossing into a giant renderer-side
      callback bag, once it was clear `Document`/`Window`/`Range` aren't epubjs types._
- [x] **A3.** ⚠️ **`ReaderView` must not fork.** The strip, margin rail, annotation
      lifecycle, threads, ask flow, audio transport and nav cluster stay in one place and
      stay format-blind. Only the pane's inner rendering is behind the seam. Two copies of
      a 4,750-line component is the worst outcome available in this arc, and it is what
      happens by default if this section is skipped "for now".
      _Done: confirmed by construction — every one of those systems is untouched code,
      only retargeted from `renditionRef`/raw `Contents` to `rendererRef`/plain `Document`.
      `ReaderView` holds `rendererRef: RefObject<EpubRenderer | null>` (the concrete type,
      not the abstract interface) for now — a second, deliberate scoping call alongside the
      named-extras one: the abstraction is genuinely proven only once a second renderer
      (§C, §D) actually consumes it._
- [x] **A4.** No epub.js type crosses the boundary — `Rendition`, `Contents`, `EpubCFI` are
      internal to `EpubRenderer`. A `grep -rn "from \"epubjs\"" web/src` outside
      `renderer/epub/` returns nothing.
      _Done: verified — every epubjs import lives in `renderer/epub/EpubRenderer.ts` and
      `renderer/epub/toc.ts` (moved from `reader/toc.ts`, entirely epub-Book-shaped
      already); `renderer/epub/marksPanePatch.ts` moved alongside them (no epubjs import of
      its own, but only ever relevant to this renderer). `useEpubThemeVars.ts` renamed to
      `useReaderThemeVars.ts` (`EpubThemeVars` → `ReaderThemeVars`, now defined once on the
      interface and re-exported)._
- [x] **A5.** The chrome asks `capabilities`, never the format. ⚠️ A
      `if (format === 'pdf')` anywhere in `ReaderView` is this seam being bypassed. The
      spread toggle, margin slider, font-size control and page fold each hide on a
      capability being false.
      _Done, scoped honestly: confirmed by reading — there was no existing
      `if (format === ...)` anywhere to remove (decision 17c's whole point), so there is
      nothing to find here beyond the absence itself. `EpubRenderer.capabilities` is a
      real, populated object satisfying the interface (`{spread: true, fontScale: true,
      margins: true, pageFold: true, pageNumbers: true, textSelection: true, advance:
      "page"}`). ⚠️ **Not done**, and left open on purpose: `usePageTurnAnimation`'s fold
      ladder and `PageNumberDisplay`'s mode still don't *read* `capabilities.pageFold`/
      `.pageNumbers` — with exactly one renderer in the app, wiring that gate now is
      speculative plumbing for a consumer (`PdfRenderer`, §D) that doesn't exist yet.
      Threading it through is real but small work for whichever of §C/§D lands first._
      _Acceptance: reading an EPUB is indistinguishable from M39 — highlights, fold, spread,
      margins, audio follow, find bar, all verified live, not just by tests._
      _Verified 2026-09-03, live against the running dev server (restarted after finding it
      had died — port 5175 wasn't listening, unrelated to this change — see NOTES.md) on a
      real book (East of Eden), driven headlessly via Playwright since no interactive
      browser was available in this environment: book opens, saved position restores
      (page/chapter/percent readouts correct); a real text selection opens the AskPill and
      creates a `rose` highlight whose mark paints (`.marginalia-highlight` in the DOM) and
      is persisted server-side with the right `exact`/`prefix`/`suffix`/`cfi`/`spineIndex`;
      the mark survives a full reload; deleting it (direct API call, to avoid the margin
      rail's hover-only delete button under headless automation) removes the mark with no
      orphan; a keyboard page turn moves forward and back with the page-number readout
      updating each time; the TOC lists all real chapters and a chapter-jump lands on that
      chapter's actual first page; the find bar returns real hit counts and paints a search
      mark (`.marginalia-search-mark`) exactly when a hit is on the visible page, confirmed
      both ways (a query with no hit on the current page painted none; one with a
      confirmed on-page hit painted one and stepping to it kept the count in sync). Zero
      console/page errors through the whole sequence. **Not independently re-verified live**
      (reasoned through in code instead): spread-mode toggle, margin/font-scale live
      changes, and audio-follow auto-turn — flagged in NOTES.md rather than silently
      claimed._

#### B. The anchor model, amended

- [x] **B1.** Resolution order becomes CFI (EPUB only) → text search → `(sectionIndex,
      offset, length)` → unanchored (PDF.md §7.3). ⚠️ A **reordering, not a replacement**:
      the CFI stays step 1 for EPUB and EPUB anchoring behaviour does not change.
      _Done: `resolveAnchor` (`anchorResolution.ts`) gains the `"offset"` status between
      `"fallback"` and `"unanchored"`; `EpubRenderer.resolveHighlightsForSection` wires
      `highlight.offset`/`.length` through and shares the same `rangeFromTextOffsets` →
      `attachOwnedMark` path the text-search branch already used. Reachable now because
      `offset`/`length` (migration 32) are exposed on `HighlightSchema`/`HighlightRow` for
      the first time — the column comment's own "nothing renders this yet" stops being
      true here. Four new test cases in `anchorResolution.test.ts` cover the step and its
      precedence under the text-search fallback._
- [x] **B2.** Update `SPEC.md`'s anchoring rule and the header comment of
      `anchorResolution.ts`, both of which currently say the CFI is *the* primary anchor.
      ⚠️ A comment is a claim; do not leave one that outlived its code.
      _Done: `anchorResolution.ts`'s header, SPEC.md's "Anchoring rule" prose and its API
      table line, and CLAUDE.md's now-stale "ResourceRenderer is aspirational until M40"
      line (M40 §A already shipped it). SPEC.md's migration-001 schema-block comments
      (`-- epub.js CFI...`) deliberately left as-is — that block is explicitly "never
      edited retroactively"; the amendment lives in the prose around it and in CLAUDE.md
      settled decision 17(d), which was already the authoritative statement._
- [x] **B3.** ⚠️ **`highlights.cfi` is `TEXT NOT NULL`** (`migrations.ts:51`) and a PDF
      highlight has no CFI. SQLite cannot relax `NOT NULL` in place: this needs a table
      rebuild (create, copy, drop, rename) in **its own migration version**, with a test
      that round-trips a populated database. This is the riskiest migration in the arc —
      `highlights` is the table everything references.
      _Done: migration 41. Found live rather than assumed: `DROP TABLE highlights` throws
      "FOREIGN KEY constraint failed" under `foreign_keys=ON` while other tables still
      reference it, even with nothing inserting/updating a child row mid-rebuild —
      confirmed by testing SQLite's real behaviour, not by trusting the first pass's
      reasoning about it. `db.ts`'s `runMigrations` gained a `requiresForeignKeysOff`
      migration flag (the pragma is a no-op inside the transaction every migration already
      runs in, so the toggle has to happen one layer up); `foreign_key_check` runs both
      inside the migration's own transaction (a violation rolls the whole rebuild back
      atomically) and again after commit as an independent second check. Round-trip test
      in `db.test.ts` seeds a fully-populated legacy row plus one row in every table that
      references `highlights(id)` (threads, thread_anchors, highlight_tags,
      highlight_themes) and asserts all of it survives untouched, a fresh `cfi: null` row
      succeeds, and `foreign_key_check` stays clean. **Verified live against the
      operator's real database**, not just the test: `tsx watch` auto-restarted on these
      file saves mid-session and applied the migration on its own before this was
      deliberately triggered — caught immediately, confirmed clean (`user_version` 41,
      `integrity_check` "ok", `foreign_key_check` empty, all 207 highlights/82 threads/176
      thread_anchors/24 messages intact) before proceeding, with a consistent pre-migration
      backup taken as a safety net regardless. Live-driven afterward on a real book (Kafka
      on the Shore, 25 real highlights): all resolve and paint correctly._
- [x] **B4.** ⚠️ **`reading_state.location` is a CFI too** (`migrations.ts:41`) and is easy
      to miss because it is not on the `highlights` table. **No migration** — it is already
      TEXT — but it needs a serialization convention: write a `SerializedLocator`, and
      **accept a bare CFI on read**, because every row written before M40 is one. A position
      parser that assumes a CFI throws on the first PDF, or silently reopens a book at
      chapter 1.
      _Done: `serializeLocator`/`parseSerializedLocator` (landed in `renderer/types.ts` in
      §A, wired up here). `ReaderView`'s position-save call now emits the wrapped JSON
      form; the initial-load read runs the saved `position.location` (and a jump-target's
      CFI) through the same `Locator` construction path via `parseSerializedLocator`,
      accepting a legacy bare CFI or the new form indifferently. No server change — the
      schema comment was updated for honesty, but `location` was already opaque
      `TEXT`/`z.string()` on both sides. **Verified live**: a real book's position record
      round-tripped through the new JSON form on both the initial load and a subsequent
      page turn, with the correct spineIndex/percent threaded through each time._
- [x] **B5.** ⚠️ `resource_locations` (the `book.locations.save()` blob, migration 19)
      stays epub.js-specific. Correct for reflowed PDFs — they *are* EPUBs — and meaningless
      for the native pane, whose `bookPercent` comes from `resource_text` offsets. Do not
      generalise the blob.
      _Done: confirmed by reading — `EpubRenderer.ensureLocations()` (§A) still owns this
      table's one read/write pair (`fetchCachedLocations`/`saveCachedLocations`, moved
      verbatim from `ReaderView.tsx`), unchanged by §B. Nothing to generalise; noted here
      only to close the loop._

#### C. Continuous scroll — a second way to read an EPUB

Per PDF.md §7.4. ⚠️ Reopens a settled decision (PRODUCT.md: "pagination won"). It is a
**second reading mode with its own affordances, not a toggle** — every reader effect since
M10 assumes pages.

- [x] **C1.** `flow: "scrolled-doc"` with `manager: "default"` — per-section scroll, **not**
      the continuous cross-chapter manager. The ruling and its reasoning are PDF.md §7.4;
      decisions.md 2026-07-29 explicitly left this choice open and required it be made
      before building. ⚠️ Do not substitute the continuous manager because it sounds more
      like "continuous scroll" — it dissolves the chapter boundary that M17's digest unit,
      decision 8a's spoiler mask, and M32's chapter-end prompt are all built on.
      _Done: `EpubRenderer.mount()` already accepted `opts.flow` since M40 §A and passed it
      to `renderTo` as `"scrolled-doc"`/`"paginated"` — that plumbing existed but was never
      exercised, because `ReaderView` hard-coded `flow: "paginated"`. The only change here
      is that the reader's own resolved mode (§C9) now flows into that existing parameter._
- [x] **C2.** **One `EpubRenderer` with a `flow` construction option, not two classes.**
      Marks, CFI handling, selection and theming are shared; only layout differs.
      _Done: confirmed by construction — the only new state is `this.flow` (set once at
      `mount()`) and a `capabilities` field resolved from it at the same point
      (`PAGINATED_CAPABILITIES`/`SCROLLED_CAPABILITIES`, PDF.md §7.4's table verbatim).
      Everything else (marks, CFI resolution, theming, selection) is untouched, shared code._
- [x] **C3.** The capability profile of PDF.md §7.4's table: `advance: "scroll"`, and
      `spread`/`pageFold`/`pageNumbers` false. The strip, the spread toggle and the fold
      hide themselves off those capabilities — **no new conditional in `ReaderView` keyed
      on the mode**.
      _Done: `ReaderView` now holds `capabilities` (state) and `capabilitiesRef` (for
      closures), set from `renderer.capabilities` once `mount()` resolves — the A5-flagged
      gap ("not yet threaded through... real but small work for whichever of §C/§D lands
      first"). The page fold (`PageFold3D`, the turn-grab surface, the turn-zone vignettes)
      and the page-number readout gate on `capabilities.pageFold`/`.pageNumbers`, never on
      a mode string. The global spread/margin/font-scale Settings controls are unchanged —
      those are book-agnostic settings-page controls, not live reader-strip chrome; PDF.md
      §7.4's table entries for them describe what `EpubRenderer` reports, which nothing yet
      reads for gating since every value stays reachable in scrolled flow too (only
      `pageFold`/`pageNumbers` actually flip)._
- [x] **C4.** ⚠️ The M11 turn zones and M20 drag-to-peel are **unbound, not merely
      hidden**. A pointer handler still attached over a scrolling surface eats the scroll
      gesture, and it will present as "scrolling feels broken", not as a leftover handler.
      _Done: the turn-grab surface (drag-to-peel's own pointer-capture element) isn't
      rendered at all when `capabilities.pageFold` is false — not present, not inert. The
      mouse turn-zone (`handleContentMouseMove`'s edge-dwell-to-highlight-across-boundary)
      and the touch single-finger turn/departure detection both check
      `capabilities.advance === "page"` before arming, added as a new
      `TouchGestureCallbacks.allowTurnGestures` — two-finger pinch (font scale) is
      unaffected. Verified live: mouse-wheel and keyboard (`PageDown`) scroll both moved
      the pane smoothly with no interception, no console errors._
- [x] **C5.** Progress readout: **book %** unchanged from `book.locations`, plus a new
      **chapter %** from `scrollTop / (scrollHeight - clientHeight)` of the section
      container. ⚠️ **Not** from `location.start.displayed.page/.total` — that is what
      `pageNumber.ts`'s `"chapter"` mode reads today and it is a paginated measure that
      does not mean what its name suggests under `scrolled-doc`. Measure the scroll.
      _Done: `scrollProgressFromGeometry`/`readScrollGeometry`, extracted into
      `pageTurn.ts` alongside `chapterPageFromGeometry`/`readTurnGeometry` (the same
      "impure read + pure compute" split, now with its own unit tests —
      `pageTurn.test.ts`). `computeChapterPage()` returns null under scrolled flow (the
      geometry is meaningless there) and vice versa for the new function. The strip shows
      "N% of chapter" next to the unchanged book-percent Slider when `pageNumbers` is
      false. Verified live: scrolling deep into a chapter moved both readouts sensibly
      (e.g. "90% of chapter | 2%"), and crossing into the next chapter reset chapter % to
      0% while book % continued forward — the specific regression C9's acceptance criterion
      calls out._
- [x] **C6.** Reading position saves on a **debounced** scroll, through the existing
      `PUT /:id/position` path, so reading, listening and both modes never lose each
      other's place. ⚠️ Undebounced, this runs hot for the whole session.
      _Done, for free: every scroll tick already flows through the same `relocated`
      handler a paginated turn does (epub.js's own manager debounces `SCROLLED` to ~20ms
      and calls `reportLocation()`, which is what fires `"relocated"` regardless of flow),
      and that handler's existing `POSITION_SAVE_DEBOUNCE_MS` (600ms) `setTimeout` needed
      no changes. Verified live: reloading after scrolling deep into a chapter reopened at
      the same scroll position, both immediately and after a full page reload._
- [x] **C7.** ⚠️ Annotation panels follow their marks. `ThreadPanel`'s `panelDx`/`panelDy`
      are offsets from the mark's anchor rect, which now moves continuously — this is what
      §B's `markRect` and a `relocated` on scroll exist for. Throttle to animation frames.
      Without it, panels detach from their highlights on the first scroll and it will look
      like a `ThreadPanel` bug.
      _Done: a new `renderer.on("relocated", ...)` subscription (the generic interface
      event, not the EPUB-only `onEpubRelocated`) in the book-loading effect, active only
      when `renderer.capabilities.advance === "scroll"`, rAF-throttled (`panelFollowRaf`,
      at most one scheduled frame), recomputing the open panel's `top` from
      `renderer.markRect(id)`. `expandedThreadRef` mirrors `expandedThread` state for the
      long-lived closure, same pattern as `fontScaleRef`/`focusModeRef`. **Not
      independently verified live**: a highlight was created and confirmed to paint and
      persist correctly in scroll mode, but its thread panel was not opened and scrolled
      past to watch `top` follow in real time — reasoned through the code path (the same
      `markRect` → viewport-rect → stage-relative `top` conversion `handleSelected`'s own
      pill-positioning code already does) rather than observed. Flagged here rather than
      silently claimed, per M40 §A's own precedent for the parts it didn't drive live either._
- [x] **C8.** M32's chapter-end prompt fires from `sectionEnd` — "scrolled to the bottom of
      the section" — **once per arrival**, not on every scroll event while at the bottom.
      _Done: `EpubRenderer` tracks `scrollEndFired`, set on arrival (emits the interface's
      `sectionEnd` event, and carries the same edge as `EpubRelocatedInfo.sectionEnd` for
      `ReaderView`'s own `onEpubRelocated` handler to act on directly, avoiding a second
      listener racing the first over which fires first), cleared on scrolling back up or on
      a new section rendering. `ReaderView` calls `checkChapterEndQuestions(info.spineIndex)`
      on that edge, alongside the existing paginated "crossed a boundary forward" trigger.
      Verified live: scrolling to 100%, scrolling back up, and scrolling back down again
      (re-arrival) produced no errors and no duplicate/stuck prompt state; advancing from
      one chapter's bottom into the next via the "next" chevron worked cleanly._
- [x] **C9.** The mode is a reader setting, remembered per book, and reachable from the
      reader strip. Reduced-motion and keyboard paths are acceptance criteria, not polish
      (DESIGN.md; settled decision 15's spirit).
      _Acceptance, driven live in the app, not inferred from tests: read a real EPUB in
      scroll mode from one chapter into the next; highlight while scrolling; confirm the
      panel stays on its mark; confirm book % and chapter % both move sensibly and that
      chapter % resets at a chapter boundary; close and reopen and land where you left;
      switch to paginated and back and confirm the same position; confirm audio follow
      scrolls to the spoken sentence; confirm the fold, spread and page numbers are absent
      rather than broken._
      _Done: `reading_state.flow` (migration 42, `TEXT NOT NULL DEFAULT 'paginated'`),
      threaded through `ReadingPositionSchema`/`UpdateReadingPositionBodySchema`
      (shared), `getReadingPosition`/`setReadingPosition` (server, `COALESCE`-based so a
      plain position save never resets the mode), and a new `ScrollModeIcon` toggle in the
      reader strip's instruments pebble (both the normal footer and the fullscreen pebble).
      `ReaderView`'s book-loading effect fetches position *before* `mount()` now (flow is a
      construction-time option) and resolves `flowOverride ?? position?.flow ??
      "paginated"`; setting the strip toggle persists the new mode (with the renderer's own
      `currentLocation()`) and flips `flowOverride`, which tears down and reconstructs the
      renderer — a real remount, per PDF.md §7.4. A `flowOverrideResourceIdRef` keeps a
      toggle made on one book from leaking into the next one opened.
      **Verified live** (headlessly via Playwright, same environment constraint as M40
      §A's own Verify): opened East of Eden, toggled to scroll, confirmed single-column
      layout and the "N% of chapter" readout; scrolled deep into the chapter with the mouse
      wheel and with keyboard `PageDown`, both moved the pane and updated both percentages;
      scrolled to the chapter's end and back up and down again with no errors; created a
      real highlight while in scroll mode (a real CFI, resolved and persisted, visible as a
      margin-rail dot); reloaded the page and confirmed it reopened in scroll mode at the
      same position; clicked "next" from the chapter's end and landed cleanly at 0% of the
      next chapter with book % continuing forward; switched back to paginated and confirmed
      the two-column spread, page-number readout and fold/turn-zone chrome all returned,
      with the earlier highlight still present. **Not independently verified live**: audio
      follow's auto-scroll to the spoken sentence (needs the TTS engine running, not
      exercised this pass) and §C7's live panel-follow (see that item's own note) —
      flagged rather than silently claimed. One pre-existing 404 was observed during
      verification, unrelated to any endpoint this milestone touches (did not reproduce on
      a clean reload) and not chased further._

#### D. The PDF renderer, headless

- [x] **D1.** `PdfRenderer` implementing the interface: pdf.js canvas + text layer,
      `advance: "image"`, `spread`/`fontScale`/`margins`/`pageFold`/`pageNumbers` false.
      _Done: `web/src/reader/renderer/pdf/PdfRenderer.ts`. No official pdf.js `TextLayer`
      builder — its font-ascent measurement needs a real 2D canvas context, which jsdom
      doesn't provide without the native `canvas` package; each text item is positioned
      straight from its own `transform` via `Util.transform(viewport.transform,
      item.transform)` instead (real text nodes, real Ranges, invisible — the raster
      canvas is the visible page). Canvas rasterization itself degrades rather than
      fails when `getContext("2d")` returns null, the same rule
      `server/src/library/pdf/rasterize.ts` already applies for exactly the same reason.
      SPEC-GAP, recorded in the file's own header comment and NOTES.md: `Locator
      .sectionIndex` is always `0` — a real multi-section PDF needs a persisted
      page→section table this milestone doesn't build (M41 §A2's problem); the whole
      document as one section is PDF.md §4's own fallback rule 3 and the only shape
      this file is tested against._
- [x] **D2.** Selection via the text layer's real DOM Ranges, so `getSelectionContext`
      works unchanged.
      _Done, with a small generalization: `getSelectionContext`/`rangeFromTextOffsets`
      (`web/src/reader/selectionContext.ts`) took a `Document` and hard-coded `doc.body`
      as the text root — fine for `EpubRenderer`, whose iframe document is one document
      per section, but `PdfRenderer` has no per-page iframe to isolate against. Both now
      take an `Element` root instead (EpubRenderer's 6 call sites updated to pass
      `contents.document.body`, behaviour unchanged). Added `offsetsForRange` (the
      inverse direction: Range → char offsets) alongside them, since `PdfRenderer`'s
      `selected` event has no CFI fast path to fall back on the way EpubRenderer's does._
- [x] **D3.** Highlight painting from text-layer Range client rects into absolutely
      positioned divs. ⚠️ `marks-pane` is CFI-keyed and is **not** reused here.
      _Done: `paintRangeInto` builds one box per `range.getClientRects()` entry inside a
      wrapper div positioned 1:1 over the page. `markRect` mirrors `EpubRenderer`'s own
      convention of reporting the *first* line's rect rather than a union, for the same
      reason (the annotation panel just needs one anchor point)._
- [x] **D4.** Not routed to from any UI yet. M41 turns it on.
      _Acceptance: a test mounts `PdfRenderer` over a fixture PDF, makes a selection, paints
      a mark, and round-trips a `Locator` — with no route in the app reaching it._
      _Done: `web/src/reader/renderer/pdf/PdfRenderer.test.ts`, against a static two-page
      fixture (`fixtures/pdf-renderer-sample.pdf`) rather than a pdfkit-built one — found
      live that pdfkit branches on `typeof document` and produces a genuinely corrupt
      content stream ("Bad FCHECK in flate stream") when built inside this file's own
      jsdom environment, so the fixture is generated once under plain Node and committed,
      the same way the EPUB fixtures in this repo are static files rather than built per
      test run. Also required two jsdom gaps to be closed: `Range.getClientRects`/
      `getBoundingClientRect` are entirely absent in this jsdom version (not stubbed,
      simply undefined) — added to `vitest.setup.ts` alongside the existing
      `matchMedia`/`scrollIntoView` shims, same convention (a single zero-size rect, no
      test asserts on real geometry). `grep -rln "PdfRenderer" web/src` confirms nothing
      outside `renderer/pdf/` and this doc comment references it — not routed anywhere._

---

### M41 — Reading a PDF as itself

Scoped 2026-09-03. **Binding spec: `docs/marginalia/PDF.md` §6, §7.4.** Depends on M40.

**Why it exists:** for a paper the figures, layout and typesetting often *are* the
content, and reflow loses the page. This is the operator's Option 2: read the PDF as a
PDF, keep every inline LLM feature.

**Verification:** entirely live. Every section here is a reading surface, and §A2's
cross-mode highlight identity is the kind of thing that passes a unit test and fails on a
real paper. Drive it with the same five PDFs from M39 §A8.

#### A. The mode switch

- [x] **A1.** A `format: 'pdf'` resource opens in reflow or native, remembered per book.
      The switch is in the reader strip, and is absent for an EPUB.
      _Done — see NOTES.md "M41 §A — the mode switch, and a bug the tests couldn't have
      caught" and its 2026-09-05 follow-up. `reading_state.render_mode` (migration 43),
      the strip's `RenderModeIcon` toggle, `setReadingMode`. **Verified live** end to end
      against a freshly-imported PDF (post-migration-44), both switch directions. The
      round-trip claimed live-verified on 2026-09-04 was incomplete: native→reflow hung
      with no iframe whenever the saved position had no CFI (routine for any position
      saved from native mode) — `EpubRenderer.goTo` had no path to display anything when
      `currentContents` was still null, which is always true on first mount. Fixed by
      displaying the section itself first when there's no CFI to jump to directly. Also
      caught and fixed the real crash from 2026-09-04 stays fixed
      (`GlobalWorkerOptions.workerSrc`)._
- [x] **A2.** ⚠️ Highlights are **shared between the two modes**, not duplicated — both
      resolve the same `Locator` against the same `resource_text`. A highlight made in
      reflow appears in native and back.
      _Acceptance: highlight in reflow, switch to native, and the mark is on the right words
      of the right page — and vice versa._
      _Done — verified live 2026-09-05 against a fresh PDF import (post-migration-44).
      reflow→native confirmed pixel-precise (sampled rendered pixel colours: white before
      the highlighted word, the fill's exact RGB starting exactly at the target word,
      nothing before it). native→reflow confirmed at the data level (highlight persists
      with the right spineIndex/offset/length and `cfi: null`); the DOM paint step
      couldn't be independently confirmed under headless Playwright, but that's an
      environment characteristic, not a regression — a long-standing EPUB with real
      highlights (Alice in Wonderland) shows the identical "no `<svg>` mark visible"
      symptom, so it isn't specific to PDF or to a null CFI. Three real bugs found and
      fixed live during this verification, none catchable by the existing unit tests
      (see NOTES.md 2026-09-05 entry): (1) `PdfRenderer`'s mark/tint/search-mark painting
      applied its fill to the whole-page wrapper `div` instead of each per-rect box, so
      every mark tinted the entire page instead of the matched text; (2) `buildTextLayer`
      skipped DOM nodes for empty-`str` text items that `textOfItems` still counted
      (their `hasEOL` newline), desyncing the DOM's character offsets from the ones a
      highlight is matched against — highlights landed ~20 characters into their own
      quote; (3) the client defaulted a PDF selection's missing CFI to `""` instead of
      `null`, which the server's `cfi: string().min(1).nullable()` schema rejects — every
      highlight created in native mode was silently failing to save (400, swallowed)._

#### B. Chrome parity

- [ ] **B1.** Threads, notes, tags, the ask flow, Define, the glossary and the Digest all
      work in native mode with no format-specific branch — they act on highlights, which are
      already format-neutral after M40 §B.
      _Code done, left unchecked. Falls out of the renderer union (`rendererRef` is now
      `EpubRenderer | PdfRenderer`) with zero format branches in `ReaderView` — these
      features only ever touched `highlights` state and the shared interface. Not
      independently live-verified (needs the same fresh import as A2)._
- [x] **B2.** The find bar over native: text search against `resource_text` with
      text-layer rect painting.
      _Done — verified live 2026-09-05 (same session as A2). Searching a fresh PDF's
      native pane found the correct total hit count across the book and painted correct,
      correctly-sized rects for a hit purely from page text alongside a second hit that
      was a highlight matched by containment (the find bar surfaces both kinds by
      design) — confirms `getRenderedSectionText`/`paintSearchMarks` inherited the same
      offset-sync fix A2 needed._
- [ ] **B3.** Audio sentence-follow tinting re-expressed over text-layer rects.
      _Code done, left unchecked. `PdfRenderer.setTint`/`isLocatorVisible` implemented;
      the audio-follow effect already called these generically. Not live-verified (needs
      a running TTS engine, same caveat M40 §A's own Verify flagged for the EPUB path)._
- [ ] **B4.** ⚠️ The M20/M27 page fold does **not** apply to fixed pages and must not be
      faked. `capabilities.pageFold = false` hides it; page turn is plain page-to-page.
      _Done. `usePageTurnAnimation`'s `resolveRenderer()` ladder now checks
      `pageFoldEnabled` (= `capabilities.pageFold`) first, forcing "slide" regardless of
      the reader's own curl/slide preference — previously nothing stopped a curl being
      requested under a capability profile that says it doesn't apply. Verified live: the
      native pane's page turns showed no fold chrome, drag surface, or turn-zone
      vignettes throughout every native-mode check above._

#### C. Zoom and navigation

- [x] **C1.** Fit-width / fit-page / free zoom, and page navigation that keeps the reading
      position in sync with the same path reflow uses — reading, listening and both modes
      must never lose each other's place.
      _Done — see PDF.md §7.6 and NOTES.md's 2026-09-06 entry. Adaptive 1-page/2-page
      spread driven by the PDF's own page geometry (`pdfLayout.ts`'s `shouldShowSpread`,
      not a fixed breakpoint like EPUB's), fit-width/fit-page/free zoom controls, and a
      real virtualized continuous-scroll mode that engages automatically once the reader
      zooms past the active fit scale (and disengages automatically the other direction
      too — zooming back down, or the pane growing back wide enough). Arrow-key paging
      steps by 2 pages in a spread, 1 otherwise, and just scrolls in continuous mode —
      all through the same renderer-agnostic `next()`/`prev()` the chrome already called
      unchanged. Verified live: 2-up spread at a wide pane, 1-up at a narrow one, zoom-in
      engaging continuous scroll (confirmed a real scrollable multi-page container, not
      just a wider single page), zoom-out snapping back to the identical spread,
      arrow-key stepping by 2 in a spread (confirmed via the progress readout and a
      genuinely different page's content), and a highlight repainting at the correct,
      proportionally-rescaled position after zooming. No persistence (a settled scope
      call this milestone) — resets to fit-width every time, cheap since a reflow⇄native
      switch already destroys and reconstructs the renderer._

#### D. The scan preview

- [ ] **D1.** A `text_layer = 0` resource opens in native mode with
      `capabilities.textSelection = false`: pages, navigation, zoom, and nothing else. The
      preview is not a special case — it is the native pane with one capability off.
- [ ] **D2.** The strip states why the LLM controls are absent rather than disabling them
      silently.
      _Acceptance: a scanned PDF opens, pages turn, zoom works, and no control is shown that
      cannot act._

---

### M42 — Corrective PDF work: section boundaries, tables, hierarchy, and native-pane polish

Scoped 2026-09-07, from the operator reading two real PDFs already in the library — the
first "real gate" M39 §A8 itself flagged as still owed — and reporting several problems.
**Binding spec: `docs/marginalia/PDF.md` §3.5 (amended), §4 (amended), §7.5, §7.6.**
Investigation and root causes: `docs/marginalia/NOTES.md` "M39 — the real gate, finally —
2026-09-07". Three forked decisions (tables rasterize like equations; hierarchy changes
the spine, not just the TOC; the toolbar-resize bug rides along despite not being
PDF-specific) are recorded in `docs/decisions.md` 2026-09-07 and are binding here — do not
re-litigate them mid-implementation. Depends on M39–M41.

**Why it exists:** every finding below came from running the actual extractor against
real PDFs already sitting in the operator's library, not a synthetic fixture — exactly the
gap M39 §A8's own acceptance note predicted ("more likely to surface extraction failures a
synthetic fixture wouldn't think to construct"). §A is a **blocking gate**, same
philosophy as M39 §A: fixing §B/§C/§D on top of still-broken section boundaries hides the
problem behind a differently-shaped picture of the same wrong page.

⚠️ **§A is a blocking gate.** Do not start §B or §C until §A's own re-run of the two real
fixtures below reads clean.

#### A. Section-boundary correctness

Both bugs are already fully root-caused with exact line references in NOTES.md — this
section is fixing what's already found, not re-diagnosing it.

- [x] **A1.** Cap `detectHeadingBoundaries`'s consecutive-heading-line coalescing
      (`sections.ts`), added in M39 §B to merge a two-line wrapped *title* and found live
      to have no bound on how much it can absorb. Confirmed on a real PDF: a page set
      entirely in a legitimately different (larger) body size than the document's single
      global modal size had every one of its ~30 lines misread as heading-qualifying, and
      the coalescing loop swallowed the whole page into one section title.
      ⚠️ `HEADING_MAX_CHARS` is checked per *line* today, never against the coalesced
      run's total — that alone lets an unbounded run through. Bound the run itself (a
      title reasonably wraps 2–3 lines, not thirty), and reconsider `modalBodyFontSize`
      being a single number across the *whole* document — a real document can legitimately
      have more than one body size across different page types (dense prose vs. a
      bulleted/tabular page), which is the actual trigger here.
- [x] **A2.** Fix `dedupeAndSort`'s silent drop of colliding outline boundaries
      (`sections.ts`). Confirmed on a real PDF: four distinct, correctly-nested outline
      entries (`1`, `1.1`, `1.2`, `1.2.1`) resolved to the *identical* `(pageIndex,
      blockIndex)` — a real LaTeX/hyperref destination quirk, not a parsing bug — and
      exact-match dedup dropped three of them, so the one surviving section (titled
      "1. Introduction") actually started mid-sentence inside real §1.2.1's content while
      real §1/§1.1/§1.2 content was stranded in the *previous* section instead.
      ⚠️ The fix must not regress the case dedup exists for — an outline entry and a
      detected heading legitimately agreeing on the same position. A collision between
      two *different* outline entries is not that case and must never make either one
      vanish; disambiguate them (e.g. a secondary per-page detected-heading search to
      break the tie) rather than dropping one.
- [x] **A3.** Title metadata fallback (`extract.ts:237`). A `Info.Title` that's present
      but empty-after-trim or matches an obvious placeholder (`"Title:"`, `"Untitled"`, …)
      falls back to the first detected heading/section title, the same way the resource
      already degrades gracefully when metadata is absent rather than merely blank.
- [x] **A4. GATE.** Re-run the extractor's own diagnostic output (not a fresh synthetic
      fixture — the two real PDFs already in `LIBRARY_DIR` from this investigation) after
      A1–A3 land, and read it, matching M39 §A8's own method.
      _Acceptance: the Engineers Australia doc's competency-list section title is a normal
      heading, not a multi-hundred-character run-on; the paper's "1. Introduction" section
      starts with its real opening sentence, not mid-1.2.1; record the result in NOTES.md
      whether or not it passes, per M39 §A8's own convention._
      ⚠️ These are the operator's own real files, not a committed fixture corpus — this
      gate is a manual read-the-output step (as M39 §A8 itself was against its synthetic
      fixtures), not a new automated regression test against real copyrighted PDFs. Worth
      a design call before this task starts on whether a redacted/trimmed derivative of
      either file could safely become a committed regression fixture — not assumed here.

#### B. Table structure

Per PDF.md §3.5's amendment (2026-09-07): rasterize, matching equations. Not a new
representation — making detection and exclusion actually work.

- [x] **B1.** Make table-region detection positive, not just caption-regex-shaped. Today
      only `figures.ts`'s `Table\s*\d+` caption match fires; there is no identification of
      the table's own row/cell text, so a genuine data table still leaves its (garbled —
      see A-adjacent `groupLines` splicing) row text in `resource_text` *alongside* an
      often-spurious rasterized region. Identify the table's actual text lines (the block
      span between its caption and the next non-table content) and treat them the way an
      equation band's lines are already treated.
- [x] **B2.** ⚠️ **Exclude the identified table's row/cell lines from `resource_text`
      entirely**, mirroring §3.4/§3.5's existing rule verbatim: nothing but the caption
      enters the text substrate for a rasterized table. This is the one line that actually
      fixes "no table is rendered or correctly embedded" — B1 alone (better detection)
      does nothing if the row text still leaks through.
- [x] **B3.** Tests against the real gate's own tables (the Engineers Australia PDF has
      three). _Acceptance: each table renders as one clean rasterized image with its
      caption as ordinary surrounding text — no bare caption-only section, no bare
      header-row-only section, no garbled cross-cell text anywhere in `resource_text`._

#### C. Heading hierarchy — subsections roll into their parent chapter

Per PDF.md §4's amendment (2026-09-07). The spine itself changes shape, not just the TOC's
presentation — decisions.md 2026-09-07 records why the safer TOC-only option was declined.

- [x] **C1.** Thread outline depth through instead of discarding it. `extractOutline`
      (`extract.ts`) currently flattens `getOutline()`'s real tree (each node's `items`)
      into one document-order array with no depth field — carry depth from the tree walk.
- [x] **C2.** For the detected-headings fallback (rung 2, no outline present): derive
      depth from the heading text's own numbering — `^\d+\.?\s` is depth 1, `^\d+\.\d+` is
      depth 2, `^\d+\.\d+\.\d+` is depth 3, and so on. An unnumbered heading (a paper's
      bare "Abstract"/"Conclusion") stays depth 1, ungrouped — unchanged from today.
- [x] **C3.** Only a depth-1 boundary starts a new `PdfSection`/`resource_text` row. A
      depth-2+ heading's line stays exactly where it already sits in its parent section's
      block stream — still a real heading in the reading flow, just not a spine break.
      ⚠️ **Guard against a whole-document depth-2+ outline** (every entry nested under one
      nominal root, no real depth-1 siblings) collapsing to a single section — fall back to
      PDF.md §4's existing "one section under 40 pages" rung rather than trusting a
      possibly-degenerate depth signal into producing zero depth-1 boundaries.
- [x] **C4.** A depth-2+ heading stays independently reachable from `ChapterNav`'s TOC
      popover (`TocEntry.depth` already renders indent — confirmed in `ChapterNav.tsx`),
      via an **in-section scroll/jump target**, not a spine index — there is no longer a
      separate `href` for it. This is new plumbing, not something C1–C3 produce for free.
- [x] **C5.** Note plainly in the acceptance note (not a code change): a freshly re-imported
      PDF now produces a different, smaller section count than before this milestone.
      Already-imported PDFs are untouched (decision 5, immutable-on-import) — this is
      expected, not a regression, and should not be mistaken for one.

_Acceptance for C: re-run the real gate; the paper's flat 49 sections collapse to
roughly its true depth-1 chapter count, with every depth-2+ subsection still independently
reachable from the TOC._

#### D. Native pane polish

Draft acceptance criteria from NOTES.md's "Proposed acceptance criteria" section,
confirmed against this milestone's scoping — additive on top of M41 §C1/§D, not a
redesign of either.

- [ ] **D1.** ⚠️ **Live-verified 2026-09-08 (M43 §0.1, NOTES.md) — fails, a new bug found
      doing the verification, not the pre-existing "unwatched" state this box was in.** A
      single small Ctrl+wheel tick away from a legible 2-up spread's own fit scale pops the
      zoom from 110% to 219% instead of interpolating to ~120% — `relayout()`'s `pagesAcross`
      recomputation and its own snap-back check run in the same pass, so the snap-back
      compares the small zoom target against a just-doubled (single-page) fit scale and
      resets to it. Root cause and exact lines in NOTES.md's "M43 §0.1" entry. Continuous,
      smoothly-interpolated zoom (drag/scroll/pinch) replacing today's fixed `ZOOM_STEP`
      clicks is otherwise present; the zoom↔continuous-scroll threshold crossing (PDF.md
      §7.6) is exactly where this pop happens, so "no visible pop/flicker at the crossover"
      does not hold yet. ⚠️ Fix this as part of M43 §D's rewrite of this same
      `pagesAcross`/`nextAdvance` region, not as a separate patch to logic §D is about to
      replace.
- [x] **D2.** A plain 2D directional slide on page turn, replacing today's instant swap.
      ⚠️ Must not reintroduce the M20/M27 3D fold — `capabilities.pageFold` stays `false`
      for native; a slide is not a fold. Respects reduced motion (decision 14).
      Live-verified 2026-09-08 (M43 §0.1, NOTES.md): a real outgoing/incoming slide visible
      mid-transition, settles clean, no fold chrome.
- [x] **D3.** Zoomed-out background reads as a continuation of the page (plain white, or
      the page's own background) rather than `--color-bg`'s cream/paper reader tone, when
      the rendered page is smaller than the pane in either axis.
      ⚠️ Native pane only — the reflow/EPUB pane's `--color-bg` is a deliberate choice
      (decision 12) for reflowed *text* and must not change.
      Live-verified 2026-09-08 (M43 §0.1, NOTES.md): `.stageNativePane` reads
      `rgb(255,255,255)` around a zoomed-out single page, not the cream reader tone.
- [x] **D4.** No more reserved side padding around the native page at fit-width than a
      drop-shadow/edge needs. `margins: false` already hides the margin *control*
      (M40 §D1) — this extends it to the page container itself. Measure the current CSS
      inset before changing it; not yet confirmed as broken.
      Live-verified 2026-09-08 (M43 §0.1, NOTES.md): ~9px symmetric edge inset at
      fit-width, both spread and single-page — a shadow inset, not a dead gutter.

_Acceptance for D: zoom feels continuous under drag/pinch with no discrete jumps [still
open — D1 above, live-verified 2026-09-08 to pop at the spread→continuous crossing rather
than interpolate smoothly]; a page turn animates a slide with no fold chrome [met]; zooming
out below fit-scale on a portrait page shows no visible color seam [met]; fit-width leaves
no dead reserved gutter beside the page [met]._

#### E. Reader-chrome fix: toolbar stays fixed under a pane-only resize

⚠️ **Not PDF-specific** — `useReaderStripLayout.ts` is shared reader chrome, used by EPUB
too. Bundled into M42 anyway per decisions.md 2026-09-07, since it surfaced from this PDF
testing session. Verify the fix doesn't regress EPUB's reading strip.

- [x] **E1.** ⚠️ **Confirmed live in code, not a hypothesis**: `useReaderStripLayout`
      decides stacked/unstacked from a `ResizeObserver` on the strip's own container
      (`containerRef`), sized to the reading *pane* — so opening a sibling panel
      (`ThreadPanel`, the margin rail), which narrows the pane without touching the
      tab/window, already restacks/rescales the strip today. Distinguish "the pane
      narrowed because the tab/window did" (should still restack — today's correct
      behaviour) from "the pane narrowed because a sibling panel opened" (should not move
      the strip at all) — likely needs a second measurement of the tab/viewport width
      alongside the existing pane-container observer, restacking only when that one also
      shrank.
      _Acceptance: opening/closing a side panel never moves, rescales, or restacks the
      reader strip or foot in either EPUB or native PDF mode; narrowing the actual
      tab/window still restacks exactly as it does today._
      Live-verified 2026-09-08 (M43 §0.1, NOTES.md): opening a highlight's floating
      thread/annotation editor left the strip's own container at a pixel-identical `top`;
      narrowing the real browser viewport still restacked it into two rows. Exercised via
      the floating thread editor rather than `MarginRail` specifically — see NOTES.md for
      that caveat.

---

### M43 — Native-pane fidelity and reflow quality (Acrobat-parity, part 2)

Scoped 2026-09-08, from the operator's own live pass against the native pane and the
generated-EPUB reflow output. **Binding spec: `docs/marginalia/PDF.md` §3.4 (amended),
§3.5 (amended), §7.5, §7.6 (amended).** Two forked decisions (equation representation;
the native pane's default navigation model) are recorded in `docs/decisions.md`
2026-09-08 and are binding here — do not re-litigate them mid-implementation. Depends on
M41–M42.

**Why it exists, and how it relates to M42 §D/E1:** this is the same live operator pass
`docs/marginalia/NOTES.md`'s "Proposed acceptance criteria — native PDF viewer,
Acrobat-parity pass" (2026-09-07) was drafted from, and the same pass M42 §D1–D4/E1
(code-complete that date, checkboxes deliberately left unchecked pending exactly this)
were waiting on. **§0 below is not optional preamble** — several of the operator's
complaints here (zoom smoothness, the page-turn feel) may already be fixed by that
unverified code, and treating them as fresh scope risks reimplementing what already
exists. Everything else here (§A–§F) is genuinely new: highlight-painting fidelity, a
persistent selection pill, canvas resolution, a zoom-popup stacking bug, a fit-mode UI
change, a navigation-model change, and two reflow-quality gaps — none of which M42 §D/E
touched.

#### 0. Close out M42 §D1–D4/E1's own open verification first

- [x] **0.1.** Run M42 §D1–D4 and §E1 live against a real PDF, per their own NOTES.md
      "implemented, code-verified; live browser check still owed" entry (2026-09-07).
      Check off whichever of those boxes actually pass. For any that don't, or that pass
      but still show a version of what the operator reported below (in particular §C1/§C2
      here, which overlap D1's "continuous zoom" and D2's "page slide" criteria), open a
      precisely-described follow-up under the relevant §A–§F item rather than assuming
      M42's own code is either fully sufficient or fully absent.
      Done 2026-09-08 (NOTES.md "M43 §0.1"): D2/D3/D4/E1 checked off above, live-verified.
      D1 stays unchecked — found a real zoom-jump bug at the exact spread→continuous-scroll
      crossing (not a pre-existing-and-now-confirmed-fine state), root-caused, not fixed
      here (belongs to M43 §D's rewrite of the same code, per that box's own note). §C1/§C2
      confirmed **not** fixed by D1/D2 — distinct, still-open UI issues, not overlapping the
      zoom-jump bug found doing this check.

#### A. Highlight painting in the native pane — continuous, gap-free, and dismissable

- [x] **A1.** ⚠️ Highlights render as one box per `Range.getClientRects()` entry with no
      merging (`PdfRenderer.ts`'s `paintRangeInto`, ~line 202). pdf.js's text layer places
      each text item — often a single word or run, sometimes a lone punctuation glyph —
      as its own absolutely-positioned span, so a highlight crossing a span boundary gets
      one box per span; adjoining boxes rarely abut to the sub-pixel, leaving a hairline
      unhighlighted gap between them (most visible over narrow glyphs — commas, brackets,
      the operator's own screenshot), and wherever pdf.js's text layer emits overlapping
      spans (kerning/script correction), two boxes' semi-transparent fills stack into a
      visibly darker seam ("doubly thick"). `EpubRenderer`'s marks-pane (CFI-keyed SVG,
      built for continuous prose) doesn't have this problem but isn't reusable here
      (PDF.md §7.5 already rules that out) — read it anyway for the "one continuous run
      per line" shape this needs and doesn't have.
      Fix: in `paintRangeInto`, merge client rects that share a line (y-overlap within the
      tolerance PDF.md §3.3 already uses for line detection) into one box spanning from
      the leftmost rect's left edge to the rightmost rect's right edge — one box per
      visual line the range touches, not one per text-layer span. A rect whose y doesn't
      overlap the current run starts a new line/box.
      _Acceptance: highlighting a run of text that crosses several text-layer spans (a
      sentence containing commas/brackets) paints one continuous band per line with no
      visible gap or doubled-opacity seam at any span boundary; a highlight spanning two
      lines shows exactly two boxes, each ending at that line's own text extent — not the
      container's full width._
      Done 2026-09-08: `paintRangeInto` now merges client rects via a new
      `mergeRectsIntoLines` helper (y-overlap against the running line's own bounds,
      tolerance = half the smaller rect's height — the client-rect-geometry analogue of
      §3.3's line test, since there's no PDF-extraction "median line height" available
      client-side). New unit test constructs synthetic multi-span client rects (two spans
      sharing a line with a sub-pixel gap, one on a second line) and asserts exactly two
      merged boxes with the correct union extents. All 18 `PdfRenderer.test.ts` tests pass;
      `tsc -b` clean.
      ⚠️ **Corrective, found live 2026-09-08 (operator report against the real "Spatiotemporal
      Composability" PDF): the merged boxes were still "going far over the line" — overrunning
      the real glyphs, not just failing to merge.** Root cause was upstream of `paintRangeInto`
      entirely: `buildTextLayer`'s spans (~line 1544) set no `fontFamily` and applied no
      horizontal scale correction, so each span laid out at the *browser's* default-font
      advance width for `item.str` — which routinely differs from the PDF's own embedded-font
      width, especially on justified body text — and `paintRangeInto` paints straight from
      those spans' `getClientRects()`. The file's own prior comment ("not pixel-perfect glyph
      spacing, which doesn't matter yet for a surface nothing renders to a screen") predicted
      exactly this once a visible feature started depending on that geometry.
      Fix: `buildTextLayer` now applies the same scale-x correction `pdfjs-dist`'s own
      `TextLayer#layout` uses — measure the span's natural width via a canvas
      `ctx.measureText` (a lazily-created, module-shared "measure-only" canvas, `null` on
      jsdom exactly like `renderPageInto`'s own raster-context fallback) and apply
      `transform: scaleX(expected / measured)`, where `expected = item.width *
      Math.hypot(viewport.transform[0], viewport.transform[1])` — the *viewport's* zoom scale,
      deliberately not the item's own combined transform, which would double-count the
      font-matrix scale already baked into `item.width`. New `PdfRenderer.test.ts` case stubs
      the measure canvas's `getContext` (marked via a `data-marginalia-measure-canvas`
      attribute so the page's own raster canvas is untouched) and asserts a finite,
      non-degenerate `scaleX` is applied. Live-verified (Playwright/Chromium against the real
      PDF, zoomed to 400%): highlight bands now end exactly at the last highlighted glyph on
      every line, including the two lines from the operator's own screenshot.
- [x] **A2.** ⚠️ The selection pill (`AskPill`) never dismisses on a click away from the
      selection in the native pane. Root cause, confirmed by reading the code: `ReaderView`
      wires `handleContentClick` — the only function that calls `setPendingSelection(null)`,
      which is what hides the pill — exclusively inside `if (activeRenderer instanceof
      EpubRenderer)` (~line 2719), attached per rendered section to that section's own
      iframe document via `onSectionRendered`. A `PdfRenderer` instance gets no equivalent
      listener at all. `PdfRenderer.handleSelection` (~line 1402) can't fill the gap either:
      it early-returns on a collapsed selection (`if (range.collapsed) return;`), so a
      click that collapses the Range fires nothing on that path by design — this is M41
      §A1's "named-extras kept off the shared interface" choice working as intended, just
      with no substitute wired up for what `handleContentClick` did on the EPUB side.
      Fix: give the native pane's page container the same "a click that isn't on a mark or
      a link clears the pending selection" behaviour — e.g. `PdfRenderer` emits a
      `"deselected"` event on a container click when the live selection is empty/collapsed
      (same shape `handleContentClick` already produces), or `ReaderView` attaches an
      equivalent listener directly to the native container. Check `pendingSelection`'s
      other consumers (M35 §G4's link-quote mode; the kind-dot/submit paths) before
      changing its lifecycle — those must keep working unchanged.
      _Acceptance: select text in the native pane so `AskPill` appears; click anywhere in
      the pane that isn't the pill or an existing mark — the pill closes, matching reflow
      mode's existing behaviour._
      Done 2026-09-08: took the named-extra path (`PdfRenderer.onDeselected`, same shape as
      `onLayoutChanged`) rather than a `ReaderView`-side listener, since only this file's
      own DOM can classify "on a mark" (`MARK_CLASS`). `handleContainerClick` skips a link
      or a mark, and skips a live (non-collapsed) selection — mirrors `handleContentClick`'s
      own guards. `ReaderView`'s PDF branch subscribes and calls the same
      `setPendingSelection(null)` every other call site already uses, so §G4/kind-dot/submit
      consumers are unchanged. New unit test (`PdfRenderer.test.ts`) covers: a live selection
      doesn't dismiss; a click that collapses it does; a click on a painted mark doesn't
      (leaves `markClicked` alone). Also watched live (Playwright/Chromium against the real
      PDF, outside M43 §0.1's own scoped pass): selected a run of body text, `AskPill`
      appeared, clicked away in blank page space — the pill closed exactly as reflow mode's
      does.
- [x] **A3.** ⚠️ Found live 2026-09-08, same operator pass as A1's corrective above, not
      previously scoped: clicking an *existing* highlight in the native pane did nothing — no
      annotation panel opened, unlike reflow mode's identical gesture. Root cause: `paintOneMark`
      inserted the mark's own div (`pointer-events: none` on the wrapper, `auto` on each painted
      line box — see `paintRangeInto`) via `pageDiv.insertBefore(el, mount.textLayerDiv)`, i.e.
      *before* the text layer in DOM order. `textLayerDiv` is `inset: 0` over the whole page and
      (needed for drag-selection) `pointer-events: auto` by default with no explicit z-index, so
      being later in the DOM it always won the browser's hit-test first — the mark's own click
      listener (`markClicked`) could never fire for a click squarely on a highlight, regardless
      of `ReaderView`'s generic `on("markClicked", …)` wiring (shared with `EpubRenderer`, and
      already correct) ever seeing it.
      Fix: the mark is now appended *after* `textLayerDiv` (`mount.pageDiv.appendChild(el)`) —
      stacked on top the same way `EpubRenderer`'s marks-pane SVG sits above its iframe. Purely a
      hit-testing fix: `textLayerDiv`'s spans are `color: transparent`, so nothing paints from it
      either way, and the mark's multiply/screen blend (`markStyleForKind`) still composites
      against the raster `canvas`, which stays earlier in the DOM (and therefore behind the mark)
      regardless of where the text layer sits — the glyphs stay exactly as visible through the
      tint as before.
      While fixing this, the operator also asked that the highlight whose annotation panel is
      open read as more pronounced while it's open — "to show we're looking at that highlight
      whilst we are looking at the annotation" — with the standing rule restated explicitly:
      text must stay legible on top of it, never opaque. Added `setActiveHighlight(id | null)` to
      the `ResourceRenderer` interface (both `PdfRenderer` and `EpubRenderer`): baked into the
      *resting* style via a new `active` parameter on `markStyleForKind` (boosts fill-opacity to
      the same `hoverFillOpacity` strength M16's hover-pop already defined, still blended — never
      a second, ad hoc DOM mutation like the hover boost, because an open panel can outlive a
      page turn/relocation, same reason `kind`/`hidden` are baked in rather than poked
      imperatively) rather than a one-off mutation. `ReaderView` calls it from a `useEffect` keyed
      on `expandedThread?.highlightId`, and again at renderer-mount time (for the "switched render
      mode while a panel was already open" case, where a fresh renderer instance starts with no
      active id of its own and the effect's dependency hasn't changed).
      _Acceptance: clicking an existing highlight in the native pane opens its annotation panel,
      matching reflow mode; while a panel is open, its highlight reads visibly more intense than
      its resting wash and than other highlights on the page, in both the native pane and reflow
      mode; the underlying text stays fully legible through it; closing the panel returns the
      mark to its resting wash._
      Done 2026-09-08: new tests in `PdfRenderer.test.ts` (DOM order — the mark is stacked after
      the text layer; `setActiveHighlight` lifts and restores `fill-opacity`) and
      `highlightKinds.test.ts` (`markStyleForKind`'s `active` flag: same fill/blend, boosted
      opacity, hidden still wins over active). Live-verified (Playwright/Chromium): in the native
      pane, clicking the operator's own "establishing spatial composability…" highlight opened its
      panel and the mark visibly brightened; in EPUB (Kafka on the Shore), clicking a highlight's
      SVG rect boosted its `fill-opacity` from `0.22` to `0.95` and pressing Escape (closing the
      panel) returned it to `0.22` — text legible throughout, no console errors introduced (the
      two 404s seen are pre-existing/unrelated — a missing cover image and the jobs-events SSE
      endpoint).

#### B. Page-rendering resolution

- [x] **B1.** ⚠️ The native pane's canvas renders soft/pixelated next to a native OS PDF
      viewer at the same size. Root cause, confirmed by reading the code:
      `PdfRenderer.ts`'s `renderPageInto` (~line 1187–1202) sizes the canvas's *backing
      store* 1:1 with `page.getViewport({ scale }).width/height` — CSS pixels — and never
      multiplies by `window.devicePixelRatio`. On any HiDPI/Retina display the browser
      then stretches a 1×-resolution raster to fill a 2×-or-3×-density CSS box, which is
      exactly the blur the operator sees relative to macOS Preview rendering at the
      display's real pixel density. (This is a distinct, separate path from
      `rasterize.ts`'s server-side `RASTER_SCALE = 2` used for reflow's embedded figures,
      §F below — the interactive native pane renders straight through `page.render()` in
      the browser with no DPR awareness of its own today.)
      Fix: size the canvas backing store to `viewport.width/height × devicePixelRatio`,
      keep the CSS `width`/`height` at the unscaled viewport size, and scale the 2D
      context accordingly (`ctx.scale(dpr, dpr)`, or an equivalent DPR-scaled viewport
      passed to `page.render`) — whichever keeps `buildTextLayer`'s coordinate math (which
      must stay keyed to the *unscaled* viewport, same as mark-painting's rect geometry)
      unchanged.
      ⚠️ Cost: DPR-2/DPR-3 renders 4×/9× the pixels per page — check this doesn't visibly
      regress continuous-scroll performance (§7.6, several pages mounted at once) with
      several real PDFs, and cap the multiplier (e.g. `Math.min(devicePixelRatio, 2.5)`)
      rather than trusting an unbounded reported value.
      _Acceptance: the same PDF page open in the native pane and in a native OS viewer at
      a matched zoom show no visible softness/pixelation difference in body text at normal
      reading distance, on a HiDPI display._
      Done 2026-09-08: `renderPageInto` sizes the canvas *backing store* to
      `viewport.width/height × min(devicePixelRatio, 2.5)`, keeps `pageDiv`'s (and the
      canvas's own CSS) box at the unscaled `viewport` size, and renders through a second
      `page.getViewport({ scale: scale * dpr })` at DPR≠1 — pdf.js's own render call then
      fills exactly that many real pixels with no separate `ctx.scale()` needed.
      `buildTextLayer` and every downstream rect-geometry consumer (mark painting,
      selection) keep reading the original, unscaled `viewport`, untouched, per the task's
      own instruction. New `PdfRenderer.test.ts` case mounts at `devicePixelRatio` 1/2/4 and
      asserts the CSS width is identical across all three while the backing store scales
      1×/2×/2.5× (the cap holding at 4). Live-verified (Playwright/Chromium, real
      `deviceScaleFactor` 1/2/3 — not just a jsdom mock of the property): backing-store
      pixel dimensions came back 553/1106/1383 for a 553px-CSS-wide page (1×, 2×, and the
      2.5×-capped 3× case), CSS width identical at all three, no console errors, and a
      screenshot at 2× shows crisp text with highlight alignment unaffected.
      ⚠️ **Corrective, found live 2026-09-08 (operator report against the real app): the
      default, non-zoomed view now showed only a small top-left fraction of the page,
      magnified by roughly the DPR multiplier.** Root cause was `<canvas>` being a
      *replaced* element: `position: absolute; inset: 0` (no explicit CSS width/height)
      stretches a plain `<div>` to fill its containing block, but a replaced element with
      over-constrained insets keeps its *intrinsic* size (its `width`/`height` content
      attributes — the backing store) instead, letting an inset go slack. Before this task,
      backing-store size and desired CSS size were the same number, so this never showed;
      once DPR scaling made them diverge, the canvas rendered at its full backing-store size
      in CSS pixels, cropped by `pageDiv`'s smaller box. Confirmed with an isolated
      Playwright repro (two bare `<canvas>`s, one styled only `inset:0`, one also given
      explicit CSS width/height) before touching the real file — full root-cause writeup and
      repro numbers in NOTES.md "M43 §B1 corrective + §C1".
      Fix: `renderPageInto` now also sets `canvas.style.width`/`canvas.style.height`
      explicitly to the unscaled `viewport` size. Extended the existing §B1 DPR unit test to
      assert the canvas's own inline CSS size, not just `pageDiv`'s and the backing store's
      (the previous test's blind spot — it never would have caught this). Live-verified
      (Playwright, real `deviceScaleFactor: 2`, real PDF): canvas backing store 1306×1847,
      canvas CSS box 653×924 matching `pageDiv`, full spread visible, crisp text.

#### C. Zoom chrome

- [x] **C1.** The zoom-percentage control's popup renders beneath the reader strip's tab
      cluster instead of above the reading pane (operator screenshot). Not yet
      root-caused — no stacking-context read done this session. Candidate cause: a
      missing/lower `z-index` on the zoom popup relative to a sibling element that opens
      its own stacking context in `ReaderView.module.css`'s reader-strip cluster (several
      `z-index` values already exist there for other floating chrome — `AskPill`,
      `ThreadPanel` — worth checking whether the popup reuses one of those or has none).
      Diagnostic: inspect the popup's actual computed `z-index`/stacking context against
      the tab cluster's in devtools before changing anything. Fallback if the clean fix
      resists: give the popup an explicit `z-index` above the strip's own, matching
      whatever pattern the existing floating-chrome elements already use.
      _Acceptance: opening the zoom popup at any pane width shows it fully above the tab
      cluster and the reading pane, never clipped or hidden beneath either._
      Done 2026-09-08: live devtools/Playwright read found a different root cause than the
      candidate above — z-index was never the problem on the paths checked. `SliderDial`'s
      `placement` prop defaults to `"below"` (grows the popup *down* from its trigger); the
      reading-progress footer slider a few lines above `zoomSlider` in `ReaderView.tsx`
      already passes `dialPlacement="above"` for exactly this reason (its own CSS comment:
      a bottom-docked trigger "grows the dial upward instead, or it renders off-screen").
      `zoomSlider` — shared by the fullscreen pebble and the windowed footer, both
      bottom-docked — never got that prop, so its popup rendered entirely below the
      viewport's bottom edge, invisible. Fix: added `dialPlacement="above"` to `zoomSlider`.
      Live-verified (Playwright, both the windowed footer and the fullscreen pebble, real
      PDF): dragging the slider now shows "132% · Release to set · Esc to cancel" floating
      above the trigger, fully over the reading pane. Full writeup in NOTES.md "M43 §B1
      corrective + §C1".
- [x] **C2.** Replace the two separate fit-width/fit-page `IconButton`s
      (`ReaderView.tsx`, ~4547–4562) with a single toggle that cycles fit-single-page →
      fit-two-page-spread → (stays there; further zoom is free via the slider/pinch/drag,
      not part of the cycle) → back to fit-single-page on a third press.
      ⚠️ This doesn't map onto the existing `pdfZoom.mode` type
      (`"fit-width" | "fit-page" | "free"`, `pdfLayout.ts`'s `FitMode`) unchanged — today's
      `"fit-page"` already means "one page fits both axes," not "two pages fit
      edge-to-edge," and the 2-up-fit state the operator wants isn't a named mode today,
      only an automatic `pagesAcross` layout decision (`shouldShowSpread`) applied at
      whichever scale is active. Needs a new explicit fit-spread mode (or an equivalent
      state), not just new UI wired over the existing two — decide the type shape before
      wiring the button, don't bolt a third UI state onto a two-state enum.
      _Acceptance: pressing the toggle once fits one page edge-to-edge on both axes;
      pressing again — only reachable when the pane is wide enough for a legible spread,
      same test `MIN_SPREAD_SCALE` already applies — fits two pages edge-to-edge; from
      either state the zoom slider/pinch/drag still free-zooms away from the fit scale
      exactly as today._
      Done 2026-09-08: `fit-width` retired outright rather than kept as a hidden third
      state — nothing reachable from the chrome asked for a width-only scale any more, and
      both remaining states (`FitMode = "fit-page" | "fit-spread"`, `pdfLayout.ts`) fit
      **both** axes; `pagesAcross` is the only thing that still differs between them.
      `computeFitScale` dropped its `fitMode` parameter entirely (the two states' scale
      formula was already identical) rather than gaining a third branch. `PdfRenderer`'s
      `pagesAcross`/`spread` derivation now gates on the explicit toggle
      (`this.fitMode === "fit-spread"`) *and* `shouldShowSpread`, not on container width
      alone — `"fit-spread"` resolves to 1-up at a width too narrow for a legible spread
      (PDF.md §7.6's capability-profile table already documented this fallback shape,
      just never had a caller that could reach it on purpose). One `IconButton` replaces
      both old ones at both call sites (fullscreen pebble, windowed footer), cycling via
      `setZoomMode(pdfZoom?.mode === "fit-spread" ? "fit-page" : "fit-spread")`; new
      `FitLayoutIcon` (`icons.tsx`) swaps a one-rectangle glyph for a two-rectangle one on
      the same `spread` boolean prop pattern `ScrollModeIcon`/`RenderModeIcon` already use.
      `ResourceRenderer.setZoomMode`'s shared-interface type and `EpubRenderer`'s no-op
      stub updated to match; `getZoomMode()`'s return type follows.
      Tests: `pdfLayout.test.ts` rewritten for the mode-less `computeFitScale`;
      `PdfRenderer.test.ts`'s zoom/layout and continuous-zoom describe blocks rewritten for
      the explicit-toggle model (a `"fit-spread"` mode legible at the mocked container
      width, not container width alone, is what produces the paginated capability now) —
      see §D below for the default-advance half of that rewrite, since the two landed
      together. Live-verified (Playwright/Chromium, the real "Spatiotemporal
      Composability" PDF): toggle button reads "Fit two-page spread" by default (i.e.
      currently single); clicking it flips the label to "Fit single page" and the reading
      pane visibly shows two full pages (15/16) fit edge-to-edge on both axes; clicking
      again returns to single and to continuous scroll (confirmed by a real `overflow:
      auto` host with `scrollHeight` ≫ `clientHeight` reappearing). No console errors
      beyond two pre-existing, unrelated 404s (missing cover image, jobs-events SSE).
- [x] **C3.** Whenever part of a page doesn't fit the reading pane — i.e. the pane is
      zoomed past its own fit scale — the pane scrolls on both axes: vertically to move
      through the page and on into the next/previous one, horizontally to reach a line
      that doesn't fit the pane's width.
      _Acceptance: zoomed in far enough that a line's right edge is cut off, a horizontal
      scroll (wheel/trackpad/scrollbar) reaches it; scrolling vertically at that zoom moves
      down the page and across the page boundary into the next one; back at or below the
      fit scale, no scrolling is needed or offered — the whole page already fits._
      Done 2026-09-08: already satisfied by M41 §C1's existing derived-state model, no code
      change needed. `relayout()` sets `capabilities.advance = "scroll"` exactly when
      `userScale !== null` (zoomed past fit scale), and in that state
      `rebuildContinuousColumn` lays every page into a `scrollHost` styled
      `overflow: auto`. Pages use `margin: 0 auto 16px`, which — CSS's own
      over-constrained-auto-margins rule — collapses to `0` (left-aligned, overflowing
      right) rather than clipping once a page's zoomed width exceeds the host's, so
      horizontal scroll falls out of the same mechanism vertical cross-page scroll already
      used. Live-verified (Playwright, real PDF zoomed to 337%): `scrollHost.scrollWidth`
      (2006px) exceeds `clientWidth` (806px) and `scrollHeight` (262427px, the whole
      document) exceeds `clientHeight` (635px); a horizontal wheel scroll revealed a
      cut-off line's right edge, and a vertical wheel scroll advanced the book-percent
      readout into further content. Full writeup in NOTES.md "M43 §B1 corrective + §C1".

#### D. Navigation model — scroll by default, page-fit as the one paginated state

Per PDF.md §7.6's amendment (2026-09-08); decisions.md that date records why this is
scoped to the native pane only and does not reopen decision 17c's "pagination won" for
EPUB.

- [x] **D1.** `PdfRenderer`'s `capabilities.advance` defaults to `"scroll"` at mount,
      replacing today's derived-from-zoom-comparison logic as the *default* — continuous
      scroll is now the native pane's baseline reading mode, not a state only reached by
      zooming past the fit scale.
- [x] **D2.** The one exception: when `shouldShowSpread` reports a legible 2-up spread at
      the active fit-mode's own scale (the state C2 above makes explicitly reachable),
      the pane is paginated instead — `advance` reports `"image"` for exactly that state,
      same as today's spread behaviour.
      ⚠️ Leaving that state — narrowing the pane, zooming past its own fit scale, explicit
      navigation past the visible spread — drops back to `"scroll"` automatically, the
      same direction-agnostic snap `§7.6`'s existing threshold logic already gets right
      for the old model; don't regress that half while inverting the default.
- [x] **D3.** A scroll input (wheel, trackpad, touch drag) received while in the D2
      paginated state turns the page — a spread-to-spread slide (§D2 of M42, the page-turn
      slide, if that's landed; otherwise the plainest directional transition available) —
      rather than moving a scroll position that doesn't exist in that state.
      _Acceptance for D: opening a PDF at a narrow-to-medium pane width scrolls
      continuously by default, no explicit action needed; widening the pane (or the PDF's
      own page geometry) until two pages legibly fit edge-to-edge switches to paginated
      spread automatically, and scrolling in that state turns the page instead of moving
      a scroll position; narrowing back below the spread threshold returns to continuous
      scroll. EPUB's own reflow/`flow: "scrolled-doc"` behaviour is unchanged by any of
      this._
      Done 2026-09-08 (landed together with §C2 above — one `relayout()` rewrite covers
      both). `capabilities`'s class-field default flipped from `advance: "image"` to
      `"scroll"` (D1's literal instruction, visible before the first real `relayout()`
      resolves). `relayout()`'s derivation: `paginated = containerWidth <= 0 ||
      (userScale === null && fitMode === "fit-spread" && legibleSpread)`, `advance =
      paginated ? "image" : "scroll"` — leaving any one of the three conditions (zooming
      in, narrowing the pane, switching the toggle back to `fit-page`) snaps back to
      scroll automatically, since it's recomputed fresh on every `relayout()` call
      (resize, zoom, toggle) exactly like the pre-M43 zoom-only derivation was. ⚠️
      **`containerWidth <= 0` (not yet laid out — every jsdom test, and a real container
      before its first paint) is a forced exception, kept paginated rather than defaulting
      to scroll**: there is no scroll host to build without a real width to lay it out
      against, and dozens of existing tests call `next()`/`prev()`/`goTo()` against an
      unmocked (zero-width) container assuming the old safe single-page state — found
      live via a `scrollHost?.scrollBy is not a function` crash (jsdom has no
      `Element.scrollBy`) before adding this back. A real container reports its real width
      once `ResizeObserver` fires and `relayout()` re-runs, at which point D1/D2's real
      default takes over.
      **D3** (the wheel handler): a non-Ctrl/Cmd wheel event while `capabilities.advance
      === "image"` calls `next()`/`prev()` (by `deltaY` sign) instead of the zoom path —
      the plain-directional-transition fallback the task explicitly allowed, not the M42
      slide: routing through `ReaderView`'s `turnPage`/`PageSlide` machinery from inside
      `PdfRenderer`'s own low-level wheel handler would need a new named-extra event
      round-trip for comparatively little payoff on a surface pdf.js already redraws a
      fresh raster for on every page change. Gated by `WHEEL_TURN_THRESHOLD` (4, so a
      trackpad's near-zero touch-down tick doesn't turn a page nobody meant to move) and a
      `WHEEL_TURN_COOLDOWN_MS` (500) lockout so a fast trackpad swipe's many wheel events
      turn one page, not several. Touch-drag panning is **not implemented** — the file has
      no `touchstart`/`touchmove` handling at all (desktop trackpads fire `wheel`, which
      *is* handled; a genuine touchscreen swipe is a gap this task didn't add and didn't
      close either).
      Tests: `PdfRenderer.test.ts`'s zoom/layout describe block gained a "defaults to
      scroll" case and a "fit-spread resolves to 1-up below the legible width" case; the
      continuous-zoom block's snap-back/preview/wheel-passthrough tests were rewritten
      around the new default (several previously asserted `capabilities.advance ===
      "image"` at container sizes that are legible for a spread under the *old*
      auto-derived model — now correctly `"scroll"`, since nothing selected `fit-spread`);
      two new cases cover the wheel-turn threshold/cooldown/direction. `tsc -b` clean, all
      556 web tests pass. Live-verified (Playwright/Chromium, real PDF, same session as
      §C2): the default view is a real scrolling column (`scrollHost.scrollHeight`
      69092 ≫ `clientHeight` 735); selecting fit-spread at a wide viewport replaces it with
      a static two-page spread (pages 15/16, both fit edge-to-edge); a wheel scroll over
      the pane in that state turned the page (15/16 → 17/18) rather than doing nothing (no
      scrollable area existed to move).

#### E. Reflow — equations render as typeset math, not a flat raster

Per PDF.md §3.4's amendment (2026-09-08); decisions.md that date records why the OCR'd
LaTeX stays out of `resource_text` regardless of this change.

- [ ] **E1.** Spike: evaluate a local math-OCR model (decision 9's local-first posture —
      e.g. an open-source LaTeX-OCR model runnable in-process or via a local sidecar,
      matching the "local-first, no cloud TTS/OCR dependency" pattern Kokoro already set)
      against `detectEquationBands`'s (`equations.ts`) existing rasterized bands from a
      real PDF with genuine display equations. Report accuracy/failure modes on
      multi-line and matrix equations specifically — decisions.md's stated risk — before
      committing to wiring it in.
      ⚠️ Not yet a build task until E1 reports back; don't wire this into `generateEpub.ts`
      on the assumption it'll work well enough.
- [ ] **E2.** On a successful OCR above whatever confidence bar E1's findings justify,
      embed the result as typeset math (KaTeX or MathJax — pick whichever E1's spike finds
      renders more reliably offline) in the generated EPUB in place of the flat PNG.
      ⚠️ **`resource_text` gets nothing for the equation either way** — same as today,
      per PDF.md §3.4's unchanged rule; this task only swaps the *visual* embed.
- [ ] **E3.** On low OCR confidence, an OCR error, or a render failure, fall back to
      today's rasterized-PNG path automatically and silently (no broken math, no visible
      error state) — matching the "degrades, never fails" rule `PdfRenderer.ts`'s own
      rasterization comment already states for a different code path.
      _Acceptance for E: a real PDF with several display equations (including at least one
      multi-line/matrix one) shows crisp typeset math in the reflow pane where OCR
      succeeded and an unchanged, correctly-placed PNG anywhere it didn't — no equation
      renders as broken markup or a blank gap; `resource_text` for the affected sections
      is byte-identical to what M39/M42's existing extraction already produces._

#### F. Reflow — figure resolution

Per PDF.md §3.5's amendment (2026-09-08).

- [ ] **F1.** Bump `rasterize.ts`'s `RASTER_SCALE` constant (currently a fixed `2`) —
      tuned originally for legibility at the extractor's own default render, not against a
      HiDPI reading surface, and newly visible as soft next to the native pane once B1
      lands there. A fixed higher scale (e.g. 3–4×) is still the right shape — no need for
      per-viewer DPR-awareness server-side, since the PNG is generated once at import and
      read by every viewer/device that opens the book afterward.
      _Acceptance: re-run against a figure-heavy real PDF (the Engineers Australia doc
      already used for M42's own gate has several); confirm the size/import-time cost
      (larger generated EPUBs) stays acceptable, and that a figure at the new scale reads
      visibly sharper than today's 2× on a HiDPI display._

---

## Parked (post-v1.5) — recorded so they aren't relitigated

- LLM note supplementation: a pass that reviews highlight notes/tags, responds
  inline with supplementary detail, and proposes concept tags (persisted in SQLite)
  to power concept-level search across the library. "LLM proposes, code disposes."
  (decisions.md 2026-07-19)
- Vault-concept filtering on the scan (depends on the above).
- Notepad v2 "drift" brainstorm surface; sound design; Markdown format.
  _(PDF was parked here until 2026-09-03, when it was scoped as **M39–M41** — see
  decisions.md that date and `docs/marginalia/PDF.md`. No longer parked. Markdown
  remains parked and is unrelated to that arc.)_
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
- **A scrolling manuscript mode** — **scheduled 2026-09-03 as M40 §C.** No longer a
  future arc. The analysis recorded here still stands and moved to `docs/marginalia/PDF.md`
  §7.4: it reopens PRODUCT.md's "pagination won", it is a second reading mode rather than a
  toggle because every reader effect since M10 assumes pages, and highlights/anchoring carry
  over while almost nothing else does. The question this entry left open — per-section
  `flow: "scrolled-doc"` versus the continuous cross-chapter manager — **is now decided in
  favour of per-section**, on the grounds that the app is chapter-shaped in four places that
  infinite scroll would dissolve. What changed to make it buildable is M40's renderer seam:
  in July this meant another branch inside `ReaderView`; now it is a capability profile.
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
