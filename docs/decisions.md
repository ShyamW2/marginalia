# Decisions

Short, dated entries. Newest first. Amend CLAUDE.md's "Settled decisions" when one of
these changes the rules.

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
