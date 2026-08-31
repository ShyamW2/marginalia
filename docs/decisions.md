# Decisions

Short, dated entries. Newest first. Amend CLAUDE.md's "Settled decisions" when one of
these changes the rules.

## 2026-09-01 — M35 §C/§D implemented: five gaps the task doc left to the session

Implementing §C ("themes carry quotes") and §D ("an annotation may have many anchors")
in that dependency order (§D's infrastructure before §C5 wires quotes into it, per §D6)
surfaced five places worth recording, none of which overturn a settled decision.

**The annotation panel stays keyed by the primary highlight, not the thread.** §D3 asks
that clicking any linked anchor open the same annotation. The alternative considered was
rekeying `ReaderView.tsx`'s `expandedThread`/`ThreadPanel` by `thread_id` — rejected because
importance/note/kind/panel-position are per-*highlight* columns, and a multi-anchor thread's
secondary anchors (§C5's machine-proposed ones especially) have no meaningful separate
values for any of them. Instead: `listHighlightsWithThreadsForResource` now returns
`primaryHighlightId` (null except on a genuine non-primary anchor), and every click path
resolves through it (`resolveOpenHighlightId`) before opening the panel — while still
**navigating to the specific passage clicked**, not the primary's. The panel's own `< >`
traversal (§D4) moves the reader without touching `expandedThread` at all, so stepping
never remounts the panel or loses its state.

**Offset/length still never reach the client's `Highlight` type — §D4 went through a
dedicated endpoint instead.** The 2026-08-31 (night) entry flagged "revisit when §D... needs
the client to see one." It didn't: `GET /api/threads/:id/anchors` returns just
`{highlightId, exact, spineIndex}` in reading order, computed server-side
(`listHighlightsForThread`'s own `ORDER BY`). `HighlightSchema` stays exactly as narrow as
before.

**§C5's thematic quotes use `kind: "honey"` ("Key quote"), never a new kind.** Settled
decision 16 forbids inventing a fifth slot; `honey`'s existing M30 A label already names
exactly what a theme's evidence quote is, and `slate` ("Thematic Question") was already
taken by the sibling concept (posed questions). `origin: 'reader' | 'thematic'` is the
orthogonal axis that actually distinguishes them from a reader's own marks — never folded
into `kind`, per that same settled decision.

**§C6 (unconditional exclusion) and §C7 (the toggle) gate two different things, not one.**
The count/Annotations list/vault publish exclude `origin: 'thematic'` rows always,
regardless of the toggle — a machine proposal is never "yours" no matter what's currently
painted. The toggle instead gates whether those rows are fetched/rendered as marks at all
(`GET /:id/highlights` and the Scan's Mine layer). Conflating the two would have meant a
toggle-on session briefly inflating the reader's own highlight count.

**`persistThematicHighlights` guards against a highlight already anchoring a thread before
calling `addThreadAnchor`.** `thread_anchors`' primary key is `(thread_id, highlight_id)`,
and nothing stops two different themes proposing the identical quote (a re-run under a
changed brief, or two themes genuinely sharing a passage) from resolving to the same
existing highlight via `findHighlightByExact`. Re-adding it to the same thread would throw;
adding it to a *different* thread would let one highlight anchor two annotations, which
§D3's `primaryHighlightId` join doesn't expect. `threads.ts`'s new `isHighlightAnchored`
filters such highlights out before a thread is formed for that theme — a normal case
(nothing new to do), not an error.

Migrations landed in this order: 33 (§C4's drop-and-clear), 34 (§D1's `thread_anchors`),
35 (§C5's `highlights.origin`), 36 (§C7's `show_thematic_quotes`) — §D's infrastructure
before §C5 needed it, matching §D6.

## 2026-08-31 (night) — M35 §A/§B implemented: three gaps the task doc left to the session

Implementing §A ("offsets, stored") and §B ("a quote survives the merge") surfaced three
places TASKS.md described the *what* but not the *how*. Recorded here per "significant
design choices get a short entry," not because any of them overturn a settled decision.

**`offset`/`length` are server-only, same as `anchor_source`.** §A2 says store both
representations, not which one the API schema carries. Nothing in §A or §B renders an
offset — `HighlightSchema` doesn't gain the fields, mirroring migration 28's own precedent
("nothing renders it yet"). Revisit when §D (`<>` traversal, ordered by `spineIndex, offset`)
or §E (zones) actually needs the client to see one.

**§B2's fallback only fires for a *real* quote that fails to locate.** The chapter-anchor
route has a second caller the task doc doesn't mention: the Scan's book-band click-through
(`ScanPage.tsx`'s `handleOpenChapter`) sends an **empty** quote on purpose, to land on the
chapter's own opening — it was already relying on `chapterStartAnchor`'s fallback, not a
posed question's failure. Routing every miss to a chapter question would have silently
broken "click a band, land at the chapter start." The route now branches on whether a quote
was given at all: empty → `chapterStartAnchor`, exactly as before; non-empty and unlocatable
→ §B2's new chapter-question path. `anchor_source: 'chapter_start'` now means only the
former.

**§B2's seed never clobbers the reader's own chapter question.** `chapter_questions` is one
row per chapter, and `upsertChapterQuestion` (the reader's own PUT) always overwrites. A
posed question that can't be pinned to a passage still isn't allowed to overwrite something
the reader typed — `seedChapterQuestionIfAbsent` only fills an empty slot (`ON CONFLICT DO
NOTHING`, then re-read). If the reader already has a question there, the posed one is
dropped rather than shown; no UI currently surfaces "a posed question failed silently,"
which is an acceptable gap for a first implementation but worth flagging for polish.

**§B3's "one per part, up to 3" reads literally: at most one question per part, in part
order, capped at `MAX_QUESTIONS`.** A 4-part chapter contributes from only its first 3
parts; a part with zero surviving questions contributes none. This was chosen over "rank
all candidates and take the best 3" because ranking needs the chapter text, which is
exactly what the merge call doesn't have — the same reason it can't verify a quote either.

## 2026-08-31 (evening) — A/B on one model swap: what a weak digest model actually costs

Ran the same six East of Eden chapters through **GPT 5.6 Luna** (codex-cli, 272K context →
238,000-char map budget, so **nothing splits**) and compared against the Qwen3.5 rows from
earlier the same day. Same chapters, same text, same prompt, same schema; only the model
changed. The Qwen rows were exported before being cleared and both datasets are kept.

| | quotes raw | + folding | themes | analysis | per chapter |
|---|---|---|---|---|---|
| **Qwen3.5** (local, 4 of 6 split) | 5/17 (29%) | 12/17 (71%) | 8.0 | 746 ch | ~150s |
| **GPT 5.6 Luna** (0 split) | **17/18 (94%)** | 17/18 (94%) | 8.0 | 1083 ch | **~16s** |

### B1b and C3b are weak-model compensations, not universal hardening

⚠️ **Folding gains Luna exactly nothing — raw and folded are both 17/18.** Luna reproduces
curly typography byte-for-byte; Qwen tidies it. The same reclassification applies to theme
naming: Luna returns clean 2–4 word noun phrases ("Secrecy and revelation", "Mercy versus
justice") with no prompt change, while Qwen was *inconsistent across books* — long theses on
Kafka, bare single words ("Secrets", "Guilt") on East of Eden.

**How to apply:** keep both fixes, but stop describing them as provider-agnostic robustness.
They are what makes the **cheap local digest role viable**, which is the thing provider roles
exist for — so they are worth building, and they are the *first* things to re-measure after
any digest-role change. `measure` is the tool for that.

### Model quality dominates the merge, and the merge is a local-path problem only

Isolating the merge on the two chapters Qwen did **not** split (25, 46 — no merge on either
side): Qwen 2/6 raw and 5/6 folded, Luna 6/6 raw. So Qwen trails even with the merge removed
entirely. Ordering of causes, largest first: **model quality → the merge → the matcher.**
M35 §B3 stands, with its scope narrowed: a 272K-context model never splits anything in this
library, so B3 is a fix for the local path exclusively.

### §C0 is mandatory, and this is the evidence

Cross-chapter theme overlap over six chapters, per model:

| | unique themes | exact repeats | mean pairwise Jaccard |
|---|---|---|---|
| Luna | 48 of 48 | **0** | **0.000** |
| Qwen | 48 of 48 | **0** | **0.000** |

⚠️ **Raw theme strings never repeat across chapters — now confirmed on two books and two
models, one of them frontier-class.** This is not a weak-model artifact; it is inherent to
asking for per-chapter theme names in independent calls. So M34 §C's ranking signal without
distillation is not "weak", it is **exactly zero**, and §C0 (chaining
`runThemeDistillation` onto a thematic run) is a precondition rather than an improvement.

### A caveat this run puts on the "counts are constants" finding

Luna independently returned **8 themes on all six** EoE chapters — the ceiling — as Qwen did.
Two very different models converging on the cap, while Qwen sat at 7 (below cap) for every
Kafka chapter, is better explained by **the cap binding on this book** than by "the model is
not measuring the chapter". ⚠️ The earlier entry's reasoning is therefore weakened for East
of Eden, though its *conclusion* for M35 §C3 is not: a length-scaled ceiling still buys
nothing, because whatever varies is not varying with length. **The settling test is one line
— raise `MAX_THEMES` to 12 and re-run one chapter of each book.** Do that before writing any
more prose about what the counts mean.

## 2026-08-31 (later still) — The merge measured: it does corrupt quotes, and half the damage was our own matcher

Ran the live pass the entry below asked for: four of East of Eden's sixteen splitting
chapters (spine 9, 22, 48, 61 — 30K–46K chars, each split into two parts and merged), on the
real digest role, sequentially. ~2.5 min per chapter. It answered §0c and found something
§0c wasn't looking for.

### The result, and the confound that isn't one

⚠️ **Amended within the hour — the first reading of this was wrong, and the correction
matters more than the original.** The table as first written compared Kafka-unsplit (9/9)
against EoE-merged (3/11) and concluded the merge was the discriminator. A control run of
**two unsplit *long* EoE chapters** (spine 25 at 25,941 chars, spine 46 at 24,500 — 85–90%
of budget) came back **2/6 raw**, nearly as bad as the merged ones. So the raw rate splits
by **book**, not by merge, and the typesetting check below (curly-vs-straight counts) was
too coarse to catch it.

**The merge conclusion survives, but only once the matcher is fixed — and that ordering is
the whole lesson.** With typographic normalization applied, every unsplit failure disappears
and every residual failure is from a merged chapter:

| | n | today's matcher | normalized |
|---|---|---|---|
| **unsplit** (Kafka 9 + EoE 6) | 15 | 11/15 (73%) | **15/15 (100%)** |
| **split/merged** (EoE) | 11 | 3/11 (27%) | **7/11 (64%)** |

All four residual failures are from split chapters; none from unsplit. **How to apply:** the
matcher bug was large enough to swamp the signal it sat on top of, and it happened to
correlate with the book. Any quote-fidelity comparison run before M35 §B1b lands is
measuring the matcher, not the model — including the 9/9 that made Kafka look perfect and
the 3/11 that indicted the merge. `mergeThematicParts` asking the model in English not to
paraphrase is not holding, which is what settled decision 2 predicts of any rule enforced by
instruction where code could enforce it structurally.

### Half of it was ours: the matcher is stricter than the anchor model needs

Splitting the failures by *kind* changed the conclusion. Four of the eight are not paraphrase
at all — the model transcribed faithfully and **normalized the punctuation**, and
`locateQuoteAnchor`'s two tiers (exact substring, then whitespace-normalized) fold neither
quotes nor dashes. Folding `’→'`, `—→-` and `…→...` on both sides before matching takes the
merged rate from **27% to 64%** with no prompt change and no provider change.

**How to apply:** do this first and independently (M35 §B1b). It is ~10 lines, it hardens
against any model that tidies punctuation, and — the part that matters beyond this
milestone — **every quote-location number measured before it is an undercount**, including
the 9/9 that made the unsplit path look perfect.

### The other half is real rewriting, so §B3 is confirmed

Verified against the book text:

| model returned | book says | error |
|---|---|---|
| `Charles won't be going, said Cyrus.` | `"Charles won't be going," Cyrus said.` | speech tag reordered, internal quotes dropped |
| `Cathy had the inhuman attribute…` | `She had the inhuman attribute…` | pronoun replaced with the character's name |
| `…every single thing. He's—how old?` | `…every single thing. I'd even tell him why you didn't tell him before. He's—how old?` | sentence elided, reply spliced across a paragraph break |

Normalization cannot reach any of these. Carrying the parts' original `quote` strings through
**in code** does, because the string is never re-emitted — so M35 §B3 moves from "build only
if measured" to confirmed, and B1a's context bump is reclassified: it removes the merge from
20 of 21 sections library-wide and is still worth doing, but it narrows the blast radius
rather than fixing the mechanism.

### And a correction to the ceiling reading below

The four merged chapters returned **8, 8, 8, 8 themes** against Kafka's unsplit 7, 7, 7 —
which first read as a merge artifact (`THEMATIC_MERGE_INSTRUCTIONS` dedupes two lists "at
most 8"). ⚠️ **The control run killed that explanation too:** the two *unsplit* EoE chapters
also returned **8 and 8**. So it is **8 for East of Eden and 7 for Kafka regardless of the
merge** — a per-book constant, still with zero within-book variance. Length remains a live
explanation (EoE's chapters are 24–46K, Kafka's 7–12.5K, so any threshold between 12.5K and
24.5K fits) and so does book character; separating them needs a **Kafka chapter of ~25K**.
The same correction applies to analysis length: EoE analyses run ~650–830 chars split *and*
unsplit, against Kafka's 1,500–1,970 — also the book, not the merge.

**What survives, and is the only part M35 §C3 depends on:** the counts do not vary *within* a
book, across a 1.8× length spread on Kafka and a 1.9× spread on EoE. A length-scaled ceiling
still buys nothing.

## 2026-08-31 (later) — M34 §0 measured: three findings, and a ceiling that wasn't the problem

The measurement gate ran (`pnpm --filter @marginalia/server measure`). It corrected the
entry below on three points, which is what a gate is for. TASKS.md M34 §C3 and M35 §B1/§C3
amended in place.

### The digest role is not "a local 8K model", and the split rate is a setting

Qwen3.5-hermes on local Ollama, declared **32,768** tokens — a 28,672-char map budget, not
7,000. Splits: Kafka 1/55, Alice 1/14, East of Eden **16/67**, Metamorphosis 3/5. So the
merge path is neither dead nor dominant, and **neither branch of §0c's fork held**.

⚠️ **But the split rate is one setting, not a fact about the model.** The profile declares
32,768 while the model's own Modelfile sets `num_ctx 65536` on a 262K-native model — the app
under-declares by half, so nothing is truncated today; we simply chunk twice as often as
necessary. At a declared 65,536 the budget is 57,344 chars and **20 of the 21 splitting
sections stop splitting** (East of Eden 16→0). **How to apply:** try the setting before
building the code fix. M35 §B3 (moving question selection out of the merge call) is correct
regardless, but it may be defending a path that no longer runs. §B2 — never falling back to
`chapterStartAnchor` — is worth doing either way; a wrong anchor is worse than no anchor.

Quote fidelity so far is 9/9, **all from unsplit chapters**, so the merge is still entirely
unmeasured. The next measurement is East of Eden's *split* chapters specifically — more
Kafka grows n without touching the question.

### The ceiling was the wrong thing to watch: the counts are constants

Across chapters of 6,903 / 12,367 / 12,529 chars the model returned **7, 7, 7 themes and
3, 3, 3 questions**. Themes never reached their ceiling of 8; questions sat on theirs.

⚠️ **Zero variance across a 1.8× length spread is a stronger result than saturation would
have been** — it says the model is not measuring the chapter at all. So the entry below's
"set the budget in code from chapter length" is only half right: it correctly refuses to ask
the model to choose, but a length-scaled ceiling just swaps one constant for another that
code picked, and would be *presented* as content-sensitivity it does not have.

**Decided instead: evidence is the limit, not the count.** M35 §C1 already requires a
locatable verbatim quote per theme; code drops the ones that fail. A thin chapter cannot
evidence seven themes, a dense one can, and the surviving count becomes a property of the
chapter rather than of the prompt — settled decision 2 applied to counting. **And for the
index use, uniform counts are a feature:** if long chapters carry more themes they overlap
with more things, so length becomes a confound in M34 §C's ranking. Questions are the
opposite case, because the reader sees them, so there the filter should be free to leave a
thin chapter showing one.

### The themes are theses, not names — which is why M34 §C had to rank on parents

Kafka's three analysed chapters are all about fate and share **zero** strings: "Fate as
internal storm rather than external obstacle" / "Fate as pull rather than choice (Shikoku)"
/ "Fate as an unexplainable intrusion into ordinary life". `thematicInstructions` asks for
"short theme or motif names" and is getting 6–12 word analytical claims.

This is the operator's own objection ("the initially extracted themes might be too nuanced,
so we never select a chapter") measured rather than hypothesised, and it makes §C3's
"rank on distilled parent themes" not a preference but the only workable input. It also
degrades three shipped things quietly: `themeTagging` is handed a vocabulary of unique
essay-fragments to "pick from this exact list"; the Scan's theme filter would hold 7 × N
distinct sentences; and distillation is asked to fold theses into parents. **Decided:** fix
the prompt to produce a 2–4 word noun phrase (M35 §C3b), and keep the nuance in the analysis
prose, where it already lives.

⚠️ **And the ranking input does not exist yet:** `book_themes` and `canonical_themes` are
**empty for every book** — `runThemeDistillation` has never run. M34 §C would ship ranking
nothing and silently falling back to "current + previous". Run distillation as a
precondition, or ship §C knowing that is its real behaviour.

### Resolved same day — distillation becomes part of a thematic run

The operator's call, and it is the right shape: **chain `runThemeDistillation` onto the end
of a thematic run.** The precedent is one layer over — `runDigest` already ends with
`reduceBookDigest` inside the same job; the thematic layer simply never grew its equivalent,
which is why a pass with its own endpoint, job type and button has sat unpressed since
M24.5. Best-effort, like `maybeRefreshBookDigestSnapshot`: chapters are already committed, so
a failed distillation logs and leaves the run completed. The standalone endpoint stays.

**Why this is enough to fix matching on its own, ahead of the theme-naming fix:**
`theme_parents` maps each chapter theme *string* to a parent id, and ranking compares parent
ids — so ugly children still work. That separates cleanly: **distillation fixes matching;
M35 §C3b fixes display and tagging** (the Scan's filter key and `themeTagging`'s "pick from
this exact list", both of which put raw theme strings in front of a human or a model). They
are independent wins and M34 §C is not blocked on M35.

⚠️ **One refinement it needs, or it fails the other way.** With 6–8 parents and 7 themes per
chapter, most chapters will share most parents, and set overlap then selects *everything* —
the operator's second failure mode, mirroring raw themes selecting nothing. So rank on a
**weighted parent vector**: count how many of a chapter's themes land under each parent. A
chapter with 4 of 7 themes under "Fate" is more about fate than one with 1 of 7. The weight
is a **code-computed count**, which is the honest form of the vector idea this log rejected
in its LLM-scored form — the objection there was never "vectors", it was "numbers the model
made up with no shared calibration". Recorded as M34 §C0/§C0a.

### Three open questions closed by the operator

- **M35 §C4 — drop and re-run, do not migrate.** The theme column changes shape *and* its
  contents are rewritten, so a migrated row carries the old prompt's theses in the new shape.
  Three rows exist library-wide. ⚠️ Clear `book_themes`/`theme_parents` too — their children
  are keyed on theme strings that will no longer exist — but never `canonical_themes`, which
  is library-wide memory holding the colour assignments.
- **M35 §D5 — an anchor deletes, not the thread.** The thread survives while ≥1 anchor
  remains; the last anchor takes it with it, which is today's behaviour unchanged for
  one-anchor threads. ⚠️ Deleting the *primary* anchor while others remain must promote the
  next to primary rather than cascade. The vault publish writes **one note with its sources
  in reading order** — a multi-anchor annotation is one thought about several passages, and
  splitting it at publish time would undo the feature in the projection.
- **M36 §A4 — glossary only.** A definition the reader has also noted on stays out of
  Annotations, note shown in the glossary entry. `isGlossaryEntry` is the whole test; a
  "…unless it has a note" clause would put the same word back in two lists.

## 2026-08-31 — The LLM layer, measured: what the Digest rung sends, what a quote can know, and what caching actually costs

Operator-initiated design review after M32, covering five areas the operator named: query
context modes, multi-anchor annotations, thematic quotes, the glossary, and caching. It
opens with numbers because two of the three premises we started from changed once they were
measured. **Everything below was measured against the real library SQLite, not estimated
from the code.** Becomes TASKS.md M34–M37.

### What the rungs actually cost

Rendered context sizes, extrapolating each book's own measured per-chapter averages to full
coverage:

| Book | Sections | **Full** | **Digest** | summaries / thematic / local pages |
|---|---:|---:|---:|---|
| Kafka on the Shore | 55 | 278K tok | 61K | 11K / **34K** / 15K |
| East of Eden | 67 | 345K | ~70K | 13K / ~42K / 15K |
| Metamorphosis | 5 | 39K | 25K | 0.8K / — / **24K** |
| Alice | 14 | 47K | 14K | 2.9K / — / 10K |

**Finding 1 — the thematic layer is the Digest rung's bulk, and the chapter summaries are
not.** A chapter summary renders at ~190 tokens; a thematic analysis at ~618. On a fully
analysed Kafka that is 11K against 34K — the thematic block is **55% of the whole rung**.
Trimming chapter summaries, the intuition we started with, saves almost nothing. Also worth
recording: on a short book the rung barely exists — 24K of Metamorphosis's 25K is the three
full sections around the highlight, so Digest only earns its name on long books.

**Finding 2 — the Digest rung is cache-hostile and Full is not.** `bookContext` is one
string with one `cache_control` breakpoint at its end (`anthropic.ts:80`), and
`buildDigestContext` *ends* that string with `FULL TEXT AROUND THE HIGHLIGHT`, which changes
whenever the reader highlights in a different chapter. Anthropic caching is a strict prefix
match terminating at the first difference, so the digest block in front of that tail is
never read back. Full mode, on a book that fits without windowing, is byte-stable and caches
completely.

⚠️ **The consequence, stated plainly because it inverts the rung's purpose:** on Opus 5
pricing, a question in a chapter the reader has just moved into costs ~$0.38 on Digest and
~$0.14 on Full-with-a-warm-cache. **The token-saving rung is currently the more expensive
one for the ordinary act of reading forward.** This is a placement bug, not a design
question, and it is the highest-value item in the whole review.

**Finding 3 — the spoiler mask exists in three places and is missing from two.**

| Consumer | Reads | Masked? |
|---|---|---|
| Digest page (`buildDigestStatus`) | all chapters + book digest | yes — redacted server-side, with a reveal list |
| Scan Book layer (`annotations/scan.ts:97`) | chapter + thematic themes | yes — including theme *names* |
| Book digest snapshot (`build.ts:526`) | chapters ≤ bookmark | yes — the table exists for this |
| **Query, Digest rung (`threads.ts:83`)** | every chapter summary + every thematic analysis | **no** |
| **Define (`define.ts:233`)** | full synopsis + full cast + nearest summaries + every occurrence of the term in the book | **no** |
| Audio casting (`audio.ts:280`) | full book digest + cast | no — **correctly**; see below |

So the anti-spoiler promise on the query path is enforced by a sentence in
`READING_COMPANION_INSTRUCTIONS` while the spoilers themselves sit in the context. We are
paying for tokens we have instructed the model to ignore. Casting is a legitimate exception
and the rule that makes it one is worth naming: **the mask belongs at the point of reading,
not the point of generating.** Casting needs chapter 40's character to have a voice before
the reader reaches chapter 40, and its output is voice assignments rather than prose.

### The correction: a character offset into `resource_text` cannot rot

Raised in review as "positions rot, which is why anchors are quote + prefix/suffix." That
conflated two different coordinate systems and the operator was right to push back.

- `resource_text` is **immutable on import** (settled decision 5). An offset into it is
  stable forever. Font size, window width, the M14 margin setting and spread mode repaginate
  the *rendered page*; they do not touch the source string.
- What the W3C quote+context model actually buys us is different: a reader's highlight is
  *born* from a DOM selection and must be re-found in the DOM to be painted, and the
  server's plain-text extraction and the rendered DOM are not the same string.
- The machinery already exists and already computes offsets — `sectionOffsets.ts`'s
  `locateAnchor` returns `{spineIndex, offset, globalOffset, percent}`, which search and the
  Scan both consume. It is computed at runtime and thrown away.

⚠️ **Settled decision 11 is not in the way of this, and the distinction is worth writing
down because it was nearly got wrong here.** Decision 11 bans trusting numbers *the model
returns*. A number **code computes** by locating model-returned text is the decision being
followed, not bent — it is exactly what `locateQuoteAnchor` already does for posed
questions. CLAUDE.md gains a sentence saying so.

**Decided:** store both, with distinct jobs. `offset` + `length` into the section's text is
the canonical position — ordering, ranges, Scan zones, dedup, click-to-jump, "does this
theme span 40–70% of the chapter". `exact` + `prefix`/`suffix` is what the client needs to
paint it. They are not competing representations. A stored offset also lets a quote be
**verified at generation time** rather than failing silently weeks later.

### Decisions taken

**Spoiler-gating is its own axis, not a property of the cost rung.** The reader gets a
lookahead/spoilers toggle that is independent of Off/Digest/Full, applied structurally
(filter at `spine_index <= bookmark`) on every reader-facing consumer including Full — which
today is the leakiest rung of all, shipping the literal text of unread chapters. *Rejected:*
coupling it to the ladder ("Full means spoilers"), because someone rereading a finished book
wants no mask at any rung, and someone mid-book wants one at every rung.

**The Digest rung sends every chapter's theme *labels* and a few chapters' theme *essays*.**
Chapter summaries already carry a `themes: []` list, at ~190 tokens each, so the model can
see that a motif runs through chapters 10, 14 and 15 without reading three essays about it.
Full thematic prose goes only to the highlight's chapter, the previous one, and chapters
selected by theme relevance. *Rejected:* collapsing Digest to the current chapter — that is
the Off rung with extra steps, and Off already exists.

**Selection matches distilled parent themes, never raw chapter themes.** Raw chapter themes
are either too specific to ever match or too generic to discriminate — the operator's
objection, and correct. M24.5 already built the fix: `book_themes` / `theme_parents` fold
chapter themes under 6–8 book-level parents. Matching on parents also means selection and
the Scan's filter agree by construction, since they draw on the same vocabulary. Cap 8–9
chapters. **No recency weighting** — the mask already removes everything ahead, and the
current and previous chapters are unconditional, which is a recency floor with no knob to
mistune.

**Context is a list of blocks with cache markers, not one string.**
`LLMStreamRequest.bookContext: string` becomes `ContextBlock[]`, with stable material first
and varying material last, and a marker at the boundary. Anthropic maps blocks to system
blocks with up to 4 breakpoints; every other provider concatenates and ignores the marker.
**This is provider-agnostic in benefit, not an Anthropic special case:** llama.cpp-backed
local servers reuse the KV cache for the longest common prefix, so the same ordering saves
prefill time locally where it saves money on Anthropic. Settled decision 1 is satisfied —
`cache` is a hint on a shared shape, not a provider concept leaking through the seam.

**Cache TTL for the query role is 1 hour, not the 5-minute default.** A cache read refreshes
the timer for free, so continuous questioning keeps a 5-minute entry alive indefinitely; but
a reader who reads a chapter for twenty minutes and *then* asks has always missed it. That
is precisely the 5–60 minute gap where the 1h TTL's doubled write price (2× rather than
1.25×) pays off. It needs three requests to break even instead of two.

**Theme zones are two sentences and four sanity checks.** For sub-chapter theme location the
model returns the sentence a theme *starts* at and the sentence it *ends* at — text, not
numbers — and code locates both. A zone is kept only if: both endpoints locate, start
precedes end, the span sits inside the chapter, and it does not exceed a set fraction of the
chapter (a "zone" covering 95% is the model shrugging). Any failure drops the zone and keeps
the theme at chapter resolution. Cheaper than asking for many quotes and degrades to today's
behaviour rather than to bad data.

**The Scan may render sub-chapter data precisely — under a named condition.** This amends
this log's own 2026-07-29 (addendum) ruling that the Book layer must never be drawn in the
Mine layer's precise register. ⚠️ **That rule is not being overturned, it is being scoped.**
Its reason was that *chapter-resolution* data drawn precisely claims accuracy it does not
have — and a quote-anchored zone that passed the four checks above is no longer
chapter-resolution. The condition is the checks: a theme with no surviving zone still
renders as today's quantised chapter-wide band, in the same view, at the same time. A click
on a zone opens the reader at its start offset, reusing the search-hit jump path.

**An annotation may have many anchors.** Today `threads.highlight_id` is `UNIQUE` — one
thread, one highlight, permanently. The W3C Web Annotation model CLAUDE.md already commits
to has one body and *one or more* targets, so this is a move toward the stated discipline,
not away from it. Implemented additively as `thread_anchors(thread_id, highlight_id,
ordinal)`, keeping `threads.highlight_id` as the primary anchor so no existing path changes;
backfill is one row per existing thread. Traversal order is `spineIndex, offset` — which is
another thing the stored offset is for.

**Machine-proposed quotes are highlight rows with an origin, not a new table.** Migration
26's own comment is the precedent: `definition` rides on the highlight rather than becoming
a `definitions` table, so the glossary is "a filtered view, one predicate" and
`deleteHighlight` cleans up with no cascade to forget. A quote stored as a highlight with
`origin: 'reader' | 'thematic'` inherits rendering, anchoring, the Scan, jump-to and
deletion for free. ⚠️ **The cost, recorded so it is not discovered late:** it pollutes
highlight counts, the Scan's Mine layer and the vault publish unless all of them apply the
same filter. One exported predicate, used everywhere — the same discipline the glossary fix
below needs.

**Budgets are set in code from chapter length; the model is never asked to choose one.**
Both for theme/quote counts per chapter and for the substrate cap. Models reliably fill to
whatever maximum they are given and rarely come in under, so "decide how many this chapter
warrants" is a decorative instruction. Code measures the chapter, puts the number in the
prompt ("this chapter is ~4,000 words; identify 2–4 themes") and sets the schema max to
match. The operator's point that a thematically loaded short chapter deserves more than a
long flat one is real but unknowable before reading; length is the only proxy available at
budget time, and whether the model ever comes in under its ceiling is one of the two
measurements below.

**The thematic substrate is append-only, with a length-scaled cap.** A brief-blind, one-time
extraction per chapter — verbatim passages with a line of context, the chapter's claims and
tensions, who holds which position — which brief-driven passes read *instead of* the raw
chapter. It exists because this log's 2026-07-29 (later) claim that "the thematic layer is
cheap to re-run" is **false as implemented**: changing a brief re-reads every chapter at
full text for exactly what the first run cost. Two rules: a full re-read stays available and
is named as such in the UI ("re-read the book" vs "re-read my notes"), because a brief-blind
extractor cannot know which passage a future brief will need; and quotes surfaced by any
full re-read merge back into the substrate, so the bank grows toward what this reader keeps
caring about. ⚠️ Append-only converges on being the chapter again — the cap is a hard
requirement, not a nicety, with eviction of quotes no brief has ever drawn on.

### Raised and deliberately not scheduled

- **LLM-answered chapter questions.** M32 B gave a chapter-level question a hand-written
  note and no model path. Answering one needs a sibling to `resolveContext` that takes a
  chapter rather than a `Highlight` — cheap to build — but it also needs CLAUDE.md's "the
  highlight is the prompt" bounded a second time (the reader supplies the question and the
  *chapter* is the selection), and its own storage, since M32 B deliberately refused to
  weaken the anchor model. **Not started from this list**; it is a decision before it is a
  task.
- **LLM-generated theme score vectors — rejected.** Asking the model for a per-theme score
  is asking for a number, and worse, each chapter's thematic call is independent, so
  chapter 3's "0.7" and chapter 40's "0.7" were produced with no shared calibration. A dot
  product over them is arithmetic on noise that looks like a metric. Theme-set overlap over
  the distilled parent vocabulary is honest, deterministic, and already computed.
- **A local embedding seam — conditional, not scheduled.** If parent-theme overlap proves
  too coarse in practice, the next step is a small ONNX embedding model over the *stored
  analyses* (never a re-read of the book) behind an `EmbeddingEngine` seam beside
  `TTSEngine`, keeping settled decision 10 intact. Measure the free version first.

### The two measurements this arc opens with

Both are cheap, both are currently guesses, and both change how much work the plan deserves.
They land first so data accrues while M34 is built.

1. **The anchor fallback rate.** `routes/digest.ts:510` is a bare
   `locateQuoteAnchor(...) ?? chapterStartAnchor(...)` with no record of which fired. If a
   quote fails to locate, the reader gets a highlight parked on the chapter's first 120
   characters with no relation to the question — the "ungrounded annotation" the operator
   reported. ⚠️ **The suspected cause is provider-dependent, which is why it must be measured
   rather than reasoned about:** on Opus 5 a chapter never splits (budget ~875K chars) and a
   quote comes from text the model just read; on a local 8K model nearly every chapter
   splits, and every quote then passes through `mergeThematicParts` — a call containing *no
   chapter text*, instructed in English not to paraphrase. Provider roles exist precisely so
   digests run locally, so the merge path is likely the common one.
2. **Whether the model ever comes in under a theme/quote ceiling.** Decides whether "dynamic
   counts" is a real behaviour or whether the code-set cap is doing all the work.

### Defects found while reading the code

- `upsertChapterQuestion` (M32 B) is one row per `(resource, chapter)` and **replaces**
  `question` on write, so a second question about a chapter silently destroys the first
  while its `note` stays attached to a question that no longer exists.
- `AnnotationsOverview.tsx` does no kind filtering at all, so Define's glossary entries
  appear in both the glossary and the annotations list. `Glossary.tsx` already holds the
  exact predicate; it is not exported.
- `define.ts`'s context is unmasked (above), and is the widest spoiler surface in the app
  for a feature whose output is under 100 tokens.

## 2026-08-27 (yet later) — M32 landed; a chip-text bug found live along the way

M32 (TASKS.md) built as scoped: the chapter-end affordance (`ChapterEndPrompt.tsx`, wired
into `ReaderView.tsx`'s `handleRelocated`) is a plain read of the existing thematic layer —
it never starts a job from the reading path — and the one new storage shape
(`chapter_questions`, migration 27) gives the reader their own chapter-level question with
an autosaved note, reusing `setHighlightNote`'s exact debounce. Its "re-findable" home is the
digest page, which already lists both kinds of question per chapter (`ChapterQuestionBox.tsx`
alongside the existing AI-posed ones); `createChapterAnchor`/`fetchThematicStatus` were pulled
out of `DigestPage.tsx` into `digest/digestApi.ts` so the reader could reuse them instead of a
second implementation.

Verified live against the real dev server and library book (not just `vitest`): the two new
endpoints round-tripped over `curl`, and a synthetic `thematic_digests` row (inserted, then
removed) drove the actual reader in a headless browser across a real chapter boundary. That
pass surfaced a real bug, unrelated to this milestone's own code: `.questionChip`'s resting
state (`DigestPage.module.css`, and copied into the new `ChapterEndPrompt.module.css`) coloured
its label with `--color-accent-text` — a token `useAccent.ts` derives to read *on top of* a
solid `--color-accent` fill, not over the page's own paper background the chip actually sits
on at rest. Under this profile's configured accent, that resolved to white text on a light
background — invisible. Fixed in both places to the plain `--color-text` token; left
`:hover`'s `color: var(--color-bg)` alone (that state's background genuinely is the accent
fill). All test-seeded rows and the one highlight created while clicking through were deleted
afterward — the library's real annotation count was checked back to 7 before and after.

## 2026-08-27 (even later) — M31 C6: the pinch resizes the reader, not the setting

DESIGN.md names the pinch-to-resize instrument "an instrument, not a setting", framed there
as a *behavioural* rule (the page doesn't reflow live, the reader gets a dial instead of a
form field). Building it surfaced a second reading of the same words worth deciding on
purpose rather than by default: does a pinch's resize **persist** past this reading session,
the way Settings' own text-size `Slider` does?

It does not, as shipped. `setReaderFontScale` is called once on release — the existing
`readerFontScale` effect reflows the page exactly as it would for any other change to that
state, and the size holds for the rest of this session (surviving further page turns, room
changes, anything short of a reload) — but nothing writes it to `/api/settings`. Reopening
the book, or reloading the tab, reverts to whatever Settings last saved.

**Why:** Settings' save path (`SettingsPage.tsx`'s `handleSave`) is a whole-object `PUT` — it
sends the entire form, not a delta. `ReaderView.tsx` never writes to that endpoint today (it
only ever reads it, at mount and via `settingsBus`); giving the reader itself a footgun that
can silently overwrite whatever else is in Settings — a stale font-scale form value never
mind — the moment a reader pinches, felt like a second, undiscussed API decision arriving
inside a gesture-implementation task, not a refusal of the feature. The instrument still does
everything DESIGN.md specifies live: readout, sample text, blur, clamp, reflow-once-on-release
— it just doesn't survive a reload.

**How to apply:** if a future session decides pinch-set text size should persist, the shape
is either (a) give the reader a narrow, single-field PATCH endpoint rather than routing
through the whole-object `PUT`, or (b) have the reader fetch-then-merge before writing the
full object back, mirroring what Settings' own form already holds. Either is a real API
change and belongs to its own task, not folded silently into a gesture's commit handler.

## 2026-08-27 (later still) — M31 A/B: three calls the pointer contract left open

Implementing the contract (DESIGN.md, "The pointer contract") turned up three questions it
does not answer. None of them reopens the rule; all three are recorded so they are not
re-litigated in C.

**1. Over paper, the glow lights on both edges at once.** M31 A6 says the turn-zone vignette
must stop advertising click-to-turn, and that "the glow follows the grabbable paper" — but
paper is now the whole page outside the ink, and the direction is no longer a property of
*where* you press. Lighting one side would be advertising a direction the page does not have
until the drag says so. Both ellipses now light together, and only while the pointer is on
grabbable paper. The statement is "the sheet can be taken here", not "this side goes
forward". ⚠️ If a directional affordance is ever wanted again it belongs to the *drag*, not
the hover — a hint that appears once the axis has declared.

**2. Reduced motion keeps drag-to-turn.** The grab surface used to be suppressed entirely
under `prefers-reduced-motion` — reasonable while there was a click-turn to fall back on,
and a silent removal the moment M31 A1 retired the click. Those readers would have been left
with the `‹ ›` buttons and the arrow keys and nothing on the page itself. The gesture is now
identical for everyone; the drag commits an instant turn instead of a peel, which is what
`resolveRenderer`'s "instant" already meant. **The rule this sets: a gesture in the pointer
contract is not an animation, so reduced motion may drop the animation and never the
gesture.**

**3. Touch is not armed until M31 C, and the cost is accepted.** The grab surface's
`pointer-events` follow a live ink/paper hit-test driven by pointer *moves*. Touch has no
hover moves, so arming for a finger means arming by default — every touch anywhere on the
page landing on a parent-document overlay instead of the text, which is invariant 1 broken
for touch exactly as it was for the mouse. The surface is therefore armed for mouse and pen
only. ⚠️ **This removes something that works on the iPad today**: a touch-drag on M20's edge
ellipse used to start a curl. It is deliberate — the touch table says a drag *anywhere*
turns the page, so the ellipse was the wrong affordance for touch in the first place — and
**C1 is its replacement**, not a nice-to-have after it. Until C lands, touch page turns are
the `‹ ›` buttons. Recorded here because it is a live regression on the operator's own
device, not a theoretical one.

⚠️ **Two premises the task asked to be checked before building were checked, and both held.**
B2's was real, not void: `AskPill` renders as a direct child of `.stage`, so `.stage` is its
containing block, and the pill's `left`/`top` were being measured against `.epubContainer` —
inset from it by the reader's *margin setting*. Measured live at `generous`, that inset is
97px, and the pill was drawn 97px up and to the left of the selection, drifting further the
more generous the margin. B1's was real too: `.stage`, `.pageClip` and `.readerRow` are all
positioned without a `z-index`, so the pill's 5 and the grab surface's 6 compared directly
across two files that had never been read together. The order now lives as a documented
scale at the head of `ReaderView.module.css`, with the fold's 960 and a modal's 1000 named
in it as fixed points.

## 2026-08-27 (later) — The iPad gate was stale; the touch gesture set is closed

Two rounds of operator gesture proposals, and one sentence buried at the end that
invalidates a gate three documents repeat.

### ⚠️ The gate is gone: there *is* an iPad, and it is already being used

TASKS.md M31 D, the "Future arcs" note (2026-07-27) and this file all state that iOS
behaviour cannot be settled because **there is no iPad to test on until the Private rung
lands** — the server binds to loopback by the M6 security decision. The operator's own
report ends: *"we currently test this on the iPad as a browser app."*

So the gate is lifted, and it was probably never quite what it claimed: this project has
reached the dev server over an **SSH tunnel** before (the "15–20 second settings load" that
measured 0.5ms server-side, 2026-08-12, was 104 dev-mode module requests over exactly such
a tunnel). Loopback binding was never the same thing as "unreachable from another device".

**The mechanism, confirmed by the operator:** **Tailscale**, with Tailscale SSH. All
rendering and processing happens on the **Mac**; the iPad is a browser pointed at it over
the tailnet. So the loopback bind is untouched and the M6 security decision is not weakened
— the tailnet is doing what the SHIPPING.md "Private" rung was expected to do, without
being that rung. ⚠️ **This means the iPad is a view of the Mac's dev server, not a second
install** — nothing about the two-machine setup (Mac on Node 20/pnpm 9, Linux on Node
24/pnpm 10) changes, and iPad testing is only available while the Mac is the machine
running `pnpm dev`.

**Consequence:** M31's touch work is verified on the device, not emulated, and D's honest
"not verified, here's why" shrinks to whatever the iPad genuinely cannot show.

### The iPad's two reported faults are one missing manifest and one `100vh`

Both were reported as Safari being uncooperative. Only half of that is true.

**"The page renders taller than the visible region."** Not a Safari quirk to be worked
around — a real bug in our CSS. `ReaderView.module.css:11` sets `height: 100vh` and
`ReaderPage.module.css:6` sets `min-height: 100vh`. On iOS Safari `100vh` is the **large**
viewport — the height the page *would* have if the toolbars were retracted — so with the
toolbars showing, the app is always taller than the window by exactly the toolbar height,
and the foot sits below the fold. `100dvh` (with a `100vh` fallback) is the fix, plus
`overscroll-behavior: none` to stop the rubber-band and the pull-to-refresh, plus
`viewport-fit=cover` and `env(safe-area-inset-*)`.

**"Pinch zooms the webpage."** ⚠️ `user-scalable=no` will not fix this and must not be
attempted: iOS Safari has deliberately ignored it since iOS 10, for accessibility. Two
things that do work: preventing WebKit's proprietary `gesturestart`/`gesturechange`, and —
better — **shipping a web app manifest and adding the app to the Home Screen**. Standalone
mode removes Safari's own page zoom, its pull-to-refresh, and its toolbars in one move,
which also makes the `100vh`/`100dvh` gap disappear rather than merely be handled. There is
no manifest and no `apple-mobile-web-app` meta in `index.html` today.

This lands as **M31 §0**, before anything else in the milestone: every other touch judgement
is being made on that device, and until the app fills the window and stops zooming, none of
those judgements are about our gestures.

### The gesture set, closed

Proposed and **dropped**: two-finger swipe down to leave fullscreen; swipe down to open
search; pinch to close the book. Reasons, so they are not re-proposed:

- **Two gestures on one axis separated only by finger count** is the least discoverable
  pairing available, and multi-finger gestures are contested on iPad (VoiceOver reserves
  several). Fullscreen already has an exit affordance.
- **Pinch is worth more as text size** — it is what every reader on the platform means by
  pinch — and pinch is *cheap*: two fingers, any distance, no commitment.

⚠️ **Amended within the same day, before any of it was built:** "no gesture changes room"
was too strong, and the operator brought a downward swipe back for exactly that job. The
rule that actually survives is about **cost of accident, not about room changes**: *a
gesture that changes room must be expensive to perform by accident — a long throw (≥⅓ page),
a tight axis, one finger, disarmed while anything is selected or being edited.* A long
deliberate swipe clears that bar; a pinch never did. Swipe-down runs the **put-down**, so it
is the same departure as the Desk button and `Esc`, not a third one. It is **gated on M31
§0**: until Safari's pull-to-refresh is overridden, a downward swipe reloads the page — and
shipping the gesture before the fix ships a gesture that throws away the reader's place.
Recorded as an amendment rather than a quiet edit because the superseded rule was written
down first, and someone will find it.

Kept, and specified in DESIGN.md rather than here: the Desk's long-press action card, the
pinch-to-resize instrument, the Scan's pinch-zoom/swipe-scrub, the immersive tap that
reveals the pebble, and the put-down.

**Three places the operator's own spec was tightened, each recorded because the change is
mine and they may want it back:**

1. **The Desk long-press is one rule, not three.** "Long-press 1s → menu; drag → menu goes;
   still 1s → menu returns; hold 0.3s then drag → no menu" collapses to *the card appears
   after 1s of stillness, any movement dismisses it and re-arms the timer*. The 0.3s clause
   is already implied — it is movement before the second is up — and a second named
   threshold is a second thing to get wrong.
2. **±5° is too tight for a swipe.** A deliberate human swipe on glass rarely lands inside
   ±5° of vertical; combined with a one-third-of-the-page distance it would read as a
   gesture that does not work. **±20°** is a normal dominant-axis cone. Recommended, not
   yet accepted.
3. **Clamp the pinch slider, do not reject the pinch.** Refusing a gesture because it
   started too near the top of the page is indistinguishable from a bug. `handleSelected`
   already clamps the ask pill into the page rather than suppressing it; same rule.

And one thing the operator's sequencing got right that was not obviously deliberate: the
put-down's order — Desk fades in *before* the cover starts travelling — is what makes the
destination rect knowable at all. Recorded in DESIGN.md as load-bearing so a later
"optimisation" does not reorder it.


## 2026-08-27 — Click-to-turn is retired; the pointer contract is written (M31 A)

Operator report: *"I can only start a highlight when the cursor is between 'something to
eat' on the left page and 'They walked into the kitchen he' on the right page — everything
further left or right initiates a page turn."* Plus: the highlight pill, when it lands near
an edge, cannot be clicked; the click turns the page instead.

**Both are true, and the premise that they are one bug is false.** There are two turn
surfaces stacked on the page, built four milestones apart, and they fail differently.

- `.turnGrabSurface` (M20, `ReaderView.module.css`) is a **real parent-document div** with
  `pointer-events: auto`, `z-index: 6`, `width: 20%` clipped to `ellipse(75% 60%)` — the
  outer ~15% of the stage at vertical middle. It eats the `pointerdown` itself. Selection
  there is not difficult, it is **impossible**: the iframe never hears the press.
- `turnZoneForVisibleX` (M11, `readerGeometry.ts:63`) is the outer **30% of
  `containerRect.width`**, inside the iframe. A drag there does select (`handleContentClick`
  early-returns on a non-empty selection); a click that produced no selection turns.

**The spread-mode multiplier is what the operator actually saw.** The 30% is measured
against the container, and in spread mode the container is *both leaves*. At a 1000px
stage, normal margin: single-page caps the measure at ~520px so text runs 240→760 against a
zone ending at 316 — an overlap of the first ~76px of every line. **Spread** uses the fixed
64px gutter instead, so text fills 40→468 and 532→960 while the zones still run to 316 and
from 684: **the outer ~65% of each page**. The grab ellipse overlaps live text there too,
so on the outer quarter of a spread page there is currently nowhere a selection can start.
M11's 30% predates M12's spread and was never revisited.

**The pill is a plain layering fault.** `.pillPosition` is `z-index: 5`; `.turnGrabSurface`
is `6`; `.stage`, `.pageClip` and `.readerRow` are all positioned without a `z-index`, so
none opens a stacking context and the two numbers compare directly. The grab surface paints
and hit-tests above the pill.

⚠️ **M11 predicted this exactly** (2026-07-20, this file): *"a parent-document overlay
cannot own this, because anything with `pointer-events` over the iframe kills text
selection."* M20's grab surface was built as precisely that overlay. The rule was right; it
was regressed, not overturned. It is restated as invariant 1 of the pointer contract rather
than rediscovered a third time.

### The ruling

**Operator's call, taken in full: a click never turns a page.** Not on a word, not on
paper, nowhere. Turns come from `←`/`→`, the foot's `‹ ›`, and drag-on-paper.

The reasoning, recorded because "add it back, it's the e-reader convention" will be
proposed: a click-to-turn band wide enough to hit is a band wide enough to swallow the
start of a highlight. That is not a layout problem with a better division of the page — the
two gestures overlap by nature. Retiring one of them is what makes the other reliable, and
the reader already has three other ways to turn a page, two of which are always on screen.

**I argued for keeping it**, narrowed to the outer band of the outer leaf and gated on "no
selection produced, pointer moved <6px", on the grounds that click-the-right-side is the
dominant e-reader idiom. The operator overruled it: on a laptop people use the arrow keys,
and the touch rule (below) already says a tap never turns, so keeping it on one input only
splits the contract in two. Recorded as considered, not overlooked.

The full rule — the ink/paper test, the two tables, the six invariants — lives in
**DESIGN.md, "The pointer contract"**, not here. This entry is why.

### Three second-order effects, decided here so they are not discovered

- **Direction now comes from the drag, not the grab point.** With all paper grabbable, the
  gutter and the foot of a short page belong to both directions. Today the code knows the
  direction at `pointerdown` (left surface = prev, right = next) and uses it immediately —
  it advances the rendition under the covers so the peeling sheet has a real page behind
  it, then steps back by CFI on spring-back. That advance must now be **deferred until the
  drag has declared an axis**. This is the milestone's real implementation cost, and it
  pays for itself: the wasted advance-and-step-back on a stray press disappears.
- **`turnZoneForVisibleX` survives as the dwell's region, not as a click target.** M19.6's
  highlight-across-a-page-boundary dwell is keyed off that geometry. The natural cleanup —
  deleting the zones along with click-to-turn — silently removes it.
- **The vignette and the directional cursor start lying.** Both advertise click-to-turn.
  Over paper the reader gets a grab cursor and the glow follows the grabbable paper; over
  ink, neither appears.

### Known cost, accepted

In spread mode the grabbable paper is thin — the ~40px outer margins, the 64px gutter, and
whatever lies below the last line. Drag-to-turn becomes the pleasant gesture; the arrow
keys and `‹ ›` carry the load. Accepted on the operator's own reasoning above. ⚠️ One gap
worth knowing: **the `‹ ›` buttons do not exist in immersive mode** — that branch renders
the floating pebble (digest / listen / search / exit) instead. On a desktop the keyboard
covers it; on a tablet in immersive mode, swipe becomes the only way to turn a page. That
is consistent with the touch rule, but if a belt-and-braces fallback is wanted, arrows on
the immersive pebble are a two-line change.


## 2026-08-27 — Define's digest fallback becomes the reader's call, not the miss's (M30 E feedback)

Operator feedback on the shipped M30 C: **"Define: a dictionary first, the digest as
fallback — capped"** (2026-08-24, below) built the fallback to fire automatically on a
dictionary miss. Driving it live already knew the cost — the digest rung takes
100–140s on a reasoning model (M30 C's own Verify entry) — but shipped the *decision* to
pay it to the miss, not the reader. The operator asked for the decision back: **ask before
searching deeper, don't just do it.**

**Ruling: `dictionary_miss` is now a fourth `Definition.reason`, distinct from `not_found`.**
`defineHighlight` (`dictionary/define.ts`) stops at the dictionary and returns
`dictionary_miss` whenever a query-role provider *is* configured (still `no_provider` when
one isn't — nothing to offer deepening with). The digest-rung call itself moved to a new
`deepenDefinition` async generator, run only from an explicit "Look deeper" the reader
clicks on `DefinitionCard`. `not_found` is now reserved for what a *deepen* attempt itself
comes back empty on — the same designed-failure shape M30 C always had, just reached one
step later.

Two smaller asks landed in the same pass, because they touch the same card and the same
delete affordance M30 E already owned:

- **Transparency, from real steps, never a fabricated chain-of-thought.** `deepenDefinition`
  yields a `step` event per actual stage it performs — searching the text for the term,
  reading context around what it found, asking the model — before the answer streams in as
  `text` chunks. Settled decision 2's "the model proposes, code disposes" is exactly why
  this is safe to narrate: every line is deterministic code the route was always going to
  run, in the order it always ran it, just surfaced instead of hidden behind a spinner.
- **A model choice, from the roles that already exist.** Rather than a new per-call model
  catalog, the reader picks between the two roles Settings already configures ("Query" /
  "Digest"), read live via the existing `useProviderRoles` hook — no new provider-selection
  surface, no new server concept.
- **The definition card is now draggable**, same mechanics as `ThreadPanel`'s M14 "movable
  sticky notes" (`dragControls`/`dragConstraints={appBoundsRef}`, armed from the header's
  own pointerdown) — not persisted, since a fresh Define always re-anchors at the new
  selection and remembering a stale offset from an unrelated word would be the wrong
  default.
- **`MarginRail`'s delete `×` had a live hover-dead-zone bug**, found on the same pass: the
  button sat a `margin-left` gap outside its wrapper's own (dot-sized) hover box, so a
  cursor moving toward it crossed dead space, dropped `:hover`, and the button vanished
  before the cursor arrived. Fixed with an out-of-flow bridge sized to exactly that gap.

See TASKS.md M30 E for the delete-confirmation work (`messageCount` on `ThreadSummary`,
`DeleteConfirmDialog`) this landed alongside.

## 2026-08-26 — A turning page is in front of the screen, and two different things were holding it back (M27)

Operator feedback on the wired hinge, in two asks: **(1)** the curled page should be in
front of the page it is curling onto; **(2)** the reader's own chrome — the nav pebble's
icons were named — should be *covered* by the page during the turn, "like the page is
coming out of the screen/above all other UI elements".

Both were real, both were reproduced live (Playwright, real drags against East of Eden,
spread mode, windowed **and** immersive), and they turned out to have **two different
causes** — which matters, because fixing only the one everybody sees first leaves immersive
mode exactly as broken as it was.

**Ruling: a turning page outranks the room's chrome; a dialog still outranks the page.**
The sheet has left the leaf, so everything it passes over goes under it. The number that
encodes this is `960` — above `NavCluster`'s `950`, below the `1000` Settings and the
casting modal claim.

**Cause 1, the ordinary reader: the seam's own layering contract.** Settled decision 14c
says the one canvas is a fixed `z-index: 0` layer that surfaces raise their foreground DOM
above. Every consumer so far has been *scenery behind a room* — the Desk's books under its
hover card and notepad — and for those the contract is right. The fold is the first
consumer that is not scenery, and at `z-index: 0` it lost to everything: `FarLeafCover`
(`5`), the turn-zone vignette and grab surface (`6`), the strip, `NavCluster` (`950`). Live
symptom: the sheet's tail **vanished the moment it crossed the gutter**, because the far
leaf's cover paints over it — which is precisely ask (1), the far leaf being "the page we're
curling on to".

The fix is `useScene3DElevated`, a ref-counted request that lifts the *whole* canvas for as
long as a caller is mounted, and `PageFold3D` is its one consumer. **The contract is not
repealed**, and the hook's docstring says so: ask for this because the thing you are drawing
is physically off the page, never because a surface looks better on top.

**Cause 2, immersive mode: the browser's top layer, where z-index does not reach.**
`useFullscreenChrome` called `requestFullscreen()` on the *reader's own wrapper*. A real
fullscreen element is promoted into the **top layer**, and nothing outside that element
renders at all — no z-index escapes it, because the top layer sits above the entire stacking
order by construction. So in immersive mode the shared canvas was not merely behind the
reader, it was **not drawn at all**: the page curl was invisible for the length of every
immersive turn, and elevating the canvas could not fix it, because the problem was never
depth. Fullscreen now targets `document.documentElement`, which contains the shell, the
canvas layer and every other root-level fixed layer — the browser's own chrome removal was
the only thing that call was ever for.

**A note for whoever adds the next fixed layer.** `.wrapperFullscreen` is *also* a
`z-index: 50` fixed element and therefore a stacking context around the whole reader, so
even with the fullscreen target fixed it would have hidden the fold on its own. Elevating
to `960` clears it; a future layer that wants to be over the reader has to clear it too.

Verified live after the change, both modes and both directions: the sheet covers the far
leaf, the strip and the nav pebble mid-drag; a committed turn and a spring-back both release
the elevation (`[data-elevated]` gone, canvas back at `z-index: 0`); the Desk is untouched,
its notepad and action card still over its books.

## 2026-08-26 — The hinge is wired into the reader, with a dynamic arc found by tuning rather than derived (M27)

Everything the two entries below this one said the reader owed is now built:
`ReaderView`/`usePageTurnAnimation` mount `PageFold3D` where `PageCurl` used to be, the
grab site and release path are `anchorForPinch`/`hingeRelease`/`hingeSettlePointer`/
`settleArc`, the far leaf is covered by a new `FarLeafCover` (independent of the mesh, per
its own acceptance), the ladder falls to the slide on a lost or absent WebGL context
(`useScene3DAvailable`), and the WebGL renderer's own draw cost feeds the same p90 guard as
the 2D painter's, through the same `handleDrawCost`. `drawPageFold`/`PageCurl.tsx` are not
retired yet — correctly: that is the milestone after this one, once the operator has signed
off on real hardware.

**Two things surfaced while driving the harness that were not in the original scope, and
both changed a number the wiring ships with rather than a line of geometry.**

**1. "The sheet swings away from the spine mid-drag" resolved to a look call, not a bug
fix.** `pageFold.ts` gained an `ArcRadiusMode`: `"anchor"` (shipped 2026-08-25 — the roll's
physical size is realized at the grabbed point) vs. `"farthest"` (a candidate that realizes
it at the leaf's own farthest point from the apex instead, capping the worst-case flap at
the flat model's tuned size). Both are real and both were tried, live, on the same drag, via
`harness/pageCone.html`'s new control panel. **`"anchor"` is what shipped** — the operator's
own choice, made after also getting the dynamic arc curve below, at which point the
farthest-corner cap stopped being needed to make the sheet read as hugging the spine.
`ArcRadiusMode` stays in `pageFold.ts` as a real, tested option rather than being deleted;
just not the one wired in.

**2. "The bigger the arc, the less of the turn a drag can actually reach" was a real bug,
and a constant arc could not fix it.** `computeConeFold`'s roll cannot claim more angle than
the drag has swept (`arcAngle ≤ sweep / (1 - ROLL_END.o)`) — a bound sheet's own physics, not
a bug in the clamp — and that cap is tightest in the *middle* of a turn. A single
`arcTarget` big enough to look dramatic early in a drag therefore fights its own cap hardest
exactly where the operator felt the drag stall. The fix is `HINGE_ARC_CURVE`
(`usePageTurnAnimation.ts`): the roll's target is no longer a constant but a
piecewise-linear function of the turn's own angular progress (`HingeRelease.progress`, 0 at
rest, 1 fully turned) — big early, easing down through the middle, easing further down
late. `hingeRelease` needs no `arcTarget` to compute `.progress` (it only reads the cone's
solved apex), so this has no circularity even though the curve feeds the very arc that will
be handed back to `computeConeFold`.

**Neither the curve's shape nor the commit threshold was derived — both were found by
feel**, which is why the harness grew a live control panel (radio + three sliders,
`?arcMode=`/`?dynamicArc=`/`?arcStart=`/`?arcMid=`/`?arcEnd=`/`?commit=`/`?settle=` all
round-tripped into the URL) rather than the operator being handed a reload-and-guess loop.
**What shipped, and it is worth recording exactly because none of it is derivable from the
geometry alone:**

| constant | value | was |
|---|---|---|
| `ARC_RADIUS_MODE` | `"anchor"` | (candidate `"farthest"` tried, not shipped) |
| `HINGE_ARC_CURVE` | start `2.2`, mid `1.44`, end `0.4` | (a flat `1.0` in the harness's own defaults) |
| `HINGE_COMMIT_AT` | `0.271` (`HingeRelease.progress`, angular) | derived estimate was `0.157` |
| `HINGE_SETTLE_SCALE` | `1.7×` | (`1×` = the derived estimate's timing) |

The `0.157` estimate two entries below (drag distance over `0.9 * leafWidth`, restated in
the hinge's angular coordinate) was the right *method* — converting a felt distance between
coordinates rather than copying `0.35` across — but the *number* it lands on is still an
estimate of where a commit feels right, not a measurement of it, and `0.271` is what
measuring against a real gesture actually gave.

**Verified by automation, not yet by the operator**: driven live against East of Eden
(both spread and single-page, both a deep committed drag and a shallow spring-back) with
Playwright — the spine invariant holds, a spring-back's CFI-based step-back lands the
reader on byte-identical text to where the drag began, the far-leaf cover shows no
pre-flipped content mid-drag, and no console or WebGL errors on either path. What
automation cannot judge — the stutter, the look of the real back-of-sheet material, whether
`2.2/1.44/0.4` still feels right on a trackpad rather than a scripted mouse — is exactly
what TASKS.md's Verify entry is for and remains unchecked.

## 2026-08-26 — A turn is a gesture: the pinch is where you grabbed, the release is a swing, and the far leaf waits (M27)

Operator feedback on `harness/pageCone.html`, after the mesh first rendered. Three asks,
and all three turned out to be the same shape of thing — the harness had only ever tracked
*hover*, so it could show a fold **held at a pose** and nothing that only exists in a
gesture. It now runs a real one (press, drag, release, land) and the three are settled as
follows. Only the harness is wired; each carries what the reader owes when the M27 wiring
lands.

**1. The `EdgePinch` retires the other two anchors.** `anchorForGrab` snapped a grab to
either the nearest corner or the *middle* of the edge, and the middle case was then pinned
flat by `constrainFoldPointer` so its crease stayed parallel to the spine. Both existed
because the flat model needed them: a flat crease cannot converge, so a mid-edge grab had
no way to tilt. A cone's rulings fan, and the cone is solved from an anchor *point* and its
distance to the two gutter corners — nothing in that construction asks whether the point is
a corner. So the anchor is simply **where the paper was grabbed** (`anchorForPinch`), the
corners are `t = 0` and `t = 1` of the same continuum, and the band, the snap and the
pinning all go. Measured: every invariant the cone already owed — the spine edge unmoved,
the leaf covered by progress 1, the fold moving no faster than its pointer — holds for the
new kind with **no change to the cone code at all**, which is the evidence that this is a
generalisation rather than a fourth case.
*The anchor's `x` stays on the outer edge and only its height comes from the grab*: a hand
under the sheet is under its edge however far inboard the press landed, which is also what
lets the reader's grab band be 30% of the page wide without the anchor wandering onto the
paper. Grabbing the page's *interior* is a different feature and was not asked for.
⚠️ Worth expecting before it is called a bug: pulling a mid-edge pinch up and across is
**not monotonic** in which corner lifts most. Lift is `r * arcAngle * profile`, so the
corner further from the apex has the longer arc while the corner at the larger fan angle is
further past the crease, and the two trade places as the drag steepens. A hard pull up ends
as a diagonal fold hinged on the *bottom* gutter corner with the top corner left lying
flat. That is what paper does.

**2. A release is a swing about the frozen apex, not a lerp toward a target.** A drag
**cannot** reach the end of a bound sheet's turn — `constrainToSpineHinge` runs out of
paper first (2026-08-26, above) — so the sheet has to finish it, and the question is along
what path. Not a pointer lerp: it drags a phantom finger across the page and straightens
into the far field on the way, so the fan the milestone exists for is gone by the time you
can see it. Instead `hingeRelease` freezes the apex the release left and rotates the anchor
about it, which is the one motion inextensibility permits. Three things fall out, all
proven rather than hoped: the fan stays open, the whole path is inside the lens so nothing
is ever clamped mid-flight, and it lands exactly, because the fully-turned pose is on the
same circle.
This answers the "left open deliberately" from the same day — *which path a click turn
takes* — for the release at least, and it answers it with the coverage proof attached
rather than as a look preference.

**3. The arc has to relax as the sheet lands, or it never lands** (`settleArc`). This was
not asked for and is not a flourish; it is what the first two exposed. Hold the roll at
`curlArcLength` through the settle and two things go wrong at once, because they are the
same thing — the roll is a fixed physical arc and does not know the turn is ending. It
leaves the sheet floating its own roll-diameter (~80px at a normal leaf) above the page it
came to rest on, so unmounting the fold there *pops*; and it eats the end of the turn,
because the crease must clear `arcAngle * (1 + ROLL_END.o) / 2` before the anchor can reach
the mirror, so `creaseAngle` **saturates at the binding with the anchor still ~120px short**
and the sheet stops moving while the animation runs on. Relaxing to nothing fixes both and
is what paper does. Measured: the sheet then lands 0.01px from the mirror at zero lift —
pixel-identical to the page underneath, hence an invisible unmount.
⚠️ The floor is not decoration. `computeConeFold`'s `arcAngle <= 0` branch means "no roll,
sheet undisturbed", not "sharp fold", so an arc driven to exactly zero *un-turns* the sheet
rather than laying it down. Approached from above, the same limit is the sharp fold wanted.

**4. The far leaf must not pre-flip, and this one is a live bug in the shipped reader.**
The drag advances the rendition at grab time (M20 step 2, "the drag reveals the next page"),
and in **spread mode** that hands the stage the whole destination spread — so page 66 lies
flat on the left half from the first frame while the sheet turning over it also carries 66
on its back. The same page twice, one of them where a book would never put it. The advance
stays: the turn genuinely needs both the page revealed under the leaf and the leaf's own
back. Only the **near** half of it is under the sheet, so the far half keeps the page that
was already there until something lands on it — 64 | 67, with 65 on the sheet and 66 on its
back, becoming 66 | 67 only once the sheet is down.
⚠️ It takes **three** underlays, not two, and the third is the one that is easy to miss: a
fold at rest draws nothing (`computeConeFold` answers an unmoved drag with `null`), so
64|67 is right only while something is covering the near half. The frame a spring-back
finishes, page 67 shows where 65 should be. Seen here as a spring-back that ended on the
wrong page. Phases are `before` (64|65) / `turning` (64|67) / `after` (66|67), and the
transitions are gesture boundaries, never per-frame.

**What the reader owes when the wiring lands**, since none of the above is wired to it:
the far-leaf cover (4) — which is a **fix to the shipped 2D curl too**, and can go in
without the mesh; the pinch anchor replacing `anchorForGrab` at the grab site (1); and a
release path built on `hingeRelease`/`settleArc` rather than the flat model's pointer lerp
(2, 3). One number does **not** carry over: the reader's `0.35` commit threshold is
measured on drag distance over `0.9 * leafWidth`, while `HingeRelease.progress` is an
angular fraction of a turn spanning **two** leaf widths — the same ~120px of travel is
`0.157` there. Copying `0.35` across gives a page that refuses to turn until it has been
dragged more than half a leaf further than the shipped one asks for.

**And one thing only pressing on it could have found**, kept because it will happen again:
an `<img>` is draggable by default, so a press on the page's own underlay starts a native
image drag and Chromium answers a fresh `setPointerCapture` with `pointercancel` on the
next frame. The sheet springs back the instant it is grabbed, which reads exactly like a
broken fold. `draggable={false}` plus `user-select: none` on the grab surface. The reader's
own grab surface is a bare div over live DOM and has never hit it; anything that puts an
image under a drag will.

## 2026-08-26 — The fold's WebGL renderer is a consumer of the one seam, and one of its acceptance criteria has expired (M27)

M27's "over the spine" was designed on 2026-08-03, when the fold's WebGL renderer would
have been the app's *first* WebGL. M23 has since built the one 3D seam, so the task's
"stage-wide canvas" now has an obvious owner and settled decision 14 is explicit that the
two "must not become two ad-hoc call sites". Recording the consequences, because two of
them change what the milestone was written to do.

**Decided: `PageFold3D` registers a Scene3D layer; it never mounts a canvas.** Everything
the fold would otherwise have built for itself already exists there — one canvas for the
app, one world unit to one CSS pixel, and a lost context flipping every consumer to its 2D
presentation. That last one is exactly what M27 asks for ("a lost context degrades to the
slide through the gesture's *existing* one exit"), so the fold gets it by not writing it.

**Decided: the fold borrows the Desk's camera rather than bringing a fourth one.**
`deskViewFrame` hangs a real perspective camera such that the plane `y = 0` maps to the
viewport 1:1 — world `(x, 0, z)` *is* screen pixel `(x, z)`. A page lying on a page needs
precisely that: the leaf sits at `y = 0` and lines up with its own DOM rect, and only what
lifts off it splays. Decision 14a's "consumers bring their own camera, never their own
units" is satisfied in the letter that matters — the fold is not inventing a framing, it is
reusing a construction whose whole purpose is the 1:1 plane. The Desk and the reader are
mutually exclusive surfaces, so nothing has to reconcile the two.

**⚠️ One of the task's acceptance criteria has expired and is restated rather than quietly
failed.** M27 asks that `pageTransition: "slide"` hold as a ceiling, tested as
`document.querySelectorAll("canvas").length === 0` sampled every frame through a turn.
That was written before M23. `Scene3DProvider` latches `everRegistered`, so **any session
that has shown the Desk, the shelf or the opening keeps a canvas mounted for the app's
life** — the count is already non-zero before the reader is reached, whatever the fold
does. The criterion's *intent* is intact and is what the test will assert instead: **under
"slide", the fold registers no Scene3D layer and mounts no grab surface.** That is the
thing that was actually being protected — that the ladder cannot climb *up* to the curl on
a machine or a setting that asked for the slide.

**Decided: the mesh is a fan of wedges between rulings, not a grid, and the deformation
runs on the CPU.** Both fall out of the cone rather than being tuned: the surface is
*linear along a ruling* (position and lift are both linear in radius), so two vertices per
ruling are exact and a grid spends its entire budget subdividing a straight line; and all
the curvature is in the roll, which can be a ten-millionth of the leaf's angular span in
the far field, where a uniform grid fine enough to catch it would need tens of thousands of
vertices. The fan needs 127–169. The deformation stays on the CPU in float64 because the
apex is held up to a million leaf-diagonals away and **float32 cannot hold a leaf
coordinate measured from there** — a vertex shader would quantise the page to tens of
pixels. It is affordable exactly because the fan is small.

**Decided: the sheet is unlit, and shades from the model that was tuned.** `sheetShadingAt`
and `backOfSheetPaper` are now exported from `pageFold.ts` and read per *vertex* where
`drawPageFold` read them per *band*. Those constants were judged against real pages in
three reading themes (2026-08-25); handing the sheet to `SceneLights` instead would be a
second look, decided by a rig sized for the Desk. Textures are declared `NoColorSpace` and
the fragment shader writes `gl_FragColor` with no colour-space include, so the card
bitmap's bytes reach the screen exactly as canvas 2D delivered them — anything else shifts
the reading surface's paper colour on the frame a turn starts.

**Left open, and owed a real compositor:** the shadow's *softness*. `drawPageFold` throws
two constant-alpha shadows and blurs them with `shadowBlur`, which has no cheap WebGL
equivalent. The mesh renderer proposes a contact falloff instead — darkest where the sheet
nearly touches the page, opening as it rises — which is at least physical rather than
invented, but it is a look and this machine composites in software. It goes to the harness
on the operator's Mac with the rest of M27's Verify.

## 2026-08-26 — The binding is a limit on the drag, not only on the sheet (M27)

M27's "the sheet hinges at the spine" asks for one thing — *the gutter-side corners cannot
curl away, at every drag depth and from every anchor* — and getting it forced the question
the 2026-08-25 apex note left open for a design session. Recording the resolution because
it changes what `computeConeFold` promises, and because the reasoning is a proof rather
than a preference.

**The apex cannot sit on the binding.** A cone's rulings fan from its apex; if the apex is
partway along the spine, the two halves of the spine edge lie on *opposite* rays from it
and there is no single fixed binding — a sheet cannot fan around a point in the middle of
its own binding without tearing. So the apex has to be off the leaf's own span.

**That constraint on the apex is exactly a constraint on the drag**, and a physical one.
`apexY = 0` is precisely the locus `|P − S0| = |C − S0|` and `apexY = height` the same
about the other gutter corner, so the two circles through the anchor bound the legal
region and the lens between them is where **both distances from the anchor to the gutter
corners have shrunk**. For a corner pinch the first radius *is* the leaf's width, so the
rule reads: *the grabbed corner can never get further from its own gutter corner than the
page is wide, nor further from the other one than the page is diagonal* — which is only
"the bottom edge is that much paper and no more". This is the clamp physical page-turn
implementations have always carried; here it falls out of the geometry instead of being a
fudge factor. Checked as well as argued: 965k pointers across six anchors, no apex on the
binding, and the clamp is the identity on the 6.5% of them that are reachable drags.

**Decided:** a pointer outside the lens is *followed as far as the paper goes* — the anchor
travels along the drag's own direction and stops where that ray leaves the lens. Two
circles through the anchor make a convex lens with the anchor on its boundary, so the exit
point is unique and closed-form. **Not** the nearest point of the lens, which reads more
obviously and is wrong: a lens is a sliver, its nearest point flips end for end partway
through a diagonal sweep, and the sheet snaps ~750px in one frame (measured, twice, on two
variants of that idea). Pulling *outward* now yields no fold at all, which is correct.

The cost is a promise, downgraded deliberately: "the grabbed anchor lands exactly under the
pointer" becomes "**under the pointer the hinge can honour**". It is the identity for every
ordinary peel, and where it is not, the alternative was stretching paper.

**Second, the crease cannot run past the binding either.** There is no more sheet to roll
once it reaches the spine, and a crease at a negative angle puts the spine edge itself on
the rolled side and lifts it off the book. `creaseAngle` is floored at zero, so a drag that
asks for more has simply finished the turn and the fold saturates there. Visible
consequence at the end of a full turn: the anchor stops ~170px short of the mirror position
because the roll is still eating `arc * (1 + rollEndO)` of the sheet. That is the same arc
the flat model pays for by overshooting the pointer — an overshoot a bound sheet cannot
make.

**Third, and overturning one day of `computeConeFold`'s own history: there is no far-field
hand-off any more.** As written on 2026-08-25 it returned `null` for a drag square out from
the edge — the apex genuinely is at infinity there — and the caller used `computeFold`.
That is elegant and unusable: it hands the spine back to the one model that lets it move,
at the *most* ordinary drag there is. The apex is now **held** a million diagonals down the
spine instead, and the cone answers every drag. The distance is pinned between two measured
errors — a nearer apex leaves a visible seam where the held apex swaps ends (1.16px at a
thousand diagonals, 1.2e-3px at a million), a further one loses leaf coordinates to
cancellation against the apex's own magnitude (1e-4px at 1e12). Residue against the flat
model at a square pull: 2.9e-4 px.

**Not touched, and this is the deliberate part:** `computeFold` and `drawPageFold`. Giving
the flat model the same clamp is a two-line change and it would **stall the shipped page
turn** — its synthetic sweep runs 2.2x diagonally past the opposite corner, which is a path
no bound sheet can take, so the clamp would hold it a third of the way through every click
turn. The flat painter therefore keeps sliding its tail past the gutter until it retires at
the end of M27, which is invisible today only because the fold canvas is clipped to the
leaf. The corollary for the renderer that replaces it: **`syntheticFoldPointer`'s overshoot
is an artefact of the flat crease and dies with it.** `syntheticHingePointer` — the anchor
to its own mirror across the spine — is the path with a coverage proof attached (leaf
covered but for the spine edge, versus two thirds of it still lying flat under the flat
sweep). Whether a *click* turn should instead take a fanned path, the way a thumb does, is
a look question and deliberately still open: a straight pull square across is the far
field, so a turn animated along it never shows the fan the cone exists for.

## 2026-08-26 — Two ways a CLI provider fails that have nothing to do with the model

Both reported by the operator at M26 sign-off, from two machines, and they looked like
one problem ("Codex won't connect") but share no cause. Both were reproduced before
anything was changed. Neither was a credential problem, which matters because the first
instinct — "store the login ourselves, the way we store the library" — would have been
building a credential store to work around a bug in *reading* one.

### 1. `codex login status` answers on **stderr**, and we only read stdout

Symptom: Settings showed "Not signed in" for Codex on every load of an app that had
signed in successfully many times. The operator's reading was that a rebuild forgot the
login; the real cost was that they then re-ran device auth each time, minting a fresh
token on a machine whose credentials had never moved.

Reproduced against the running dev server: `/api/provider-auth/codex/status` returned
`loggedIn: false` at the same moment `codex login status` in a terminal exited 0 saying
"Logged in using ChatGPT". Under piped stdio — which is how a server always runs it —
0.114.0 puts that sentence on **stderr** and leaves stdout empty. `checkAuthStatus`
collected stdout only, and its `text.length > 0` clause then read the resulting silence
as proof of being logged out.

**Decided:** the status read takes both streams, and silence is no longer evidence.
`code === 0` from a CLI whose entire job is to answer this question is the signal;
`runToCompletion` still fails closed to `code: null` when it genuinely can't tell.
`interpretCodexStatus` is now a pure function with the live stdout/stderr shapes as
fixtures, because this is a class of bug that returns whenever a CLI is upgraded.

**The general rule this earns:** *never assume which stream a CLI answers a question on,
and never treat an empty answer as a negative one.* Applied here to `--version` in
`describeCli` as well. The 2026-08-25 note that `codex exec --json`'s events arrive
cleanly on stdout stays true — that's a different subcommand, and it was verified.

**No credential storage.** Considered and rejected in the same breath as diagnosing it:
the CLI already persists its own login (`~/.codex/auth.json`, or
`~/snap/codex/current/auth.json` for the snap build), that persistence was working the
whole time, and copying credentials into our SQLite would have added a second secret
store to secure while making sign-ins *more* frequent, not fewer. The operator's own
constraint — minimise the number of sign-ins, a rapid series of them looks like abuse —
is satisfied by fixing the read. The M26 lead-in's premise holds: we shell out to the
real CLI precisely so there is nothing here to secure.

### 2. `spawn` searches the server's `PATH`, which on macOS is not the shell's

Symptom, on the operator's Mac: ``Couldn't start `codex`: spawn codex ENOENT`` from an
app whose machine runs `codex` fine in a terminal.

`spawn("codex", …)` resolves against `process.env.PATH` only. A process started outside a
login shell — a GUI/launchd launch, and any Desktop-rung packaging (SHIPPING.md) by
construction — inherits the bare `/usr/bin:/bin:/usr/sbin:/sbin`, in which Homebrew,
npm-global, volta, bun and nvm installs are all invisible. Reproduced on the Linux rig by
running the same spawn under that exact PATH: `spawn codex ENOENT`, verbatim.

**Decided:** one resolver, `llm/cliPath.ts`, used by every CLI spawn in the app
(`authFlows.ts` and `codexCli.ts`). Three strategies, first hit wins:

1. `MARGINALIA_CODEX_BIN` / `MARGINALIA_CLAUDE_BIN` — the escape hatch that ends any
   argument about where the binary is.
2. `PATH` (the operator's own always wins) then a table of the directories these CLIs
   actually install into, nvm's versioned `bin`s included.
3. The **login shell**, asked directly (`$SHELL -lc "command -v codex"`, then `-ic`).
   This is the strategy that matches "but it works in my terminal", and it is worth the
   ~200ms because it is paid once per binary per server run.

Cached per process, with `clearCliBinCache()` so installing the CLI while the app is open
doesn't need a restart. When nothing is found we still spawn the bare name, so the
failure stays the OS's familiar `ENOENT` rather than a path we invented — and the error
message now names the cause and both fixes instead of echoing `ENOENT` at the reader.

*This is a Desktop-rung prerequisite discovered early.* SHIPPING.md's Desktop rung means
a GUI launch, which is exactly the bare-PATH case; a packaged Marginalia would have hit
this on the first run on every machine.

### 3. A subscription provider owes a setup guide, because it can't be fixed by a field

`anthropic` and `openai-compatible` fail one way and are fixed one way: the key or the
URL is wrong, in a field the user is already looking at. `codex-cli` and `claude-agent`
have **three** preconditions — a subscription, a CLI installed on the *server's* machine,
and a sign-in that completes outside the browser — none visible from the UI, each failing
with a different symptom, and one of them (#2 above) producing an error that actively
misleads by implying the CLI isn't installed when it is.

**Decided:** each Accounts row carries a "How to connect, and what to check if it won't"
disclosure, and it reports **this machine's** answer rather than linking to prose:
where the executable was found and what version it is, or — when it wasn't — the
searched directories, the install command, and the override env var. It opens itself
only when you're likely to need it (a failed flow, or a not-connected row) and stays a
quiet paper-register inset otherwise: help, not chrome. A new `GET
/api/provider-auth/:provider/diagnostics` backs it, read-only, credentials never in
scope, and it shells out only when the guide is actually opened.

The static half of the same content lives in README.md's "Configuring a model" — the two
must stay in step, and the in-app copy is the one a stranger will actually read.

## 2026-08-25 — Codex CLI provider shipped (M26), and two corrections to the 2026-07-30 cage

The auth blocker cleared (this machine's `codex login` succeeded via the M26 lead-in
sign-in flow), so this is the "run one real call and read the actual JSONL" step both the
2026-07-30 decision and TASKS.md's M26 task required before writing `codexCli.ts`. Full
findings in NOTES.md ("M26 — `codex exec --json`'s real event shape"); this entry records
what changed in the cage itself as a result, since the 2026-07-30 decision's flag list is
now wrong in two places and this file is the one that's supposed to say so rather than
leaving the drift silent.

**`-a never` ("approvals never") is dropped — that flag doesn't exist on `codex exec`.**
It belongs to the interactive `codex` command only; passing it to `exec` errors with
"unexpected argument" (confirmed live). `exec` is non-interactive by construction — there
is no human on the other end of a spawned process to approve anything *to* — so there was
never anything for the flag to do here. The 2026-07-30 decision listed it from a `--help`
read that didn't distinguish the two subcommands' flag sets, which is exactly the trap
that same decision's own warning called out, just tripped on a different flag than the one
it was warning about (the event shape).

**The scratch directory cannot be `os.tmpdir()`, and it cannot be a dot-directory
either — both verified live, both 100% reproducible, and both traced to `codex` being
installed here as a **snap package** (`/snap/bin/codex`).** `codex exec -C <dir>` (and
`--output-schema <file>`) fail `ENOENT` for any path backed by tmpfs — this machine's
`/tmp` is tmpfs (`stat -f` confirms it, `/home` is ext4) — because a strict snap gets its
own private `/tmp` namespace, so a path created in the real `/tmp` doesn't exist from
inside it. Separately, `--output-schema <file>` fails `Permission denied` for *any* file
under a dot-directory anywhere in `$HOME` — snap's `home` interface denies dotfiles by
policy, isolated by testing an otherwise-identical hidden vs. non-hidden directory
(NOTES.md "M26" addendum). `codexCli.ts` uses `~/marginalia-codex-scratch` — no dot, not
`/tmp`, still not the repo or `data/` per the 2026-07-30 bound. Whether either constraint
reproduces on the operator's Mac (APFS, not tmpfs; presumably the standalone install, not
a snap, since snap is Linux-only) is unverified; the fix costs nothing there regardless.

Everything else in the 2026-07-30 cage held exactly as specified and was proven live, not
assumed: `--sandbox read-only` genuinely blocks a write (asked the CLI to write a file
inside its own `-C` root; it attempted the command, reported "Failed", the file never
appeared); `--ephemeral` and `--skip-git-repo-check` needed no adjustment.

**One more real bug, caught by driving the actual app rather than trusting the schema
change:** `settings/providers.ts`'s `isProfileConfigured()` had no branch for `codex-cli`,
so it fell through to the `openai-compatible` check and read a fully-configured Codex
profile as unconfigured — the reader would have seen the "configure a provider" nudge
over a provider that was actually working. Fixed alongside (one line, same shape as the
existing `claude-agent` branch: a subscription CLI is configured by definition, no key to
check).

**Verified end-to-end against the real dev server and real data** (not just the new
tests): created a profile, ran `/api/provider-profiles/:id/test`, then pointed the `query`
role at it and asked a real question from a real highlight in *Kafka on the Shore* — a
correct, on-topic answer came back over SSE, the usage ledger recorded real reported
token counts with `costBasis: "notional"` (same treatment as `claude-agent` — a
subscription call, never billed per-token, and this CLI never reports a `cost_usd` figure
to price from), and a mid-stream `AbortSignal` killed the child cleanly (`LLMError`, not a
crash or an orphaned process). `extract()` was verified separately, directly against
`CodexCliProvider` (a real schema-valid JSON answer, first try) — that pass is what
surfaced the dot-directory constraint above; it was invisible to the thread test because
`stream()` never touches `--output-schema`. The `query` role was restored to the
operator's prior profile afterward; the test thread and test profile were left in place
rather than reached into the database to remove — cheap for the operator to delete by
hand if unwanted, and this file's own standing caution against unnecessary destructive
operations on `data/` argues against a script doing it instead.

## 2026-08-25 — The paper wash belongs to the fake back, and the dark themes needed the lift back (M27)

Implementing the 2026-08-03 "sign-off" ruling turned up one thing that entry could not have
known, because it only becomes visible once real content is on the back of the sheet.

**`SHOW_THROUGH`'s wash is not a property of the back of a sheet — it is part of *faking*
one.** It exists to turn the front's mirrored print into something that reads as the other
side: knock the text down to a ghost, take the surface to the page's background colour. A
real back capture already *is* the other side; it carries its own paper and its own print.
Washing it ghosts the very text the second capture was taken to fetch — the right page at
20%, which is the old look with better provenance and none of the benefit. So the wash now
applies only when the back is the front standing in for it (`SheetFaces.back === null`).

**But the wash was doing a second job nobody had separated out, and dropping it broke the
dark themes.** `backOfSheet`'s lift scales with `1 - lum`, so in `ink` it was carrying most
of the "this is a lifted object" cue rather than merely hiding text. With no fill at all the
tail became a near-black triangle with the page's own light text on it, which reads as a
*hole in the page*, not as paper. Hence a second constant, `BACK_LIFT` — how far a real back
goes toward the sheet's lit paper colour — swept in the harness at 0.00/0.20/0.34/0.50
against real back-page prose, with `ink` the deciding theme. **0.34.** Below it the sheet
stops reading as an object; above it the back's own text starts losing contrast against its
own surface, which is the original mistake in a milder form.

The general shape of this, worth keeping: **a constant that was tuned to fake something will
usually be doing two jobs, and only one of them survives the thing becoming real.** The
2026-08-03 ⚠️ predicted a retune; what it actually needed was a split.

*Not decided here, and deliberately left to the operator's Verify:* whether the real back
reads better than the mirror did, and what to do about **single-page mode's doubling** — one
turn advances one page, so there the leaf's back and the page revealed beneath it are the
same page. That falls straight out of the ruling as stated ("the whole card in single-page
mode"), so it is a consequence to look at rather than an implementation bug; the harness
shows it honestly.

## 2026-08-25 — The p90 guard was ruled in August and never built (M27)

Recorded because the failure mode is documentary rather than technical, and it is the kind
that repeats. PAGE_CURL.md §7 has read **"the guard now takes the p90 of drawn frames"**
since the 2026-08-03 step 4 session. Nothing implemented it. The doc stated the ruling in the
present tense, the shipped guard went on taking the median for three weeks, and the operator's
"stutter is less bad" report — the second independent reason the ruling existed — stayed
unaddressed the whole time.

The change itself is what was ruled: p90 of drawn frames, ≥12-sample floor and 33ms threshold
unchanged, so the threshold now means "one frame in ten eats a whole 30fps frame" instead of
"the typical frame does".

Two things worth keeping from doing it:

- **The statistic got its own module** (`drawCost.ts`) rather than staying inline in
  `PageCurl`'s cleanup. It has now been wrong twice — the mean frame interval that was reading
  vsync, then the median that reads the fold's own dead tail — and both times the measuring
  was fine and the *choice of statistic* was the bug. A number that decides a one-way switch
  should be testable without mounting a canvas.
- **Its tests are the recorded traces**, not invented ones: the 25-frame keyboard turn whose
  median is 0.9ms and whose peak is 27.8ms, and the 104-frame held drag. That keeps the
  reasoning in the step 4 entry executable instead of only readable.

*A ruling that has not been implemented should not be written in the present tense.* Where a
doc describes intent, it now says so and names the milestone that owes it.

## 2026-08-25 — M26 lead-in: an in-app "Sign in" for Codex/Claude

Operator call, raised when M26 ("Codex CLI as a fourth provider") turned out to be
blocked on `codex login` a second time — the credentials NOTES.md's 2026-07-30 blocker
recorded as "never set up" had since been attempted and gone stale (401s, `codex login
status` → "Not logged in"). Rather than the operator dropping to a terminal again, they
asked for a friendlier, in-app sign-in that "runs the same CLI stuff ideally," with
anything it stores kept as securely out of the repo as a `.env`.

Shape decided: **shell out to the real login command, don't reimplement OAuth.**
`server/src/llm/authFlows.ts` spawns `codex login --device-auth` / `claude auth login`
exactly as an operator would type them, streams the stdout back (ANSI-stripped, parsed
for a verification URL and a short code where the shape provides one, raw lines kept as
a fallback), and polls the child process for its exit. Nothing new to gitignore: the
credentials still land wherever each CLI already keeps them (`~/.codex/`, `~/.claude/`),
never in this repo — the whole point of shelling out to the real thing rather than
building a parallel token store.

`--device-auth` (not the plain browser flow) is the deliberate choice for Codex: it
prints a URL + code to visit in *any* browser and blocks polling with no local callback
server, which is what makes it work when the server's machine and the browser's machine
differ — true today of this project's own two-machine Mac/Linux setup. Verified live
2026-08-25: real device code obtained, parsed correctly into the UI, cancelled cleanly
(child process reaped, no dangling `codex login`).

**Claude's `claude auth login` was deliberately never smoke-tested.** This machine's
Claude Code login was live and working (this is a Claude Code session); running an
untested login flow against it risked clobbering real, working credentials for the sake
of verifying a code path this milestone doesn't strictly need yet (Claude already works
here). The server-side plumbing is symmetric and ready — same spawn, same generic
regex-based parsing, same raw-lines fallback — but its real output shape is unverified
until someone runs it somewhere it's safe to.

Deliberately kept separate from `ProviderProfile`: signing in is a machine-level action
(one Codex account, one Claude account per machine), not a named, reusable per-role
config the way a profile is — so no `provider_profiles` schema/migration change, no new
`codex-cli` entry in `LLMProviderIdSchema` yet. That still waits on M26's own next step:
run one real `codex exec --json` call against a signed-in account and read the actual
success-path JSONL event shape before writing `server/src/llm/codexCli.ts` — this
sign-in flow only clears the blocker that step was stuck behind.

**Same day, follow-up: redaction on the captured stdout.** Asked where sign-in data
lands and how it's kept secure for other users cloning the repo. Answer surfaced one
real gap from this feature specifically (distinct from `docs/SHIPPING.md`'s pre-existing,
already-documented "no auth on the API at all" gap, which this doesn't touch): `flow.lines`
— the raw stdout `authFlows.ts` keeps for the UI's fallback rendering — is served verbatim
over that same unauthenticated local API. Codex's shape is verified clean (banner, URL,
code, a phishing warning, nothing else); Claude's was deliberately never smoke-tested, so
nothing actually guaranteed it never would be. Added `redactSecrets()`: a labelled-secret
line (`access_token: …`, `Bearer …`, etc.) is replaced whole; any other 24+ character
opaque blob is partially masked. Both the device code (10 chars) and the verification URL
(broken into short pieces by `.`/`/`) sit well clear of that shape and were confirmed live
to still come through — the fix doesn't cost the feature its one legitimate secret-shaped
line.

## 2026-08-24 — M25 parked, M29 moved ahead of it

Operator call. M25 (web search) is parked in place — same treatment as M27: nothing in it
is undecided or blocking, kept whole so it can be picked up cold, settled decision 10
unaffected. M29 (digest reliability) is physically moved ahead of M25–M28 in TASKS.md —
its own number is unchanged, only its position in the file is, per the standing "reorder
only for a real dependency" rule. The dependency: M25 is now parked, M26 is gated on a
Codex login that hasn't happened on this machine, M27 is already parked, and M28 is
explicitly "not scheduled" — so M29, whose four tasks already landed with only its live
Verify open, is the actual next milestone in working order.

## 2026-08-24 — M24.7 §C's chrome-strip overlap: three attempts, the third one measured
live and correct; identity block redesigned (title over author, marquee, JS-measured stacking)

The saga, kept in full because the first two attempts were plausible-looking and both wrong
in ways worth not repeating.

1. **Operator report 1**: at the spec'd `600px` `@container` breakpoint, the strip stayed
   single-row past the point the left zone's controls plus the nav pebble stop fitting —
   buttons/text overlapped instead of wrapping to two rows. Raised the threshold to `720px`
   across the four files that shared it. Genuinely correct as far as it went, but —
2. **Operator report 2**: overlap still happened in single-row mode, with a long title
   ("East of Eden (Steinbeck \"Essentials\")"). Diagnosed (wrongly, not yet measured live) as
   `.stripGrid`'s centre column: a bare `auto` track sizes to the title's full max-content
   width with no cap, which *should* squeeze the left/right `minmax(0, 1fr)` tracks below
   their own min-content. Fixed the centre track to `minmax(0, auto)`, then — when that
   didn't visibly help — an explicit `max-width` on `.topRowCenter`. Both were real, correct
   changes to that element. Neither fixed the report, because —
3. **Playwright, finally, instead of reasoning from the CSS**: installed a fallback
   Chromium build (`npx playwright install chromium` — no sudo, so `--with-deps` failed and
   was skipped) and drove the actual dev server against the real book
   (`East of Eden (Steinbeck "Essentials")`, resource id `8306c69a…`). Measured rects at
   800px: `.topRowLeft` (Annotations + chapter nav) rendered at 348px inside a track resolved
   to 234px — **the left zone was the thing overflowing, not the centre**. `.topRowCenter`
   obeyed its new `max-width: 300px` exactly and the overlap still happened regardless,
   because bug 1's "fix" and bug 2's two fixes were all correct changes to elements that
   weren't the problem.

The actual fix inverts which zones concede space: `.topRowLeft`/`.topRowRight` hold
*functional controls* (never safe to clip) and became bare `auto` grid tracks — sized to
their own content, full stop, never compressed. `.topRowCenter` (the book's identity, the one
thing here safe to truncate) is the sole flexible track (`minmax(0, 1fr)`), with no
`max-width` of its own — a grid item's default `justify-self: stretch` plus its own
`justify-content: center` gives "full text with even breathing room" at comfortable widths
and "shrink to whatever's left" at tight ones, for free, with one rule instead of two
competing ones.

Folded into the same pass, at the operator's request once the real bug was visible:

- **Title stacked over author** (`.identityText`, column flex) instead of side by side — a
  column needs the *wider* line, not their combined width.
- **A ping-pong marquee** (`useMarqueeOverflow.ts`, `.scrolling`/`@keyframes
  readerTitleMarquee`) instead of a hard ellipsis when a line's `scrollWidth` genuinely
  exceeds its box — measured live: a 22px overflow animates over 3s (a floor — distance is
  scaled at ~34px/s above it), holds at each end, reverses. Gated off under
  `prefers-reduced-motion: reduce` (falls back to plain ellipsis, verified live).
- **The two-row switch stopped being a `@container` query at all** (`useReaderStripLayout.ts`)
  — replacing both the `600px` and `720px` static thresholds outright. A fixed pane-width
  number structurally can't know how much of that width a title needs (bug 2's whole
  premise), and can't know how much room is actually left after two sibling zones claim
  theirs — no single container query can see three elements' widths at once. Measures
  `.topRow` against `.topRowLeft`'s/`.topRowRight`'s real rendered widths (stable now that
  they're never compressed) and toggles a plain global marker class
  (`readerStripStacked`) once what's left for the identity block drops under 140px (first
  estimate, named in the hook as expected to need live tuning same as its predecessors) —
  applied to both `.topRow` and `.footer` so they stay in lockstep by construction. Verified
  live across a continuous resize: crosses to stacked at 936px narrowing, back at 938px
  widening — no oscillation. `PageNumberDisplay`/`ChapterNav`/`NavCluster`'s own narrow-mode
  rules moved from `@container reader-strip` to `:global(.readerStripStacked)` selectors,
  same mechanism, same shared marker.
- **A real `column-gap`** on `.stripGrid` (was 0). Found live at a 420px pane: the grid math
  was already correct there (zones genuinely adjacent, not overlapping in any measured rect)
  but "adjacent at 0px" still reads as the cover thumbnail touching the nav pill in a
  screenshot. Cheap insurance the flexible track's own slack already made unnecessary at
  comfortable widths.

Verified live (Playwright) at 1200/950/900/800/600/500/420px, plus `prefers-reduced-motion:
reduce`, plus a continuous resize through the stacking boundary in both directions — not yet
the operator's own sign-off. M24.7's Verify checkbox stays open until that happens.

## 2026-08-24 — Six asks, triaged: three already exist; Define is a dictionary, not a prompt

The operator brought six items (highlight-kind config, a Define button + per-book glossary,
touch, deleting highlights, Deep Reading mode, and a far-future "what kind of reader are
you" graphic). Read against the code, **three of the six substantially already exist**, and
saying so is most of the value of this session — two of them would otherwise have been
rebuilt.

### What already existed (verified by reading, not assumed)

- **The four kinds already carry the operator's four semantic slots.**
  `web/src/reader/highlightKinds.ts:6` — `sage` = "Definition", `slate` = "Question",
  `rose` = "Revisit", `honey` = "Quote". The proposed defaults (Define/Green,
  Thematic Question/Purple, Regular annotation/Pink, Key quote/Yellow) are the same four
  slots, three of them already in the right hue family. **The ask is a rename plus one hue
  move, not a new taxonomy.**
- **Deleting highlights ships today**, end to end: `DELETE /api/highlights/:id`
  (`server/src/routes/highlights.ts:42`), a cascading `deleteHighlight`
  (`server/src/annotations/highlights.ts:202`), and two UI call sites — the margin rail
  (`MarginRail.tsx:71`) and the annotations overview (`AnnotationsOverview.tsx:101`).
- **Deep Reading mode is roughly 70% built.** `digest/thematicBuild.ts` already generates
  2–3 questions per chapter, each with a verbatim grounding quote (decision 11); clicking
  one creates a real anchored highlight and pre-fills the thread draft
  (`routes/digest.ts:476`, `ThreadPanel.initialDraft`). There is a per-book **reading
  brief**. Questions are already **spoiler-gated on reading position**
  (`routes/digest.ts:375`): `spineIndex > bookmarkSpineIndex`. That gate *is* the operator's
  "when a chapter is concluded" — it exists, nothing surfaces it at that moment.

### Kind colours: labels are configurable, hues are not

**Ruling: labels become a setting; the five reference hues stay code.**

The hues are not arbitrary and cannot be handed to a colour picker without deleting a
guarantee. `theme.css:63-75` records that the eight theme-ramp hues were *solved* for the
maximum minimum pairwise separation **against the four kind hues** (~28°, where naive 45°
spacing reached ~10°), and `scan/scanPalette.ts` is a second, hand-authored
paper-tint→phosphor translation with its own separation solve against the scan's near-black
panel. A free picker makes hue collision the reader's problem on two surfaces that were
deliberately engineered so it isn't.

The operator did not ask for a picker — they asked for configurable *labels*. Labels carry
no such coupling, so they move to settings and the hues stay put.

**One hue does move:** `slate` blue → purple, as asked. ⚠️ That is not a one-line edit —
`--kind-slate`, `PHOSPHOR_RGB.slate`, and the theme-ramp separation solve all key off it.
See M30.

**No fifth kind** (operator's call, offered three ways and chosen). The four slots already
say what the operator wanted to say; a fifth costs the zod enum, `theme.css`,
`PHOSPHOR_RGB`, `KIND_ORDER`, `heatField`, `ThemeFilterKey`, *and* re-solving hue separation
across thirteen hues instead of twelve. Revisit only when a fifth slot can be named.

**The rule this settles, for cases nobody has raised yet:** *a highlight kind's identity is
its slot, not its presentation.* The stored enum value (`rose|sage|honey|slate`) is
permanent and is what the DB, the scan, the filters and the vault key off. Label and hue are
renderings of it. Renaming a kind must never migrate a row, and must never be able to make
two kinds indistinguishable on the reader or the scan.

### Define: a dictionary first, the digest as fallback — capped

The operator refined the recommendation and was right to. The trigger case is *"a word I
don't know"* — vocabulary expansion — not *"a term this book has developed"*. So:
**dictionary first; if that fails, a digest-grounded query capped under 100 tokens.**

Two consequences worth stating, because both are load-bearing:

1. **"Dictionary" means a real local dictionary, not an LLM told to act like one.** A
   dictionary API would be a *third* named cloud exception under settled decision 10, for a
   lookup that is offline, instant and free when bundled. This follows the TTS precedent
   exactly (decision 9: local Kokoro, no cloud, behind a seam). A bundled dataset is the
   boring choice and it makes Define work with no provider configured at all — which
   matters, because the reader reaching for Define is mid-sentence, not mid-research.
2. **The fallback is the digest rung, not the whole book** — consistent with decision 8's
   M17 amendment. With a <100-token cap it is a cheap call, and the cap is a *product*
   constraint, not a budget one: a definition that runs long stops being a definition and
   starts being a thread, which the reader can already open by asking.

**Define is the first canned-prompt button in the app**, and that is the thing to be
deliberate about. "The highlight is the prompt" (CLAUDE.md, product discipline) survives
intact — Define still starts from a selection. What is new is that the *question* is
supplied by the app rather than typed. That is permitted, and bounded: **a canned button is
legitimate only where the question is fully determined by the selection itself.** "Define
this word" is. "Summarise this chapter" is not — it needs a scope the selection doesn't
carry, and would be a second, different feature.

**The glossary needs no new table.** It is a filtered view: sage-kind highlights in this
book that have a definition. Building a `glossary` table would create a second source of
truth for something the highlights table already holds, and would rot the moment a
definition highlight is deleted.

### Touch: two projects, one of them blocked on a rung

The operator's phrasing — *"swipe is for page traversal"* — describes an intent, not the
app. **There is no touch handling in the reader at all**: no `touchstart`, no
`-webkit-touch-callout`, no `contextmenu` handler. Page turns today are a click in a
semicircular turn zone (`readerGeometry.ts:63`, `ReaderView.tsx:1966`) plus keyboard. This
matters because the ask reads as "fix touch" and is actually "build touch".

Splitting it the way the 2026-08-06 measurement implies, but with the gate stated more
sharply than that entry did:

- **Buildable today** — the gesture layer: swipe-to-turn and long-press-to-select, verified
  on any touch-capable machine. That entry's measurement holds (7 mouse-specific handler
  sites; both large gestures already on pointer events).
- **Blocked on hardware** — iOS's native selection callout. The lever exists and is known:
  `rendition.themes` CSS *does* reach iframe content, unlike marks, which live in a
  parent-document SVG pane and are why `highlightKinds.ts` exists at all. But whether
  suppression is survivable cannot be settled by reading code, and **there is no iPad to
  test on until the Private rung lands** — the server binds to loopback by the M6 security
  decision. This is the same gate as iPad drawing (2026-07-27 "Future arcs"), and it should
  be counted once, not discovered separately by each feature that hits it.

⚠️ **The actual design work is disambiguation, not gestures.** Swipe-to-turn and
drag-to-select are the same pointer stream until a rule separates them, and tap-to-turn
already competes with tap-to-dismiss-the-pill. Whoever builds this decides that rule first
and writes it down; getting it wrong makes the book impossible to annotate *and*
impossible to page, which is worse than no touch support.

### Delete: the hazard is more urgent than the feature

The ask was "the ability to delete existing highlights", which exists. The real gaps, in
priority order:

1. **Delete has no confirmation and cascades irreversibly.** `deleteHighlight`
   (`annotations/highlights.ts:202`) drops the highlight, its thread, *every message in
   that thread*, and its `publishes` ledger rows, in one transaction. The margin rail
   exposes this as a small `×` sitting next to the navigate target
   (`MarginRail.tsx:71-82`). One misclick destroys a whole conversation with no undo. This
   is a **bug to fix before adding more delete affordances**, not a polish item.
2. **You cannot delete from where you are** — not from the thread panel, not from the mark.
   Only from the rail and the overview, both of which are instruments you have to open.

Recorded because it will come up: the fix is a confirm step *or* an undo window, not both,
and the choice is made in M30 rather than left to the implementer.

### Deep Reading: build the trigger, not the engine

Given how much exists, the milestone is small and precise:

- **The trigger.** Nothing surfaces a chapter's questions at the moment the chapter ends.
  The signal exists on both sides (`currentSpineIndexRef` via `handleRelocated` client-side;
  the bookmark gate server-side). **It is a quiet affordance, never a modal** — decided
  here, not left open, because CLAUDE.md's "reading comes first / never let the AI layer
  degrade the reading experience" already settles it. An interstitial between chapters is
  exactly the layout-blocking interruption that rule forbids.
- **Your own questions.** Per-highlight `note` already gives answer-space, autosaved. The
  one genuinely new storage need in the whole list is a **chapter-level question with no
  passage anchor** — every highlight today requires an anchor, and a question about a
  chapter as a whole has nothing to anchor to.

⚠️ Sequenced after M29's live **Verify**, which is still unchecked. M29's code is done, but
Deep Reading puts the thematic layer in the *reading* path, where a stall is felt
immediately rather than on a digest page the reader chose to open. Verify first.

### Reader-type graphic

Far future, unscheduled, and left that way. Noted only so it isn't foreclosed: its inputs
are the kind distribution and the reader's own question corpus — exactly what M30 and M31
produce. Nothing to build now.

### Sequencing

Operator's call: **touch and the highlight rework first, then Deep Reading.** Recorded as
M30 (highlights), M31 (touch), M32 (Deep Reading) — appended, not inserted, so nothing
renumbers.

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
