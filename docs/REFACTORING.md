# How we refactor

*Written 2026-07-29 because the operator asked what refactoring actually is, what it can
achieve, and how you know it worked. Repo-level, like `OPUS.md` — the principles apply to
any project here; the last section is Marginalia's specific plan.*

## What it is, in one sentence

**Refactoring is changing the structure of code without changing what it does.**

That constraint is the whole discipline. The moment you also fix a bug, add a feature, or
"improve" a behaviour while you're in there, you have lost the one property that makes
refactoring safe: if something breaks afterwards, you no longer know whether the
restructuring broke it or the change did. Fix bugs before or after. Never during.

## Why bother

Not for beauty. Refactoring pays for itself in three measurable ways:

1. **Cost of the next change.** In a 1,800-line component with 64 pieces of state, adding
   a feature means reading all of it to be sure you haven't broken something two hundred
   lines away. In six 300-line pieces with clear boundaries, you read one.
2. **Defect risk.** Most of this project's real bugs were *interaction* bugs — a hover
   strip painted over by a neighbour's stacking context, a drag leaking pointer events
   into an iframe, an effect reading state a sibling had just mutated. Those live in the
   seams between responsibilities that share a file and share state. Fewer shared
   surfaces, fewer of those.
3. **Comprehension.** You are working with implementation sessions that read the code
   fresh every time. A file that doesn't fit in one reading gets partially understood,
   and partial understanding is where confident wrong changes come from.

The honest counter-argument: refactoring produces **no user-visible value**. It is an
investment against future work, so it is only worth doing when there *is* future work in
that area. Refactoring code nobody will touch again is waste.

## When to do it

- **Immediately before risky work in the same area** — this is the highest-value timing.
  You pay the cost once and the risky change lands in a structure that can accept it.
- When the same concept is expressed several different ways and you keep having to
  translate between them in your head.
- When a bug's fix is "and also update these four other places".

**When not to:** the week you wrote the code (you don't know its real shape yet); while a
feature is half-finished; or as a way of avoiding a hard feature.

## First decide whether you need one at all

"Should we refactor?" is answerable with measurement, not taste. Look at the **shape of
the distribution**, not any single file:

- How many source files are over ~400 lines, as a fraction of the whole?
- Is the biggest file an outlier, or the top of a gentle slope? An outlier is a specific
  problem with a specific fix; a slope is a culture problem no single refactor solves.
- Is the big file *long but simple* (a schema, a constants table, a switch over many
  cases) or *long and stateful*? Length alone is not the issue — a 700-line schema file
  is fine. Count state instead: `useState`/`useRef` in a component, or fields on a class.
- Does upcoming work actually touch it?

**Worked example — this codebase, measured 2026-07-29:** 92 files under 200 lines, 16
between 200 and 400, five over 400. Of those five, one is a schema file (fine), three are
between 400 and 550 (unremarkable), and `ReaderView.tsx` is 1,865 lines with 64 hook
calls — **3.4× the next-largest component**. And M20's page fold is surgery on exactly
that file.

That distribution says something specific: this is a *disciplined codebase with one
outlier*, not a codebase that has gone soft. The correct response is not a broad refactor
— it is one narrow one, aimed at the outlier, timed just before the work that depends on
it. Which is why M19.8's scope was cut in half on the day it was measured.

The general rule: **let the measurement pick the scope.** A refactor justified by "it
feels messy" expands without limit; one justified by a number stops when the number
moves.

## The safety net comes first

You cannot refactor safely without a way to detect that behaviour changed. Before
touching anything, know what your net is:

- **Tests you already have.** This project has 120+ unit tests concentrated in exactly
  the right place — anchoring, context building, the compiler, the digest.
- **Characterization tests you add first.** Where the net is thin, write tests that
  capture what the code *currently does* (not what it should do) before you move it. If
  the current behaviour is odd, the test records the oddness. That is correct: you are
  proving you didn't change anything.
- **The live-verification habit.** This project's real net has always been driving the
  app. A refactor of the reader needs the same headless pass the milestone that built it
  used — highlight, ask, turn, resize, in both themes.
- **The M17.5 performance baseline.** Now that request counts and bundle size are
  recorded, a refactor that quietly doubles the bundle is detectable.

## The method

1. **One target at a time.** Name the specific structural problem before starting.
2. **Small, reversible steps.** Extract one piece, run the tests, commit. A refactor
   should be a sequence of commits each of which leaves the app working, not one
   enormous commit that either works or doesn't.
3. **Move code before you improve it.** Extract a function verbatim, tests green, commit.
   *Then*, if it needs simplifying, do that as its own step. Combining the two is how
   "safe refactor" becomes "rewrite with bugs".
4. **Keep it green.** If the tests are red for more than one step, stop and go back.
5. **Never mix in a feature.** If you find a bug, write it down and keep going.
6. **Timebox it.** A refactor without a stopping condition expands until it is a rewrite.

## What is achievable — and what isn't

**Achievable:** extracting components and hooks with clear inputs and outputs; unifying
several representations of one concept behind a single module; narrowing what each piece
can see; deleting genuinely dead code; making a load-bearing quirk explicit and
documented instead of implicit.

**Not achievable, and don't pretend otherwise:** making the domain simple when it isn't.
Some of this code is complicated because *epub.js is complicated* — the gap option that
means two things, the manager's one-time-copied settings, the marks-pane's load-bearing
`pointer-events: none`. Refactoring can isolate that complexity behind a boundary and
name it. It cannot delete it. A refactor that "cleans up" one of those quirks because it
looks redundant will silently break something that took a live session to diagnose. **The
NOTES.md entries are the map of which weirdness is load-bearing — read them first.**

## Success metrics

Refactoring is judged on evidence, and it splits into two halves.

**Did behaviour stay identical?** (The pass/fail gate — all of these must hold.)

- Every existing test still passes, and none was weakened or deleted to make it pass.
- The milestone's live-verification pass produces the same result as before.
- No new console errors or warnings.
- Bundle size and request count are not materially up (M17.5 gave us the baseline).
- No user-visible change whatsoever — if you can see it, it wasn't a refactor.

**Did the structure actually improve?** (Measure before and after; write both down.)

- Size of the largest file, and of the component you targeted.
- Number of pieces of state in the component (`useState`/`useRef` count is a crude but
  honest proxy — ReaderView is at 64).
- Number of places one concept is expressed or converted.
- Test coverage of the extracted pieces — small focused units are testable in a way a
  god component is not, so unit test *count* should go up.

**The real payoff test, measurable one milestone later:** the next feature in that area
touches fewer files and produces a smaller diff than it would have. If the fold still
requires a 600-line change to one file afterwards, the refactor missed.

## Marginalia's refactor (M19.8)

**One target**, after the assessment above cut the original two down:

**`ReaderView.tsx` — 1,865 lines, 64 hook calls.** It has absorbed something in every
milestone since M10: page-turn snapshots, drag-to-peel, turn zones, the scrub dial,
chapter nav, spread mode, margins, text size, fullscreen, the context ladder. Split along
the seams that already exist implicitly — book lifecycle and rendition setup, navigation
and position, selection and highlights, and the chrome — into focused hooks and
components with explicit inputs, prioritising the seams **the fold will touch**.

*Dropped 2026-07-29:* unifying the four representations of position (CFI, `spineIndex`,
percent, char offsets). It was a "one definition would be nicer" argument with no consumer
under pressure, and the measured discipline elsewhere says it is not currently hurting.
Recorded here so the reasoning survives if it ever does start hurting.

Placed deliberately **immediately before M20's paper fold**, the riskiest surgery planned
on exactly this component. That timing is the point: pay once, then let the hardest change
land in a structure that can hold it.
