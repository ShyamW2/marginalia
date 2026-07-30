/**
 * Where a page turn should land, and which page of the section we are on —
 * both decided from container geometry with rounding, rather than from
 * epub.js's own exact-equality comparisons.
 *
 * ## The bug this exists to fix
 *
 * epub.js's `DefaultViewManager.next()` decides "scroll one more page inside
 * this section" vs. "advance to the next section" like this:
 *
 *     left = container.scrollLeft + container.offsetWidth + layout.delta;
 *     if (left <= container.scrollWidth) this.scrollBy(layout.delta, 0, true);
 *     else next = this.views.last().section.next();
 *
 * On page *k* of a section of *n* pages that reads `(k + 1) * delta <= n *
 * delta`, so on the second-to-last page it is an exact equality — zero
 * tolerance — and one of its inputs is not exact. `container.scrollLeft` is
 * only exact when a whole number of CSS pixels is also a whole number of
 * device pixels. At a fractional zoom or display scale it isn't: Chrome snaps
 * the stored scroll offset to a physical pixel, so `scrollLeft` reads back
 * slightly *high*, and epub.js's own `scrollLeft += delta` accumulates that
 * error every turn.
 *
 * Measured live (Kafka on the Shore, 1400x1000, spread mode, delta = 1025) at
 * a 0.9 device-scale factor — the equivalent of the operator's 90% browser
 * zoom — `scrollLeft` read 1025.5555 instead of 1025, +0.5555px per turn:
 *
 *     spread 2 of 0..3  left = 4101.1111  scrollWidth = 4100  -> NEXT-SECTION
 *
 * The last page of that chapter is never rendered. At a device-scale factor of
 * 1 the same run reads `left = 4100.0000 vs 4100 -> scroll` and nothing is
 * skipped — which is exactly the operator's report ("resolved when we resize
 * the tab to 100%").
 *
 * Because the failure is always at the equality, it always presents as *the
 * last page of the chapter* and never as any other page. Every earlier turn
 * has a whole `delta` of slack to absorb the error.
 *
 * ## The fix
 *
 * Round the scroll offset to a spread index first (robust to any error below
 * half a page), decide against an absolute target, and scroll to absolute
 * multiples of `delta` so nothing can accumulate. The same rounded index also
 * gives the page number: epub.js's `paginatedLocation()` derives it with
 * `Math.floor(start / pageWidth)`, which has the mirror-image zero tolerance
 * and reports one page too few the moment that sub-pixel error is negative.
 */

/** The four numbers every decision below is made from. */
export interface TurnGeometry {
  /** `container.scrollLeft` — the inexact one. */
  scrollLeft: number;
  /** `container.clientWidth`. */
  clientWidth: number;
  /** `container.scrollWidth`. */
  scrollWidth: number;
  /** `layout.delta` — the width of one page view (a whole spread when two
   *  facing pages are showing, so no spread divisor is needed anywhere here). */
  delta: number;
}

export type TurnDecision =
  | { kind: "scroll"; offset: number }
  | { kind: "section" };

/**
 * Slack for the one comparison that can still be inexact: `scrollWidth` is an
 * integer rounded from a content width that is a whole multiple of `delta`
 * only when `delta` itself is integral (in spread mode `delta / 2` is a
 * column, so an odd container width leaves a half pixel). A real next page is
 * a whole `delta` away, so a single pixel cannot let a wrong decision through.
 */
const SNAP_TOLERANCE_PX = 1;

/** How many page views this section paginated into. 1-based count. */
export function spreadCount(g: TurnGeometry): number {
  if (!(g.delta > 0)) return 1;
  return Math.max(1, Math.round(g.scrollWidth / g.delta));
}

/** Which page view is showing, 0-based. */
export function spreadIndex(g: TurnGeometry): number {
  if (!(g.delta > 0)) return 0;
  const raw = Math.round(g.scrollLeft / g.delta);
  return Math.min(Math.max(raw, 0), spreadCount(g) - 1);
}

/** The section-relative page number and total, both 1-based. */
export function chapterPageFromGeometry(g: TurnGeometry): {
  page: number;
  total: number;
} {
  const total = spreadCount(g);
  return { page: Math.min(spreadIndex(g) + 1, total), total };
}

export function decideTurn(
  direction: "prev" | "next",
  g: TurnGeometry,
): TurnDecision {
  const index = spreadIndex(g);

  if (direction === "prev") {
    if (index >= 1) return { kind: "scroll", offset: (index - 1) * g.delta };
    return { kind: "section" };
  }

  const maxScroll = Math.max(0, g.scrollWidth - g.clientWidth);
  const offset = (index + 1) * g.delta;
  if (g.delta > 0 && offset <= maxScroll + SNAP_TOLERANCE_PX) {
    return { kind: "scroll", offset };
  }
  return { kind: "section" };
}

/**
 * The slice of epub.js's `DefaultViewManager` this module drives. Structural,
 * not imported: epub.js ships no types for its managers, and naming exactly
 * what is touched is the point (see installTurnFix's comment on why the
 * section-advance path is re-expressed rather than delegated).
 */
export interface PaginatedManager {
  container: HTMLElement;
  isPaginated: boolean;
  layout: { delta: number; name?: string };
  settings: { axis?: string; direction?: string };
  views: {
    length: number;
    first(): SectionView | undefined;
    last(): SectionView | undefined;
    show(): void;
  };
  clear(): void;
  updateLayout(): void;
  append(section: unknown): Promise<unknown>;
  prepend(section: unknown): Promise<unknown>;
  scrollTo(x: number, y: number, silent: boolean): void;
  next(): unknown;
  prev(): unknown;
  scrollLeft?: number;
  /** epub.js's own event emitter. `"resize"` carries the section whose view
   *  just re-framed — i.e. re-paginated. */
  on?(event: string, handler: (section: unknown) => void): void;
  off?(event: string, handler: (section: unknown) => void): void;
}

interface SectionView {
  section: { index?: number; next(): unknown; prev(): unknown };
}

/** The section a re-paginated view belongs to. */
function sectionIndexOf(section: unknown): number | undefined {
  return (section as { index?: number } | null | undefined)?.index;
}

/** Which section the manager is showing right now. */
export function shownSectionIndex(
  manager: PaginatedManager,
): number | undefined {
  return manager.views.last()?.section.index;
}

/**
 * A freshly rendered section does not always keep the pagination it is first
 * measured with. Measured live 2026-07-30 (Kafka on the Shore, section 20):
 * the view expanded to 7 page views, then re-framed to 6 about 15ms later, once
 * its fonts had finished loading and the text re-broke. epub.js's `reframe()`
 * sets the iframe's width to 0 on the way through, which collapses the
 * container's scroll range, so the browser clamps `scrollLeft` to 0 — the
 * reader is dumped at the *start* of the section, and a turn that had just
 * landed on "the last page of the previous chapter" is now several pages away
 * from it. That is the page-number jump seen from the other end.
 *
 * So a section-crossing turn states its landing intent once, and re-states it
 * if the section re-paginates within the window below. One-shot and
 * time-bounded: the listener removes itself as soon as it fires for that
 * section, or when the window closes, so nothing is left watching a section the
 * reader has moved on from.
 */
const REPAGINATION_WINDOW_MS = 600;

function reassertLanding(
  manager: PaginatedManager,
  section: unknown,
  land: () => void,
): void {
  const index = sectionIndexOf(section);
  if (!manager.on || !manager.off || index === undefined) return;

  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    manager.off?.("resize", onResize);
    window.clearTimeout(timer);
  };
  const onResize = (resized: unknown) => {
    if (sectionIndexOf(resized) !== index) return;
    stop();
    land();
  };
  const timer = window.setTimeout(stop, REPAGINATION_WINDOW_MS);
  manager.on("resize", onResize);
}

export function readTurnGeometry(manager: PaginatedManager): TurnGeometry {
  const container = manager.container;
  return {
    scrollLeft: container.scrollLeft,
    clientWidth: container.clientWidth,
    scrollWidth: container.scrollWidth,
    delta: manager.layout?.delta || container.clientWidth,
  };
}

/**
 * Replaces the manager's `next`/`prev` with versions that decide via
 * `decideTurn`. Installed once per rendition, so every caller is covered —
 * the footer buttons, the keyboard shortcuts, the turn zones, the
 * highlight-across-a-boundary dwell — without each having to know about it.
 *
 * Only left-to-right horizontal pagination of a *reflowable* book is taken
 * over; anything else (vertical axis, rtl, a fixed-layout book) falls through
 * to epub.js untouched, since none of those share the geometry this reasons
 * about.
 *
 * The section-advance path re-expresses epub.js's own three lines rather than
 * delegating back to `next()`: delegating would re-run the exact comparison
 * this fix exists to distrust, and on a *negative* sub-pixel error that
 * comparison says "scroll" where we say "advance" — the browser would clamp
 * the scroll to the position it is already at and the turn would visibly do
 * nothing. Verified against epub.js 0.3.93: for a reflowable layout
 * `handleNextPrePaginated`/`handlePrevPrePaginated` return immediately
 * (`layout.name !== "pre-paginated"`) and `forceRight` is always false, so
 * clear -> updateLayout -> append/prepend -> show is the whole path.
 */
export function installTurnFix(manager: PaginatedManager | undefined): void {
  if (typeof manager?.next !== "function") return;

  const originalNext = manager.next.bind(manager);
  const originalPrev = manager.prev.bind(manager);

  // Every condition is re-read per call, nothing is captured at install time.
  // That includes `manager.container`, which does not exist yet when this is
  // installed: epub.js builds the stage in `DefaultViewManager#render`, queued
  // behind `Rendition#attachTo`, well after the manager itself. Checking it
  // here rather than up front is what makes the install timing-independent
  // (found the hard way — an install-time container check silently declined to
  // patch anything, and the skip survived).
  const takesOver = () =>
    Boolean(manager.container) &&
    manager.isPaginated &&
    manager.settings.axis === "horizontal" &&
    (!manager.settings.direction || manager.settings.direction === "ltr") &&
    manager.layout?.name !== "pre-paginated" &&
    manager.views.length > 0;

  // Absolute, silent, and mirrored onto the manager's own cached scrollLeft —
  // the same bookkeeping epub.js's `next()` does before it scrolls.
  const scrollToSpread = (offset: number) => {
    manager.scrollTo(offset, 0, true);
    manager.scrollLeft = manager.container.scrollLeft;
  };

  manager.next = function patchedNext() {
    if (!takesOver()) return originalNext();
    const decision = decideTurn("next", readTurnGeometry(manager));
    if (decision.kind === "scroll") {
      scrollToSpread(decision.offset);
      return undefined;
    }
    const nextSection = manager.views.last()?.section.next();
    if (!nextSection) return undefined;
    const landOnFirstSpread = () => scrollToSpread(0);
    manager.clear();
    manager.updateLayout();
    return manager.append(nextSection).then(() => {
      landOnFirstSpread();
      manager.views.show();
      reassertLanding(manager, nextSection, landOnFirstSpread);
    });
  };

  manager.prev = function patchedPrev() {
    if (!takesOver()) return originalPrev();
    const decision = decideTurn("prev", readTurnGeometry(manager));
    if (decision.kind === "scroll") {
      scrollToSpread(decision.offset);
      return undefined;
    }
    const prevSection = manager.views.first()?.section.prev();
    if (!prevSection) return undefined;
    // Land on the previous section's *last* page, epub.js's own choice of
    // landing spot — derived from the rounded page-view count rather than from
    // `scrollWidth - delta`, so a half-pixel content width cannot land it a
    // page early.
    const landOnLastSpread = () => {
      const g = readTurnGeometry(manager);
      scrollToSpread(Math.max(0, (spreadCount(g) - 1) * g.delta));
    };
    manager.clear();
    manager.updateLayout();
    return manager.prepend(prevSection).then(() => {
      landOnLastSpread();
      manager.views.show();
      reassertLanding(manager, prevSection, landOnLastSpread);
    });
  };
}
