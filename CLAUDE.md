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
- `docs/marginalia/AUDIO.md` — audio/TTS subsystem spec (engine seam, casting, cache) — **binding for M21+**
- `docs/marginalia/PAGE_CURL.md` — the page curl (M20): the shipped model, its invariants,
  the geometry of what it *cannot* do in 2D, and how the page snapshot is built (§5 — four
  of its lines exist because of failures that render a plausible but wrong bitmap). Read
  before touching `pageFold.ts` or `pageSnapshot.ts`.
- `docs/marginalia/SONNET_PROMPT.md` — kickoff prompt + operator notes for implementation sessions
- `docs/marginalia/M20_STEP4_PROMPT.md` — the kickoff prompt that ran the over-the-spine /
  WebGL design session on 2026-08-03. **Spent** — its question is answered (decisions.md
  2026-08-03 step 4) and the work it opened is now TASKS.md **M25**, parked. Kept as the
  worked example of a design session that opens with a measurement gate; that gate found
  that the fold's own guard had been misreading it twice over.
- `docs/marginalia/NOTES.md` — running log of spec gaps, friction, blockers (create on first use)
- `docs/decisions.md` — decision log (ADR-lite)
- `docs/REFACTORING.md` — why/when/how we refactor, and how success is measured — binding for M19.8
- `docs/SHIPPING.md` — the distribution ladder (localhost → repo → desktop app → private
  deployment → hosted → stores), what each rung costs and the gate that stops it. Nothing
  in it is scheduled; read it before any work justified by "we'll need it when we ship."
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
9. **TTS is local, behind its own seam.** Audio goes through one narrow `TTSEngine`
   interface (`server/src/audio/engine.ts`, spec'd in AUDIO.md), first implemented with
   Kokoro in-process via ONNX — no cloud TTS, no Python sidecar. A more expressive
   GPU engine later is a second implementation, not new call sites.
10. **Local-first, with one named exception per cloud dependency.** The LLM endpoint was
   the only one. Web search (M23) is the second — permitted per-provider, **off by
   default, never silently on**. Any further exception is a decisions.md entry, not a
   pull request.
11. **The model never returns positions.** An extension of decision 2, learned at
   casting: the LLM returns *text* (a quoted string, a concept name) and code locates
   it. Never ask a model for char offsets, indices, or counts and then trust them.
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
14. **One 3D substrate, behind one seam** (2026-08-12, M26). The Desk, the bookshelf, the
   turntable and the book opening are **three.js / React Three Fiber**, sharing a single
   renderer, canvas lifecycle and book asset — not four independent 3D implementations, and
   not a mix of CSS 3D and WebGL across surfaces that sit next to each other. No three.js
   type leaks past that seam. The cost was accepted with eyes open: WebGL does not degrade
   on its own, so **every 3D surface owes a deliberate reduced-motion path and an
   accessibility fallback**, and those are acceptance criteria rather than polish. The
   page fold's own WebGL renderer (M25) is the precedent that makes this consistent; the
   two must not become two ad-hoc call sites. *A CSS-3D-first alternative was recommended
   and rejected — see decisions.md 2026-08-12 for the reasoning on both sides.*
15. **The list view is the library's accessibility floor** (2026-08-12, restating
   DESIGN.md:67-68 as an invariant because a milestone came close to overturning it by
   accident). `LibraryGrid` is the keyboard/screen-reader path for the Desk. New library
   presentations — the 3D shelf, or anything after it — are **additional view modes**, never
   replacements. A library you cannot Tab through is a regression regardless of how it looks.

## Discipline

### Product discipline
- **The highlight is the prompt.** Every AI interaction starts from a selection in the
  text. No free-floating chat box in v1 — it dilutes the core interaction.
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
  most fragile part of the system.
- **Structured outputs are schemas.** Every JSON the LLM returns has a validated schema
  (zod). A parse failure is a handled state, never a crash.
- **Local-first.** Everything — library, annotations, vault, TTS — is files/SQLite on
  this machine and survives offline. Cloud dependencies are enumerated, not assumed:
  the LLM endpoint, and web search (M23, off by default). See settled decision 10.
- **Boring core, expressive surface.** Server code stays plain and obvious; spend the
  creativity budget on the UI.

### Working practice
- Significant design choices get a short entry in `docs/decisions.md` (date, decision,
  why) at the time they're made — this is how "settled decisions" above gets amended.
- Ideate in `docs/` before building; a one-page sketch beats a speculative abstraction.
- When a feature touches the reading surface, verify it by actually driving the app
  (import a real EPUB, highlight, ask), not just by tests.
