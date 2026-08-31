# interactive-systems

A collection of interactive tools built on one grounding philosophy: **take an existing
task and make it more fun, more interactive, and more beautiful.** Each tool lives in
`projects/<name>/`. Shared design docs live in `docs/`.

Current project: **Marginalia** (working name) — a local reading environment where you
highlight passages and converse with an LLM inline, like comments in a Google Doc; the
distilled insights compile into an Obsidian vault.

**Document map** (read in this order when implementing):
- `docs/marginalia/SPEC.md` — prescriptive implementation spec (stack, schema, API, seams) — **binding**
- `docs/marginalia/TASKS.md` — ordered task list with per-milestone acceptance criteria; check boxes off as you go
- `docs/marginalia/PRODUCT.md` — product requirements and vision
- `docs/marginalia/DESIGN.md` — aesthetic & interaction blueprint (two rooms + four
  instruments; the control system) — binding for M7+
- `docs/marginalia/READER_REDESIGN.md` — reader chrome v2: the one-line strip, expanding
  clusters, search-vs-Scan, the annotation editor's model select, the immersive page —
  **binding for M24.7**; the `.dc.html` design frames it cites live in the synced design
  project, not in this repo
- `docs/marginalia/AUDIO.md` — audio/TTS subsystem spec (engine seam, casting, cache) — **binding for M21+**
- `docs/marginalia/PAGE_CURL.md` — the page curl (M20): the shipped model, its invariants,
  the geometry of what it *cannot* do in 2D, and how the page snapshot is built (§5 — four
  of its lines exist because of failures that render a plausible but wrong bitmap). Read
  before touching `pageFold.ts` or `pageSnapshot.ts`.
- `docs/marginalia/SONNET_PROMPT.md` — kickoff prompt + operator notes for implementation sessions
- `docs/marginalia/M20_STEP4_PROMPT.md` — the kickoff prompt that ran the over-the-spine /
  WebGL design session on 2026-08-03. **Spent** — its question is answered (decisions.md
  2026-08-03 step 4) and the work it opened is now TASKS.md **M27** (M25 at the time this
  note was written; renumbered 2026-08-12, see decisions.md), parked. Kept as the
  worked example of a design session that opens with a measurement gate; that gate found
  that the fold's own guard had been misreading it twice over.
- `docs/marginalia/NOTES.md` — running log of spec gaps, friction, blockers (create on first use)
- `docs/decisions.md` — decision log (ADR-lite)
- `docs/REFACTORING.md` — why/when/how we refactor, and how success is measured — binding for M19.8
- `docs/SHIPPING.md` — the distribution ladder. Rungs are **named, not numbered**:
  **Local → Repo → {Desktop | Private} → Hosted → Stores**, where Desktop and Private are
  siblings off Repo rather than steps. Repo shipped 2026-08-06; Private is next; nothing
  above it is scheduled. Read it before any work justified by "we'll need it when we ship."
- `docs/OPUS.md` — how to run a **design/review** session: interrogating feedback,
  verifying premises before building on them, and writing docs an implementation
  session can execute. Read it before any session that decides rather than executes.

**Division of labor:** design/architecture decisions are made in high-capability
sessions (Fable/Opus) and recorded in the docs above; implementation sessions
(Sonnet) execute TASKS.md against SPEC.md without re-deciding them.

## Settled decisions

Recorded so we don't re-litigate. Overturn deliberately (update this file + the product
doc), never by drift.

1. **Provider-agnostic LLM layer.** All model access goes through one narrow interface
   (`LLMProvider`). Claude, Hermes, or any OpenAI-compatible endpoint must be pluggable.
   No provider SDK types leak past the boundary.
2. **LLM proposes, code disposes.** The model only returns text or validated structured
   JSON. It never touches files. All vault writes, concept linking, and library mutations
   are deterministic code acting on model *proposals*. This keeps us provider-agnostic
   and makes the vault un-manglable.
   *Bounded 2026-07-30 (M19.7):* the Codex CLI provider is a shell-running agent with no
   `tools: []` equivalent, so it is permitted **only caged** — read-only sandbox, no
   approvals, ephemeral, pointed at a dedicated empty scratch directory, environment
   scrubbed. The general rule: *a provider that could touch files is permitted only where
   the seam can prove it cannot.*
3. **EPUB first.** Nail reflowable books (rendering, typography, CFI anchoring) before
   PDF or Markdown. The core loop must feel wonderful in one format before breadth.
4. **Node server + browser UI.** Local server owns the library, annotation store, and
   LLM calls; the browser renders. Wrap in Tauri/Electron only after the product is proven.
5. **Immutable-on-import library.** Importing a resource snapshots it (content-addressed).
   Resources never change after import, so annotation anchors cannot rot.
6. **Sidecar store is the source of truth.** Highlights, threads, and metadata live in
   SQLite. The Obsidian vault is a **one-way compiled projection** — a publish step writes
   distilled notes into it; we never parse the vault back for anchoring.
7. **Distilled notes, not transcripts.** The vault receives concept notes distilled from
   threads. Raw chat transcripts stay in the reader as the "sticky notes."
8. **Whole-resource context by default — until a digest exists.** A question about a
   highlight ships the full book (or the largest window that fits) with provider-side
   caching where available; the passage is the focus, not the limit, of context.
   *Amended 2026-07-28 (M17):* once a book has a digest, the default becomes the
   **Digest** rung of the context ladder (digest of the covering chapters + surrounding
   pages) — same grounding at a fraction of the tokens. Full-book remains one click
   away and remains the default for undigested books.
   *Amended 2026-08-31 (M34), after measuring what the rung actually sends:* the Digest
   rung is **masked and selective**, not "everything digested". Two rules. **(a) Spoiler
   gating is its own axis, not a property of the cost rung** — a lookahead toggle,
   independent of Off/Digest/Full, applied *structurally* (filter at `spine_index <=
   bookmark`) on every reader-facing consumer including Full, which today ships the text
   of unread chapters and is stopped only by a sentence of instruction. The mask belongs
   at the point of **reading**, not generating: audio casting stays unmasked on purpose,
   because chapter 40's character needs a voice before the reader gets there. **(b) Every
   masked chapter contributes its summary and theme *labels* (~190 tokens); only a
   selected few contribute their thematic *essay* (~618 tokens)** — the highlight's
   chapter and the previous one unconditionally, plus chapters ranked on M24.5's
   **distilled parent themes**, never on raw chapter themes, capped at 8–9. Measured on a
   fully analysed 55-chapter book: the thematic block was 34K of the rung's 61K tokens,
   and the chapter summaries — the intuitive thing to cut — were 11K. *Also settled
   there:* `bookContext` is an ordered list of blocks with cache markers, stable material
   first, because a single breakpoint after highlight-local text meant the Digest rung
   was re-billed in full on every chapter change while Full was not — the token-saving
   rung was the more expensive one for reading forward.
9. **TTS is local, behind its own seam.** Audio goes through one narrow `TTSEngine`
   interface (`server/src/audio/engine.ts`, spec'd in AUDIO.md), first implemented with
   Kokoro in-process via ONNX — no cloud TTS, no Python sidecar. A more expressive
   GPU engine later is a second implementation, not new call sites.
10. **Local-first, with one named exception per cloud dependency.** The LLM endpoint was
   the only one. Web search (M25, was M23 before the 2026-08-12 renumbering) is the
   second — permitted per-provider, **off by default, never silently on**. Any further
   exception is a decisions.md entry, not a pull request.
11. **The model never returns positions.** An extension of decision 2, learned at
   casting: the LLM returns *text* (a quoted string, a concept name) and code locates
   it. Never ask a model for char offsets, indices, or counts and then trust them.
   *Clarified 2026-08-31 (M35), because a design review nearly got this backwards:* the
   ban is on **numbers the model returns**. A number **code computes** by locating
   model-returned text is this decision being followed, not bent — `locateQuoteAnchor`
   and `sectionOffsets.ts`'s `locateAnchor` already do exactly that. And a character
   offset into `resource_text` **cannot rot**: the resource is immutable on import
   (decision 5), so font size, window width, margins and spread mode repaginate the
   *rendered page*, never the source string. So located offsets are stored, and stored
   alongside — not instead of — the quote and its context, which is what the client needs
   to paint the mark in a DOM the plain-text extraction does not match byte for byte.
12. **One control system, two registers** (2026-07-30, M19.7). Buttons, sliders, overlays
   and keycaps are built once and skinned by **material, not by room**: `paper` (Desk,
   Book, Digest, Settings — the reader taking its quietest variant) and `glass` (the
   Scan). Coherence is structural — shared sizes, states, focus rings and timings — never
   the same skin everywhere. A new control belongs to a register; nothing gets a bespoke
   one again. Spec in DESIGN.md "The control system".
13. **Two rooms, four instruments** (2026-07-30, amends DESIGN.md's "three rooms").
   You are only ever *in* the Desk or the Book; the Scan, the Digest, Settings and
   Annotations are instruments you put *on* what you're in — popups over a background
   location, keeping their real routes. "No fourth room" still holds; an instrument is
   not a room. The cost was the airlock's full-screen form, recorded in DESIGN.md.
14. **One 3D substrate, behind one seam** (2026-08-12, M23 — decided as M26 that same
   day, renumbered to M23 in the same-day reorder that also moved this milestone ahead of
   web search and Codex CLI; see decisions.md). The Desk, the bookshelf, the
   turntable and the book opening are **three.js / React Three Fiber**, sharing a single
   renderer, canvas lifecycle and book asset — not four independent 3D implementations, and
   not a mix of CSS 3D and WebGL across surfaces that sit next to each other. No three.js
   type leaks past that seam. The cost was accepted with eyes open: WebGL does not degrade
   on its own, so **every 3D surface owes a deliberate reduced-motion path and an
   accessibility fallback**, and those are acceptance criteria rather than polish. The
   page fold's own WebGL renderer (M27, was M25) is the precedent that makes this consistent; the
   two must not become two ad-hoc call sites. *A CSS-3D-first alternative was recommended
   and rejected — see decisions.md 2026-08-12 for the reasoning on both sides.*
   *Amended 2026-08-13 (decisions.md), three rules the seam now carries:* **(a) one world
   unit is one CSS pixel**, origin at the viewport's top-left, +X right, +Z down the
   screen, +Y up out of the surface — consumers share the units and bring their own camera,
   never their own units; **(b) depth comes from a real perspective camera**, never from
   faking foreshortening, and on the Desk the plane `y = 0` maps to the viewport 1:1 so a
   book's footprint *is* its DOM hit target (breaking that breaks drag/drop); **(c) every
   3D consumer owes the layering contract** — the one canvas is a fixed `z-index: 0` layer
   that paints over the page, so a surface raises its foreground DOM above it and stands
   its own background down while 3D is on. A lost context stays a designed state, but is
   recoverable: the canvas is sticky across room changes and a real loss retries — and
   because it is sticky, an **idle layer is hidden, not merely stopped**: WebGL keeps
   showing the last frame it drew, so a canvas that only stops rendering leaves the room
   you left painted over the room you went to (2026-08-13, found live).
   *Amended 2026-08-13 (M23 §D):* the shelf is the second camera on this seam and the
   worked example of "consumers bring their own camera, never their own units" — the Desk
   looks *down* at `y = 0`, the shelf looks *along −Z* at `z = 0`, same units, same 1:1
   construction. `SceneLights` is sized for the Desk's downward framing, so a surface
   facing a different way brings its own key light — permitted **only** while the surfaces
   are mutually exclusive view modes, and otherwise a change to `SceneLights`.
   *Amended 2026-08-13 (M23 §E), two rules about **continuity** between surfaces:* a
   surface that *continues an object from another surface* — the opening is the first —
   **borrows that surface's camera rather than bringing one**, because a camera change is
   a discontinuity on the very first frame that no easing afterwards undoes. That is
   affordable precisely because every camera on this seam is the same 1:1-plane
   construction, so a sequence authored once in stage px (x right, y **down**, z toward
   the camera) mounts on either surface through a single frame rotation — which is the
   whole of "one opening, two approaches". Second: **object permanence is a property of
   the handoff, not of the animation.** A room that another room animates into is
   code-split, so it is fetched by the gesture that *precedes* the click
   (`reader/preload.ts`), or the first frame is a blank one however continuous every frame
   after it is.
   *Amended 2026-08-26 (M27), the contract's one exception:* a 3D object that is **in front
   of the page rather than behind it** may raise the whole canvas above the room's chrome, via
   `useScene3DElevated` — the turning page is the only such object, and the test is physical,
   not aesthetic: the sheet has left the leaf, so the far leaf's cover, the reader strip and the
   nav pebble all belong under it. It sits at `z-index: 960` — above `NavCluster`, below the
   `1000` a modal claims, so a dialog still outranks a turning page — and the elevation is
   ref-counted and scoped to the gesture's own mount. **This does not repeal (c)**: every other
   consumer stays scenery behind its room's DOM, which is what the Desk's action card, notepad
   and listening tool are built on. *And it is not the whole of the problem:* a real
   `requestFullscreen()` promotes its element into the browser's **top layer**, where no
   z-index reaches it at all — so the app fullscreens `document.documentElement`, never a room's
   own wrapper, or every root-level fixed layer (the seam's canvas included) stops rendering.
15. **The list view is the library's accessibility floor** (2026-08-12, restating
   DESIGN.md:67-68 as an invariant because a milestone came close to overturning it by
   accident). `LibraryGrid` is the keyboard/screen-reader path for the Desk. New library
   presentations — the 3D shelf, or anything after it — are **additional view modes**, never
   replacements. A library you cannot Tab through is a regression regardless of how it looks.
16. **A highlight kind's identity is its slot, not its presentation** (2026-08-24, M30).
   `rose|sage|honey|slate` are permanent stored values — what the DB, the scan, the filters
   and the vault key off. The **label is a setting; the hue is not.** Labels carry no
   coupling, so readers rename them freely; the four reference hues do, and cannot be handed
   to a colour picker: `theme.css`'s eight theme-ramp hues were *solved* for maximum minimum
   pairwise separation against the four kind hues (~28°, where naive 45° spacing reached
   ~10°), and `scan/scanPalette.ts` carries a second, independent solve for the scan's
   phosphor translation. A free picker makes hue collision the reader's problem on two
   surfaces deliberately engineered so it isn't. Renaming a kind never migrates a row, and
   must never be able to make two kinds indistinguishable on the reader or the scan. Moving
   a kind hue on purpose (M30 moves `slate` blue→purple) means re-running **both** solves and
   recording the new minimum separations. *A fifth kind was offered and declined — the four
   slots already say what was wanted; revisit only when a fifth can be named.*

## Discipline

### Product discipline
- **The highlight is the prompt.** Every AI interaction starts from a selection in the
  text. No free-floating chat box in v1 — it dilutes the core interaction.
  *Bounded 2026-08-24 (M30's Define button, the first canned-prompt button in the app):*
  the app may supply the *question* as well as the selection, but **only where the question
  is fully determined by the selection itself.** "Define this word" is; "summarise this
  chapter" is not — it needs a scope the selection doesn't carry, and is a different
  feature. The rule this preserves is that the reader still chooses the subject by
  selecting it.
- **Beauty is a requirement, not a coat of paint.** Typography, spacing, motion, and
  dark mode are acceptance criteria. A feature that works but looks clumsy is not done.
- **Reading comes first.** Marginalia must be a reader you'd choose even with the AI
  turned off. Never let the AI layer degrade the reading experience (no layout jank,
  no blocking spinners over the text).
- **Vertical slices.** Build the thinnest end-to-end path (import → read → highlight →
  ask → answer → publish to vault) before widening any layer.

### Engineering discipline
- **One narrow seam per subsystem.** `LLMProvider`, `ResourceRenderer` (per format),
  `AnnotationStore`, `VaultCompiler`. New formats and providers are new implementations,
  not new call sites.
- **Anchors follow the W3C Web Annotation model**: exact quote + prefix/suffix context +
  position (CFI for EPUB) as fallback. Anchoring logic gets real unit tests — it is the
  most fragile part of the system. That model has one body and **one or more targets**, so
  an annotation linked to several passages (M35 §D, `thread_anchors`) is a move toward this
  discipline, not away from it — but it is added *additively*, leaving `threads.highlight_id`
  as the primary anchor, because weakening the anchor model to fit a feature is what M32 B
  already refused to do.
- **Structured outputs are schemas.** Every JSON the LLM returns has a validated schema
  (zod). A parse failure is a handled state, never a crash.
- **Local-first.** Everything — library, annotations, vault, TTS — is files/SQLite on
  this machine and survives offline. Cloud dependencies are enumerated, not assumed:
  the LLM endpoint, and web search (M25, off by default). See settled decision 10.
- **Boring core, expressive surface.** Server code stays plain and obvious; spend the
  creativity budget on the UI.

### Working practice
- Significant design choices get a short entry in `docs/decisions.md` (date, decision,
  why) at the time they're made — this is how "settled decisions" above gets amended.
- Ideate in `docs/` before building; a one-page sketch beats a speculative abstraction.
- When a feature touches the reading surface, verify it by actually driving the app
  (import a real EPUB, highlight, ask), not just by tests.
