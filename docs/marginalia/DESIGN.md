# Marginalia — Design Direction

*The aesthetic and interaction blueprint for the app's visual identity. PRODUCT.md says
what the product does; this says what it feels like. Binding for UI milestones (M7+),
advisory for the UI already being built in M5 (build plain, but don't paint yourself
into a corner).*

Status: direction agreed 2026-07-17. v1 scope (M4–M7) is unchanged — the rooms below
land as v1.5 milestones (M8+) after the core loop works end to end.

## Thesis: three rooms, one building

The app is a small world with three distinct spaces, each with its own light and
material, connected by continuous transitions — you never "switch pages," you *move
between rooms*. Like a well-art-directed game: each space has a strong identity, but
shared physics, one ink color, and doorway transitions make it feel like one place.

| Room | Route | Material & light | Job |
|---|---|---|---|
| **The Desk** (bookshelf) | `/` | Warm, tactile, daylight. Paper, wood, soft shadows. | Where books live. Browse, arrange, scribble. |
| **The Book** (reader) | `/read/:id` | Analogue. Paper & ink, near-zero chrome. | Read, highlight, converse. Sacred space. |
| **The Scan** (timeline) | `/scan/:id` | Dark instrument panel. CRT glow, grain, neon heat. | See the whole book at once. Revisit, filter, jump. |

The polarity is deliberate: the reader is the most *analogue* surface, the scan is the
most *digital* — reading a book vs. putting it under an instrument. The desk sits
between them. Moving between rooms should feel like the lights changing.

**Amended 2026-07-30 — two rooms and four instruments.** The Scan and the Digest become
*popups over whatever you are already in*, not places you travel to. The thesis survives
in a sharper form: you are only ever **in** the Desk or the Book, and you put an
**instrument** on top of what you're in.

| | |
|---|---|
| **Rooms** — you are in them | The Desk, The Book |
| **Instruments** — you put them on what you're in | The Scan, The Digest, Settings, Annotations |

"The book under an instrument" was always the Scan's job; bringing the instrument to the
book is more honest than travelling to a room to do it. The Scan keeps its route
(`/scan/:id`) as a real bookmarkable URL rendered over a background location — the same
pattern Settings has used since M11. **The cost, recorded rather than glossed:** the
airlock's full-screen form is spent (see Motion below). Reasoning: decisions.md
2026-07-30.

## Room 1 — The Desk (bookshelf)

The default view the app opens into. Not a grid: a **freeform workspace** where books
lie where you left them (inspiration: elimarigodesign.com's draggable canvas).

- **Books as objects.** Cover-forward cards with real extracted covers, subtle thickness
  and paper edge. Drag to arrange; position/rotation persist (additive migration:
  per-resource shelf coords). Dragging lifts the book — shadow deepens, slight tilt
  toward drag direction, spring settle on release.
- **Hover** raises the book a few px and reveals a quiet info strip (author, progress,
  thread count, last-read). Options (open scan, publish, remove) live here too — no
  right-click mazes.
- **Click to open** triggers the book-opening transition (see Motion below) into the
  reader.
- **The notepad.** A pad of paper on the desk — a persistent freeform scratch note
  (markdown, autosaved to SQLite). This is the manual front door to the ideas vault:
  publish sends it through the same vault compiler path as threads ("LLM proposes,
  code disposes" still holds). Later it can become the brainstorm surface where loose
  notes drift near the cursor (clicktokeep-style) — v2 of the pad, not v1.
- **Ambient physics.** The whole desk responds faintly to the cursor — 1–2° of parallax,
  objects with a touch of inertia, the "suspended jellyfish" feel. Cursor trail lives
  here (see Cursor system).
- **Grid fallback.** The current library grid survives as a list toggle (accessibility,
  and for when the desk gets crowded). Keyboard/screen-reader path is the list.

## Room 2 — The Book (reader)

Already built through M3 and already close in spirit: centered column, serif, paper/ink.
The design work here is restraint plus two signature elements.

- **Origami sticky notes** (threads, M5 UI → refined in M8/M10). A thread's collapsed
  state is a small folded tab peeking from the margin near its highlight — like a
  sticky note's corner visible in a closed book. Hover lifts it (shadow grows); click
  unfolds it in a two-crease origami animation into the thread panel. Collapse refolds
  it. The panel is paper, not glass: slight grain, a real drop shadow, the highlight's
  tint on its spine. M5 builds the panel plain (fade/slide, correct anchoring); the
  fold animation is a later layer over the same component.
- **Highlight kinds.** Four semantic colors chosen at capture (decisions.md
  2026-07-19): **rose** — passage to revisit / general annotation; **sage** —
  definition of a new word or phrase; **honey** — important quote; **slate** — a
  question about the text (the kind Ask defaults to). These are muted washes, not
  marker colors: they tint the paper, they never fight the ink. Reference hues
  (tune in situ; contrast-check both themes): rose `#c98a8a`, sage `#8faa84`,
  honey `#c9a869`, slate `#9c7fb3` (moved blue -> purple, M30 B) — rendered as
  ~20%-opacity washes on paper,
  slightly luminous lifted tints on ink. The kind also tints the highlight's rail
  dot and the thread panel's spine, and gives the scan's heat bands their hue.
- **Reading focus mode.** One keystroke (`f`) hides every mark, tab, and rail dot for
  a clean page; a subtle indicator shows notes are hidden. State persists per session.
  This also becomes the guard rail: any future effect must be *inside* focus mode's
  jurisdiction (i.e., hideable).
- **Fullscreen mode** (M14) is a *different* axis from focus mode and composes with it:
  focus mode hides **your annotations**, fullscreen hides **the app's chrome**. In
  fullscreen the page grows into the freed space and the chrome becomes
  proximity-revealed floating panels at the edge each control normally occupies —
  revealed from the top and bottom bands only, so they never fight the turn-zone
  vignettes on the left and right. Nothing revealed may span the iframe as an
  interactive overlay; that kills text selection.
- **Margins are the reader's to set** (M14). Page margin width is a persisted setting,
  not a constant — and the outer margin is a separate concern from the spread's spine
  gutter, however epub.js chooses to conflate them (decisions.md 2026-07-27).
- **Threads are sticky notes you can move.** A panel is draggable by its header and
  remembers where you put it, stored as an offset from its anchor — where you put a
  thing is data about that thing, the same rule the Desk follows for books. They are
  resizable on the same principle (M19.6), and they roam the whole app rather than the
  reading pane. **On the page it rides, off the page it stays put:** panels ride the
  turning page because they sit inside the stage the page-turn snapshot captures, so a
  panel dragged beside the book is furniture, not part of the sheet.
- **Position is percent and chapter; the page number is a bookmark, not a measurement**
  (M19.6). The footer's book-wide page number comes from epub.js `Locations`, which
  splits by **character count**, so it is stable across text size, margin and spread —
  generated once per book and persisted, since resources are immutable on import. It is
  page-*like* (~1600 chars), not a claim about this window's pagination, and
  `pageNumberMode` lets the reader choose book-wide, in-chapter, or none. The standing
  "percent and chapter, never pages" rule keeps its original jurisdiction: **analysis
  position ranges** (the digest) are never expressed in pages.
- **Page turns.** Today: instant column shift. Target: a page that *moves* — see the
  3D honesty note under Technical foundations. Interim (M7): a fast 150–200ms slide +
  opacity pass so turning feels physical without faking paper. Full 3D turn with notes
  riding the page is M10, snapshot-based.
- **Finding a word never ejects you from the page** (M24, 2026-08-14). Cmd+F opens a find
  field *in the reader*; matches paint in place and `‹ ›` step through the whole book's
  hits in book order, displaying the containing section when a step crosses a boundary.
  Escape clears every mark. Two rules follow from this room's stillness: **a search mark is
  not a highlight** — it takes neither the four kind hues nor their weight — and the handoff
  to the Scan (where the same result set is seen as a distribution) is **always invoked,
  never automatic**.
- **No ambient effects here.** No cursor trails, no parallax while reading, no glow.
  The reader earns its analogue feel by being still. Cursor may switch to a fine
  I-beam/nib during selection, nothing more. "Reading comes first" (CLAUDE.md) is the
  law of this room.

## Room 3 — The Scan (timeline)

The book laid flat as data: a full-width horizontal strip, 0→100%, chapter boundaries
as thin ticks (retrofuturist instrument aesthetic — the Sentry/NEO-tracker reference:
dark panel, neon strokes, scanline grain, data readouts in a mono face).

- **Heat bands.** Highlights/threads render as glowing bands positioned by their true
  percent-position in the book, intensity scaled by note length/thread depth. The
  server can compute exact percent positions by locating each highlight's
  `prefix+exact+suffix` in `resource_text` char offsets — no epub.js needed, so the
  scan loads instantly without opening the book.
- **Filter & search.** Filter bands by highlight kind, by user-added tags (M9
  migration), or free-text search across `exact` quotes and thread content; matching
  bands stay lit, the rest dim to embers. Bands take their kind's hue translated
  into the scan's phosphor palette. (Vault-concept filtering is a post-v1.5
  refinement — concepts aren't persisted in SQLite; decisions.md 2026-07-19.)
  **Amended 2026-08-14 (M24, decisions.md this date).** Search stops being one filter among
  four and becomes the surface's primary control: a large, prominent field of a piece with
  the reader's find bar, searching **the book's own text as well as your annotations** —
  server-side, so full thread bodies and notes are reachable rather than a thread's first
  line. Results are a **transient layer over the strip, distinct from the persistent heat
  bands**: the Scan's job here is to show *where in the book* a phrase clusters, which is
  the spatial question no other surface answers. Filters compose with the query unchanged.
- **Reaching a result is stepping, not aiming** (M24, 2026-08-14). `‹ ›` walk a cursor
  along the result set in book order; the strip auto-pans to keep it in view, the ghost
  readout follows it, Enter opens the reader through the airlock. Clicking a band still
  works and is now the *shortcut*, not the only door — band hit-targets are a few px wide
  and mutually occluding, so aiming was never a fair ask. Stepping must be usable without
  zooming, and is the strip's keyboard and screen-reader path. Stepping moves the cursor
  only: it never drives the reader underneath, because surveying and reading are separate
  acts (settled decision 13).
- **Importance / revisit marks.** Mark any highlight 1–3 stars (additive
  `highlights.importance` migration). On the scan, important passages render as
  **dog-ears** — folded corners on the strip — with a brighter bloom. A "revisit queue"
  readout lists them, sorted.
- **Hover** a band → a ghost readout of the quote + first line of the thread, CRT
  phosphor-style. **Click** → dive into the reader at that position via the airlock
  transition (below).
- Secondary readouts (cheap, high-charm): total highlights, reading progress, chapter
  lengths as a sparkline, "last visited" timestamps. Instrument panels love numbers.
- Respect the CRT look but keep it legible: glow is an accent on a dark neutral, not
  text-on-noise. Contrast still passes; grain and scanlines sit under 5% opacity.
- **The face is one surface** (M18, decisions.md 2026-07-28). Everything *on* the base
  screen — strip, heat field, chapter axis, readouts, revisit queue — carries the barrel
  warp and the VHS treatment **together**, as one bowed piece of glass; a face that bows
  in some places and not others reads as broken. Things that float *above* the glass —
  hover readouts, popovers, tooltips, modals — stay flat, because they are in front of
  the screen, not on it. This supersedes the earlier "graphics layer only" rule:
  legibility is now a bounded constraint (gentle displacement, contrast still passes,
  intensity reaches zero) rather than a veto on warping text at all.
- **The screen sits in a television** (M20.5). The scan is a popup framed as a retro CRT
  set. ⚠️ **The bezel does not warp** — it is a sibling of the filtered wrapper, never a
  child; a bending television reads as broken rather than retro. Only the glass bows, and
  it bows harder than before, still inside M18's legibility bound: contrast passes, and
  intensity 0 still means zero displacement.
- **Zoom is a domain transform, never a CSS scale.** `zoom.ts`'s `fractionToView()` is the
  one mechanism; every layer positions through it and the heat field is *redrawn* at the
  zoomed domain. A CSS `scaleX` scales glyphs and bitmaps as well as positions, which is
  what stretched the axis labels before M20.5. Scroll-to-zoom is then a state change, not
  a second rendering path, and composes correctly with the barrel warp.
- **Colour encodes category, brightness encodes density.** The heat field carries two
  channels: hue says *what kind* of annotation (or which theme, in semantic mode),
  luminance says *how much*. A field that only encodes density looks impressive and
  answers the wrong question. VHS is **visual only** — no sound (see anti-goals).

## Listening (a mode of the Book, not a fourth room)

Audio (M21–M22; full spec in AUDIO.md) is the Book room with the lights the same and
the page reading itself to you. It is deliberately **not** a player room:

- **The book stays on screen.** The spoken sentence takes a quiet moving tint — quieter
  than all four highlight kinds, because it moves every few seconds and must not compete
  with the reader's own marks — pages turn themselves, and position saves through the
  same path your eyes use. One position per book.
- **The reader stays interactive.** Select, highlight, ask, mid-listen. Doing so pauses
  playback: you cannot read an answer while being talked at.
- **Transport is chrome, not furniture.** Play/pause, skip, speed, and the voice-mode
  toggle live as reader chrome and join the proximity-revealed set in fullscreen.
- **The tool on the desk** is where listening *turns on* — a tactile object (deck,
  gramophone) that lights when engaged, after which opening any book opens it listening.
  It is the charm, not the gate: the list view's plain "Listen" action remains the
  canonical keyboard path.
- **Page turns while listening use the slide, not the curl** — capture cost on every
  turn is a stutter risk, and audio never stutters.
- Honesty note, the audio equivalent of the epub.js constraint below: **sync is
  sentence-level by construction**. One audio segment per sentence means "what is
  playing" maps to "what is on screen" exactly, with no dependence on per-word timings
  the engine may not expose. Word-level is a stretch goal, never a prerequisite.

## The control system (M19.7 — binding for every surface)

Added 2026-07-30. Before this, each surface styled its own buttons and the one real
slider (the reader's `%` scrub) was a bespoke one-off. The goal is coherence, and
coherence is structural — the same sizes, hit areas, focus rings, states and timings
everywhere — **not** the same skin everywhere.

**Two registers, split by material, not by room.**

| Register | Surfaces | Material |
|---|---|---|
| `paper` | The Desk, The Book, The Digest, Settings | Warm, tactile. Soft drop shadows, gentle 3D, playful but restrained. |
| `glass` | The Scan | CRT instrument. Phosphor strokes, bezel, scanline, mono readouts. |

The reader takes the **quietest variant of the paper register** — flatter, lower-contrast
chrome — because "the reader earns its analogue feel by being still" is still the law of
that room. It is a dial on one register, never a third system.

Rule for cases nobody has thought of yet: **a control belongs to a register, and a
register belongs to a material.** A new paper surface takes the paper register; a surface
rendered as instrument glass takes the glass one. Nothing gets a bespoke button again.

- **`Button` / `IconButton`.** Icon-only, icon+label, label-only. One size scale, one
  focus ring, one disabled and pressed state, per register.
- **`Slider`** — one component with two input modes on one value: **drag** (pointer lock
  so travel is unbounded, cursor hidden, live value floating above the handle, Escape
  cancels) and **click-to-type** (the track becomes a text field). Detents are
  **advisory**: a released value inside the capture window snaps to the stop and passing
  one gives feedback, but any value in range stays typable. `scale: "linear" | "log2"`;
  log2 detents on powers of two with a capture window that is a *percentage* of the
  current value, or it is unusable at the top of the range. Keyboard is a first-class
  path with a real `role="slider"` and an `aria-valuetext` carrying the formatted value.
  **Amended 2026-08-04 (M22.5).** Three refinements, all generalising the reader's `%`
  dial — which was the best slider in the app and was the only one not built on this
  component's own rendering:
  - **At rest a slider is a readout, not a track**: the formatted value flanked by dim
    chevrons, no fill and no thumb. The track rendering is retired.
  - **While dragging, a slider shows one shared dial** — a ruler scrolling under a fixed
    needle with the live value above it, centred beneath the control. Its ticks are laid
    out in the slider's own **position space** (so a log2 slider's ruler is uniform per
    octave) and its pixels-per-unit comes from the slider's `dragPxPerUnit`, or the ticks
    do not track the pointer.
  - **A capture window is a percentage *or* an absolute amount**, chosen per slider. A
    percentage is right across a log2 range and wrong across a linear one where the ask is
    "±25 either side of every 500".
  - A slider **quantises what it commits**. A control may not emit a value its own
    consumer will reject, and a rejected save may not fail silently.
- **Overlays fly from the control that opened them**, using the invoking element's rect —
  never a hardcoded corner, because the same overlay has more than one caller. Resizing an
  open overlay morphs its box. **~240ms with a spring**, not the 500ms first proposed:
  DESIGN.md's own motion law is 150–200ms for system-initiated motion, and settings tabs
  are clicked through in sequence. Reduced motion collapses this to a crossfade.
- **One shortcut registry.** Key, scope, handler, one `isTyping` guard — replacing the
  per-room `keydown` listeners. The on-screen keycap hints are **derived from the
  registry**, so a hint can never advertise a binding that no longer exists. Keycaps are
  proximity-revealed and tucked behind their icon otherwise; they are the charm, never the
  only path to a function.
- **The chrome cluster.** The top nav bar is gone. Library, settings and theme live as a
  floating icon cluster in the top-right of every room. In the reader it joins M14's
  proximity-revealed set rather than sitting over the page, and it never intrudes on the
  left/right turn-zone strips.
  **Amended 2026-08-04 (M22.5): the cluster owns the corner, and a room joins it.** The
  cluster renders one fixed **chrome row**; a room contributes its own global actions into
  a leading slot in that row, left of the permanent icons (the Desk's view toggle and
  Import book are the first). *Nothing else may be fixed to the top-right corner* — the
  rule exists because every room that laid out its own actions there ended up underneath
  the cluster.
  **A room's actions about the thing you are looking at go bottom-right instead**, as a
  floating cluster: icon-only at rest, labels revealed by proximity *and* by keyboard
  focus, never hover-only. The reader's Digest/Scan/Publish are the first. ⚠️ In the reader
  that corner is also the page fold's grab anchor, so the boundary is absolute rather than
  tuned: **a floating cluster never overlaps the reading card** (`.stage`) — beside it, or
  below it, but never on it. In fullscreen, where the page takes that space, it joins the
  proximity-revealed floating set instead and is not on the page at rest.

## Motion language (shared physics of the building)

One motion system everywhere — springs, not fixed curves, for anything the user
"touches"; 150–200ms ease-out for anything the system does. Library: **`motion`**
(successor to framer-motion) — layout/shared-element animations, springs, gesture
drag, `useReducedMotion`. No GSAP/three.js unless a specific effect proves to need it.

Signature transitions ("doorways"):

- **Desk → Book: the opening.** Click a book → its cover zooms toward the viewer
  (shared-element layout animation), opens, and the pages *flick* — a fast stylized
  flutter (rendered with fake page planes, not real epub pages) that decelerates and
  lands on your saved position as the real reader fades in beneath it
  (heatbureau-style scroll-to-your-page feel). Falls back to a plain crossfade under
  reduced motion.
  **Amended 2026-08-04 (M22.5): the cover actually opens.** M20.7 shipped the zoom plus a
  flutter played *over* a closed cover, which is not this. The sequence is: fly to centre,
  then the front cover **rotates anticlockwise about its spine (left) edge** toward the
  viewer, revealing a two-page spread beneath it, which scales onto the reading pane and
  crossfades to the live reader. Unchanged and load-bearing: the reveal waits on the
  reader having landed, so it can never flash an unstyled page; Escape cancels at any
  phase; reduced motion is a crossfade with no 3D at all.
  **Amended 2026-08-14 (decisions.md), two rules retired and one added.** (a) The
  sequence plays **over the room the book came from**, which stays on screen until the
  spread has landed — the reader mounts and loads underneath the whole time, invisible.
  A transition shown against its destination is not a transition. (b) "Blank paper
  planes, never real epub pages" is narrowed to what it was protecting: never *animate*
  real page content. The book may hold **one still of the reading pane** printed across
  its spread while it sits open, so the page you are about to read is already in your
  hands; a failed capture falls back to blank paper. (c) The whole thing is paced to be
  watched — ~1.9s off the Desk, ~2.5s off the shelf (whose extra time is the book coming
  out of the row and turning), then ~0.85s of landing. It blocks no input at any point,
  which is what licenses the length.
- **Book → Scan: the airlock.** The lights change: page desaturates and dims, chrome
  recedes, scanlines fade in, and the highlights you were just reading *become* the
  glowing bands — the same marks, re-materialized as data. Reverse on the way back
  (a band flares, becomes a paper highlight, page relights). This one transition is
  what sells "one building."
  **Amended 2026-07-30:** with the Scan becoming an instrument rather than a room, the
  full-screen form of this is spent — there is no longer a room to travel to. The
  **band materialisation survives** inside the popup as it slides in from its control;
  the lights-changing, chrome-receding half does not. Recorded as a real loss, not a
  neutral substitution: this was named here as *the* transition that sells the building.
- **Book → Desk: the put-down.** The literal reversal of the opening, sequenced 2026-08-27:
  the Desk button or `Esc` starts it → the reading pane zooms out while its UI fades → by
  the time the book is fully out (still open) the Desk background has faded in → the book
  closes onto its cover → the cover travels to its place on the desk. ⚠️ **That order is
  load-bearing, not just aesthetic**: the reader cannot know where the book lands (it
  depends on `shelf_state`, on which of desk/list/shelf was last used — already persisted by
  `persistDeskViewMode` — and on that room's parallax), so the Desk must be mounted and
  reporting a rect *before* the cover starts travelling. ⚠️ **Two different Escapes**: `Esc`
  *during an opening* still cancels by unmounting immediately (there is nothing coherent to
  reverse mid-flight, `BookOpening.tsx`); `Esc` *while reading* is this sequence.
- **Scroll-to-open (crown feel).** On the desk, scrolling while hovering a book
  "pushes into" it — scale grows through a threshold, then commits to the opening
  transition. Like winding an Apple Watch crown. Escape backs out at any point.

Rules: animate `transform` and `opacity` only; interruptible (every transition can
reverse mid-flight); nothing blocks input for more than ~400ms; `prefers-reduced-motion`
collapses all of the above to crossfades (M7 already requires this).

## Cursor system

- **Custom cursors per room**, selectable in settings (plus "system" to opt out):
  e.g. a hand/grab on the desk, fine nib in the reader during selection, a reticle
  crosshair in the scan.
- **Cursor trails** on the desk and the scan only — a small canvas overlay
  (`pointer-events: none`, rAF loop, decaying particles; ink droplets on the desk,
  phosphor streak in the scan). Hard cap ~60 particles; the loop idles when the
  cursor rests. Never in the reader.
- Cursor is an accent, not a mascot: default sizes, always visibly a pointer, honors
  reduced-motion (trails off).

## The pointer contract (M31 — binding for the reader)

*Written before the touch layer was built, per M31 A. Swipe-to-turn and drag-to-select
are one pointer stream; a rule invented per-feature produces a book that is neither
annotatable nor pageable, which is worse than no touch support at all. Reasoning and the
retirement of click-to-turn: decisions.md 2026-08-27.*

**The law: where a press lands never decides what it means on its own. Two questions
decide it together.**

1. **Ink or paper?** *Ink* = a glyph is under the point. *Paper* = the outer margin, the
   spine gutter, the space below the last line, a blank verso. This is a real hit-test
   against line boxes, not a region of the page — see "How ink is detected" below.
2. **Did the pointer travel?** Under the threshold it is a press; over it, along the
   dominant axis, it is a drag.

### Pointer (mouse, trackpad, pen)

| Press lands on | Press, no travel | Press then horizontal drag |
|---|---|---|
| ink | nothing (dismisses a pending pill) | **select text** |
| a highlight mark | open its thread | select text |
| paper | nothing | **turn the page**, in the drag's direction |

- **A click never turns a page.** Page turns come from `←`/`→` (`SHORTCUT_KEYS`), the
  foot's `‹ ›`, and drag-on-paper. Retired deliberately at M31: a click-to-turn band wide
  enough to hit is a band wide enough to swallow the start of a highlight, and no
  redivision of the page fixes that — the two gestures overlap by nature, not by layout.
- **Direction comes from the drag, not the grab point.** The gutter and the foot of a
  short page belong to both directions; only the drag says which. Dragging **left** turns
  **forward**; dragging **right** turns **back** — the sheet follows the finger.
- **Vertical drags on paper do nothing.** No dominant horizontal axis, no turn.
- Thresholds: **6px** separates a press from a drag; the fold's own commit thresholds
  (`HINGE_COMMIT_AT`, the slide's `0.35`) are unchanged and stay downstream of this.
- **A gesture here is not an animation.** `prefers-reduced-motion` drops the peel and keeps
  the drag — the same gesture, committing an instant turn. Retiring click-to-turn without
  this would have left reduced-motion readers no way to turn a page on the page itself
  (M31 A5; decisions.md 2026-08-27 later still).

### Touch

| Touch lands on | Tap | Drag | Hold, then drag |
|---|---|---|---|
| ink | dismisses a pending pill | **turn the page** | **select text** (the platform's own long-press) |
| a highlight mark | open its thread | turn the page | select text |
| paper | nothing | turn the page | turn the page |

- **A tap never turns a page.** Same law as the pointer, same reason.
- **A long downward swipe leaves the book** — the one room-changing gesture, specified under
  "Gestures outside the reader" below. Horizontal turns, vertical departs, and nothing else
  vertical does anything.
- **The platform owns the hold.** Long-press-to-select is built into every touch browser,
  with draggable endpoint handles readers already know. We do not run a timer, do not pick
  a duration, and do not build handles. Our only jobs are to not steal the touch before
  the platform has decided, and to turn the page when the platform decides it was a pan.
- Consequently **the ink/paper test is not needed on touch** — "does a selection exist?"
  is the whole discriminator, because the platform only ever selects over ink. It cannot
  disagree with the platform the way a test of our own could. The hold-on-paper row above
  therefore needs no code: no selection appears, the swipe stays armed, the drag turns.
- Thresholds: **24px** of horizontal travel commits a page turn; a departure needs **≥⅓ of
  the page** travelled downward within **±20°** of vertical (±5° was proposed and is too tight
  to perform reliably on glass — decisions.md). Both only while `touches.length
  === 1`. A second finger landing cancels an uncommitted swipe outright (it is the start
  of some other gesture, not a page turn).

### The invariants

These are the lines that stop the next feature from quietly undoing this.

1. **Nothing in the parent document may hold pointer events over ink.** An overlay above
   the epub iframe does not merely make selection awkward there — the iframe never hears
   the press at all. First recorded at M11, broken at M20 by the grab surface, fixed at
   M31 by making the grab surface's `pointer-events` follow the live ink/paper answer.
2. **The grab surface must still be a parent-document element.** It needs
   `setPointerCapture`, capture needs a real parent-document `pointerdown`, and an
   uncaptured drag crossing the sandboxed iframe is a reproduced tab crash (NOTES.md M10).
   The fix is to make it step aside, never to delete it.
3. **A live selection disarms every turn gesture** — pointer and touch alike. The one
   exception is the M19.6 dwell, which is an explicit, ringed, held gesture whose entire
   purpose is to turn *without* dropping the selection.
4. **The dwell's region is not a click target.** `turnZoneForVisibleX` survives M31 as the
   region the dwell listens in, not as a place a click turns the page. Deleting it
   silently removes highlighting across a page boundary.
5. **An affordance may not outlive its gesture.** The turn-zone vignette and the
   directional `w-resize`/`e-resize` cursor advertise click-to-turn; once clicking does not
   turn, they are lying. Over paper the reader gets a grab cursor; over ink, nothing.
   *Settled at M31 A6 (decisions.md 2026-08-27 later still):* the vignette survives, but
   **both edges light together**, and only over grabbable paper. A one-sided glow would be
   advertising a direction the page does not have until the drag gives it one. A directional
   affordance, if ever wanted, belongs to the drag and not to the hover.
6. **A gesture may mean different things in different rooms, never two things in one
   room.** Long-press pins a cluster panel in the reader and opens a book's action card on
   the Desk; that is fine. Two meanings on one surface is not.

### How ink is detected

`caretRangeAt` (`reader/pageTextEdge.ts`) already asks the layout engine where a caret
would land, and is the shared primitive — reuse it, do not write a second one. ⚠️ **It
snaps to the nearest caret and never returns null in a margin**, so on its own it answers
"where would a caret go", not "is there ink here". The test is one step further: take that
caret, extend it one character, `getClientRects()`, and check the point falls inside a
line box. That belongs beside `caretRangeAt`, in the same file.

### Gestures outside the reader

A gesture may mean different things in different rooms (invariant 6); it may not mean two
things in one room. The full set, so a new one can be checked against it:

| Gesture | Desk / shelf | Book | Scan |
|---|---|---|---|
| tap | open the book | per the tables above; **in immersive mode also reveals the pebble** | select a band |
| drag | move the book | turn the page | move along the timeline |
| long-press (still) | **the book's action card** | select text (platform-owned) | — |
| pinch | — | **text size** (below) | zoom the timeline |
| swipe down (long, one finger) | — | **home, via the put-down** | — |

- **One gesture changes room, and only one: swipe down goes home.** ⚠️ Amended 2026-08-27
  (later still) — this rule previously read "no gesture changes room", written when
  pinch-to-close was dropped. The operator brought back a downward swipe for it, and the
  amendment is real rather than a reversal: what made pinch-to-close wrong was that pinch is
  *cheap* — two fingers, any distance, and it is worth more as text size. The rule that
  survives is about **deliberateness, not about room changes being forbidden**:

  > A gesture that changes room must be expensive to perform by accident: a long throw
  > (≥ ⅓ of the page), a tight axis, one finger, and disarmed while anything is selected,
  > being edited, or mid-turn.

  Swipe down from the Book returns to whichever of desk/list/shelf was last used, **running
  the put-down** (Motion language, above) — it is the same departure as the Desk button and
  `Esc`, not a third way out. ⚠️ **It is gated on M31 §0**: until Safari's pull-to-refresh is
  overridden, a downward swipe reloads the page, and shipping this before that is shipping a
  gesture that destroys the reader's place. ⚠️ It also makes the touch table's "vertical
  drags do nothing" false — the table above is the authority; this is its one exception.
- **The Desk's long-press is one rule, not three.** The action card appears after **1s of
  stillness**, at any point during a touch; *any* movement dismisses it and re-arms the
  timer, so a book that stops moving under a resting finger brings it back after another
  second. "Hold briefly then drag" needs no clause of its own — it is movement before the
  second is up. ⚠️ A 1s dwell with no feedback reads as a broken app: reuse the reader's
  `DwellRing` (already parameterised by `durationMs`) so the wait is visible. ⚠️ Book covers
  are images, so iOS raises its own "Save Image" callout mid-hold — `-webkit-touch-callout:
  none` on the cover, without disturbing selection anywhere else.
- **The immersive tap is the one exception to "a tap never turns/does nothing."** It reveals
  the pebble and nothing else; whatever the pointer table says for that spot still happens.
  It is the touch equivalent of the proximity reveal, which has no touch counterpart.

### Pinch to resize is an instrument, not a setting

Same shape as the `%` scrub dial (M12): a live readout that commits on release.

- The **text-size slider appears 100px above the pinch's centre point**, with a sample
  string at the live size so the size can be judged without reading the page. Pinching in
  drives the slider left, out drives it right.
- ⚠️ **The page does not reflow during the pinch.** A font-scale change re-paginates the
  whole spine section in epub.js; doing that per frame is not affordable. The slider and its
  sample follow the fingers live; the page reflows **once, on release**. This is *why* the
  page is blurred and lightened while the instrument is up — it is honest about not being
  able to follow, not decoration. Blur the page, never the sample.
- ⚠️ **Clamp, do not reject.** A pinch centred too near the top of the page must slide the
  slider down into view, not refuse the gesture — refusing on position is indistinguishable
  from a bug, and `handleSelected` already sets the precedent by clamping the pill into the
  page rather than suppressing it.
- Discoverable from **Settings**, beside the text-size control, and only on a touch device
  (`matchMedia("(any-pointer: coarse)")`).

## Technical foundations & honesty

- **The epub.js constraint (read before promising 3D page turns).** epub.js renders a
  whole spine section as one wide multi-column iframe and reveals "pages" by scroll
  offset — there is no per-page element to grab and peel, and its annotation marks
  live in an SVG pane overlaid in the *parent* document (see NOTES.md, M2/M3
  friction). Consequences:
  - A **container-level** page motion (page + its notes tilting/sliding as one plane)
    is achievable: transform the view container; the marks-pane rides along.
  - A true **grab-the-edge paper curl** showing content on both faces needs
    snapshots: render current/next page to bitmaps, animate the curl on those planes,
    swap to live DOM on settle. That's the M10 approach. Interactive drag-to-peel is
    the stretch goal on top.
  - If we ever outgrow this, the escape hatch is a custom paginator over our own
    extracted XHTML — that's a `ResourceRenderer` implementation behind the existing
    seam, not a rewrite. Don't take that on until the snapshot approach is proven
    insufficient.
- **Performance budget.** 60fps during transitions on the dev machine; rooms are
  code-split (`React.lazy` per route — also fixes the current 552KB single-chunk build
  warning); epub.js loads only in the reader; heatmap/trails are canvas/SVG, not DOM
  churn; `will-change` only during an active animation.
- **Data additions** (all additive migrations, land with their milestone):
  - M7: `highlights.kind` (rose/sage/honey/slate — see Room 2; backfill:
    has-thread → slate, else rose).
  - M8: shelf state (per-resource x/y/rotation/z), notepad content.
  - M9: `highlights.importance`; `highlight_tags` (user-added tags); server-computed
    `positionPercent` per highlight (derived from char offsets in `resource_text`).
- **Theming.** Rooms are theme *contexts* layered on the existing CSS custom
  properties — paper/ink stays the global axis; the scan is dark-native (its "light
  mode" is just a slightly lifted panel). No parallel theme system.
- **Accessibility.** Every room keyboard-navigable; the desk's list toggle is the
  canonical a11y path; focus-visible everywhere; trails/parallax/grain all gated
  behind reduced-motion.

## What this changes in the plan

- **M4–M6: nothing.** The LLM layer, threads, and vault compiler proceed exactly per
  SPEC/TASKS. M5 builds the thread panel plain but structured so the origami skin
  can be applied later (panel is its own component; collapsed/expanded is a state,
  not a different DOM tree).
- **M7** stays the v1 beauty pass, plus: adopt `motion`, code-split routes, and ship
  the first shared-element transition (library card → reader) as the proof of the
  motion system.
- **New milestones** (see TASKS.md): **M8 The Desk**, **M9 The Scan**, **M10 Reader
  depth** (3D page turn + origami fold polish). Ordered so each ships something
  whole. (M9's filter axes are highlight kinds + user tags, not vault concepts —
  decisions.md 2026-07-19.)

## Anti-goals

- No effect that costs reading comfort — the reader stays still, fast, and paper-like.
- No aesthetic without a job: glow encodes heat, folds encode state, trails encode
  motion — decoration that encodes nothing gets cut.
- No three.js/WebGL until a named effect needs it. **Discharged once, 2026-08-03 (M20 step
  4): the page curl folding *over the spine*.** The rule is amended, not repealed — the bar
  is that an effect must be *named* and shown **geometrically impossible** in 2D, not merely
  awkward or slow. It was met by proof: a sheet hinged at its binding deforms as a cone, and
  `pageFold.ts`'s model is built on a premise (the deformation depends only on distance from
  the crease) that cannot express one. See decisions.md 2026-07-20 → 2026-08-01 →
  2026-08-03 (step 4), and PAGE_CURL.md §2d/§4. Raw WebGL, no three.js; the fallback ladder
  terminates at the slide, and the reader still never sees a canvas under `pageTransition:
  slide`.
- No sound in v1.5. Revisit only after the rooms exist. *(Audio arrives in M21–M22 as
  speech — the book read aloud. Sound **design** — clicks, page rustle, ambience — is
  still parked and is a separate question.)*
- **No new rooms.** Two rooms and four instruments since 2026-07-30 (was "three rooms";
  see the amendment under the thesis) — and the count only ever goes *down*. Anything new
  is an instrument you put on a room, not a place to travel to. Listening is a mode of the Book; the
  evidence board, if it happens, hangs on the wall above the Desk (decisions.md
  2026-07-27).
