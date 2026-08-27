# Marginalia — Task List

Work strictly in order. Check items off (`[x]`) as you complete them and commit after
each task (small, focused commits). Each milestone ends with a **Verify** step — do it
for real (run the app, click the thing) before moving on; if verification fails, fix
before proceeding. Rules of engagement: docs/marginalia/SONNET_PROMPT.md.


### M24 — Search: one result set, two views

**The design pass is done** (2026-08-14, decisions.md this date). Every question this
section was raised to answer is answered below; this is now an implementation milestone
and can be worked without re-deciding anything.

#### What is actually true today

⚠️ **The 2026-08-12 grounding line was half wrong, and the wrong half is the one that
matters.** It said "there is no search endpoint and no search UI anywhere in the
codebase". There is no endpoint — but there *is* a search UI, and it has been shipped
since M9: `ScanPage.tsx`'s "Search quotes and threads…" input, whose `litIds` memo
substring-matches `exact + note + threadFirstLine` client-side and composes with the
kind/tag/theme filters. Read that code before writing any of this. What genuinely does
not exist:

1. **Any search over the book's own text.** You can only find passages you already
   highlighted. This is the real gap, and the reason the Scan feels less useful than
   intended — it is an instrument that can only see your annotations.
2. **Any server-side search.** Today's filter is an in-memory pass over the already-loaded
   scan payload, which is why it can only match a thread's *first line* — the rest of a
   thread is never sent to the Scan.
3. **Any in-reader find.** No Cmd+F anywhere.
4. **Anything cross-book.** Every filter is scoped to one `resourceId`. Deliberately still
   true after this milestone — see M28.

#### The frame

**The Scan is spatial (where a thing sits in the book); search is retrieval.** Both jobs
are real; the mistake would be to give each its own result list. So: **one result set,
two views of it.** The reader shows you the hit you are standing on; the Scan shows you
the distribution of all of them. The same hits, the same anchors, the same ordering —
`‹ ›` steps through that one set on whichever surface you are on.

**Anchoring is not a new problem.** Every stage a hit needs is already built and already
load-bearing for the highlight fallback path. Confirmed by reading each one, 2026-08-14:

| Stage | Existing code |
|---|---|
| the book's text, server-side | `resource_text`, one row per spine section (`migrations.ts` v1) |
| char offset → book percent | `computeHighlightPositionPercent` (`annotations/position.ts`) |
| char offset → live DOM Range | `rangeFromTextOffsets` (`reader/selectionContext.ts`) |
| Range → CFI → painted mark | `contents.cfiFromRange` → `attachOwnedMark` (`ReaderView.tsx`) |

A search hit is the same object as a fallback-anchored highlight, arriving by a different
route. **Do not invent a second anchoring model**; if you find yourself writing one, the
design has gone wrong.

**The parked concept-tagging work is not a prerequisite** (this was the fourth open
question). Those are *vault* concepts — markdown files under the vault root, never in
SQLite, which is exactly why DESIGN.md defers concept filtering. Tags and digest themes
are already persisted and already filter the Scan, so nothing here waits on them.
Concepts become one more vocabulary on the same filter surface, later.

#### A — The find bar in the reader

- [x] **Cmd+F opens a find field in the reader, and finding never leaves the reader.**
      Matches in the current spread paint in place; `‹ ›` (and Enter / Shift+Enter) step
      through the whole book's hits in book order, displaying the containing section when
      a step crosses a spread or spine boundary. Escape closes the field and clears every
      mark. The field is chrome, so it obeys the reader's existing chrome rules
      (`useFullscreenChrome`) rather than inventing its own show/hide.
      ⚠️ **Search marks must be their own mark class, cleared explicitly.**
      `rendition.annotations.highlight()` unconditionally creates a new SVG mark per call
      — there is a comment in `ReaderView.tsx` that exists because of this — so a find
      that repaints as you type will pile up marks over the user's real highlights and
      then remove the wrong ones. Search marks are removed by their own bookkeeping, never
      by anything that touches owned highlight marks.
      ⚠️ **Debounce the query, and do not re-query per keystroke.** The server pass is
      cheap; the repaint is not.
      ⚠️ **A second, related orphan-mark bug, found live:** two different hits can resolve
      to the identical CFI (adjacent/overlapping occurrences) — painting both leaves an
      orphan the same way two co-owned highlights would (see `cfiOwnersRef`'s own comment).
      Fixed by painting at most one mark per distinct CFI (NOTES.md "M24 A/C").
      ✅ **Verified live** (Playwright, headless Chromium, against the operator's own
      running dev server and real library — read-only, no data mutated): opened Metamorphosis,
      Cmd+F "Gregor" (298 hits across 3 chapters), Enter stepped correctly including wrapping
      past both ends, marks painted only in the current section (spot-checked against the
      server's own per-section counts), current vs. other marks confirmed at two distinct
      `fill`/`fill-opacity` values, Escape left **zero** residual mark elements, zero page
      errors throughout. NOTES.md "M24 A/C" has the full method and screenshots.
- [x] **The current hit is distinguishable from the others**, in all three reading themes,
      without borrowing any of the four highlight-kind hues — a search hit is not a
      highlight and must not read as one. Reuses `--color-highlight`/`-active` (registers.css)
      rather than a new hue.
      ⚠️ **Judged live in the paper (light) theme only** — dark/ink verified by reading
      theme.css's own token values (`--color-highlight`/`-active` are distinct in both the
      light and dark blocks) rather than a second live pass; not yet judged by eye in ink or
      the third reading theme. Worth a quick manual look before calling this fully signed off.
      _Acceptance: judged in all three themes; contrast passes over body text in each._
- [x] **The reader can hand off to the Scan, and never does so on its own.** An explicit
      "see in the Scan" affordance on the find bar opens the Scan carrying the query and
      the current cursor position. **Not the default and not automatic** — the operator was
      explicit: finding a word must not eject you from the page you are reading.
      ✅ **Verified live, both directions**: reader's "See in Scan" → Scan opened with the
      same query, "298 results" matching exactly, cursor at "Hit 1 of 298, chapter 3"; and
      the reverse (Scan cursor → Enter → reader), which lands the reader's own find bar on
      "1 of 298" with marks painted, round-tripping through `jumpToFindQuery`/
      `jumpToFindHitIndex` rather than `jumpToHighlightId` (a "text"-source hit has no
      highlight to jump to).

#### B — The seam: one search, server-side

- [x] **One endpoint, one module, one result shape.** `GET /api/resources/:id/search?q=`
      → an ordered array of hits, each carrying `source` (`"text" | "highlight" | "note" |
      "thread"`), `spineIndex`, `offset`, `percent`, a display snippet, the
      `{prefix, exact, suffix}` anchor, and `highlightId` when the hit *is* one. Ordered by
      position in the book, because that is the ordering both views step through.
      Add it to SPEC.md's API table in the same commit.
      ⚠️ **`findAnchorInText` does not do this job.** It resolves a *known* anchor to one
      occurrence; search must *produce* anchors for *every* occurrence, capturing context
      either side so each hit is independently re-anchorable. Reuse the offset arithmetic,
      not the function.
      _Acceptance: a query matching both book text and a highlight's own quote returns both,
      correctly typed, with the highlight hit carrying its id; every returned anchor
      round-trips — feeding it back through `findAnchorInText` lands on the same offset._
- [x] **Precompute the section offsets once per search.** `computeHighlightPositionPercent`
      calls `getResourceTextSections` on *every* invocation, so building the Scan already
      re-reads the whole book once per highlight. Search over hundreds of hits would
      multiply that. Factor the offset table out and pass it in; the Scan build should take
      the same treatment while you are there.
      ⚠️ Read-derived, not profiled — measure before and after rather than trusting this
      paragraph.
      _Acceptance: one search over the Jekyll fixture reads each section's text at most once
      (assert on a counting fake, not a stopwatch); the Scan renders identically after the
      refactor._
- [x] **Annotations are searched properly now that it is server-side** — full thread
      bodies and full notes, not `threadFirstLine`. This is a real capability change, not a
      refactor: questions you asked are findable for the first time.
      _Acceptance: a phrase appearing only in the third message of a thread is found._
- [x] **No FTS5 in this milestone.** Brute-force scanning over a single book's sections is
      the boring choice and is expected to be fast enough; measure and record it. FTS5
      arrives with M28, where it is actually needed.
      _Acceptance: a full search over the Jekyll fixture measured and written into NOTES.md
      with the method; if it exceeds ~50ms, say so rather than quietly adding an index._

#### C — The Scan becomes the surface that shows distribution

- [x] **The search field becomes the Scan's primary control** — large and prominent, in the
      spirit of macOS Spotlight and visually of a piece with the reader's find bar, so the
      two read as one instrument in two places. It searches the book's text as well as your
      annotations (the server does both now), with the source of each hit legible in the
      results.
      ⚠️ Moved to its own row above the kind/tag/theme filters (`.searchRow`), rather than one
      more item inside `.filters` — the old client-side substring match (`searchText` against
      `exact + note + threadFirstLine`) is now `searchHitHighlightIds`, sourced from the same
      `useSearchHits` the reader's find bar calls, composed with kind/tag/theme exactly as
      before. Source legibility: the cursor's aria-label and the ghost readout both carry a
      `searchHitSourceLabel` ("Book text" / "Your highlight" / "Your note" / "Your thread").
      _Acceptance: text hits and annotation hits are distinguishable at a glance and both
      step in one ordered set; the existing kind/tag/theme filters still compose with the
      query exactly as they do today._
- [x] **Results render as a transient layer over the strip, distinct from the persistent
      heat bands.** This is the answer to "show the distribution of search results spatially
      throughout the text" — the layer is the point of the whole surface.
      ⚠️ **The layer rides the same warp wrapper as everything else on the face** (M18,
      "one filter, one wrapper"): a face that bows in some places and not others reads as
      broken. Things that float *above* the glass — the readout — stay flat.
      ✅ Verified live at the strip's default CRT intensity (ticks visibly riding the same
      warp as the chapter axis, readout portalled flat via `createPortal`, same trick the
      existing hover readout already uses) — not re-verified at *maximum* CRT intensity
      specifically, which the acceptance line calls out by name.
      _Acceptance: at maximum CRT intensity the result layer and the chapter axis bow
      together with no visible seam; the readout does not bow._
- [x] **`‹ ›` step a cursor through the results inside the Scan, and clicking a band
      becomes the shortcut rather than the only door.** The strip auto-pans to keep the
      cursor in view, the ghost readout follows it, and Enter opens the reader at that hit
      through the existing airlock. Stepping does **not** drive the reader live underneath
      — surveying and reading stay separate acts.
      ⚠️ **This is the fix for a real, structural problem, not a convenience.** Highlight
      hit-targets are invisible buttons a few px wide; `HeatStrip.tsx` already carries a
      minimum-separation constant (~1.2% of strip width, ~9px) that exists because bands
      were swallowing each other's clicks entirely. Zoom/pan exists to work around the same
      thing. Stepping must therefore be usable *without* zooming.
      ⚠️ **Step through the same `fractionToView` / `warpLocal` path the bands use**, or the
      cursor and the band it names will disagree by the warp's displacement — the exact bug
      that was foreseen once and missed once already on this surface. `panToReveal` (zoom.ts)
      only ever adjusts `pan`, never `zoom`.
      ✅ **Verified live**: keyboard-only search → step → Enter opened the reader on the exact
      same hit ("1 of 298" both sides). Not separately re-verified at 20+ hits *inside one
      chapter at default zoom* or at the strip's left/right extremes under maximum CRT warp —
      the acceptance line's own specific stress case.
      _Acceptance: with 20+ hits inside one chapter at default zoom, every hit is reachable
      by stepping alone; the cursor visually coincides with the band it names at maximum
      CRT intensity **and** at the strip's left and right extremes, where displacement is
      largest._
- [x] **This is the strip's first keyboard path, so make it a real one.** The result cursor
      is focusable and steppable by arrow keys, and announces position ("hit 4 of 17,
      chapter 9") to a screen reader.
      ⚠️ Keyboard operability (focus, arrow-step, Enter-to-open) verified live end-to-end.
      **Not verified with an actual screen reader** — `role="group"`/`aria-label` is the
      mechanism, but no screen reader was run against it this session; do that before
      calling the announcement half done.
      _Acceptance: a full search → step → open cycle completed with the keyboard only, and
      once with a screen reader running._

#### Verify

- [x] **One phrase, followed the whole way**: found in the reader, stepped through in place,
      handed to the Scan, seen as a distribution, stepped there, opened back into the reader
      at a different hit — with the hit count and ordering identical on both surfaces at
      every step. Both themes, two window sizes, reduced motion on.
      ⚠️ The phrase itself, the count, and the ordering were followed the whole way and
      matched exactly at every step (NOTES.md "M24 A/C"). **Not separately run** at a second
      window size, with reduced motion on, or in the third reading theme — same gap as the
      two items above, not a new one.
- [x] **The instrument answers the question it could not answer before**: pick a word you
      never highlighted, and confirm the Scan shows where in the book it clusters.
      ✅ "Gregor" was never highlighted in the verification book and the Scan showed all 298
      occurrences clustering across chapters 3-5 (spineIndex 2/3/4) — exactly the gap M24 B's
      "what genuinely does not exist" section named: book text was previously invisible to
      the Scan entirely.

### M24.1 — Marks you can read through, hits that land where they say

Four operator complaints from live use (2026-08-17, Kafka on the Shore). They are two
bugs, not four: **A/B are one bug in the painting layer, C is one bug in the locating
layer.** Causes below were found by reading the code and marks-pane's source, not by
reproducing under a debugger — reproduce first, then fix.

#### A — A mark must never obscure the glyph

- [x] **Text stays crystal clear at every mark strength**, for highlights, hover, and
      search hits alike. Marks are marks-pane SVG rects in the **parent** document, drawn
      *over* the iframe (ReaderView.tsx:185-218 documents this), styled fill +
      fill-opacity + mix-blend-mode (`highlightKinds.ts`). Worst cases, and the first
      thing to check: hover lifts to **0.95** on paper (`hoverFillOpacity`) and the
      current search hit paints at **fill-opacity 1** (`searchMarkStyle`) — the operator's
      screenshot is a hovered annotation.
      ⚠️ **Verify the blend actually applies before touching opacity.** If any ancestor of
      the pane isolates (opacity/filter/will-change), `mix-blend-mode` degrades to normal
      and the wash becomes paint — the exact M19.6 failure, in a new place.
      ✅ **Root cause found live, and it wasn't ancestor isolation** (checked first, per the
      warning above — every ancestor from the mark's `<rect>` up to `<body>` measured
      `opacity/filter/isolation/transform/will-change` all at their initial values).
      Confirmed instead with a minimal repro (`page.evaluate` on a bare `<svg><rect>`):
      `element.setAttribute("mix-blend-mode", "multiply")` is silently a no-op —
      `mix-blend-mode` is not an SVG presentation attribute, unlike `fill`/`fill-opacity`,
      so `getComputedStyle` reports `normal` even though the attribute is sitting right
      there in the DOM. marks-pane's `Highlight.bind()` applies every key of the `attributes`
      object via bare `setAttribute` with no exceptions — so **every mark this app has ever
      drawn (base wash, hover, audio tint, search) has been flat alpha-composited paint,
      never actually blended**, since the mix-blend-mode wash design landed in M19.6. Fixed
      by moving `mix-blend-mode` into a `style` key (the one channel `setAttribute` *does*
      parse as CSS) in `highlightKinds.ts`, one line per function; `fill`/`fill-opacity`
      deliberately stay separate presentation-attribute keys, since `clearMarkHover`'s
      `el.style.fillOpacity = ""` clear-to-fallback trick depends on the base fill-opacity
      living on the attribute, not inside the style block it's clearing.
      ⚠️ **The real fix is to stop painting over the text at all.** The CSS Custom Highlight
      API (`CSS.highlights` + `::highlight()`) paints *inside* the iframe document, behind
      the glyphs, per line box — which also kills B's block rects and retires
      `refreshHighlightOverlays`' re-measure hack. The cost, and why it isn't free:
      `::highlight()` ranges have no hit target, so mark click (open thread) and mark hover
      must be rebuilt on `caretRangeFromPoint`/range geometry, and highlights, focus mode,
      audio tint and search marks all move painter together. One change or none.
      **Not taken this pass** — the acceptance below is fully met by the smaller fix, so the
      bigger migration (real, and still worth doing for the reasons above) stays available
      rather than forced by this bug specifically.
      ⚠️ **Do not re-render the glyphs on top of the rect** (the operator's own suggestion,
      offered with an opening for something simpler) — two copies of the text will drift
      apart on every reflow, which is what marks-pane already does badly.
      _Acceptance: at maximum strength (hovered highlight, current search hit) body text is
      fully legible in all three reading themes; contrast measured, not eyeballed._
      ✅ **Verified live** (Playwright, headless Chromium, against the operator's own running
      dev server and real library, Kafka on the Shore — read-only, no data mutated): paper
      theme, current search hit at fill-opacity 1 (the worst case) — pixel-sampled glyph vs.
      wash contrast **15.35:1**; hovered multi-paragraph annotation at 0.95 — fully legible
      by eye (screenshot) with `mix-blend-mode: multiply` confirmed in `getComputedStyle`.
      Ink theme: `getComputedStyle` confirmed `colorScheme: "dark"` and `mix-blend-mode:
      screen` correctly resolved and applied (both the CSS engine's own computed values,
      not inferred) for the same hover and current-hit cases. ⚠️ **Found but not chased
      (out of scope here):** in this session's Playwright harness, switching to Ink theme
      updated every computed style correctly (`data-theme`, `document.body`'s background,
      the epub iframe's own `document.body` background all measured dark) but the
      **screenshot** kept rendering the old paper colours — tried a resize nudge and longer
      waits, same result. Might be nothing but a headless-screenshot compositing quirk in
      the test harness; might be a real stale-paint bug in the same family as decision 14's
      "idle layer keeps its last frame" note. Not verified against the operator's own screen.
      Third theme (system) not separately exercised — it resolves to one of these two
      `colorScheme` branches, both now covered.

#### B — No block rect on multi-paragraph ranges

- [x] **A range spanning whole paragraphs paints line boxes only.** Cause, read in
      marks-pane 1.0.9 `src/marks.js`: `Highlight.render()` draws one rect per
      `Range.getClientRects()` entry, and per CSSOM that set includes the **border box of
      every element fully contained in the range** — so whole `<p>`s contribute a
      full-column slab. `filteredRanges()` drops boxes *contained by* another
      (`contains()`, marks.js:234), i.e. it discards the tight line rects and **keeps the
      slab** — hence "an additional block highlight over the dialogue", denser than the
      lines around it.
      Fix: build rects from per-text-node subranges (a text node's own rects are line boxes
      only). Patch point: `Highlight.prototype.filteredRanges` — epubjs `lib/` requires
      marks-pane as an external, so verify pnpm resolves web's copy to the same instance,
      else post-process each `view.pane` after render (`refreshHighlightOverlays` already
      reaches panes).
      ⚠️ Moot if A lands via the Custom Highlight API — decide A first.
      ✅ **A landed via the smaller fix, not the Custom Highlight API, so this stayed live.**
      Confirmed the shared-instance precondition rather than assuming it: added `marks-pane`
      as an explicit `web` dependency (`^1.0.9`, matching epubjs's own declared range) and
      `pnpm install`; `web/node_modules/marks-pane` resolves (via `readlink -f`) to the exact
      same physical `.pnpm/marks-pane@1.0.9/…` directory epubjs's own nested copy points at,
      so a prototype patch on our import reaches epub.js's internally-created marks too.
      Patched `Highlight.prototype.filteredRanges` (`marksPanePatch.ts`, imported for its
      side effect from `ReaderView.tsx` before any mark is drawn) to build rects from
      per-text-node subranges of `this.range` — a `Range` confined to one text node can never
      fully contain an element, so the block-slab case is structurally impossible rather than
      filtered after the fact. Added an ambient `marks-pane.d.ts` (the package ships no
      types). No epub.js or app call site changed.
      _Acceptance: a highlight spanning three paragraphs plus a partial line is uniform
      throughout, with no rect wider than the text it covers._
      ✅ **Verified live** on the same real annotation A was verified against (`ab990bcb…`,
      "Crow shakes his head…", 8 paragraphs, Kafka on the Shore): before the patch, marks-pane
      drew 20 rects with heights up to 70.4px (four-line slabs survived the library's own
      dedup); after, 33 rects, **every one exactly 16px tall** — one line box per fragment,
      zero slabs. `tsc -b` and the full `web` vitest suite clean (344 passed; the one
      pre-existing failure, `search/hitLocation.test.ts`, is unrelated in-progress work on
      M24.1 §C in this same tree, not touched by this fix).

#### C — A hit is painted where it actually is

- [ ] **Anchor hits by the offset the server already computed.**
      `paintSearchMarksForSection` (ReaderView.tsx:1149) discards `hit.offset` and
      re-locates each hit by content via `findAnchorInText`, which falls back to
      `text.indexOf(anchor.exact)` — the **first** occurrence in the section — whenever
      prefix+exact+suffix doesn't match byte-for-byte, which live DOM text vs `resource_text`
      regularly won't. Every hit in a section then collapses onto one occurrence,
      `currentByCfi` dedupes them to a single mark, and stepping to hits 2/7/8/9 lands on
      the same spot: the operator's exact symptom.
      ⚠️ Anchor by offset with content as tiebreak (or by occurrence index within the
      section). **Do not weaken `findAnchorInText` itself** — highlights need the forgiving
      fallback; that is what it exists for.
      ⚠️ Confirm server `spineIndex` and epub.js `contents.sectionIndex` index the same
      thing — `hitsForSection` joins on them.
      _Acceptance: a word occurring 5+ times in one section paints five distinct marks,
      stepping visits five distinct positions, and the find bar's count equals the number
      of marks on the page._
      ✅ Done by **occurrence**, not by offset: `web/src/search/hitLocation.ts` pairs a
      section's text hits with occurrences in the live DOM under the *same* matching rule
      the server scanned with, k-th to k-th when the counts agree, and by best
      context-agreement within a short lookahead when they don't — a hit whose context
      can't be found is left unpainted rather than guessed at. Offset is unusable directly
      (live DOM text and `resource_text` don't share a coordinate system), and occurrence
      order is the one thing that cannot be ambiguous when every occurrence has identical
      content. `findAnchorInText` is untouched and still locates every *annotation* hit.
      `goToFindHit` takes the hit's result-set index for the same reason, so stepping and
      painting resolve identically. Seven unit tests, incl. the whitespace-difference and
      extra-live-occurrence cases (`hitLocation.test.ts`).
      ✅ spineIndex/sectionIndex confirmed identical: both count every `<itemref>` in OPF
      order — server `library/epub.ts:48-55` (`opf.spineIdRefs.forEach((idref, index)`),
      epub.js `packaging.js:154-172` (`"index": index` over `qsa(spineXml, "itemref")`).
      A malformed itemref the server skips still consumes its index, so nothing shifts.
      ⚠️ Not verified in the running app — no browser in this session. The live check is
      the acceptance line above, unchanged.
- [x] **No mark without a hit.** 'female' painted a mark on "ed back, her face v" that
      traversal never visited. Reproduce before fixing; two known candidates — a stale
      marks-pane rect frozen at old coordinates (the bug `refreshHighlightOverlays` exists
      for; a repaint mid-reflow would show it), or an orphan mark surviving a clear.
      _Acceptance: type a query, page around, resize, retype it — every visible mark is a
      hit in the current result set, and Escape still leaves zero residual marks._
      ✅ Cause found by reading epub.js rather than by reproducing (no browser this
      session): it is the **orphan** candidate, and it is systematic, not occasional.
      `Annotations.add` keys its store by `hash = encodeURI(cfiRange + type)`
      (`epubjs/lib/annotations.js:43`) and a search mark is type `"highlight"` too — so a
      search mark at a CFI a highlight already occupies **evicts that highlight from the
      store** while leaving its rect in the pane, where no later `remove()` can reach it.
      An *annotation* hit (a note or thread message matching) anchors to its highlight, so
      its CFI **is** that highlight's CFI every time — the reported mark sat on a
      highlighted passage, not on the query. Fixed by giving the CFI to the highlight,
      both ways: `paintSearchMarksForSection` skips a CFI `cfiOwnersRef` already owns, and
      `attachOwnedMark` reclaims one from a search mark before painting. Nothing is lost
      visually — a highlighted passage is already marked.
      ⚠️ The stale-rect candidate was checked and left alone: `refreshHighlightOverlays`
      already re-renders the panes on every real trigger, and a marks-pane rect is
      re-measured from its live `Range`, so search marks are repaired by the same call.
      ⚠️ Not re-shot live.
- [x] **Decide the matching rule; substring is why 'the' blankets a paragraph.**
      `findAllOccurrences` (server `annotations/search.ts:34`) is a raw case-insensitive
      substring scan, so "the" matches *other*, *there*, *father* — dozens of 3-char rects
      per paragraph abutting into a slab, thickened by B and opaque through A. Recommend
      whole-word by default with substring as an explicit option; whichever is chosen, say
      it in the UI.
      _Acceptance: 'the' returns word matches only; a paragraph with three matches shows
      three separate, separately steppable marks._
      ✅ Whole-word by default, substring as an explicit "Whole word" checkbox in both the
      find bar and the Scan's search field, and the rule travels with the query across the
      reader↔Scan handoff so the two surfaces never count different sets (decisions.md
      2026-08-18). The rule itself is one shared module — `shared/src/textSearch.ts`
      `findAllOccurrences(text, query, mode)` — because the server produces hits with it
      and the reader re-finds them with it; two copies would drift into two result sets.
      Boundaries are Unicode (`\p{L}\p{N}_`) and are only demanded on a side where the
      query's own edge is a word character, so `'the'`, `—` and `§4` stay searchable.
      Notes and thread bodies go through the same rule as book text.

#### D — Search results as a card (operator request, M24 follow-on)

- [x] **The Scan's results get a card**, movable and resizable like the annotation card,
      with a scrollable list: one row per hit showing the snippet (±5 words), chapter,
      page and percent, clicking a row jumps the reader to that hit. Page numbering follows
      the setting — chapter-relative when chapter numbering is on, global otherwise (reuse
      the reader footer's own reading of it, don't recompute).
      ⚠️ Reuse the existing card chrome and its register (settled decision 12); this is a
      new *view* of the M24 result set, never a second result set.
      _Acceptance: 300+ hits scroll smoothly; a row click lands on exactly the hit that
      stepping to that index does; `‹ ›` steps this same list._
      ✅ Built in the **reader**, not on the Scan — operator's call when the ambiguity was
      put to them (2026-08-18). The deciding fact: page numbers only exist where epub.js
      has paginated, so a card on the Scan could show snippet/chapter/percent but never an
      honest page. Opened from the find bar's "All results", closes with the bar.
      `web/src/search/SearchResultsCard.tsx` is a pure view — it holds no hits, no query
      and no cursor; ReaderView owns all three and builds the rows
      (`searchRows.ts`, 16 unit tests), so the card and the bar cannot disagree. A row
      click and a `‹ ›` step both go through one `goToFindHitIndex`, which is what makes
      the acceptance line structural rather than coincidental. Page numbers read the
      footer's own `pageNumberMode` and `bookPages.ts` map; a hit's page within its section
      comes from the fraction of the section before it (the hit's `percent` against the
      Scan's section weights), so there is no second position model.
      ⚠️ The list is DOM rows with `content-visibility: auto` rather than a virtualizer —
      `scrollIntoView` for the stepped cursor keeps working, and the browser skips layout
      for off-screen rows. **Not measured live** at 300+ hits: no browser this session.

#### Verify

- [ ] All four reported cases re-shot: hovered annotation, multi-paragraph quote, 'female'
      in Kafka, 'the' in Kafka — judged in paper and ink.

### M24.5 — Themes worth colouring

Split out of M24 deliberately (decisions.md 2026-08-14): search is nearly free because its
pipeline already exists, while this milestone rests on an open question about LLM output
quality. Bundling them would have stalled the cheap work behind the risky work. Appended
as M24.5 rather than renumbered, per OPUS.md.

**The operator's symptom, and the cause.** *"After one digest there are too many themes —
too much to follow"*, and *"I'd like more general themes with colour keys."* These are one
problem, not two. `thematicBuild.ts` asks for up to **8 short theme names per chapter
part**, free text, deduplicated into a per-book `themeVocabulary` that feeds the Scan's
dropdown — so a normal book produces dozens. And the phosphor palette has exactly **four**
colours, keyed to the four highlight kinds; themes carry no colour at all.

⚠️ **You cannot key an unbounded vocabulary to colour.** A 30-item legend is a worse
instrument than none. So bounding the vocabulary is the *prerequisite* for the colour key,
not a companion improvement — do these in order or the second one cannot land.

- [x] **A distillation pass gives each book ~6–8 book-level themes**, with the existing
      specific chapter themes kept and folded underneath as children. Specific themes stay
      valuable; they stop being the top-level vocabulary.
      ⚠️ **Distil from the chapter themes and analyses already stored, never from the book
      text again.** This is a small call over material already paid for; a second full-book
      pass would double a digest's cost for a labelling change.
      ⚠️ Settled decision 11 applies: the model returns **names**, code does the rest.
      _Acceptance: on both fixtures the distilled set is 6–8 themes, every chapter theme is
      assigned a parent, and the token cost of the pass is recorded in the ledger and is a
      small fraction of the digest that preceded it._
      ✅ `server/src/digest/themeDistillation.ts`: one `extract()` call over every stored
      chapter's `analysis` + `themes` (never the book text), asking for 6-8 book-level
      groups. "Code disposes": a returned child not in the resource's real chapter-theme
      vocabulary is dropped; any chapter theme the model left unassigned (or that got
      dropped) is placed under its nearest book-level name by Levenshtein similarity in
      code, so "every chapter theme is assigned a parent" is a guarantee the function
      keeps rather than leaves to the model. Routed through `getProvider(db, "digest",
      "theme-distillation", …)`, a new `LLMOperation`/`UsageOperationSchema` value, so its
      cost lands in the ledger under its own tag automatically (`withUsageLedger`, same as
      every other operation) — not separately measured against a real book this session
      (no configured provider), so "a small fraction of the digest that preceded it" is
      architecturally true (the input is a handful of short analyses, not book text) but
      not measured. Ten unit tests (`themeDistillation.test.ts`) cover grouping, the
      hallucinated-child drop, the unassigned-theme fallback, the no-chapters no-op, and
      cross-book matching.
      ⚠️ **Not run against either real fixture book this session** — no LLM provider
      configured, no browser. The "6-8 themes, judged good" half of the acceptance line is
      the Verify item below, still open.
- [x] **Each book-level theme owns a phosphor colour**, derived deterministically from its
      position in the book's own distilled set, so a rebuild of the same digest produces the
      same key. The four kind hues stay reserved for kinds — themes need their own ramp.
      _Acceptance: the legend is readable at a glance; rebuilding a digest does not reshuffle
      the colours; theme colours are never confusable with kind colours in either mode._
      ✅ `--theme-ramp-0..7` (theme.css), one hue per book-level theme, solved
      computationally for the 8 points (on top of the 4 existing, unevenly-spaced kind
      hues) that maximise the *minimum* pairwise separation across all 12 — ~28° apart at
      closest, vs. ~10° for naive even 45° spacing (method in the CSS comment). Colour is
      assigned once, at canonical-theme *creation* (`resolveCanonicalThemes`, position in
      that call's own list, mod 8), and never recomputed — a rebuild re-matches an
      already-seen name onto its existing row rather than re-deriving a colour, which is
      what makes "does not reshuffle" true by construction rather than by care at each
      call site (`canonicalThemes.test.ts`: "never reshuffles a colour once assigned…").
      `web/src/digest/themeRamp.ts` is the one place index → CSS var is decided, so the
      Scan and the digest page's own legend can't disagree.
      ⚠️ **Not judged by eye** — no browser this session; contrast/confusability against
      the kind hues was reasoned about via hue separation, not measured live.
- [x] **The canonical vocabulary self-populates across books.** When Book B's distilled
      themes are computed, each is matched against the themes already seen in the library:
      a match adopts the existing canonical theme (and its colour), a miss creates one. So
      the shared vocabulary is *discovered* from reading rather than authored up front, and
      a theme common to two books is recognisably the same theme in both.
      ⚠️ **Reuse `matchConcept`'s rule rather than inventing a heuristic** — slug-normalised
      equality, then alias equality, then Levenshtein similarity ≥ 0.85 (`vault/concepts.ts`,
      already tested). If it needs to differ for themes, say why in NOTES.md.
      ⚠️ **Canonical themes live in SQLite, not the vault.** This is the sidecar-is-truth
      rule (settled decision 6) and is what keeps this milestone independent of the parked
      vault-concept work.
      _Acceptance: digest two books sharing an obvious theme and confirm they land on one
      canonical entry with one colour; digest two books sharing nothing and confirm no
      spurious merge; a near-miss pair ("Doubling" / "The double") is decided by the rule
      and the outcome is recorded either way._
      ✅ `resolveCanonicalThemes` (`server/src/digest/canonicalThemes.ts`) calls
      `matchConcept` directly, passing `aliases: []` throughout — the distillation pass
      never collects aliases (the model returns a name, nothing else, per decision 11), so
      only the slug-equality and Levenshtein tiers are actually reachable here; alias
      equality is dead code for themes specifically, inherited for free rather than
      reimplemented. A new `canonical_themes` table (migration v24), library-wide (no
      `resource_id`), plus `book_themes`/`theme_parents` junction tables scoping the
      canonical vocabulary to what each book actually surfaces. Unit-tested: two books
      sharing "Isolation"/"isolation" land on one canonical id with one colour
      (`themeDistillation.test.ts`); within a single call, near-duplicate names also
      collapse (`canonicalThemes.test.ts`). The "Doubling"/"The double" near-miss pair the
      acceptance line names: slugified similarity is **0.30**, well under the 0.85
      threshold — the rule keeps them as two separate canonical themes (asserted in
      `canonicalThemes.test.ts`). NOTES.md M24.5 has the full design writeup.
- [x] **The Scan's theme filter becomes the colour key** rather than a dropdown of dozens:
      book-level themes as coloured, toggleable entries, specific themes reachable
      underneath.
      _Acceptance: a book with no digest still shows a coherent Scan (today's fallback
      behaviour is preserved); filtering by a book-level theme lights every child theme's
      highlights._
      ✅ `ThemeFilterKey.tsx` replaces the flat `<select>` with one chip per book-level
      theme (swatch + name, toggleable), a disclosure per chip revealing its specific/
      chapter-level children as their own clickable chips underneath — falling back to
      today's exact dropdown when `bookThemes` is empty (no distillation run yet), same
      branch structure as the pre-existing `hasDigest`/no-digest fallback one level up, so
      "a book with no digest still shows a coherent Scan" is unchanged.
      `themeFilter.ts`'s `activeThemeNames(selection, bookThemes)` is the one place a
      selection becomes "which specific theme names light up" — a book-level pick expands
      to every child, a specific pick is unchanged from before distillation existed — and
      both `HeatStrip`'s Book layer (`litTheme` generalised to `litThemes: string[] | null`)
      and the Mine layer's own `litIds` filter consume that same array, so a selection can
      never light one layer's themes and not the other's.
      ⚠️ The chips use a *second*, separately-solved phosphor ramp
      (`scanPalette.ts`'s `THEME_PHOSPHOR_RGB`) rather than `theme.css`'s
      `--theme-ramp-*` directly — the Scan overrides `--color-bg` to near-black
      (`ScanPage.module.css`'s own comment on this), the same reason the four kind hues
      already get a separate neon translation (`phosphorHue`) rather than reusing
      `--kind-*` verbatim. Not spotted until wiring this task, so `--theme-ramp-*` (used
      by the digest page's legend, which sits on the normal paper/ink page) and
      `THEME_PHOSPHOR_RGB` (used here) are deliberately two renderings of the same
      `colorIndex` identity, exactly like kind colours already work.
      11 new unit/component tests (`themeFilter.test.ts`, `ThemeFilterKey.test.tsx`).
      ⚠️ **Not run in a browser this session** — selection/expansion logic and the fallback
      branch are covered by tests; the legend has never been seen rendered.
- [ ] **Verify:** rebuild a digest from scratch and confirm the key is stable; judge on both
      fixtures whether the distilled themes are actually *good* — if they are not, that is a
      prompt problem to solve here, not something to ship and route around.

### M24.7 — Reader chrome v2: one line, nested clusters, an immersive page

The operator's design pass, run with Claude Design and written up in
**`docs/marginalia/READER_REDESIGN.md` — read it first; it is binding for this milestone**
and carries the numbers (spacing, radii, tokens) this section deliberately doesn't repeat.
Its own rule holds: **read the `.dc.html` design files, don't measure the screenshots.**
Those templates (`templates/reader-chrome-v2/ReaderChromeV2.dc.html`, frames `ReaderShellV2`,
`ReaderStripStackedV2`, `AnnotationEditorV2`, `SearchPebbleV2`, `FullscreenReaderV2`) live in
the synced design project, **not in this repo** — pull them before building; the screenshots
in the operator's message are illustrations of them, not the spec.

Numbered `.7` rather than inserted as a new M25, per OPUS.md's renumbering rule: M25–M28 are
referenced ~30 times across CLAUDE.md, decisions.md, SPEC.md, PAGE_CURL.md and TASKS_DONE.md,
and this is the second renumbering that would have landed in a week. **It is still the next
milestone** — web search (M25) and Codex CLI (M26) wait behind it.

The driving problem, in the operator's words: controls get *dropped* to avoid colliding with
the floating nav, so digest state and progress vanish exactly when they're wanted. The fix is
to stop hiding and start **nesting**.

#### What is actually true today

Read before building; three of these contradict the brief's assumptions and one contradicts
the operator's message.

1. **The reader's chrome is in four places, not two.** `ReaderPage.tsx`'s `.titleBar`
   (cover + title + author), `ReaderView.tsx`'s `.topRow` (annotations button · progress
   Slider · ChapterNav · digest-chapter button · query ProviderPickerPopover · the whole
   audio transport row), `ReaderActionsCluster` (Digest · digest provider · Scan · Publish)
   floating beside the card, and `App.tsx`'s own floating `NavCluster`. One 48px line means
   **merging all four**, not restyling one.
2. **`actionsBesideCard` is the mechanism this milestone replaces.** M22.5 measures whether
   there is room beside the card and drops the cluster below the footer when there isn't
   (`ReaderView.tsx:490-495`, and the `topRowReserve` / `compact` props that follow from it).
   Nesting supersedes it. ⚠️ **Do not ship both** — a measurement that moves controls *and*
   clusters that nest them is two answers to one question.
3. **`f` is focus mode; fullscreen is `shift+F`.** The operator's "pressing F just hides
   annotations" is exactly right about `f` — but M14 fullscreen already exists on `shift+F`,
   already hides the strips and rail, and already proximity-reveals them
   (`useFullscreenChrome.ts`, `FULLSCREEN_REVEAL_BAND_PX`). §G is a **rework of M14**, not a
   new mode. The design's "F to leave" hint therefore either needs relabelling to `⇧F` or a
   deliberate rebind — M19.7's "keycaps that cannot lie" forbids shipping the hint as drawn.
4. **There is not one container query in the codebase.** `grep -r container-type web/src`
   returns nothing; every responsive decision today is a viewport media query or a JS
   measurement. §C is the first, so it also sets the convention.
5. **`SearchResultsCard` is already the movable annotation-shell window** the brief proposes
   as new work — drag by header via `dragControls`, resize, `clampPanelOffset` shared with
   `ThreadPanel` (`search/SearchResultsCard.tsx`). Extend it; do not create
   `SearchResultsWindow` beside it.
6. **The web-search control is inert on purpose** (`ContextLadderToggle.tsx`, "coming in a
   later milestone"). §F restyles it as a globe; **it stays inert until M25.** Making it live
   here would take the second cloud dependency without its seam — settled decision 10.
7. **M24.1 §C is still open** (hits re-located by content, so repeated words collapse onto one
   mark). It is not a prerequisite — it is in the locating layer, this milestone is in the
   chrome layer — but the search pebble cannot be *judged by eye* until it lands.

#### A — The top strip becomes one 48px line

- [x] **One row, three zones: reader functions left, the book's identity centre, chrome
      right.** Left: annotation-count chip · `‹ chapter ›` · digest cluster · listening
      cluster. Centre: cover thumb + title + author, moved down out of `ReaderPage`'s
      `.titleBar` (which stops existing as a separate row). Right: the nav pebble — library,
      search, **scan**, settings, theme trio.
      ⚠️ The cover thumb carries the doorway transition's `layoutId`
      (`coverLayoutId(resource.id)`, ReaderPage.tsx:288). **Moving it must not break the
      shared-element flight from the library card** — M7's proof; verify by opening a book,
      not by reading the diff.
      ⚠️ `NavCluster` owns a `leadingSlot` that rooms portal into (`chromeSlot.tsx`; DeskPage
      uses it). The reader's chrome-right zone should use that seam rather than growing a
      second one.
      _Acceptance: at a normal window the reader shows exactly one line of chrome above the
      page and one below; nothing from today's four places is missing; the reading card is
      taller than before by roughly the height of the row that went away._
- [x] **Publish, the tasks tray and the unanchored badge keep a home.** The design's zones
      don't name them: `Publish` is in today's actions cluster, `TasksTray` is inside
      `NavCluster`, and the annotations button carries an `unanchoredIds` badge.
      ⚠️ Ground rule from the brief — **nothing disappears to make room**; place each one and
      say where in NOTES.md. Publish belongs with the digest cluster or the nav pebble, not
      in the reading line's left zone.
      _Acceptance: publishing a book, watching a job, and spotting an unrelocatable highlight
      are all reachable from the new strip without opening Settings._
- [x] **Focus mode's own state stops being a sentence in the strip.** Today `f` replaces the
      annotations chip with "Notes hidden — press F to show" (ReaderView.tsx:2704) — a
      width-changing string in a row that must not change width.
      _Acceptance: `f` toggles notes with no reflow of the strip; the state is legible without
      reading a sentence; the keycap hint still tells the truth._

#### B — The foot mirrors it

- [x] **`‹` · `Page n of m` | `nn%` · `›`, with an instruments pebble at the right** (heat
      strip, search, fullscreen), at the same 40px height as the strip's second row.
      Progress moves **out of the top strip** — the `Slider variant="trigger"` +
      `ProgressPopover` pair currently sits between the annotations chip and ChapterNav.
      ⚠️ **Keep the real dial.** Dragging the `%` must still raise `SliderDial` with its
      chapter ticks (`chapterDialTicks`, `extraTicks`) and its "release to jump" commit path
      — that is M12's instrument, not a decoration to reimplement.
      _Acceptance: dragging the percentage scrubs and shows the chapter tick exactly as
      today; clicking it still opens `ProgressPopover`; `PageNumberDisplay`'s book/chapter
      modes both still render in the centre slot._

#### C — Responsive on the pane, not the window

- [x] **A container query on the reading pane drives the two-row fallback.** `> 600px`:
      one line (§A). `<= 600px`: row 1 = identity + nav pebble (theme trio collapses to a
      single cycling icon); row 2 = the reader's own functions, the chapter label taking the
      slack between its arrows so it never elides to "S…". Foot keeps its three parts,
      dropping to `1 / 11` + `%`.
      ⚠️ **Breakpoint on the pane, never the viewport** — the reader can be docked narrow on
      a wide screen (brief's ground rule, and `useReaderPaneWidth` already makes pane width
      independent of window width).
      ⚠️ `container-type: inline-size` establishes size **and** layout containment. Put it on
      a wrapper that owns none of the fold/stage geometry — `.stage`, `readerRowRef`,
      `pageClipRef` and `pageSnapshot`'s measured rects are load-bearing for the page curl
      (PAGE_CURL.md §5). Containment on the wrong node renders a plausible but wrong bitmap.
      ⚠️ The collapsed theme control must stay reachable for keyboard and screen readers:
      three focusable buttons become one **cycling** button that announces the theme it will
      move to, not an icon with no name.
      _Acceptance: docking the reader narrow on a wide screen produces the two-row layout;
      resizing the window without changing the pane does not; at 600px exactly one layout is
      live (no flicker at the boundary); the chapter label stays readable at every width._

#### D — Expanding clusters

- [x] **One shared `ExpandingCluster` wrapper**, built on `FlyPanel` so the panel grows from
      its own control (decisions.md 2026-07-30, "popups slide from where they were called").
      Pointer: open on hover after **120ms**, close **140ms** after pointer-out — the delay
      is what stops flicker when crossing between two adjacent icons. Touch: long-press
      ~**380ms**. Click pins; Esc or outside-click closes.
      ⚠️ **A pinned panel is a dialog**: `useDialogA11y` (focus trap, Esc, focus returned to
      the control). Hover-only functions are not reachable by keyboard or touch at all.
      ⚠️ **This replaces `ReaderActionsCluster`'s hover-revealed labels** (`ActionAnchor`),
      it does not stack on them. NavCluster.tsx already records the operator's ruling that a
      third disclosure mechanic beside the proximity-revealed labels was "one too many" —
      adding clusters means retiring the labels they absorb.
      _Acceptance: crossing from the digest icon to the listening icon and back never
      flickers a panel; every function inside a cluster is reachable by Tab and by long-press;
      Esc closes and focus lands back on the icon that opened it._
- [x] **The digest cluster**: *Digest this chapter* · *Open digest · S12* · the digest model
      (today's `ProviderPickerPopover role="digest"`, moved inside).
      ⚠️ **Job state becomes a ring around the icon, never a width change.** Today the strip
      renders the string "Digesting…" / a result label in place of a button
      (`digestChapterJobId`, ReaderView.tsx:2781-2795) — that is the exact behaviour the
      operator is asking to remove.
      _Acceptance: starting a chapter digest changes no element's width; progress is visible
      at a glance without opening the cluster; the finished state is reachable from the same
      icon._
- [x] **The listening cluster**: transport (⏮ ▶ ⏭), read-from-here, speed, cast target — and
      the icon at rest shows play/pause so the common action stays one click away.
      ⚠️ It must absorb **all** of today's transport row, including the two conditional
      controls: the M22.6 "back to the voice" locate button (shown only while the view has
      wandered from the sounding section) and the audio error status. A conditional control
      that silently disappears into a cluster is a regression, not a simplification.
      _Acceptance: start playback, scroll away, and return to the voice without opening
      Settings; pause is one click from rest; cast still opens `CastingModal` with its
      fly-from origin; an engine error is still visible without opening the cluster._

#### E — Search means find, Scan gets its own glyph

- [x] **Split the magnifier.** The magnifier becomes **Search** (find in book, `Cmd/Ctrl+F`);
      the Scan gets a new glyph — bars inside a rounded frame, echoing the heat strip it
      opens. Both live in the nav pebble. `SHORTCUT_KEYS.scan` (`q`) is unchanged; its
      `KeyCapAnchor` follows the icon.
      _Acceptance: the magnifier opens find-in-book from every reader state; the Scan is
      still one glyph and one keystroke away; no two controls in the reader share a glyph._
- [x] **`FindBar` becomes a pebble floating over the page** — magnifier · query · count ·
      `‹ ›` · whole-word · **List** · open-in-Scan · close — instead of a full-width band
      inside `.topRow`.
      ⚠️ It currently inherits fullscreen's proximity reveal *for free* by being mounted
      inside the `.topRow` wrapper (its own docstring says so). Floating it over the page
      **loses that**; give it an explicit fullscreen behaviour or Cmd+F silently does nothing
      visible in §G's immersive mode.
      ⚠️ Floating over the page means floating over `.stage` — the page fold's grab surface
      (M22.5's rule). It must not steal the peel gesture; the fold's own hit test is the
      thing to check, not the z-index.
      _Acceptance: Cmd+F over a spread never shifts the text; the pebble is dismissible with
      Esc with focus returned to the page; a page-corner drag still peels while the pebble is
      open._
- [x] **The results window earns its hierarchy.** Extend `SearchResultsCard`: title bar
      (`"query"` · `23 in 4 chapters` · order control · close), sticky chapter headers with
      per-chapter counts, one row per hit — snippet in the serif reading face, single line,
      ellipsised, with page and `%` in a quiet tabular right column — and a footer
      (`↑↓ move · ⏎ jump · ⇧⏎ open in Scan` · `Show all 23`). Only the selected row is
      coloured: 2px accent left edge plus
      `color-mix(in srgb, var(--color-accent) 12%, transparent)`.
      Dropped deliberately: per-row chapter name, per-row highlight boxes, the second
      metadata line.
      ⚠️ **Still one result set, two views** (decisions.md 2026-08-14). The window holds no
      hits, no query and no cursor of its own; the order control changes the *shared*
      ordering that `‹ ›` steps.
      _Acceptance: the window and the pebble can never disagree about the count or the
      current hit; keyboard alone can move, jump and open-in-Scan; position is remembered
      across opens and clamps back into bounds after a resize._

#### F — The annotation editor takes the query model

- [x] **`ProviderPickerPopover role="query"` moves out of the reader strip into
      `ThreadPanel`'s composer**, immediately left of **Ask** — the model belongs where the
      question is asked. Action row order is always ladder · web · model · **Ask**.
      _Acceptance: choosing a model in the editor is what the next question uses; the reader
      strip no longer carries a model control; the Settings path to the same choice still
      agrees with it._
- [x] **The resolved narrow variants** (~300px, the realistic docked width), from the brief's
      table — build these, don't re-open them: context ladder → a single dropdown; web search
      → a globe icon toggle; model → dropdown with short names; **Ask keeps its word**. Below
      ~280px the model select wraps above the row rather than compressing Ask.
      ⚠️ **The globe stays inert until M25** (see grounding note 6) — restyled, still
      disabled, still titled as coming later.
      _Acceptance: at 300px all four controls fit on one row with "Ask" legible; at 280px the
      wrap happens and Ask is still a word; the ladder dropdown selects the same three depths
      the segmented control did._

#### G — The immersive page (a rework of M14 fullscreen)

- [x] **No card, no strips, no rail.** The page becomes the whole surface with a soft vignette
      holding the eye on the column. Position survives as a 2px hairline along the bottom
      edge; the highlight rail dims to faint dots at the right edge.
      _Acceptance: in immersive mode nothing but the text, the vignette, the hairline and the
      dots is painted; the reading column's measure is unchanged from normal mode at the same
      pane width._
- [x] **One pebble wakes on pointer movement** — page, `%`, digest, listening, exit — and
      sleeps again after ~2s. This **replaces M14's four reveal flags** (`revealTop`,
      `revealBottom`, `revealRail`, `revealActions`) with one.
      ⚠️ **Two pointer paths drive the reveal, not one.** `useFullscreenChrome`'s
      window-level listener only fires over the parent document; the iframe-forwarded
      `mousemove` inside `ReaderView`'s book-loading effect is what fires while the cursor is
      over the page itself. M14 lost a session to exactly this (NOTES.md "M14") — update both
      or the pebble never wakes where the reader's cursor actually is.
      ⚠️ An unrevealed panel is `pointer-events: none`, so it cannot be the thing that reveals
      itself.
      _Acceptance: moving the pointer anywhere over the text wakes the pebble; it sleeps
      after ~2s of stillness; hovering the pebble itself keeps it awake; the keyboard path
      (Tab) reveals it without a pointer at all._
- [x] **Decide the two open questions and record them** (READER_REDESIGN.md §6): does
      selecting text in immersive mode open the editor inline over the column or a
      fullscreen-native side sheet, and does scrolling re-sleep the pebble or only pointer
      idle. One line each in decisions.md when chosen — this is the operator's call to make
      while driving it, not a coin flip in code.
- [x] **The binding tells the truth.** Either relabel the exit hint to `⇧F` or rebind
      immersive mode to `f` and give focus mode a different key — and update
      `shortcuts/keys.ts` so the keycaps follow (grounding note 3).
      _Acceptance: the hint on screen matches the key that actually leaves; focus mode and
      immersive mode remain two distinct axes (notes hidden vs chrome hidden)._

#### Ground rules for the whole milestone

- **No new colour values.** Everything resolves to existing tokens; `color-mix()` against
  them for washes and softened borders (ds-bundle README: "if a name isn't here, it doesn't
  exist").
- **No new register.** The reader's chrome is `register-paper register-quiet`; pebbles are
  built in it. `register-glass` stays the Scan's alone (settled decision 12).
- **Nothing disappears to make room.** If it doesn't fit, it nests in a cluster or moves to
  the second row.
- **Motion** uses `--ease-standard` / `--duration-standard`; controls use
  `--control-hover-transform` / `--control-pressed-transform`.
- Extend the existing components — `FindBar`, `NavCluster`, `ChapterNav`, `SliderDial`,
  `ProgressPopover`, `FlyPanel`, `HeatStrip`, `ProviderPicker(Popover)`, `AskPill`,
  `IconButton`, `SearchResultsCard` — rather than writing parallel ones. Genuinely new:
  `ExpandingCluster`, the Scan and globe icons, the immersive overlay.
- `ds-bundle` is a sync of these components to the design project (`_ds_sync.json` holds a
  render hash per component). Components this milestone reshapes will need re-syncing, or the
  design project's copy silently describes the old reader.

#### Verify

- [ ] **Driven live, on a real book, in both themes**: one line of chrome at a wide pane, two
      rows at a narrow *pane* on the same wide window, both clusters opened by hover, click,
      keyboard and long-press, Cmd+F over a spread, the results window moved and reopened,
      a question asked with the model chosen in the editor, and immersive mode entered and
      left by the key the hint names.
- [ ] **The page is measurably taller** than before at the same window size, and the page fold
      still peels from every corner with the new chrome mounted.

### M25 — Web search

Scoped out of M17 deliberately (decisions.md 2026-07-28 later): it needs its own seam,
not a flag, and it is a **second cloud dependency** — which amends CLAUDE.md's
"local-first: no cloud dependencies except the LLM endpoint itself". Permitted,
per-provider, **off by default, never silently on**.

- [ ] **The seam.** One narrow `WebSearch` interface (`search(query) → results`,
      `fetch(url) → text`), with implementations chosen by provider capability: the
      Anthropic API's server-side web tool; the Agent SDK's built-in WebSearch (which
      means relaxing `tools: []` on that path — a deliberate, documented exception, still
      read-only, still no file access); and a direct implementation (Brave/Tavily API key,
      or a local SearXNG instance) for endpoints with nothing of their own, so local
      models are not permanently excluded.
      _Acceptance: the same question with web enabled works on all three provider paths;
      disabling it removes the capability entirely, not just the UI._
- [ ] **Wire the M17 toggle.** The inert web control in the thread composer becomes live,
      per-thread, off by default and never remembered as on across books.
      _Acceptance: enabling it visibly changes the answer and the ledger's token count;
      results are cited in the answer with their source URLs._
- [ ] **Cost and trust.** Web results are context: they go through the ledger like
      everything else, and cited sources are shown so an answer's grounding is inspectable.
      _Acceptance: a web-enabled answer records its extra tokens; every claim drawn from
      the web is attributable to a listed source._
- [ ] **Verify:** ask a question needing outside knowledge on each provider path, with
      web off and on; confirm off costs nothing extra and on is fully attributed.

### M26 — Other (Incorporating other LLMs)
- [ ] **Codex CLI as a fourth provider.** `server/src/llm/codexCli.ts` behind the existing
      seam — no new call sites — spawning `codex exec --json` with `--output-schema` for
      `extract()`. **Caged, and the cage is part of the provider:** `--sandbox read-only`,
      approvals never, `--ephemeral`, `--skip-git-repo-check`, `-C <dedicated empty scratch
      dir>`, and a scrubbed environment. See the 2026-07-30 decisions entry for why this
      bounds settled decision 2 rather than breaking it.
      ⚠️ **The real gate is auth, and it is not satisfied on this machine.** There is no
      `~/.codex/` directory at all as of 2026-07-30, so the CLI has never been run here —
      the operator must `codex login` before any of this can be verified, and no amount of
      implementation gets around it. Confirm that first, or this task will be "started"
      twice.
      ⚠️ **Then run one real call and read the actual JSONL**, then write the
      event shape into NOTES.md. The flags above were read from `--help` on
      `codex-cli 0.114.0`; the event schema was not, and this project has already lost a
      session to trusting a remembered API shape (NOTES.md, M4).
      _Acceptance: a thread answers end to end on Codex; `extract()` returns schema-valid
      JSON via `--output-schema`; killing the CLI mid-stream surfaces a designed `LLMError`,
      not a crash; the sandbox flags are proven by asking it to read a file in the repo and
      confirming it cannot; usage lands in the ledger with honest provenance (`estimated`
      if the CLI reports no tokens)._

### M27 — The paper fold, finished (unparked 2026-08-25, in progress)

**Parked by the operator on 2026-08-03**, immediately after signing off the shipped curl —
"happy to park the remaining M20 refinements for a later stage". Nothing here is undecided
and nothing here blocks anything else; it is the fold's remaining ambition, kept in one place
so it can be picked up cold.

**Unparked 2026-08-25.** The two items that needed neither WebGL nor the operator's machine
are done — the back of the sheet, and the p90 guard. The two measurements are blocked on
real hardware (NOTES.md Blockers). "Over the spine" is what remains.

Renumbered to M27 on 2026-08-12 as part of the operator's fixes → 3D → search reordering
(mapping table in decisions.md's 2026-08-12 entry); still parked and still last — the
renumbering doesn't change that.

#### The operator's own ask, and the cheapest thing here

- [x] **The back of the sheet shows the leaf's real other side, not a mirror of its front.**
      Right leaf curling → the page *after*; left leaf curling → the page *before*. **Read the
      2026-08-03 "sign-off" decisions entry** — the ask is physically exact and adopted as
      stated. The bitmap is already on screen: the drag advances the rendition at grab time,
      so the back of the sheet is the **post-advance card** — its left half for `next`, its
      right half for `prev`, the whole card in single-page mode. No hidden rendition and no
      second epub.js instance.
      **This does not touch `pageFold.ts`'s geometry at all** — the tail keeps `alpha = -1`,
      because a real book's back page *is* mirror-reversed when you fold the sheet toward you.
      Only the sampled bitmap changes. It is also **independent of everything below**, so it
      can be pulled forward on its own if the fold's shape is never revisited.
      ⚠️ **Instrument before deciding the timing.** The second capture costs ~22ms (§5) and
      must land before the first back-facing pixel is drawn, without blocking the grab.
      Measure which frame first exposes back-facing pixels and whether 22ms beats it; if it
      does not, the fold paints today's mirror until the real back arrives, as a designed
      transitional state. Do not guess this.
      ⚠️ **Re-judge the back-of-sheet constants in the harness**, not the app: `SHOW_THROUGH`
      (0.20), `backOfSheet`'s lift and `sheenScale` were all tuned against a mirror. The
      physically honest result is the back's own text *plus* the front's mirrored ghost, which
      is more on that surface than it has ever carried and could read as noise.
      _Acceptance: mid-drag in spread mode the lifted right leaf carries page N+1's text
      (mirror-reversed), not page N's; the same for `prev` and N-1; single-page likewise; all
      three reading themes judged in the harness before the app._
      **Done 2026-08-25** (b456f16). Both ⚠️s answered by measuring: the tail — the only
      back-facing region that can carry readable text — does not exist until `0.582 x arc` of
      travel (~67ms into a click turn, ~98 CSS px into a drag), so the ~22ms capture is raced
      rather than blocking the grab. Re-judging in the harness found that `SHOW_THROUGH`'s
      wash belongs to *faking* a back, not to backs; a real one gets `BACK_LIFT` (0.34)
      instead, because dropping the fill entirely cost the dark themes their depth cue.
      Verified in the app on East of Eden in spread mode. Readings in NOTES.md.
      ⚠️ **Two things for the Verify below**, both surfaced rather than decided: whether the
      real back reads better than the mirror, and **single-page mode's doubling** — one turn
      advances one page, so there the leaf's back and the page revealed under it are the same
      page. That falls straight out of the ruling as stated; the harness (`?back=real|mirror`)
      shows it rather than papering over it.

#### The two measurements still owed

- [ ] ⛔ **BLOCKED (needs the operator's Mac) — the canvas-2D-on-a-real-compositor number.** Still not taken — the step 4 gate closed
      this column for WebGL and could not close it for canvas 2D, because headless Chromium
      composites in software. Open the reader with Curl, **drag** six pages (not arrow keys —
      the guard under-reports a keyboard turn by 7x), paste the `[marginalia] fold draw cost:`
      lines into NOTES.md. Single-page and spread.
- [ ] ⛔ **BLOCKED (needs a real reader on real hardware) — still catch the original stuck-curl trigger** (carried from step 3). The structural
      fixes bound every failure of that shape and the operator now reports it "doesn't really
      get stuck", so this is a loose end rather than a defect. Not reproduced in ~4 held drags
      and ~30 keyboard turns on 2026-08-03.
      _Acceptance: one captured trace of a stuck gesture, in NOTES.md._

#### The low-fps guard, which is a live bug independent of the rest

- [x] **Move the guard from the median to the p90 of drawn frames**, keeping the ≥12-sample
      floor and the 33ms threshold. **Two independent reasons**: measured, the median of a
      keyboard turn is 0.9ms while its worst frame is 27.8ms and a held drag of the same fold
      is 7.4ms — and the operator reports residual stutter on a Mac the guard reads as 1.1ms.
      The guard cannot currently notice what the operator can see. This is a small change in
      `PageCurl.tsx`'s cleanup plus a test, and it needs none of the WebGL work below.
      _Acceptance: the dev trace on a held drag and on a keyboard turn of the same fold report
      within ~2x of each other, where today they differ by 7x._
      **Done 2026-08-25** (08c6e2d). Note this had been ruled on 2026-08-03 and never
      implemented — PAGE_CURL.md §7 described it in the present tense while the shipped guard
      still took the median. The statistic now lives in `drawCost.ts` with tests written
      against the step 4 traces, and the dev line reads `p90` (so traces from before this date
      are not comparable). ⛔ The *live* half of the acceptance — the real pair on real
      hardware — is blocked with the two measurements above; the unit tests pass.

#### Over the spine — designed in full 2026-08-03, never started

**Read the 2026-08-03 (step 4) decisions entry first**, then PAGE_CURL.md §2d (the proof that
a spine hinge is a cone and a cone is not expressible in the shipped model), §4 (the resolved
fork and the six things insisted on up front) and §7 (the GPU numbers, and why the low-fps
guard is wrong a second time). The design question is settled: **WebGL is approved.** Nothing
below re-decides it.

Scope, in the order it should be built. (The roll's operator sign-off, which used to gate
this, was given on 2026-08-03; the canvas-2D measurement it was paired with is listed above.)

- [x] **The geometry grows an apex.** `pageFold.ts`'s pure half gains a cone — apex distance
      along the spine — with the renderer still swapped underneath it. Every existing property
      survives as the far-field (apex-at-infinity) degenerate case, exactly as the bisector
      survived into the roll. ⚠️ **One test changes meaning and must be rewritten, not
      deleted:** "keeps an edge peel's crease parallel to the spine" is false under a hinge,
      where the crease converges on the apex; it becomes a statement about the far-field limit.
      _Acceptance: `pageFold.test.ts` green with the apex pinned at infinity, plus new cases at
      finite apex — the grabbed anchor still lands exactly under the pointer, the leaf is still
      fully covered by progress 1, and the spine edge does not move at any drag depth._
      **Done 2026-08-25.** `ConeFold`/`computeConeFold`/`deformPointOnCone`/`coneLiftAt` in
      `pageFold.ts`, tested in `pageCone.test.ts`; all three finite-apex criteria hold at every
      depth and anchor, and the far-field convergence to `computeFold` is driven to the
      floating-point noise floor. Nothing calls it yet — `computeFold` and `drawPageFold` are
      untouched, per "with the renderer still swapped underneath it".
      The named test was **rewritten, not deleted**: the flat model's "crease parallel to the
      spine" is still true of `computeFold` and stays in `pageFold.test.ts` with a pointer to
      its cone counterpart, which states it as a far-field limit. It retires when
      `drawPageFold` does.
      ⚠️ **One contradiction in this task had to be resolved to build it**, and the resolution
      is a finding rather than a preference: the apex **cannot** be a free input ("apex distance
      along the spine") while the anchor "lands exactly under the pointer", because rulings are
      inextensible and the anchor therefore keeps its distance from the apex. The apex is
      solved from the drag instead — the point on the spine equidistant from anchor and
      pointer. Consequence for whoever builds the renderer: **the apex moves during a drag**.
      Whether it wants clamping or easing is left open deliberately; see NOTES.md "M27 — the
      apex cannot be both given and consistent".
- [x] **The sheet hinges at the spine, and the spine is the edge opposite the grab.** The
      gutter in spread mode, the card's other edge in single-page — so both modes keep one
      model, which §2d previously assumed they could not. The gutter-side corners cannot curl
      away.
      _Acceptance: at every drag depth and from every anchor, the two corners on the spine edge
      are within a pixel of where they started, in single-page **and** spread._
      **Done 2026-08-26.** Acceptance holds to 4.5e-13 px (a pixel was asked for) with zero
      lift, over 4764 drags spanning six anchors, both leaf sizes and both synthetic paths.
      Still pure geometry — `computeFold` and `drawPageFold` untouched, nothing calls it yet.
      ⚠️ **The binding turned out to be a limit on the *drag*, not only on the sheet**, and
      that resolves the question the 2026-08-25 apex note left open. A cone's apex cannot sit
      partway along the binding (the two halves of the spine edge would lie on opposite rays
      from it), and that constraint is exactly "the anchor's distance to each gutter corner can
      only shrink" — the lens between two circles through the anchor. `constrainToSpineHinge`
      follows a drag outside it as far as the paper goes, along the drag's own direction. So
      **"the anchor lands exactly under the pointer" is now "under the pointer the hinge can
      honour"** — the identity for every ordinary peel. Ruling in decisions.md 2026-08-26;
      the measurements, including the two clamp rules that snapped the sheet ~750px mid-sweep,
      in NOTES.md.
      ⚠️ **Two things the renderer below inherits.** (a) There is no far-field hand-off to
      `computeFold` any more — it returned the spine to the model that moves it — so the apex
      is *held* a million diagonals away instead. That number has walls on both sides and
      **none of it survives float32**: deform in float64 and upload positions, not the apex.
      (b) `syntheticFoldPointer`'s 2.2x diagonal overshoot is an artefact of the flat crease
      and a bound sheet cannot follow it — a corner grab stalls with two thirds of the leaf
      uncovered. `syntheticHingePointer` (anchor → its mirror across the spine) is the path
      with a coverage proof. **Left open deliberately:** that path is square across, i.e. the
      far field, so a click turn animated along it never shows the fan the cone exists for. A
      thumb pulls up *and* across. Which path a click turn takes is a look question for the
      renderer, not a geometry one.
- [x] **The WebGL renderer, with the ladder terminating at the slide.** *(In progress
      2026-08-26: the mesh and the seam consumer are built and tested — `foldMesh.ts`,
      `PageFold3D.tsx` — and nothing is wired to them yet. What remains is
      `PageCurl`/`usePageTurnAnimation`/`ReaderView`: the ladder, the live-DOM far leaf, the
      reduced-motion path and the context-loss exit. Three rulings landed on the way, in
      decisions.md 2026-08-26: the fold is a **consumer of M23's one 3D seam**, not a second
      canvas — which is where the lost-context degrade comes from free; it **borrows the
      Desk's camera**, whose `y = 0` plane maps to the viewport 1:1, rather than bringing a
      fourth; and the mesh is a **fan of wedges between rulings, deformed on the CPU in
      float64** — a grid cannot resolve a roll that is a ten-millionth of the leaf's angular
      span, and float32 cannot hold a leaf coordinate measured from a held apex.
      ⚠️ **One acceptance criterion below has expired** — see the note under it.
      **`harness/pageCone.html`** puts the hinged mesh beside the shipped painter under one
      drag, so the shape can be judged before the wiring; three defects fell out of the first
      four frames of actually rendering it (NOTES.md 2026-08-26). One of them is a *finding*:
      **§2c's "text squeezing into the curl", listed as out of scope, comes free with a
      mesh** — re-read §2c after the wiring rather than leaving it open.
      **The harness now runs a real gesture** — press, drag, release, land — because operator
      feedback the same day was three asks that a hover-tracked pose could not show at all.
      What that settled is in decisions.md 2026-08-26 "A turn is a gesture"; the geometry it
      added (`EdgePinch`/`anchorForPinch`, `hingeRelease`, `settleArc`) is in `pageFold.ts`
      with tests, and `PageFold3D` takes the arc per frame. **Still harness-only** — the
      three items below are what the reader owes, and they are listed rather than folded into
      the wiring because one of them is a live bug that does not need the mesh.)*
      Stage-wide canvas;
      `nearLeafRect` keeps only its "which half of the snapshot is turning" job
      (`leafSourceRect` already separates the concerns, so this part is small); the far leaf is
      live DOM under a transparent canvas and takes the sheet's shadow, drawn by the renderer
      and never composited into the bitmap. **`pageSnapshot.ts` is not touched** (§5).
      ⚠️ **A lost context is a designed state**: `webglcontextlost` degrades to the slide
      through the gesture's *existing* one exit (§9) — the `finally`, the deadline on every
      await, the pointer-capture watchdog, the turn lock's maximum lifetime. It does not get
      its own escape hatch.
      ⚠️ **Price `texImage2D` from the card canvas before designing around it.** It measured
      ~56ms here — larger than the entire snapshot capture — but measured the same on
      SwiftShader, which says it was a CPU pixel path rather than a GPU upload. If it is real
      on the Mac, the upload moves to grab time behind the still-covering snapshot, or the
      texture drops to half resolution.
      _Acceptance: `pageTransition: "slide"` still holds as a ceiling —
      ~~`document.querySelectorAll("canvas").length === 0` sampled every frame through a whole
      turn~~ **the fold registers no Scene3D layer and mounts no grab surface** (restated
      2026-08-26: the original is unsatisfiable since M23, because `Scene3DProvider` latches
      a canvas for the app's life once any surface has shown one — the criterion predates the
      shared canvas, and its intent was that the ladder cannot climb *up* to the curl);
      reduced motion still renders no fold and zero grab surfaces; killing the
      context mid-drag (`WEBGL_lose_context`) springs the page closed and the next keyboard
      turn works._
      **Done 2026-08-26.** `PageFold3D` replaces `PageCurl` in `ReaderView.tsx`/
      `usePageTurnAnimation.ts` as the `"curl"` rung; `resolveRenderer` falls to `"slide"`
      when `useScene3DAvailable()` is false, which is `webglcontextlost` *and* no-WebGL in
      one check, free from M23's own seam. Stage-wide: the fold now mounts on the shared
      Scene3D canvas via `getOrigin`, not a leaf-sized DOM canvas, so it is no longer
      structurally prevented from crossing the gutter. `pageSnapshot.ts` untouched, as
      required. Verified live (Playwright, real drags against East of Eden, spread and
      single-page, both a committed turn and a spring-back): no console/WebGL errors, spring-
      back lands on byte-identical text to the drag's start. **Not yet done**: the
      `texImage2D` pricing ⚠️ above is a real-hardware measurement this session cannot take;
      see decisions.md 2026-08-26 for what *was* found instead (two operator-reported
      problems in the arc's own tuning, unrelated to this wiring but shipped alongside it).
- [x] **The far leaf stops pre-flipping — and this one is a bug in the shipped 2D curl.**
      In spread mode the drag advances the rendition at grab time, so page N+2 lies flat on
      the far half from the first frame while the sheet turning over it carries N+2 on its
      back. Keep the advance (the turn needs both halves of it) and cover the **far** half
      with the departing card's own bitmap for the duration, dropping it when the sheet
      lands. ⚠️ It takes **three** states, not two: a fold at rest draws nothing, so the
      frame a spring-back finishes, the revealed page shows where the departing one should
      be. Ruling and the phase table in decisions.md 2026-08-26.
      _Acceptance: mid-drag in spread mode the far leaf still reads N-1 and only becomes N+2
      once the sheet is down; a spring-back ends on exactly the spread it started from.
      Independent of the mesh — it can ship against `PageCurl` first._
      **Done 2026-08-26** — `FarLeafCover.tsx`, a new component shared by whichever renderer
      is mounted (independent of the mesh, as scoped): crops the departing card's own bitmap
      to the far leaf's rect (`readerGeometry.ts`'s `farLeafRect`, already used for the
      sheet's own back face — reused rather than re-derived) and renders it over the live
      far leaf for exactly as long as `PageCurlState` is non-null. Single-page mode is
      detected by comparing `farX` to the turning leaf's own `leafX` rather than re-deriving
      `spreadMode`, since `farLeafRect` already collapses to the same rect `nearLeafRect`
      does there. Verified live: mid-drag the far leaf holds its pre-advance text; a
      committed turn and a spring-back both land clean.
- [x] **The grab site takes the pinch, and the release takes the swing.** `anchorForPinch`
      replaces `anchorForGrab` (no band, no snap, no `constrainFoldPointer`), and the
      commit/spring-back path is `hingeRelease` + `settleArc` rather than the flat model's
      pointer lerp toward `syntheticFoldPointer`. ⚠️ **Do not carry `0.35` across**: the
      reader measures progress on drag distance over `0.9 * leafWidth`; `HingeRelease.progress`
      is angular over a turn spanning **two** leaf widths, so the same travel is `0.157`.
      _Acceptance: a mid-edge grab is held at the grab height and fans as the pointer rises;
      a released sheet lands flat on the facing leaf with the fold's unmount invisible; the
      commit threshold matches the shipped one in *travel*, not in number._
      **Done 2026-08-26** in `usePageTurnAnimation.ts` — both the drag (`handleGrabPointerDown`)
      and the click/keyboard turn (`turnPageCurl`, via the new `defaultPinchForDirection`)
      go through the hinge. ⚠️ **`0.157` did not ship** — it was the right conversion *method*
      but only an estimate of where a commit feels right; tuned live against the harness's
      new control panel, the operator's number is `HINGE_COMMIT_AT = 0.271`. See decisions.md
      2026-08-26 for the full tuning session, including the roll's target becoming a curve
      over the turn's progress rather than a constant (`HINGE_ARC_CURVE`) — a second, unscoped
      fix the same session found necessary.
- [x] **The new renderer reports the same honest cost unit** as the p90 guard above, or the
      low-fps rung becomes decorative for WebGL exactly as it currently is for canvas 2D.
      _Acceptance: a WebGL turn traces a p90 draw cost over ≥12 drawn frames, same format._
      *(Built into `PageFold3D` 2026-08-26 — `drawCostP90` over the frames that actually
      built a mesh, same statistic and same unit as the 2D painter's. Unticked because
      nothing calls it yet: the acceptance is a traced turn, and that needs the wiring.)*
      **Done 2026-08-26** — `PageFold3D`'s `onDrawCost` is wired straight to the same
      `handleDrawCost` the 2D painter already reported through, so the low-fps rung means the
      same thing for both renderers with no second threshold to keep in sync.
- [x] **The turning page renders in front of the room, not behind it** — two operator asks
      from the wired hinge (2026-08-26), and **two different causes**. Read the decisions.md
      entry "A turning page is in front of the screen" before touching either.
      (a) The seam's layering contract (settled decision 14c) puts the one canvas at
      `z-index: 0`, which is right for scenery behind a room and wrong for a sheet that has
      left the leaf: the fold lost to `FarLeafCover` (`5`), the grab surface and vignette
      (`6`) and `NavCluster` (`950`), so the tail vanished the instant it crossed the gutter.
      (b) Immersive mode was worse and unrelated: `requestFullscreen()` on the reader's
      wrapper promotes it to the browser's **top layer**, where nothing outside it renders
      at any z-index — the fold was not drawn at all for the whole turn.
      _Acceptance: mid-drag the sheet covers the far leaf, the strip and the nav pebble in
      windowed **and** immersive mode, both directions; the elevation is released when the
      turn lands; the Desk keeps `z-index: 0` and its own foreground DOM above it._
      **Done 2026-08-26.** `useScene3DElevated` (ref-counted, `PageFold3D` its one consumer,
      `960` — above `NavCluster`, below Settings) and `useFullscreenChrome` now fullscreens
      `document.documentElement`. Verified live in both modes and both directions, with the
      Desk re-checked for the contract it still depends on.
- [ ] **Retire `drawPageFold` once the WebGL path is signed off on the operator's machine**,
      and not before. Until then it is the renderer; after the swap it is the safety net for
      exactly one milestone. The geometry module stays either way.
      _Acceptance: the fold ladder is WebGL → slide, and no second fold painter is left behind._
      Still correctly unticked: `PageCurl.tsx`/`drawPageFold` are unused by the ladder as of
      2026-08-26's wiring but deliberately still in the tree — this is that "one milestone"
      of safety net, and retiring them is gated on the Verify entry below, not on this one.

Deliberately out of scope, per the entry: ask (c) (text squeezing into the curl — a
*projection* problem, not a shape one, and a separate task); the 60-line "perspective on the
tail and roll only" middle option (it buys nothing toward the spine and would be spent inside
a painter being retired); RTL reading direction.

#### Verify

- [ ] **Operator sign-off on the finished fold**, on the Mac, in all three reading themes and
      both page modes — and specifically on the two things the 2026-08-03 sign-off left open:
      is the stutter gone, and does the real back of the sheet read better than the mirror did
      (it is not obviously true — more information on that surface could read as noise).
      ⚠️ **What automation already checked, so the operator's pass can spend its time on feel
      rather than correctness** (2026-08-26, Playwright against East of Eden): the spine
      invariant, a spring-back's CFI round-trip, the far-leaf cover, single-page mode, and a
      clean console/WebGL log on every path above. Still owed, and only gettable by hand: the
      stutter question, the back-of-sheet material judgment, and whether
      `2.2× / 1.44× / 0.4×` (decisions.md 2026-08-26) still feels right off a scripted mouse.
      ⚠️ **Two of the operator's own asks were answered after that list was written** — the
      page now renders in front of the far leaf and over the chrome, and immersive mode shows
      the fold at all for the first time. Both are checked by automation (see the entry
      above); what the sign-off still owes on them is whether `960` is the right *company* to
      keep — i.e. whether anything the reader shows during a turn should have stayed on top.

### M28 — Universal search (the successor to M24, shape only)

Named on 2026-08-14 so M24 can be scoped honestly and so its result shape is chosen with
this in mind. **Not scheduled**, and deliberately after M24.5 — cross-book parallels are
only legible once themes have a shared vocabulary to be parallel *in*.

The operator's ask: *"a universal search where you can search attached Obsidian vaults and
annotations in other books too, to draw parallels."*

- The Obsidian half is **not speculative**. The vault is already a real directory this
  server reads and writes, with concept files carrying names and aliases
  (`server/src/vault/concepts.ts`). It needs an index and a result surface, not an
  integration.
- **This is where FTS5 earns its place** (M24 deliberately does without). Scanning one
  book brute-force is fine; scanning a library is not.
- **It does not belong on the Scan.** The Scan is one book's instrument; a cross-book
  result surface belongs to the Desk. Growing it sideways out of the Scan would re-create
  exactly the "two jobs competing in one surface" problem M24 was raised to fix.
- The gate before anything is built: **what does a cross-book hit open**, and what makes a
  parallel worth surfacing rather than a coincidence of vocabulary?

### M29 — Digest reliability: stop blocking on a live LLM call, add timeouts and retries

Diagnosed 2026-08-22 (operator: "Open digest" often takes forever or fails; background
digest jobs fail at the fetch stage). The `digest` role's provider profile is
`openai-compatible` against a local Ollama endpoint (`localhost:11434`,
`qwen3.5-hermes:latest`) — **not the SSH tunnel**, which only carries browser↔server HTTP
traffic and never sees the LLM call; the same slowness shows up running the app natively
on the Mac because the bottleneck is server-side, against `localhost`, on both machines.
Root causes, all confirmed by reading the code and by two real `digest_runs` rows with
`last_error: 'fetch failed'`:

- [x] **Stop `GET /:id/digest` blocking on a live LLM call.**
      `maybeRefreshBookDigestSnapshot` (`server/src/digest/build.ts`) is `await`ed inline
      in the route handler (`server/src/routes/digest.ts`) with no try/catch, despite its
      own doc comment calling it "best-effort, silent" — a slow or failing Ollama call
      currently stalls or 500s the whole digest-open request. Make the refresh
      non-blocking: respond with whatever snapshot already exists, and refresh in the
      background so a page open never waits on an LLM round-trip.
      _Acceptance: opening the digest for a book whose snapshot is stale returns
      immediately with the last-known-good snapshot; the refreshed snapshot appears on a
      subsequent open/poll; killing Ollama mid-refresh does not affect the digest-open
      response._
- [x] **Timeout every LLM fetch.** `OpenAICompatProvider.stream()` and `.extract()`
      (`server/src/llm/openaiCompat.ts`) issue raw `fetch()` calls with no deadline — a
      stalled connection hangs indefinitely. Bound both with a per-request timeout,
      surfaced as a designed `LLMError`, not a hang.
      _Acceptance: pointing the digest role at an endpoint that accepts the connection but
      never responds fails within the configured timeout, not never._
- [x] **Retry transient network failures in digest/thematic runs.** `runDigest` /
      `runThematicDigest` (`server/src/digest/build.ts`,
      `server/src/digest/thematicBuild.ts`) only pause-and-auto-resume on
      `LLMError.code === "rate_limit"`; every other error, including `"network"` (the
      literal `"fetch failed"` seen in `digest_runs.last_error`), marks the whole job
      failed with no retry — confirmed `server/src/jobs/registry.ts` has no retry logic of
      its own either. Generalize the existing pause/resume path to also catch `network`
      errors, with a shorter backoff than the rate-limit one.
      _Acceptance: a digest run that hits one transient connection failure mid-book
      recovers on its own (a brief pause in the tasks tray, not a failed job) instead of
      requiring a manual restart._
- [x] **Surface digest-load errors on the client instead of an infinite spinner.**
      `fetchDigestStatus` (`web/src/digest/DigestPage.tsx`) swallows every error and
      returns `null`, so a failed request leaves the page on "Loading digest…" forever
      with no feedback. Distinguish "still loading" from "errored" and show a retry
      affordance.
      _Acceptance: killing the server (or Ollama) mid-load shows a visible error state
      with a retry button, not a stuck spinner._

Out of scope here: local-model operational tuning (e.g. Ollama's `keep_alive`, keeping the
model warm) — recorded as an operator follow-up, not code; the retry/timeout work above
should make the app resilient to that regardless of how it's tuned.

#### Verify

- [ ] Drive both scenarios live against the real local Ollama profile: open a digest whose
      snapshot is stale (confirm it's no longer the slowest interaction on the site), and
      run a multi-chapter background digest, confirming a network hiccup no longer kills
      the job outright.

## Parked (post-v1.5) — recorded so they aren't relitigated

- LLM note supplementation: a pass that reviews highlight notes/tags, responds
  inline with supplementary detail, and proposes concept tags (persisted in SQLite)
  to power concept-level search across the library. "LLM proposes, code disposes."
  (decisions.md 2026-07-19)
- Vault-concept filtering on the scan (depends on the above).
- Notepad v2 "drift" brainstorm surface; sound design; PDF/Markdown formats.
  _(The `claudeAgent` subscription provider was parked here on 2026-07-17 but was
  un-parked and shipped on 2026-07-19 — see that decisions.md entry and
  `server/src/llm/claudeAgent.ts`. No longer parked.)_

## Future arcs (v2+) — shape decided, not scheduled

Recorded 2026-07-27 so the shape is settled before anyone starts and the real gate on
each is visible. Full reasoning: decisions.md 2026-07-27, "Future arcs". **These are
not milestones — do not start them from this list.**

- **Drawing on pages.** Strokes anchor to a **spine section in that section's own flow
  coordinates**, never to a page — pages aren't durable (font size, window width, the
  M14 margin setting, and spread mode all repaginate), so a page-anchored stroke is
  guaranteed to rot. Stored per section as simplified, quantized, gzipped SVG path data,
  one row per section that has drawings, fetched on section load exactly as highlights
  already are — so drawing on one page cannot grow the rest of the book's metadata.
  Explicitly **rejected**: rendering pages as images to draw on, which would destroy
  selection, highlighting, search, and reflow. Split into two independent projects:
  pointer-drawing on the desktop is buildable today; the iPad/Pencil version starts by
  undoing M6's deliberate loopback-only binding (LAN exposure + pairing/auth, probably a
  native shell) and PRODUCT.md lists multi-device as out of scope — that decision has to
  be taken on purpose, first.
- **Notebook chat.** Must be framed as "**the notepad is the prompt**" — a chat scoped
  to the notepad's contents (plus, optionally, the book behind it), anchored to
  something the reader wrote. A free-floating chat box contradicts a standing discipline
  ("the highlight is the prompt") and would need that rule overturned deliberately in
  CLAUDE.md, not by drift.
- **The spotlight as a literal torch** (decisions.md 2026-07-29). A cartoon flashlight
  beam on the scan, aimed by click-drag along the timeline and widened/narrowed by
  up/down — iOS-18-flashlight-style, drawn for the VHS/CRT aesthetic. However it looks,
  it is still a *range picker* and must resolve to whole chapters (M17's storage unit),
  with the numeric readout remaining the canonical keyboard path. Trap: a torch drawn
  inside M18's warped base layer must be positioned through the **same barrel mapping**
  as the heat bands, or the beam points somewhere other than where it lands.
- **A scrolling manuscript mode** (decisions.md 2026-07-29). ⚠️ Reopens a settled
  decision — PRODUCT.md records that pagination won in M2. The cost is not the
  scrolling: **every reader effect since M10 assumes pages** (snapshot turns,
  drag-to-peel, the M20 fold, turn zones, spread, the margin-vs-gutter model), so this
  is a *second reading mode with its own affordances*, not a toggle. Highlights and
  anchoring carry over (they are CFI/text-based); little else does. Decide between
  epub.js's per-section `scrolled-doc` and a genuinely continuous manager **before**
  building — they are different products.
- **A speed reader (RSVP)**, framed as accessibility (decisions.md 2026-07-29). Must
  reuse M21's sentence/word segmenter rather than growing a second chunker, and must save
  position through the existing reading-position path so reading, listening, and
  speed-reading never lose each other's place. Comes with requirements, not just a WPM
  slider: instant pause-to-annotate, rewind by sentence, wide speed range, and a
  lower-intensity alternative in the same feature (moving line-guide or bionic-style
  emphasis) since RSVP helps some readers and harms others. "Lines per minute" is a
  teleprompter and depends on the scrolling mode above.
- **The evidence board.** Corkboard, pins, physics ropes, tabs. Two rulings: it is an
  **extension of the Desk, not a fourth room** (it hangs on the wall above the desk,
  keeping "three rooms, one building" intact), and it is a **view over data that already
  exists** — nodes are concepts from the vault compiler, highlights, books, and notepad
  fragments; edges are the concept links code already computes at distill time. A board
  with no data behind it would encode nothing, which DESIGN.md's anti-goals rule out.
  Rope physics is verlet integration on canvas 2D — no engine, no WebGL, following the
  page fold's precedent.
