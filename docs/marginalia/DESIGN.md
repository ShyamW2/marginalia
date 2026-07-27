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
  honey `#c9a869`, slate `#7f97b3` — rendered as ~20%-opacity washes on paper,
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
  thing is data about that thing, the same rule the Desk follows for books.
- **Page turns.** Today: instant column shift. Target: a page that *moves* — see the
  3D honesty note under Technical foundations. Interim (M7): a fast 150–200ms slide +
  opacity pass so turning feels physical without faking paper. Full 3D turn with notes
  riding the page is M10, snapshot-based.
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
- **Book → Scan: the airlock.** The lights change: page desaturates and dims, chrome
  recedes, scanlines fade in, and the highlights you were just reading *become* the
  glowing bands — the same marks, re-materialized as data. Reverse on the way back
  (a band flares, becomes a paper highlight, page relights). This one transition is
  what sells "one building."
- **Scan/Book → Desk: the put-down.** The view shrinks back into the book's cover
  landing on the desk where it lives.
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
- No three.js/WebGL until a named effect needs it (candidate: the M10 page curl —
  discharged in canvas 2D, so the rule still holds; see decisions.md 2026-07-20).
- No sound in v1.5. Revisit only after the rooms exist. *(Audio arrives in M21–M22 as
  speech — the book read aloud. Sound **design** — clicks, page rustle, ambience — is
  still parked and is a separate question.)*
- **No fourth room.** Three rooms, one building. Listening is a mode of the Book; the
  evidence board, if it happens, hangs on the wall above the Desk (decisions.md
  2026-07-27).
