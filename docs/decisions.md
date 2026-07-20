# Decisions

Short, dated entries. Newest first. Amend CLAUDE.md's "Settled decisions" when one of
these changes the rules.

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
