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

Scoped 2026-08-24 (decisions.md). Was sequenced after M29's live Verify — by the time this
milestone was picked up, M29's Verify was already checked and the milestone moved whole to
TASKS_DONE.md, so the "still unchecked" note above was stale. This milestone puts the
thematic layer in the *reading* path, where a stall would be felt mid-book rather than on a
digest page the reader chose to open.

**Most of this already exists — read before building.** `digest/thematicBuild.ts` generates
3-5 questions per chapter, each with a verbatim grounding quote (decision 11); clicking one
creates a real anchored highlight with the question pre-filled
(`routes/digest.ts:476`, `ThreadPanel.initialDraft`); there is a per-book reading brief; and
questions are already spoiler-gated on reading position (`routes/digest.ts:375` —
`spineIndex > bookmarkSpineIndex`). **That gate is already "when a chapter is concluded."**
This milestone is a trigger and one new storage shape. It is not a generation feature.

#### A. The chapter-end affordance

- [x] When the reader crosses a chapter boundary, offer the just-finished chapter's posed
      questions. The signal exists on both sides: `currentSpineIndexRef` via
      `handleRelocated` (client), the bookmark gate (server).
- [x] ⚠️ **Quiet affordance, never a modal, never an interstitial.** Decided in decisions.md,
      not open: CLAUDE.md's "reading comes first — never let the AI layer degrade the reading
      experience (no layout jank, no blocking spinners over the text)" already rules out an
      between-chapters interruption. A reader who keeps reading must never have to dismiss
      anything.
- [x] Dismissible and re-findable — a reader who ignores it can still reach that chapter's
      questions later. (Re-findable via the digest page's own question chips, unchanged by
      this milestone — dismissing the reader's pop-up loses nothing.)
- [x] Undigested chapters show nothing at all. ⚠️ Do **not** kick off a thematic run from the
      reading path; that is a multi-minute LLM job and belongs to the digest page where the
      reader starts it deliberately.

_Acceptance: finishing a digested chapter surfaces its questions without shifting the text
or stealing focus; continuing to read requires no dismissal; finishing an undigested chapter
shows nothing and starts no job._

#### B. Your own chapter-level questions

- [x] The one genuinely new storage shape in the whole triage: a question about a **chapter
      as a whole**, with no passage to anchor to. Every highlight today requires an anchor
      (`shared/src/anchorText.ts`, the W3C model in CLAUDE.md's engineering discipline) —
      so this is not a highlight with a null anchor. Give it its own table keyed on
      `(resource_id, spine_index)`.
- [x] ⚠️ Do not weaken the highlight anchor model to fit this in. Anchoring is named in
      CLAUDE.md as the most fragile part of the system; an optional anchor makes every
      resolution path handle a case that only one feature produces. (`highlights`/anchor
      code untouched by this milestone.)
- [x] Answer-space: reuse the per-highlight `note` pattern (plain text, debounced autosave —
      `annotations/highlights.ts:setHighlightNote`, 800ms, same as the desk notepad). Not a
      new editing model.

_Acceptance: a chapter question written with no text selected survives a reload and reopens
against the right chapter; its answer note autosaves without a save button; deleting the
book removes it (foreign key, not orphaned rows)._

#### C. Out of scope, recorded so it isn't scope-crept in

- The "what kind of reader are you" graphic. Its inputs are M30's kind distribution and
  M32's question corpus — noted in decisions.md so it isn't foreclosed, unscheduled, and
  **not started from this list**.

#### Verify

- [x] Read through a chapter boundary in a digested book and confirm the affordance appears
      without moving the text; then read through one in an undigested book and confirm
      nothing appears and no job starts. (Driven live via Playwright against the real dev
      server and a seeded chapter — cleaned up afterward.)
- [x] Write a chapter-level question, reload, and confirm it comes back attached to the same
      chapter. (Same live pass; also confirmed the note autosaves and survives reload.)

### M33 — Touch beyond the reader, and the put-down

Scoped 2026-08-27 (decisions.md, "The iPad gate was stale"). Appended rather than inserted,
so nothing renumbers. ⚠️ **Sequenced after M31** — the pointer contract in DESIGN.md is
written there, and every task here is an application of it. ⚠️ **DESIGN.md's "Gestures
outside the reader" table is binding**; the gesture set is closed (three proposals were
considered and dropped — see decisions.md before proposing a fourth).

#### A. The Desk's action card reaches a finger

- [x] **A1.** ⚠️ **Fix the existing bug first.** `BookObject.tsx`'s `onPointerEnter` has no
      pointer-type filter, so on a touchscreen a tap fires pointer-enter (the card appears)
      *and* `onTap` (the book opens). The card flashes and is gone. `ExpandingCluster`
      already does this correctly — `if (event.pointerType !== "mouse" && event.pointerType
      !== "pen") return;` — copy that, do not invent a second form of it.
      _Done — the exact guard, copied onto `onPointerEnter` and `onPointerLeave`._
- [x] **A2.** One rule, not three: the action card appears after **1s of stillness** at any
      point during a touch; *any* movement dismisses it and re-arms the timer, so a book
      that stops moving under a resting finger brings it back a second later. There is no
      separate "hold 0.3s then drag" case — that is movement before the second is up.
      _Done in the new `useTouchCardDwell.ts`, shared by `BookObject.tsx` and `ShelfView.tsx`
      (§A6): `onPointerDown`/`onPointerMove` (touch only) arm a single 1000ms timer,
      `onPointerMove` re-arms it unconditionally on every call rather than past some slop
      threshold — "any movement" taken literally. Touch's `revealed` is folded into
      `BookObject`'s existing `isHovering` by a one-line effect, so the card, the z-index
      bump, and the 3D hover lift all just work for touch too with no second branch._
- [x] **A3.** ⚠️ A 1s dwell with no feedback reads as a broken app. Reuse the reader's
      `DwellRing` (already parameterised by `durationMs`); do not build a second ring.
      _Done — same component, portaled to `document.body` rather than rendered in place:
      `BookObject`'s drag transform (and the shelf's lift transform) would otherwise become
      the ring's containing block instead of the viewport, since `position: fixed` resolves
      against the nearest transformed ancestor. `DwellRing.module.css`'s z-index gained a
      `100001` fallback for `var(--reader-z-dwell-ring)`, which is only ever defined while
      the reader route is mounted._
- [x] **A4.** While the card is out, the book's drag is disarmed for the rest of that touch.
      _Done via a second, sticky flag (`settled`) alongside the toggling `revealed` — read
      literally, "for the rest of that touch" outlives a later movement toggling the card
      back off, so `drag={!reducedMotion && !touch.settled}` rather than gating on `revealed`
      directly, which would have let a paused mid-drag resume the instant it re-armed._
- [x] **A5.** ⚠️ Book covers are images, so iOS raises its own "Save Image" callout partway
      through the hold. `-webkit-touch-callout: none` on the cover — and check it did not
      disable selection anywhere it shouldn't (the M31 C4 trap, one room over).
      _Done on `.coverWrap` alone, `user-select` untouched per the warning — there was none
      set there to begin with, and no selectable text under it to lose._
- [x] **A6.** Same treatment for the shelf (`ShelfView.tsx:300` has the identical unfiltered
      `onPointerEnter`) — one card, both surfaces, per settled decision 12.
      _Done — `ShelfBook` uses the same `useTouchCardDwell` and the same pointer-type filter,
      wired to the `onActiveChange` the shelf already had for hover/focus rather than a
      second local "is the card open" flag. No drag to disarm here, so only §A2/§A3 apply;
      also added `.slot`'s own `-webkit-touch-callout: none` for the decorative
      (`aria-hidden`) spine title, which is not the A5 image case but the same class of bug._
      ⚠️ **Built on the same premise M31 §C3 flagged and could not confirm: no touch-capable
      device or touch-emulating browser was available this session.** Typechecked and the
      existing suite still passes; the framer-motion `drag` prop toggling off mid-gesture
      (§A4) in particular is asserted from the library's documented behaviour, not watched on
      real hardware.

_Acceptance: on the iPad — tapping a book opens it and never flashes the card; resting a
finger on a book fills a ring and opens the card; dragging a book moves it with no card;
letting a dragged book come to rest under the finger re-opens the card after a second;
moving again closes it. No "Save Image" menu at any point._

#### B. The Scan's two gestures

- [x] **B1.** Pinch zooms the timeline; horizontal swipe scrubs along it. Per DESIGN.md's
      table these are the Scan's meanings for gestures that mean something else in the Book
      — allowed by invariant 6, and the reason that invariant is written down.
      _Done in `HeatStrip.tsx`, as a second native (non-passive) touch listener on the same
      `stripRef` the existing wheel-to-zoom listener already attaches to, so `preventDefault`
      actually sticks instead of being silently dropped by React's default-passive touch
      handlers. Both gestures reuse `zoom.ts`'s existing pure functions rather than adding
      new ones: a pinch feeds its per-move distance ratio into `zoomAtViewPosition` exactly
      like the wheel handler feeds it `deltaY`, about the pinch's own centre; a single
      finger's horizontal drag feeds its per-move pixel delta into `panByViewFraction` (the
      same step the pan buttons use, as a continuous fraction instead of a fixed 0.5),
      declared only past an 8px threshold from the touch's start so a tap that stops short
      of that still reaches a band's own `onClick` untouched — no gesture claims the touch
      until it's clearly a drag. A second finger landing cancels an undeclared pan outright,
      per the reader's own touch-table rule for the same situation. `.strip` gained
      `touch-action: pan-y` (HeatStrip.module.css) so native vertical scroll of the Scan's
      body keeps working — the one axis this component doesn't claim — while horizontal pan
      and pinch-zoom stand down for us._
      ⚠️ **Built on the same premise A6 flagged: no touch-capable device or touch-emulating
      browser was available this session.** Typechecked, the existing suite (including
      `zoom.test.ts`, whose pure functions this reuses rather than re-implements) still
      passes; not watched on real hardware.
- [x] **B2.** ⚠️ Depends on M31 §0d: until WebKit's page zoom is blocked, a pinch here scales
      the whole website and never reaches the timeline.
      _Already satisfied — M31 §0d was done before this session; no code needed here._

#### C. The put-down

⚠️ **The sequence is decided** — DESIGN.md, "Book → Desk: the put-down". Do not reorder it;
the ordering is what makes the destination rect knowable.

- [x] **C1.** The reading pane zooms out while its UI fades; the Desk background fades in
      behind it while the book is still open; the book closes onto its cover; the cover
      travels to its place.
      _Done — `BookClosing.tsx`, mounted persistently from `App.tsx` (lazy, alongside
      `BookOpening.tsx`'s own chunk). Literally reuses `BookOpening3D` rather than a second 3D
      component (C2): `progress`/`landing`/`settle` are pure inputs with no direction baked
      in, so this component drives them 1 → 0 on the opening's own constants (`LANDING_MS`,
      `LANDING_EASE`, `PAGE_SETTLE_MS`, `openSequenceMs`) instead of 0 → 1. The reader's own
      chrome does not get a slow fade — it is simply gone the instant `navigate("/")` runs
      (`startPutDown`, `ReaderView.tsx`); "the reading pane zooms out while its UI fades" is
      instead a `<img>` **bridge** (`BookClosing.module.css`'s `.bridge`), a plain picture of
      the exact page the reader was left on, pinned to its exact rect, that the 3D layer picks
      up seamlessly (`landingStep` reproduces the same picture at the same rect at
      `landing = 1`) once it has real geometry. ⚠️ **"Desk background fades in" needed no
      fade at all**, on inspection: unlike the opening, nothing in this design ever hides the
      Desk — it mounts and draws normally the instant `navigate("/")` lands, and only the
      departing book itself is hidden (`setDepartedBook`, same store the opening uses). A
      `useScene3DLayerFade`-style fade-in was considered and dropped: that primitive can only
      fade a layer *down* from its authored opacity (`Scene3D.tsx`'s `FadingLayer` hard-codes
      the start at 1), so faking a fade-in would have meant extending that primitive rather
      than reusing it — and there is nothing to fade in when nothing was ever hidden._
- [x] **C2.** ⚠️ The blocker, stated so it is not rediscovered: `App.tsx` renders **one room
      at a time**, which is exactly why `BookOpening.tsx:110` says a reverse animation is not
      possible today. The machinery already exists in the *other* direction — `useScene3DHold`
      plus the `departedBook` store keep the Desk alive under a book flying out. This is that
      hold, run the other way; it is not a new mechanism.
      _Done, with one genuine asymmetry recorded rather than papered over: **no hold is
      needed for the put-down.** The hold exists to keep a room drawing after the route that
      owned it is gone — the opening needs that because the Desk is the room being *left*. The
      put-down's Desk is the room being *arrived at*: by the time `BookClosing` has anything to
      draw, `navigate("/")` has already run and the Desk is the live route, registering its own
      "desk"/"shelf" layer for real. What *is* reused, unchanged: `departedBook` (so the Desk
      doesn't draw the resting-place book while `BookClosing` draws it in flight) and
      `useScene3DLayer` (to draw it). New machinery was needed for exactly one thing C2 doesn't
      cover — see C3._
- [x] **C3.** The destination comes from the Desk after it mounts, not from the reader:
      it depends on `shelf_state`, on which of desk/list/shelf was last used (already
      persisted — `persistDeskViewMode`), and on that room's parallax.
      _Done via a new store, `scene3d/putDown.ts` — `openingPose.ts`'s own sibling, but live
      and subscribable (`useSyncExternalStore`, `departedBook.ts`'s pattern) rather than a
      one-shot pending value, because unlike a click the destination genuinely isn't known
      until the Desk exists to report it. `startPutDown` (`ReaderView.tsx`) resolves the view
      mode via `loadDeskViewMode()` (or the forced mode from `d`/`l`/`b`) and requests a
      put-down *before* navigating; `BookObject.tsx`/`ShelfView.tsx` each gained a mount-time
      effect that answers a live request for the resource they're currently laying out,
      reusing (not duplicating) the exact same pose math their click-time `captureOpening`
      already computes — both files' pose-building code was extracted into a shared
      `buildPose()` for this. The list view reports nothing: `mode` alone already tells
      `BookClosing` no 3D destination is coming, so it falls straight to the crossfade (C5)
      with no per-row wiring in `LibraryGrid.tsx`. A 2000ms timeout covers the case where the
      resource never gets reported at all (deleted mid-read, or some other race) — the same
      "best-effort, never stuck" posture `capturePageSnapshot`'s own deadline already has._
- [x] **C4.** ⚠️ **Two different Escapes, do not conflate them.** `Esc` *during an opening*
      still cancels by unmounting immediately — there is nothing coherent to reverse
      mid-flight, and `BookOpening.tsx` says so deliberately. `Esc` *while reading* is this
      sequence. Same key, two states, two behaviours.
      _Done — `BookOpening.tsx`'s own Escape handling is untouched. `ReaderView.tsx`'s
      `handleEscapeShortcut` now falls through to `startPutDown()`, but only once nothing
      shallower claimed it (find bar, link-quote mode, a pending selection, an open thread, an
      open definition card, an open progress popover, fullscreen) — read before any of that
      state is cleared, so "closest layer first" still holds and Escape only leaves the room
      when there was truly nothing left to close. The Desk button (the embedded `NavCluster`'s
      Library link) and `d`/`l`/`b` go through the same `startPutDown`, via a new `onDepart`
      prop on `NavCluster` that only the reader's instance passes — and the M31 §C9 touch
      departure's two `onCommitDeparture` callbacks (`ReaderView.tsx`) now call it too, instead
      of the plain `navigate("/")` they were soft-gated to (§0's own note there is now stale —
      the gate is satisfied). One function, four triggers, not four policies._
- [x] **C5.** `prefers-reduced-motion` collapses the whole thing to a crossfade, per
      DESIGN.md's motion rules.
      _Done, and generalised: `BookClosing`'s `use3D` gate is
      `Boolean(destination?.pose) && scene3DAvailable && !reducedMotion` — the exact shape of
      `BookOpening`'s own `use3D` — so reduced motion, a lost WebGL context, *and* the list
      view (no pose) all collapse to the same plain crossfade (the bridge fading to 0 opacity
      over the Desk, already live underneath). This is a deliberate scope cut from the
      opening's own richer 2D fallback, which flies and rotates a CSS cover from the list row
      instead of just fading — recorded here rather than silently done: a fully symmetric
      list-view put-down is future work, not a gap discovered later._

_Acceptance: leaving a book by the Desk button and by `Esc` produce the same sequence; the
cover lands on the book's actual position in whichever of desk/list/shelf was last used, not
a default one; escaping out of a still-opening book still unmounts instantly; with reduced
motion on, both are a crossfade._
⚠️ **Built on the same premise A6/B1 flagged: no touch-capable device or touch-emulating
browser was available this session, and this milestone's 3D choreography has no way to be
watched at all in a text-only session, touch or otherwise.** Typechecked, the full existing
suite (493 tests) still passes, and a production build succeeds with the new machinery
correctly code-split (`BookClosing`/`putDown`/`BookOpening` land in their own chunks, not the
app shell). No frame of the actual landing, settle or closing motion has been watched by
anyone — every timing and geometry choice above is reasoned from `openingGeometry.ts`'s own
math and comments, reused rather than re-derived, but "reused correctly" and "looks right"
are not the same claim.

---

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

### M35 — Quotes that know where they are

Scoped 2026-08-31 (decisions.md, "The LLM layer, measured"). ⚠️ **Depends on M34 §0** — §B
and §C's sizing are answered by those measurements, not by argument.

**The correction this milestone is built on, because it was nearly got wrong in review:** a
character offset into `resource_text` **cannot rot**. The resource is immutable on import
(settled decision 5); font size, window width, margins and spread mode repaginate the
*rendered page*, not the source string. And settled decision 11 is not in the way — it bans
trusting numbers **the model returns**, while a number **code computes** by locating
model-returned text is that decision being followed. `sectionOffsets.ts`'s `locateAnchor`
already computes exactly this offset and throws it away.

#### A. Offsets, stored

- [x] **A1.** `highlights` gains `offset INTEGER` and `length INTEGER` (nullable — a legacy
      row has none), populated by locating the anchor in the section's text at creation.
      _Done: migration 32. Populated by `createHighlight`'s optional `offset`/`length`,
      computed at both creation sites — `findAnchorInText` for the reader's own selection
      (`routes/highlights.ts`), `locateQuoteAnchor`'s now-returned offset for posed-question
      anchors (`routes/digest.ts`)._
- [x] **A2.** ⚠️ **Store both representations; they have different jobs and do not compete.**
      `offset`+`length` is the canonical *position* — ordering, ranges, zones, dedup,
      click-to-jump, "does this theme span 40–70% of the chapter". `exact`+`prefix`/`suffix`
      is what the *client* needs to paint it, because the server's plain-text extraction and
      the rendered DOM are not the same string and `resolveAnchor`'s three-tier rule
      (CFI → text → unanchored) still governs rendering. Do not delete either.
      _Done: both are stored, neither replaced. `offset`/`length` are server-only for now —
      same shape as `anchor_source` (migration 28), since nothing in §A/§B renders them yet.
      See decisions.md 2026-08-31 (night)._
- [x] **A3.** Backfill existing highlights via `buildSectionOffsetIndex` + `locateAnchor`.
      A highlight that no longer locates keeps `NULL` and is not an error — it is already the
      "unanchored" state the reader can see.
      _Done: `pnpm --filter server backfill-offsets` (`server/src/cli/backfillOffsets.ts`),
      re-runnable — only ever touches rows where `offset IS NULL`. Not run against the
      operator's real library yet; that's the operator's call, same as §0c's `measure`._
- [x] **A4.** Model-proposed quotes are **verified at generation time**: locate before
      persisting, and record the result. A quote that cannot be found never becomes a row
      that fails silently weeks later.
      _Done: `routes/digest.ts`'s chapter-anchor route already located before persisting
      (M34 §0a); it now also carries the located offset/length onto the highlight it creates,
      so "verified" and "recorded" cover offset/length too, not just anchor_source._

_Acceptance: every newly created highlight has an offset; the backfill leaves no book with
fewer located highlights than before; a highlight whose text was never findable is still
listed and still marked unanchored._
_Status: covered by unit tests (`highlights.test.ts`'s "M35 §A offset/length" block,
`chapterAnchor.test.ts`). **The backfill CLI has not been run against the operator's real
library yet** — like §0c's `measure`, that's a read/write pass over real data and is the
operator's call, not the session's._

#### B. A quote survives the merge

- [x] **B1.** ⚠️ **Measured 2026-08-31 on East of Eden's split chapters (spine 9, 22, 48,
      61 — all 4 split into 2 parts and merged). The merge is the corrupting step, and the
      result is unconfounded:**

      ⚠️ **Amended after a control run of two unsplit *long* EoE chapters (spine 25 at
      25,941 chars, spine 46 at 24,500). Read the corrected table, not the first one:**

      | | n | today's matcher | with §B1b's normalization |
      |---|---|---|---|
      | **unsplit** (Kafka 9 + EoE 6) | 15 | 11/15 (73%) | **15/15 (100%)** |
      | **split/merged** (EoE) | 11 | 3/11 (27%) | **7/11 (64%)** |

      The first reading compared Kafka-unsplit against EoE-merged and blamed the merge. But
      unsplit EoE is **2/6 raw** — nearly as bad — so the *raw* rate splits by book, not by
      merge, and the curly-vs-straight typography check was too coarse to catch it. **The
      merge conclusion survives only after normalization**, where every unsplit failure
      disappears and all four residuals are from merged chapters. ⚠️ **Order matters: §B1b
      before any further fidelity measurement.** The matcher bug is large enough to swamp the
      signal it sits on.
- [x] **B1a.** The context bump is still worth doing and still sidesteps this for most books
      (declared 32,768 → 65,536 removes 20 of 21 splits library-wide), but it is **no longer
      the alternative to B3** — it narrows the blast radius; it does not fix the mechanism.
- [x] **B1b. ⚠️ `locateQuoteAnchor` has no typographic normalization** — the model
      transcribed faithfully and tidied the punctuation, and neither existing tier (exact
      substring, then whitespace-tolerant) folds a curly quote. Measured across all 26 stored
      quotes it takes **unsplit chapters from 73% to 100%** and merged ones from 27% to 64%.
      _⚠️ **Reclassified 2026-08-31 by the model A/B: this is a weak-model compensation, not
      universal hardening.** On GPT 5.6 Luna, folding gains **nothing** — raw and folded are
      both 17/18, because Luna reproduces curly typography byte-for-byte. Still build it: it
      is what makes the cheap local digest role viable, which is what provider roles exist
      for. But it is the **first** thing to re-measure after any digest-role change, and it
      should not be described as provider-agnostic robustness._
      ⚠️ **Implement it offset-safe.** The anchor must still resolve to a range in the
      *original* text, so use transformations that preserve length and position:
      **(a)** a same-length fold (`’‘‛→'`, `“”→"`, `—–→-`) applied to both sides, and
      **(b)** widen tier 2's separator from `\s+` to `[\s"'’‘“”]+`, so a dropped internal
      quotation mark in dialogue still matches. Both search the original string, so offsets
      stay native. **Verified: 14/15 unsplit, 7/11 merged, with every returned offset
      pointing at the real passage.**
      ⚠️ Do **not** reach for "strip all quote characters from both sides" — it scores one
      better (15/15) but changes string length, so offsets no longer map back and you owe an
      index map. Only pay that if the last case proves to matter.
      _Done: `chapterAnchor.ts`'s `locateQuoteAnchor` — tier 2 (same-length fold) and tier 3
      (widened separator, on the folded text) exactly as specified; `QuoteAnchor` now also
      returns `offset`/`length`. Unit-tested in `chapterAnchor.test.ts` (curly quotes, em
      dash, dropped internal quotation mark, offset round-trips to the real passage)._
- [x] **B1c.** ⚠️ **Confirmed necessary — promoted from "only if measured" — but scoped to
      the local path.** A 272K-context model (codex-cli reports 272,000 → a 238,000-char map
      budget) splits **nothing** in this library, so B3 only ever runs for a small-context
      digest role. The 2026-08-31 A/B also put the merge in its place: isolating it on the
      two chapters Qwen did *not* split, Qwen was 5/6 folded against Luna's 6/6 raw — so the
      order of causes is **model quality → the merge → the matcher**, and B3 addresses the
      middle one. Normalization cannot reach the four failures below, which are genuine
      rewriting, verified against the book text:

      | model returned | book actually says | error |
      |---|---|---|
      | `Charles won't be going, said Cyrus.` | `"Charles won't be going," Cyrus said.` | speech tag reordered, internal quotes dropped |
      | `Cathy had the inhuman attribute…` | `She had the inhuman attribute…` | pronoun replaced with the character's name |
      | `…every single thing. He's—how old? "Seventeen."` | `…every single thing. I'd even tell him why you didn't tell him before. He's—how old?` | a sentence elided, then a reply spliced in across a paragraph break |

      Carrying the parts' original `quote` strings through in code fixes **all** of these,
      because the string is never re-emitted. Expect 11/11 rather than 7/11.
      _Done: this was measurement/analysis, not a code task — see B3 below for the fix it
      argues for. ⚠️ Relabeled from its original "B3" to B1c: TASKS.md had two items both
      labeled B3 (this one and the merge fix below); decisions.md's own "M35 §B3" references
      already meant the merge fix, so that item keeps the name and this one, being purely
      the case for it, moves off it rather than the other way round._
- [x] **B2.** Stop falling back to `chapterStartAnchor` for posed questions. An unlocatable
      quote produces a **chapter-level question** (M32 B's `chapter_questions`) instead of a
      highlight parked on the chapter's first 120 characters. The two features resolve each
      other; a wrong anchor is worse than no anchor.
      _Done: `routes/digest.ts`'s chapter-anchor route, `seedChapterQuestionIfAbsent`
      (chapterQuestions.ts). ⚠️ Scoped to a **real, non-empty** quote — the Scan's book-band
      click-through (`ScanPage.tsx`) sends an empty quote on purpose to land on the chapter's
      own opening, and still goes straight to `chapterStartAnchor` exactly as before; only a
      posed question's own quote takes this new path. See decisions.md 2026-08-31 (night)._
- [x] **B3.** Take quotes away from the merge step. `mergeThematicParts` returns only
      `analysis` and `themes`; **code** selects which questions survive — one per part, up to
      3 — carrying each original `quote` string through untouched. ⚠️ This is settled
      decision 2 applied where it wasn't: `THEMATIC_MERGE_INSTRUCTIONS` currently *asks* the
      model in English not to paraphrase a quote, when code can make it impossible. The merge
      call receives no chapter text, so it has no way to verify one either.
      _Done: `thematicBuild.ts` — `ThematicMergeSchema` drops `questions` from the merge
      call's schema entirely; `selectMergedQuestions` takes each part's first question, in
      part order, capped at `MAX_QUESTIONS`. Re-tested in `thematicBuild.test.ts` (a merge
      response with a fabricated `questions` field is proven inert; surviving quotes are
      exactly the parts' own, one real / one fabricated, located accordingly)._

_Acceptance: on a provider whose budget forces chapters to split, every question's quote is
byte-identical to the quote its part produced; a question whose quote cannot be located
appears as a chapter question, and no highlight is created at the chapter's opening._
_Status: covered by unit tests (`thematicBuild.test.ts`'s merge-passthrough case,
`chapterQuestions.test.ts`'s `seedChapterQuestionIfAbsent` cases). **Not yet exercised
against a real split chapter on the operator's actual digest provider** — the Verify section
below still needs a live run, same as M34 §0c flagged for its own measurements._

#### C. Themes carry quotes

- [x] **C1.** `ThematicPartSchema`'s `themes: string[]` becomes
      `themes: { name: string; quotes: string[] }[]`, 1–3 verbatim quotes per theme, located
      by `locateQuoteAnchor` and stored with their offsets.
      _Done: `thematicBuild.ts`'s `ThematicThemeSchema` + `evidenceFilterThemes` (per-part,
      against that part's own text). The merge step stays name-only per B3's precedent
      (`ThematicMergeSchema` unchanged) — `attachMergedThemeQuotes` reattaches each merged
      name's quotes from the originating part after the model call, never trusting the merge
      with quote content. ⚠️ **"stored with their offsets" turned out to mean at C5's
      highlight-creation time, not in `thematic_digests.themes`'s own JSON** — the type is
      literally `{name, quotes: string[]}[]` as specified, and offsets are computed (again,
      never cached) wherever a quote actually becomes a highlight row. `thematicStore.ts`'s
      `ThematicTheme` type, `listThemeVocabulary` maps `.name`. Tested in
      `thematicBuild.test.ts`._
- [x] **C2.** Questions may reference a theme, so a posed question and the theme it belongs
      to point at the same evidence.
      _Done: `ThematicQuestionSchema.theme` (nullable), validated in
      `thematicBuild.ts`'s `validateQuestionThemes` against that part's own surviving theme
      names — a name that doesn't match is nulled, never trusted. Carried through the merge
      untouched (same as the question's own `quote`); note it still names a *part*-level
      theme, which the merge may have reworded — full stitching into the same
      thread/highlight is §C5's job, not built here. Client schema
      (`ThematicQuestionSchema`/`ThematicChapterStatusSchema.themes`) updated to match._
- [x] **C3.** ⚠️ **Evidence is the limit, not the count — do not scale the ceiling by chapter
      length.** M34 §0b measured it: across chapters of 6,903 / 12,367 / 12,529 chars the
      model returned **7, 7, 7 themes and 3, 3, 3 questions**. Themes never touched their
      ceiling of 8; questions sat on their ceiling of 3. **Both are constants with zero
      variance across a 1.8× length spread**, so a length-scaled ceiling would only replace
      one constant with a different constant that code picked. That is code deciding, and it
      should not be dressed as the model responding to content.
      **The lever that does vary with content is already in C1: require a locatable verbatim
      quote per theme, and let code drop the ones that fail.** A thin chapter cannot evidence
      seven themes; a dense one can. Settled decision 2 applied to counts — the model
      proposes N, code disposes of the unevidenced ones, and the surviving count is a
      property of the chapter rather than of the prompt.
      _⚠️ **Re-measured 2026-08-31 across six East of Eden chapters, four merged and two
      unsplit: themes came back 8 every single time**, against Kafka's 7, 7, 7. Not a merge
      artifact (the unsplit ones are 8 too) and not within-book length sensitivity (EoE spans
      24K–46K at a flat 8; Kafka 6.9K–12.5K at a flat 7) — **a per-book constant**, and
      separating "long book" from "this book" needs a ~25K Kafka chapter. Same correction for
      analysis length: EoE runs 643–832 chars split *and* unsplit against Kafka's
      1,504–1,971 — the book, not the merge._
      _⚠️ **And one caveat from the model A/B, with the one-line test that settles it.** GPT
      5.6 Luna independently returned **8 on all six** EoE chapters — the ceiling — exactly as
      Qwen did, while Qwen sat at 7 (below the ceiling) on every Kafka chapter. Two very
      different models converging on the cap is better explained by **the cap binding on this
      book** than by "the model is not measuring the chapter", which weakens the reasoning
      above without changing this item's conclusion: whatever varies, it is not varying with
      length. **Before writing more prose about what the counts mean, raise `MAX_THEMES` to 12
      and re-run one chapter of each book.**_
      _Done: `MAX_THEMES` raised 8 → 12 in `thematicBuild.ts`, and evidence-filtering (C1)
      is the lever that actually varies with content — a theme survives only with at least
      one locatable quote. **Re-running one chapter of each book to see whether 12 still
      binds is a real-provider measurement, the operator's call, not built here.**_
- [x] **C3a.** ⚠️ **Do not vary the theme count deliberately for the index use.** Themes feed
      the Scan, the vocabulary, distillation and M34 §C's ranking. If long chapters get more
      themes they overlap with everything more often, so **length becomes a confound in the
      relevance ranking** — a long chapter would be selected for being long. Roughly uniform
      counts make the comparison honest. Questions are the opposite case: the reader *sees*
      them (`ChapterEndPrompt`), so a padded third question is a visible cost, and there the
      evidence filter should be allowed to leave a thin chapter showing one.
      _Done: no code change is the point — verified no length-scaled ceiling exists anywhere
      in `thematicBuild.ts`; `MAX_THEMES`/`MAX_QUESTIONS` are flat constants._
- [x] **C3b.** ⚠️ **Fix what a theme *is* — the prompt is asking for names and getting
      theses.** _(Also a weak-model fix: GPT 5.6 Luna already returns clean 2–4 word noun
      phrases — "Secrecy and revelation", "Mercy versus justice" — with no prompt change,
      while Qwen was inconsistent **across books**, emitting long theses on Kafka and bare
      single words ("Secrets", "Guilt") on East of Eden. ⚠️ Note this does **not** rescue
      §C0: even Luna's well-formed names repeat across chapters exactly zero times.)_ `thematicInstructions` says "short theme or motif names, at most 8" and the
      model returns "Self as split into protective/hardened alter-ego (Crow) and vulnerable
      self (Kafka)". Ask for a 2–4 word noun phrase with an explicit contrast example
      ("Fate versus free will", not a sentence), and cap it in the schema. This is a
      prerequisite for M34 §C, for `themeTagging`'s "pick from this exact list" (which is
      currently handed one unique essay-fragment per chapter per theme), and for the Scan's
      theme filter, whose dropdown would otherwise hold 7 × N distinct sentences.
      ⚠️ The one thing being lost is real: the thesis carries nuance the label does not. Put
      the nuance in the analysis prose, where it already belongs, not in the index key.
      _Done: `thematicInstructions` now asks for "a 2-4 word theme or motif name... a label,
      not a sentence" with a contrast example, and `ThematicThemeSchema.name` caps at 60
      chars as a backstop (the prompt wording is the real fix, per this item's own note)._
- [ ] **C3c.** The only place chapter length genuinely argues for scaling is where the *unit*
      differs, not the content: Metamorphosis's five "chapters" are whole parts (median 38K
      chars) against Kafka's ~12K. That is a spine-section-is-not-a-chapter problem, shared
      with the digest and the Scan, and if anything scales it should scale on that and say so.
      _Not built — recorded here as a known scope note (shared with the digest and the Scan),
      same as it was before this session; no acceptance criterion of its own to build against._
- [x] **C4.** ⚠️ **Decided 2026-08-31 by the operator: drop and re-run, do not migrate.**
      `thematic_digests.themes` changes shape (string → object with quotes) *and* its contents
      are rewritten by C3b, so a migrated row would carry the old prompt's theses in the new
      shape — the worst of both. Only 3 thematic rows exist library-wide, so the cost is
      minutes of local inference. Delete `thematic_digests` rows on migration and let the
      reader re-run; **also clear `book_themes` / `theme_parents`**, whose children are
      keyed on the old theme strings and would otherwise point at names that no longer exist.
      ⚠️ Do **not** touch `canonical_themes` — it is library-wide memory and holds the colour
      assignments (settled in `canonicalThemes.ts`'s own comment).
      _Done: migration 33 (drop-and-clear only — no shape change was needed at the SQL level
      since `themes`/`questions` are JSON TEXT columns; C1's type change and C3b's prompt
      rewrite are what actually change the shape stored). `canonical_themes` untouched;
      covered by a dedicated `db.test.ts` case seeding all four theme-adjacent tables and
      asserting the three per-resource ones clear while `canonical_themes` survives.
      **Re-running the thematic pass to repopulate under the new prompt is the operator's
      call**, same as §A3/§0c's own real-data passes._
- [x] **C5.** Machine-proposed quotes are stored as **highlight rows** carrying
      `origin: 'reader' | 'thematic'`, not as a new table. Migration 26's own comment is the
      precedent: a definition rides on its highlight so the glossary is "a filtered view, one
      predicate" and `deleteHighlight` cleans up with no cascade to forget. This inherits
      rendering, anchoring, the Scan, jump-to and deletion for free.
      _Done: migration 35 (`highlights.origin`, default `'reader'`), `createHighlight`'s
      optional `origin`. `digest/thematicHighlights.ts`'s `persistThematicHighlights`, wired
      into `runThematicDigest` right after a chapter's thematic row commits — one
      `createHighlight` (`kind: "honey"` — "Key quote", the label M30 A already gave that
      slot; settled decision 16 forbids inventing a fifth) per evidenced quote, one thread
      per theme via §D's `getOrCreateThread`/`addThreadAnchor` ("one theme → one annotation →
      N anchors", §D6). Idempotent (`findHighlightByExact` reuses an existing row) and guards
      against a highlight already anchoring a *different* thread
      (`threads.ts`'s `isHighlightAnchored`) rather than double-linking or throwing on
      `thread_anchors`' primary key. Tested in `thematicHighlights.test.ts` and
      `thematicBuild.test.ts`._
- [x] **C6.** ⚠️ **One exported predicate, used everywhere.** `origin: 'thematic'` rows
      otherwise pollute the reader's highlight count, the Annotations list, the Scan's Mine
      layer and the vault publish. Every one of those applies the same filter, from one
      place — the same discipline M36 §A needs for definitions.
      _Done: one predicate per runtime, same name and shape — server
      `annotations/highlightOrigin.ts`, client `highlights/highlightOrigin.ts` — mirroring
      `glossaryEntries`' existing precedent. Applied unconditionally (independent of §C7's
      toggle) at `library/store.ts`'s `listResourceSummaries` (SQL `origin = 'reader'`,
      both the highlight and thread counts), `ReaderView.tsx`'s count badge and
      `AnnotationsOverview` (a derived `readerHighlights`), and `vault/compiler.ts`'s
      `answeredHighlights`. Tested in `library/store.test.ts`, `scan.test.ts`,
      `compiler.test.ts`._
- [x] **C7.** A reader-facing **show/hide** toggle for thematic quotes in the book, defaulting
      to **off**. "Only my own marks" is the reasonable expectation.
      _Done: migration 36 (`resource_ai_settings.show_thematic_quotes`, default 0) —
      `digest/thematicQuoteVisibility.ts` mirrors `lookahead.ts` exactly. GET/PUT
      `/api/resources/:id/show-thematic-quotes`. Gates two things: whether
      `GET /:id/highlights` includes thematic rows at all (so they never even reach the
      reader's inline marks/margin rail unless on) and the Scan's Mine layer
      (`buildScanData`'s `highlights` array) — `totalHighlights` stays reader-only regardless
      (§C6). Client toggle lives beside the lookahead pill/icon in
      `ContextLadderToggle.tsx` ("Thematic quotes", same wide/narrow dual-render). Tested in
      `scan.test.ts`._

_Acceptance: a thematic run produces themes with locatable quotes; with the toggle off the
reader's highlight count and Annotations list are identical to before the run; with it on the
quotes appear in the text and jump correctly; deleting the book removes them._
_Status: covered by unit tests across `thematicBuild.test.ts`, `thematicHighlights.test.ts`,
`library/store.test.ts`, `scan.test.ts`, `compiler.test.ts`. **A live thematic run against the
operator's real library, and a manual toggle-on/toggle-off pass in the running app, have not
been done this session** — same "read/write pass over real data is the operator's call" line
§0c/§A3 already drew._

#### D. An annotation may have many anchors

- [x] **D1.** `thread_anchors(thread_id, highlight_id, ordinal)`. ⚠️ **Additive only** —
      `threads.highlight_id` stays `UNIQUE` and stays the primary anchor, so no existing path
      changes; backfill one row per existing thread.
      _Done: migration 34 — junction-table shape matching `highlight_tags`/`highlight_themes`
      (composite PK, plain `REFERENCES`, no `ON DELETE`), indexed on `highlight_id` (the hot
      path — "does this highlight anchor a thread", not "list a thread's anchors"). Backfilled
      one row per existing thread at `ordinal` 0 in the same migration. `threads.ts`'s
      `createThread` now also writes the primary's own `thread_anchors` row (in the same
      transaction) so every thread created going forward carries full anchor coverage from
      the start — `addThreadAnchor`/`listThreadAnchors`/`isHighlightAnchored` round out the
      API. Tested in `threads.test.ts`, `highlights.test.ts`, `db.test.ts`._
- [x] **D2.** This is *toward* CLAUDE.md's stated discipline, not away from it: the W3C Web
      Annotation model has one body and **one or more** targets. Say so in the migration
      comment.
      _Done: migration 34's own comment states it, referencing CLAUDE.md's engineering
      discipline entry._
- [x] **D3.** Clicking any linked quote opens the same annotation.
      _Done: `listHighlightsWithThreadsForResource` now also returns `primaryHighlightId` —
      null for an ordinary highlight or a thread's own primary, set to the primary's id for a
      genuine secondary anchor. Client resolves through it
      (`threads/resolvePrimaryAnchor.ts`'s `resolveOpenHighlightId`) at every place a click
      opens the panel — a mark click in the book text, the Scan's jump-to (mount-time
      `initialHighlightId`), and the margin-rail/Annotations-overview/glossary shared
      `handleOpenThread` — while still **navigating to the specific passage clicked** (the
      panel's identity resolves to the primary; the reader's position does not). Tested in
      `highlights.test.ts` (`primaryHighlightId` shape) and
      `threads/resolvePrimaryAnchor.test.ts` (the resolution rule itself)._
- [x] **D4.** The annotation editor gets `< >` traversal across its anchors, near the quote at
      the top. Order is `spineIndex, offset` — which is the other thing §A is for.
      _Done: `GET /api/threads/:id/anchors` (`listHighlightsForThread`, ordered
      `spine_index, "offset" IS NULL, "offset", ordinal` — reading order, not creation order).
      `ThreadPanel.tsx` fetches it once a real thread exists, renders `‹ N of M ›` next to the
      quote (reusing `FindBar.tsx`'s exact glyphs/pattern and `search/findCursor.ts`'s
      `stepFindCursor` — no new interaction design) only when there's more than one anchor,
      and the quote text itself tracks the current anchor. Stepping calls back to
      `ReaderView.tsx`'s `handleJumpToAnchor`, which navigates the rendition **without**
      touching `expandedThread` (that would remount the panel by its `key` and lose the
      traversal position). Tested in `highlights.test.ts` (`listHighlightsForThread`'s reading
      order)._
- [x] **D5.** ⚠️ **Decided 2026-08-31.** Deleting a linked highlight removes **that anchor
      only**; the thread survives while at least one anchor remains, and deleting the last
      anchor deletes the thread — which is exactly today's behaviour in the one-anchor case,
      so nothing changes for existing data. **The trap:** `threads.highlight_id` is the
      primary anchor and has a foreign key, so deleting the primary while others remain must
      **promote the next anchor to primary**, never cascade the thread away. A test for that
      specific order is not optional.
      _Done: `annotations/highlights.ts`'s `deleteHighlight` rewritten — looks up the thread
      via `thread_anchors` (falling back to `threads.highlight_id` directly for a thread
      predating any anchor row, so both shapes converge on the same logic), deletes only this
      highlight's own anchor row, and either promotes the oldest remaining anchor to primary
      (`UPDATE threads SET highlight_id = ...`, a no-op when the deleted highlight wasn't
      primary) or, if none remain, runs today's full cascade unchanged. Three dedicated tests
      in `highlights.test.ts`: non-primary delete leaves the thread and primary untouched,
      primary delete with survivors promotes the next one by ordinal (not an arbitrary
      survivor), and last-anchor delete cascades exactly as before._
- [x] **D5a.** The vault publish writes **one note with its sources listed in reading order**,
      not one note per anchor. A multi-anchor annotation is one thought about several
      passages; splitting it at publish time would undo the feature in the projection.
      _Done: `vault/compiler.ts`'s `publishResource` now fetches each thread's full anchor
      list (`listHighlightsForThread`) and renders a multi-quote block (each quote + its
      chapter label) when there's more than one; a single-anchor thread's note is
      byte-for-byte the same shape as before this milestone. The distillation call itself
      also sees every passage, not just the primary's. `publishStore.ts`'s ledger was already
      keyed by `thread_id`, so no schema change there. Tested in `compiler.test.ts`
      (multi-anchor note + reading order, and single-anchor's unchanged shape)._
- [x] **D6.** This is the vehicle for §C's multi-quote themes: one theme → one annotation → N
      anchors. Build D before wiring C5's quotes into it, or C5 produces N unrelated
      highlights.
      _Done: built and tested in that order — §D1–§D5a landed first, §C5 wires into
      `getOrCreateThread`/`addThreadAnchor` only after, exactly as this item requires._

_Acceptance: three quotes linked to one annotation open the same editor from any of them;
`< >` walks them in reading order and moves the reader's page; a reload preserves the links._
_Status: covered by unit tests across `threads.test.ts`, `highlights.test.ts`,
`resolvePrimaryAnchor.test.ts`, `compiler.test.ts`, `db.test.ts`. **Manually linking three
quotes by hand in the running app and walking them with `< >` has not been done this
session** — same live-app verification line the Verify section below already calls for._

#### E. Theme zones, and the Scan gets sub-chapter resolution

- [x] **E1.** The thematic pass returns, per theme, the **sentence a theme starts at** and the
      **sentence it ends at** — text, never offsets — and code locates both.
      _Done: `ThematicThemeSchema` gains nullable `zoneStart`/`zoneEnd`, and
      `thematicInstructions` asks for them per theme (null/null when a theme runs through the
      whole chapter rather than one stretch). Carried through evidence-filtering untouched
      (`evidenceFilterThemes` already spreads the whole theme object) and through the merge
      step the same "reattach from whichever part first proposed the name" way §C1 already
      reattaches quotes (`attachMergedThemeQuotes`) — a part's zone sentences are never
      meaningful as offsets across a part boundary, only as verbatim text, and every consumer
      re-locates against the *whole* chapter's section text regardless, so no part-offset math
      was needed. Located (never cached) in `themeZones.ts`'s `computeThemeZone`, called from
      `scan.ts`. Tested in `thematicBuild.test.ts`._
- [x] **E2.** ⚠️ **Four sanity checks, all required.** A zone is kept only if both endpoints
      locate, start precedes end, the span lies inside the chapter, and it does not exceed a
      set fraction of the chapter (a "zone" covering 95% is the model shrugging). Any failure
      **drops the zone and keeps the theme at chapter resolution** — degrade to today's
      behaviour, never to bad data.
      _Done: `themeZones.ts`'s `computeThemeZone`, all four checks explicit (including the
      third, which `locateQuoteAnchor`'s own bounds already guarantee structurally — kept
      explicit anyway since this item names it as one of the four). The fraction cutoff is
      `MAX_ZONE_FRACTION = 0.6`, a **designed, not measured** constant — no live provider ran
      building this; reasoning in the file's own comment and in decisions.md's 2026-09-01
      (later) entry. Tested in `themeZones.test.ts` (one case per check, plus a genuine
      single-sentence zone kept, not rejected, when start and end name the same sentence)._
- [x] **E3.** The Scan's Book layer renders surviving zones precisely and themes with no
      surviving zone as today's quantised chapter-wide band — **both at once, in the same
      view**.
      _Done: `ScanBookChapter` gains `themeZones` (name + book-wide `startPercent`/
      `lengthPercent` + the located exact `startQuote`), computed in `scan.ts`'s
      `buildScanData` against each revealed chapter's own section text and spoiler-gated
      identically to `themes`. `HeatStrip.tsx` renders one precise band per surviving zone and
      the existing whole-chapter band only for the chapter's *other* themes (labelled with just
      those names) — omitted entirely once every theme in the chapter has a zone, so a themed
      zone is never drawn twice. Reuses `.bookBand`/`.bookBandLit` verbatim rather than a new
      style, per settled decision 12. Tested in `scan.test.ts`._
- [x] **E4.** ⚠️ **This scopes a written rule; do not treat it as repealing one.**
      decisions.md 2026-07-29 (addendum) forbids Book-layer data in the Mine layer's precise
      register *because chapter-resolution data drawn precisely claims accuracy it does not
      have*. A zone that passed E2 is no longer chapter-resolution. **The checks are the
      condition** — if E2 is weakened, E3 becomes the thing that rule forbids.
      _Done: no code of its own — E2's checks are the enforcement, and nothing about the Mine
      layer's own rendering changed._
- [x] **E5.** "Mine wins on overlap" for hit-testing still holds — a zone must never steal a
      click from a highlight.
      _Done: zone bands render in the same Book-layer pass, still painted before the Mine
      highlight bands in `HeatStrip.tsx` — unchanged DOM-order precedent ("Rendered *before*
      the Mine highlight bands below so normal DOM stacking gives 'Mine wins on overlap' for
      free")._
- [x] **E6.** Clicking a zone opens the reader at its start offset, reusing the search-hit
      jump path rather than a second implementation.
      _Done: `ScanPage.tsx`'s `handleOpenZone` navigates with `jumpToFindQuery`/
      `jumpToFindHitIndex: 0`/`jumpToFindMatchMode: "substring"` — the same handoff
      `handleOpenSearchHit` already uses, never the chapter-anchor route (a zone isn't a
      highlight and this click shouldn't create one). `startQuote` is the *located* exact
      substring, not the model's raw sentence, specifically so this literal-substring jump
      can't miss on typographic drift. ⚠️ Known, accepted edge case in decisions.md: an
      identical sentence recurring earlier in the book would jump to the wrong occurrence —
      the task doc's own instruction to reuse this path rather than build a second, spine-
      scoped one._

_Acceptance: a chapter where a theme genuinely occupies one stretch shows a zone over that
stretch and not the whole chapter; a theme diffused through a chapter still shows a band; a
zone failing any check is invisible rather than wrong; clicking a zone lands on the right
page._
_Status: covered by unit tests across `themeZones.test.ts`, `thematicBuild.test.ts`,
`scan.test.ts`. **A live thematic run and driving the Scan by hand were not done this
session** — the shared dev server was already running with a live browser attached when this
landed, and seeding test thematic data into that database was judged too risky to whatever
that session is doing. Same "operator's call" line every other M35 real-data pass already
carries._

#### F. The chapter digest, expanded

- [x] **F1.** Each chapter on the digest page expands (once it has a thematic analysis) to
      show the analysis and its associated quotes, with `< >` traversal across chapters.
      _Done: the analysis (and questions) were already always shown once a chapter is
      analyzed+revealed (pre-M35 behaviour, unchanged) — what "expand" adds here is the
      themes' quotes, which had no UI at all before this. `DigestPage.tsx`'s new "Show quotes"
      toggle (`expandedSpineIndex`, one chapter at a time) reveals each theme's name and its
      evidence quotes; `‹ N of M ›` steps across every analyzed-and-revealed chapter, reusing
      `stepFindCursor` and `IconButton`'s exact glyphs — the same control ThreadPanel's §D4
      anchor stepper already established, not a second one designed for the same idea. Steps
      scroll the newly-expanded card into view._
- [x] **F2.** A quote there is clickable through to the reader — same jump path as E6.
      _Done: `handleOpenThemeQuote` navigates with `jumpToFindQuery`/`jumpToFindHitIndex: 0`/
      `jumpToFindMatchMode: "substring"`, identical to the Scan's `handleOpenZone` — never the
      chapter-anchor route, since a theme's quote isn't a highlight. `routes/digest.ts`'s
      `buildThematicStatus` now normalizes every theme's quotes to their *located* exact
      substring (`locateQuoteAnchor(section.text, quote)?.exact`) before they reach the
      client, the same reasoning §E6's `startQuote` already used — a quote passed §C3's
      evidence filter so this always locates; the `?? quote` fallback exists only so a schema
      surprise can't crash the route._
- [x] **F3.** ⚠️ Respects the M34 §B mask and the existing per-chapter reveal. An expanded
      chapter past the bookmark shows what a collapsed one would: nothing, until revealed.
      _Done: no code of its own — the "Show quotes" toggle only renders inside the existing
      `t?.analyzed && c.revealed` block (same gate §B's mask already drives), and `‹ N of M ›`
      can only step onto a chapter in `analyzedSpineIndices`, which is filtered to
      `analyzed && revealed` — an unrevealed chapter is structurally unreachable, never a
      case the stepper has to special-case._

_Acceptance: expanding a digested chapter shows its analysis and quotes; clicking a quote
opens the book at it; chapters past the bookmark stay redacted when expanded._
_Status: covered by the server/web builds and full test suites (both green, no regressions —
462 server tests, 473 web tests). **Driving this by hand in the running app was not done this
session**, same reason as §E: the shared dev server was already running with a live browser
attached when this landed._

#### G. Thematic gets the Digest's own controls, and annotations get a manual link path

Scoped 2026-09-01 (decisions.md, "closing the 'operator's call' UI gap"). Every §A–§F
Verify item above is a real server capability no one has driven by hand — this section is
what makes that possible, rather than adding a seventh unexercised behaviour. Two
unrelated gaps, grouped because both are "the server can do this and nothing in the UI
asks it to."

- [x] **G1.** The thematic pass gets a chapter-range picker — `ChapterDial` From/To,
      exactly as `DigestSpotlight.tsx` already built for the plot digest (M20.5) — instead
      of `DigestPage.tsx`'s `handleAnalyzeThemes` always spanning first-to-last digested
      chapter. Same `POST /:id/thematic` endpoint, same `spineStart`/`spineEnd` body — no
      server change.
      ⚠️ **Corrected after checking `thematicBuild.ts`, before shipping the wrong scope
      twice: the dials span the whole book, not just digested chapters.** The first pass
      through this item assumed a thematic run needs a chapter's own plot digest and bounded
      the dials to `status.chapters.filter(c => c.digested)` — carrying forward the *old*
      hardcoded `handleAnalyzeThemes`'s own range (first-to-last digested chapter) without
      checking whether that range was ever a real requirement. It wasn't: `runThematicDigest`
      takes `sections: ResourceTextSection[]` (`getResourceTextSections` — the book's raw
      text) and never reads `chapter_digests`; the route has no digested-range check either.
      A chapter can be thematically analyzed with no plot digest done on it at all.
      _Done: `DigestPage.tsx`'s `allChapters` (`status.chapters`, unfiltered — corrected from
      an earlier `digestedChapters` filter), `thematicStartIdx`/`thematicEndIdx` state
      re-synced to the full book span whenever `allChapters.length` changes (a manual
      narrowing is scoped to the current visit, same as the plot digest's dials promise
      nothing across a change in what they dial over). Two `ChapterDial`s, hidden below two
      chapters (nothing to narrow). `handleAnalyzeThemes` reads the dialed range instead of
      always the full span; the button's label dropped "for digested chapters" since it no
      longer describes what the button does._
- [x] **G2.** Inline cancel for the thematic, tagging, and distill jobs, right on
      `DigestPage.tsx`, the way `DigestSpotlight.handleCancel` already calls the existing
      `cancelJob` registry function for the plot digest. Today all three buttons go from
      their idle label to a disabled "…ing" label with no way to stop short of finding the
      job in the global tasks tray. ⚠️ This is exposing a control that already exists for
      every job kind, not building a new cancellation mechanism.
      _Done: `useJobs()`'s own `cancel` (renamed `cancelJob` at the destructure site to avoid
      shadowing), three one-line handlers, a `Button` rendered beside each "…ing" label only
      while that job's id is set._
- [x] **G3.** `POST /api/threads/:id/anchors { highlightId }` — the write-side counterpart
      to §D4's existing read-only `GET .../anchors`. Wraps `addThreadAnchor`, guarded by
      the same `isHighlightAnchored` check `persistThematicHighlights` (§C5) already uses:
      refuse with 409 when `highlightId` already anchors a *different* thread — the
      ground rule is a highlight may join a thread, a thread may never join a thread — and
      no-op (200) when it already anchors this one. A highlight with a thread of its own is
      the only thing this ever refuses; a plain, threadless highlight always succeeds.
      _Done: `routes/threads.ts`'s `POST /:id/anchors`, `AddThreadAnchorBodySchema`
      (shared/src/schemas.ts). Uses a new `getAnchoredThreadId` (annotations/threads.ts) —
      `isHighlightAnchored` itself only answers yes/no, not *which* thread, which is what
      distinguishes the no-op case from the refusal — and rejects a highlight belonging to a
      different resource entirely (400 `cross_resource`, via the thread's own primary
      highlight's `resourceId`) as a second guard `persistThematicHighlights` never needed
      (it never crosses books). A second small addition this section turned out to need:
      `POST /api/highlights/:id/thread` (`getOrCreateThread` + a new `getThreadSummary`
      helper) — the normal `POST /api/threads` path requires a non-empty question, and
      §G4's "Link a quote" needs a real `threadId` to anchor to *before* any question is
      asked. Client: `threadAnchorsApi.ts`'s `addThreadAnchor`, `ReaderView.tsx`'s
      `postHighlightThread`. Tested: `annotations/threads.test.ts`'s "M35 §G3"/"M35 §G4"
      blocks (`getAnchoredThreadId`/`isHighlightAnchored`/`getThreadSummary`)._
- [x] **G4.** A "select/add highlight" reader mode, entered two ways, both producing a
      `thread_anchors` row via §G3:
      - from the existing selection popup, on a highlight/selection with **no thread yet**
        — "Link a quote" — this is how a brand-new multi-anchor thread gets built, before
        any note or question has been asked of it;
      - from an **already-open** `ThreadPanel` — "Add additional quotes" — growing that
        specific thread.

      While the mode is active: a banner names it and offers its own on-screen **×**; Esc
      also exits; page turning keeps working, since assembling anchors across a book-
      spanning theme is exactly the case this is for. Highlighting new text prompts a
      confirm ("Add this quote to the annotation?") before the highlight is created
      (`origin: 'reader'`) and linked — this is the *only* way in from the panel-opened
      entry point. From the selection-popup entry point, clicking an **existing,
      threadless** highlight is also permitted and links it directly, in place, with the
      same confirm; clicking one that already anchors a different thread is refused with a
      visible inline message (§G3's 409) and the mode stays open rather than exiting or
      silently doing nothing. ⚠️ **The mode never closes itself after one addition** — it
      stays open so several quotes (any mix of fresh selections and one pre-existing
      highlight) can be attached in a single pass; only Esc/× ends it. Once at least one
      anchor exists, the panel opens (or stays open, for the panel-opened entry) showing
      the thread, and §D4's existing `‹ N of M ›` stepper walks whatever was just built —
      no new traversal UI.
      _Done: `ReaderView.tsx`'s `linkQuoteMode`/`linkQuoteConfirm`/`linkQuoteError` state
      (mirrored into `linkQuoteModeRef` for `handleMarkClicked`, registered once per
      rendition mount, the same reason `pendingSelectionRef` exists) plus `handleLinkQuote`
      (entry A), `handleStartAddQuotes` (entry B), `handleConfirmLinkQuote`,
      `handleCancelLinkQuoteConfirm`, `handleExitLinkQuoteMode`. New `LinkQuoteBanner.tsx`,
      built on `FindBar.tsx`'s own centred-pebble-over-the-page pattern (a mode banner
      anchored to a fixed position rather than the click/selection, since `markClicked`
      carries no pointer coordinates to anchor a floating popover to); its "confirm" state
      doubles as the display for a fresh selection (no separate state needed — while the
      mode is active, a live `pendingSelection` *is* the pending confirm) and for an
      eligible existing-highlight click (`linkQuoteConfirm`). `AskPill` gained a "Link a
      quote" button (`onLinkQuote`) and is hidden while the mode is active, so a selection
      never drives both it and the banner's confirm at once. `ThreadPanel` gained
      `onAddQuotes` (only rendered once a real thread exists) and `anchorsVersion` (bumped on
      every successful link, since the anchors-fetch effect is keyed on `threadId`, which
      never changes for an already-existing thread and so would otherwise never refetch).
      `handleEscapeShortcut` exits the mode as the next-innermost layer after the find bar;
      a safety effect exits the mode if the open panel ever changes to a different
      highlight (a margin-rail/overview click opens a different thread through
      `handleOpenThread`, which has no reason to know about this mode). New z-index token
      `--reader-z-link-quote-banner: 13` (ReaderView.module.css's own layering table)._
- [x] **G5.** Ground rule, not a task of its own: linking only ever goes highlight → thread,
      never thread → thread. Two already-annotated passages cannot be merged this way.
      Deferred "for now" per the operator, same shape as C3c's parked scope note — revisit
      only if a real need for it shows up, not before.
      _Done: enforced by §G3's `getAnchoredThreadId` check (server) and reflected by §G4's
      mode restricting the panel-opened entry to fresh text only and refusing an already-
      threaded highlight clicked from the selection-popup entry, in place, with a visible
      message. No merge-two-threads path exists anywhere in this section._

_Acceptance: from a highlight's selection popup, three quotes — two fresh selections and
one pre-existing untethered highlight — can be attached to one new annotation without
leaving the mode between additions. From an already-open annotation's panel, "Add
additional quotes" attaches a new quote by selecting fresh text, and the existing `‹ N of
M ›` stepper walks all of them after a reload. Attempting to link a quote that already
belongs to a different annotation shows a visible refusal and never merges the two
threads. Dialing a narrower chapter range for a thematic run and cancelling it in flight
behaves identically to the plot digest's own dials and cancel._
_Status: server logic covered by unit tests (`annotations/threads.test.ts`'s new blocks);
`tsc -b` and the full test suite are green on both packages with no regressions (467 server
tests, 473 web tests) and both packages build clean. **Driving any of G1–G4 by hand in the
running app has not been done this session** — same "operator's call" line every other
M35 real-data/live-UI item in this milestone already carries, and the whole reason this
section exists is to make that drive possible for the first time._

#### Verify

- [ ] Run a thematic pass over a real chapter range on the operator's actual digest provider.
      Confirm every stored quote locates, every theme has evidence, and no highlight was
      created at a chapter opening.
- [ ] Link three quotes to one annotation by hand, reload, and walk them with `< >`.
- [ ] Open the Scan with thematic quotes on and off; confirm the Mine layer's counts are
      unchanged by the run, and that a zone click lands on the passage it drew.
- [ ] §G: dial a narrower chapter range than "all digested" for a thematic run and confirm
      only that range analyzes; cancel a running thematic/tagging/distill job in place from
      the digest page and confirm it actually stops (not just the button re-enabling).
- [ ] §G: build a three-quote annotation from the selection popup (mixing fresh selections
      and one pre-existing highlight), then separately use an existing annotation's "Add
      additional quotes" to attach one more; confirm a highlight already anchoring another
      thread is refused rather than silently merged.

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

### M37 — The thematic substrate: making a brief cheap to change

Scoped 2026-08-31 (decisions.md). ⚠️ **Last, deliberately.** It optimises *re-runs*, which is
lower urgency than the query path, and it is the largest piece here. Do not start it before
M34 and M35 are verified.

**Why it exists:** decisions.md 2026-07-29 (later) records that "the thematic layer is cheap
to re-run and expected to be re-run". That is **false as implemented** — changing a brief
re-reads all 55 chapters at full text, for exactly what the first run cost. This makes the
claim true.

#### A. The substrate

- [x] **A1.** A brief-**blind**, one-time pass per chapter, from full text: verbatim passages
      with a line of context each, the chapter's claims and tensions, who holds which
      position. Stored per `(resource, chapter)`, keyed on the section's source hash the way
      the plot layer already is — not on the brief.
      _(`chapter_substrate` (migration 38), `server/src/digest/substrateStore.ts` and
      `substrateBuild.ts`. `ensureChapterSubstrate` returns an existing row untouched —
      coverage by row existence, same as `chapter_digests`, never by comparing `source_hash`,
      since resources are immutable on import. A passage is evidence-filtered via
      `locateQuoteAnchor` before storage, same "LLM proposes, code disposes" rule
      `evidenceFilterThemes` already applies to theme quotes.)_
- [x] **A2.** ⚠️ **Cap it, and scale the cap in code from chapter length** (a floor and a
      ceiling around ~1,500–2,000 tokens for a typical chapter). Same rule as M35 §C3: the
      model is never asked to decide its own budget.
      _(`substrateTokenBudget` clamps `[1500, 2000]` tokens scaled off the chapter's own
      length; `clampSubstrateToBudget` enforces it after generation — schema `.max()`s are a
      generous upper bound only, never the real limit, the same division of labor
      `clampToTokenBudget` (dictionary/define.ts) uses for Define's output cap.)_

#### B. The brief pass reads the substrate

- [x] **B1.** A brief-driven pass whose input is the substrate rather than the chapter,
      producing today's `{analysis, themes, questions}` shape unchanged.
      _(`runThematicDigest` calls `ensureChapterSubstrate` before `digestChapterThematic` and
      feeds it `serializeSubstrateForPrompt(substrate)` instead of `section.text`; the
      `ThematicPartSchema` output shape is untouched. A brief change no longer rebuilds the
      substrate — only the (now cheap) brief-driven call re-runs.)_
- [x] **B2.** ⚠️ **It must still emit verbatim quotes**, which is the whole reason A1 keeps
      passages rather than paraphrase. A pass with nothing verbatim to hand out re-creates
      exactly the ungrounded-anchor problem M35 §B exists to remove.
      _(`evidenceFilterThemes` now checks a proposed quote against the chapter's real text
      (`groundTruthText`), not the substrate serialization it was read from — a quote copied
      verbatim out of the substrate is, by A1's own construction, already a locatable
      substring of the chapter, so this is the same check as before, pointed at the text a
      highlight actually anchors into.)_

#### C. Append, and evict

- [x] **C1.** Quotes surfaced by any **full** re-read merge back into the substrate, so the
      bank grows toward what this reader keeps caring about and the third brief is cheaper
      than the second.
      _(`substrateBuild.ts`'s `mergeQuotesIntoSubstrate`, called from `runThematicDigest` after
      every chapter pass — `"notes"` mode too, not just `"full"`: a "notes" pass's quotes were,
      by §B2's construction, always copied out of the substrate it read, so it can only ever
      credit a passage already there, never invent one. A `"full"` pass can and does introduce
      a quote §A1 never kept — that's the actual merge-back this task asks for.)_
- [x] **C2.** ⚠️ **Append-only converges on being the chapter again.** The cap in A2 is a hard
      requirement here, with eviction: drop quotes no brief has ever drawn on, keep quotes
      that two or more briefs independently selected.
      _(Each `SubstratePassage` now carries `drawnByBriefHashes: string[]` — which briefs'
      thematic passes have selected it as theme evidence, by `hashBrief` value; a §A1 passage
      starts with none. `mergeQuotesIntoSubstrate` re-clamps to §A2's own length-scaled budget
      on every call, evicting by `sortPassagesByDrawPriority` first: 2+-draw passages, then
      1-draw, then never-drawn — stable within a tier, so among equally-cared-about passages
      the ones closer to the chapter's own reading order survive a clamp before later ones do.)_

#### D. The reader chooses which

- [x] **D1.** Two visible paths — **"re-read the book"** and **"re-read my notes"** — with the
      cost difference shown.
      _(`StartThematicDigestBodySchema` gains `mode: "notes" | "full"` (default `"notes"`).
      `runThematicDigest` threads it through: `"notes"` reads the substrate exactly as §B built
      it; `"full"` reads the chapter's own text instead, and — unlike `"notes"` — never skips a
      chapter already covered under the current brief, since asking for a full re-read only
      makes sense as a deliberate override. `DigestPage.tsx` shows both as separate buttons
      ("Re-read my notes" / "Re-read the book"), each with an inline description of what it
      costs; the tasks tray labels a `"full"` job "(full re-read)" so it doesn't look identical
      to the cheap default mid-run.)_
- [x] **D2.** ⚠️ Say plainly that the cheap path can miss things. A brief-blind extractor
      cannot know which passage a future brief will need; that is a real limitation, not a
      caveat to bury.
      _(A standing sentence under the two buttons, not a tooltip only: "'Re-read my notes' is
      cheap and usually enough, but it can miss a passage your saved notes never kept — the
      notes were written before this brief existed.")_

_Acceptance: a second brief over an already-substrated book costs materially less than the
first and still produces locatable quotes; a full re-read enriches the substrate; the
substrate never exceeds its cap for a chapter._

#### Verify

- [x] Run a brief, change it, re-run both ways on the same book. Compare ledger tokens and
      spot-check that the cheap path's quotes still locate.
      _(verified 2026-09-01 live against Metamorphosis, real `codex-cli`/gpt-5.6-luna calls,
      brief "Transformation, and transitions in life and adaptation": a `"notes"` run over all
      5 chapters completed, producing 5 `chapter_substrate` rows and 35 real, located
      `honey`/`thematic` highlights (`persistThematicHighlights` only ever creates one for a
      quote `locateQuoteAnchor` actually finds — 35 created, 0 dropped) — the "quotes still
      locate" spot-check. The usage ledger split the two operations exactly as designed:
      `substrate` (5 one-time calls, ~369K input tokens including the model's own context-cache
      reads) vs `thematic` (5 calls reading each chapter's substrate instead of its raw text).
      Then a `"full"` re-read of one already-covered chapter under the *unchanged* brief: the
      route still started a job (proving `"full"` bypasses the "already covered" skip that
      `"notes"` mode honours), the tasks tray showed "S3 · I (full re-read)", the chapter's
      `generatedAt` and `analysis` genuinely changed (7 themes vs. the original 8, not a
      cache hit), and `ensureChapterSubstrate` did not re-issue a `substrate` LLM call for that
      chapter (5 substrate calls before and after) — confirming a `"full"` re-read never rebuilds
      the base substrate, only the brief-driven pass on top of it. This run's `"full"`-mode
      quotes happened to match passages already in the substrate, so its live draws exercised
      §C2's *idempotent re-credit* path (re-running the same brief added no duplicate hash,
      draw count stayed 1) rather than §C1's new-passage merge — that path (a full re-read
      surfacing a quote §A1 never kept) is covered instead by `substrateBuild.test.ts` and
      `thematicBuild.test.ts`'s scripted tests, deterministically, since a real model's choice
      of quotes on a given day isn't something a live run can force.)_

---

### M38 — The Digest, reorganized: a landing page, one Analyse control, and a clearer reading-pane split

Scoped 2026-09-01 (post-M34–M37 UI feedback pass, this session). UI-only — no LLM-layer or
schema changes beyond §C1's reuse of the existing `/thematic` route with equal start/end.
Independent of M34–M37's LLM-layer work, but builds on the chapter thematic UI M35 §E/§F and
M37 already shipped (themes, quotes, the substrate/full re-read split) — do not start before
those are verified, since §B2 is a reskin of exactly that UI.

**Why it exists:** filed under "Area 3" of the 2026-09-01 UI feedback pass, alongside three bug
fixes tracked in decisions.md the same day. Reaching chapter 50's digest today means scrolling
past 49 preceding `DigestPage.tsx` chapter cards; the toolbar reads as four buttons of unclear
relationship ("Saved" greyed out and unexplained, "Re-read my notes", "Re-read the book", "Tag
highlights with themes", "Distil book-level themes"); and the reading pane's single "Digest this
chapter" button (`ReaderView.tsx`'s `digestCluster`/`handleDigestChapter`) conflates plot and
theme analysis with no way to choose one.

#### A. A landing page in front of the chapter list

- [x] **A1.** Opening the Digest (the 'g' shortcut / "Open digest") lands on a landing view, not
      straight into the scrolling chapter list: Tools (§B's Analyse/Consolidate controls),
      Reading brief (as today), Book so far (as today, clickable to open in full view), and a
      chapter grid.
- [x] **A2.** The chapter grid shows section number + chapter name per cell, with small
      checkmarks/icons for plot digest, thematic analysis, and rendered audio presence —
      reusing the status each chapter card already computes (`c.digested`, `t?.analyzed`, the
      audio-presence lookup `DigestPage.tsx` already loads), not a new query.
      ⚠️ Respect the same spoiler mask the chapter list already applies (`c.revealed`, decision
      8's masking rule) — a grid cell must not leak plot/theme completion state for a chapter
      past the bookmark; a checkmark is itself a spoiler-shaped signal ("something happens
      here").
- [x] **A3.** Clicking a chapter cell opens that chapter's own page — plot digest, thematic
      analysis, and quotes, scrollable — reusing the existing per-chapter card rendering
      (`DigestPage.tsx`'s chapter-card block) rather than rebuilding it.
- [x] **A4.** That per-chapter page shows the current chapter at top with `‹ ›` to step to the
      next/previous chapter, and a clickable chapter title that opens the same chapter
      selector/navigator the reading pane already uses, to jump anywhere directly.

_Acceptance: opening Digest lands on the grid, not a long scroll; a chapter cell's checkmarks
match its actual digest/thematic/audio state and never reveal state past the bookmark; opening
a chapter and stepping `‹ ›` through several never requires returning to the grid._

#### B. One Analyse control, and an explained "Saved"

- [x] **B1.** Replace the vertical `ChapterDial` FROM/TO range picker with the app's one
      horizontal `Slider`/`SliderDial` (`web/src/controls/Slider.tsx`, already used for
      reading-progress) — live popup shows the chapter title while dragging, per decision 12
      ("one control system"). Add a typeable section-number entry so setting a range on a
      60+-chapter book doesn't require dragging across all of it.
- [x] **B2.** Collapse "Re-read my notes" and "Re-read the book" behind one **Analyse** button.
      Pressing it opens a submenu: choose Plot and/or Themes; choosing Themes also offers
      today's fast-vs-full choice (the existing `mode: "notes" | "full"` on
      `StartThematicDigestBodySchema`) inline, not as a separate top-level button.
- [x] **B3.** "Distil book-level themes" stays a separate, clearly-labeled action — confirmed
      not redundant with per-chapter analysis (it folds per-chapter themes into book-level
      canonical themes across chapters analyzed at different times) — renamed **"Consolidate
      themes"** so its relationship to Analyse reads as a distinct second step, not a fourth
      unrelated button.
- [x] **B4.** The "Saved" state (today's Save-brief button, relabeled and disabled once saved)
      gets a tooltip/inline caption explaining what it means — today it reads as an unexplained
      greyed-out control with no affordance hinting it's Save's own settled state.

_Acceptance: a reader can set a chapter range by typing a section number as well as dragging;
running an analysis is one button with a clear choice of scope, not four buttons of unclear
relationship; "Saved" no longer needs a human to explain it._

#### C. Reading-pane split: Digest Plot vs. Analyse Themes

- [x] **C1.** "Digest this chapter" becomes a submenu: **"Digest Plot"** (today's existing
      `handleDigestChapter` call, unchanged) and **"Analyse Themes for this Chapter"** — a
      single-chapter thematic run via the existing `/thematic` route with
      `spineStart = spineEnd = currentSpineIndex`, not a new endpoint.
- [x] **C2.** Hovering "Analyse Themes for this Chapter" shows a small notice, for transparency
      before committing to the job: the reading brief's own text if one is set ("analysing
      themes as set in your reading brief: '{brief text}'"), or "analysing themes automatically"
      if none.

_Acceptance: from the reading pane, plot and theme analysis are two explicit, separately
labeled choices, and a reader always knows what angle a theme run will take before starting it._

#### Verify

- [x] Open Digest on a book with several already-analyzed chapters and several undigested ones;
      confirm the grid's checkmarks match reality and the bookmark mask hides completion state
      past it.
- [x] Set a chapter range by typing a section number into the new slider rather than dragging;
      run Analyse → Themes only, fast mode; confirm it matches today's "Re-read my notes"
      behavior exactly.
- [x] From the reading pane, open the "Digest this chapter" submenu, hover "Analyse Themes for
      this Chapter" with and without a reading brief set, and confirm the notice text matches
      each case.

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

- [ ] **C1.** `flow: "scrolled-doc"` with `manager: "default"` — per-section scroll, **not**
      the continuous cross-chapter manager. The ruling and its reasoning are PDF.md §7.4;
      decisions.md 2026-07-29 explicitly left this choice open and required it be made
      before building. ⚠️ Do not substitute the continuous manager because it sounds more
      like "continuous scroll" — it dissolves the chapter boundary that M17's digest unit,
      decision 8a's spoiler mask, and M32's chapter-end prompt are all built on.
- [ ] **C2.** **One `EpubRenderer` with a `flow` construction option, not two classes.**
      Marks, CFI handling, selection and theming are shared; only layout differs.
- [ ] **C3.** The capability profile of PDF.md §7.4's table: `advance: "scroll"`, and
      `spread`/`pageFold`/`pageNumbers` false. The strip, the spread toggle and the fold
      hide themselves off those capabilities — **no new conditional in `ReaderView` keyed
      on the mode**.
- [ ] **C4.** ⚠️ The M11 turn zones and M20 drag-to-peel are **unbound, not merely
      hidden**. A pointer handler still attached over a scrolling surface eats the scroll
      gesture, and it will present as "scrolling feels broken", not as a leftover handler.
- [ ] **C5.** Progress readout: **book %** unchanged from `book.locations`, plus a new
      **chapter %** from `scrollTop / (scrollHeight - clientHeight)` of the section
      container. ⚠️ **Not** from `location.start.displayed.page/.total` — that is what
      `pageNumber.ts`'s `"chapter"` mode reads today and it is a paginated measure that
      does not mean what its name suggests under `scrolled-doc`. Measure the scroll.
- [ ] **C6.** Reading position saves on a **debounced** scroll, through the existing
      `PUT /:id/position` path, so reading, listening and both modes never lose each
      other's place. ⚠️ Undebounced, this runs hot for the whole session.
- [ ] **C7.** ⚠️ Annotation panels follow their marks. `ThreadPanel`'s `panelDx`/`panelDy`
      are offsets from the mark's anchor rect, which now moves continuously — this is what
      §B's `markRect` and a `relocated` on scroll exist for. Throttle to animation frames.
      Without it, panels detach from their highlights on the first scroll and it will look
      like a `ThreadPanel` bug.
- [ ] **C8.** M32's chapter-end prompt fires from `sectionEnd` — "scrolled to the bottom of
      the section" — **once per arrival**, not on every scroll event while at the bottom.
- [ ] **C9.** The mode is a reader setting, remembered per book, and reachable from the
      reader strip. Reduced-motion and keyboard paths are acceptance criteria, not polish
      (DESIGN.md; settled decision 15's spirit).
      _Acceptance, driven live in the app, not inferred from tests: read a real EPUB in
      scroll mode from one chapter into the next; highlight while scrolling; confirm the
      panel stays on its mark; confirm book % and chapter % both move sensibly and that
      chapter % resets at a chapter boundary; close and reopen and land where you left;
      switch to paginated and back and confirm the same position; confirm audio follow
      scrolls to the spoken sentence; confirm the fold, spread and page numbers are absent
      rather than broken._

#### D. The PDF renderer, headless

- [ ] **D1.** `PdfRenderer` implementing the interface: pdf.js canvas + text layer,
      `advance: "image"`, `spread`/`fontScale`/`margins`/`pageFold`/`pageNumbers` false.
- [ ] **D2.** Selection via the text layer's real DOM Ranges, so `getSelectionContext`
      works unchanged.
- [ ] **D3.** Highlight painting from text-layer Range client rects into absolutely
      positioned divs. ⚠️ `marks-pane` is CFI-keyed and is **not** reused here.
- [ ] **D4.** Not routed to from any UI yet. M41 turns it on.
      _Acceptance: a test mounts `PdfRenderer` over a fixture PDF, makes a selection, paints
      a mark, and round-trips a `Locator` — with no route in the app reaching it._

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

- [ ] **A1.** A `format: 'pdf'` resource opens in reflow or native, remembered per book.
      The switch is in the reader strip, and is absent for an EPUB.
- [ ] **A2.** ⚠️ Highlights are **shared between the two modes**, not duplicated — both
      resolve the same `Locator` against the same `resource_text`. A highlight made in
      reflow appears in native and back.
      _Acceptance: highlight in reflow, switch to native, and the mark is on the right words
      of the right page — and vice versa._

#### B. Chrome parity

- [ ] **B1.** Threads, notes, tags, the ask flow, Define, the glossary and the Digest all
      work in native mode with no format-specific branch — they act on highlights, which are
      already format-neutral after M40 §B.
- [ ] **B2.** The find bar over native: text search against `resource_text` with
      text-layer rect painting.
- [ ] **B3.** Audio sentence-follow tinting re-expressed over text-layer rects.
- [ ] **B4.** ⚠️ The M20/M27 page fold does **not** apply to fixed pages and must not be
      faked. `capabilities.pageFold = false` hides it; page turn is plain page-to-page.

#### C. Zoom and navigation

- [ ] **C1.** Fit-width / fit-page / free zoom, and page navigation that keeps the reading
      position in sync with the same path reflow uses — reading, listening and both modes
      must never lose each other's place.

#### D. The scan preview

- [ ] **D1.** A `text_layer = 0` resource opens in native mode with
      `capabilities.textSelection = false`: pages, navigation, zoom, and nothing else. The
      preview is not a special case — it is the native pane with one capability off.
- [ ] **D2.** The strip states why the LLM controls are absent rather than disabling them
      silently.
      _Acceptance: a scanned PDF opens, pages turn, zoom works, and no control is shown that
      cannot act._

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
