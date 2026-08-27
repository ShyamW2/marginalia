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

### M30 — The highlight system: your labels, a Define button, a glossary, and a delete you can survive

Scoped 2026-08-24 (decisions.md, "Six asks, triaged"). Read that entry before starting —
in particular *why* labels are configurable and hues are not, and why Define is a
dictionary rather than a prompt. Three of the operator's six asks landed here because they
are one pass over the same subsystem.

**The rule this milestone must not break:** a highlight kind's **identity is its slot, not
its presentation**. `rose|sage|honey|slate` are permanent stored values; label and hue are
renderings. Renaming a kind never migrates a row.

#### A. Kind labels become a setting

- [x] Move the four labels out of `web/src/reader/highlightKinds.ts:6` (`KIND_LABELS`) into
      the settings store (`server/src/settings/store.ts` `DEFAULTS` + `KEY_TO_FIELD`,
      `shared/src/schemas.ts`'s `Settings`). Defaults are the operator's names, which differ
      from today's on two slots: `sage` = **Define** (was "Definition"), `slate` =
      **Thematic Question** (was "Question"), `rose` = **Regular annotation** (was
      "Revisit"), `honey` = **Key quote** (was "Quote").
      _Done: `kindLabelRose/Sage/Honey/Slate` on `Settings`, defaulted exactly as above._
- [x] Edit them from a new **Highlights** section in `web/src/settings/tabs/ReadingTab.tsx`
      (not a new tab — four text fields do not earn one).
- [x] Every consumer reads the setting, not the constant. All of them, verified:
      `AskPill.tsx:53-54` (`title` *and* `aria-label`), `AnnotationsOverview.tsx:80`, and
      the scan's filter key via `ScanPage.tsx:480`. ⚠️ `ScanPage` currently renders kind
      chips from `KIND_ORDER` (`scan/scanPalette.ts:29`) and has no label import at all —
      it is the one that will be missed.
      _Done: `ScanPage.tsx` fetches `kindLabelsFromSettings` and titles/`aria-label`s its
      filter chips from it (verified by reading — this is exactly the site the warning
      named)._
- [x] An empty label falls back to the default rather than rendering a nameless dot.
      _Acceptance: clearing a label field and reloading shows the default name, not a blank
      tooltip or an empty `aria-label`._
      _Done: `kindLabelsFromSettings` (`highlightKinds.ts`) is the single resolver every
      consumer above goes through — `settings.kindLabelX || DEFAULT_KIND_LABELS[kind]`._

_Verified 2026-08-27 by reading the shipped code against this section's own acceptance line
(not re-decided): renaming a slot's label only touches the setting; `HighlightKind`
(`rose|sage|honey|slate`) never changes, so `SELECT DISTINCT kind FROM highlights` is
unaffected by construction._

_Acceptance for A: renaming `honey` to "Banger" changes the pill tooltip, the pill's
screen-reader name, the annotations overview row, and the scan's filter chip — and changes
nothing in the database (`SELECT DISTINCT kind FROM highlights` still returns the four slot
names)._

#### B. Slate moves from blue to purple

- [x] ⚠️ **Not a one-line change.** Three coupled places, and a solve:
      `--kind-slate` (`web/src/theme.css:58`), `PHOSPHOR_RGB.slate`
      (`web/src/scan/scanPalette.ts:14`), and the **theme-ramp separation solve** that
      `theme.css:63-75` documents — those eight ramp hues were chosen against the four kind
      hues, and `scanPalette.ts`'s eight phosphor ramp hues were solved separately against
      the four *phosphor* kind hues. Moving slate invalidates both solves.
      _Done: `--kind-slate: #9c7fb3` (purple); `PHOSPHOR_RGB.slate` moved 200°→258°._
- [x] Re-run both solves and record the new minimum separation in the same comments, in the
      same form the existing ones use.
      _Done: `theme.css` records 28.0° minimum across the 12 paper hues; `scanPalette.ts`
      records 26.8° across the 12 phosphor hues — both re-solved fresh against slate's new
      hue, both ≥ the 25° floor below._

_Acceptance: minimum pairwise hue separation across the 12 paper hues is ≥ 25°, and across
the 12 phosphor hues is ≥ 25°, with the numbers written into the comments. A purple slate
sitting next to `--theme-ramp-5` (violet) on the digest page must still be tellable apart._
_Verified 2026-08-27 by reading `theme.css:63-76` and `scanPalette.ts:29-58`: both numbers
are written into the comments and both clear the 25° floor._

#### C. The Define button

Dictionary first, digest fallback, hard-capped. Reasoning in decisions.md; do not
re-decide it.

- [x] Add **Define** to the selection pill (`web/src/reader/AskPill.tsx`) — enabled only
      when the selection is short enough to be a term. ⚠️ Decide the threshold once and put
      it in code with the reason: a paragraph is not a word, and Define on a paragraph
      produces a bad answer rather than an error.
      _Done: `shared/src/defineTerm.ts` — ≤4 words, ≤48 chars, with the reason in the file.
      **Shared** by both sides on purpose: the pill enables/disables from it and the server
      rejects from it, so the button can never offer a lookup the server refuses. Disabled
      rather than hidden, with the rule in the tooltip — a control that vanishes reads as a
      bug._
- [x] Define creates a **sage** highlight (never a new kind) and attaches the definition to
      it. It does not open the thread panel unless the reader asks — this is a lookup, not
      a conversation.
      _Done: `ReaderView.handleDefine`. The answer lands in a `DefinitionCard` anchored where
      the selection was; "Ask about this" on that card is the only path to a thread, and it
      escalates the same sage highlight rather than starting a second one._
- [x] **Path 1, local dictionary.** A bundled dataset behind its own narrow module, the way
      `audio/engine.ts` fronts TTS. No network. ⚠️ Settled decision 10: a dictionary *API*
      would be a third named cloud exception and is **not** authorised by this milestone.
      _Done: WordNet 3.1 (`wordnet-db`, files only) behind `dictionary/engine.ts`, read by
      **binary search over the sorted index files on disk** — ~20 reads per lookup, no
      in-memory index, 1–4ms measured. No network anywhere in the path. ⚠️ The dataset ships
      no exception lists, so irregular inflections ("mice", "went") miss and fall through to
      path 2 — recorded in NOTES.md rather than papered over._
- [x] **Path 2, fallback only.** On a dictionary miss, one digest-grounded call (decision 8's
      M17 ladder — the digest rung, *not* whole-book) with a **<100 output token cap**. The
      cap is a product constraint: a definition that runs long has stopped being a
      definition.
      _Done, with **two corrections found by driving it live** — both in NOTES.md, and both
      would otherwise have shipped looking like the empty state working correctly:_
      _(a) **The cap must not be passed to the provider.** On a reasoning model a small
      output ceiling buys silence, not brevity — the budget goes to thinking tokens that
      arrive in `reasoning_content` and never reach the visible answer. Measured on the
      operator's own query provider: 90 → empty, 1,024 → empty, **2,000 (their actual
      setting) → empty in 6 of 6 trials**, 4,000 and 8,192 → a correct one-sentence answer.
      The <100-token cap is enforced on our side instead — the stream stops on visible text,
      then `clampToTokenBudget` trims to a sentence boundary — and Define asks the provider
      for a headroom floor, which it is uniquely allowed to do **because it caps the
      reader-visible answer itself**. ⚠️ The general finding is bigger than M30 and is left
      open in NOTES.md: a reader's `max_response_tokens` can silently disable any feature on
      a reasoning model, because it bounds thinking rather than the answer._
      _(b) **The rung was right; its passage component was not.** Reusing `buildDigestContext`
      wholesale shipped a 107,105-character context on East of Eden, 96,811 of it whole
      surrounding sections — and overflowed the model outright. A definition wants the places
      the word is **used**, not the pages around the highlight: same rung, occurrence windows
      via `findAllOccurrences`, **107k chars → ~1.1k input tokens**._
- [x] Both paths are **designed states on failure** — no dictionary hit and no provider
      configured shows "no definition found", never a spinner and never a crash.
      _Done: the route answers 200 for every miss so nothing becomes an error toast, and the
      card distinguishes "not in the dictionary" from "no provider connected" — they ask the
      reader for different things._

_Acceptance: Define on a common English word the book merely uses returns a dictionary
result with the LLM provider fully disconnected. Define on a term the book coins misses the
dictionary and returns a digest-grounded answer under 100 tokens. Define with no provider
configured **and** a dictionary miss shows a designed empty state._

#### D. The glossary

- [x] A per-book glossary listing this book's sage highlights that carry a definition, with
      jump-to-passage. Surface it as an instrument over the reader (settled decision 13 —
      an instrument, **not** a fourth room), alongside the annotations overview.
      _Done: `reader/Glossary.tsx`, same shape and same corner as `AnnotationsOverview` so
      the two read as siblings, and mutually exclusive with it. Its strip button appears
      only once the book has an entry — an empty control advertising an unused feature is
      chrome, not an affordance. Jump-to-passage **navigates without opening a thread**,
      unlike the annotations overview's jump: a glossary entry is a word you looked up, not
      a conversation._
- [x] ⚠️ **No new table.** It is a filtered view over `highlights`. A `glossary` table would
      be a second source of truth and would go stale the moment a definition highlight is
      deleted.
      _Done: `glossaryEntries()` is the single filter (`kind === "sage"` **and** a non-empty
      definition), used by both the panel and the strip's count so the two cannot disagree.
      The definition lives in two columns on `highlights` (migration 26), so `deleteHighlight`
      already cleans it up — there is no cascade to write and none to forget._

_Acceptance: defining three words then opening the glossary lists exactly those three, in
reading order; deleting one removes it from the glossary with no separate cleanup step._

#### E. Delete: fix the hazard, then widen the affordance

⚠️ **Do E1 before E2.** `deleteHighlight` (`server/src/annotations/highlights.ts:202`)
drops the highlight, its thread, every message in that thread, and its `publishes` ledger
rows in one transaction, with no confirmation anywhere. `MarginRail.tsx:71-82` puts that
`×` next to the navigate target. Adding more delete buttons before this is fixed multiplies
a live data-loss path.

- [x] **E1.** Guard the destructive case. **Choose one, not both: a confirm step, or an undo
      window.** Recommendation: confirm only when the highlight has a thread with messages
      (deleting a bare highlight is cheap and reversible by re-highlighting; deleting a
      conversation is not), and say in the prompt *how many messages* are about to go.
      _Done: took the recommendation. `ThreadSummary` grew a real `messageCount`
      (`listHighlightsWithThreadsForResource`'s own COUNT, not a guess) so every call site
      can gate on it without a fetch. `handleDeleteHighlight` (`ReaderView.tsx`) is now the
      single gated entry point every delete goes through — 0 messages deletes immediately
      (unchanged), 1+ opens `DeleteConfirmDialog` naming the count; the actual
      `deleteHighlight` request moved to `performDeleteHighlight`, called only on confirm._
- [x] **E2.** Delete from the thread panel (`web/src/threads/ThreadPanel.tsx`) — the panel
      already takes `onClose`, `onNoteChange` and the rest, so this is one more prop through
      the same seam to `handleDeleteHighlight` (`ReaderView.tsx:2592`), not new logic.
      _Done exactly as scoped: one `onDelete` prop, a trash-icon button in `.metaRow`, wired
      to `() => handleDeleteHighlight(expandedHighlight)` — the same gated entry point E1
      built, so a threaded delete from the panel confirms too._
- [x] Fixed alongside E, from operator feedback on the shipped affordance: `MarginRail`'s
      hover-reveal `×` sat behind a `margin-left` gap with no element under it, so a cursor
      moving from the dot toward the button crossed dead space, dropped `:hover` (and with
      it the button's own opacity/pointer-events) before ever arriving, and the X vanished
      mid-transit ("when I move the cursor to the X, it disappears"). Fixed with an
      out-of-flow `::after` bridge sized to exactly that gap — plugs the dead zone without
      overlapping the button's own hit box (so it can't steal its clicks) or changing the
      dot's resting position (`MarginRail.module.css`).

_Acceptance: deleting a highlight carrying a 6-message thread warns and names the count;
deleting an un-threaded highlight does not interrupt. Cancelling leaves the thread intact
(re-open it and the messages are still there). The panel's delete closes the panel and
removes the mark without a reload._

#### F. Operator feedback on Define, folded in with E (2026-08-27)

Reasoning in decisions.md's same-date entry; do not re-decide it here.

- [x] The digest fallback (M30 C's "Path 2") no longer runs automatically on a dictionary
      miss — it's gated behind an explicit "Look deeper" the reader clicks.
      _Done: `Definition.reason` grew a fourth value, `dictionary_miss`; `defineHighlight`
      returns it (instead of running the fallback) whenever a query-role provider is
      configured. `DefinitionCard` renders it as an offer, not a `Looking up…` state._
- [x] The deeper search narrates its real stages — never a fabricated chain-of-thought —
      and lets the reader pick which configured role answers.
      _Done: `deepenDefinition` (`dictionary/define.ts`) is an async generator yielding
      `step` events for its actual stages (searching the text, reading context around what
      it found, asking the model), then `text` chunks as the answer streams, over a new SSE
      route (`POST /api/highlights/:id/definition/deepen`, `streamDefine.ts` client-side —
      same `data: {...}\n\n` contract as `threads/streamThread.ts`). The role picker reuses
      `useProviderRoles()` — no new provider-selection surface._
- [x] The definition popup is moveable.
      _Done: same drag mechanics as `ThreadPanel`'s M14 "movable sticky notes"
      (`dragControls`, `dragConstraints={appBoundsRef}`, armed from the header's own
      pointerdown). Not persisted — a fresh Define always re-anchors at the new selection._

_Acceptance: a dictionary miss with a provider configured shows a "Look deeper" offer and a
role picker, and makes no `/definition/deepen` request until the reader clicks it. Clicking
it narrates at least one real stage before the answer streams in. The card can be dragged by
its header without losing its content or breaking "Ask about this"._

#### Verify

- [x] Drive it live on a real book. Rename all four labels to nonsense and confirm the scan
      chips changed too — that is the consumer most likely to have been missed.
      _Done 2026-08-27, live on East of Eden against the running dev server: `PUT /api/settings`
      with all four labels set to `Zonk1..4`, then the Scan panel's own filter chips read back
      `aria-label="Filter by Zonk1"` through `"Zonk4"` (Playwright) — confirming the consumer
      TASKS.md flagged as the one most likely to be missed wasn't. Labels restored to their
      defaults afterward._
- [x] Define one common word and one book-specific term, with the provider disconnected for
      the first.
      _Done, live on East of Eden. Common words ("ineffable", "phalanx", "serendipity")
      answer from the dictionary in **1–4ms with no provider involved at all** — the
      offline path M30 C makes primary. A paragraph is refused as `not_a_term` rather than
      defined badly. The book-specific term ("timshel", 6 occurrences in the text) exercises
      the fallback: it is what surfaced both corrections above, and with the headroom floor
      in place it answers correctly in **3 of 3** repeat trials — "a Hebrew word translating
      to thou mayest… the capacity to choose between good and evil" — each well inside the
      100-token cap. ⚠️ **What is not verified: how it feels.** A reasoning model takes
      **100–140s** to answer, against 1–4ms for the dictionary. The card never blocks the
      page, but that asymmetry has only been measured in a script, not read on a page._
- [x] **(M30 D)** Define three words, open the glossary, then delete one.
      _Done: the three appear in reading order and nothing else does; deleting one removes
      its glossary entry with no cleanup step, because the definition lives on the highlight
      row rather than in a table of its own._
- [x] Delete a threaded highlight from the margin rail and cancel; confirm the thread
      survived by reopening it.
      _Done 2026-08-27, live on East of Eden against the running dev server (Playwright,
      real drags/clicks, a real answered thread from the local Qwen3.5 provider — not a
      mock). Margin-rail delete on a 2-message thread opened `DeleteConfirmDialog` reading
      "Delete this highlight and its thread — 2 messages will go with it."; Cancel closed it
      and the highlight + its `messageCount: 2` thread were unchanged via a fresh
      `GET /highlights` (re-verified after a corrected wait — the first pass's dialog check
      raced the exit animation). The panel's own delete button (M30 E2) opened the same
      dialog; confirming it there closed the panel and removed the highlight for real._
      _⚠️ This drive-live pass **found and fixed a real, pre-existing bug**, not introduced by
      M30 E: `deleteHighlight` (`server/src/annotations/highlights.ts`) never cleaned up
      `highlight_tags`, `highlight_themes`, or `llm_usage.message_id` — with `foreign_keys =
      ON` (db.ts), deleting **any** tagged, theme-tagged, or usage-tracked highlight (i.e.
      any highlight with a real answered thread, which is the common case) failed the whole
      transaction with a 500 instead of the designed 204. Caught live on exactly the
      confirm-then-delete flow this milestone added, because the existing test coverage
      never exercised a `messages` row with a linked `llm_usage` row. Fixed the same way
      `deleteProviderProfile` already handles its own dangling FK: null the usage ledger's
      reference (the cost stays in the accounting history), delete the tag/theme rows
      outright. Regression test added in `highlights.test.ts`. See decisions.md 2026-08-27._
      _Also fixed on this pass, found by the operator driving the shipped M30 E affordance:
      `MarginRail`'s hover-reveal delete button had a dead-hover-zone bug (see section E
      above) — confirmed both broken (with the fix reverted) and fixed (restored) live via
      Playwright, stepping the cursor pixel-by-pixel from the dot to the button._
      _Also verified live in the same pass: the M30 E feedback deep-search flow end to end
      against the real local model — `dictionary_miss` on a genuine miss ("timshel"), no
      automatic call; the SSE stream narrated its real stages
      (`Searching "East of Eden…" for "timshel"…` → `Reading context around 6
      occurrences…` → `Asking Qwen3.5 for a definition…`) then streamed a correct
      definition token-by-token; and the draggable card itself — selecting "outskirts" in a
      live page, clicking Define, and dragging the resulting card by its header moved it by
      exactly the drag delta (120, 80 px) with the card staying fully intact and functional.
      All test highlights created for these checks were deleted afterward._

---

### M31 — The pointer contract: fix the edges, then build touch

Scoped 2026-08-24; **the rule was decided 2026-08-27** (decisions.md, "Click-to-turn is
retired"). ⚠️ **Read DESIGN.md "The pointer contract" first — it is binding and this
milestone implements it.** Do not re-decide the disambiguation rule; it exists, with
numbers.

Two things were true when this was scoped and are still true: there is no touch handling in
the reader at all (no `touchstart`, no `-webkit-touch-callout`, no `contextmenu` handler),
and the operator's framing described an intent, not the app. What changed is that a live
bug turned up first — you cannot start a highlight near either edge of the page — and its
fix and the touch layer are the same piece of work, because they are one pointer stream.

**Order matters: A, then B, then C and D.** A is what makes the edges usable at all; B and
C sit on top of it.

#### 0. The iPad is real — make the app fit the window before judging anything on it

⚠️ **Do this first.** Every touch judgement in A–C is being made on an iPad running the app
in a browser. Until the app fills the window and stops zooming, none of those judgements are
about our gestures. See decisions.md 2026-08-27 (later) for the diagnosis.

- [x] **0a.** Replace `100vh` with `100dvh` (keeping a `100vh` fallback line above it) in
      `ReaderView.module.css:11` and `:632`, `ReaderPage.module.css:6`, and audit
      `DeskCanvas.module.css`'s `calc(100vh - 200px)`. ⚠️ This is **our bug, not Safari's**:
      iOS `100vh` is the *large* viewport — the height the page would have with the toolbars
      retracted — so with toolbars showing the app is always taller than the window by
      exactly the toolbar height, which is the reported "scroll down to see the bottom
      tiles". **Done 2026-08-27**: both `ReaderView.module.css` rules (`.wrapper`,
      `.wrapperFullscreen`) and `ReaderPage.module.css`'s `.page` now carry a `100dvh`
      line after the `100vh` fallback. Audit of `DeskCanvas.module.css` concluded the same
      bug applies — `.surface` and `.tiltLayer`'s `calc(100vh - 200px)` over-reserve by the
      toolbar height on iOS — so both got the matching `calc(100dvh - 200px)` second line.
- [x] **0b.** `overscroll-behavior: none` on `html, body` — kills the rubber-band and the
      pull-to-refresh that currently reloads the page on a downward swipe. **Done
      2026-08-27**, added in `theme.css` next to the existing `html, body, #root` block.
- [x] **0c.** Ship a web app manifest (name, `display: standalone`, theme colour, and a
      180×180 `apple-touch-icon` — Safari will not use a maskable-only icon set) plus
      `apple-mobile-web-app-capable`, and add
      `viewport-fit=cover` with `env(safe-area-inset-*)` padding. `index.html` has none of
      these today. Added to the Home Screen, standalone mode removes Safari's page zoom, its
      pull-to-refresh and its toolbars at once — which makes 0a and 0b belt-and-braces
      rather than the only defence. **Done 2026-08-27**: `web/public/manifest.webmanifest`
      + a generated placeholder `apple-touch-icon.png` (180×180, no brand asset existed to
      draw from — swap for a real mark whenever one exists), wired into `index.html`
      alongside `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`,
      `apple-mobile-web-app-title` and `viewport-fit=cover` on the viewport meta.
      `env(safe-area-inset-*)` padding landed on the two places it's load-bearing: the
      app-shell `NavCluster`'s fixed top-right corner, and the reader's `.wrapper` padding
      and fullscreen `.immersivePebble` bottom offset.
- [x] **0d.** Block WebKit's page zoom for the in-browser case: `preventDefault` on
      `gesturestart`/`gesturechange`. ⚠️ **Do not add `user-scalable=no`** — iOS Safari has
      deliberately ignored it since iOS 10 and it will look like it worked in a desktop
      emulator. ⚠️ Blocking page zoom is what frees pinch for text size (C6); do not ship
      one without the other, or the reader loses zoom and gains nothing. **Done
      2026-08-27**: `app/useBlockPageZoom.ts`, a `document`-level `gesturestart`/
      `gesturechange` listener wired in at `App()` alongside `useAccent`/`usePaperTint` —
      app-wide, not per-room, since both the Scan's pinch (B) and text-resize (C6) will
      need the gesture free everywhere. C6 itself is not built yet; only the zoom-blocking
      half of this pairing exists so far.
      ⚠️ **Verified live 2026-08-27: two different pinches, only one of them ours.** The
      operator's report was "pinch still zooms" — turns out to be two gestures conflated.
      **Pinch-to-reveal-open-tabs** is iPadOS Safari's own multitasking gesture (same family
      as pinching closed on the Home Screen); it runs in Safari's native chrome, never
      reaches the page's content view, and no web-page API — `preventDefault`, `touch-action`,
      anything — can intercept it. Not a bug, not in scope, not fixable from here, standalone
      mode or not. **Pinch-to-magnify-the-page-content** is the real target and is still
      broken: the listener is on the parent `document`, epub.js renders each section into its
      own `sandbox="allow-same-origin"` iframe, and DOM events (gesture events included) never
      bubble across a frame boundary — the exact fact M31 C2 already names for
      `touchstart`/`move`/`end`, just not yet applied here. A pinch that starts over app
      chrome outside the iframe is still blocked; one over the book page itself is not. Left
      as a stub rather than chased now — the operator's call, since it is moot the moment this
      stops being a bare Safari tab (standalone/Home-Screen mode removes system pinch-zoom
      outright per the note above, and a future native wrapper removes it a second way).
      If it is ever worth fixing in-tab, the fix is C2's: attach the same listener to each
      section's `contents.document` as epub.js renders it, not a second mechanism.
- [x] **0e.** ⚠️ **The app has zero width-based media queries** — measured 2026-08-23
      (decisions.md): all seven `@media` rules are `prefers-reduced-motion` or
      `prefers-color-scheme`. Nothing about the layout currently responds to an iPad in
      portrait. Decide in this milestone whether that is fine (the reader is a centred
      column and may well be) or whether portrait needs the spread forced to single-page —
      `SPREAD_MIN_WIDTH` already does that at 960px, so check before adding a query.
      **Decided 2026-08-27: no query.** `SPREAD_MIN_WIDTH` (960px, `readerGeometry.ts`) is
      already a container-width check, not a device/orientation one, and every current
      iPad's portrait CSS width sits under it except the 12.9" Pro (1024px) — which is
      wide enough to read two facing pages legibly, the same test the threshold already
      applies on a wide desktop window. That's a legitimate spread, not a bug, so no
      portrait-specific query was added; revisit only if the 12.9" spread reads cramped on
      real hardware.

##### The page snapshot renders wrong on iPad (0f–0h)

Reported 2026-08-27 with three screenshots: the curling leaf, the departing leaf in slide
mode, and the book-opening, all showing the page's text **at roughly twice its size, cropped
to a band, with empty gaps above and below** — and in the opening's case, **black** bands
rather than paper-coloured ones. Not touch work; it is here because every page turn on the
device looks broken, and no gesture in A–C can be judged through it.

⚠️ **What the screenshots already prove — do not re-investigate these.** In the slide
screenshot the snapshot's line breaks are character-for-character the live page's ("by the
ease with which they a…", "determined by the extent of…", "topics populate the mind eve…").
So the section CSS, the column layout, the measure and the `@font-face` files **all
serialized correctly**. That eliminates failure modes 1 and 2 of `pageSnapshot.ts`'s own
docstring and most of PAGE_CURL.md §5 — the two most fragile parts of that file are fine.
**The fault is in the geometry, not the serialization.**

⚠️ **The black bands are the second piece of evidence.** `buildSnapshotSvg` paints the
paper colour across the whole SVG and `composeCardSnapshot` fills paper before drawing, so a
misplaced-but-correctly-sized bitmap would show **paper** in the gaps. Black means the
region is outside both — the consumer is painting a rect larger than the bitmap it holds.
That distinguishes *wrong offset* from *wrong extent*, and it points at extent.

- [x] **0f.** Does it reproduce on the Mac? **No — answered by the operator 2026-08-27. The
      fault is iPad-only; the Mac is clean.** That matters more than it sounds, because
      `scale` in `rasterize` is `min(devicePixelRatio, 1.5)` — **1.5 on both machines** — so
      device pixel ratio is ruled out as the cause. What is left is something measured
      differently on that device, which is the same shape as 0a. **0g is now the leading
      hypothesis, not one of several.**
- [x] **0g.** ⚠️ **Re-test after 0a — the leading hypothesis, per 0f.** Both known iPad
      faults are viewport-measurement faults, and both are absent on the Mac.
      `CaptureViewport` and `CardLayout` are measured off the reader's own boxes, and
      0a establishes those boxes are taller than the visible window on this device.
      `cardCompositeRect` recovers scale as a *ratio*
      (`bitmapWidth / layout.contentWidth`) — exactly the shape of code that is silently
      wrong when one of its two inputs was measured on a viewport that is not the visible
      one. This may change or vanish once the layout is fixed. Do not fix it before 0a.
      **Re-tested 2026-08-27, after 0a: still reproduces.** The hypothesis did not resolve
      on its own — 0h's instrumentation is next, not a second guess.
- [x] **0h.** If it survives 0a: instrument rather than guess. Log `viewport.width/height`,
      `canvas.width/height` in `rasterize`, `image.naturalWidth/naturalHeight` and
      `layout.contentWidth` in `composeCardSnapshot`, on the Mac and on the iPad, and dump
      the intermediate PNG. One comparison of those five numbers across the two machines
      settles which stage diverges. ⚠️ **The cause is not established — do not guess it in
      the fix.** Known-good fallback if the clean fix resists: size the canvas in CSS px and
      apply `ctx.scale(scale, scale)` before `drawImage` at intrinsic size, instead of
      passing a scaled destination rect — same output, one less place for an SVG image's
      intrinsic size to be interpreted differently.
      **Instrumentation added 2026-08-27**, not yet run on the iPad. `pageSnapshot.ts`'s
      `rasterize` and `cardSnapshot.ts`'s `composeCardSnapshot` each log their numbers via
      `console.debug` (DEV-gated, `[marginalia]`-tagged) and stash their PNG on
      `window.__marginaliaSnapshotDebug` (`snapshotDebug.ts`) — `.rasterizeDataUrl` /
      `.composedDataUrl`, either pasteable into a new tab's address bar to view the
      intermediate bitmap directly, since logging a full data URL to the console is not
      practical at page-image size. **Next: open Safari's Develop menu on the Mac, inspect
      the iPad's tab, turn a page, and compare both consoles' numbers and images against the
      same turn done on the Mac** — that comparison is what decides which stage diverges;
      do not apply the CSS-`scale` fallback until it does.
- [x] **0i.** Found before 0h's console comparison was even run: the operator's Web
      Inspector session showed no `[marginalia]` log at all after a real page turn — the
      capture never reached `rasterize`. Console instead showed
      `Promoted URL from http://www.w3.org/1999/xhtml to https` (Safari's own mixed-content
      upgrade notice) followed by a CORS failure fetching it. Traced to
      `inlineCssUrls`/`CSS_URL` (`pageSnapshot.ts`): EPUB content CSS routinely opens with
      `@namespace url(http://www.w3.org/1999/xhtml);` and/or
      `@namespace epub url(http://www.idpf.org/2007/ops);` — an XML namespace identifier,
      never a fetchable asset — and the regex cannot tell that apart from a real
      `@font-face`/`background` `url()`. The resulting fetch always fails (a real
      w3.org/idpf.org URL, CORS-blocked from this origin) while costing a full network
      round-trip, and live on the iPad it was slow enough to plausibly blow
      `CAPTURE_TIMEOUT_MS` and silently abort the whole capture before `rasterize` ever ran
      — a more specific candidate than 0g's viewport theory for *why iPad and not the Mac*,
      if the Mac's earlier pass had a faster path to the same failing request rather than a
      genuinely different geometry. **Fixed**: `NAMESPACE_RULE` strips `@namespace ...
      url(...);` from the text `CSS_URL` searches (not from the returned CSS — the
      declaration itself is harmless and stays), so the namespace's `url()` is never added
      to the fetch set. Covered by a new `pageSnapshot.test.ts` case; does not by itself
      confirm or rule out 0g's hypothesis — re-run 0h's comparison now that this stops
      contaminating it.

_Acceptance: on the iPad — a curl, a slide and a book-opening each show the departing page
at the same size and position as the live page under it, with no band, no gap and no black.
The same three, unchanged, on the Mac. Whatever is learned goes into PAGE_CURL.md §5 as a
fifth way the capture fails silently._

_Acceptance: on the iPad, in Safari and again from the Home Screen — the reader's foot is
visible without scrolling, in portrait and landscape, with the toolbars both shown and
hidden; a downward swipe does not reload; a two-finger pinch does not scale the page._

#### A. Retire click-to-turn and make the grab surface step aside

- [x] **A1.** Delete the click-turn branch of `handleContentClick`
      (`ReaderView.tsx:2044-2047`). Its remaining jobs are: ignore `a[href]`, and clear
      `pendingSelection`. ⚠️ **Do not delete `turnZoneForVisibleX`** — it stays as the
      region M19.6's dwell listens in (invariant 4). `readerGeometry.test.ts` characterizes
      it; those tests stay green untouched.
      _Done. `handleContentClick` is down to its two remaining jobs, and the whole
      coordinate-translation block went with the turn — the mark hit-test inside it existed
      only to stop a mark click from *also* turning. `turnZoneForVisibleX` and its tests are
      untouched. Verified live: a click turns nothing, over ink, over either outer margin,
      or in the gutter._
- [x] **A2.** Add the ink test beside `caretRangeAt` in `reader/pageTextEdge.ts`: caret at
      the point → extend one character → `getClientRects()` → is the point inside a line
      box. ⚠️ `caretRangeAt` **snaps to the nearest caret and never returns null in a
      margin**, so calling it alone answers the wrong question. Unit-testable with a fake
      document; do it.
      _Done — `pointIsOverInk`, with `pageTextEdge.test.ts` against a fake document whose
      `caretRangeFromPoint` snaps from anywhere, as a real engine does. ⚠️ **One thing the
      recipe misses: probe both directions.** A point in the space *between two words* can
      snap to the caret **after** the space, whose forward character starts to the right of
      the point — forward-only probing calls the inter-word gap "paper" and turns the page
      under a reader trying to select in it. The backward probe is the space's own rect,
      which contains the point. Both are separate test cases._
- [x] **A3.** Drive `.turnGrabSurface`'s `pointer-events` off that test, from the forwarded
      mousemove `handleContentMouseMove` already receives. Over ink → `none`, so the press
      falls through to the iframe and native selection works at the very edge. Over paper →
      `auto`. ⚠️ The surface stays a parent-document element: it needs `setPointerCapture`,
      capture needs a real parent-document `pointerdown`, and an uncaptured drag crossing
      the sandboxed iframe is a **reproduced tab crash** (NOTES.md M10). Make it step
      aside; never delete it.
      _Done, and it took **two** move handlers, not one: an armed surface covers the iframe,
      so epub.js's forwarded mousemove stops arriving and the answer could never change
      back. `handleContentMouseMove` covers the page while the surface stands aside;
      `.stage`'s own `onPointerMove` covers it while it does not, and covers the outer
      margin, which is not inside the iframe at all. Neither is redundant._
      _⚠️ **Two things the task does not mention, both load-bearing.** (1) The test must be
      clamped to `.epubContainer`'s box: measured live, the section iframe is **17910px wide
      starting at x = −3501**, so a point out in the outer margin maps cleanly onto a glyph
      in a column nobody can see, and the most important piece of paper on the page reports
      ink. (2) The answer is **frozen for the life of a press** — a drag-selection held past
      the last word is over paper, and re-arming a parent-document element under a live
      native selection drag is not a thing to find out about in the field. M19.6's own
      `isPointerDownInContentRef` is exactly the right guard, unchanged._
- [x] **A4.** Widen the surface from the edge ellipse to *all paper* — outer margins,
      spine gutter, below the last line — since it now only exists where there is no ink.
      _Done: one element at `inset: 0`, replacing the two ellipses. ⚠️ Its CSS default is now
      `pointer-events: none` and JS arms it **only for a mouse or pen** — touch has no hover
      moves to arm it with, so arming for a finger means arming *by default*, which is
      invariant 1 broken for touch exactly as it was for the mouse. That removes M20's
      touch-drag-on-the-edge-ellipse curl, which works on the iPad **today**; it is
      deliberate (the touch table says a drag *anywhere* turns, so the ellipse was always
      the wrong affordance for a finger) and **C1 is its replacement**, not a nice-to-have
      after it. decisions.md 2026-08-27 later still._
- [x] **A5.** Direction from the drag, not the grab point. `handleGrabPointerDown` is
      currently handed `"prev"`/`"next"` by which strip was hit and acts on it at once: it
      advances the rendition under the covers so the peeling sheet has a real page behind
      it, then steps back by CFI on spring-back. ⚠️ **Defer everything until the drag
      declares a dominant horizontal axis past 6px** — snapshot, advance, and paint only
      then. Drag left → forward, drag right → back. Vertical drags do nothing.
      _Bonus, state it in the commit: this removes the wasted advance-and-step-back a stray
      press on the old strip used to cost._
      _Done. `handleGrabPointerDown` now only *arms* — though it must still take pointer
      capture on the press itself, since by 6px the pointer may already be over the iframe,
      where there is no second chance to ask. `beginGrabDrag` holds everything that used to
      run at pointerdown and is not called until `declaredTurnDirection` says so; that
      helper is pure, lives in `readerGeometry.ts`, and has its own tests including the 45°
      case it refuses rather than guesses._
      _⚠️ **The pinch had to be re-derived, not re-pointed.** The grab's **x stops being an
      input at all** — in leaf coordinates it is frequently outside the leaf and sometimes
      negative (grab the left page's outer margin, drag left, and the turning edge is the
      right leaf's). Only its height survives, as `anchorForPinch`'s `t`. And the fold
      pointer is no longer the raw grab point but **anchor + travel**: the raw point was
      fine while the surface hugged the turning edge and the fold's `dist` started near
      zero, but a mid-page grab would have started the fold half-turned. The sheet now
      literally follows the finger, and for a grab on the edge the two are the same point._
      _Verified live from the **same** grab point in the spine gutter: left → 4→5, right →
      5→4, straight down → nothing. Both renderers exercised mid-drag from that grab._
- [x] **A6.** Stop the affordances lying (invariant 5). The `w-resize`/`e-resize` cursor and
      the turn-zone vignette both advertise click-to-turn. Over paper: a grab cursor, and
      the glow follows the grabbable paper. Over ink: neither.
      _Done — the `w-resize`/`e-resize` rung is gone from the iframe cursor's precedence
      list (the `custom` nib during a selection is all that is left of it), and the grab
      surface's own `cursor: grab` is what shows over paper. ⚠️ **One call the task leaves
      open, recorded in decisions.md:** the glow lights **both** ellipses at once. Paper is
      now the whole page outside the ink and the direction is not a property of where you
      press, so a one-sided glow would advertise a direction the page does not have yet._
- [x] **A7.** A live selection disarms the grab surface (invariant 3) — today a press on it
      mid-selection starts a curl, which destroys the selection *and* costs an advance and
      a step-back. The M19.6 dwell is the one exception and is unaffected.
      _Done, and note **which way** it disarms: the surface stays armed so the press is
      *swallowed*, rather than stepping aside and letting it through to the iframe, where
      the native mousedown would collapse the selection. The acceptance criterion wants the
      selection intact, which "step aside" would not have given. Verified live:
      press-and-drag on the outer margin while holding a selection left the page unchanged
      and the selection byte-identical. The dwell was re-verified end to end — ring raised,
      page turned on the hold, selection kept — and is untouched._

_Acceptance: in **spread mode at 90% zoom** — the case that produced the report — a drag
begun on the first character of the first line of the left page selects that line and never
turns. A click anywhere on the page, over ink or paper, never turns. Dragging left from the
spine gutter goes forward; dragging right from the same point goes back; dragging straight
down does nothing. Holding a selection and pressing the outer margin leaves the selection
intact. Highlighting from mid-page across a page boundary still works via the dwell ring._

_**Acceptance met, driven live** (2026-08-27, Chromium/Linux, real CDP drags on East of
Eden against the running dev server — see NOTES.md for the numbers). Every clause checked,
and the first one checked at `readerMargin: narrow`, which is harder than the reported 90%
zoom: the leftmost ink sits 33px from the container edge and 58px from the stage edge, deep
inside M20's old ellipse, and a drag begun on that character selects and never turns. Same
at the far edge dragging **leftward**, straight through what used to be the "next" strip._

_⚠️ **One thing landed here that the task did not ask for, because retiring the click made it
a silent removal.** The grab surface used to be suppressed entirely under
`prefers-reduced-motion` — there is no peel to drag — and click-to-turn was what those
readers actually used. A1 without this would have left them the `‹ ›` buttons and the arrow
keys and **nothing on the page itself**. The surface is now rendered for them too and a
declared drag commits an instant turn. The rule, in decisions.md: *a gesture in the pointer
contract is not an animation, so reduced motion may drop the animation and never the
gesture.* Verified under emulated reduced motion: a leftward drag on paper turned 2 → 3; a
click did not._

#### B. The pill can be clicked

- [x] **B1.** `.pillPosition` is `z-index: 5` and `.turnGrabSurface` is `6`; `.stage`,
      `.pageClip` and `.readerRow` are positioned without a `z-index`, so none opens a
      stacking context and the two compare directly. Raise the pill — and the definition
      card and thread panel — above the turn surfaces. ⚠️ Fix it as a **layer order written
      down in one place**, not four scattered numbers; decisions.md 2026-08-26 already had
      to untangle this stack once. Put the scale in `ReaderView.module.css`'s head as a
      commented table — the fold's `960` and the dialogs' `1000` are already fixed points
      and must appear in it — and have `AskPill`, `DefinitionCard` and `ThreadPanel`
      reference it rather than restate numbers.
      _Done — premise confirmed exactly as written. The scale is a commented table plus
      `--reader-z-*` tokens at the head of `ReaderView.module.css`, with **960** (the fold)
      and **1000** (a modal) named in it as fixed points that live elsewhere and must not be
      crossed, and the immersive chrome named as a *different stacking context* whose
      numbers must not be read against them. ⚠️ Extended past the three the task names, to
      the pane-resize handle, the roaming panels, the find bar, the departing card and the
      dwell ring: leaving four numbers outside the scale would reproduce the exact failure
      it exists to prevent. Verified live under the adverse condition — surface *actively
      armed* at z 7, pill at z 8 — all seven dots hit-test to their own button, and clicking
      one created a real highlight first try (deleted afterwards)._
- [x] **B2.** ⚠️ **Premise to check before fixing, not after.** `handleSelected`
      (`ReaderView.tsx:1960`) computes the pill's `left`/`top` against `containerRect`
      (`.epubContainer`), but `AskPill` renders inside `.stage`, which is the positioned
      ancestor — and `.epubContainer` is inset from `.stage` by `.marginWrapper`'s padding.
      If that reading is right the pill is drawn short by exactly the reader margin, up and
      to the left, which is part of *why* it lands in the grab zone. **Diagnostic: set the
      page margin to "generous" and watch whether the pill drifts ~96px instead of ~40px.**
      If it does not move, this item is void — say so and close it, do not invent a fix.
      _**The premise held; the item is not void.** `AskPill` renders as a direct child of
      `.stage` (outside `.pageClip`, so panels can roam past the page's edge), so `.stage`
      is its containing block and the only box those numbers may be measured against.
      Measured live at `generous`, the `.epubContainer` inset is **97px** — the pill was
      being drawn 97px up and to the left of the selection, and the drift tracked the margin
      setting exactly as the diagnostic predicted. Fixed by measuring against `stageRef`
      (the clamp too). After: measured at two different margin settings, the pill's centre
      sits within **1px** of the selection's centre — the stage's own 1px border — with the
      same 7px gap above at both._

_Acceptance: select a passage whose start sits in the outer margin of the left page of a
spread; every dot on the pill is clickable on the first attempt. Changing the page margin
setting does not move the pill relative to the selection._

_**Acceptance met, driven live** (2026-08-27, same session). Both clauses, and the first
under the adverse condition rather than the easy one — with the grab surface *actively
armed* (`pointer-events: auto`, z 7) and the pill at z 8, all seven dots hit-test to their
own button and a click on "key quote" created a real honey highlight first try (deleted
afterwards; the book is back to its original 7). For the second clause the pill was measured
against the selection at two different margin settings and sits within **1px** of the
selection's centre at both, with the same 7px gap._

#### C. Touch

⚠️ **Read the touch table in DESIGN.md.** The short version: a tap never turns; a one-finger
horizontal drag turns; the *platform's own* long-press selects.

- [x] **C1.** Swipe to turn. 24px of horizontal travel, `touches.length === 1`, no live
      selection. Commit through `turnPageRef` — an animated turn, **not** a finger-tracked
      peel. ⚠️ Do not reimplement turn arithmetic: `pageTurn.ts` exists because epub.js's
      own next/prev is wrong at fractional device-pixel ratios and silently eats the last
      page of every chapter. A finger-tracked peel also reopens the pointer-capture question
      that crashed the tab; it is a v2, after C4 has answered it on real hardware.
      ⚠️ **This is now a replacement, not an addition.** M31 A4 disarmed the grab surface for
      touch entirely — it can only be armed by hover moves, which touch does not have — so
      M20's touch-drag-on-the-edge-ellipse curl, which worked on the iPad, is gone as of A.
      Until C1 lands, touch page turns are the `‹ ›` buttons and nothing else. See
      decisions.md 2026-08-27 later still.
      _Done: `declaredTurnDirection` (`readerGeometry.ts`) now takes an optional threshold —
      `DECLARE_SWIPE_PX` (24) for touch, defaulting to the pointer's existing `DECLARE_DRAG_PX`
      (6) — one axis-dominance test, not two. The touch state machine (`ReaderView.tsx`,
      `handleTouchMove`) calls `turnPageRef.current(direction)` the instant it declares,
      exactly `turnPage`'s own renderer ladder (curl/slide/instant), never `beginGrabDrag`.
      Unit-tested in `readerGeometry.test.ts`. ⚠️ **Not verified on a touch-capable device —
      see D.**_
- [x] **C2.** ⚠️ epub.js forwards `touchstart`/`move`/`end` **`{ passive: true }`**
      (`epubjs/src/contents.js:895`), so `preventDefault()` on the forwarded event is a
      no-op. Suppress native panning with `touch-action` via `rendition.themes`, or attach
      your own non-passive listener straight to `contents.document` — the iframe is
      `sandbox="allow-same-origin"` **without** `allow-scripts`, so the parent has full DOM
      access to it. That is also the only route to `pointerdown`, which epub.js does not
      forward at all.
      _Done, both halves. `applyTheme` (`ReaderView.tsx`) adds `touch-action: none` to the
      iframe's `html, body` via `rendition.themes`. The real suppression is the second half:
      `attachTouchHandlers`, called once per rendered section from `handleRendered`, adds a
      raw, non-passive `touchstart`/`touchmove`/`touchend`/`touchcancel` listener straight to
      `contents.document` — fresh per section (a new section is a new iframe/document, so
      there is nothing to detach). The parent-document mirror (`.stage`'s own touch, for the
      outer margins and gutter) needed the identical fix for an unnamed reason: **React has
      bound its own root touchstart/touchmove listeners `{ passive: true }` since v17**, so a
      JSX `onTouchMove`'s `preventDefault()` is silently a no-op too — not just epub.js's.
      Found writing this, not in the task text; both attachment points now use raw
      `addEventListener`, none use JSX `onTouch*` props._
- [x] **C3.** Long-press selection. ⚠️ **Check whether this already works before building
      it**: native long-press → selection → epub.js fires `selected` → `handleSelected` →
      the pill appears. If it does, the only work here is C4. Do **not** write a timer; the
      platform owns the hold (DESIGN.md), and its endpoint handles are better than ours.
      _No timer was written, per the instruction — the touch state machine's only job here is
      to recognise a selection once the platform has made one (`hasLiveSelection()`, already
      wired to `handleSelected`/`pendingSelectionRef` since M19) and stand down (C5). ⚠️ **The
      "check whether this already works" was not actually performable this session — no
      touch-capable device or touch-emulating browser was available (see D) — so this is
      built on the premise holding, not on having confirmed it holds.** If the platform's own
      long-press turns out not to fire `selected` the way assumed, C4's CSS is still correct
      and harmless, but C1's disarm-on-selection logic would need re-checking against
      whatever actually happens instead._
- [x] **C4.** Suppress the OS callout **without** killing selection: `-webkit-touch-callout:
      none` with `user-select: text` **retained**. `user-select: none` disables selection
      outright and will look like it worked in a desktop emulator. The lever is
      `rendition.themes` — its CSS *does* reach iframe content. What it cannot reach is the
      marks, which live in a parent-document SVG pane; that is why `highlightKinds.ts` uses
      presentation attributes instead. Do not confuse the two.
      _Done in `applyTheme`'s `body` rule: `-webkit-touch-callout: none !important` alongside
      an explicit `user-select: text !important`, stated outright per the task's own warning
      rather than left implicit. Marks untouched, as instructed._
- [x] **C5.** A selection disarms the swipe for the rest of that touch; a second finger
      cancels an uncommitted swipe.
      _Done in the shared touch state machine: `handleTouchMove` checks `hasLiveSelection()`
      before anything else and sets `state.disarmed = true` the moment one appears, after
      which every later move for that touch is a no-op regardless of what the selection does
      next. A second finger's `touchstart` (`touches.length >= 2`) clears `singleId` and sets
      `disarmed` unconditionally, whether or not anything had declared yet._
- [x] **C6.** Pinch to resize text, as the instrument DESIGN.md specifies ("Pinch to resize
      is an instrument, not a setting"). Same shape as M12's `%` scrub dial: live readout,
      commit on release. ⚠️ **The page must not reflow during the pinch** — a `fontScale`
      change re-paginates the whole spine section, and per-frame is not affordable. The
      slider and its sample string follow the fingers; the page reflows once, on release.
      That is also why the page is blurred while the instrument is up: it is honest about
      not being able to follow. ⚠️ Clamp the slider into view when the pinch is centred near
      the top; do not reject the gesture (see `handleSelected`'s own clamp).
      ⚠️ Reuse the existing `controls/Slider` — the same component the `%` readout and the
      settings text-size control already use (settled decision 12: a control means the same
      thing on every surface). The pinch drives its value; it is not a second slider that
      happens to look like one.
      _Done. New `PinchResizeInstrument.tsx` renders the exact `Slider` config
      `settings/tabs/ReadingTab.tsx` uses (now exported from there, one source of truth for
      both), plus a live sample string sized by inline `fontSize: {scale}em`. The two-finger
      math (`pinchFontScale`, `readerGeometry.ts`, unit-tested) is a ratio of live/starting
      touch distance against whatever `fontScale` was at pinch-start, clamped to
      `[TEXT_SIZE_MIN, TEXT_SIZE_MAX]`; the state machine calls `setReaderFontScale` exactly
      once, on release, never per frame — the existing `readerFontScale` effect
      (`ReaderView.tsx`) does the one reflow that follows, reused rather than duplicated. The
      instrument sits at `position: fixed` in viewport coordinates (like `DwellRing`, not like
      `AskPill`'s stage-relative math) — deliberately sidesteps M31 B2's whole bug class rather
      than re-deriving that fix a third time. `.pageClip` gets a `filter: blur(6px); opacity:
      0.85` class while a pinch is live; the sample text is a sibling, outside the blurred box,
      so it alone stays sharp. Clamp, not refuse, exactly per the task: `x`/`y` are clamped
      into the viewport with `Math.min`/`Math.max`, mirroring `handleSelected`'s own pill
      clamp.
      ⚠️ **One call made that the task leaves open, recorded in decisions.md:** the resize is
      committed to `readerFontScale` (so it reflows and holds for the rest of this reading
      session) but is **not** written back to the server. Settings' own save flow is a
      whole-object `PUT` requiring the full form; wiring a single pinch-driven field through
      that seam felt like a second decision wearing this task's clothes, not a refusal —
      see decisions.md for the reasoning and what would change it._
- [x] **C7.** In immersive mode, a tap anywhere reveals the pebble — the touch counterpart
      of the proximity reveal, which has none. ⚠️ It is the **one** exception to the tap
      table, and it is additive: whatever the table says for that spot still happens.
      _Done: `handleTouchEnd`'s `onTap` (fired only for a touch that never declared a turn, a
      departure or a pinch — a plain tap) calls the existing `wakePebble()` when
      `fullscreenModeRef.current`. Additive by construction, not by extra care: nothing here
      calls `preventDefault` on an undeclared tap, so epub.js's own synthesized `click` still
      fires afterward and still dismisses a pending pill / opens a mark's thread exactly as it
      always has._
- [x] **C8.** Mention pinch-to-resize in Settings beside the text-size control, shown only
      when `matchMedia("(any-pointer: coarse)")` matches. Per DESIGN.md this replaces the
      on-page gesture hint the operator originally wanted; there is no hint overlay in the
      reader.
      _Done: new `settings/useCoarsePointer.ts` (a live `any-pointer: coarse` media-query
      hook, not a one-time read — a docked/undocked tablet can change mid-session), and
      `ReadingTab.tsx` renders a one-line hint under the Text size `Slider` when it matches._
- [x] **C9.** Swipe down to leave the book — the one room-changing gesture (DESIGN.md,
      amended). One finger, **≥⅓ of the page** travelled downward within **±20°** of
      vertical, disarmed while anything is selected, being edited, or mid-turn. It returns
      to whichever of desk/list/shelf was last used and **runs the put-down**, so it is the
      same departure as the Desk button and `Esc`.
      ⚠️ **Hard-gated on §0b/§0c.** Until pull-to-refresh is overridden, a downward swipe
      reloads the page — shipping this first ships a gesture that throws away the reader's
      place. Verify the override on the iPad *before* wiring the gesture, not after.
      ⚠️ **Soft-gated on M33 C**, which builds the put-down. Until then this gesture has no
      animation to run: either hold C9 with M33, or land it navigating plainly and say so in
      NOTES.md. Do not invent a third, gesture-only exit animation.
      _Landed navigating plainly, per the task's own allowance — M33 C does not exist yet.
      `isDepartureSwipe` (`readerGeometry.ts`, unit-tested) is the ⅓-page/±20° test, kept
      deliberately separate from `declaredTurnDirection` rather than reusing its axis check
      (a shallow diagonal must fail *both*, for different reasons — see the function's own
      comment). Commits via `navigate("/")` with **no explicit view-mode emit**: `DeskPage`
      seeds itself from `loadDeskViewMode()` when nothing tells it otherwise
      (`deskViewBus.ts`), which already *is* "whichever of desk/list/shelf was last used" —
      the one thing `d`/`l`/`b` do differently is *force* a mode, which this gesture must not.
      Disarm conditions: `hasLiveSelection()`, a new `isEditingSomewhere()` (mirrors
      `handleIframeKeydown`'s own `isTyping` check, for the parent document's text fields),
      and `gestureActiveRef` (a fresh ref-mirror of `usePageTurnAnimation`'s `gestureActive`,
      needed because the touch handlers live inside the once-per-resourceId book-loading
      effect and would otherwise read a value frozen at mount). §0b/§0c were already done
      before this session (checked above) — the hard gate was satisfied by prior work, not
      re-verified live this session._

_Acceptance: on a touch-capable machine — a one-finger horizontal drag anywhere on the page,
including across a paragraph, turns exactly one page and lands where `→` would, including
on the second-to-last page of a chapter at 90% zoom (the `pageTurn.ts` case). A long-press
on a word opens the pill with no browser context menu. Dragging from a selection's handle
adjusts the selection and never turns. A tap never turns, anywhere._

_**Acceptance not driven** — no touch-capable device or touch-emulating browser was available
this session (no iPad, no browser-automation tool, no `chromium`/Playwright in this
environment; see D for what was checked instead: types, the full unit suite including new
tests for every piece of touch/pinch/departure math, a production build, and a live dev
server compiling and hot-reloading every edit with no console/transform errors). Every clause
above describes intended behaviour the code is written to produce, not behaviour anyone has
watched happen on a finger._

#### D. What gets verified, and where

- [x] Record in `NOTES.md`, at completion, what was verified on the iPad and what was only
      emulated. An honest "not verified, here's why" is still the required output — there is
      just far less of it than this milestone was scoped expecting.
      _Done — see NOTES.md "M31 C". The honest output this time is unusually blunt: **nothing**
      in C was verified on a device or by emulation, because this implementation session had
      neither an iPad nor any touch-emulating browser/automation tool available to it. What
      exists instead: full type-checking, the complete unit suite (extended with new
      pure-function tests for the swipe/departure/pinch math), a clean production build, and a
      live dev server that hot-reloaded every edit in this milestone with no compile or
      runtime error. That is meaningfully less than "verified" and the gap is real — the next
      session with a device should treat all of C as freshly-built and unexercised, not as
      polish on something already seen working._

⚠️ **The old gate is gone — do not repeat it.** This section used to read "there is no iPad
to test on until the Private rung lands; the server binds to loopback by the M6 security
decision". **The operator already runs this on an iPad in a browser** (decisions.md
2026-08-27 later). Loopback binding was never the same thing as unreachable from another
device — this project has reached the dev server over an SSH tunnel before (2026-08-12).
The same correction applies to the iPad-drawing note under "Future arcs" (2026-07-27), which
rests on the identical false gate. ⚠️ The *mechanism* is unconfirmed at time of writing; ask
before writing it down, because an implementation session has to reproduce it.

So: §0 and A–C are verified **on the device**, including the iOS callout behaviour and
whether the platform's own long-press really is the right hold. What remains genuinely
unverifiable here is only what an iPad cannot show — iPhone-width layout, and any browser
that is not Safari.

⚠️ **One gap the operator accepted knowingly** (decisions.md): the `‹ ›` buttons are not
rendered in immersive mode — that branch swaps them for the floating pebble. On a tablet in
immersive mode, swipe becomes the only way to turn a page. Consistent with the rule, and
C7's tap-to-reveal softens it; if a belt-and-braces fallback is wanted later, arrows on the
immersive pebble are a two-line change.

---

### M32 — Deep Reading: the chapter-end trigger, and questions of your own

Scoped 2026-08-24 (decisions.md). ⚠️ **Sequenced after M29's live Verify**, which is still
unchecked. M29's code is done, but this milestone puts the thematic layer in the *reading*
path, where a stall is felt mid-book rather than on a digest page the reader chose to open.

**Most of this already exists — read before building.** `digest/thematicBuild.ts` generates
3-5 questions per chapter, each with a verbatim grounding quote (decision 11); clicking one
creates a real anchored highlight with the question pre-filled
(`routes/digest.ts:476`, `ThreadPanel.initialDraft`); there is a per-book reading brief; and
questions are already spoiler-gated on reading position (`routes/digest.ts:375` —
`spineIndex > bookmarkSpineIndex`). **That gate is already "when a chapter is concluded."**
This milestone is a trigger and one new storage shape. It is not a generation feature.

#### A. The chapter-end affordance

- [ ] When the reader crosses a chapter boundary, offer the just-finished chapter's posed
      questions. The signal exists on both sides: `currentSpineIndexRef` via
      `handleRelocated` (client), the bookmark gate (server).
- [ ] ⚠️ **Quiet affordance, never a modal, never an interstitial.** Decided in decisions.md,
      not open: CLAUDE.md's "reading comes first — never let the AI layer degrade the reading
      experience (no layout jank, no blocking spinners over the text)" already rules out an
      between-chapters interruption. A reader who keeps reading must never have to dismiss
      anything.
- [ ] Dismissible and re-findable — a reader who ignores it can still reach that chapter's
      questions later.
- [ ] Undigested chapters show nothing at all. ⚠️ Do **not** kick off a thematic run from the
      reading path; that is a multi-minute LLM job and belongs to the digest page where the
      reader starts it deliberately.

_Acceptance: finishing a digested chapter surfaces its questions without shifting the text
or stealing focus; continuing to read requires no dismissal; finishing an undigested chapter
shows nothing and starts no job._

#### B. Your own chapter-level questions

- [ ] The one genuinely new storage shape in the whole triage: a question about a **chapter
      as a whole**, with no passage to anchor to. Every highlight today requires an anchor
      (`shared/src/anchorText.ts`, the W3C model in CLAUDE.md's engineering discipline) —
      so this is not a highlight with a null anchor. Give it its own table keyed on
      `(resource_id, spine_index)`.
- [ ] ⚠️ Do not weaken the highlight anchor model to fit this in. Anchoring is named in
      CLAUDE.md as the most fragile part of the system; an optional anchor makes every
      resolution path handle a case that only one feature produces.
- [ ] Answer-space: reuse the per-highlight `note` pattern (plain text, debounced autosave —
      `highlightMeta.ts:updateHighlightNote`, 800ms, same as the desk notepad). Not a new
      editing model.

_Acceptance: a chapter question written with no text selected survives a reload and reopens
against the right chapter; its answer note autosaves without a save button; deleting the
book removes it (foreign key, not orphaned rows)._

#### C. Out of scope, recorded so it isn't scope-crept in

- The "what kind of reader are you" graphic. Its inputs are M30's kind distribution and
  M32's question corpus — noted in decisions.md so it isn't foreclosed, unscheduled, and
  **not started from this list**.

#### Verify

- [ ] Read through a chapter boundary in a digested book and confirm the affordance appears
      without moving the text; then read through one in an undigested book and confirm
      nothing appears and no job starts.
- [ ] Write a chapter-level question, reload, and confirm it comes back attached to the same
      chapter.

### M33 — Touch beyond the reader, and the put-down

Scoped 2026-08-27 (decisions.md, "The iPad gate was stale"). Appended rather than inserted,
so nothing renumbers. ⚠️ **Sequenced after M31** — the pointer contract in DESIGN.md is
written there, and every task here is an application of it. ⚠️ **DESIGN.md's "Gestures
outside the reader" table is binding**; the gesture set is closed (three proposals were
considered and dropped — see decisions.md before proposing a fourth).

#### A. The Desk's action card reaches a finger

- [ ] **A1.** ⚠️ **Fix the existing bug first.** `BookObject.tsx`'s `onPointerEnter` has no
      pointer-type filter, so on a touchscreen a tap fires pointer-enter (the card appears)
      *and* `onTap` (the book opens). The card flashes and is gone. `ExpandingCluster`
      already does this correctly — `if (event.pointerType !== "mouse" && event.pointerType
      !== "pen") return;` — copy that, do not invent a second form of it.
- [ ] **A2.** One rule, not three: the action card appears after **1s of stillness** at any
      point during a touch; *any* movement dismisses it and re-arms the timer, so a book
      that stops moving under a resting finger brings it back a second later. There is no
      separate "hold 0.3s then drag" case — that is movement before the second is up.
- [ ] **A3.** ⚠️ A 1s dwell with no feedback reads as a broken app. Reuse the reader's
      `DwellRing` (already parameterised by `durationMs`); do not build a second ring.
- [ ] **A4.** While the card is out, the book's drag is disarmed for the rest of that touch.
- [ ] **A5.** ⚠️ Book covers are images, so iOS raises its own "Save Image" callout partway
      through the hold. `-webkit-touch-callout: none` on the cover — and check it did not
      disable selection anywhere it shouldn't (the M31 C4 trap, one room over).
- [ ] **A6.** Same treatment for the shelf (`ShelfView.tsx:300` has the identical unfiltered
      `onPointerEnter`) — one card, both surfaces, per settled decision 12.

_Acceptance: on the iPad — tapping a book opens it and never flashes the card; resting a
finger on a book fills a ring and opens the card; dragging a book moves it with no card;
letting a dragged book come to rest under the finger re-opens the card after a second;
moving again closes it. No "Save Image" menu at any point._

#### B. The Scan's two gestures

- [ ] **B1.** Pinch zooms the timeline; horizontal swipe scrubs along it. Per DESIGN.md's
      table these are the Scan's meanings for gestures that mean something else in the Book
      — allowed by invariant 6, and the reason that invariant is written down.
- [ ] **B2.** ⚠️ Depends on M31 §0d: until WebKit's page zoom is blocked, a pinch here scales
      the whole website and never reaches the timeline.

#### C. The put-down

⚠️ **The sequence is decided** — DESIGN.md, "Book → Desk: the put-down". Do not reorder it;
the ordering is what makes the destination rect knowable.

- [ ] **C1.** The reading pane zooms out while its UI fades; the Desk background fades in
      behind it while the book is still open; the book closes onto its cover; the cover
      travels to its place.
- [ ] **C2.** ⚠️ The blocker, stated so it is not rediscovered: `App.tsx` renders **one room
      at a time**, which is exactly why `BookOpening.tsx:110` says a reverse animation is not
      possible today. The machinery already exists in the *other* direction — `useScene3DHold`
      plus the `departedBook` store keep the Desk alive under a book flying out. This is that
      hold, run the other way; it is not a new mechanism.
- [ ] **C3.** The destination comes from the Desk after it mounts, not from the reader:
      it depends on `shelf_state`, on which of desk/list/shelf was last used (already
      persisted — `persistDeskViewMode`), and on that room's parallax.
- [ ] **C4.** ⚠️ **Two different Escapes, do not conflate them.** `Esc` *during an opening*
      still cancels by unmounting immediately — there is nothing coherent to reverse
      mid-flight, and `BookOpening.tsx` says so deliberately. `Esc` *while reading* is this
      sequence. Same key, two states, two behaviours.
- [ ] **C5.** `prefers-reduced-motion` collapses the whole thing to a crossfade, per
      DESIGN.md's motion rules.

_Acceptance: leaving a book by the Desk button and by `Esc` produce the same sequence; the
cover lands on the book's actual position in whichever of desk/list/shelf was last used, not
a default one; escaping out of a still-opening book still unmounts instantly; with reduced
motion on, both are a crossfade._

---

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
