# Decisions

Short, dated entries. Newest first. Amend CLAUDE.md's "Settled decisions" when one of
these changes the rules.

## 2026-08-23 — The shipping rungs are named, not numbered; Private is next

SHIPPING.md's ladder was numbered 0–4 with a `2.5` wedged in after the fact. Three problems
had accumulated, and the rename fixes all three at once.

**`2.5` was lying about the shape.** A decimal reads as "a half-step on the way to 3", and
the document's own text says the opposite — the ladder *forks*, and the private deployment
is not a smaller hosted website but a different thing with exactly one user. Renumbering
0–5 would have kept the false linearity and silently changed what existing prose meant:
text saying "rung 3" would have started denoting the private deployment.

**"Rung" was already overloaded in this repo.** The page fold has a "low-fps rung"
(PAGE_CURL.md, TASKS.md) and the context ladder has a "Digest rung" (settled decision 8).
Three unrelated ladders sharing one noun and a small integer is a collision waiting to be
misread by a session that greps for it.

**Renumbering has a recorded cost here.** M20_STEP4_PROMPT.md still carries the scar of the
2026-08-12 M25→M23 renumber. Names do not need remapping when something is inserted.

- **The rungs are now `Local → Repo → {Desktop | Private} → Hosted → Stores`.** Desktop and
  Private are **siblings hanging off Repo**, not sequential steps; neither blocks the other.
- **Historical prose is left alone.** decisions.md and TASKS_DONE.md are dated records, and
  rewriting them to say something they did not say is worse than a stale identifier. The
  mapping (`0→Local … 2.5→Private …`) is recorded in SHIPPING.md's ladder section instead.
- **SHIPPING.md's status line was stale** and is corrected in the same pass: it still read
  "none of this is scheduled" four commits after Repo shipped (2026-08-06, this file).

### Desktop does not reach an iPad — stated because it was about to be assumed

The operator's goal is an iPad road test before paying Apple's $99, and asked whether doing
Desktop first would serve it. It would not: iPadOS runs neither Electron nor a Node server,
so Desktop is a Mac/Windows/Linux download that reaches no tablet at all. **Private is the
only rung that puts the product on an iPad without a native client**, and it needs no Apple
money. This is now stated in the ladder rather than being derivable from it.

Measured while answering, because the estimates depend on it: the app has **zero
width-based media queries** (all 7 `@media` rules are `prefers-reduced-motion` or
`prefers-color-scheme`), but only **7 mouse-specific handler sites**, and the two big
gestures already run on pointer events — the desk drag is Framer Motion's, not HTML5 DnD,
and the page fold's grab is `onPointerDown`. Touch is therefore a small job. The genuine
unknown is epub.js-in-an-iframe plus iOS's native selection callout, which is exactly what
a road test exists to answer and cannot be settled by reading code.

## 2026-08-22 — Digest reliability diagnosis: the local Ollama call, not the SSH tunnel (M29)

The operator reported "Open digest" often hanging or failing, and background digest jobs
failing "at the fetch stage" — suspected the SSH-tunnelled remote setup at first. Traced it
instead to the `digest` role's provider profile: `openai-compatible` against local Ollama
(`localhost:11434`, `qwen3.5-hermes:latest`). The tunnel only carries browser↔server HTTP;
the LLM call happens server-side against `localhost` on whichever machine runs the server,
which is why the same slowness reproduces running natively on the Mac. Two real
`digest_runs` rows carry `last_error: 'fetch failed'` — Node `fetch`'s literal message on a
connection-level failure.

Two compounding design gaps, not just flaky Ollama: (1) `GET /:id/digest`
(`routes/digest.ts`) awaits `maybeRefreshBookDigestSnapshot` inline with no try/catch, so a
slow/failing local-model call blocks or 500s the digest-open response despite the function's
own comment calling it "best-effort, silent"; (2) `runDigest`/`runThematicDigest`
(`digest/build.ts`, `digest/thematicBuild.ts`) only auto-resume on `LLMError.code ===
"rate_limit"` — a plain `"network"` error (exactly this failure mode) kills the whole job
with no retry, and `jobs/registry.ts` has no retry logic of its own to fall back on. Neither
LLM fetch path (`llm/openaiCompat.ts`) has a request timeout, so a stalled connection hangs
rather than failing fast.

Scoped as M29 (TASKS.md): make the snapshot refresh non-blocking, add fetch timeouts, retry
`network`-class errors with backoff (not just `rate_limit`), and surface client-side load
errors instead of an infinite "Loading digest…" spinner. Ollama-side tuning (`keep_alive`)
recorded as an operator follow-up, not code — the retry/timeout work should make the app
resilient regardless.

## 2026-08-22 — The immersive page's binding: rebind to `f`, not relabel the hint (M24.7 §G)

The `f1ab0bd` implementation took the "relabel the exit hint to `⇧F`" branch of TASKS.md's
either/or (binding stayed `shift+F`, the pebble's `KeyCapAnchor` was given `modifier="⇧"`).
Driving it live immediately after, the operator expected plain `f` to be fullscreen — matching
the original design mockup's own "F to leave" hint (READER_REDESIGN.md's `FullscreenReaderV2`
frame) and the icon-button behaviour. **Reversed to the other branch**: fullscreen is now plain
`f`; focus mode (the annotations/notes toggle, `handleFocusModeShortcut`) moves to `n` for
Notes. Updated together, since `useShortcuts`, the iframe-forwarded keydown handler
(`useFullscreenChrome`'s docstring already flagged this as the one place both listeners must
agree), the `KeyCapAnchor` on the pebble's exit control, and the annotations button's "press
_ to show" hint all encode the old binding independently — `shortcuts/keys.ts` is the single
source now.

## 2026-08-21 — The immersive page's two open questions (M24.7 §G)

READER_REDESIGN.md §6 left two behaviours for the operator to decide while driving the
build, rather than as a coin flip in code. Both resolved during implementation:

1. **Text selection in immersive mode opens the annotation editor inline over the
   column**, not a fullscreen-native side sheet. In practice this cost nothing extra:
   `ThreadPanel` was already positioned this way (a floating panel near the selection,
   `top`/`panelDx`/`panelDy`-driven, not a docked side panel) before §G existed, so the
   decision is "keep doing what it already does" rather than new work — the side-sheet
   alternative was the one that would have needed building.
2. **Scrolling does not independently sleep the pebble — pointer idle only.** The pebble
   wakes on pointer movement and sleeps `IMMERSIVE_SLEEP_MS` (2000ms) after the last one;
   there is deliberately no scroll listener. Rationale: wake and sleep should be driven by
   the same signal, and a pebble that flickers shut mid-scroll while the pointer is still
   resting on it would be worse than one that stays lit through a scroll gesture.

## 2026-08-19 — Reader chrome v2 enters the roadmap as M24.7, not M25

The operator ran a design pass with Claude Design and brought back a written brief
(`docs/marginalia/READER_REDESIGN.md`) plus five `.dc.html` frames: the reader's chrome
collapses to one 48px line, digest and listening become expanding clusters, search and
Scan stop sharing a magnifier, the query model moves into the annotation editor, and
fullscreen becomes a genuinely immersive page. Scheduled next, ahead of web search.

1. **Numbered M24.7, though the operator proposed M25.** OPUS.md's renumbering rule: M25–M28
   are referenced ~30 times across CLAUDE.md, decisions.md, SPEC.md, PAGE_CURL.md and
   TASKS_DONE.md, and a cascade here would be the second renumbering in seven days (the
   first was ruling 11, 2026-08-12). A decimal insert buys the same working order — M24.7 is
   next, web search and Codex CLI wait behind it — at no cross-reference cost. The operator
   chose this over the cascade when asked.
2. **It is a rework of M14 fullscreen, not a new mode.** The brief describes "pressing F"
   as merely hiding annotations. That is `f` (focus mode); `shift+F` has been a real
   fullscreen with proximity-revealed chrome since M14. So the immersive page replaces
   `useFullscreenChrome`'s four reveal flags with one waking pebble, and the exit hint drawn
   as "F to leave" has to be relabelled or the key rebound — M19.7's "keycaps that cannot
   lie" does not bend for a mockup.
3. **Nesting supersedes M22.5's measurement, and only one of them ships.** `actionsBesideCard`
   measures whether the actions cluster fits beside the card and drops it below the footer
   when it doesn't. That is the "controls get dropped" symptom the brief is answering.
   Expanding clusters are the replacement, which also retires `ReaderActionsCluster`'s
   hover-revealed labels — NavCluster.tsx already records the ruling that a third disclosure
   mechanic was one too many, and that ruling now cuts against the labels rather than
   against the clusters.
4. **The globe stays inert.** The annotation editor's web-search control is restyled here and
   wired in M25. Making it live in a chrome milestone would take the second cloud dependency
   without its seam (settled decision 10).
5. **Container queries enter the codebase here.** There are none today; every responsive
   decision is a viewport media query or a JS measurement. The brief's "key off the pane,
   never the viewport" makes this the first, with one caveat carried into the task:
   `container-type` establishes layout containment, so it must not land on any node whose
   measured rect the page fold depends on (PAGE_CURL.md §5).


## 2026-08-18 — Search matches whole words, and a hit is identified by its position (M24.1 C/D)

Three decisions taken while implementing M24.1 §C and §D. The tasks delegated the first
with a recommendation, forced the second, and the third was the operator's own call on an
ambiguity in the task text.

1. **Whole-word by default; substring is an explicit choice, named on screen.** TASKS.md
   recommended it and the recommendation holds: a raw substring scan is why "the" matched
   *other*, *there* and *father* and blanketed a paragraph in three-character marks. The
   part worth recording is where the rule *lives* — `shared/src/textSearch.ts`, one
   module — and that `mode` travels with the query, in the request and in the
   reader↔Scan handoff, rather than sitting in server settings. Both follow from
   "one result set, two views" (2026-08-14 point 1): the server produces hits with this
   rule and the reader re-finds them in the live DOM with it, so a second copy, or two
   surfaces holding different modes, would quietly become two result sets. Cost, accepted:
   a reader who wants stems ("run" finding "running") must tick a box.

2. **A highlight is identified by its content; a search hit is identified by its
   position.** This is the M24.1 C fix stated as a rule, because the old code applied the
   first idea to both. `findAnchorInText` — prefix+exact+suffix, falling back to
   `indexOf(exact)` — is right for a highlight: there is one of it, and the forgiving
   fallback is the whole point. It cannot work for a search hit, whose `exact` *is* the
   query and therefore looks identical at every occurrence; every hit in a section
   collapsed onto the first one. Occurrence order is what identifies a hit, and it needs
   nothing new on the wire, only that both sides scan under the same rule (point 1). The
   server's own `hit.offset` sounds like the obvious answer and isn't: it indexes
   `resource_text`, the reader paints into the live DOM's flattened text, and the two
   share no coordinate system. Consequence to keep in mind: when the counts disagree the
   reader will paint *fewer* marks than there are hits, never marks in wrong places —
   under-painting is the chosen failure direction.

3. **A search-result card belongs to the reader, not the Scan.** TASKS.md §D said "the
   Scan's results get a card" and, in the same breath, that page numbering must reuse the
   reader footer's own. Those cannot both hold: the Scan never loads epub.js, so it has no
   pagination and no honest page number to show. Put to the operator, who chose the
   reader. The Scan keeps its strip, ticks and cursor readout — it is the distribution
   view, and a scrollable list of rows is the reading-side view. The card holds no hits,
   no query and no cursor of its own; it renders what the find bar already owns and calls
   back with an index into that one result set, which is what makes "a row click lands
   exactly where stepping to that index lands" structural instead of coincidental.

## 2026-08-16 — An exception in `useFrame` is a canvas-wide outage, and a printed page keeps its margins

Three things, from the operator's fifth review of the opening ("the transition where it
zooms in has disappeared"; "it already looks slightly vertically stretched, maybe we can
reduce the vertical stretch a tad to preserve top margins").

1. **A thrown frame callback stops the whole shared canvas, not one layer.** The landing's
   room fade walks every material under the layer it is fading (`Scene3D.tsx`'s
   `FadingLayer` — three.js has no group opacity). `mesh.material` is an *array* on a
   multi-material mesh, and R3F leaves a **hole** in that array if the same material object
   is attached to two of one mesh's slots — which the turntable's record did
   (`vinylEdge` on `material-0` and `material-2`, measured `[null, face, edge]`). Reading
   `.opacity` off the hole threw, inside `useFrame`, and R3F's render loop stopped for the
   entire canvas: the book froze mid-air at its held-open size while the DOM went on
   running the landing's clock underneath it, so the zoom onto the reading pane never drew
   a single frame. Two rules out of it, both now in code: **a traversal over materials it
   did not author owes a null check**, and **no material object is attached to two slots of
   one mesh**. The second is the cause; the first is why the cause was survivable-looking
   (the record's rim had been drawing in three.js's default white the whole time and nobody
   had noticed).
   *The general lesson is the one worth carrying:* on the one shared canvas, a fault in any
   consumer is an outage in **all** of them, and it presents as "the animation is gone"
   rather than as an error anyone sees. The console had the exception; the screenshots did
   not.

2. **The room leaves inside the zoom's window, not across it.** `ROOM_FADE_MS` was the
   landing's full 850ms, which put the desk's last visible frames under the moment the
   spread arrives on the pane. It is now `10% → 60%` of the landing (`ROOM_FADE_DELAY_MS`
   plus a halved `ROOM_FADE_MS`, both fractions of `LANDING_MS` so the clocks cannot
   drift): the spread gets its first tenth of growth against the room it is leaving —
   a zoom needs something to be read against — and the last 40% happens over nothing but
   the reader's own paper. `LayerFade` grew a `delayMs` for it.

3. **The snapshot is the page's text block, not the pane.** `capturePageSnapshot`
   depicts the *scroller*, which sits inside `.marginWrapper`'s padding, and the opening
   was stretching it across the whole spread — so a book that had just opened had type
   running to its very top edge, where a real page has a head margin. `snapshotInset` now
   reports that band and `Book3D` insets the printed leaf by it, leaving the book's own
   paper showing as the margin. The landing is unaffected: the *board* still lands on the
   pane's rect, and the printed leaf inside it lands on the pane's text block, which makes
   the final crossfade agree about more than it did before, not less.
   The residual stretch is not a bug and cannot be fixed in the texture: a spread is about
   1.33 wide and a reading pane was measured at 1.94, and cropping to the right aspect
   would cut the sides off each page — breaking the one property the crossfade rests on.
   So the open book **flattens toward the pane's proportions** instead
   (`flattenTowardPane`), partially (half the mismatch) and floored (never past 0.82), over
   the settle beat that already existed and previously did nothing. "A tad" was the brief.

## 2026-08-14 — Search: one result set, two views (the M24 design pass)

M24's four open questions, answered. The milestone is now an implementation milestone;
TASKS.md carries the tasks, this entry carries the why.

0. **A grounding line in M24 was wrong, and finding that changed the design.** The
   2026-08-12 entry recorded "there is no search endpoint and no search UI anywhere in the
   codebase" as *verified*. The endpoint half is true. The UI half is not: `ScanPage.tsx`
   has shipped a "Search quotes and threads…" input since M9, filtering
   `exact + note + threadFirstLine` client-side. So search was never absent — it was
   present, annotation-only, and quietly weak, which is a different problem with a
   different fix. **Recorded prominently because OPUS.md's rule is "never let a document
   claim something the code does not do", and this was a design pass about to be run on a
   false premise.** The lesson generalises: "verified" should name the file it was verified
   against, or it decays into a remembered claim like any other.

1. **One result set, two views of it.** Ruling 10's framing (the Scan is spatial, search is
   retrieval) is kept, but its implied fix — search lives in the reader, the Scan is only a
   filter *target* — is not what the operator wanted and is not what the code makes cheap.
   The reader shows the hit you are standing on; the Scan shows the distribution of all of
   them; **the hits, anchors and ordering are one set**, and `‹ ›` steps through it on
   whichever surface you are on. Two result lists was the failure mode to avoid, and this
   avoids it without demoting either surface.

2. **Search produces anchors; it does not get a new anchoring model.** Verified by reading
   each stage: `resource_text` → `computeHighlightPositionPercent` → `rangeFromTextOffsets`
   → `cfiFromRange` → mark. That chain is the *highlight fallback path*, already load-bearing.
   A search hit is the same object arriving by a different route, which is why the reader
   find bar is mostly wiring rather than invention. The one real distinction, easy to get
   wrong: `findAnchorInText` resolves a **known** anchor to one occurrence, while search must
   **produce** anchors for every occurrence — reuse the arithmetic, not the function.

3. **Stepping is the primary way to reach a result; clicking a band is the shortcut.** Not a
   convenience ruling — a structural one. Highlight hit-targets on the strip are invisible
   buttons a few px wide, and `HeatStrip.tsx` already carries a minimum-separation constant
   that exists because bands were swallowing each other's clicks outright; zoom/pan exists
   to work around the same thing. So the operator's *"clicking individual annotations is a
   little painful"* is a correct diagnosis of a known defect, not a preference. Stepping must
   work without zooming, and it must travel the same `fractionToView`/`warpLocal` path the
   bands do or the cursor and its band disagree by the warp's displacement. It also gives the
   strip its first keyboard path, which it has never had.

4. **Stepping in the Scan moves a cursor, not the reader.** The alternative — each step
   navigating the book live underneath — was considered and rejected: the Scan is a popup over
   a background location (settled decision 13), and driving the reader from it collapses
   surveying and reading into one act, which is the airlock's whole distinction. Enter opens
   the reader deliberately.

5. **The reader never hands off to the Scan on its own.** Operator's explicit call: finding a
   word must not eject you from the page you are reading. The handoff exists, carries the query
   and the cursor, and is always invoked.

6. **Per-book now; cross-book is M28, named rather than implied.** Every filter in the codebase
   is `resourceId`-scoped and stays that way. The operator wants universal search across books
   and attached vaults "to draw parallels" — real, and more tractable than it sounds since the
   vault is already a directory this server reads. It gets its own milestone because it needs
   FTS5, a Desk-side result surface, and an answer to *what makes a parallel more than a
   coincidence of vocabulary*. M24 does without FTS5 deliberately: one book scans fast, and an
   index added early is an index tuned for the wrong query shape.

7. **The parked concept-tagging work is not a prerequisite** (M24's fourth question, closed).
   Those are *vault* concepts — markdown files, never in SQLite, which is precisely why
   DESIGN.md defers concept filtering. Tags and digest themes are already persisted and already
   filter the Scan. Concepts become one more vocabulary on the same surface, later.

8. **Themes and colour keys split out as M24.5, and the two halves are one problem.** The
   operator asked for *"more general themes, with colour keys"* and reported *"too many themes
   after one digest"*. `thematicBuild.ts` requests up to 8 free-text themes **per chapter part**,
   so a book yields dozens; the phosphor palette has exactly four colours, all reserved for
   highlight kinds. **An unbounded vocabulary cannot be keyed to colour** — a 30-item legend is
   worse than none — so bounding it is the prerequisite, not a companion. Split from M24 because
   search is nearly free while this rests on an open question about LLM output quality; bundling
   would stall cheap work behind risky work. Appended as M24.5, not renumbered.

9. **The theme vocabulary self-populates rather than being authored.** A fixed canonical list
   (~12–20 themes every book maps into) was recommended for its cross-book payoff and rejected
   by the operator in favour of per-book distillation that *feeds and updates* a shared
   vocabulary — "at some point some themes from Book A would be found in Book B". This is the
   better call and worth recording why: an authored list flattens what is distinctive about each
   book into someone's preset, while a discovered one earns its entries from actual reading, and
   it still converges on shared colours for genuinely shared themes. Cost, accepted: the
   vocabulary is only as good as the matching rule, so it reuses `matchConcept`'s tested rule
   (slug equality → alias equality → Levenshtein ≥ 0.85) rather than a new heuristic. Canonical
   themes live in SQLite, not the vault — settled decision 6, and what keeps M24.5 independent
   of the parked vault work.

10. **Cost discipline on the distillation pass**, at the operator's request ("best if we can keep
    the entire thing as token efficient as possible"): distil from the chapter themes and
    analyses **already stored**, never from the book text again. A second full-book pass would
    double a digest's cost for what is a labelling change.

## 2026-08-14 (later still) — The room leaves during the zoom, and a blank page is a page

The third operator review of the day, on the same sequence, and then a fourth on the fix
itself. The first two points are *corrections to the entry below* rather than new ground —
each one is the half of a fix that was applied only to the case that comes last. The third
is a correction to the first.

1. **A layer can be faded on its own, and the room is the layer that should be**
   (amends point 2 below). That point said the desk "can only be faded on the canvas",
   and took the coarseness as correct because both things the canvas holds should go at
   once. That is true *at the handoff* and false for the 850ms before it: during the
   landing the canvas holds the room the book is leaving and the book that is arriving,
   and they want opposite treatment. Holding the room undimmed to the last frame is what
   the operator saw — a desk still fully drawn behind an almost-open reading pane, then
   blinking out ("it looks weird ... then it awkwardly disappears as we reach reader
   view"), off the shelf as well as the desk.

   So the room now leaves **during** the zoom, on its own clock (`ROOM_FADE_MS`, ending
   exactly where the handoff begins, so the two beats meet with neither a gap nor an
   overlap), and the canvas-wide fade keeps its one job. The mechanism is
   `useScene3DLayerFade` — the per-layer opacity the layer map was always able to carry
   (`useScene3DFade`'s docstring anticipated this exact second caller).

   ⚠️ **What per-layer opacity costs in three.js**, since nothing in the seam had needed
   it before: there is no group opacity, so it is every material under the group, walked
   each frame the value moves. That makes *restoring* the interesting part — the page
   block's material is shared across every mounted book, so the as-authored state is
   remembered per material and written back from that record, never by re-traversing a
   tree that is already coming apart. Get that wrong and the next room's books are
   invisible.

2. **A blank spread is a spread, not a page block** (amends point 3 below). The
   coplanarity fix built two board-sized leaves on one plane — and built them *only when
   a snapshot had arrived*. Before that, the book was still showing its left page on the
   swung-open board and its right page as the page block's own top face: a `pageInset`
   narrower on three sides, a board thickness lower, and therefore a different
   magnification. The operator's "it still has a larger left page than right" was that
   surviving half, and it is the half you look at longest, because it is what the book
   opens *into* while the reader underneath is still loading.

   The leaves are now drawn whenever the front board is past 90°, printed if there is
   something to print and plain paper otherwise. The general shape of both of today's
   corrections: **a fix conditioned on the state that arrives last leaves the state you
   watch for longer untouched.**

3. **The room's departure and the spread's growth are one gesture, on one curve**
   (corrects point 1, from the operator's fourth pass: *"we've now lost the zoom from when
   the book renders to when it takes over the reading pane"*). Point 1's first cut faded
   the room over `HANDOFF_DELAY_MS` on a cubic **ease-out** — a third of the way down by
   230ms, effectively gone by 470ms of an 850ms landing. Meanwhile the landing's own
   easing was `[0.32, 0, 0.2, 1]`, a UI decelerate that is ~85% of the way to full size in
   the first third and spends the rest on sub-pixel settle. The two front-loaded *into
   each other*: everything happened in the first ~300ms, and then a cream spread grew
   imperceptibly on a cream page for half a second with nothing behind it.

   Neither clock was individually wrong; the pairing was. Both now run for `LANDING_MS` on
   a **cubic ease-in-out** (`LANDING_EASE`, and the same curve inside `FadingLayer`), so
   the room passes half its opacity as the spread passes half its growth, and "the
   background fades out whilst the pages zoom in" is true by construction rather than by
   two clocks that happen to overlap.

   ⚠️ **The rule here is worth more than the fix.** A room being removed is not clutter
   being cleared: while it is still there it is *the scale the arriving thing is read
   against*. Fade it out ahead of what replaces it and the result is not a cleaner
   transition but an invisible one — the zoom was running the whole time and could not be
   seen. So a departure takes the arrival's curve, not the curve that feels right for a
   departure considered on its own, which is why `FadingLayer` defaults to ease-in-out
   rather than to the ease-out any fade reads as wanting in isolation.

## 2026-08-14 (later) — The opening's last beat is a handoff, and the spread is one plane

The second operator review of the same day: the sequence itself was accepted
("pre-rendering, timing, much more natural") and four things about its *ending* were not.
This entry amends the one below rather than replacing it; the held room, the printed
spread and the shelf's approach are all untouched.

1. **The room may not arrive before the book does.** The reader was revealed on the
   landing's first frame and faded up across its whole 850ms — so a fully-drawn reading
   pane sat under a postage-stamp book still crossing the screen toward it ("the reading
   pane opens prematurely"). The order is now strictly sequential: the spread lands on
   the pane, and *then* a short **handoff** (`HANDOFF_MS`, 380ms, overlapping the
   landing's last 90ms so there is no dead beat) crosses the two over.

   What that crossfade actually dissolves is only what genuinely differs — the desk
   behind the book, and the book's own boards and shadow around the edge of the page.
   The page itself is already the same rect showing the same bitmap on both sides of it,
   which is what makes it read as "subtle" rather than as a dissolve.

2. **The desk can only be faded on the canvas** (`useScene3DFade`). ⚠️ **Superseded the
   same day — read the entry above.** A layer *can* be faded on its own, and the room is
   faded that way during the landing; what remains true below is only the part about the
   handoff itself, where taking the whole canvas is right. The shared canvas
   paints *over* the page (settled decision 14c) — which is why this overlay carries no
   tint — so there is no DOM element that can crossfade with what is drawn in it. The
   fade is therefore a property of the whole canvas, and takes the book with it. That is
   correct rather than coarse: at that moment the canvas holds exactly the room being
   left and a book lying on the pane that is about to replace it, and both should go.

3. **The two halves of a spread must be coplanar.** ⚠️ **Half-applied — read point 2 of
   the entry above**: this was built for the *printed* spread only, and the blank one it
   opens into kept the defect. They were a board thickness apart —
   the right page on the page block, the left on the swung-open front board — and under a
   *perspective* camera that is two pages at two magnifications ("the left page and right
   page aren't equal in size"). `paperZ` used to be the midpoint of the pair, which halves
   an error that is a **separation**, not an offset. Both printed pages now float
   `PAGE_LIFT` above the open board, on one plane, and the printed page is **board-sized**
   rather than inset inside the boards' overhang the way a real leaf is: realism lost
   deliberately to exactness, because the last frame of the book and the first frame of
   the reader have to be the same picture.

4. **Themed paper is unlit.** `SceneLights` is a desk lamp, so a `MeshStandardMaterial`
   handed `--color-bg` does not render `--color-bg` — the spread read as white paper over
   a cream room. The opening's paper and its two printed pages are `MeshBasicMaterial`,
   so the token renders as itself and the snapshot (already a picture of a lit room) is
   not lit twice. Scoped to the `paperColor` opt-in: every other surface's book is still
   lit, and the shelf still shares one material across dozens of books.

Also, the Desk's travel came down from ~990ms to ~740ms on the operator's "20-30%
faster". The 250ms comes off the **approach alone** — the open and the recentre keep
their own durations to the millisecond, since the open was never the part that felt slow.

## 2026-08-14 — The opening is a transition *between* rooms, and its pages are printed

M23 §E reworked to the operator's review of the shipped sequence. Nothing here overturns
the 2026-08-13 entry above; three of its four points were sound and are untouched. What
was wrong was everything the sequence was *timed and staged* against.

1. **The room you left stays until the book has arrived.** The shipped build unmounted
   the Desk on the click, so the whole opening — a book climbing off a surface, turning,
   swinging open — played over the **reader**, the one room the book has not reached yet.
   That is the transition's own subject shown against its destination, and no amount of
   easing fixes it.

   The fix is a **held layer**, not a second mounted room (`Scene3D.tsx`'s
   `useScene3DHold`): the layer's components live inside the shared canvas, so keeping
   its registration alive keeps the Desk drawing after `DeskPage` is gone. Two live rooms
   would have meant two of every fetch, shortcut and drag handler, and two cameras
   fighting over `set({ camera })`. The held room is **scenery, not a room you are in** —
   its DOM is gone, so nothing in it is hoverable, clickable or focusable, which is
   exactly right for a room the user has already left.

   Two consequences worth having written down, both found in the building:
   - **The drop has to be deferred by a microtask.** React runs the unmounting room's
     effect cleanups *before* the arriving overlay's effects, in the same commit — so a
     synchronous drop deletes the layer moments before the thing that wants to keep it
     can say so. It also makes StrictMode's mount/cleanup/mount a no-op rather than a
     dropped room.
   - **A held room needs a book-shaped hole in it.** The opening declares which book it
     has taken (`departedBook.ts`, a store rather than a prop, because nothing above
     those components can re-render them any more), or the book is drawn twice: once
     flying, once still lying where it was.
   - **The reader mounts and loads on the first frame exactly as before, and is merely
     invisible** (`ReaderPage.module.css`'s `.roomHidden`, an *opacity*, never a
     `display`). It has to be laid out and painted: the landing's target rect and the
     spread's snapshot are both measured off the live pane. What it must not do is paint
     its own chrome over the desk it is standing behind.

2. **Timings were retimed against what can be watched, not against a budget.** 395ms of
   travel and 365ms of open (2026-08-13's numbers) are correct as *durations of an
   interaction* and wrong as durations of a thing you are meant to look at. Now 1900ms
   for the Desk's travel/open/recentre and 850ms for the landing. The overlay is
   `pointer-events: none` throughout, so ruling 8 of 2026-08-12 still covers this: the
   ~400ms bound governs input blocking, and nothing here blocks input.

3. **The shelf's approach is a phase, not a corner of a curve.** "The book comes out of
   the row and turns" was implemented as a bezier control point in front of the book —
   and a control point is not a duration, so the move that gives the shelf its whole
   character was over in about a tenth of a second. The pull-out is now its own phase on
   its own clock (475ms), the turn is its own (575ms), and the travel starts from
   wherever the pull has reached. **Everything after the cover faces the camera is the
   Desk's sequence unscaled** — the shelf's clock is longer by exactly its approach, which
   is what "one opening, two approaches" ought to have meant all along.

4. **The held-open spread is printed.** DESIGN.md's rule was "blank paper planes, never
   real epub pages", and it is amended rather than dropped: the opening may lay **one
   still of the reading pane** across the spread while the book is holding still, so what
   is in your hands during the hold is the page you are about to read. The capture is the
   page curl's own (`pageSnapshot.ts`, PAGE_CURL.md §5), behind its own 700ms deadline,
   and a failed or timed-out capture lands blank paper exactly as before. What the rule
   was protecting against — *animating* real page content, which PAGE_CURL.md prices — is
   untouched, and this is the opposite case: one rasterization at the one moment in the
   sequence when nothing is moving. It also makes the final crossfade a swap between two
   pictures of the same thing rather than a dissolve between two different ones.

## 2026-08-13 — The opening borrows its camera, and the book is never a new object

M23 §E, built to the operator's added brief: *treat the book as a 3D object with object
permanence — everything flows into the reader view over about a second.*

1. **An opening does not get a camera of its own.** The natural build gives the sequence
   its own framing and flies it to a view of the spread. That build cannot have object
   permanence: a camera change is a discontinuity on the **first** frame, and easing
   afterwards cannot undo it. So the opening reproduces the source surface's camera
   exactly (`deskViewFrame` / `shelfViewFrame`, pure functions of the viewport) and moves
   only the book.

   This is the third consumer on the seam and the one that shows what §D's "consumers
   bring their own camera" is *for*: both existing cameras are the same construction with
   a 1:1 plane, and a cover facing the camera lies in that plane whichever it is. So the
   whole sequence is authored once in "stage px" and mounted through a frame group that
   either rotates onto the Desk's `y = 0` or stays on the shelf's `z = 0`. **That rotation
   is the entire desk-vs-shelf difference** — TASKS.md's "share the open/land phases in
   code, not by copy" satisfied by construction rather than by discipline. A per-surface
   fork anywhere else in that file is how one opening quietly becomes two.

2. **"Twice the cover" means twice the *board*.** `spineBulge` deliberately takes the
   round back out of the covers so a book never hangs outside its own footprint, so an
   open spread is `2 × boardWidth` — ~4.5% under twice the DOM rect. Recorded because the
   criterion as written could be read either way, and because the property the landing
   really depends on is the exact one: **the crease is the spread's own centre.**

3. **Scaled correctly and landed correctly are different claims under a perspective
   camera.** Found live: the landing overhung the reading pane by 7px on the left and
   nothing on the right, because a spread's two halves are not coplanar (the open board's
   paper sits a board thickness above the page block's) and the landing had planted the
   page block on the 1:1 plane, leaving the cover half proud of it to splay. The reference
   plane is now the midpoint of the two. **Only the 1:1 plane makes "the right size" and
   "in the right place" the same statement**; anything off it is magnified by its own
   height, and that is a class of bug, not an instance.

4. **Object permanence is a property of the *handoff*, not of the animation.** The
   opening's every frame was continuous and it still broke, because `App.tsx` code-splits
   the reader: clicking a book held the Desk on screen for 250ms and then swapped rooms.
   `reader/preload.ts` warms the chunk on hover or focus — the gesture that precedes every
   open — taking the handoff to one commit (~39ms, measured), with the code split intact.
   **The rule: a room that another room animates into is fetched by the gesture that
   precedes the click, not by the click.**

5. **The opening's 3D presentation carries no backdrop tint.** The tint's old tier paints
   over the shared canvas (the layering contract, third time); dropping it under the
   canvas also drops it under most of ReaderView, whose stage and page cards claim
   z-indices of their own — measured live, it showed while the reader was loading and
   vanished the moment it wasn't. The `contentReady` gate is what keeps the reveal honest;
   the tint was only ever hiding a room that had not arrived. So the 3D opening is a real
   object over a live room. The 2D presentation keeps its tint, where the sandwich works.

6. **The 2D presentation was slowed to match the 3D one** (320 + 300 + 340ms against
   760 + 340). A lost context changes what the opening *is*; it must not change how long
   the room takes to arrive.

## 2026-08-13 — The shelf: a second camera on the same seam, and a binding you can read

M23 §D, plus one bug found before it and one measurement gate that changed a design.

1. **An idle 3D layer must be hidden, not merely stopped.** Operator report: "the desk is
   persistent — reader view does not open, neither does library." The shared canvas is
   deliberately sticky (2026-08-13 ruling 3 above), and when the last consumer unregisters
   it drops to `frameloop="never"`. But WebGL does not clear a drawing buffer just because
   nothing is drawing into it, so the Desk's final frame stayed painted on a fixed,
   full-viewport, `z-index: 0` layer over every room the user went to next — and a room
   whose own DOM claims no stacking context renders *underneath* it and appears not to
   have opened at all. **The layering contract now covers *when* as well as *where*:** a
   3D layer that has stopped rendering is not a 3D layer that is gone, and only the second
   is safe to leave over another room.

2. **The shelf brings its own camera, and that is the seam working as designed.** It is
   the first consumer to prove the 2026-08-13 rule that consumers share the units and
   bring their own framing: the Desk hangs a camera *above* the plane `y = 0` looking
   down, the shelf stands one *in front of* `z = 0` looking along −Z, and a DOM point
   `(x, y)` is world `(x, −y, 0)`. The 1:1 plane construction is identical, and on the
   shelf it lands somewhere strictly better — the **spine face** is the 1:1 face, so the
   one surface a user can see or click is exact and everything that foreshortens is behind
   it, where nothing is aimed. Books therefore stand **upright**: a leaning spine is more
   charming and was tried, and it is the one thing that breaks that agreement.

   The cost, recorded so it is not rediscovered: `SceneLights` is a *desk lamp*, hung
   above `y = 0` and pointing down, which grazes a viewer-facing spine at almost zero
   incidence. The shelf contributes a front key light of its own. That is safe **only
   because the Desk and the shelf are mutually exclusive view modes of one room** — if a
   surface ever mounts both at once, the light moves into `SceneLights` and is balanced
   there.

3. **A book's binding is derived, not chosen.** The operator asked for the title on the
   spine and a prominent cover colour on the cloth. Both are properties of the shared book
   asset, not of the shelf, so they land on the Desk in the same commit — a book dragged
   off the optical axis now reveals a binder that says what it is. The colour is extracted
   from the cover (quantize, weight by saturation, average) and the ink is picked by
   contrast from two fixed inks, never computed, because a per-book computed ink drifts
   into mud on exactly the mid-lightness bindings where legibility is hardest.

4. **The texture gate found a real defect and moved a number.** TASKS.md §A required
   pricing the upload before choosing resolutions. Measured on a synthetic 60-book library
   built from the real fixture covers: **465 MB of GPU texture and 1,088 ms of upload** —
   the covers were being uploaded at their source resolution (~1200×1800, 8.6 MB each)
   and *drawn* at 168×252 CSS px. Covers are now downscaled to a 576px longest edge before
   the GPU sees them: **86 MB and 65 ms**, with nothing visible lost on any surface. The
   general rule this is an instance of: a texture's budget is set by how large it is
   *drawn*, and "it's just the file we already have" is not a resolution decision.

## 2026-08-13 — The Desk gets a real camera, and the seam gets a coordinate convention

Operator review of M23 §B's first pass. Three reported symptoms, four causes; full
diagnosis and the live verification in NOTES.md ("M23 §B — the Desk, rebuilt on a real
camera"). Two of the outcomes are rules rather than fixes, so they are recorded here.

1. **A perspective camera is the Desk's depth, not a faked tilt.** §B's first pass used a
   straight-down orthographic camera and rotated each book about its own centre to
   simulate foreshortening, reading TASKS.md's "a projected 3D surface is where
   hit-testing breaks" as a reason to avoid perspective. That produced all three of the
   operator's visual complaints at once — an inverted reveal, books clipped by the desk
   plane they had sunk into, and a four-way axis snap that read as stepping — and none of
   them was tunable, because they are what faking foreshortening costs.

   The hit-testing concern is answered exactly instead of traded away: an eye at distance
   `d` above the viewport centre with vertical fov `2·atan((h/2)/d)` maps the plane
   `y = 0` to the viewport **1:1**, so a book's footprint *is* its DOM rect at every
   position including the corners, and only what stands above the desk splays. This is the
   same construction CSS `perspective` uses. **The 1:1 desk plane is now the invariant** —
   anything that would break it (moving the camera off the viewport's axis, tilting it,
   or reintroducing the DOM parallax under 3D) breaks drag/drop, and is a change to make
   deliberately, not incidentally.

2. **The seam's coordinate convention is written down: one world unit is one CSS pixel,
   origin at the viewport's top-left, +X right, +Z down the screen, +Y up out of the
   surface.** It was already implicitly true — it is what lets a surface place 3D content
   straight from `getBoundingClientRect()` with no reprojection — but nobody had stated
   it, and the cost of that showed up as a shadow bug: `castShadow` had been on since §A
   and nothing had ever cast a shadow, because a directional light's shadow frustum
   defaults to a ±5-unit box at the world origin, which at this scale is the top-left
   corner pixel of the page. Consumers share the units; a surface that wants different
   framing brings its own camera, never its own units.

3. **The shared canvas is sticky, and a lost context is recoverable.** R3F's unmount path
   calls `gl.forceContextLoss()`, which fires a real `webglcontextlost` at the canvas it
   is tearing down — so tying the canvas's lifetime to "is any layer registered" made
   every room change look like a GPU failure and latched the whole app into its 2D
   fallback. The canvas now stays mounted once any consumer has registered and idles at
   `frameloop="never"`, the loss handler ignores our own teardown, and a genuine loss
   schedules a remount (a fresh canvas gets a fresh context) rather than degrading until
   reload. **"A lost context is a designed state" still holds; "a lost context is
   permanent" was never the design and is now not the behaviour.**

4. **Layering is a contract, not a per-surface fix.** The one canvas is a fixed,
   full-viewport `z-index: 0` layer that comes after the page in DOM order, so it paints
   over everything unless told otherwise — which is how the Desk silently lost its hover
   action card, its notepad and its listening tool while they stayed fully present and
   clickable in the DOM. Every 3D consumer owes two things: foreground DOM raised above
   the canvas, and its own background stood down while 3D is on. Written into
   `Scene3D.module.css` and `DeskCanvas.module.css` as the worked example.

   ⚠️ Corollary for verification: "the element is in the DOM" does not mean "the user can
   see it". The first pass checked the action card with `querySelector` and it passed
   while the card was invisible under an opaque 3D surface. Checks on anything sharing a
   viewport with a canvas use `document.elementFromPoint`.

   ⚠️ Second corollary, from M23 §C: **an affordance for a gesture that involves a 3D
   object cannot itself live in the canvas.** The turntable's drop cue was a lit ring
   around its platter, and it was invisible at the only moment it mattered — the book
   being dropped is a 3D object in the same canvas, lifted above the deck, and it simply
   covers it. Anything that must be seen *while* a 3D object is over it belongs in the
   DOM layer above. The in-canvas cue is still worth having for the approach; it is not
   worth trusting for the drop.

## 2026-08-12 — The graphics-and-fixes pass, and the move to a real 3D substrate

Operator review after rung 1 went public: nine areas, mixing small irritations with a
wholesale rework of how the Desk and Library look. Five of the nine reported causes were
wrong in ways that would have sent an implementation session somewhere useless, so the
corrections are recorded *first* — they are the reason several tasks are small.

### Premises corrected before anything was designed

- **"The theme slider's dividers are a light-mode bug."** They are not mode-dependent at
  all. `NavCluster.module.css` puts each divider on a button's own `border-left`, then
  tries to clear the one to the *right* of the active thumb with
  `.themeButton:has(+ .themeButton[aria-pressed="true"])` — which selects the button
  *before* the active one and clears the divider on *its* left, two positions away. Ink is
  the last of three, so selecting it happens to blank both dividers; Paper is the first, so
  it blanks neither. The dark screenshot was Ink-selected and the light one Paper-selected;
  the theme was a coincidence. Recorded because the *reported* fix ("make light mode behave
  like dark mode") would have been implemented as a theme conditional and preserved the bug.
- **"The digest job thinks it's on its second section, so it says 50%."** It does not.
  `build.ts` sets `total = pending.length + 1`, the `+1` being the final whole-book reduce,
  precisely so the bar does not sit at 100% while the slowest call is still running. One
  section really is 1-of-2 done. The number is honest and the *label* is missing.
- **"You can't have a progress bar for TTS."** You can, and it has existed since M21:
  `render.ts` reports `(n, sentences.length, <the sentence's first 48 chars>)` **before**
  synthesizing each sentence, and the tray already draws a determinate bar whenever
  `total > 0`. The live words the operator remembers are `job.progress.message`, shown
  under "Current" in the hover detail. This is therefore a **diagnostic, not a feature** —
  find out why a wired path isn't showing, and do not build a second one.
- **"Chapter jump during playback jumps back to chapter 1."** True, and the cause is a
  deliberate leash: `ReaderView.tsx`'s tint effect calls
  `turnPageSlideToSectionGuarded(segment.spineIndex)` whenever the visible section differs
  from the sounding one. The apparently contradictory half of the report — "but pressing
  next page repeatedly does get me there" — is the same mechanism: that call goes through
  `withTurnLock`, so a manual turn holding the lock makes the yank-back a no-op. Note also
  that `[` / `]` already work while playing (they route to `player.skipChapter`); it is the
  chapter-nav/TOC path that gets leashed.
- **"The book should open into a wider spread with the crease at the hinge."** Correct, and
  it is **already a written, unstarted task** — M22.5 §F — whose implementation is mostly
  present in `BookOpening.tsx`. The defect is exactly locatable: `.spread` is `inset: 0`
  (cover-width) split `50/50`, so the gutter lands mid-cover. This is a refinement of an
  existing task, not new work.

### Rulings

1. **Every instrument is a toggle, and the toggle lives in exactly one branch.** `s` and
   `t` already toggle; `q` (Scan) does not and will push scan-over-scan — the *same* defect
   already fixed for Settings on 2026-08-04, whose one-branch fix in `openSettings` is the
   pattern to reuse rather than copy. The Digest has no binding at all and gets `g` (`d` and
   `l` are taken by Desk/list). **Rule, so it settles cases nobody has hit yet:** an
   instrument's open path and its keyboard path funnel through one function that owns the
   already-open case; a second copy of that check is a bug in waiting.
2. **The tasks tray tells the truth.** Three independent defects, not one: the prompt-facing
   `sectionLabel` (raw 0-based `spineIndex`) is leaking into the UI where the M20.5 rule
   binds `sectionUiLabel`'s 1-based `S<n>`; the "Current" line names the chapter that just
   *finished* because `onProgress` fires only after the await; and the reduce phase is
   unnamed, which is what makes an honest 50% read as a lie. **Rule:** `sectionLabel` is for
   model prompts and may never reach a surface.
3. **The voice gets a leash the reader can slip.** Traversal during playback is free; the
   leash only re-engages on request. A "return to the voice" control sits with the transport,
   and leaving playback returns to the reader — not to the Desk. Adopted as the operator
   proposed it, because the diagnosis above confirms the shape.
4. **Custom theme is accent-first, and contrast is derived, never chosen.** The Arc-style
   field maps to HSL (x = hue, y = lightness, the wave slider = saturation) and is stored as
   a triple. `--color-accent-text` is *computed* from the chosen accent, so no picker
   position can produce unreadable text. Paper/background tinting is a **second** step,
   bounded to the `paper` register only: the Scan's `glass` register keeps its fixed CRT
   phosphor palette, because DESIGN.md skins by material and a user-chosen background would
   dissolve the one distinction the two registers exist to make.
5. **The 3D substrate is three.js / React Three Fiber, for all four surfaces.** The Desk,
   the shelf, the turntable and the opening share one renderer or the rooms visibly
   disagree. *Disagreement preserved:* the recommendation in the room was CSS 3D first
   (no new dependency, the opening already works that way, spike WebGL only if a ~40-book
   shelf misses 60fps). The operator chose three.js outright for material fidelity, and
   that is the decision. **What it costs, stated once:** a real dependency and a new
   rendering seam; and every one of these surfaces now needs its own reduced-motion path and
   accessibility fallback built deliberately, where CSS 3D would have degraded on its own.
   M27's approval of WebGL for the page fold (M25 before ruling 11's renumbering) is the
   precedent that makes this consistent rather than novel — but the two renderers must
   not become two ad-hoc call sites.
6. **The 3D shelf is a third Desk view mode, not a replacement for the list.** DESIGN.md:
   "Keyboard/screen-reader path *is* the list", and `LibraryGrid` is the Desk's only such
   path. The shelf is pure enhancement on its own key; `l` keeps working and keeps its
   guarantee. No amendment to DESIGN.md is needed, which is the point of choosing this
   option.
7. **The opening's spread is twice the cover's width with the crease at the hinge, and the
   scene translates to recentre it.** ⚠️ This **contradicts M22.5 §F's acceptance criterion**
   as written ("the spine edge's x moves less than 2px through the whole rotation"). Resolved
   rather than dropped: the ≤2px criterion is **rescoped to the scene's local coordinates**
   (the hinge does not slide *within the book* — that is what made it a good test), and the
   recentring becomes its own explicit phase in screen coordinates. An implementer who hits
   the old criterion mid-task would otherwise guess, and guess wrong.
8. **The opening may be slower.** Currently 540ms (240 fly + 140 open + 160 landing).
   DESIGN.md's ~400ms bound governs *input blocking*, and this overlay is `pointer-events:
   none` throughout, so lengthening it breaks no rule. Escape-cancellability and the
   `contentReady` gate are what actually constrain it, and both stay.
9. **Order: fixes, then the 3D arc, then search.** M22.6 (below) is inserted before the
   3D arc; the 3D arc and the reader-search design pass were originally **appended** as
   M26 and M27 rather than renumbered in, per OPUS.md's renumbering rule, with the
   pre-existing M23 (web search) and M24 (Codex CLI) deferred behind them. The operator's
   intended sequence — **M22.6 → the 3D arc → the search design pass**, with web search
   and Codex CLI deferred behind both — is unchanged; what changed is ruling 11 below,
   which actually carries out the renumbering this ruling had deliberately deferred.
   Recorded here because "work strictly in order" would otherwise imply the opposite of
   what shipped first.
10. **Reader search gets a design pass before it gets tasks.** There is no search endpoint
    or search UI anywhere in the codebase today — this is genuinely new, and the operator
    said as much ("needs further conceptualisation"). The framing to design against, and the
    reason the Scan feels less useful than intended: **the Scan is a spatial instrument
    (where a thing sits in the book); search is a retrieval one.** The working hypothesis for
    M24 (search design pass; M27 before ruling 11's renumbering) is that Cmd+F is a true
    in-book text find that never leaves the reader, and that a thematic search *hands off
    into the Scan as a filter* rather than growing a competing result list — which would
    also give the Scan the job it is currently missing. Not settled; that is what M24 is
    for.
11. **Milestones M23–M27 are renumbered into the operator's actual working order**, later
    the same day, on the operator's explicit request rather than left appended (which
    ruling 9 had chosen specifically to avoid this cost). Per OPUS.md's renumbering rule
    ("reorder only for a real dependency, and when you do: leave a mapping table, and fix
    every cross-reference in the same pass") — the real dependency is ruling 9 itself: the
    file no longer reads in the order it is worked unless the numbers match. Mapping:

    | Old | New | Milestone |
    |---|---|---|
    | M26 | **M23** | The rooms become solid (three.js) |
    | M27 | **M24** | Search, designed before it is built |
    | M23 | **M25** | Web search |
    | M24 | **M26** | Other (incorporating other LLMs / Codex CLI) |
    | M25 | **M27** | The paper fold, finished (parked) |

    Applied in TASKS.md, TASKS_DONE.md, CLAUDE.md and PAGE_CURL.md — the five documents
    OPUS.md's rule warns about, SONNET_PROMPT.md included by inspection (no milestone
    numbers in this range appear there). Entries in this log dated before 2026-08-12 keep
    their original numbers as written — they describe what was true when they were
    written — and should be read against the table above rather than edited to match.

## 2026-08-06 — Rung 1 prep: the repo goes public under MIT

SHIPPING.md's rung 1 stops being a shape and becomes work. The document ranked costs but
deliberately chose nothing; this entry chooses.

- **License: MIT.** SHIPPING.md's recommendation, taken. A dependency audit generated with
  `pnpm licenses list --json` (not asserted from memory) found nothing that constrains it:
  326 MIT, 30 ISC, 18 BSD-3, 17 Apache-2.0, and one copyleft — LGPL-3.0-or-later in
  `@img/sharp-libvips-*`, transitive and not redistributed by a source repo. It becomes
  load-bearing at rung 2, where an Electron bundle *would* redistribute the binary.
- **The docs get published, including the AI-assisted process.** Also SHIPPING.md's
  recommendation. Noted while confirming it: the choice was already partly made and easy
  to miss — 83 of 126 commits carry `Co-Authored-By: Claude` trailers that GitHub renders
  as co-authors. Published deliberately rather than discovered later.
- **The Metamorphosis fixture is removed, not "checked".** SHIPPING.md flagged the
  translation as unverified. It was verified and it failed: PG #5200 is the David Wyllie
  translation, whose own metadata says `Copyrighted`, hosted by the translator's
  permission — which is not ours to rely on. The title has no clean route: the Muir
  translation is in copyright until 2029, Johnston's is non-commercial-only. Replaced with
  `jekyll-and-hyde.epub` (PG #43, 1886, no translator, public domain in the USA).
  **The blob is in history since M0 (`12547f5`), so deleting the file is insufficient** —
  the purge rides along with the commit-identity rewrite below, in one pass, before the
  first push.
- **Commit identity is rewritten, not just fixed going forward.** SHIPPING.md called the
  rewrite optional. Making it public flips that: GitHub attributes by email, so all 126
  commits authored `…@MacBook-Air.local` would attribute to nobody and miss the
  contribution graph entirely. The security angle is the weaker one — an mDNS hostname is
  not routable and is not a credential. Rewriting to
  `212300859+ShyamW2@users.noreply.github.com` attributes without publishing an address,
  and **the window closes at first push** because GitHub keeps force-pushed objects
  reachable. Verified on a throwaway clone: the rewrite changes the email and every SHA
  and nothing else — author *and* committer dates identical across all 126, HEAD tree hash
  unchanged, all trailers intact.
- **What the README is allowed to claim.** `claude-agent`, `codex-cli` and the whole TTS
  stack have never run anywhere but the operator's machines, and a cold install skips
  `onnxruntime-node`'s and `sharp`'s build scripts. The README states these as untested
  rather than implying they work, and discloses that
  `@anthropic-ai/claude-agent-sdk` is proprietary (`© Anthropic PBC. All rights
  reserved.`) despite being a required runtime dependency. Rung 1's product is a repo a
  stranger can trust, and an honest limitation costs less than a discovered one.

**Found while checking, unrelated to publishing:** `pnpm test` was red on `main` and had
been for a while — two stale assertions in `shared/src/schemas.test.ts` left by M21's
audio merge and M22.5's `provenance` field. It stayed invisible because `pnpm -r test`
bails on the first failing package, so 443 downstream tests never ran. Now
`pnpm -r --no-bail test`. Recorded because the mechanism generalises: a suite that hides
its own failures is worse than a slow one.

**`onlyBuiltDependencies` must live in exactly one file.** Enabling the TTS natives by
adding a `pnpm.onlyBuiltDependencies` block to `package.json` while
`pnpm-workspace.yaml` already declared one did not merge the two lists — the
package.json field *replaced* the yaml's, silently dropping `better-sqlite3` and
`esbuild` from the allowed set. Two properties made this dangerous rather than merely
wrong: it is invisible on a machine whose `node_modules` is already built, so it only
breaks strangers; and it survives a naive check, because better-sqlite3 binds lazily —
`import('better-sqlite3')` still resolves and only `new Database()` fails with "Could not
locate the bindings file". Both lists now live in `pnpm-workspace.yaml` with a comment
saying why, and the natives are verified against a **cold pnpm store with the
side-effects cache disabled**, since a warm store restores build output that a stranger
would have to generate. Exactly the rung-1 failure mode SHIPPING.md predicted: the
two-machine setup produces silent `better-sqlite3` breakage and a stranger has nobody to
diagnose it.

## 2026-08-04 — The revision pass (M22.5)

Operator feedback after living with M20.5–M22: a list of small things, grouped here into one
milestone (**TASKS.md M22.5**, placed before M23 rather than renumbering anything). Most of it
is straightforward. These are the parts where a ruling was needed, or where the reported cause
and the actual cause differ.

### Three bugs whose cause is not what it looks like

- **"Cannot change the LLM response length using the slider, only by retyping into the box."**
  The slider is fine. A drag commits a **float**; `MaxResponseTokensSchema` is `.int()`; the
  server 400s; `setRoleMaxResponseTokens` returns `null` and nobody looks. Typing produces an
  integer, which is why the box works. The context slider directly above it works only because
  its call site happens to do `Math.round` — the same obligation, discharged in one of two
  places, which is how one of them got missed. **Quantisation moves into `Slider` as a `step`,
  and the swallowed save failure becomes visible.** A control that can emit a value its own
  consumer rejects is the bug; the missing round is the symptom.
- **"Pressing `s` twice takes the background to the library page."** `findOverlayPathname`
  (App.tsx) looks one level deep for an open Scan/Digest; `roomLocation` walks the whole
  `background` chain. Stack `/settings` on `/settings`-over-`/scan/:id` and the Scan's
  pathname is no longer found — the Scan unmounts and the room underneath (the Desk, in list
  mode: the library) is what you see. The second history entry is the "delay on exit". The
  operator's requested fix (`s` toggles) is right and is adopted, but **it is not the whole
  fix**: the one-level lookup is wrong independently, and the Scan can sit under a Digest
  too. Both ends get fixed.
- **"Rendering audio doesn't show up as a task until I reload."** The tray is not stale — it
  never knew. `JobsContext` learns about jobs from `registerStarted` and one `fetchJobs()` at
  mount; `usePlayer` subscribes to the render job's own SSE directly and never registers it.
  The fix is a **registry-wide event stream**, not a sixth `registerStarted` call, because the
  same hole swallows any job started by another tab, and one more call site is one more thing
  to forget. Two constraints carried over from M20.6 and restated in the task: watching a job
  must not own it, and the stream must not auto-toast — chapter-ahead rendering would pop a
  popup over the reader every few minutes, which is the blocking-spinner-over-the-text failure
  in a new costume.

### The slider's resting form is the `%` dial, everywhere

The operator asked for the reader's `%` control's aesthetic on every slider. It already exists
as `Slider variant="trigger"` plus `ScrubDial`, so this is a promotion, not a build: the
readout becomes the default rendering, the fill/thumb track is retired, and `ScrubDial` moves
into `controls/` as the drag dial every slider shows. Two things fall out that are worth
recording because they are easy to get wrong and invisible when you do:

- **The ruler must be laid out in the slider's position space**, not in value space, or it is
  wrong at both ends of the log2 context-window range. `sliderMath.ts` already exposes the
  transform.
- **Detent capture needs an absolute mode.** `nearestDetent` captures within
  `detent * captureFraction` — deliberately, because a fixed window is unusable across a log2
  range. But the operator asked for ±25 tokens around every 500 on a *linear* slider, and as a
  fraction that is 5% at 500 and 0.25% at 10,000. One number cannot be both. The fractional
  mode stays the default (the context slider still wants it, now at 5%); an absolute mode is
  added beside it. This is the kind of ask that gets silently fudged into "close enough" by an
  implementation session, so it is named here.

### Nothing else may occupy the top-right corner

The nav cluster is `position: fixed` and every room lays out its own actions underneath it, so
they collide — visible in the operator's desk screenshot, where the cluster sits on top of
Desk/List and Import book. The fix is structural rather than per-room: **`NavCluster` owns one
chrome row, and a room contributes its actions into a leading slot in it.** Stated as a rule so
it settles the rooms nobody has added yet.

The reader's book actions (Digest, digest provider, Scan, Publish) go the other way — out of
the title bar and into a floating bottom-right cluster, icon-only with proximity-revealed
labels, reusing the keycap mechanic rather than a second one. ⚠️ The trap, flagged at the task:
**the bottom-right corner is the page fold's grab anchor**. A button parked there eats the
gesture M20 spent four passes on.

### The three theme buttons become a segmented group, not a hover-revealing single button

The operator offered both. Grouping is the cheaper one and keeps three real focusable buttons;
the single-button form would add a third hover-disclosure mechanic in a pass that is already
adding proximity-revealed labels to the reader's cluster. Recorded because the alternative was
considered, not overlooked.

### The gear does not look like a gear, and it is worse than that

`GearIcon` is a circle with eight radial ticks. `SunIcon` — two slots away in the same cluster
— is a circle with eight radial ticks at a different radius. They are the same drawing. The
tray icon has the matching problem in the other direction: it is an inbox with a down-arrow,
i.e. a downloads icon, for something that is not downloads. Both get redrawn, and the tray's
replacement carries the running-jobs progress as a filled arc, so the icon says something the
badge alone was saying.

### The opening opens

DESIGN.md's motion section promised "its cover zooms toward the viewer, opens, and the pages
flick". What shipped in M20.7 is the zoom plus a four-plane flutter *over* the cover — the
cover never opens. The operator is happy with the flight and wants the open. Adopted as asked:
the front cover rotates about its spine edge toward the viewer, revealing a spread that scales
onto the reading pane. DESIGN.md's bullet is amended to say what it will actually do.

Three things it must not break, all already load-bearing: the `contentReady` gate (the only
thing between the reveal and a flash of "Loading book…"), Escape at any phase, and the rule
that the opening's pages are **fake planes** — PAGE_CURL.md is this project's record of what
real paper motion costs, and the opening is a decorative aside. ⚠️ The 3D goes on a child of
`FlyPanel`, never on the flown node: `motion` is already writing `transform` there.

### Deleting stored artifacts means audio, and only audio

The operator asked to "delete stored text logs to save space". Scoped, with their confirmation,
to **rendered audio**: `data/audio` is 12MB for one partly-rendered book against 40KB of
digests, so it is the only real space cost. Two exclusions recorded so they are not
relitigated:

- **`resource_text` is out of bounds.** It is the coordinate system every highlight offset,
  audio segment and digest anchors into. Deleting it rots annotations, which is the exact
  failure settled decision 5 (immutable-on-import) exists to prevent.
- **Digests are out of scope here.** Kilobytes on disk, real money in tokens to rebuild — a
  bad trade to offer behind a delete button whose stated purpose is saving space.

### You cannot prove which model answered by asking the model

The operator chose Qwen, asked the assistant what it was, and was told it was Anthropic's. The
reported symptom is real; the implied premise — that the model knows — is false. Models are
trained on each other's outputs and have no privileged access to their own identity. No system
prompt fixes this reliably, and **any feature built on the model's self-report would be
decoration over a coin flip.**

The proof has to come from the transport, and this project is most of the way there already:
the M17 usage ledger records `provider` and `model` per call. Two gaps, both real:

- The `model` recorded for an OpenAI-compatible profile is the **configured** string, not what
  the endpoint says it served. OpenAI-compatible responses echo a `model` field; record that,
  and mark when it had to fall back.
- Nothing is ever shown next to an answer. A per-message byline needs `llm_usage` to carry a
  message id — it has only `resource_id` — which is a migration, and is the actual size of the
  task.

This is a small extension of settled decision 11's spirit ("the model never returns
positions"): **the model is not a source of truth about itself either.** Not promoted to a
numbered settled decision — it is one instance of a rule already written down — but stated here
because the operator's question deserves the general answer, not just a byline.

### The one cost the ledger reports is the one you are not billed for

Follow-up question from the operator: *"the ledger showed a cost under last 7 days — I thought
a Claude subscription plus a local LLM meant no API costs?"* They are right, and the way it is
wrong is worth recording:

- `costUsd` is written from **exactly one place**: `claudeAgent.ts`, taking the Agent SDK's
  `message.total_cost_usd`. That is the **subscription** provider, and the number is notional —
  what the same usage would have cost on the API, not money billed.
- `anthropic.ts` — the keyed API, where you genuinely pay — reports **no cost at all**.
- `openaiCompat.ts` documents that it never populates cost, which is correct for a local model.

So the divider adds up a price for the one path that isn't billed, shows nothing for the one
that is, and both look the same to a reader. The ruling: **cost carries a basis** — `billed`,
`notional`, or `none` — the total sums `billed` only, and `notional` is shown separately and
labelled. The Agent SDK's figure is not discarded; "what is this subscription saving me" is a
real question, it just isn't spend. A keyed call with tokens and no price is a separate gap and
is not allowed to keep reading as free.

The operator also asked for the ledger to break down by provider — and nearly all of it is
already recorded and thrown away: `llm_usage` has `provider`, `model`, `cache_read_tokens` and
`duration_ms` per row, while `getUsageBreakdownSince` groups only by book, operation and role
and `UsageBreakdownRow` carries neither provider nor model. So this is a widening, not a new
subsystem, and tokens/sec needs no new column. ⚠️ The one thing genuinely missing:
**"is this local?" is not answerable from a row** — `openai-compatible` covers both a local
Ollama and a hosted OpenRouter, and the base URL that distinguishes them lives on the profile,
which the ledger does not reference. `profile_id` goes in, in the same migration as the message
id the byline needs.

### The reader's action cluster never overlaps the card

Refined from the operator's question ("did you mean to keep it outside the reading pane?") —
yes, and stating it as a boundary rather than a pixel inset is what makes it safe. The M20 grab
surface lives inside `.pageClip`, which is `inset: 0` within `.stage`; so *the cluster does not
intersect `.stage`* is a rule that makes the fold conflict structurally impossible instead of
tuned. It sits in the empty room right of the card on a window wider than `--reader-max-width`,
and below the card when there isn't room. In fullscreen the page grows into that space, so
there the cluster joins M14's proximity-revealed floating set and is simply not on the page at
rest.

### `SunIcon` keeps its job

Asked whether the sun icon should go. No — it is the Paper (light) theme option and a sun is
the right drawing for it. `GearIcon` is the one that is wrong, and redrawing it as a real
toothed cog resolves the collision from the correct end.

## 2026-08-03 (sign-off) — The curl is signed off, and the back of the sheet stops being a mirror

Operator verification of the shipped curl on the Mac, which is the item TASKS.md has carried
since 2026-08-01. **Verdict: it passes.** Curl happens on every turn (so the guard latch is
genuinely fixed), the dark theme reads as a lifted sheet, the mirrored text is on the sheet,
the margin band is right, and it does not get stuck. M20's remaining refinements are parked.

Two things came back that are not "yes":

- **"Stutter is less bad"** — better, not gone. That is consistent with the measurement rather
  than a surprise: the peak frame of a real drag was measured at 27.8ms at dpr 2 against a
  33ms threshold (step 4 entry), so a Mac at dpr 2 is close to the line and residual stutter
  is the expected symptom. **This is the second independent reason to move the low-fps guard
  from the median to the p90**: today the guard reads that same turn as 1.1ms and cannot
  notice what the operator can see.
- **The back of the sheet should show the real other side of the leaf**, not a mirrored copy
  of the front. This overturns part of 2026-07-20 and is the entry below.

### The back of the sheet is the leaf's other side

2026-07-20 ruled the back face "visibly the mirrored page" — the front, mirrored, dimmed, with
`SHOW_THROUGH` ghosting. That was always a knowing fake, and it survived because mirrored
prose is unreadable so nobody could tell it was the wrong text. The operator can tell.

- **The ask is physically exact and is adopted as stated.** A leaf is one sheet with two
  sides. In a spread showing 10|11 the right leaf's front is 11 and its back is **12**; the
  left leaf's front is 10 and its back is **9**. So: right leaf curling → the page *after*;
  left leaf curling → the page *before*. That is the rule.
- **The bitmap already exists on screen, which is what makes this affordable.** Since
  2026-08-02 the drag advances the rendition *at grab time*, so by the time the sheet lifts
  the live DOM is already showing the destination spread — and page 12 is its left leaf.
  The back of the sheet is therefore the **post-advance card**: its left half for a `next`
  turn, its right half for a `prev`, the whole card in single-page mode. No hidden rendition,
  no second epub.js instance, no rendering a page that is not on screen.
- **This does not touch the fold's geometry at all**, and that is worth stating because it
  sets the size of the job. The tail is still drawn with `alpha = -1`; a real book's back page
  *is* mirror-reversed when you fold the sheet toward you, so the mirroring stays correct and
  only the bitmap being sampled changes. `pageFold.ts`'s model, its tests and `computeFold`
  are all untouched. This is a capture-and-sampling change.
- **It is independent of the WebGL work and can be pulled forward.** Over-the-spine changes
  the sheet's *shape*; this changes what is printed on it. Parked with the rest by the
  operator's call, and recorded here as separable so that call stays available.
- ⚠️ **The open question, named rather than guessed:** the second capture costs ~22ms
  (measured, §5) and it must land *before the back is first visible*. It cannot block the
  grab. Either the fold paints the old mirror until the real back arrives — a designed
  transitional state, and probably invisible because the back is not exposed until the roll
  has real arc — or the capture is raced against the first frame that exposes back-facing
  pixels. **Do not decide this from the armchair; instrument which frame first shows a
  back-facing pixel and measure whether 22ms beats it.**
- ⚠️ **Every back-of-sheet constant was tuned against a mirror and will need re-judging in
  the harness**: `SHOW_THROUGH` (0.20), `backOfSheet`'s lift, and `sheenScale`. With real
  content on the back, the physically honest result is the back's own text at full strength
  *plus* the front's mirrored ghost showing through — which is more information on that
  surface than it has ever had, and could easily read as noise. The harness is where that is
  settled, not the app.

## 2026-08-03 (step 4) — Over the spine needs a cone, a cone needs a mesh: WebGL is permitted, and the fold's cost has never been read correctly

M20 step 4's design session. The question is DESIGN.md's own rule — "no three.js/WebGL until
a named effect needs it", named for the curl on 2026-07-20 and discharged the same day
("the 2D fold discharges it"). The operator's ask (d), the page curling *over the spine* onto
the facing leaf, is the effect that tests it. Full measurements in NOTES.md "M20 step 4 — the
gate"; the geometric argument is PAGE_CURL.md §2c/§2d and now §4.

**The gate came first, and it moved the argument rather than settling it.** Every performance
claim about the fold in this repo came from a software rasterizer with no GPU. The RTX 3060 in
this box is reachable from a headless Chromium without a display server, so that gap is now
closed — and it closed in an unexpected place.

- **The GPU makes no measurable difference to the 2D fold, and a 290x difference to WebGL.**
  `drawPageFold` at §7's own configuration (760x1000, dpr 2): **14.7ms on the RTX 3060, 14.5ms
  on SwiftShader.** The same textured-mesh draw: **0.013ms on the GPU, 3.809ms on SwiftShader.**
  ⚠️ The honest reading is narrower than it looks: headless Chromium composites in software
  (`gpu_compositing: disabled_software`, and no flag moves it), so the canvas was probably
  CPU-rastered in both columns. **The gate is closed for WebGL and still open for canvas 2D.**
  A GPU-composited canvas on the operator's Mac could beat this table by an unknown factor.
  That is the one measurement this milestone still wants and it is two minutes on the Mac.
- **§7's 15ms reproduces exactly, so nothing has regressed** — and the cost is *superlinear in
  pixels* (760x1000 → 1200x1600 is 2.5x the area and 7x the time, 14.7ms → 108.7ms). The fold
  is already at its budget on today's leaf sizes and gets worse on a larger display, which is
  the opposite of the direction "2D is cheap" assumed.
- **The performance argument for a mesh is therefore not the argument, and never was.** It is
  not dead either — see the guard below — but the ruling rests on geometry, and it would rest
  on geometry even if the fold cost nothing.

### The fold is not ~1ms. The guard has been reading its own dead tail.

The 2026-08-03 (later still) entry replaced a guard that measured the display with one that
measures the median cost of one `drawPageFold` call. It measures the fold; it still does not
measure the reader.

- **`SWEEP_OVERSHOOT` is 2.2, so about half of a click/keyboard turn's frames happen after the
  sheet has left the leaf**, drawing one degenerate band for ~0ms. Instrumented on a real
  keyboard turn (spread leaf 649x771, dpr 2): eleven of twenty-five drawn frames cost nothing,
  the median is 0.9ms — precisely what the guard reported — and **the frame the reader is
  looking at costs 27.8ms.**
- **A real drag, held out at a large fold, reports 7.4ms median over 104 frames** at the same
  size and dpr. So the guard reads the same fold as **7x cheaper when turned by key than when
  dragged**, and 25x cheaper than its own worst frame. Most turns are keys and clicks, so the
  guard is calibrated on the cheap case.
- **"The fold sits ~40x under the threshold" is void**, the same way that entry voided every
  claim before it. Against a 33ms threshold the shipped rolled sheet has roughly **1.2x of
  headroom at its peak frame** at dpr 2, not 40x.
- **The guard moves from the median to the p90 of drawn frames**, keeping the ≥12-sample floor
  and the 33ms threshold. p90 on the curve above is 12.6ms: high enough to see the peak, still
  robust to the one frame a GC lands on, still unlatched by a two-frame flick. The threshold's
  meaning becomes "one frame in ten eats a whole 30fps frame", which is what a reader
  experiences as a stutter — the median's meaning ("the typical frame") was never that.

### Over the spine is a cone, and a cone is not expressible in the shipped model

This is the ruling, and it is a proof rather than a preference — PAGE_CURL.md §2d has carried
it as "believed to" since 2026-08-01 and it can be settled from the model's own stated premise.

- **A sheet bound at the spine and pulled by its outer corner deforms as a cone with its apex
  on the spine.** Paper is inextensible, so the deformed sheet is developable — a cylinder, a
  cone, or a tangent developable. The spine edge stays flat and undisturbed while the outer
  corner lifts, so the amount of lift must fall to zero at the spine; a cylinder's rulings are
  parallel and lift uniformly, which would tear the sheet off its binding. The rulings must
  therefore fan from a point on the spine. That is a cone. It is also what the 2010
  reverse-engineering of iBooks (wdnuon) reads Apple's effect as, arrived at from the other end.
- **The shipped model cannot represent a cone, by construction.** PAGE_CURL.md §1: the
  deformation depends on `w`, the signed distance from the crease, and *only* on `w` — which is
  exactly why "every band of constant `w` stays a straight line parallel to the crease" and each
  band paints as one `drawImage` under one affine. A cone's rulings fan; they are not parallel;
  there is no `w`. **The property that makes the roll fast in canvas 2D is the same property
  that makes the hinge impossible in it.** This is not a tuning gap and no amount of arc,
  easing or shadow closes it.
- **The roll is the cone's far-field limit, which is why this costs no architecture.** Push the
  apex to infinity and the fan becomes parallel and the cone becomes the cylinder — the
  2026-08-01 roll — which at zero arc becomes the 2026-07-20 bisector. Each amendment has kept
  its predecessor as a degenerate case, and this one does too. Practically: a dog-ear pinch far
  from the spine is *already* nearly right today, and it is the large fold near the gutter that
  is wrong.
- **Ruling: DESIGN.md's "no WebGL until a named effect needs it" is amended, not deleted.** The
  named effect that discharges it is **over the spine (§2d)** — proven above to be outside the
  2D model rather than merely expensive in it. The rule survives with its bar intact: the next
  candidate still has to be named, and still has to be shown impossible rather than awkward.

### Which asks need the mesh — separately, because they are not one problem

- **(d) over the spine needs it**, per the proof above. This is what the operator asked for.
- **(c) text squeezing into the curl needs it too, and for a second, independent reason.** §2c's
  occlusion theorem is about *projection*: under an orthographic view the tail always covers the
  band the roll leaves showing, whatever the sheet's shape. A cone alone does not fix that — a
  perspective camera does. A mesh renderer gets both at once, which is why they look like one
  item, but they are two: a cone under orthographic projection buys (d) and not (c).
- **Do not bundle them, and do (d) first.** (d) is the ask on record and it is the one with a
  shipped ruling to overturn. (c) is a refinement whose acceptance criteria nobody has written.
- **Canvas 2D mesh: ruled out, on the numbers already in hand.** ~800 `clip`+`drawImage` pairs
  per frame at 20x20, when 15 bands per frame already cost 27.8ms at the peak. It is not close.
- **The 60-line middle option (perspective on the tail and roll only) is deliberately *not*
  taken**, and this reverses the standing "worth pricing first". It buys a few pixels of
  see-under-the-lifted-edge (§2c prices the band and it is small), it does not buy (d) at all,
  and it spends them inside a painter this entry schedules for retirement. Sixty lines added to
  something being replaced is sixty lines of merge conflict. If WebGL is abandoned later, this
  option comes back unharmed — nothing here forecloses it.

### The amendment to 2026-07-20, explicitly

2026-07-20 ruled that **spread mode peels the near leaf only**: the fold canvas is sized and
positioned to one half of the stage. It is enforced by `nearLeafRect` and pinned by five tests
in `readerGeometry.test.ts`, and it is a shipped M20 acceptance criterion ("the left page stays
flat and undisturbed"). Over-the-spine overturns it. Per CLAUDE.md, deliberately:

- **Replaced by: the fold canvas is stage-wide; the turning leaf is still exactly one half of
  the card.** Those were one statement and become two. `nearLeafRect`'s job changes from *where
  to draw* to *which half of the snapshot is the turning leaf* — `leafSourceRect` already
  separates the two concerns, so the change is small and its tests keep their meaning.
- **"The far leaf stays flat and undisturbed" is retired as an acceptance criterion**, not
  quietly failed. It is replaced by: the far leaf is live DOM beneath a transparent canvas, and
  it receives the turning sheet's shadow. The shadow is drawn by the renderer over the live
  page; it is **not** composited into the snapshot, which stays exactly what §5 built.
- **Single-page mode keeps one model with spread, and §2d's last bullet is answered rather than
  accepted.** §2d worried that "single-page mode has no spine, so the two modes stop sharing one
  model". It has one: a single page is still bound, it merely has no facing leaf to land on.
  **The rule that unifies them: the spine is the edge opposite the grab.** In spread that is the
  gutter; in single-page it is the card's other edge; in both the cone's apex sits on it. What
  differs between the modes is only what is underneath the sheet, which is not the model's
  business. One geometry, one test suite, both modes.

### What happens to the 2D renderer

It cannot simply be deleted — it is what a failed capture and a slow machine fall back to, and
`pageFold.ts` is the only executable description of the model. But the two halves of it have
different fates and conflating them is how this gets decided wrongly.

- **The geometry module lives and grows the cone.** `pageFold.ts`'s pure half stays pure and
  testable with the renderer swapped underneath (§4 says to insist on this up front, and a
  shader that hides the model inside itself is the failure mode). Every property in
  `pageFold.test.ts` survives **as the degenerate case** — apex at infinity — exactly as the
  bisector survived into the roll. Anchor-under-pointer, full coverage by progress 1,
  right-handed orthonormal peel/crease: all still true, now with an apex-distance parameter that
  the old tests pin at infinity. ⚠️ One test changes meaning and must be rewritten rather than
  deleted: **"keeps an edge peel's crease parallel to the spine"** is false under a hinge, where
  the crease converges on the apex. Its replacement is that it stays parallel *in the far-field
  limit*, which is what it was always really asserting.
- **The 2D painter (`drawPageFold`) does not become a permanent second fold renderer.** Two
  painters for one effect, differing visibly by construction (the roll is "the honest 2D
  ceiling" — it is *supposed* to look different), maintained forever, for a rung nobody has seen
  fire. **The ladder terminates at the slide**: no WebGL, context lost, or failed capture → the
  card slide, which is already built, already the low-fps rung, and already what the setting's
  ceiling means.
- **`drawPageFold` is retired when the WebGL renderer has been signed off on the operator's own
  machine, and not before.** Until then it is the renderer, and after the swap it is the safety
  net for exactly one milestone. That is a condition, not a "someday" — someday is how a second
  renderer becomes permanent by drift.
- **The ceiling stays checkable, unchanged.** `pageTransition: "slide"` is tested before
  everything else, and a WebGL canvas is still a canvas, so
  `document.querySelectorAll("canvas").length === 0` through a whole turn keeps working as the
  cheap proof. Keep it that way.
- **A lost WebGL context is a designed state, not a crash.** It degrades to the slide like any
  other failed renderer and it goes through the gesture's existing single exit — the `finally`,
  the deadline on every await, the pointer-capture watchdog, the turn lock's maximum lifetime.
  §9 exists because those were absent once; a new renderer does not get to reintroduce the gap.

### Sequencing, and the disagreement preserved

The ruling above approves the work; it does not schedule it in front of two cheaper things.

- **Operator sign-off on the roll comes first.** It has been open since 2026-08-01 and it is the
  one thing here that cannot be measured: does the shipped sheet read as paper on the Mac, and
  does the turn stay smooth. Building a third renderer before the second one has been looked at
  by the person it is for is out of order, and the answer could change the brief.
- **The Mac's canvas-2D number comes with it**, since the gate could not close that column. If
  a GPU-composited canvas turns out to be several times faster than this table, the p90 guard's
  calibration changes — though the geometry does not, which is the point of resting the ruling
  on geometry.
- **The concern on record, since nobody raised it against the ask:** this is the reader's
  *third* turn renderer (dip, slide, fold) becoming a fourth, in an app whose first discipline
  is "reading comes first". The mesh is approved because the effect is named, proven
  unreachable in 2D, and measured free — not because the curl has been under-invested in. If
  the operator would rather have (d) than another pass on anything else, that is their call and
  this entry is the yes.

## 2026-08-03 (later still) — The low-fps guard was measuring the display, not the fold

*Superseded in part by the step 4 entry above: the replacement guard described here measures
the fold but reads its own dead tail, so the "~40x under it" figure in the third bullet is an
artifact. The diagnosis of the original bug stands unchanged.*

Operator bug against the transition setting: "with Curl selected it curls for the first
page, then slides the remainder of the time." The only one-way switch anywhere in the turn
path is the M10 low-fps guard, and it was tripping on almost every reader's first turn.

- **The guard was testing the mean frame *interval* over the fold canvas's whole mount.**
  Two things wrong with that, and the second is the fatal one. First, the window starts at
  mount, which in `turnPageCurl` is *before* `await rendition.next()` — so however long
  epub.js takes to lay out a new section counts against the fold, which is drawing nothing
  for all of it. Second, and this is the measurement that should have been noticed years
  ago: **a healthy 60fps frame interval is 16.7ms and the threshold was 33ms**, i.e. the
  test had exactly one doubling of headroom over the display's own refresh cadence.
  Measured on a clean turn in this environment: mean frame interval **16.6ms** while the
  fold's actual drawing cost **0.7ms**. The guard was reading vsync. Any hitch inside one
  mount — a section layout, first-turn web fonts, a moment of throttling, a 30Hz external
  display — crosses the line, and the latch never clears for the session. The first turn
  of a session is the slowest one there is, which is exactly the reported symptom.
- **The guard now measures the median cost of one `drawPageFold` call**, which is the unit
  PAGE_CURL.md §7 is already written in and is a property of the fold rather than of the
  main thread. Median, not mean, because a downgrade that never clears must not be decided
  by the one frame a GC landed on; and never on fewer than 12 drawn frames, so a two-frame
  flick cannot latch it.
- **The threshold stays 33ms and now means something**: one whole 30fps frame spent
  drawing the fold and nothing else. Measured here at dpr 1 the fold sits ~40x under it.
- **The reported number is traced in dev builds.** This bug was invisible because nothing
  ever said which rung of the ladder a turn took. One `console.debug` per fold, with the
  median and the sample count, is what turns "the curl stopped happening" from a mystery
  into a reading — and PAGE_CURL.md §7 already warned that an operator report of exactly
  that phrase is "probably the guard, not a bug". It was the guard, and the guard was wrong.

*Worth stating plainly: the slide setting did not cause this. It made a four-month-old
latent bug visible, because the downgrade now goes to a full page slide instead of M7's
6px dip, which nobody would notice.*

## 2026-08-03 (later) — The slide, as built: five calls the ruling left open

The transition setting shipped. Everything in the entry below held as written; these are
the decisions taken *inside* it, recorded because four of the five are things a later
session would otherwise re-derive or quietly undo.

- **In spread mode the whole stage slides, both leaves together — v1, and stated as
  such.** The alternative (clip to the near leaf, so one page slides over the other while
  its neighbour holds) is the more book-like motion and is also a different specification:
  the departing snapshot would have to be split at the spine, the far leaf would need to
  stay live while the near one is a bitmap, and the two modes would stop sharing one
  renderer. That is the same shape of cost as PAGE_CURL.md §2d, for a smaller payoff.
  Whole-stage reads correctly — the incoming spread arrives over the departing one — and
  it is one transform. Revisit with the spine work, not before.
- **The slide mounts no canvas, and that is a design constraint rather than an
  accident.** "Slide means never curl" is worth being able to *check* —
  `document.querySelectorAll("canvas").length === 0` through a whole turn — and it stays
  checkable only if the departing card is not itself a canvas. It does not need to be:
  `pageSnapshot` already returns a PNG data URL, and the only thing `cardSnapshot`'s
  canvas adds is a band of one flat colour around it, which is a CSS background. So the
  slide takes the same capture one step earlier, decodes it, and paints it as an `<img>`
  over `resolveCardPaper`'s value — one canvas, one full-card blit and one decode cheaper
  than the curl's path, not more expensive.
- **The ladder's low-fps rung now means the *card* slide, and M7's dip becomes the floor.**
  "Low fps → slide" was written when "slide" meant the dip; now that it names a real
  transition, the guard resolves to it. The dip stays as what a *failed capture* degrades
  to (it needs no bitmap) and as reduced motion's instant step. The guard is about the
  fold's per-frame canvas cost, which the slide does not have — and a machine that trips
  it has, by construction, already paid for one capture and survived.
- **The slide steps the rendition back *after* its spring-back animation — the opposite of
  the curl, for the same reason.** The fold paints nothing once the pointer is back on its
  anchor, so its step back has to beat the animation or the un-turned-to page shows
  full-screen (2026-08-02). The slide's snapshot covers the whole card at progress 0, so
  there is nothing to see through: the page falls closed first and epub.js can take as
  long as it likes behind it. A slow step then costs a moment longer on a still page
  instead of a page stalled mid-slide.
- **The sliding page needs a drawn leading edge.** Both pages are the same paper colour by
  construction, so without one the slide reads as text being wiped away rather than as a
  sheet moving over another. Found in the first mid-drag screenshot, where the only sign
  of the boundary was the departing page's glyphs being cut in half. A gradient carries it
  on paper and sepia; a hairline in `--color-border` is what carries it in ink, the same
  lesson `sheenScale` records for the fold.

*Not decided, still: the slide's spring-back and commit reuse the curl's 0.16s/0.18s
settle durations unexamined. They are right for a fold that is nearly closed already and
merely defensible for a page with half a card left to travel.*

## 2026-08-03 — A page turn may never get stuck, and the transition becomes a reading setting

Operator report against the shipped curl: (1) a drag that doesn't go far enough sometimes
leaves the curl frozen mid-peel instead of springing back, (2) when that happens the
reader stops responding to the cursor and only a click clears it, and (3) a request for a
plain slide as an alternative to the curl. The first two are one bug wearing two faces;
the third is a real setting. All three go into M20 step 3, ahead of the WebGL work.

- **The gesture has no failure path, and that is the whole bug class.**
  `handleGrabPointerDown`'s release handler unmounts the fold and releases the turn lock
  as its *last two statements*, after a series of unguarded `await`s (the capture, an
  `animate`, and — since 2026-08-02 — `rendition.prev()`/`next()`). If any of them
  rejects or never settles, neither statement runs: the canvas stays mounted showing a
  half-peeled page, and `turnLockRef` stays `true`, which makes every later turn a no-op.
  That is exactly the reported pair. **Ruling: a turn gesture gets exactly one exit, it
  runs in a `finally`, and it is reachable without the release event.**
- **Losing pointer capture mid-drag is unrecoverable, and it is reachable.** Reproduced in
  the live app: remove the grab surface while the pointer is down (which React does
  whenever a re-pagination flips `status` to `loading`), and the pointer is then over the
  sandboxed epub.js iframe — the page stops receiving pointer input entirely, the release
  never reaches the `window` listener the gesture is waiting on, and the driver blocks on
  the next move. The stale listener is still armed, so the *next* click anywhere finally
  fires it and everything unfreezes: the operator's "you have to click to undo", exactly.
  So: **the grab surface may not unmount while a gesture is live**, and
  `lostpointercapture` is a release like any other.
- **The recovery animates.** A watchdog that snaps the page back would trade a frozen
  reader for a flicker. A fold that has gone quiet springs back through the same
  animation a real release uses, so the reader sees the page fall closed.
- **The turn lock gets a maximum lifetime.** A lock held longer than the longest legal
  turn is a bug, not a state; it clears itself. This is the belt to the `finally`'s
  braces, and it is what makes the reader recoverable even from a failure nobody
  predicted.
- **The step back on spring-back goes by CFI, not by `prev()`.** 2026-08-02 stepped back
  blind. Recording the location at grab time and displaying it back cannot strand the
  reader on the wrong page if epub.js's own step disagrees at a section boundary.
*(The four gesture items were applied the same day; the transition setting is the
remaining work. Every await on the way out of a drag is now raced against a deadline —
a `finally` alone does not help against a promise that never settles, which is the
failure the deadlines exist for.)*

- **The page transition becomes a reading setting: `pageTransition` = `curl | slide`.**
  The slide has existed since M7 as the *fallback*; this promotes it to a choice.
  Reasons to say yes: the curl is a strong effect to be stuck with, it is the most
  expensive thing the reader does per turn, and "reading comes first" means the reader
  who finds it fussy should be able to turn it off without turning off animation
  altogether (which is what reduced motion is for, and is a different request).
- **The setting is a ceiling, not a mode switch.** The existing ladder — reduced motion →
  instant, low-fps → slide, failed capture → slide — still runs underneath it. `curl`
  means "curl if this machine and this capture can"; `slide` means "never curl". Nothing
  in the ladder is allowed to promote a turn *up* to the curl.
- **Slide means the next page slides over the departing one**, not the departing page
  sliding away — and it reuses everything step 2 built: the same card capture, the same
  advance-at-grab, with the departing card held static underneath while the live stage
  translates in over it. The drag follows the pointer and commits or springs back on the
  same threshold as the curl, so the two transitions are the same gesture with a
  different renderer.
- **Not decided here, deliberately:** whether the slide's direction should follow the
  book's reading direction (RTL books). Out of scope until a RTL book is in the library.

## 2026-08-02 (later) — The turning sheet is the paper card, and the peel opens onto the next page

The pass after the capture rewrite, and mostly the two things that entry named as
left open. Nothing here changes the fold's *model* — `pageFold.ts`'s geometry is
untouched except for where the sheet is held.

- **The fold canvas was misregistered by one reader margin, and now is not.** `PageCurl`'s
  wrap is positioned inside `.pageClip` but was sized and offset from `containerRef`,
  which sits one `--reader-margin` further in. Every rect the fold works in is now
  measured from the card (`.pageClip`) instead: `nearLeafRect` takes the card's box, and
  the spread decision keeps taking the *content* width, because that is the only width
  epub.js ever sees and a margin can straddle the threshold.
- **The turning leaf is the paper card, not the text column** — the operator's ask, and
  what makes it read as folding a page rather than peeling a rectangle pasted onto one.
  The extra area is flat paper, so the card bitmap is the page snapshot composited into a
  larger canvas over the card's own background colour (`cardSnapshot.ts`). Nothing
  re-serializes the app's CSS: the one hard-to-capture element is still the iframe, and
  the band around it is one colour.
- **In spread mode the card splits down the middle**, not at the text columns' edges.
  Each leaf then carries its own outer margin and half the spine gutter, which is where a
  real spine is, and the two halves tile the card exactly.
- **That bitmap goes to `PageCurl` as a canvas, not a data URL.** It is drawn, never
  transported; a PNG encode plus a decode per page turn is real time on the interaction
  path for nothing.
- **The margin band's colour is read off the card element, not sampled from the bitmap.**
  Measured: `samplePaperColor` (an 8x8 downscale, per-channel median) returns
  rgb(228,225,218) on a page of prose against the card's real rgb(250,247,240), because
  downscaling averages ink into every tile. That is fine for the *back of the sheet*,
  which only wants "roughly what colour is this paper", and visibly wrong for a band
  sitting next to the real thing. One computed background value, walked up from the card
  to the element that actually paints it, is exact in every theme.
- **The drag advances the rendition at grab time and steps back on spring-back.** Until
  now `handleGrabPointerDown` advanced only on commit, so the opening revealed a
  pixel-identical copy of the page being peeled. It now does what `turnPageCurl` has
  always done for a click turn. The step-back happens *before* the spring-back animation,
  not after: the fold paints nothing once the pointer reaches its anchor, so a step-back
  that outlives the animation shows the wrong page full-screen for however long epub.js
  takes, while stepping back first costs only a shrinking opening briefly showing the
  page it is returning to, under the roll's own shadow.
- **Grabbing the middle of an edge peels the edge, not the nearest corner.** The fold now
  has an *anchor* — a corner (the dog-ear pinch) or the middle of an edge — and the
  geometry does not distinguish them, because the model only ever asks the anchor for a
  point. An edge peel keeps its crease parallel to the spine by pinning the fold
  pointer's `y` to the anchor's, which makes `peelDir` horizontal; the cursor still
  roams, and drag progress still follows the real cursor. The middle third of each edge
  is the edge; the rest is still the nearer corner.
- **Deliberately not here, and still the reason the fork resolves to WebGL:** folding
  over the spine onto the facing leaf, and pinning the spine edge so the gutter-side
  corners cannot curl away. Both are conical deformations (PAGE_CURL.md §2d, §4).
- **A measurement caveat worth keeping**, because the last entry's headline number does
  not reproduce without it: `pageSnapshot` caps its capture at `MAX_CAPTURE_SCALE` 1.5,
  so on a 2x display the fold blits a 1.5x bitmap onto a 2x canvas and *cannot* be pixel
  identical to the live DOM. "0 differing pixels" is a dpr-1 statement. At dpr 1 the
  fold's flat region reproduces the departing page exactly — 0 differing pixels, mean
  delta 0.00008, on the whole unpeeled half of the turning leaf — which is the honest
  form of the registration test.

## 2026-08-02 — The page snapshot stops being a screenshot: html2canvas is retired

Three passes of M20 were verified against a bitmap that was never there. The cause is
mechanical and was measured, not inferred: `capturePageSnapshot` used html2canvas with
`foreignObjectRendering: true`, which serializes the captured subtree into an SVG
`<foreignObject>` and paints it through an `<img>` — and **an SVG rendered as an image
cannot host a nested browsing context**. That is SVG's "secure static mode", a spec rule,
so the epub.js iframe (which is the entire page) contributed exactly zero pixels in every
browser on every platform. 2026-08-01 recorded this as a *headless* limitation and hoped
it might not reproduce on real hardware. It reproduces everywhere, necessarily, and the
operator's own screenshots show it: a translucent grey wedge with the page text fully
legible through it and no mirrored glyphs anywhere.

- **The snapshot is now built, not screenshotted.** The iframe's document is same-origin
  (`sandbox="allow-same-origin"`, `srcdoc`), so instead of photographing the iframe we
  reach through it and serialize its own `documentElement` into the `foreignObject`. No
  nested browsing context, and the browser's own layout engine does the work — columns,
  line breaks, the reading theme and the fonts all come out right because none of them
  are being re-implemented. **Verified by pixel diff against a screenshot of the same
  rect: 0 differing pixels, mean channel delta 0.** Capture takes ~22ms.
- **Three things it has to carry, each of which failed silently first.** epub.js serves
  the section CSS from `blob:` URLs that an SVG image will not load, so the rules are
  dumped inline; `url()` assets (images, `@font-face`) are refetched as `data:` URIs,
  because a fallback font re-breaks every line and makes the snapshot disagree with the
  page at the exact moment the fold starts; and the visible window is translated by
  `-scrollLeft`, since a paginated section is laid out many viewports wide.
- **The subtlest one, worth the sentence it takes to state.** epub.js paginates by giving
  `body` a viewport width, columns, and `overflow: auto hidden`, which only works because
  a *root* element's body propagates its overflow to the viewport and is then treated as
  `visible`. A copied `<html>`/`<body>` inside a `foreignObject` is not the root, so it
  clips for real: the snapshot looked right on page 1 and came back blank on every other
  page. One `html,body{overflow:visible !important}` fixes it. Measured 0% ink vs 11%.
- **The highlight overlays need their own rasterization pass.** A `<style>` inside a
  `foreignObject` is not scoped to it — CSS in an SVG document is document-wide — so the
  book's own stylesheet reaches marks-pane's `<svg>` and kills it (measured: 0% wash in
  one document, 6.35% in two, screen 6.35%; paint order and z-index ruled out first).
  They also have to go through a `foreignObject` rather than a bare `<g transform>`,
  because marks-pane sizes itself with a *CSS* width that means nothing in SVG context.
- **The result must be a `data:` URL, never a `blob:` one.** Measured: an SVG loaded from
  a blob URL taints the canvas, so `samplePaperColor`'s `getImageData` and the final
  `toDataURL` both throw `SecurityError`. This is not an optimization to undo later.
- **html2canvas is removed from the dependency list**, this being its only call site.
- **What this does *not* fix, and is not trying to.** The fold canvas is still
  misregistered by one reader margin and the drag still never advances the page, so the
  peel still reveals a copy of the page being peeled. Both are real, both are named in
  PAGE_CURL.md §2, and both belong to the next pass — not smuggled in here.
- **Eager capture was scoped out on measurement, not forgotten.** It was in the plan to
  remove a 700ms budget from the interaction path; the new path costs ~22ms, which does
  not justify a cache with three staleness paths (relocate, resize, re-pagination).
  Revisit only if a real drag on real hardware feels late.

The consequence worth stating plainly: **every earlier "verified live" report on M20
should be read as verifying the geometry and nothing about the pixels.** The rolled sheet
had never been seen with a page in it until now.

## 2026-08-01 — The curl is a *roll*, not a fold: amending the 2026-07-20 geometry

Operator verdict on M20 as shipped: "it looks nothing like how I'd like it to look,"
against Apple Books screenshots. The premise checked out — the flat fold is genuinely
wrong, and wrong in a way that was decided here, not mis-implemented. **This entry
amends the 2026-07-20 ruling** ("the curl is a fold, not a hinge": crease about the
perpendicular bisector of corner→pointer, mirror, dim). The bisector was right about
what the *hinge* got wrong and wrong about what replaces it.

- **Paper does not crease when you peel it; it rolls.** A perpendicular-bisector fold is
  a sheet of paper folded flat — a napkin, with a hard crease and a razor edge where it
  meets the page. Every real page curl, Apple's included, has a *rounded leading edge*
  with the sheet's own thickness of shading across it. That single difference is most of
  the gap the operator was pointing at, and no amount of tuning the dim and the shadow
  closes it.
- **The replacement, and it is still not a mesh.** The sheet is flat, then wraps a roll
  through a half turn, then flat again upside down. Working in the fold frame, a page
  point's only relevant coordinate is its signed distance from the crease, so the whole
  deformation is *a shift along one axis as a function of one scalar* — every band of
  constant distance stays a straight line parallel to the crease, and paints as one
  `drawImage` under one affine transform. The flat page and the tail, which are almost
  all the pixels and all the readable text, stay single undistorted blits. The roll's
  curvature ramps rather than being constant (`ROLL_EASE`), because a constant radius
  reads as an inflated tube.
- **The bisector survives as the degenerate case.** At zero arc length the crease lands
  back on the midpoint of corner→pointer and the sheet is a plain mirror image — the
  2026-07-20 model exactly. It is pinned by a test. This is why the amendment costs no
  architecture: the old model was a special case of the new one all along.
- **DESIGN.md's "no WebGL until a named effect needs it" still holds**, and now on
  firmer ground than in July: the rolled sheet is closed-form 2D, measured, and shipping.
- **What we are deliberately not matching, and why it is worth writing down.** In Apple
  Books you can see the page's own text squeeze and bend *into* the curl. We cannot, and
  it is not a tuning failure: under an orthographic view the tail always covers that
  band, because the tail projects from the roll's far end back across the crease. It
  takes a real perspective camera to lift the tail's near edge clear of it — Apple's is
  a 3D scene, and the reverse-engineering of iBooks' original effect (wdnuon, 2010)
  reads it as a *conical* deformation, which is a per-vertex mesh warp. That is a WebGL
  conversation, and if it is ever worth having it should be had on its own, not smuggled
  in under "make the curl nicer." The rolled sheet is the honest 2D ceiling.
- **Two canvases, not one.** The back of the sheet is a *material* — paper wash plus its
  own lighting — and those have to land on back-facing pixels only. Compositing them
  straight onto the visible canvas washes the front-facing half of the roll too, since
  the two overlap by construction. The scratch layer is not an optimization and should
  not be optimized away.
- **The fold asks the bitmap what colour paper is.** It reads the page background back
  out of the snapshot rather than being told the reading theme, so it works in any
  theme without knowing which one is on. Dark themes then need the *inverse* treatment,
  not the same one at lower contrast: a near-black flap over a near-black page with a
  black shadow between them is invisible, so the back of the sheet lifts toward grey and
  the roll's leading edge is drawn with a sheen rather than a crease. NOTES.md 2026-08-01
  has the numbers.
- **Budget, restated with measurements.** The 2026-07-20 budget (one canvas, redraw only
  while a fold is live) stands, with the layer as the stated exception. The roll costs
  real time and it is worth knowing where: the per-band `drawImage` calls dominate
  everything else combined, so the band count is chosen per frame from the roll's size on
  screen, and every `source-atop` pass fills its own bounding box rather than the canvas.
  Those two changes took a measured 39ms/frame to 15ms in a software rasterizer. The M10
  low-fps downgrade to the slide is unchanged and is now doing more work: the rolled
  sheet is ~2.6x the flat fold, so a machine near the line will fall back where it
  previously did not. That is the correct failure and the reason the guard exists.

## 2026-07-30 — M19.6 round 4: the real cause of the chapter-boundary skip, and three more operator-feedback fixes

Picking up round 3's open blocker (NOTES.md: two live sweeps, zero reproductions) with
four real, tested fixes — full detail and live-verification method in NOTES.md "M19.6 —
round 4."

- **The chapter-boundary page skip, real cause.** epub.js's `next()` compares
  `container.scrollLeft + offsetWidth + layout.delta` against `scrollWidth` as an exact
  equality on the second-to-last page of every section. The round-1 fix (pinning
  `containerRef` to an integer width) closed off one source of sub-pixel error but not
  the one that actually bites: `scrollLeft` itself drifts at any non-100% device-scale
  factor or browser zoom, because Chrome snaps the stored offset to a physical pixel and
  epub.js's own `scrollLeft += delta` accumulates that error every turn. Measured live
  (Kafka on the Shore, 0.9 DSF): `scrollLeft` reads `1025.5555` instead of `1025`,
  `+0.5555px` per turn, until the equality fails one page early. At DSF 1 the same run is
  exact and nothing skips — which is exactly the operator's own "resolved when we resize
  the tab to 100%." **Supersedes, does not contradict, the round-1 entry** (2026-07-30
  earlier, "M19.6 operator verification": that fix's mechanism is still sound, it was
  just treating a different symptom of the same class of bug). Fixed in
  `web/src/reader/pageTurn.ts`: `next()`/`prev()` are taken over on the manager itself
  (covers every caller — footer buttons, keys, turn zones, the dwell — at once) and
  decide from a *rounded* spread index, scrolling to absolute multiples of `delta` so
  nothing can accumulate.
- **The book-wide page total/number moving when crossing a chapter.** Cause: the old
  `computeBookPageInfo` re-derived its estimate ratio from *every* measured section on
  every relocate, which moved the estimates for sections *behind* the reader too —
  exactly the "52 → 54, then '52' recounts as 53" the operator reported. Fixed with
  `bookPageMap` (`bookPages.ts`, rewritten): calibrate once from one real measurement,
  then only ever borrow pages from not-yet-visited sections when a new measurement
  disagrees with its estimate. Nothing already shown to the reader moves; the total only
  moves when there is nothing left to borrow from, and it moves monotonically when it
  does.
- **The misaligned highlight overlay, cause found and fixed** (M19.6's own task closed
  this only as "diagnosed, not confidently closed"). marks-pane SVG rects redraw only
  from epub.js's `reframe()`, which fires only when a view's *expanded pixel width*
  changes. A reflow that re-breaks lines without changing that width — a text-size,
  margin, or pane-width change; a late web-font load; a section re-paginating a beat
  after it first renders — leaves every overlay describing coordinates that no longer
  match the text. Fixed by calling the marks-pane's own `pane.render()` directly
  (`refreshHighlightOverlays` in `ReaderView.tsx`) after each of those triggers.
- **Two more operator-feedback rounds, bundled in:** the hover wash now lifts to the
  highlight's own kind colour at full strength (`hoverFillOpacity`) rather than a capped
  multiplier of the base wash — closer to the native `::selection` presence the operator
  compared it to, kind identity still intact since it's the kind colour, not a shared
  yellow. The highlight-across-a-page-boundary dwell now also requires the cursor to be
  *past the page's last word* (`pageTextEdge.ts`'s `cursorPastPageText`), not merely
  inside the turn zone, so a normal mid-paragraph selection drag no longer trips a page
  turn.

The NOTES.md "M19.6 — the chapter-boundary page skip / book-count '+2' jump" blocker is
resolved by this entry.

## 2026-07-30 (last) — How this ships: the distribution ladder, and where it forks

Design session on moving a project from localhost to something other people use. Nothing
is scheduled by this entry; it settles the *shape* so a rung is chosen deliberately.
Full document: `docs/SHIPPING.md` (repo-level — the ladder applies to every project under
`projects/`).

### The ladder forks; it is not one continuum

Rungs 0–2 (localhost → public repo → desktop app) deliver **the product we have**. Rung 3
(a public hosted website) does not: it removes the two things Marginalia is built on —
the local Obsidian vault (settled decision 6 makes it a projection onto a *local
directory*, which does not exist on a server) and the machine's own model access (the
`claude-agent` provider authenticates as the operator's Claude subscription and would
have to be compiled out of a hosted build, not merely hidden). It also swaps "my books on
my disk" for "strangers' copyrighted books on my server". **Ruling: hosted Marginalia is
a different product, not a deployment target of this codebase.** If it is ever wanted, it
starts as a design session about that product — vault story, identity model, content
policy decided before code moves.

### Rung 2.5, the private deployment, is the rung that was missing

Named separately because it is repeatedly mistaken for hosting: the same single-tenant
app on one box, reachable from the operator's other devices over a private overlay
network (Tailscale/WireGuard preferred over an authenticating reverse proxy). Still
exactly one user, so none of rung 3's costs apply. It is simultaneously the gate on iPad
drawing (2026-07-27, "Future arcs"), so it buys two parked items at once.

⚠️ The landmine, recorded because it is the obvious wrong move: binding to `0.0.0.0` is
not the fix. The API has no authentication and no CORS layer, and it can read the
library, read *and write* the Obsidian vault path, and spend tokens. M6's loopback
binding is load-bearing. Hence the standing rule: **exposing the server beyond loopback
requires authentication in the same change, not a follow-up task.**

### Rung 1's gate is legal and documentary, not technical

Verified rather than assumed, this session: the 80-commit history has never contained
`.env`, a SQLite file, or a key — the only key-shaped strings are `sk-ant-test`
placeholders in `providers.test.ts` — and the only committed EPUBs are the two
public-domain fixtures (though the specific *Metamorphosis* translation's status is
unchecked). What is missing is a `LICENSE` (absent = all rights reserved, a decision made
by default), a `README` that is a runbook rather than a pitch, and a third-party license
audit. Recommendation on record: **MIT, and publish the process docs** (`CLAUDE.md`,
`OPUS.md`, `decisions.md`) — they are the most interesting thing in the repo. Not decided.

### Rung 2 is decided by the native module

Electron over Tauri, because the server is Node with `better-sqlite3`: Tauri means either
a Node sidecar (Electron's problems without its tooling) or a Rust rewrite of 24k lines
of behaviour. ⚠️ `data/` must move to the OS per-user directory *before* packaging —
`paths.ts` resolves it install-relative, which inside a signed bundle is read-only — and
that move is a migration over the operator's own live library, not a rename. Keys move to
the OS keychain in the same rung; plaintext in SQLite is defensible on your own disk and
not in software handed to someone else.

### Disagreement preserved

No pushback was needed on the ask itself. The concern recorded against rung 3 is the
one above: it converts a nearly-finished local product into an unfinished hosted one, and
the evidence that anyone wants it is exactly what rungs 1, 2 and 2.5 exist to gather.

## 2026-07-30 (later) — M19.6 operator verification: the spread divisor bug, and book-wide pages by click not by character

A manual verification pass of M19.6 by the operator, after the round above landed, found
real remaining problems and one deliberate reversal of that same round's own reasoning.
Full technical detail lives in NOTES.md ("operator manual verification, round 2" through
"the reading pane is resizable" and "`r` opens the reader") — this entry records the
decisions, not the mechanics.

### The "page skip" was the spread-mode divisor bug, not a second bug

Diagnosed live rather than re-guessed: epub.js's `location.start.displayed.page`/
`.total` are single-*column* indices — a two-page spread's raw total is always double
the real number of spreads (`layout.js`'s `pages = spreads * divisor`). The reader
passed these through unadjusted, so the true last spread of a section reported itself as
"page N-1 of N" (N always even) rather than "page N/2 of N/2" — indistinguishable, from
the reading seat, from a skipped page, and exactly matching every example the operator
gave ("page 7 of 8 is the last page", "skips the last page or two"). A 17-width × 2-mode
sweep found this 100% reproducible in "auto" spread mode at any width ≥ 1200px and
**zero** anomalies in single mode at any tested width/margin/font-scale combination —
single mode's own `--reader-max-width` cap (800px, below the 1200px spread threshold)
means it can never trigger a real spread at all. Fixed by reading the manager's own live
`layout.divisor` and dividing the raw numbers back out (`bookPages.ts`). Single-mode
"item 1" is not confidently closed despite the sweep — see NOTES.md for the reasoning
on why the spread-mode fix is nonetheless believed to be the whole explanation.

### Book-wide page numbers: reversed from "layout-independent" to "click-accurate"

The 2026-07-30 (earlier) entry above chose `book.locations` (character-based, ~1600
chars/location) specifically *for* being stable across font size, margin, and spread
mode — accepting that a "page" wasn't a claim about any window's actual pagination. The
operator, after living with it, explicitly rejected that trade: clicking "next" could
move the book-wide number by 5+ at once (a location isn't one rendered page), and they
want the opposite property — **every "next" is exactly +1**, even if the total shifts
when text size or margin changes. This is a deliberate reversal, made directly and with
specific, testable acceptance criteria ("clicking next increments by one," "percentage
by percentage of pages, like Apple Books"), not implementation drift — recorded here per
CLAUDE.md's own rule that settled decisions are overturned deliberately.

New rule: **book-wide page numbers and percentage are click-accurate, not
layout-stable.** Visited sections contribute their real, spread-adjusted page count;
unvisited sections are estimated from their share of the book's text (reusing the Scan's
own `lengthPercent`), calibrated from whatever has actually been measured, and the
estimate is allowed to shift as more of the book is visited. `book.locations` itself is
unaffected and stays the mechanism for the scrub dial and TOC chapter-start percents —
this reversal is scoped to the reader's footer/percent readout only, the same "amendment
about the reader's footer, not about position ranges in analysis" carve-out the earlier
entry already drew around the digest's own percent-and-chapter convention.

### The reading pane's outer measure is now user-resizable

A fourth-knob risk the M19.6 task text itself flagged (`readerMargin`, the column-width
target, and the spread gutter already each own a job) resolved the same way: the
drag-set width **replaces** the spread-mode default outright rather than adding a fourth
independent number, with `readerMargin` staying exactly what it was — a proportion
*inside* the pane. Persisted (`readerPaneWidth`, `0` = unset) and resolved before the
reader mounts, so there's no flash back to the default on reload.

## 2026-07-30 — The global overhaul: one control system, two registers, rooms vs. instruments

A large operator feedback pass after living with M19/M19.5 — roughly forty items, mostly
front-end, with one stated goal: **"a more stable and coherent app."** That goal is the
lens for everything below. Where an item was a symptom, the cause was looked up in the
code before anything was designed on top of it; where the cause could not be established
by reading, that is said so explicitly and a diagnostic is written into the task instead
of a guess (OPUS.md's rule).

The operator also **deferred M19.8 (the refactor)** — "everything currently works, and I
want to understand more about refactoring when I get into it." Recorded, with its cost,
at the end of this entry.

### What was verified before designing (read, not run)

All findings below are from reading this repo's source plus epub.js 0.3.93's own source
in `node_modules`. Nothing here was reproduced live this session; the live reproduction is
part of each task's acceptance criteria.

| Reported | Established cause |
|---|---|
| Page turns sometimes skip a chapter's last page | epub.js `DefaultViewManager.next()` (`lib/managers/default/index.js:412`) chooses "scroll" vs. "next section" with `scrollLeft + container.offsetWidth + delta <= container.scrollWidth`. `offsetWidth` is an **integer-rounded** DOM value; `layout.delta` is a float from the stage width. A fractional stage width makes `offsetWidth` exceed `delta` by up to a pixel, the comparison fails one page early, and the section advances. Intermittent **because it depends on window width** — which `computeReaderGap` and the margin setting also move. |
| Hovering a highlight makes the text under it unreadable | `ReaderView.tsx` hover boost sets `fillOpacity = 0.85` **and** `mixBlendMode = "normal"` — the mark stops being a wash and becomes paint. |
| Chat textbox too small since the context ladder arrived | `.composer` (`ThreadPanel.module.css`) is a single flex row holding the ladder, the textarea and Send. Nothing is wrong with the textarea; the row is oversubscribed. |
| Clicking a highlighted passage turns the page | `handleContentClick` exempts only `a[href]` and live selections; marks are not consulted, though a geometric mark hit-test already exists in the mousemove handler. |
| Scan zoom stretches the axis text | `transform: scaleX(zoom)` on `.zoomContent` (`HeatStrip.tsx`), which contains the tick labels and the heat canvas. The book bands below it already position through `fractionToView()` and are correct. |
| The digest calls the real "Chapter 1" Chapter 5 | `chapterNumber: index + 1` over all text-bearing sections (`routes/digest.ts`). It is a section ordinal wearing a chapter's name. |
| The desk doesn't extend down the page | `min-height: 640px`, fixed, in `DeskCanvas.module.css`. |
| "Cancel a digest" | Not possible today, and the current cancel is theatre: `POST /:id/digest` runs the whole range synchronously; the client's `AbortController` abandons the *response* while the server keeps digesting. |

**Not established — do not guess it in the fix.** The misaligned highlight overlay
(a mark drawn over different text than the quote it belongs to). Two live candidates:

1. **Stale mark rects.** `pane.render()` is called only from `IframeView.reframe()`
   (`lib/managers/views/iframe.js:331`), and `reframe` runs only when the iframe's own box
   changes. Any layout change that leaves the box the same size leaves the marks drawn at
   their old positions.
2. **A wrong anchor.** The CFI resolved to a non-collapsed but incorrect range, or the
   text-offset fallback (`selectionContext.ts`'s `rangeFromTextOffsets` against
   `body.textContent`) landed at a shifted offset.

**The diagnostic that separates them:** with a bad mark on screen, evaluate
`rendition.getContents()[0].range(<the highlight's cfi>).toString()`. Returns the
*intended* quote → cause 1, the anchor is fine and the displacement is purely visual.
Returns the *displaced* text → cause 2, and the anchor itself is wrong. Fixing the wrong
one of these produces a change that appears to work until the window is resized.

### One control system, two registers — split by material, not by room

The ask was "standardise buttons and sliders, universal across the app, with
modifications for the Scan page." Taken literally that collides with DESIGN.md's binding
rule that *the reader earns its analogue feel by being still* — playful 3D chrome is
exactly the sort of thing that rule exists to keep off the page.

The operator's refinement is better than the options offered and is now the rule: the
split is by **material, not by room**. Reader, Desk, Digest and Settings are all *paper*
and share one register (the reader taking the quietest variant of it); the Scan is
*glass* and has its own. So:

- **One component set, built once**: `Button`, `Slider`, `Popover`/`Sheet`, `IconButton`,
  `KeyCap`. One set of sizes, focus rings, disabled states, hit areas and motion timings.
- **Two registers as a theme context**, layered on the existing CSS custom properties
  exactly as room theming already is — `paper` (warm, tactile, soft drop shadows, gentle
  3D) and `glass` (CRT/instrument: phosphor strokes, bezel, scanline). **Never a third
  system**, and never per-room bespoke buttons.
- The reader's variant is the paper register with its ornament turned down (flatter,
  lower contrast chrome), not a separate design. This is what keeps "coherent" from
  meaning "flattened".

Rule this settles for cases nobody has thought of yet: **a new control belongs to a
register, and a register belongs to a material.** A surface that is paper takes the paper
register even if it is new; a surface rendered as instrument glass takes the glass one.
Nothing gets its own.

### The slider is a gesture that already exists

The specified slider — click-drag with the cursor hidden, live value floating above the
handle, click-to-type as a text field, detents you can feel, log scales for token
counts — is not new interaction design. `ReaderView`'s `%` scrub already does the hard
half: pointer-lock so travel is unbounded, a live preview value that is not the committed
value, Escape-cancels, and a keyboard path that never needs the pointer. That gesture is
**generalised into the shared `Slider`**, and the `%` dial becomes its first consumer
rather than staying a bespoke one-off.

Requirements that are part of the component, not per-use decisions:

- **Two input modes, one value.** Drag (pointer-lock, cursor hidden, floating readout) and
  click-to-type (the track becomes a text field, commits on Enter/blur, rejects out-of-
  range rather than silently clamping to a number the reader didn't type).
- **Detents are advisory, not quantisation.** A detented slider snaps *into* a stop when
  released within its capture window and reports a visible/haptic-ish tick as it passes
  one, but arbitrary values remain typable. Context length may sit at 12000 if typed.
- **Log scale is a scale, not a value set.** `scale: "linear" | "log2"`. Log2 sliders
  detent on powers of two; the capture window is a *percentage* of the current value
  (2–3%), not a fixed number, or the detents are unusable at the top of the range.
- **Keyboard is a first-class path**, per the existing a11y bar: arrows step, shift+arrow
  steps by a detent, and a real `role="slider"` with `aria-valuetext` carrying the
  formatted value (`"16,384 tokens"`, not `"14"`).

### Popups slide from where they were called, and morph when they resize

Adopted. Two constraints on top of it:

- The origin is the **invoking control's rect**, read at click time and handed to the
  overlay — not a hardcoded corner per overlay type. A settings panel opened from a
  reader menu and from the desk cluster must fly from two different places, and a
  hardcoded "top right" is a bug waiting for the second call site.
- **Size morphs run at ~240ms, not 500ms.** The operator asked for 0.5s. DESIGN.md's
  motion language says 150–200ms for anything the system does, and 500ms is over the
  "nothing blocks input for more than ~400ms" line for a control the reader is actively
  clicking through (settings tabs). Shipping at ~240ms with a spring, which reads as
  *smoother* rather than faster. **Disagreement preserved:** if 240ms still feels abrupt
  in the hand, the number moves — it is a constant in one place, not a redesign.
- Reduced motion collapses all of it to a crossfade, as everything else already does.

### Scan and Digest stop being rooms and become instruments

The biggest structural consequence in the whole pass, and it is not a skin: the Scan
becomes **a popup over whatever you were doing**, framed as a CRT television, and the
Digest becomes a popup too. DESIGN.md's thesis is "three rooms, one building". After
this it is **two rooms and four instruments**:

| | |
|---|---|
| **Rooms** (you are *in* them) | The Desk, The Book |
| **Instruments** (you put them *on* what you're in) | The Scan, The Digest, Settings, Annotations |

This is a genuine improvement to the thesis rather than a compromise of it — "the book
under an instrument" was always the Scan's stated job, and an instrument you bring to
the book is more honest than a room you travel to. It is recorded as an **amendment**
because it changes a binding document, not by drift.

What it costs, stated plainly: **the airlock transition loses its full-screen form.**
"The lights change; the highlights you were just reading *become* the glowing bands" was
named in DESIGN.md as *the* transition that sells "one building". The replacement is
smaller: the instrument slides in from its invoking control and the bands materialise
inside it. The band-materialisation half survives; the room-to-room half does not,
because there is no longer a room to travel to. Worth knowing that a signature was spent
here.

Consequences that fall out and are therefore not open:

- The Scan keeps its route (`/scan/:id`) as a real, bookmarkable URL and renders over a
  background location — **the exact pattern Settings already uses** (`App.tsx`'s
  `background` nav state). No new routing concept, and a deep link still works by
  falling back to the Desk underneath.
- The CRT **bezel does not warp.** Only the glass bows. A frame drawn inside the warp
  wrapper would bend, and a bending television reads as broken rather than retro. The
  bezel is a sibling of the filtered wrapper, not a child.
- Barrel distortion scaling with CRT intensity is already how `warp.ts` works
  (`maxPull = intensity * MAX_PULL_PX`) — "more distortion" is a change to `MAX_PULL_PX`,
  bounded by M18's standing legibility rule, which is *not* repealed: contrast still
  passes, and intensity 0 still reaches zero displacement. Larger type in the scan pays
  for part of the extra warp; it does not license unbounded warp.

### The scan's zoom becomes a domain transform everywhere

`zoom.ts` already models zoom correctly — `fractionToView()` maps domain fraction to view
fraction, and the book bands and highlight hit-targets already go through it. The strip's
*graphics* layer instead uses a CSS `scaleX`, which is why the axis text stretches: a CSS
transform scales glyphs and bitmaps, not just positions.

Ruling: **there is one zoom mechanism, and it is the domain transform.** The CSS
`scaleX` is deleted; labels position through `fractionToView()` like everything else, and
the heat canvas is redrawn at the zoomed domain rather than being stretched. Scroll-to-
zoom then costs almost nothing, because it is a state change rather than a new rendering
path — and it stays correct under the barrel warp, which composes after it.

### Page numbers: book-wide, cached, and layout-independent

The operator asked for book-wide numbering and accepted that it would drift with text
size. **It doesn't have to.** epub.js's `Locations` (`lib/locations.js`) splits each
section by **character count**, not layout — so a location index is stable across font
size, margin, and spread mode. That makes book-wide numbering both what they wanted and
honest, which the 2026-07-29 "percent and chapter, never pages" rule assumed was
impossible.

- Generated once with `book.locations.generate(~1600)`, serialised with
  `locations.save()`, and **persisted per resource in SQLite**. Resources are immutable on
  import (settled decision 5), so the blob can never rot — generate once per book, ever.
- ⚠️ `generate()` loads every section. It must run **off the critical path** (after the
  first page paints) and never block a page turn. Until it resolves, the footer shows
  percent and chapter, which is what it shows today.
- A location is ~1600 characters, so it is *page-like*, not identical to a rendered page.
  The number is stable and familiar; it is not a claim about this window's pagination.
- The **existing** rule stands where it was aimed: the digest's chapter ranges remain
  percent-and-chapter. This amendment is about the reader's footer, not about position
  ranges in analysis.
- Reader setting `pageNumberMode: "book" | "chapter" | "off"` — the operator asked for the
  choice explicitly. `"chapter"` uses `location.start.displayed`, which the reader already
  receives and currently only shows inside the progress popover.

### Background work is a job model, not a popup

Presented as a UI item ("background tasks show in a dismissible popup"), and it is
architecture. Today a digest is one blocking HTTP request with no id, no progress, and no
cancellation; the "cancel" the UI appears to offer abandons the response while the server
continues. A tray and a cancel button on top of that would be **a lie in the interface**,
which is worse than not having them.

So: one **job registry** on the server — id, kind, resource, status, progress, an
`AbortController` per job, SSE for progress, and a real cancel endpoint. Rules:

- **Built once, before audio.** M21's render progress and M22's cast scan are the same
  shape; AUDIO.md already specs an SSE progress endpoint. A second progress system built
  three milestones later is the duplication this round exists to remove — the same
  argument that made one provider picker serve three surfaces in M19.
- **Cancel means the work stops**, verified by watching it stop (process/ledger), not by
  reading the code. The `LLMProvider` seam already takes an `AbortSignal`; the digest loop
  does not thread one through, and that is the actual work.
- A cancelled job leaves **no half-written state** — the digest is per-chapter and cached
  by source hash, so completed chapters stay and the run simply ends early.
- The tray is the *view* over the registry. Dismissing a popup must not cancel the job;
  those are two different verbs and conflating them is how someone loses a 40-chapter
  digest.

### Response length is per role; context length stays per profile

`maxResponseTokens` is currently one global setting, and profiles carry
`openaiContextTokens`. The ask ("digest can be larger") lands on the **role**, not the
profile: one profile can serve both roles, so a per-profile length could not express
"same model, longer digests". Roles gain their own `maxResponseTokens` (250–10000);
context length stays on the profile, where the model's actual window lives.

⚠️ On `claude-agent` — and now `codex-cli` — response length remains a *request in the
system prompt*, not an enforced ceiling (decisions.md 2026-07-28). The settings UI must
keep saying so next to the field for both.

### Codex CLI: a fourth provider, and a caged one

Verified on the Linux machine rather than assumed: `codex-cli 0.114.0` is installed at
`/snap/bin/codex`, and `claude` is **not** — which is a large part of why this is wanted.
`codex exec` supports `--json` (JSONL events on stdout), `--output-schema <file>` (a real
structured-output path for `extract()`), `-m/--model`, `--ephemeral`, and
`-o/--output-last-message`.

The problem it raises is not integration, it is **CLAUDE.md settled decision 2** — "the
model only returns text or validated JSON; it never touches files." `claude-agent`
satisfies that by passing `tools: []`. Codex has no equivalent: it is a shell-running
agent by design. Therefore it is permitted **only caged**, and the cage is part of the
provider, not of its configuration:

- `--sandbox read-only`, approvals never, `--ephemeral`, `--skip-git-repo-check`, and
  `-C <a dedicated empty scratch directory>` — never the repo, never `data/`.
- The environment is scrubbed the way `claudeAgent.ts` already scrubs `ANTHROPIC_API_KEY`,
  for the same reason: an inherited key silently changes who is billed.
- ⚠️ The event shape of `--json` is **not documented in this decision on purpose.** It was
  read from `--help`, not from a real run. The implementer's first step is to run one
  call, read the actual JSONL, and write the shape into NOTES.md — this project has been
  burned before by trusting a documented shape (the zod v3/v4 `extract` incident, M4).

This does not overturn decision 2; it bounds it. The rule becomes: *a provider that could
touch files is permitted only where the seam can prove it cannot.*

### Section labels: `S5`, and one number in the UI

Adopted as proposed. The digest's `chapterNumber` is a 1-based ordinal over text-bearing
sections and calling it a chapter is what produces "Chapter 5" for the real Chapter 1.
Displaying it as **`S5 · <title>`** stops the false claim without needing chapter mapping
that EPUB TOCs often can't support anyway.

⚠️ Two numbers exist: the section ordinal (`S`) and `spineIndex`. **`S<n>` is the only one
that appears in the UI**, everywhere — digest, scan axis, spotlight, chapter nav. A
surface printing `spineIndex` next to a surface printing `S<n>` is a bug report waiting
to happen.

### Highlighting across a page boundary — what is actually possible

Buildable *within* a chapter and impossible *across* one, and the design must say which
it is rather than promising both. Pages inside a spine section are columns of one
document, so a DOM Range spans them; scrolling the container mid-drag extends the native
selection. A section boundary is a different iframe document, and a Range cannot span two
documents.

So the dwell gesture (hold at the page edge, ring fills, page turns, selection continues)
operates within the section and **visibly refuses at a chapter boundary** rather than
silently doing nothing. ⚠️ `setPointerCapture` stays: a drag crossing into the sandboxed
epub.js iframe crashed the tab outright when it was missing, and that is a reproduced
crash (M10, NOTES.md).

### Annotations dragged off the page stop riding the page

Widening the panels' drag bounds from the reading stage to the app shell has a second-
order effect the ask didn't mention: panels are DOM children of the stage, and **that is
why notes ride the turning page** — the page-turn snapshot captures the stage, marks pane
and panels together (M10). A panel dragged outside the stage cannot be in that bitmap.

Rather than treat that as a defect, it becomes the rule: **on the page, it rides; off the
page, it stays put.** A note pinned beside the book is furniture, not part of the sheet.
The implementation must verify no ancestor clips the panel once it leaves the stage's box.

### Numbering, and the deferred refactor

New work lands as **M19.6, M19.7** (before the refactor) and **M20.5, M20.6, M20.7**
(after the fold, before audio). No renumbering — the rule set on 2026-07-28 after three
renumbers, and reaffirmed on 2026-07-29, is that decimals absorb insertions rather than
invalidating cross-references in five documents.

**M19.8 is deferred, not cancelled and not moved.** The operator's reason — wanting to
direct it themselves once they know more about refactoring — is a good one, and it is
their call. The cost, stated once: M19.8 sat immediately before M20 *because* the fold is
surgery on `ReaderView.tsx`, which is 1,894 lines and 3.4× the next-largest component;
M19.6 will make it slightly larger. Deferring means the hardest planned change lands in a
structure that was measured and found wanting. That is a defensible trade — it just
shouldn't be an accident. The milestone stays in place, in order, with a banner, so
picking it back up costs nothing.

## 2026-07-29 (addendum) — The scan's two layers, and the refactor narrowed

### Is this codebase disciplined enough to skip the refactor? Measured, mostly yes

The operator asked whether the refactor could be parked "if the codebase is well
disciplined and written". That is answerable with evidence, so here it is (measured after
M18/M19 shipped):

| | |
|---|---|
| Files under 200 lines | **92** |
| 200–400 lines | 16 |
| Over 400 lines | **5** |
| Test files / cases | 30 / 214 |

The five over 400: `ReaderView.tsx` **1,865**, `schemas.ts` 709 (a schema file — long is
appropriate), `ThreadPanel.tsx` 543, `ProviderPicker.tsx` 433, `digest/build.ts` 406.

**Verdict: the codebase is well disciplined — with exactly one exception.** 108 of 113
source files are under 400 lines, the seams are real, and test coverage is concentrated
where the fragility is. Nothing here justifies a broad refactor. `ReaderView.tsx` is the
outlier at **3.4× the next-largest component**, and it is precisely the file M20's fold
performs surgery on.

**So the refactor stays at M19.8 but is narrowed to one target.** The
position-unification half is **dropped** — it was a "one definition would be nicer"
argument with no consumer under pressure, and the measured discipline elsewhere says it
is not hurting. What remains is decomposing `ReaderView.tsx`, scoped to the seams the
fold actually needs. Smaller, cheaper, and it still de-risks the riskiest planned change.
This is the right shape of answer to "can we skip it": not yes or no, but *which part
earns its cost*.

### The semantic scan plots two layers, not one

Confirmed with the operator: "digest/AI" is a **second signal**, not a filter over the
first. They answer different questions and must not be blended.

| Layer | Signal | Resolution | Answers |
|---|---|---|---|
| **Mine** | highlights, notes, threads | exact position | *where did I engage with X* |
| **Book** | themes from chapter digests | chapter | *where does this book talk about X* |

- Filter to either, or show both.
- ⚠️ **Never merge them into one field.** Chapter-resolution data rendered in the precise
  field's visual language would claim an accuracy it does not have. The Book layer gets
  its own visual register — a quantised, obviously chapter-wide underlay — with the Mine
  field precise on top.
- **One theme vocabulary** across both, so filtering by a theme lights both layers.
- **Mine wins on overlap** for hit-testing: your own annotations are the primary object;
  the book layer must never steal a click from a highlight. Its own bands click through
  to the chapter start, which is the only honest target at that resolution.
- No digest → kind mode, as already specified. Digest but no thematic layer for a chapter
  → that chapter's Book layer is simply absent, and the coverage line explains it.
- Worth noting for later, not building now: the *difference* between the layers is
  itself interesting — a chapter the book develops a theme in heavily that you never
  annotated is a revisit suggestion.

## 2026-07-29 (later) — Provider roles, the thematic layer, spoiler-safe digests, and a roadmap regroup

Operator feedback after living with M17/M17.5. Two of these change architecture rather
than surfaces, so they are settled here before any of it is built.

### LLM provider *roles*, not one global provider

The ask was a provider slider on the scan; the answer it resolved into is bigger and
better. There are now **two named roles** — **query** (answering questions while reading)
and **digest** (batch analysis: the digest, and later M18's themes and M22's cast) — each
remembering its own complete provider setup, so a long book can be digested on a cheap
local model while Claude answers questions.

- The unit is a **provider profile**: a complete, named config (provider id, model, key,
  base URL, context tokens). **Roles point at profiles.** This matters for simplicity:
  when audio casting and semantic themes need a provider, they claim the existing
  `digest` role rather than growing a third bespoke setting.
- `getProvider(db)` becomes `getProvider(db, role)`. Every call site must say what it is
  doing — which is a small cost paid once, and it makes "which model ran this?" answerable
  from the usage ledger, which it currently isn't.
- Three surfaces, **one picker component built once**: a tab per role in the settings
  binder; the scan's slider (digest role); and a small icon in the reader menu that opens
  the same slider on hover (or click, for touch), with a click-through to settings.
  Building the picker three times is exactly the kind of duplication this round is
  supposed to remove.
- Migration must be silent: the existing single provider config becomes the initial
  profile that both roles point at, so nobody has to reconfigure anything.

### Thematic analysis is reader-driven, and separate from plot

The operator's reframing, which is better than the options offered and is now the rule:
**plot is fixed; thematic reading is personal and evolves as you read.** One person's
questions of a chapter are not another's. So the digest splits into two layers with
different lifecycles:

| Layer | Generated | Regenerated | Cached by |
|---|---|---|---|
| **Plot** | once per chapter | only if the text changes | source hash |
| **Thematic** | per chapter *per brief* | whenever the brief changes | chapter + brief |

- A **brief** is the reader's standing angle on a book — questions, perspectives, or
  interests they want the model to hold in mind ("read this for what it says about
  self-determination"). Briefs are injected into the thematic pass's prompt, so a chapter
  is analysed *through* that lens and the model arrives at question time already primed.
- Set a brief **before** reading a stretch, which is the natural workflow the operator
  described: you decide what you're reading *for*, then digest ahead of yourself.
- The model also **poses its own questions** per chapter — two or three worth asking —
  which double as a reading affordance: click one to open a thread on it.
- Consequence worth stating: the thematic layer is **cheap to re-run and expected to be
  re-run**, while the plot layer is expensive and generated once. Do not build them as one
  call. This is also what makes the feature affordable — changing your brief re-runs
  analysis, not summarisation.
- The instruction problem stands separately and is fixed in the same milestone: today's
  system prompt treats anything outside the book as a fallback to be "clearly marked",
  which is why "how does this apply to daily life" comes back hedged. Thematic and applied
  questions get instructions that *invite* grounded extrapolation instead of apologising
  for it.

### Spoiler-safe digests

- **Chapter entries gate exactly** — anything past the reader's bookmark renders redacted
  with a reveal control. Free, because chapters are stored individually.
- **Book-level synopsis/cast/themes are reduces over everything digested**, so they
  inherently spoil. They get a second **bookmark-bounded variant**, built only from
  chapters up to the bookmark, generated lazily and only when the bookmark has moved far
  enough to matter; the full version stays behind an explicit reveal.
- ⚠️ **LLM-generated chapter titles are spoilers too.** A descriptive title ("The
  betrayal") gives away the chapter it names. Titles are gated by the same rule as the
  summary they come from, and the ungated fallback is positional ("Chapter 7 · 34–39%").
- This composes with, and does not replace, M17's answer-time spoiler guard. One is about
  what the model *says*; this is about what the page *shows*.

### The digest instrument, and chapter labels

- The coverage tiles are unlabelled squares, and EPUB TOC titles are frequently useless
  ("I", "II", or absent). Fix at the data level: the digest's map step already summarises
  each chapter, so have it also emit a **short descriptive title** — no new pipeline,
  spoiler-gated as above. Hover a tile for title plus position range.
- ⚠️ Position range is **percent and chapter, never pages** — the same rule M17 already
  established. Reflowable EPUBs have no stable pages, and M16's text-size setting moves
  epub.js's page-ish counts anyway.
- The timeline gets larger, and the **torch UI lands now** rather than as a future arc —
  explicitly as an experiment that can be reverted if it reads as clunky. The **FROM/TO
  boxes stay** regardless: they are the precise input and the keyboard path, and the torch
  is the charm on top of them, never the only way in.

### Roadmap regroup (the efficiency review the operator asked for)

Reviewing everything unstarted, two regroupings pay for themselves and one dependency was
wrong:

1. **The torch belongs in M18, not later.** It has to be positioned through the same
   barrel mapping as the heat bands, or the beam points somewhere other than where it
   lands — the identical hazard M18 already documents for hit targets. Building it
   separately means solving that problem twice. Same canvas, same milestone.
2. **M18's semantic theme mode had a broken dependency.** It was specified to colour by
   themes from the digest — but the digest's themes are currently bare labels, and the
   thematic layer that makes them meaningful does not exist yet. Theme mode therefore
   **moves out of M18** into the digest-depth milestone that produces its data. This makes
   M18 smaller even after adding the torch.
3. **All three provider pickers land together** in the settings milestone, which is where
   the profile/role data model lives anyway.

**Numbering:** new work lands as **M19.5** and **M19.8**, not by renumbering M20–M23. This
follows the rule set on 2026-07-28 after three renumbers — decimals absorb insertions
without invalidating references across five documents. Two decimals in a row is slightly
inelegant; five documents of stale cross-references is worse.

### The refactor (M19.8)

Requested, and scoped to two targets with measurements behind them: `ReaderView.tsx`
(**1,839 lines, 64 hook calls**, having absorbed something in every milestone since M10)
and the four-way expression of position (CFI / spineIndex / percent / char offsets).
Placed **immediately before M20's paper fold**, the riskiest planned surgery on exactly
that component — pay once, then let the hardest change land in a structure that can hold
it. Method, safety net, and success metrics are written up in **`docs/REFACTORING.md`**,
which also answers the general question of how this is done and how you know it worked.
The rule that matters most: **a refactor changes structure and nothing else** — if you can
see a difference in the app, it wasn't one.

## 2026-07-29 — Performance: measured, and the leading suspect isn't M17

Operator reported the app becoming slow and unreliable after M17 shipped — library
emptying, settings taking 15–20s where it was instant, books often not loading, the scan
loading more reliably than the reader — while noting (and dismissing) that they are
working over an `ssh -L` tunnel ~20km from the machine.

**Measured on the rig itself, against the running dev server:**

| What | Result |
|---|---|
| `GET /api/health` | 0.8 ms |
| `GET /api/settings` | **0.5 ms** (3 consecutive runs, 0.48–0.56 ms) |
| `GET /api/resources` | 0.8 ms |
| Dev-mode module graph for one page load | **104 requests, 4.7 MB** |
| Production build of the same app | **22 files, 1.08 MB raw / ~305 KB gzipped**, code-split per route |

**The server is not slow.** A settings request that the operator experiences as 15–20
seconds completes in half a millisecond locally, and the M17 code review supports that:
the new tables are indexed, `GET /api/settings` is a plain synchronous row read, and
nothing was added to the library or resource hot paths (`library/store.ts`'s diff is
reading-position columns only).

**The leading explanation is transport plus dev-mode module serving.** Vite in dev serves
every source module as its own HTTP request — 104 of them, 4.7 MB, growing with every
milestone (M17 added ~15 modules). An `ssh -L` tunnel multiplexes all of that onto a
single TCP connection, so browser request parallelism buys much less than usual and
SSH's own per-channel flow control becomes the bottleneck. The same app **built** is 22
files and ~305 KB gzipped, of which one page loads a subset: roughly **15× fewer round
trips and 15× less transfer**. That ratio is the right order of magnitude to turn ~1
second into ~15–20. It also explains the two things that looked mysterious: "the scan
loads, the reader rarely" (the reader additionally pulls the whole EPUB and the large
epub.js dependency through the same pipe), and "it has got worse over versions" (the dev
module graph grows every milestone, while nothing about the server did).

**The fix already exists and is not being used.** `server/src/index.ts` already serves
`web/dist` — but only when `NODE_ENV=production`, and there is no script that runs it
that way. Remote sessions should be served the built app, not Vite dev.

⚠️ **What this diagnosis does *not* cover, and must not be assumed away.** The
measurements above were taken locally, on an idle server, with `curl` — they prove the
API is fast; they do not prove the *app* is. Still open, and to be measured rather than
reasoned about in M17.5:

- **Client-side render cost.** M17 touched `ThreadPanel`, `ScanPage`, `ReaderView`, and
  added the ladder/spotlight components. A re-render storm would be invisible to a
  `curl` timing.
- **Behaviour during and after a digest run.** `claudeAgent.ts` now retains `lastQuery`
  so `planLimits()` has a live control channel. On the subscription path each query is a
  spawned CLI subprocess; a retained query may be a retained subprocess, and a digest is
  one call per chapter. Plausible, unproven, and cheap to check by watching process
  count during a run.
- **A stray second Vite.** Two Vite dev servers were found listening (5173 and 5174),
  only one of which belongs to the running `pnpm dev`. If the tunnel points at the stale
  one, that is its own class of confusion.

**Rule this establishes:** *measure before optimising, and measure the layer you're
blaming.* The operator's instinct was that new code made the app slow; the new code
answers in half a millisecond. Had M17.5 begun by optimising server queries it would
have spent a milestone making a 0.5 ms path faster.

**Milestone numbering:** this lands as **M17.5**, deliberately not by renumbering
everything downstream. The 2026-07-28 entry committed to "prefer appending; reorder only
when the dependency is real" after three renumbers — an urgent unplanned insertion is
exactly the case a decimal handles without invalidating references in five documents.

## 2026-07-29 — Future UI directions (documented, not scheduled)

Three operator ideas, recorded with their real constraints so the shape is settled
before anyone starts. None are milestones.

- **The spotlight becomes a literal torch.** A cartoon flashlight beam on the scan,
  aimed by click-drag along the timeline (the `%` dial's gesture, which is already the
  established "drag to scrub" idiom in this app), with up/down controlling beam width —
  the iOS 18 flashlight gesture. Constraints that don't change: the beam is a *range
  picker*, so however it looks it must still resolve to **whole chapters** (M17's
  storage unit), and the numeric range readout stays the canonical keyboard path — the
  torch is the charm, not the gate. One trap: a torch drawn inside M18's barrel-warped
  base layer must be positioned through the **same barrel mapping** as the heat bands,
  or the beam will point somewhere other than where it lands — the identical hazard M18
  already documents for hit targets.
- **A scrolling manuscript mode.** ⚠️ This reopens a settled decision — PRODUCT.md
  records "pagination vs scroll: **pagination won** (shipped in M2, feel confirmed)" —
  so it is a deliberate re-opening, not an addition. The real cost is not the scrolling:
  it is that **every reader effect built since M10 assumes pages**. The snapshot page
  turn, the drag-to-peel, the M20 fold, M11's turn zones, M12's spread, and M14's
  margin-vs-gutter model are all page-shaped. A scroll mode is therefore a **second
  reading mode with its own affordances**, not a toggle on the existing one — highlights
  and anchoring carry over unchanged (they are CFI/text-based, not page-based), almost
  nothing else does. epub.js offers `flow: "scrolled-doc"` per section; genuinely
  continuous cross-chapter scrolling is a different manager and is the flakier path.
  Decide *which* of those two before building, because they are different products.
- **A speed reader (RSVP), framed as an accessibility feature.** Words or short chunks
  presented at a set rate. Two architectural notes worth fixing now: it must **reuse
  M21's sentence/word segmenter** (`server/src/audio/segment.ts`) rather than growing a
  second text-chunking implementation — they are the same problem, and the audio one
  already returns char offsets that map back to the page; and position must save through
  the existing reading-position path, like audio, so switching between reading, listening
  and speed-reading never loses your place. Design requirements that come with the
  framing: pause-to-annotate (you cannot highlight mid-RSVP, so the control must be
  instant), rewind by sentence, a wide speed range, and — since RSVP suits some readers
  and actively harms others — a lower-intensity alternative in the same feature, such as
  a moving line-guide or bionic-style emphasis. "Lines per minute" is really a
  teleprompter, which depends on the scrolling mode above; treat it as a second mode of
  this feature, gated on that decision.

## 2026-07-28 (later) — The digest in detail: chunking, the spotlight, the context ladder, usage accounting

Follow-up to the v1.8 entry below, answering four operator questions about M17: how the
digest survives context limits, how it survives rate limits, whether a *region* of a
book can be digested, and whether usage/limits can be monitored in settings. This
supersedes the M17 sketch in the v1.8 entry wherever they differ.

### The chapter is the unit of everything

The single decision that makes the rest easy: **digests are stored per chapter**
(`resource_id` + `spine_index`), never as one blob per book. Consequences, all of which
fall out for free rather than needing their own machinery:

- **Context limits** — a chapter always fits; a book may not. The digest is a
  **map-reduce**: one *map* call per chapter producing that chapter's summary, local
  themes, and characters seen; one *reduce* call over the chapter summaries producing
  the synopsis, cast, and book-level theme set. The digest never depends on the whole
  book fitting in the window, which is the failure the whole-book approach would have
  hit on any real novel.
- **Incremental scanning** — "digest chapters 1–8 now, 9–16 later" is just writing more
  chapter rows. **Append, overlap, and merge stop being problems**: re-digesting a
  chapter replaces that chapter's row, so a re-scan is idempotent by construction and
  overlapping ranges cannot produce duplicated or contradictory text.
- **Coverage is queryable** — which chapters have rows *is* the coverage map. The scan
  timeline underlays it; the digest page marks gaps ("not yet digested: chapters 9–12");
  a question can be told honestly that its chapter isn't covered.
- **Resumability** — see rate limits below. A 40-chapter run that dies at 38 resumes at
  38, because 37 rows are already committed.

Chunking rules: cap each map call's input at ~25% of `capabilities().contextTokens` so
instructions and output have room; split an over-long chapter at paragraph boundaries
with a small overlap; on `LLMError('context_too_large')` re-split once automatically,
then mark that chapter failed and **continue the run** rather than aborting it. If the
reduce input itself exceeds budget (a book with 200 chapters), reduce hierarchically in
batches. The reduce regenerates from *all* currently available chapter rows on every
run, so the book-level summary is always consistent with its parts.

### Rate limits (hosted providers only)

- **Sequential by default**, never a parallel blast. Concurrency is a setting and stays
  at 1 for the subscription path.
- A rate-limit error is a **paused state, not a failure**: back off with jitter, honour
  `Retry-After` / `resets_at` where the provider gives one, show "Rate limited —
  resuming at 14:32", resume automatically, allow manual cancel. Completed chapters are
  never lost or re-paid for.
- **Pre-flight before committing**: show the range's chapter count, estimated tokens and
  call count, and — when the provider reports it — current plan utilization, so a run
  that would burn the rest of a weekly window is a visible choice rather than a
  surprise. A token-budget ceiling setting stops a run that exceeds it.
- Local models have no quotas; the same machinery just never trips.

### The spotlight

- **It exists only when initiating a digest** — it is a range picker for "how much of
  the book to digest right now", not a persistent context-scoping mode.
- It lives on the scan's existing 0–100% axis (with M18's zoom/pan), snapping to chapter
  boundaries by default because chapters are the storage unit; free-drag with a modifier
  resolves to the chapters it touches.
- ⚠️ **"Pages 1–50" has no stable meaning in an EPUB** — reflowable text has no page
  numbers, and epub.js's page-ish counts exist only inside the reader at one specific
  font size and window width, so they'd change under M16's own text-size setting. The
  spotlight readout is **chapters and percent**, with approximate page numbers shown
  only where they're actually available. Say this in the UI rather than showing a page
  number that lies.
- Digested regions render as a coverage line on the scan timeline.
- A reader-side shortcut ("digest this chapter") creates the same thing without visiting
  the scan.

### The markdown is a projection, not the source of truth

The digest must be user-readable markdown, in a page reachable from the desk alongside
the scan. **SQLite stays the source of truth**; the markdown is a deterministically
regenerated projection at `data/digests/<resourceId>.md`, assembled in book order with
gaps marked — exactly the pattern the vault compiler already uses, and for the same
reason settled decision 6 gives: we never parse it back. Hand-edits are overwritten on
the next run, and the UI must say so rather than implying a round trip. Publishing the
digest into the vault remains a legal later option; it is not this milestone.

### The context ladder (the brain button)

The operator's framing was a toggle that *adds* the digest to context. Worth stating
plainly because it inverts the goal: **a digest added on top costs more tokens, not
fewer** — it's small next to a whole book. The saving comes from letting it *replace*
the book. So the control is a three-level depth, not a switch:

| Level | Sends | For |
|---|---|---|
| **Off** | passage + surrounding pages | cheapest; tightly local questions |
| **Digest** | digest of the covering chapters + surrounding pages | the default once a digest exists — best answers per token |
| **Full** | the whole book (today's behaviour) | maximum fidelity, maximum cost |

Remembered per book. **Default becomes Digest once a book has one**, Full otherwise —
this is the change that actually cuts subscription burn on long books. Two rules that
keep it honest: only chapters with digest rows contribute, and if the highlight's own
chapter isn't covered the UI says so rather than silently answering from less; and every
answer records the depth used and which chapter digests fed it, surfaced in the thread.
Transparency is not optional here — an answer grounded in 12% of a book that doesn't say
so just looks like the model got worse.

### Usage accounting

**Local accounting is the source of truth and must work for every provider, including
local models with no reporting at all.** A `llm_usage` ledger row per call — provider,
model, operation (thread / extract / digest / cast), tokens, cost if known, duration —
written from one place in the seam so no call site can forget.

Every number carries its **provenance**, and the UI shows which:

- **reported** — the provider returned real counts. `claude-agent` gets `usage` and
  `total_cost_usd` on every result message (stable API, already iterated in
  `claudeAgent.ts`); the Anthropic path gets usage from stream events plus
  `anthropic-ratelimit-*` response headers; `openaiCompat` gets it via `stream_options:
  {include_usage: true}` where the endpoint honours it (OpenAI, OpenRouter, recent
  Ollama/LM Studio do; not guaranteed).
- **measured** — we tokenized locally with a real tokenizer.
- **estimated** — the existing `CHARS_PER_TOKEN = 3.5` heuristic, which is ±30% and must
  **never be presented as a measurement**.

Context-window usage works everywhere: tokens (by whichever tier) over the window size,
which for local models is the `openaiContextTokens` setting the user already configures.
So a digest run shows "context 78K / 200K (39%)" on a local model exactly as it does on
Claude — the only thing local models lack is a quota, and the quota UI simply doesn't
render for them.

**Plan limits are opportunistic.** The Claude Agent SDK does expose real 5-hour / 7-day
/ per-model utilization with reset times — but via
`usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`, whose name is a contract:
unstable, removable without notice. Use it **feature-detected and non-fatal** — behind a
capability check, wrapped, never on a hot path, and if it's missing, throws, or changes
shape the panel reads "plan limits unavailable" while everything else keeps working. The
SDK's own `rate_limits_available: false` (API key, Bedrock, Vertex) is a legitimate
"unavailable", not an error.

**Seam impact:** `LLMProvider` gains **optional** members only (`reportedUsage?`,
`planLimits?`). Optional keeps every existing implementation valid and encodes "not all
providers can do this" in the type system rather than in comments.

### Web search → its own milestone (M23)

Deliberately scoped out of M17, which ships the toggle row with the web control present
but inert. It splits three ways — the Agent SDK has a built-in WebSearch tool (but we
run `tools: []` on purpose), the Anthropic API has a server-side web tool, and local
endpoints have nothing, so they need us to call a search API (Brave/Tavily, or a local
SearXNG) ourselves — which means it needs its own seam, not a flag. It is also a
**second cloud dependency**, which amends CLAUDE.md's "no cloud dependencies except the
LLM endpoint itself": permitted, per-provider, off by default, and never silently on.

## 2026-07-28 — v1.8: scan instrument v2, the book digest, QOL & bug fixes

Operator feedback after using the shipped M14/M15. Same contract as the last two
passes: notes become buildable rules here so the milestones don't re-derive them.

**Renumbering (again — the last time; see the note at the end).** The new work lands as
**M16–M19**, and the two milestones already written shift down: the paper fold is now
**M20** (was M16), audio is **M21/M22** (was M17/M18). Contents unchanged. The fold
stays late on the standing rule from the v1.6 pass — the hardest single effect ships
last so a stall there blocks nothing — and it is now behind four smaller milestones
rather than one. That is a judgment call, not a discovery: moving it earlier is a
one-block edit if daily reading wants it sooner.

### The scan's instrument face

- **VHS is visual only.** Tracking lines that drift, chroma noise, and occasional
  signal wobble — the *look* of a worn tape. **No audio.** DESIGN.md's "no sound in
  v1.5" holds and sound design stays parked; "a slight buzz" is a visual buzz.
- **The warp is tiered by z-hierarchy, not by content type.** This amends — does not
  delete — the 2026-07-20 rule ("CRT distortion applies to the graphics layer only,
  never the mono readouts or the revisit queue"). The new rule: **everything sitting on
  the base scan screen warps together as one surface** — strip, heat field, chapter
  axis, readouts, revisit queue — because a face that bows in some places and not
  others reads as broken, not as glass. Coherency is the whole point. **Things that
  float above the glass — hover ghost readouts, popovers, tooltips, modals — do not
  warp**; they are in front of the screen, not on it. Legibility survives as a *bounded*
  constraint rather than a veto: the base layer's displacement is gentle enough that
  mono readouts stay readable at their smallest size, contrast still passes, intensity
  is a setting that reaches zero, and reduced motion disables warp and fringing outright.
- **One filter on one container.** The warp must be a single SVG filter on a single
  wrapper containing the whole base layer. Filtering each piece separately makes each
  piece bow around its own centre and the parts stop lining up — that is precisely the
  incoherence this rule exists to prevent.
- **Floating layers must be portalled out of the warped container.** Not optional: a
  CSS `filter` on an ancestor creates a containing block, which breaks `position: fixed`
  descendants — so popovers rendered *inside* the warped wrapper would both inherit the
  warp and mis-position. Render them as siblings of the wrapper.
- ⚠️ **Warp displaces pixels, not hit targets.** An element under `filter:
  url(#barrel)` still hit-tests at its *unwarped* geometry: near the corners, where
  displacement is strongest, a heat band is clicked where it *was*, not where it looks.
  This is the single most likely bug in the milestone and it will read as "the scan
  feels broken" rather than as a warp problem. The strip's hit targets are 1-D positions
  along x, so the fix is cheap and exact: **position the invisible hit-target bands
  through the same barrel function** that displaces the graphics, instead of at their
  raw x. Verify by clicking a band near a corner, not near the centre.
- **Heat is coloured by meaning again.** M15's field mapped *density* through a fixed
  cool→hot ramp, which lost the thing M9's discrete bands had: you could see at a glance
  what kind of annotation a hot spot was. Restore it with two channels — **hue carries
  the category** (highlight kind, or theme in semantic mode), **luminance/alpha carries
  density**. Implementation: accumulate one density layer per category, then per pixel
  take the summed density for brightness and the dominant category for hue. Keep the
  cool→hot ramp available as a third "density only" mode; it is genuinely better for
  answering "where did I annotate most", just not for "what's what".
- **Two scan modes, one strip.** **By kind** (today's four highlight colours) and **by
  theme** (semantic). Themes come from the book digest below, not from vault concepts —
  the reason M9 rejected concept filtering still stands: concepts only exist for
  *published* threads, so a concept-driven view would be mostly empty. Switching modes
  re-colours the same field and the same hit targets; it is a palette swap, not a
  second component.
- **Tighter bleed and a zoom.** Both, not either: reduce the blob radii (M15's `26 +
  weight*44` px is wide enough that neighbours merge into an unreadable smear) *and* add
  zoom + pan to the strip so dense regions can be opened up and clicked accurately.
  Zoom is a viewport transform over the same 0–100% domain — hit targets, filters, and
  the airlock jump all keep working unchanged, and the barrel mapping above composes
  with it.

### AI answer quality — and a correction

- **The premise was wrong, and it matters.** The LLM is *not* sent only the highlighted
  quote. Since M4 it receives the **whole book** — or the largest window of spine
  sections that fits the provider's context budget, centred on the highlight
  (`llm/context.ts`, settled decision 8). Any fix aimed at "give it the book" would have
  been building something that already exists. What is actually missing is narrower and
  more interesting:
  - **Sections are unlabelled.** Context renders them as `--- [section 4] ---`, so the
    model cannot say "in Chapter II" or reason about structure. Label sections with real
    TOC titles — cheap, and it improves every answer.
  - **The model doesn't know where you are.** It gets the whole book including the
    ending, and no signal about your reading position — so it can and does spoil. Ship
    the reading position with the question and instruct: *do not reveal what happens
    after the reader's current position unless they ask.* This is the highest-value
    change in this milestone and it costs almost nothing.
  - **Long books silently degrade.** Past the budget, `selectWindow` quietly drops
    distant sections; nothing tells the reader their question is being answered against
    a slice. Surface it, and use the digest to compensate.
- **The book digest is the answer to "a book scanner".** A user-triggered scan produces
  a compact per-book digest — synopsis, cast, themes, per-chapter summaries — stored in
  **SQLite** and prepended to the book context on every question. It solves three things
  at once and must therefore be built once, as shared infrastructure: it grounds answers
  (especially for books too long to send whole), it supplies the **themes** the semantic
  scan colours by, and it *is* pass 1 of the audio cast scan (M22). Do not build a
  second scanner for casting.
- **The vault stays one-way.** The digest lives in SQLite, not the vault, and the LLM
  still never reads the vault, other books, or the filesystem (PRODUCT.md). The
  operator considered cross-book memory and did not take it — it would make the same
  question give different answers as the vault drifts. Publishing the digest *into* the
  vault as part of `_Book.md` remains available later; that direction is already legal.
- **Max response length is a setting** — with an honest asymmetry to document: the
  Anthropic and openaiCompat paths take `max_tokens` directly (today's hardcoded
  `THREAD_MAX_TOKENS = 8192` becomes the setting's default), but the Claude Agent SDK
  exposes no such knob, so on the `claude-agent` provider the limit can only be
  expressed as an instruction in the system prompt. Do not pretend it is enforced there.

### Reading QOL

- **Text size is a setting, and it feeds the measure calculation.** A font-size scale
  applied through the epub theme. It is not independent of margins: `computeReaderGap`'s
  `READER_TARGET_COLUMN_WIDTH = 520` is "~70ch **at 16px**" — that comment stops being
  true the moment text scales, so the target column width must be derived from the
  current font size, or the measure silently drifts out of the 60–75ch range.
- **The margin must be the same colour as the page** — a confirmed, exact defect, not a
  preference: `.stage` paints `--color-bg-raised` while the epub body paints
  `--color-bg` (`useEpubThemeVars`), so the margin band is a different tone from the
  sheet in *every* theme. Fix by making one token the source of truth for both, so they
  cannot drift apart again — not by hand-matching two values.
- **Highlights respond to the cursor.** Hovering a mark pops it to its full kind colour.
  Must respect focus mode (a hidden mark stays hidden on hover).
  > **Corrected 2026-07-28, after M16 shipped.** This bullet originally prescribed a
  > plain CSS `:hover` rule, reasoning that the marks-pane SVG lives in the parent
  > document so an app stylesheet can reach it. That reasoning had a hole, found and
  > proven during implementation (NOTES.md, "M16"): the marks-pane root carries
  > `pointer-events="none"` as a **load-bearing** attribute — removing it lets the
  > overlay intercept mousedown over highlighted text and kills native text selection
  > there, the exact regression this task's own acceptance criteria guard against.
  > `pointer-events` inherits and is never re-declared on the marks, so hit-testing
  > skips them entirely and `:hover` cannot fire. Shipped instead by extending the
  > existing forwarded-mousemove handler. Recorded rather than silently rewritten: the
  > mistake was asserting a mechanism from reading rather than probing it.

### Settings as a binder

Settings becomes a **book/binder**: tabbed dividers down the side — Reading, LLM, Scan,
Audio, Desk — with a page-turn animation between them, inside the existing modal shell
from M11 (dialog semantics, focus trap, Escape, deep link all stay). Two constraints:
the divider list is the a11y path (real tablist/tabpanel semantics, arrow-key
navigation, never divs), and the page-turn animation collapses to an instant swap under
reduced motion. The goal is stated plainly so it can be judged: **settings should be
pleasant to open**, not merely correct.

### Bugs

- **The `%` control eats the arrow keys.** After a pointer drag the button keeps DOM
  focus, and its `onKeyDown` handler calls `stopPropagation()`, so ←/→ step the dial by
  1% instead of turning pages until you click elsewhere. Do **not** fix this by removing
  arrow support — M12's acceptance criteria require a keyboard path to the dial, and
  deleting it would trade one defect for a regression. Fix: a gesture that began with a
  *pointer* releases focus on commit/cancel (blur), so arrows return to page turns;
  arrow-stepping stays available when the control is focused by keyboard.
- **Margin changes don't reach the page until you leave and come back.** The wrapper
  padding updates live (you see the border move) but the epub-side gap, column layout,
  and spine positioning keep their old values until `ReaderView` remounts. Cause is
  *not* yet established, and must not be guessed at in the fix: the two candidates are
  (a) the `ResizeObserver` on `containerRef` not firing for a padding-driven width
  change, and (b) `manager.updateLayout()` not re-running `Contents.columns()` for an
  already-rendered section. Diagnose by instrumenting `handleContainerResize` and
  reading the iframe body's computed `column-gap`/`padding` before and after. Known-good
  fallback if the layout path resists: re-`display()` the current CFI after the gap
  change — that is what a remount does, and it demonstrably works.

**A note on renumbering.** Three passes have now shifted milestone numbers. That is the
cost of a strictly-ordered list, and it is paid in confusion every time. From here,
prefer appending new milestones and reordering only when the dependency is real (the
digest genuinely must precede the semantic scan and audio casting; that is why this one
was worth it).

## 2026-07-27 — v1.7: reading-surface revisions, audio mode, future arcs

Operator feedback after living with v1.6 (M11–M13 shipped; M14/M15 were written but
not started). Same contract as the 2026-07-20 entry: each subjective note becomes a
buildable rule so the implementation milestones don't re-derive them.

**Renumbering.** The revisions below become **M14** and everything already written
shifts down: the Scan instrument is now **M15** (was M14), the paper fold is now
**M16** (was M15). Content of both is unchanged. Audio lands as **M17–M18**. Ordering
rationale is the same as v1.6's: cheap fixes that improve every reading session ship
first; the hardest single effect (the fold) stays late so a stall there blocks nothing;
audio is a whole new subsystem and goes last so it can't hold the visual work hostage.

### Reading surface

- **Page margins are a setting, and the outer margin is not the spine gutter.** Text
  runs too close to the pane edge, worst in spread mode. Root cause is known and
  specific: M11 established that epub.js discards theme-set body padding and the only
  lever is the `gap` render option, but epub.js derives *both* the outer edge padding
  (`gap/2` each side) and the inter-leaf column gap from that one number — so M12's
  `SPREAD_GUTTER = 64` buys a 64px book-spine gutter at the cost of only 32px of outer
  margin. The fix is to stop asking `gap` to do both jobs: **outer margin becomes a
  padded wrapper around the element epub.js renders into** (the container it measures
  must itself stay padding-free — epub.js sizes the stage from that element), leaving
  `gap` to mean only "gutter between leaves". Margin width becomes a persisted setting
  (`readerMargin`: narrow | normal | wide | generous) applied on both axes, live, with
  the existing measure cap and the 240px column floor still enforced underneath.
- **The `%` readout moves to top centre, and the dial gets pointer lock.** Two separate
  problems were reported as one. (a) Position: the readout sits in `.rightControls`, so
  a forward (rightward) drag runs out of screen almost immediately. It moves to the
  centre of the top row — which needs `.topRow` restructured from `space-between` to a
  three-column grid (`1fr auto 1fr`) so the centre stays optically centred no matter how
  wide the annotations button and chapter nav get. (b) Range: at `DIAL_PX_PER_PERCENT =
  6` a full 0→100% sweep needs 600px of pointer travel, which no screen position can
  provide in both directions. The drag therefore requests **pointer lock** on start and
  accumulates `movementX` instead of reading `clientX - startX` — travel becomes
  unbounded in both directions, and the retro zoom-ring metaphor is exactly right for a
  control that spins forever. Absolute-delta math stays as the fallback when pointer
  lock is denied (it can reject, and some browsers gate it behind a user gesture chain).
- **Thread panels are sticky notes: movable, and the offset persists.** The panel
  becomes draggable by its header. The stored value is an **offset from its anchor**,
  never an absolute stage coordinate — the anchor moves every time you turn a page,
  resize, or change the margin setting, so absolute coords would rot exactly the way
  M8's shelf positions would have if they'd been stored in screen space. Persisted
  per-highlight (additive migration, `highlights.panel_dx` / `panel_dy`), clamped back
  into the stage on restore. This is the same precedent M8 set for books on the desk:
  where you put a thing is data about that thing. The sticky-note *look* (a warmer
  paper tone than the panel chrome, a deterministic 0.5–1.5° tilt derived from the
  highlight id so it never jitters between renders, the existing kind-tinted folded
  corner, a lifted shadow while dragging) is part of the same task — "movable" and
  "looks like a sticky note" are one change, not two.
- **The crease bars go.** `ThreadPanel.module.css`'s `.creases` — two 22%-black bars at
  33% and 66% — reads as ruled lines across the note, and it never did what its own
  comment claims ("flash across the panel in sync with the unfold"): it is a static
  element rendered for the panel's whole lifetime. Delete the element and the rule. The
  "two-crease origami" DESIGN.md asks for survives in the unfold keyframes
  (`scaleY: [0.06, 0.55, 1]` through a visible half-open step), which is where the fold
  reading actually comes from. The paper grain and the folded corner stay — they carry
  the sticky-note material and were not what was objected to.
- **Fullscreen is a mode, and it is orthogonal to focus mode.** They are separately
  toggleable and combinable, because they hide different things: focus mode (`f`) hides
  *your annotations* (marks, rail dots, tabs); fullscreen (`shift+F`) hides *the app's
  chrome* (top row, footer, rail) and lets the page grow into the space. Chrome in
  fullscreen becomes proximity-revealed floating panels at the edge each control
  normally occupies — top-left annotations, top-centre the `%` dial, top-right chapter
  nav, bottom the page arrows, right edge the margin rail — fading in when the pointer
  comes within a reveal band and out again when it leaves. Two constraints, both
  already learned the hard way: the reveal band on the left and right edges must not
  fight M11's turn-zone vignettes (chrome reveals from the **top and bottom** bands
  only; the right rail reveals from the top-right corner region), and nothing
  proximity-revealed may be an interactive overlay across the iframe — that kills text
  selection (2026-07-20 entry). Also request the browser Fullscreen API on the app root,
  degrading silently to in-page fullscreen if it's refused.

### Audio mode (M17–M18 — renumbered to M21–M22 on 2026-07-28)

The app learns to read a book aloud with a local TTS model, optionally casting distinct
voices for characters. Four operator decisions were taken 2026-07-27 and are settled:

- **Kokoro first, behind a `TTSEngine` seam.** Kokoro-82M (Apache-2.0, ONNX) is the
  first implementation because it is the only option that runs at usable speed on *both*
  machines — the Mac and the Linux box — which the two-machine setup makes a hard
  requirement, and it ships ~50 preset voices, which is exactly what a casting pass
  needs. Prefer the Node/onnxruntime path (`kokoro-js`) over a Python sidecar: no second
  toolchain, no per-machine Python divergence, consistent with "local-first, boring
  core". A more expressive GPU model (Chatterbox/Orpheus-class, Linux-only) is a second
  implementation behind the same seam later — the seam is what makes that a new file,
  not a new call site (CLAUDE.md engineering discipline).
- **Sync is sentence-level by construction, not timestamp-derived.** This is the audio
  equivalent of DESIGN.md's epub.js honesty note and it shapes the whole pipeline: do
  **not** build follow-along highlighting on per-word timings the engine may or may not
  expose. Synthesize **one audio segment per sentence**; then the mapping from playing
  audio to on-screen text is exact and free, because we know which sentence each segment
  *is*. Word-level highlighting is a stretch goal, attempted only if the engine gives
  reliable phoneme durations, and never a prerequisite.
- **Casting is two passes, and the model never returns offsets.** Pass 1 (whole book,
  one `extract` call through the existing context builder, user-initiated): the cast —
  names, aliases, gender/age cues, a one-line voice suggestion each. Pass 2 (per
  chapter, on demand, cached): attribute each quoted span to a cast member. In both
  passes the model returns **the quoted string**, and code locates it in the chapter
  text by exact search; a model asked to count characters will hallucinate offsets, and
  "LLM proposes, code disposes" (settled decision 2) already forbids trusting it with
  positions. Anything unmatched or unattributed falls back to the narrator voice — a
  wrong voice is worse than one voice, so ambiguity always resolves to the narrator.
  Voice assignment itself is code: the model proposes a description, code maps it onto
  the available voice pool, the user can override in the casting UI.
- **Audio drives the reader; it is not a fourth room.** Playback runs *in the book* —
  the current sentence takes a moving tint, pages turn themselves, reading position
  saves exactly as it does when reading with your eyes, and you can still select,
  highlight, and ask mid-listen (doing so pauses playback: you cannot read an answer
  while being talked at). A dedicated player surface would have been a fourth room and
  DESIGN.md has three; the transport controls instead live as reader chrome, and the
  desk gets the skeuomorphic *object* that turns listening on.
- **The desk tool is the entry point, and it is not the only one.** A tactile object on
  the desk (a deck/gramophone) toggles "listening mode"; while it is lit, opening a book
  opens it in audio mode. Per DESIGN.md's accessibility rule, the desk's list view is
  the canonical keyboard path, so a plain "Listen" action also lives in the book hover
  strip and the list — the tool is the charm, not the gate.
- **Rendered audio is content-addressed cache, not library data.** Segments live under
  `data/audio/<resourceHash>/<castHash>/…` with a manifest mapping sentence → file,
  duration, and char range. Keyed by cast+voice so re-casting invalidates cleanly, safe
  to delete at any time, gitignored like the rest of `data/`. Render **chapter-ahead on
  demand**, not whole-book-up-front: listening starts in seconds instead of minutes, and
  a book you abandon after a chapter costs one chapter of compute.
- **Page turns while listening use the slide, not the curl.** M10's snapshot curl costs
  a capture on every turn and audio must never stutter; the fast slide fallback already
  exists for exactly this class of reason. (Judgment call, flagged: revisit if a turn
  every ~30s feels cheap with the effect suppressed.)

### Future arcs (recorded, deliberately not scheduled)

Written down so the shape is decided before anyone starts, and so the real gate on each
is visible. None are milestones yet.

- **Drawing on pages.** The anchoring model is the whole problem and it is decided here:
  drawings anchor to a **spine section in that section's own flow coordinates**, never
  to a page. Pages do not exist as durable objects — font size, window width, the new
  margin setting, and spread mode all repaginate — so a page-anchored stroke is
  guaranteed to rot. Stored per section as simplified, quantized, gzipped SVG path data
  (one row per section that has drawings, fetched on section load exactly as highlights
  already are), which satisfies the efficiency ask directly: drawing on one page cannot
  grow the rest of the book's metadata. **Rejected:** rendering pages as images to draw
  on — it would destroy selection, highlighting, search, and reflow, i.e. the entire
  product. The overlay rides the columns the way the marks-pane already does. The real
  gate is not drawing, it is the iPad: the server binds to 127.0.0.1 by design (M6
  security fix) and reaching it from a tablet means LAN binding, pairing/auth, and
  probably a native shell for Apple Pencil pressure — PRODUCT.md lists multi-device as
  explicitly out of scope. Treat "draw with a pointer on the desktop" and "draw with a
  Pencil on an iPad" as two different projects; the first is buildable today, the second
  is a v3 arc that starts by undoing a deliberate security decision.
- **Notebook chat.** Directly contradicts a standing discipline: "the highlight is the
  prompt — no free-floating chat box". The framing that preserves it: **the notepad is
  the prompt.** A chat scoped to the notepad's own contents (plus, optionally, the book
  open behind it) is anchored to a thing the reader wrote, which is the same contract
  threads have. Build it that way or overturn the rule deliberately — not by drift.
- **The evidence board.** Corkboard, pins, physics ropes, tabs. Two rulings: (a) it is
  **an extension of the Desk, not a fourth room** — the board hangs on the wall above
  the desk, which keeps "three rooms, one building" intact and gives the transition an
  obvious doorway; (b) it is **a view over data that already exists**, not a new data
  model — nodes are concepts (from the vault compiler), highlights, books, and notepad
  fragments; edges are the concept links code already computes at distill time. A
  freeform board with no data behind it would be a drawing toy that encodes nothing,
  which DESIGN.md's anti-goals rule out. Rope physics is verlet integration on canvas
  2D — no engine, no WebGL, consistent with the fold's precedent.

## 2026-07-20 — v1.6 feedback pass: design translations

Operator feedback after living with v1.5 on the Mac. Recorded here as *design
decisions* so the implementation milestones (M11–M15 in TASKS.md) don't re-decide
them. Each item below translates a subjective note into a buildable rule.

- **The curl is a fold, not a hinge.** Today's `PageCurl` rotates the departing
  page's bitmap rigidly about the spine (`rotateY` up to 108° at `transformOrigin
  100%/50%`) — a swinging door. Apple Books deforms the sheet: the corner nearest
  the pointer lifts and the paper folds about the **perpendicular bisector of the
  line from the grabbed corner to the pointer**, with the back of the sheet visible
  (mirrored, dimmed) and the page beneath revealed through the gap. That bisector
  model — not a full cylindrical mesh — is the target: it is what Apple Books
  actually does geometrically, and it is expressible in **canvas 2D** (clip to the
  fold half-plane, draw the mirrored texture through a reflection matrix, round the
  crease with a short gradient) with **no three.js**. DESIGN.md's "no WebGL until a
  named effect needs it" therefore still holds — the named effect was the curl, and
  the 2D fold discharges it. Per-frame canvas redraw is the one sanctioned
  exception to "animate transform/opacity only"; budget is one canvas, ≤60fps,
  redraw only while a fold is live.
- **Grab anywhere, not a strip.** The 18px `edgeGrab` strips become the outer
  **semicircular zones** (below) — the whole outer band of the page is grabbable,
  and the fold anchors to whichever corner is nearest the grab point. This is what
  "the nearest part of the page gets dragged along" means operationally.
- **Turn zones are semicircular and announce themselves.** The existing invisible
  30%/70% click zones (`ReaderView.tsx` ~L483) keep their hit-testing logic but gain
  (a) a semicircular shape via `clip-path: ellipse()`, (b) a directional cursor, and
  (c) a soft vignette that fades in on hover. Constraint discovered while specifying:
  a parent-document overlay cannot own this, because anything with `pointer-events`
  over the iframe kills text selection — the *cursor* is set by writing
  `contents.document.body.style.cursor` from the pointermove handler that already
  computes `visibleX`, and the vignette is a `pointer-events: none` sibling. The
  reader's "no ambient effects" law is respected: the vignette only exists while the
  pointer is inside a turn zone.
- **Two-page spread peels the near leaf only.** `spread: "auto"` renders both pages
  as columns in one epub.js iframe, so the fold must be **leaf-relative**: the fold
  canvas is sized and positioned to one half of the stage, not the whole stage.
  Spread is a persisted per-user setting with a single-page fallback below a minimum
  width.
- **The `%` readout is an instrument, not a label.** Click = the existing popover;
  click-and-**drag** = a retro-camera scrub dial (ticks, chapter marks, live preview
  readout) that commits the jump on release. epub.js `book.locations` already
  backs this — `cfiFromPercentage()` is the seam; the readout at
  `ReaderView.tsx` L883 is the anchor.
- **Notes are a first-class column, not a thread message.** Additive migration adds
  `highlights.note`. Rationale: the vault compiler distils *threads* into concept
  notes (settled decision 7); a personal note is not a transcript and must not be
  swept into that pipeline, so it needs to be separable at the schema level, not by
  role-flag heuristics.
- **Settings is a modal, not a room.** The three-room model (DESIGN.md) has exactly
  three rooms; settings was never one of them, and a full-page route breaks the
  reading context to change a model name. It becomes an overlay over the current
  page. `/settings` keeps working as a deep link (renders the modal over the desk).
- **The scan is an instrument panel, so it fills the glass.** `max-width: 1100px`
  centred in the viewport reads as a web page, not an instrument
  (`ScanPage.module.css` L24–25). The scan fills the viewport; the strip grows to
  take the slack.
- **CRT distortion applies to the graphics layer only.** Barrel warp
  (`feDisplacementMap` driven by a radial gradient), bloom/fuzz on the strokes, and
  chromatic fringing wrap **the strip and its heat graphics** — never the mono
  readouts, labels, or the revisit queue. DESIGN.md's legibility rule ("glow is an
  accent on a dark neutral, not text-on-noise", contrast still passes) is binding and
  outranks the effect; warping body text would violate it. Intensity is a setting,
  and reduced-motion disables warp and fringing outright.
- **Heat is a continuous field.** Discrete bands are replaced by a summed-gaussian
  density field on canvas with a cool→hot colour ramp, so clusters bleed into one
  another with no discrete markings. The bands survive underneath as invisible
  hit-targets — hover/click/filter behaviour and the airlock jump are unchanged.
- **The desk hover jump is a real bug with a known cause** (not a tuning problem):
  `BookObject.tsx` binds the shelf position to a motion value (`style={{ x, y }}`)
  and *also* animates the same `y` in `whileHover={{ y: -4 }}`. `whileHover`'s `-4`
  is absolute, not relative, so hovering a book resting at `y: 340` animates it to
  `y: -4` — a 344px leap, and the further you drag a book from the origin the worse
  it gets, exactly as reported. The lift must move a **different element** (an inner
  wrapper) so it can never fight the drag-owned motion value.

## 2026-07-19 — Checkpoint executed: `claude-agent` subscription provider
- **Subscription-first billing.** The operator wants Claude usage billed to
  their Pro/Max subscription, not per-token API keys; API keys become the
  fallback only if subscription limits are hit. This activates the deferred
  `claudeAgent` provider from the 2026-07-17 provider-strategy entry.
- **Implementation:** third `LLMProvider` — `claude-agent` (`llm/claudeAgent.ts`)
  — via `@anthropic-ai/claude-agent-sdk`. `tools: []` (pure text/JSON — "LLM
  proposes, code disposes" holds), `settingSources: []`, `maxTurns: 1` for
  streams, native `outputFormat: json_schema` for extract, ANTHROPIC_API_KEY
  stripped from the subprocess env so billing can't silently switch to the API.
  Auth is the machine's Claude Code login (`claude /login` or
  `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`) — no secret stored in
  Marginalia. Default model `claude-sonnet-5` (subscription-friendly;
  changeable in Settings, accepts any model id/alias incl. `[1m]` variants).
- Thread history is rendered as a labeled transcript (the Agent SDK takes one
  prompt string, not role-structured messages) — acceptable for short Q&A
  threads; revisit only if follow-up fidelity suffers.
- Settings GUI provider picker is now a three-way swap: Claude (subscription) /
  Anthropic API key / OpenAI-compatible. Test-connection supports all three.
- **Live-verified 2026-07-19** (stream + extract against real fixtures, zero
  operator setup — existing Claude Code login was picked up). Bug caught live:
  zod v4 `toJSONSchema` emits a 2020-12 `$schema` marker the CLI's draft-07
  validator rejects — fixed with `{target: "draft-7"}` + marker strip,
  regression-tested.
- ChatGPT-subscription OAuth: still nothing to build (per 2026-07-17 — no
  usable endpoint; would enter through `openaiCompat` if one appears).

## 2026-07-19 — Highlight kinds, user tags, and the M7→M8 checkpoint
- **Highlight kinds (colors) land in M7.** Four semantic kinds chosen at capture time:
  **rose** = passage to revisit / general annotation; **sage** = definition of a new
  word or phrase; **honey** = important quote; **slate** = a question about the text
  (the kind most likely to open a thread). Additive migration `highlights.kind`;
  backfill existing rows: has a thread → slate, else rose. The selection pill grows
  four kind dots + Ask; Ask without an explicit pick defaults to slate. Kinds are
  labels, not behavior — any kind can host a thread. Colors are muted, theme-aware
  washes that sit inside the paper/ink aesthetic (reference hues in DESIGN.md),
  explicitly not saturated marker defaults.
- **User tags on highlights land in M9** (additive `highlight_tags` table; tag editing
  from the reader thread panel and the scan). Scan filtering = kind + tags + free
  text. The vault-concept filter originally sketched for M9 is dropped from the
  milestone: concepts aren't persisted in SQLite and only exist for *published*
  threads, so they're the wrong v1.5 filter axis.
- **Post-v1.5 refinement (recorded, not scheduled):** an LLM pass that reviews
  highlight notes/tags and supplements them inline — proposing concept tags
  (persisted in SQLite) and fleshing out notes so concept-level search works across
  the library. Same "LLM proposes, code disposes" contract. Do not build during
  M7–M10; refine after the rooms exist.
- **Notepad vault destination (M8):** the desk notepad publishes into the
  already-configured vault (`vault_path` setting) as `Notes/Desk Notepad.md` —
  regenerated in place, concept-linked via the existing compiler, no-op when content
  is unchanged (publishes-ledger entry keyed on notepad content hash).
- **M6 quick-wins fold into M7** as its first task. **Live provider verification is a
  manual operator checkpoint between M7 and M8**, not a Sonnet task: the operator
  gets connection instructions (Anthropic API key; optional OpenAI-compatible
  endpoints), connects, then a session verifies streaming + caching + extract against
  the real APIs before M8 begins.
- PRODUCT.md open questions closed: threads strictly user-initiated; highlight kinds
  answered above; pagination won over scroll.

## 2026-07-17 — Provider strategy: subscription OAuth & endpoint presets
- Target provider lineup (long-term): Anthropic API key, OpenAI-compatible endpoints
  (OpenRouter, local Ollama/LM Studio, any Bearer-token bridge incl. a future
  ChatGPT/Hermes OAuth endpoint), and Anthropic **subscription** access.
- OpenRouter and local models need no new code — they are `openaiCompat` with different
  base URLs. Settings UI should offer base-URL presets (OpenRouter / Ollama / LM Studio /
  Custom).
- Subscription-credit access to Claude (Pro/Max instead of per-token API billing) goes
  through the Claude Agent SDK, which inherits the local Claude Code login
  (`claude setup-token` for a long-lived token). That is a **third LLMProvider
  implementation** (`claudeAgent.ts`), deferred past M4 — the seam absorbs it without
  touching threads/context/UI. Raw Messages API with an sk- key stays the M4 Anthropic
  implementation.
- ChatGPT-subscription OAuth: build nothing now; if/when a usable endpoint exists it
  should enter through `openaiCompat` (base URL + Bearer token), with a token-refresh
  helper only if needed.
- No sign-in required to use the app: M5's unconfigured-provider nudge is the designed
  state until a provider is configured.

## 2026-07-17 — Three-room design system (v1.5 direction)
- The app is three "rooms" with distinct materials joined by continuous doorway
  transitions: the Desk (freeform bookshelf, warm/tactile), the Book (reader,
  analogue paper/ink, effects-free), the Scan (timeline heat map, CRT/retrofuturist).
  Full blueprint: docs/marginalia/DESIGN.md.
- v1 scope unchanged: M4–M7 land first, exactly per SPEC; rooms are M8–M10.
- Motion library is `motion` (framer-motion successor); no three.js/WebGL unless a
  named effect (M10 page curl) proves to need it; everything gates on
  prefers-reduced-motion.
- epub.js stays. 3D page turns are snapshot-based over its iframe (no per-page DOM
  exists to peel); a custom paginator is the escape hatch behind the ResourceRenderer
  seam, only if snapshots prove insufficient.
- Reader effects budget: cursor trails/parallax/glow live on the Desk and Scan only —
  never in the reader ("reading comes first").

## 2026-07-10 — Founding decisions (Marginalia)
- Provider-agnostic LLM layer; "LLM proposes, code disposes" — model never touches files.
- EPUB first; PDF/Markdown deferred.
- Node server + browser UI; native shell (Tauri/Electron) deferred until product proven.
- Immutable-on-import, content-addressed library → anchors can't rot.
- SQLite sidecar is source of truth; Obsidian vault is a one-way compiled projection.
- Vault gets distilled concept notes, not raw transcripts.
- Whole-resource context by default, with provider-side caching where available.
