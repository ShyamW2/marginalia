# Decisions

Short, dated entries. Newest first. Amend CLAUDE.md's "Settled decisions" when one of
these changes the rules.

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

### Audio mode (M17–M18)

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
