# The page curl — state of play, and what a "full" implementation would cost

*Subsystem brief for M20. Written 2026-08-01 at the end of the pass that replaced the
flat fold with a rolled sheet; updated 2026-08-02, when the snapshot capture was rewritten
and the fold was seen carrying a real page for the first time, and again later that day,
when the sheet became the paper card and the peel started opening onto the next page.
§9 was added 2026-08-03, when the operator reported the curl getting stuck; §2d, §3, §4 and
§7 were revised later the same day, when the measurement gate ran on real GPU hardware and
the over-the-spine fork resolved. Binding rulings live in `docs/decisions.md` (2026-07-20,
amended 2026-08-01, twice on 2026-08-02, and four times on 2026-08-03); this document is the
working detail behind them.*

Read with: `docs/decisions.md` 2026-08-03, 2026-08-02 and 2026-08-01 (the rulings),
`NOTES.md` "M20 revisited", "M20 — the capture", "M20 — the card, the reveal, and the edge
peel" and "M20 — the stuck curl" (the friction logs), `TASKS.md` M20 (what is checked
off). **If you are here to fix the stuck curl, start at §9.**

---

## 1. Where things stand

`web/src/reader/pageFold.ts` implements a **rolled sheet**: flat page → a half-turn roll
with ramping curvature → flat mirrored tail floating above the leaf. It replaced the
2026-07-20 perpendicular-bisector *fold*, which read as a creased napkin. It is canvas 2D,
closed-form, no mesh, no WebGL.

| File | Role |
|---|---|
| `web/src/reader/pageFold.ts` | All the geometry and all the painting. Pure except `drawPageFold`/`samplePaperColor`. |
| `web/src/reader/pageFold.test.ts` | 23 tests. The load-bearing ones are named in §3. |
| `web/src/reader/PageCurl.tsx` | Owns the two canvases and the rAF loop; mounts only while a fold is live. |
| `web/src/reader/PageSlide.tsx` | The *other* renderer (M20 step 3): the departing card as one decoded `<img>`, held still while `.marginWrapper` translates over it. No canvas, no rAF loop — deliberately, see §3. |
| `web/src/reader/usePageTurnAnimation.ts` | Snapshot capture, drag gesture, commit/spring-back, low-fps downgrade. |
| `web/src/reader/readerGeometry.ts` | `nearLeafRect` — which half of the **card** is turning. |
| `web/src/reader/pageSnapshot.ts` | Builds the page bitmap by serializing the section document. Rewritten 2026-08-02 — **read §5 before touching it**; four of its lines exist because of a silent failure. |
| `web/src/reader/pageSnapshot.test.ts` | 12 tests, on the parts that failed silently. |
| `web/src/reader/cardSnapshot.ts` | Composites that bitmap into a card-sized canvas over the card's own background — the sheet is the paper card, margin included. |
| `web/src/reader/cardSnapshot.test.ts` | 5 tests, on the registration arithmetic. |
| `web/harness/pageFold.html` | Where the look is actually judged. **See §5.** |

### The model, precisely

Work in the **fold frame**. With `C` the grabbed anchor — a corner, or the middle of an
edge (`anchorPoint`); the model only ever asks for its point — and `P` the pointer:

```
peelDir   n = normalize(P - C)
creaseDir t = (n.y, -n.x)          // handedness chosen so [-n, t] is a rotation,
                                   // which is what lets a band be one ctx.rotate
w(q)        = (creasePoint - q) · n    // signed distance from the crease,
                                       // positive on the corner's side
```

`w` is a page point's *only* relevant coordinate. The sheet is, in order of `w`:

| region | `w` | maps to offset `o` | drawn as |
|---|---|---|---|
| flat page | `w ≤ 0` | `o = w` (identity) | one blit, undeformed |
| the roll | `0 < w ≤ arc` | profile lookup | N bands, each one blit under one affine |
| the tail | `w > arc` | `o = tailOffset - (w - arc)` | one blit, `alpha = -1` (the mirroring) |

Because the map depends on `w` alone, **every band of constant `w` stays a straight line
parallel to the crease**, so each band is one `drawImage` under one affine transform.
That is the entire reason a rolled sheet fits in canvas 2D at frame rate. The flat page
and the tail — almost all the pixels, and all the text you can actually read — are each a
*single undistorted blit*.

The roll's profile is `φ(s) = π · s^ROLL_EASE` over unit arc length, integrated once at
module load into `ROLL_PROFILE`. At `ROLL_EASE = 2.2`, per unit arc: the sheet comes back
`o = 0.418` short of the crease, floats `z = 0.481` high, and bulges to `0.581` at its
widest (at `s = 0.73`).

Crease placement follows from "the grabbed corner must land exactly under the pointer":

```
arc            = min(arcTarget, d / (1 - ROLL_END.o))       // d = |CP|
creaseToCorner = (d + arc * (1 + ROLL_END.o)) / 2
```

At `arc = 0` that collapses to `d/2` — the 2026-07-20 bisector, exactly. **The old model
is the degenerate case of the new one**, which is why the amendment cost no architecture.

### Every tunable, and what it does

| Constant | Value | Effect |
|---|---|---|
| `ROLL_EASE` | 2.2 | Roll shape. 1 = constant curvature = inflated tube. Higher = tighter, crisper lip. |
| `curlArcLength` factor | 0.26 | Roll arc as a fraction of the leaf's short side. Projected footprint is `0.581 ×` this. |
| `ROLL_SAMPLES` | 40 | Profile resolution and the ceiling on bands per half. |
| `LIP_PX_PER_BAND` | 8 | Device px per band on the visible lip. |
| `HIDDEN_PX_PER_BAND` | 40 | Device px per band on the overdrawn near half. |
| `LIGHT_O` / `LIGHT_Z` | 0.28 / 0.96 | Light direction in the fold's (offset, height) plane. |
| `AMBIENT` | 0.66 | Floor on the diffuse term. Deliberately high — lit paper, not a matte sphere. |
| `SHOW_THROUGH` | 0.20 | How much of the print ghosts through the back of the sheet. |
| `backOfSheet` lift | `0.05 + 0.38 × (1 − lum)` | How far the back lifts toward white. Scales with theme darkness. |
| `sheenScale` | `0.1 + 0.75 × (1 − lum)` | Highlight on the roll's edge. Carries the whole depth cue in dark themes. |
| `TAIL_SHADOW_*` | 0.34 / 15px | Flap's shadow on the page it floats over. |
| `ROLL_SHADOW_*` | 0.28 / 12px | Roll's shadow on the page revealed past it. |
| `SWEEP_OVERSHOOT` | 2.2 | Synthetic pointer travel for click/keyboard turns, in diagonals. |

Two structural notes that look like they could be simplified and cannot:

- **Two canvases.** The back of the sheet is a *material* — paper wash plus its own
  lighting — and those must land on back-facing pixels only. Compositing them onto the
  visible canvas washes the front-facing half of the roll too, because the two overlap in
  projected offset by construction. The scratch layer is not an optimization.
- **`samplePaperColor` reads the page background out of the snapshot bitmap**, rather
  than being handed the reading theme. The fold therefore works in any theme without
  knowing which one is on. Dark themes then need the *inverse* treatment, not the same
  one at lower contrast — see `backOfSheet` and `sheenScale`.

---

## 2. What the operator wants next, and what each item actually costs

Four asks, in ascending order of cost. **They are not the same kind of problem** and
should not be bundled into one task.

### (a) "The page text rendered" — **fixed 2026-08-02**

It was the capture, exactly as this section predicted, and the diagnosis needed no
guesswork in the end: the mechanism is spec-level and reproduces on every browser (§5).
The lifted sheet now carries the page's own mirrored text, and the highlight washes come
with it. Confirmed by driving a real drag in the live app, not in the harness.

### (b) "The curled page revealing the page behind it" — **fixed 2026-08-02 (later)**

Both halves are done. The drag advances the rendition at grab time, as the click path
always did, and steps back on spring-back — *before* the spring-back animation, because
the fold paints nothing once the pointer is back on its anchor, so a step-back that
outlives the animation shows the wrong page full-screen.

The registration bug is fixed with it: every rect the fold works in is now measured from
the card (`.pageClip`), which is `PageCurl`'s own offset parent, instead of from
`containerRef` one reader margin inside it. **The sheet is now the paper card**, margin
included (the operator's "the curl should begin at the edge of the reading pane"), by
compositing the page bitmap into a card-sized canvas over the card's background colour —
`cardSnapshot.ts`. In spread mode the card splits down the middle, so each leaf carries
its outer margin and half the gutter.

Grabbing the middle third of an edge now peels the *edge*, crease parallel to the spine,
rather than snapping to the nearer corner: `computeFold` takes a `FoldAnchor` (a corner or
an edge) and asks it for a point, and the caller pins the fold pointer's `y` to the
anchor's. The model did not otherwise change.

### (c) "Text squeezing into the curl"

This is the one that cannot be tuned into existence, and the reason is geometric, not
aesthetic. **Do not spend a session rediscovering it.**

Under an orthographic projection, the tail projects from the roll's far end *back across
the crease*. So whatever front-facing sheet the roll leaves showing ends up **underneath
the tail**. The only things visible, ever, are: the flat page, the tail, and the roll's
back-facing lip. Two approaches were tried and both fail:

1. **Tighten the roll so it returns short of the crease.** It does — that is what
   `ROLL_EASE` controls, and the gap is real. The tail covers all of it.
2. **Add perspective.** This is the correct mechanism: the tail floats, so a real camera
   sees *under* its near edge. But the band it opens is
   `|crease offset from view centre| × tailHeight / cameraDistance`, which at any
   believable camera distance is a handful of pixels; getting Apple's band needs a camera
   roughly one roll-diameter from the page. It also breaks the drag — perspective
   magnifies the tail about the view centre, so the grabbed corner stops landing under
   the pointer by ~13px laterally on a 480px leaf, and fixing that means sliding the
   crease sideways, which changes the fold's character.

Apple's is a **3D scene**. The 2010 reverse-engineering of iBooks' original effect
(wdnuon) reads it as a *conical* deformation — per-vertex, and a cone is what also rotates
the glyphs near the fold, which is the other half of what the reference screenshots show.
That is a mesh warp. See §4.

**(c) and (d) both need the mesh, for two independent reasons, and they are not one task**
(2026-08-03 step 4). (d) is about the sheet's *shape*: a hinge makes it a cone, which §1's
model cannot express. (c) is about *projection*: the occlusion above holds for any sheet
shape under an orthographic view, so a cone alone does not fix it — a perspective camera
does. A mesh renderer happens to deliver both, which is why they look like one item. **Do (d)
first**: it is the ask on record, and it is the one with a shipped ruling to overturn.

### (d) "The page curling over the spine" — **decided 2026-08-03 (step 4): it needs a mesh**

**This contradicted a shipped ruling and needed an explicit decision, not an
implementation.** decisions.md 2026-07-20 says spread mode peels the **near leaf only**:
the fold canvas is sized and positioned to one half of the stage, and `nearLeafRect`
enforces it. A sheet that curls *over the gutter onto the facing page* is what a real
book does, and it is a different specification. The step 4 entry overturns 2026-07-20
deliberately and approves WebGL; what follows is why, and it is a proof rather than an
estimate.

**The proof, in three sentences, because "believed to need a mesh" was carried here for two
days.** Paper is inextensible, so a deformed sheet is developable — a cylinder, a cone, or a
tangent developable. A sheet bound at the spine must lift at its outer corner and not at all
at the spine, so the lift has to fall to zero along the binding, which parallel rulings (a
cylinder) cannot do — the rulings must fan from a point on the spine, which is a cone.
**§1's model has no way to express a cone**: it is built on the deformation depending on `w`
alone, which is exactly what makes every band of constant `w` a straight line *parallel to
the crease* and therefore one `drawImage` under one affine — and a cone's rulings are not
parallel. The property that makes the roll fast in canvas 2D is the same property that makes
the hinge impossible in it.

Two consequences worth keeping:

- **The roll is the cone's far-field limit.** Apex to infinity → fan becomes parallel → cone
  becomes cylinder → the 2026-08-01 roll, which at zero arc is the 2026-07-20 bisector. Each
  model has been a degenerate case of its successor, and this one continues that. Practically:
  a dog-ear pinch far from the gutter is already nearly right; the large fold near the spine
  is the wrong one.
- **Single-page mode has a spine too**, and §2d's old last bullet (below) is answered rather
  than accepted. A single page is still bound; it merely has no facing leaf to land on. The
  unifying rule is **the spine is the edge opposite the grab** — the gutter in spread, the
  card's other edge in single-page — so both modes keep one model and one test suite.

What it costs, concretely:

- The fold canvas becomes stage-wide again, not leaf-wide, and `nearLeafRect`'s job
  changes from "where to draw" to "which half of the snapshot is the turning leaf"
  (`leafSourceRect` already separates those two concerns, so this part is small).
- The turning sheet has to be **hinged at the spine**, not free — a page bound in a book
  cannot translate away from its gutter edge. That is a real change to `computeFold`: the
  corner still follows the pointer, but the spine edge is a constraint the current model
  does not have. Expect the crease to stop being a straight line perpendicular to
  corner→pointer.
- The far leaf stops being "flat and undisturbed" (an explicit M20 acceptance criterion),
  because the sheet now lands on top of it, and it needs its own shadow. That criterion is
  **retired** in TASKS.md rather than quietly failed. The shadow is drawn by the renderer over
  the live far leaf; it is never composited into the snapshot, which stays exactly what §5
  built.
- ~~Single-page mode has no spine, so the two modes stop sharing one model.~~ Answered above:
  it has one, and they keep sharing.

This is the item most likely to be worth doing and most likely to be under-estimated.

### (e) "The back of the sheet should be the leaf's real other side" — new 2026-08-03

Raised at the operator's sign-off, and **physically exact**: a leaf is one sheet with two
sides, so in a spread showing 10|11 the right leaf's back is **12** and the left leaf's back
is **9**. Right leaf curling → the page after; left leaf curling → the page before. Today the
back is the front *mirrored* (2026-07-20), which is a knowing fake that survived only because
mirrored prose is unreadable.

**Cheaper than it sounds, and worth knowing why before anyone scopes it.** The drag advances
the rendition at grab time (2026-08-02), so the destination spread is already rendered by the
time the sheet lifts — the back of the sheet is the **post-advance card**, left half for
`next`, right half for `prev`, whole card in single-page. No hidden rendition, no second
epub.js instance.

**It does not touch the geometry.** The tail keeps `alpha = -1`, because a real book's back
page *is* mirror-reversed when you fold the sheet toward you; only the sampled bitmap changes.
So this is a capture-and-sampling job, it is independent of (c) and (d), and it can be done
without ever revisiting the fold's shape. Ruling and the two open ⚠️s (capture timing, and
re-tuning `SHOW_THROUGH`/`backOfSheet`/`sheenScale` against real content) are in decisions.md
2026-08-03 "sign-off"; the work is TASKS.md M27 (M25 before the 2026-08-12 renumbering).

---

## 3. Invariants — what any rewrite must not break

These are tests, not aspirations. `web/src/reader/pageFold.test.ts`:

- **"lands the grabbed corner exactly under the pointer"** — every corner, three drag
  depths, asserted through `deformPoint`. The property a drag lives or dies by. Stated
  again for edge anchors ("lands an edge-peel's anchor exactly under the pointer too"),
  which is the whole reason the edge peel needed no second model.
- **"keeps an edge peel's crease parallel to the spine, however the pointer wanders"** —
  what the edge anchor is *for*, and it lives in the constraint (`constrainFoldPointer`),
  not in the geometry.
  ⚠️ **This is the one invariant the spine hinge changes** (2026-08-03 step 4). Under a hinge
  the crease converges on the cone's apex and is *not* parallel to the spine. The test is
  rewritten, not deleted: it asserts parallelism **in the far-field limit** (apex at
  infinity), which is what it was always really asserting. Every other property below survives
  unchanged as the degenerate case, exactly as the bisector survived into the roll.
- **"degenerates to the old perpendicular-bisector fold at zero arc length"** — keeps the
  amendment honest, and pins that a fold about a line is an isometry (the flap keeps its
  area exactly).
- **"fully covers the leaf by progress 1"** — a real bug found live under the flat fold:
  an undersized `SWEEP_OVERSHOOT` left a thin triangular sliver that never folded away.
- **"takes only the turning leaf's half of a spread snapshot"** — a real bug the flat
  fold shipped with; see §6.
- **"keeps peelDir and creaseDir a right-handed orthonormal pair"** — flipping the sign
  mirrors every band.

And one that is not a test yet and must become one (step 3, 2026-08-03):

- **A gesture always ends.** The fold unmounts and the turn lock clears on *every* path
  out of a drag — including a rejected `rendition.next()`, an animation that never
  settles, and a release event that never arrives. See §9.

Plus the M10 constraints, which are load-bearing for reasons unrelated to looks:

- **`setPointerCapture` on the grab surface stays.** Without it a drag crossing into the
  sandboxed epub.js iframe **crashed the tab** — reproduced, not theoretical.
- **The snapshot capture timeout stays.** A stalled capture must never freeze reading.
- **Reduced motion renders zero canvas and zero fold elements.**
- **The low-fps downgrade stays.** See §7. Since 2026-08-03 it resolves to the *card
  slide* (PageSlide) rather than M7's dip, which is now the failed-capture floor. **It is
  the p90 of drawn frames, not the median** (2026-08-03 step 4 — the median reads the dead
  tail of a programmatic sweep and under-reports a real drag by 7x). Any new renderer needs
  the equivalent honest measure, or this rung is decorative.
- **`pageTransition: "slide"` is a ceiling, and it is checkable.** The setting is tested
  before the low-fps guard, so nothing can promote a turn back up to the curl — and
  because the slide's departing card is an `<img>` rather than a canvas, "no canvas
  mounts while Slide is on" is literally `querySelectorAll("canvas").length === 0`
  through a whole turn. Keep it that way; it is the only cheap proof of the ceiling.

---

## 4. The fork, resolved 2026-08-03: WebGL

Ask (d) — and (c), for a different reason — need a per-vertex warp. **The fork was resolved
in favour of WebGL by decisions.md 2026-08-03 (step 4).** The table below is kept, with its
"untested" column filled in, because the reasoning is what makes the ruling reversible.

**DESIGN.md's rule is "no WebGL until a named effect needs it."** The 2026-07-20 entry
named the curl as that effect and then discharged it — "the 2D fold discharges it." The
rolled sheet honoured that and is the honest ceiling of the 2D approach. **The rule is now
amended, not deleted:** the named effect that discharges it is over-the-spine (§2d), which
is *proven* outside the 2D model rather than merely expensive in it. The bar survives — the
next candidate still has to be named, and still has to be shown impossible rather than
awkward.

| | Canvas 2D mesh | WebGL |
|---|---|---|
| Approach | Subdivide into triangles, `clip` + affine per triangle | One shader, page as a texture, vertex displacement |
| Feasible? | Yes, and it is how 2D engines fake it | Yes, and it is what this is for |
| Cost at 20×20 | ~800 `clip`+`drawImage` per frame | one draw call |
| Measured signal | 15 bands already peak at **27.8ms** in a real turn (§7); 800 is not close | **0.013ms per draw** on an RTX 3060, flat from 800 to 12,800 triangles |
| New dependency | none | none required (raw WebGL); three.js if you want convenience |
| Risk | affine-per-triangle seams, `clip` is slow, perf cliff | shader complexity, context loss, a second rendering path to maintain |
| Verdict | **ruled out, on the numbers** | **adopted** |

The things insisted on up front, and they are rulings rather than preferences:

- **The geometry stays a pure, testable module with the renderer swapped underneath**,
  exactly as `pageFold.ts` is split today. A shader that hides the model inside itself is the
  failure mode.
- **The snapshot capture is unchanged and stays the input** (§5). Do not touch
  `pageSnapshot.ts`.
- **The ladder terminates at the slide.** No WebGL, a lost context, or a failed capture → the
  card slide. `drawPageFold` does **not** become a permanent second fold renderer; it is the
  safety net until the WebGL path is signed off on the operator's machine, and retired then.
- **A lost context is a designed state**, degrading through the gesture's existing one exit
  (§9), never a crash.
- **`pageTransition: "slide"` stays checkable as `querySelectorAll("canvas").length === 0`** —
  a WebGL canvas is still a canvas, so the cheap proof of the ceiling keeps working.
- ⚠️ **Price the texture upload before designing around it.** `texImage2D` from the card
  canvas measured ~56ms here — *larger than the whole snapshot capture* — but measured
  identically on SwiftShader, which says it was a CPU pixel path rather than a GPU upload.
  On a GPU-composited browser it ought to be nearly free. If it is not, it moves to grab time
  behind the still-covering snapshot, or the texture goes to half resolution. Measure first.

**The cheaper middle option is deliberately not taken**, reversing this section's earlier
"worth pricing first": keeping the 2D rolled sheet and adding perspective *only* to the tail
and the roll buys a modest "see under the lifted edge" band for maybe 60 lines, buys nothing
at all toward (d), and spends those lines inside a painter now scheduled for retirement. It
remains unharmed as an option if WebGL is ever abandoned.

---

## 5. The capture — solved 2026-08-02, and the four ways it fails silently

**This section used to be the blocker. It is now the fix, and the failure modes are worth
keeping because every one of them presents as "the curl looks fine, there is just nothing
in it."**

The old capture was html2canvas with `foreignObjectRendering: true`. That path serializes
the subtree into an SVG `<foreignObject>` and paints it through an `<img>`, and **an SVG
rendered as an image cannot host a nested browsing context** — SVG's secure static mode, a
spec rule. So the epub.js iframe, which is the whole page, contributed zero pixels. Not
headless-specific, not an html2canvas bug: measured in Chromium as a container with a
background plus an iframe full of text serializing to an image that is **100% opaque and
0% ink**, against a control without an iframe that renders normally.

`pageSnapshot.ts` now reaches *through* the same-origin iframe and serializes its own
`documentElement` into the `foreignObject`. Verified by pixel diff against a real
screenshot of the same rect: **0 differing pixels, mean channel delta 0**, ~22ms.

The four things that broke on the way, each of which rendered something plausible-looking
and wrong:

1. **`html,body{overflow:visible !important}` is load-bearing.** epub.js paginates with
   `body { width: <viewport>; columns; overflow: auto hidden }`, which only works because
   a *root* element's body propagates its overflow to the viewport and is then treated as
   `visible`. A copied `<html>`/`<body>` in a `foreignObject` is not the root and clips
   for real. Symptom: correct on page 1, **blank on every other page** (0% ink at
   `scrollLeft` 5510 vs 11% with the override).
2. **The highlight overlays need a second SVG document.** A `<style>` inside a
   `foreignObject` is not scoped to it — CSS in an SVG document is document-wide — so the
   book's own stylesheet reaches marks-pane's `<svg>`. Symptom: highlights silently
   absent (0% wash in one document, 5.7% in two, screen 6.35%). Paint order was ruled out
   first: reordering and `z-index: 99` changed nothing.
3. **Those overlays still go through a `foreignObject`, not a bare `<g transform>`.**
   marks-pane sizes its `<svg>` with an inline *CSS* `width: 7714px !important`, which
   means nothing in SVG context; nested in plain SVG it keeps a 100% viewport and clips
   away every rect past it. Symptom: 0% wash again.
4. **The rasterized SVG must be a `data:` URL, never `blob:`.** A blob-URL SVG **taints
   the canvas**, so `samplePaperColor`'s `getImageData` and the final `toDataURL` both
   throw `SecurityError`. Data URLs do not. Base64, not `encodeURIComponent` — prose is
   full of curly quotes, which percent-encoding triples.

`blob:` stylesheets and `url()` assets are inlined for the same class of reason: they will
not load from inside an SVG image, and a fallback font re-breaks every line, which makes
the snapshot disagree with the page at the exact moment the fold starts.

### The harness is still the place to judge the look

`web/harness/pageFold.html` imports `pageFold.ts` straight from source, paints a synthetic
book page, and renders every fold state across all three reading themes — same code path,
real bitmap, screenshot-able, iterating in seconds instead of through a page turn. **Every
visual constant in the file was chosen there**, and that is still true. What is no longer
needed is the stand-in-bitmap `addInitScript`: the live app now captures real pixels, so
the app itself is a valid place to verify.

---

## 6. Dead ends and bugs already dealt with — do not redo

- **The occlusion theorem** (§2c). The single biggest time sink of the last pass.
- **Perspective at believable camera distances** buys a handful of pixels and breaks
  drag tracking (§2c).
- **Clipping each band polygon to the leaf**: measured neutral.
- **The `drawImage` source-rect overload**: measured neutral (the cheap overload is still
  taken in single-page mode, on principle).
- **The spread-mode snapshot bug, fixed.** The snapshot covers the whole stage — two
  leaves in one epub.js iframe (M12) — and `drawPageFold` blitted all of it into the one
  leaf that turns, so the turning sheet carried both pages squeezed to half width. Fixed
  with `leafSourceRect`, pinned by a test. It survived the original M20 verification pass
  because that pass could not see the fold's pixels at all.
- **`SWEEP_OVERSHOOT` at 1.6** left a permanent triangular sliver. It is 2.2 for a
  derived reason; the comment in the file has the derivation.
- **Screenshotting the iframe, by any route.** html2canvas's `foreignObject` path cannot
  do it (spec rule, §5) and its default clone path is what hung in M10. Serializing the
  same-origin document is the answer; do not go back to a rasterizer.
- **A blob URL for the snapshot SVG**: taints the canvas, breaking `samplePaperColor` and
  `toDataURL` (§5). It looks like the obvious way to avoid a big base64 string. It is not.
- **Putting the highlight overlays in the page's own SVG document**, or translating them
  with a `<g transform>`: both silently drop every highlight (§5).
- **`samplePaperColor` for the card's margin band.** It is an 8x8 downscale plus a median,
  so a page of prose averages ink into every tile: rgb(228,225,218) measured against the
  card's real rgb(250,247,240), which reads as a visible band the moment the sheet lifts
  beside the real margin. It stays correct for the *back of the sheet*, which only needs
  "roughly what colour is this paper". The margin asks the card element for its computed
  background instead (`resolveCardPaper`, walking up because `.pageClip` is transparent).
- **Stepping the rendition back *after* a spring-back animation.** The fold paints nothing
  once the pointer returns to its anchor, so the canvas is transparent while epub.js
  re-renders and the un-turned-to page flashes full-screen. Step back first.
- **Eager snapshot capture on `relocated`.** Scoped out 2026-08-02 on measurement, not
  oversight: the rewritten capture costs ~22ms, which does not pay for a cache with three
  staleness paths. Revisit only if a real drag on real hardware feels late.

---

## 7. Performance — numbers and method

Measured in a **software rasterizer** (headless Chromium, no GPU), so read the ratios and
not the absolutes. 760×1000 leaf at dpr 2, per `drawPageFold` call, median over a full
progress sweep:

| | median | p95 |
|---|---|---|
| flat fold (`arc = 0`, i.e. the old model) | 5.9ms | 16ms |
| rolled sheet, first working version | 39ms | 62ms |
| rolled sheet, tuned | 15ms | 35ms |

Two changes got 39 → 15, and only one was the obvious one:

- **Bounding the `source-atop` passes** to their own bounding box instead of
  `fillRect(0, 0, width, height)`: ~12ms. A full-canvas composite is millions of pixels a
  frame for a wash that only lands on the curl.
- **Choosing band count from the roll's on-screen size** (`bandCount`): ~11ms more, and
  invisible — 8px and ~2.5px per band are indistinguishable side by side, because the
  lip's shading is a gradient and the bands only quantize the ghost showing through.

The rolled sheet is **~2.6× the flat fold**. The M10 low-fps guard (→ permanent slide)
will trip on machines nearer the line. That is the correct failure and the reason the
guard exists — and it means **an operator report of "the curl stopped happening" is
probably the guard.**

**It was the guard, and until 2026-08-03 the guard was wrong.** It tested the mean frame
*interval* over the fold canvas's whole mount, against a 33ms threshold — but a healthy
60fps frame interval *is* 16.7ms, so the test had one doubling of headroom over the
display's own cadence, and the window began before `turnPageCurl` awaits its rendition
step (the fold drawing nothing throughout). Measured on a clean turn: mean interval
16.6ms, fold's own draw 0.7ms. One hitch latched a downgrade that never clears, which is
why Curl curled the first page of a session and slid every one after it.

**And the replacement was wrong too, in the other direction — fixed 2026-08-03 (step 4).**
The median cost of one `drawPageFold` call is a property of the fold, but the median *of a
programmatic turn* is not. `SWEEP_OVERSHOOT` is 2.2, so past about one diagonal the sheet has
left the leaf and every remaining frame draws one degenerate band for ~0ms. Instrumented on a
real keyboard turn (spread leaf 649×771, dpr 2), eleven of twenty-five drawn frames cost
nothing, the median is 0.9ms — exactly what the guard reported — and the frame the reader is
looking at costs **27.8ms**. The same fold under a *held drag* reports 7.4ms median over 104
frames. **The guard now takes the p90 of drawn frames**, keeping the ≥12-sample floor and the
33ms threshold, so it means "one frame in ten eats a whole 30fps frame". Read that number
before believing anything else about fold performance — and note that the earlier claim of
"~40x under the threshold" was the tail talking; the real headroom at the peak is nearer 1.2x.

### The GPU numbers, finally taken (2026-08-03)

This section carried "never verified: the frame cost on real GPU hardware" from 2026-08-01.
Taken on an RTX 3060 via a headless Chromium with `--use-angle=vulkan` (NOTES.md "M20 step 4 —
the gate" has the flags, and the `--no-sandbox` landmine):

| leaf | dpr | GPU | SwiftShader |
|---|---|---|---|
| 760×1000 (this table's own configuration) | 2 | 14.7ms | 14.5ms |
| 649×771 (a real spread leaf) | 2 | 9.3ms | 9.2ms |
| 1200×1600 | 2 | 108.7ms | 108.2ms |
| WebGL conical mesh, 1520×2000, 800–12,800 tris | 2 | **0.013ms** | 3.809ms |

Three readings, in order of importance. **The 15ms above reproduces exactly**, so this table
has been right and the code has not regressed. **The GPU does nothing for the 2D fold and
everything for a mesh** — a 290× gap on the same hardware, which is the measured half of §4's
ruling. And **the cost is superlinear in pixels**: 2.5× the area costs 7× the time, so a
larger display is worse than proportionally worse.

⚠️ **The one column this did not close.** Headless Chromium composites in software
(`gpu_compositing: disabled_software`, and no flag moves it), so the canvas was probably
CPU-rastered in *both* columns — which is the obvious reason two of them are identical. A
GPU-composited canvas on the operator's Mac could beat this table by an unknown factor.
**Canvas 2D on a real compositor is now the only fold measurement still owed**, it is two
minutes of work on that machine, and §4's ruling is deliberately built on geometry so that
whatever it says cannot overturn it.

---

## 8. How to run everything

```bash
# The app (both dev servers; the harness needs only the web one).
cd projects/marginalia && pnpm dev          # web :5173, server :5175

# The harness — where the look is judged.
open http://localhost:5173/harness/pageFold.html
open 'http://localhost:5173/harness/pageFold.html?theme=all'
open 'http://localhost:5173/harness/pageFold.html?only=drag-50&w=620&h=860'
open 'http://localhost:5173/harness/pageFold.html?arc=1.6'   # exaggerate the roll

# Tests and typecheck.
cd projects/marginalia/web && npx vitest run src/reader/pageFold.test.ts
cd projects/marginalia/web && npx tsc --noEmit -p tsconfig.json
cd projects/marginalia && pnpm -r test
```

**Screenshotting under automation.** No system browser here; a cached Playwright Chromium
does the job. The full binary (not the headless shell) is at
`~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`; launch with
`args: ["--headless=new"]` and `PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright`. Wait on
`window.__foldHarnessReady`, not a timeout.

**Checking the snapshot** (paste into the page context on a live `/read/:id`). Measure
*ink*, not just alpha: the failure modes in §5 all produce a perfectly opaque bitmap with
nothing on it.

```js
const mod = await import("/src/reader/pageSnapshot.ts");
const url = await mod.capturePageSnapshot(document.querySelector("[class*=epubContainer]"));
const img = new Image();
await new Promise((r) => { img.onload = r; img.onerror = r; img.src = url; });
const c = document.createElement("canvas");
c.width = img.naturalWidth; c.height = img.naturalHeight;
const x = c.getContext("2d", { willReadFrequently: true });
x.drawImage(img, 0, 0);
const d = x.getImageData(0, 0, c.width, c.height).data;
let opaque = 0, ink = 0, colour = 0;
for (let i = 0; i < d.length; i += 4) {
  if (d[i + 3] > 8) opaque++;
  if (d[i + 3] > 8 && d[i] < 160) ink++;
  if (Math.max(d[i], d[i+1], d[i+2]) - Math.min(d[i], d[i+1], d[i+2]) > 18) colour++;
}
const n = c.width * c.height;
console.log({ opaque: opaque/n, ink: ink/n, colour: colour/n });
// ink ~0.11 on a full page of prose. ink 0 with opaque 1 => §5 failure 1 or 2.
// colour 0 on a page that has highlights => §5 failure 2 or 3.
```

**The acceptance test, and the one worth re-running after any change here:** pixel-diff
the snapshot against a real screenshot of the same rect. Take
`element.getBoundingClientRect()`, screenshot exactly that clip through CDP
`Page.captureScreenshot`, feed the base64 back into the page, and compare. A correct
capture scores **0 differing pixels and a mean channel delta of 0**; anything else is a
real difference, not antialiasing. Driving a real drag (CDP `Input.dispatchMouseEvent`,
press → several moves → screenshot while still held) is what confirms the whole path
rather than the capture alone.

**Run it at dpr 1.** `MAX_CAPTURE_SCALE` is 1.5, so on a 2x display the fold necessarily
blits a 1.5x bitmap onto a 2x canvas: the same test then reads 13-18% of pixels differing
with a mean delta around 8, *all* of it glyph-edge resampling, and it looks exactly like a
registration bug. The "0 differing pixels" standard is a dpr-1 statement (2026-08-02).

**The registration test, which is a different test and now the sharper one.** Screenshot
the card, drag with a real pointer, screenshot the card again while still held. Because
the drag advances the rendition, the live DOM under the canvas is a different page — so
every part of the turning leaf the fold has not peeled must still come back identical to
the baseline, and a canvas off by a margin cannot manage it. At dpr 1 a correct
registration scores **0 differing pixels on the unpeeled half of the turning leaf, 0 along
its inner edge, and 0 ink in the band below the text block.**

**Do not script a drag under reduced motion.** There are no grab surfaces then
(deliberate), so the press lands on the sandboxed epub.js iframe — the M10 tab-crash path
— and the driver hangs with no error. Check that invariant with a keyboard turn and a
sampled canvas count instead.

---

## 9. The failure path — why a curl gets stuck, and what step 3 owes it

*Added 2026-08-03 from an operator report: a drag that doesn't go far enough sometimes
leaves the curl frozen mid-peel, and when it does, page turns stop responding until you
click. Full diagnosis in NOTES.md "the stuck curl"; the ruling is decisions.md 2026-08-03.*

**The structural fault.** `handleGrabPointerDown`'s release handler ends with
`setCurl(null)` and `turnLockRef.current = false` — its last two statements, after a run
of unguarded `await`s. Anything that rejects or never settles strands both: a canvas left
mounted over a half-peeled page, and a lock held forever that makes every later turn a
silent no-op. The two reported symptoms are the same bug.

**Three ways in, in descending order of confidence:**

1. **Pointer capture lost mid-drag** (reproduced). The grab surface unmounts — React does
   this whenever a re-pagination flips `status` to `loading` — capture goes with it, the
   pointer is over the sandboxed epub.js iframe, and the page stops receiving pointer
   input at all. The release never reaches the `window` listener; the stale listener fires
   on the reader's next click, which is the "you have to click to undo" the report
   describes.
2. **A rendition step that rejects or hangs** (inferred). Since 2026-08-02 the spring-back
   branch awaits `rendition.prev()`, at a section boundary, exactly when the reader has
   dragged only a little.
3. **An `animate` promise that never settles** (inferred). `curlProgress` is one shared
   MotionValue; an interrupted animation on it is not guaranteed to resolve.

**What the fix has to look like, whichever it is.** One exit, in a `finally`. A turn lock
with a maximum lifetime. A watchdog that springs a quiet fold back *through the normal
animation* — the reader should see the page fall closed, not blink out. `lostpointercapture`
treated as a release. The grab surface kept mounted for the life of a gesture. And the
spring-back's step back taken against a CFI recorded at grab time, so it cannot strand the
reader a page off.

**Testing rule this produced:** never drive a scripted pointer over the epub.js iframe.
Two runs hung the driver with no error and needed the browser killed. Grab surfaces only;
once a gesture has gone wrong, assert on state, not on more input.
