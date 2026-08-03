# Kickoff prompt — M20 step 4: over the spine, and the WebGL question

Paste the block below as the first message of the session. **This is a design session
before it is an implementation session** (CLAUDE.md's division of labor, and
PAGE_CURL.md §4 says so outright: the fork "should be a decisions.md entry, not a pull
request"). Operator notes for the human are at the bottom.

---

You are working on **Marginalia**, a local reading app. This session is **M20 step 4**:
the page curl folding *over the spine* onto the facing leaf, and the WebGL question that
sits underneath it. Steps 1–3 are done — the rolled sheet, the real page capture, the
paper card, the edge peel, the gesture's one exit, and the `pageTransition` setting.

**The first thing to understand about this task: it is not a coding task yet.**
DESIGN.md's rule is "no WebGL until a named effect needs it". The 2026-07-20 entry named
the curl as that effect and then discharged it ("the 2D fold discharges it"). So the rule
itself is now the thing being tested, and the answer is a `docs/decisions.md` entry that
either amends it or holds it. Do not open a renderer file until that entry is written.

Read first, in this order:

- `docs/decisions.md`, four entries, newest first: **2026-08-03 (later still)** — the
  low-fps guard was measuring the display, not the fold, which is why any performance
  argument made before that date is void; **2026-08-03 (later)** — the slide, and the
  ladder it now sits in; **2026-08-01** — the roll, i.e. the geometry you would be
  amending; **2026-07-20** — the original ruling, including "spread mode peels the near
  leaf only", which is the ruling step 4 *contradicts*.
- `docs/marginalia/PAGE_CURL.md`, and genuinely all of it, but in particular: **§2c** (the
  occlusion theorem — the single biggest time sink of a previous pass; do not spend a
  session rediscovering it), **§2d** (what over-the-spine actually costs, itemised),
  **§4** (the fork, and the table of the two options), **§3** (the invariants), **§6**
  (dead ends already paid for), **§7** (performance, and the guard that was wrong),
  **§8** (how to run and verify).
- `docs/marginalia/TASKS.md` M20 step 4, and `docs/OPUS.md` — how to run a session that
  decides rather than executes.
- `docs/marginalia/DESIGN.md`'s "no WebGL" rule, in its own words, before you argue with it.

## Gate: get the number nobody has, before you argue about anything

Every performance claim about the fold in this repo comes from a **software rasterizer
with no GPU** (§7 says so twice). That has been the named gap since 2026-08-01, and it is
now cheap to close: `PageCurl` reports the median cost of one `drawPageFold` call and
dev builds `console.debug` it, once per fold, with the sample count.

So: run the app on real hardware, turn pages with Curl selected, and read the console.
Single-page and spread, at the display's real dpr, on a long book. Write the numbers into
NOTES.md before you write anything else.

**This changes what the decision has to justify, and it is the reason the gate exists.**
If the fold costs ~1ms a frame on real hardware, then "2D has run out" is an argument
about *geometry* — §2c's occlusion theorem and §2d's conical deformation — and not about
speed, and a WebGL entry that leans on performance is arguing from a number that was
never real. If it costs 20ms, that is a different entry. Either way the fallback ladder
(reduced motion → instant, `pageTransition: slide` → slide, low fps → slide, failed
capture → dip) is not up for negotiation, and a WebGL renderer needs its own honest cost
measure or the low-fps rung becomes decorative.

## Deliverable 1 — the decisions.md entry (this session's real output)

Written in the house style of the 2026-08-02 and 2026-08-03 entries: dated, short, each
bullet a ruling with its reason, and measurements stated as measurements. It has to
settle, at minimum:

1. **2D mesh, WebGL, or neither**, against §4's table and the number from the gate.
   "Neither" is a legitimate answer and should be argued for if the geometry gap is
   smaller than it looks — §4 also prices a middle option (perspective on the tail and
   roll only, ~60 lines) that was scoped out on cost/benefit, not because it fails.
2. **Which of the operator's asks actually need a mesh.** §2c (text squeezing into the
   curl) and §2d (over the spine) are believed to; do not bundle them, they are not the
   same problem.
3. **The amendment to 2026-07-20**, explicitly. "Spread mode peels the near leaf only" is
   a shipped ruling enforced by `nearLeafRect` and pinned by a test. Over-the-spine
   overturns it, and CLAUDE.md's working practice says overturn deliberately, never by
   drift. Say what replaces it.
4. **What happens to the 2D renderer.** It cannot simply be deleted: it is what reduced
   motion, the low-fps rung and a failed capture fall back to, and `pageFold.ts`'s
   properties are the only executable description of the model. Does it stay as the
   fallback renderer, or does the ladder terminate at the slide?
5. **Single-page mode has no spine**, so the two modes stop sharing one model (§2d's last
   bullet). Decide whether single-page keeps the roll or gets the mesh too.

## Deliverable 2 — the implementation, only if the entry calls for it

Scope, if and only if the fork resolves that way:

- **The geometry stays a pure, testable module with the renderer swapped underneath**,
  exactly as `pageFold.ts` is split today (§4 says to insist on this up front). A shader
  that hides the model inside itself is the failure mode.
- **The sheet hinges at the spine.** The grabbed corner still lands under the pointer, but
  the spine edge is a constraint the current model does not have; expect the crease to
  stop being a straight line perpendicular to corner→pointer. This is the real work.
- `nearLeafRect`'s job changes from "where to draw" to "which half of the snapshot is the
  turning leaf". `leafSourceRect` already separates those two concerns, so that part is
  small.
- **The far leaf stops being flat and undisturbed** and needs its own shadow — and that
  phrase is a *shipped M20 acceptance criterion*, so retire it in TASKS.md rather than
  quietly failing it.
- **The snapshot capture is unchanged and stays the input** (§5). Do not touch
  `pageSnapshot.ts`; four of its lines exist because of failures that render a plausible
  but wrong bitmap.
- **A lost WebGL context is a real state**, not a crash: it degrades to the slide like any
  other failed renderer, and it must go through the gesture's existing one exit.

## Invariants that must survive (PAGE_CURL.md §3, and they are tests)

- `setPointerCapture` on the grab surface. Without it a drag crossing into the sandboxed
  epub.js iframe **crashed the tab** — reproduced, not theoretical.
- The snapshot capture deadline. A stalled capture must never freeze reading.
- Reduced motion renders **zero canvases and zero grab surfaces**.
- The low-fps downgrade, which since 2026-08-03 means *median `drawPageFold` cost over at
  least 12 drawn frames*, not frame intervals. A new renderer needs the equivalent.
- **`pageTransition: "slide"` is a ceiling**: no canvas may mount while it is on, and a
  WebGL canvas is still a canvas. It is checkable as
  `document.querySelectorAll("canvas").length === 0` through a whole turn; keep it that way.
- **A gesture always ends**: one exit in a `finally`, a deadline on every await, the
  pointer-capture watchdog, the turn lock's maximum lifetime, and the spring-back's step
  back taken against a CFI recorded at grab time. Read PAGE_CURL.md §9 before touching
  `usePageTurnAnimation.ts`; that section exists because these were absent once.
- Every property in `pageFold.test.ts`: the grabbed anchor lands exactly under the pointer
  (corner *and* edge), an edge peel's crease stays parallel to the spine, the zero-arc
  case degenerates to the 2026-07-20 bisector, the leaf is fully covered by progress 1,
  only the turning leaf's half of a spread snapshot is used, and peelDir/creaseDir stay a
  right-handed orthonormal pair.

## Out of scope

RTL reading direction (deliberately undecided until an RTL book is in the library); the
slide renderer; the settings surface; anything in `pageSnapshot.ts`.

## Verification, not optional

- **The harness is where the look is judged**: `web/harness/pageFold.html`, which imports
  the geometry straight from source and renders every fold state across all three reading
  themes (§8 has the URLs). Every visual constant in the file was chosen there. Iterate
  there, then confirm in the real app — the app is now a valid place to verify, because
  the capture carries real pixels.
- A dev server is **usually already running** on `:5173` (web) and `:5175` (server) —
  check before starting one, and never kill those ports without inspecting first.
- Drive the real app in the cached Chromium at
  `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome` via CDP: press, several
  moves, screenshot while still held, release.
- **Two hard rules, both learned by hanging the browser.** Never drive a pointer anywhere
  except the grab surfaces — events reaching the epub.js iframe hang the driver with no
  error and need the browser killed; once a gesture has gone wrong, assert on *state*, not
  on more input. And run pixel comparisons at **dpr 1**: `MAX_CAPTURE_SCALE` is 1.5, so at
  dpr 2 nothing can be pixel-identical and a correct renderer reads as a registration bug.
- Do not script a drag under reduced motion: there are no grab surfaces then, so the press
  lands on the iframe. Check that invariant with a keyboard turn and a sampled canvas count.
- Kafka on the Shore and Alice are both in the library.
- Tests and typecheck: `cd projects/marginalia/web && npx vitest run && npx tsc --noEmit -p
  tsconfig.json`, plus the server's and shared's own tests if you touch schemas or the
  settings store.

When done, update `docs/decisions.md`, `docs/marginalia/PAGE_CURL.md`, `NOTES.md` and
`TASKS.md` the way the 2026-08-02 and 2026-08-03 entries do — and **say plainly what was
verified versus assumed.** The repo has uncommitted work across the reader and docs from
previous sessions.

---

## Operator notes (for the human, not the model)

- **Model choice: Opus or Fable, not Sonnet.** Deliverable 1 is a decision, and CLAUDE.md
  puts decisions in high-capability sessions. If the entry resolves to a large
  implementation, that part can be handed to a fresh Sonnet session with the entry as its
  spec.
- **You can close the gate yourself in two minutes** and it will make the session much
  better: open the reader on your Mac with Curl selected, open the browser console, turn
  five or six pages, and paste the `[marginalia] fold draw cost:` lines into the session.
  Single-page and spread both. That is the number every "2D has run out" argument depends
  on and it has never existed.
- **Two carried-over items belong to this milestone** and are worth doing in the same
  pass: operator sign-off on the roll on real hardware (does it read as paper on the Mac,
  does the turn stay smooth), and the still-unnamed original trigger of the stuck curl —
  the structural fixes bound every failure of that shape, but nobody has caught the
  specific one with a trace.
- **Expect the honest answer to possibly be "not yet".** §4's middle option — perspective
  on the tail and the roll only — buys a real if modest "see under the lifted edge" band
  for maybe 60 lines and no new rendering path. If the gate's number comes back at ~1ms,
  that option gets a lot more attractive than a second renderer to maintain.
