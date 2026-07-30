# Investigation handoff: the chapter-boundary page skip / book-count "+2" jump

> **RESOLVED, 2026-07-30 (M19.6 round 4).** The operator's next report supplied the
> missing variable this doc's own "what would make the next report actionable" section
> asked for — a real desktop browser at non-100% zoom, which neither prior sweep could
> reproduce. Real cause (sub-pixel `scrollLeft` drift at a fractional device-scale
> factor) and fix in `web/src/reader/pageTurn.ts`; full writeup in
> `docs/marginalia/NOTES.md` ("M19.6 — round 4") and `docs/decisions.md`'s matching
> entry. Kept here for history, per this project's "append, don't rewrite" convention —
> not because the investigation below is still open.

*A design-session kickoff, per `docs/OPUS.md` — this is raw operator feedback that has
survived two implementation-session diagnostic sweeps unreproduced. Do not re-implement
anything below without reading `docs/OPUS.md`'s "root-cause before you prescribe"
section first: state the symptom, name candidate causes with file/function, name the
diagnostic that would distinguish them. A third blind sweep is not a good use of a
design session — the missing ingredient is real repro detail from the operator (see the
bottom of this document), not more code-reading.*

## Read first

1. `CLAUDE.md` — settled decisions (notably #11, "the model never returns positions" —
   irrelevant here, but the same rigor applies: don't trust a number without tracing
   where it came from).
2. `docs/marginalia/TASKS.md`, the **M19.6 — Reader repair** section — every task's own
   verification note, especially "Fix the skipped last page of a chapter" and "Page
   numbers in the footer, book-wide and stable."
3. `docs/decisions.md`, the two 2026-07-30 entries under M19.6 ("operator verification:
   the spread divisor bug..." and the reader-repair entry above it) — the established
   causes and the reasoning for the fixes already shipped.
4. `docs/marginalia/NOTES.md`, in order:
   - "M19.6 — operator manual verification, round 2: the spread divisor bug was the real
     'page skip'" (the fix that's already shipped and working, as far as it's been
     tested)
   - "M19.6 — book-wide page count: replaced character-locations with a click-accurate
     estimate" (the current design of the book-wide counter)
   - "M19.6 — operator follow-up report, round 3: still can't reproduce the
     chapter-boundary skip or the count jump" (the second, much wider diagnostic sweep —
     read this one closely; it lists every configuration already tried, so you don't
     repeat it)
   - The `## Blockers` entry pointing at all of the above.
5. The actual code: `projects/marginalia/web/src/reader/bookPages.ts` (the click-accurate
   book-count math), `projects/marginalia/web/src/reader/ReaderView.tsx`'s
   `pinContainerWidth`/`applyGapForWidth`/`handleRelocated` (the geometry and the
   divisor-adjusted numbers), and — if you go deeper than either implementation session
   did — the installed `epubjs` package itself:
   `node_modules/.pnpm/epubjs@0.3.93/node_modules/epubjs/src/managers/default/index.js`
   (`next()`'s `container.offsetWidth + layout.delta` vs. `scrollWidth` comparison) and
   `.../src/managers/helpers/stage.js` (`Stage.size()`, which is where the stage div's
   own pixel width — a *child* of the element this app pins, not the same element —
   gets derived from `container.clientWidth`/`getBoundingClientRect()`).

## The symptom, in the operator's own words

Reported after the M19.6 "reader repair" work above had already landed (spread-divisor
fix, click-accurate book-wide count, resizable panel, resizable pane, dwell-ring
page-boundary highlighting, `r`-key shortcut — see "Current status" below):

> "There are still some issues with page traversal where the last page before a new
> chapter is skipped when going forwards. And page numbering whilst its better, often
> skips a page number when going to a new chapter (without 1 click forward from the
> last page of Ch1, page goes up by 2 on page 1 of Ch2)."

Two distinct-sounding complaints, but almost certainly **one underlying symptom**
observed two ways: if the true last page of a chapter is never actually rendered
(`next()` advances the section one turn early), the reader would experience it exactly
as described — the "last page" is never seen, and the book-wide counter (which only
increments when a real relocate event fires) would show a page **number** that's one
short at the moment of the skip, so the very next turn into the new chapter reads as a
jump of 2 instead of 1. A single root cause would explain both.

## Current status (as of the M19.6 wrap-up commits, 2026-07-30)

Shipped, tested, and live-verified as working in this session's environment:

- The spread-divisor fix (`bookPages.ts`'s `getSpreadDivisor`/`toSpreadAdjustedPage`/
  `toSpreadAdjustedTotal`) — this was the cause of an *earlier*, different-looking
  version of "page 7 of 8 is the last page," confirmed and fixed. **Not the same bug as
  the one in this document** — decisions.md and NOTES.md are explicit that this one is
  closed; it's linked here only because it's the most recent prior instance of this same
  *class* of chapter-boundary problem, and worth knowing about before re-diagnosing.
- The click-accurate book-wide page count (`computeBookPageInfo` in `bookPages.ts`):
  every "next" is +1, unvisited sections are estimated from their share of the book's
  text and self-correct as the reader visits them.
- Highlight-across-a-page-boundary (the dwell ring), the resizable reading pane, the
  resizable/quote-fixed annotation panel, and `r` opens the reader from the Scan/Digest
  — all shipped this same session, all live-verified, unrelated to this symptom.
- Two live diagnostic sessions (see NOTES.md, linked above) swept: both fixture books
  and the operator's own real book (Kafka on the Shore); both spread modes (`single`,
  `auto`, the latter confirmed actually showing real two-page spreads); viewport widths
  700–1400px; simulated CSS zoom (110%) and device-scale-factor (1.25); non-default
  `readerFontScale`/`readerMargin`; three input paths (nav button, real `ArrowRight`
  key, real mouse clicks in the turn zone); and a rapid-fire stress case (150 key
  presses at 40ms apart). **Zero anomalies** across several hundred page turns and 50+
  real chapter transitions between the two books.

**Still open.** The symptom is real (the operator has seen it twice, with specific,
consistent detail — "page 7 of 8," "+2 not +1") but has not reproduced in either
diagnostic session. That combination is itself informative: whatever triggers it is
something neither sweep's tooling can produce.

## Candidate causes, not yet distinguished

None of these have been confirmed or ruled out — they're what's left standing after two
sweeps found nothing, in roughly descending order of suspicion:

1. **A real browser/OS display-scale or zoom level**, as opposed to a synthetic
   viewport-width or CSS-`zoom` change. Both diagnostic sessions used headless
   Chromium via Playwright; neither could exercise genuine OS-level display scaling
   (e.g. a HiDPI monitor at 125%/150% Windows/GNOME scaling, or macOS's own scaled
   resolutions) or a real trackpad/mouse-wheel browser zoom gesture. `epubjs`'s own
   `Stage.size()` (`managers/helpers/stage.js`) derives its pixel width from
   `getBoundingClientRect()` (a float) in one code path and `clientWidth` (spec-rounded
   integer) in another, depending on how it's called — a genuine sub-pixel/rounding
   mismatch between those two is exactly the shape of bug this project has hit before
   (see the original "skipped last page" cause in decisions.md), and real display
   scaling is the one variable that reliably produces sub-pixel CSS layouts that a
   1x-DPI headless browser at an integer viewport width does not.
2. **A different browser engine entirely.** Every diagnostic run in both sessions used
   Chromium (via Playwright). If the operator reads in Firefox, Safari, or an
   Electron/webview wrapper, that engine's own rounding behavior for
   `offsetWidth`/`scrollWidth`/`getBoundingClientRect()` — all of which epub.js's
   `next()` comparison depends on directly — has never been exercised here at all. This
   was not controlled for or asked about in either session.
3. **A genuinely human click/drag pattern**, as opposed to `page.mouse.click()`'s
   discrete, instantaneous synthetic event. The rapid-fire stress test (150 scripted key
   presses) covered *speed*, but not the physical variability of a real trackpad click,
   a real mouse click-and-tiny-drag, or a touch/stylus tap — any of which dispatch a
   slightly different event sequence than a synthetic click.
4. **Something specific to a book neither session tested with**, though this is the
   weakest candidate: the operator's own real book (Kafka on the Shore) *was* swept,
   clean, across 13+ chapter boundaries in multiple configurations.

## What would make the next report actionable

The fastest path forward is not another blind sweep — it's the operator catching the
*exact* conditions the next time this happens, before reloading or navigating away.
Everything below changes what a design/implementation session would actually check
first, which is why it's worth pausing to note in the moment rather than reconstructing
from memory later:

**The essentials** (the minimum that makes this reproducible in principle):

- **Which book** was open.
- **Which spread mode** (Settings → Reading tab: Single / Auto / — check which one).
- **Window/browser width** at the time — the actual pixel width of the browser
  viewport, not just "full screen." (Browser dev tools, or resizing to note it, is fine
  after the fact if the window hasn't moved.)
- **Display scale or zoom**: is the OS display scale set to anything other than 100%
  (common on Windows/Linux HiDPI laptops, e.g. 125%/150%), and is the *browser's own*
  zoom (Ctrl/Cmd +/-) at anything other than 100%?

**Also useful, if easy to check** (lower priority than the essentials above, but each
rules in or out one of the candidate causes listed above):

- **Which browser** (Chrome, Firefox, Safari, Edge, or something else) and, if easy to
  find, its version.
- **How the page was turned** at the moment it happened: the footer's arrow button, the
  `←`/`→` keyboard shortcut, or a click directly on the page text near its edge.
- Whether it was a **single isolated click/keypress**, or several turns in quick
  succession (e.g. holding the arrow key down, or clicking rapidly).
- The **page number text itself** right before and right after the jump (e.g. "Page 41
  of 283" → "Page 43 of 283") rather than a paraphrase — the exact numbers pin down
  whether it's the count math or the underlying navigation that's actually wrong.
