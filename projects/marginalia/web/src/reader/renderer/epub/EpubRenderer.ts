import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
// M24.1 B: side-effect only — patches marks-pane's shared Highlight
// prototype before any mark is drawn. See marksPanePatch.ts.
import "./marksPanePatch.js";
import type { HighlightKind, HighlightWithThread } from "@marginalia/shared";
import { resolveAnchor, type RangeLike } from "../../anchorResolution.js";
import { getSelectionContext, rangeFromTextOffsets } from "../../selectionContext.js";
import { audioTintStyle, markStyleForKind, searchMarkStyle } from "../../highlightKinds.js";
import {
  chapterPageFromGeometry,
  installTurnFix,
  readTurnGeometry,
  shownSectionIndex,
  type PaginatedManager,
} from "../../pageTurn.js";
import { computeReaderGap } from "../../readerGeometry.js";
import { buildToc, type TocEntry } from "./toc.js";
import type {
  Locator,
  ReaderThemeVars,
  RendererCapabilities,
  RendererEvents,
  RendererOptions,
  ResourceRenderer,
} from "../types.js";

export const HIGHLIGHT_MARK_CLASS = "marginalia-highlight";
// M24: the find bar's own mark class — never shares cfiOwners' highlight
// ownership bookkeeping (a search mark and a highlight mark can legitimately
// coexist at the same CFI) and is cleared as a whole rather than diffed.
const SEARCH_MARK_CLASS = "marginalia-search-mark";
// M21: the playing sentence's mark — a distinct class from
// HIGHLIGHT_MARK_CLASS (never shares cfiOwners' ownership bookkeeping;
// exactly one tint is ever live, and it's ephemeral, not a real highlight a
// click should open a thread on).
const AUDIO_TINT_MARK_CLASS = "marginalia-audio-tint";
const SELECTION_CONTEXT_MAX_LEN = 64;
const LOCATIONS_CHAR_STEP = 1600;

// epub.js's View typings don't expose the `contents` it renders, though it
// exists at runtime (see managers/views/iframe.js) — narrow just that.
interface ViewWithContents {
  contents: Contents;
}

// epub.js's bundled RenditionOptions typings omit `gap`, though the runtime
// supports it (layout.js reads `this.settings.gap`) — see the SPEC-GAP
// comment at renderTo() below for why it's needed at all.
interface RenditionOptionsWithGap {
  width: string;
  height: string;
  flow: string;
  manager: string;
  spread: string;
  minSpreadWidth: number;
  allowScriptedContent: boolean;
  gap: number;
}

/** epub.js ships no types for its view manager — see pageTurn.ts's own note. */
function managerOf(rendition: Rendition | null): PaginatedManager | undefined {
  return (rendition as unknown as { manager?: PaginatedManager } | null)?.manager;
}

/**
 * Re-measures every highlight overlay against the text it is anchored to.
 * See pageTurn.ts/PAGE_CURL.md for the fuller history — moved here verbatim
 * from ReaderView.tsx's module scope at M40 §A. Real triggers: the deferred
 * `themes.fontSize()` once the settings fetch resolves, the gap/column-width
 * recompute behind a margin or text-size change, and web fonts finishing
 * loading after first paint.
 */
function refreshHighlightOverlays(rendition: Rendition | null): void {
  const manager = managerOf(rendition);
  if (!manager) return;
  const views = manager.views as unknown as {
    forEach?: (fn: (view: { pane?: { render(): void } }) => void) => void;
  };
  views.forEach?.((view) => {
    view.pane?.render();
  });
}

function applyEpubTheme(rendition: Rendition, vars: ReaderThemeVars): void {
  rendition.themes.register("app", {
    "html, body": {
      background: `${vars.bg} !important`,
      color: `${vars.text} !important`,
      // M31 C2: epub.js forwards touchstart/move/end `{ passive: true }`
      // (epubjs/src/contents.js), so `preventDefault()` on the forwarded
      // event is always a no-op — the real suppression of native panning has
      // to come from CSS.
      "touch-action": "none !important",
    },
    body: {
      "font-family": `${vars.fontSerif} !important`,
      "line-height": "1.65 !important",
      // Real page margin comes from the `gap` render option — epub.js
      // overwrites body padding with its own inline `!important` on every
      // layout pass, so this rule only matters for the brief pre-layout
      // flash and any non-paginated fallback rendering.
      padding: "0 3rem !important",
      // M31 C4: suppress iOS's "Save/Copy/Look Up" callout on a long-press
      // without touching selection.
      "-webkit-touch-callout": "none !important",
      "user-select": "text !important",
    },
    a: { color: `${vars.accent} !important` },
    "::selection": { background: `${vars.highlightActive} !important` },
    [`.${HIGHLIGHT_MARK_CLASS}`]: {
      background: `${vars.highlight} !important`,
      cursor: "pointer",
    },
  });
  rendition.themes.select("app");
}

async function fetchCachedLocations(resourceId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/locations`);
    if (!res.ok) return null;
    const data = (await res.json()) as { locations: string | null };
    return data.locations;
  } catch {
    return null;
  }
}

function saveCachedLocations(resourceId: string, locations: string): void {
  fetch(`/api/resources/${resourceId}/locations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations }),
  }).catch(() => {
    // best-effort — worst case this book regenerates locations next open
  });
}

/** M40 §A: everything `ReaderView` still needs to receive from a rendered
 * section that isn't shaped like the standard interface events — chapter
 * page numbers (needs the epub.js manager's own geometry) for both a real
 * relocation and a repagination-only update (the section re-broke its lines
 * without the reader moving). */
export interface EpubRelocatedInfo {
  kind: "relocated" | "repaginated";
  spineIndex: number;
  /** null for "repaginated" — no new position, just a re-measured one. */
  cfi: string | null;
  atStart: boolean;
  atEnd: boolean;
  /** epub.js's own 0-1 location percentage, null until locations exist. */
  percent: number | null;
  /** null exactly when `publishPageNumbers`'s own original guard failed —
   * the epub.js manager wasn't ready yet. `ReaderView` falls back to the
   * percentage-based progress readout in that case, same as before. */
  chapterPage: { page: number; total: number } | null;
}

type Listener<T> = (arg: T) => void;

/**
 * M40 §A (PDF.md §7): the epub.js implementation of `ResourceRenderer`.
 * Every epubjs import in the app lives here (and in `./toc.js`,
 * `./marksPanePatch.js`) — nowhere else.
 *
 * Beyond the strict interface, this class exposes a small, named set of
 * EPUB-only extras — deliberate exceptions, not oversights, because forcing
 * every one of today's behaviors through the abstract interface before a
 * second renderer exists to prove it against would mean inventing
 * speculative interface members. See docs/marginalia/TASKS.md M40 §A.
 */
export class EpubRenderer implements ResourceRenderer {
  readonly capabilities: RendererCapabilities = {
    spread: true,
    fontScale: true,
    margins: true,
    pageFold: true,
    pageNumbers: true,
    textSelection: true,
    advance: "page",
  };

  private book: Book | null = null;
  private rendition: Rendition | null = null;
  private container: HTMLElement | null = null;
  private resourceId = "";

  private currentCfi: string | null = null;
  private currentSpineIndex: number | null = null;
  /** The live epub.js Contents for whatever section rendered most recently.
   * ⚠️ In spread mode epub.js's "rendered" event fires once per visible
   * view — this is last-write-wins across those, matching the original
   * `currentContentsRef` behavior exactly (not fixed here). */
  private currentContents: Contents | null = null;

  private themeVars: ReaderThemeVars | null = null;
  private focusModeHidden = false;
  private fontScale = 1;

  /** The CFI the audio tint mark currently sits at, if any — tracked
   * separately from cfiOwners (real highlights) since exactly one tint is
   * ever live and it is never co-owned. */
  private tintCfi: string | null = null;
  /** The distinct CFIs the find bar currently has marks painted at. */
  private searchMarkCfis = new Set<string>();

  private highlights: HighlightWithThread[] = [];
  private resolvedIds = new Set<string>();
  /** Tracks the CFI each highlight's mark was actually attached at, which can
   * differ from the stored anchor when it was resolved via the text-search
   * fallback rather than the original CFI resolving clean. */
  private attachedCfi = new Map<string, string>();
  private markKind = new Map<string, HighlightKind>();
  /** Two different highlights can legitimately resolve to the identical CFI.
   * epub.js's View keys its internal highlight/mark tracking by the raw CFI
   * string and unconditionally creates a new SVG mark on every
   * `annotations.highlight()` call for that CFI without checking for an
   * existing one — so attaching twice at the same CFI leaves an orphaned,
   * untracked, unremovable mark. Only the first ("owner") ever gets a real
   * epub.js-level mark; ownership transfers to the next co-owner if the
   * owner is deleted. */
  private cfiOwners = new Map<string, string[]>();

  private lastGapWidth = 0;
  private redisplayTimer: number | undefined;
  private spreadMode: RendererOptions["spread"] = "auto";
  private marginPx = 0;

  private lastSelectionViewportRect: DOMRect | null = null;

  private eventListeners: { [K in keyof RendererEvents]?: Set<Listener<Parameters<RendererEvents[K]>[0]>> } = {};
  private sectionRenderedListeners = new Set<Listener<{ document: Document; sectionIndex: number }>>();
  private epubRelocatedListeners = new Set<Listener<EpubRelocatedInfo>>();
  private unanchoredListeners = new Set<Listener<string>>();

  private resizeObserver: ResizeObserver | null = null;
  private cancelled = false;

  async mount(container: HTMLElement, resource: { id: string }, opts: RendererOptions): Promise<void> {
    this.container = container;
    // `container`'s own box is what gets pinned to an integer pixel width
    // (see `pinContainerWidth`'s comment) and so can no longer be measured
    // from once pinned — the *available* space has to come from its parent
    // instead. `ReaderView`'s JSX nests `containerRef`'s element directly
    // inside the margin-wrapper div for exactly this reason, so this is
    // structural, not a guess.
    this.marginWrapper = container.parentElement;
    this.resourceId = resource.id;
    this.spreadMode = opts.spread;
    this.fontScale = opts.fontScale;
    this.marginPx = opts.marginPx;

    const initialWidth = this.pinContainerWidth();

    // Our file route has no .epub extension for epub.js to sniff from the
    // URL, so it would otherwise be treated as an unpacked directory of
    // book files rather than a single archive to fetch and unzip.
    const book: Book = ePub(`/api/resources/${resource.id}/file`, { openAs: "epub" });
    this.book = book;
    const rendition = book.renderTo(container, {
      width: "100%",
      height: "100%",
      flow: opts.flow === "scrolled" ? "scrolled-doc" : "paginated",
      manager: "default",
      // M12: "auto" lets epub.js show two facing pages once the stage is at
      // least minSpreadWidth wide, falling back to one page below it.
      spread: opts.spread,
      minSpreadWidth: 960,
      allowScriptedContent: false,
      // SPEC-GAP: epub.js's own column layout recomputes and re-applies
      // inline `padding-left/right: <gap/2>px !important` on every
      // render/resize, discarding theme-set body padding. Passing `gap`
      // here is what actually reaches the page edge.
      gap: computeReaderGap(initialWidth, opts.spread, opts.fontScale),
    } as RenditionOptionsWithGap);
    this.rendition = rendition;

    // M19.6: take over the "scroll one more page vs. advance the section"
    // decision from epub.js, whose own comparison loses to sub-pixel scroll
    // rounding at any fractional browser zoom. Awaits `started`, not
    // `renderTo`: epub.js builds the manager inside `Rendition#init`, which
    // only runs once the book has finished opening.
    void rendition.started.then(() => {
      if (this.cancelled) return;
      installTurnFix(managerOf(rendition));
      managerOf(rendition)?.on?.("resize", (section: unknown) => this.handleSectionRepaginated(section));
    });

    if (this.themeVars) applyEpubTheme(rendition, this.themeVars);
    rendition.themes.fontSize(`${Math.round(opts.fontScale * 100)}%`);

    this.lastGapWidth = initialWidth;
    const resizeObserver = new ResizeObserver(() => this.handleContainerResize());
    this.resizeObserver = resizeObserver;
    if (this.marginWrapper) resizeObserver.observe(this.marginWrapper);

    rendition.on("relocated", (location: Location) => this.handleRelocated(location));
    rendition.on("rendered", (section: unknown, view: unknown) => this.handleRendered(section, view));
    rendition.on("selected", (cfiRange: string, contents: Contents) => this.handleSelected(cfiRange, contents));
    rendition.on("markClicked", (_cfiRange: string, data: { highlightId?: string }) => {
      if (data.highlightId) this.emit("markClicked", data.highlightId);
    });

    await book.ready;
  }

  private marginWrapper: HTMLElement | null = null;

  destroy(): void {
    this.cancelled = true;
    window.clearTimeout(this.redisplayTimer);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    const rendition = this.rendition;
    const book = this.book;
    this.rendition = null;
    this.book = null;
    rendition?.destroy();
    book?.destroy();
  }

  // ── Navigation ────────────────────────────────────────────────────────

  async goTo(loc: Locator): Promise<void> {
    if (!this.rendition) return;
    if (loc.cfi) {
      await this.rendition.display(loc.cfi);
      return;
    }
    // M40 §B step 3: no CFI — resolve against the current section's text if
    // it's the one showing; otherwise there is nothing live to resolve
    // against (the caller is responsible for landing on the right section
    // first, same as goToFindHit already does).
    if (this.currentContents && this.currentContents.sectionIndex === loc.sectionIndex) {
      const range = rangeFromTextOffsets(this.currentContents.document, loc.offset, loc.offset + loc.length);
      if (range) {
        await this.rendition.display(this.currentContents.cfiFromRange(range));
        return;
      }
    }
  }

  /** EPUB-only: spine `href` navigation (TOC entries, chapter stepping) —
   * `Locator` has no field for a bare href. */
  async goToHref(href: string): Promise<void> {
    await this.rendition?.display(href);
  }

  /** EPUB-only: jump to the *start* of a spine section by its numeric index
   * (`usePageTurnAnimation`'s cross-section slide, and the audio tint's own
   * follow-jump) - distinct from `goTo`'s `Locator`, which always names a
   * position *within* a section. */
  async goToSpineIndex(index: number): Promise<void> {
    await this.rendition?.display(index);
  }

  async next(): Promise<void> {
    await this.rendition?.next();
  }

  async prev(): Promise<void> {
    await this.rendition?.prev();
  }

  currentLocation(): Locator | null {
    if (!this.currentCfi || this.currentSpineIndex === null) return null;
    return { sectionIndex: this.currentSpineIndex, offset: 0, length: 0, cfi: this.currentCfi };
  }

  // ── Events (standard interface) ──────────────────────────────────────

  on<K extends keyof RendererEvents>(event: K, cb: RendererEvents[K]): () => void {
    const set = (this.eventListeners[event] ??= new Set()) as Set<Listener<Parameters<RendererEvents[K]>[0]>>;
    const listener = cb as unknown as Listener<Parameters<RendererEvents[K]>[0]>;
    set.add(listener);
    return () => set.delete(listener);
  }

  private emit<K extends keyof RendererEvents>(event: K, arg: Parameters<RendererEvents[K]>[0]): void {
    const set = this.eventListeners[event] as Set<Listener<Parameters<RendererEvents[K]>[0]>> | undefined;
    set?.forEach((cb) => cb(arg));
  }

  // ── Events (EPUB-only extras) ─────────────────────────────────────────

  /** Fires once per rendered section (up to twice in spread mode), with a
   * plain DOM `Document` — never an epubjs `Contents` — so `ReaderView` can
   * attach its own mousemove/click/touch/keydown listeners directly, using
   * only standard DOM APIs, exactly as it did when those were `rendition.on`
   * handlers. A new section is a genuinely new iframe/document (epub.js
   * destroys the old one), so there is nothing to detach and no stale state
   * to carry over when the next one arrives. */
  onSectionRendered(cb: Listener<{ document: Document; sectionIndex: number }>): () => void {
    this.sectionRenderedListeners.add(cb);
    return () => this.sectionRenderedListeners.delete(cb);
  }

  onEpubRelocated(cb: Listener<EpubRelocatedInfo>): () => void {
    this.epubRelocatedListeners.add(cb);
    return () => this.epubRelocatedListeners.delete(cb);
  }

  /** A highlight `resolveAnchor` could not place even with the text-search
   * fallback — the margin rail shows these differently. */
  onUnanchored(cb: Listener<string>): () => void {
    this.unanchoredListeners.add(cb);
    return () => this.unanchoredListeners.delete(cb);
  }

  // ── Marks ────────────────────────────────────────────────────────────

  paintMark(highlightId: string, loc: Locator, kind: HighlightKind): void {
    if (!loc.cfi) return;
    this.resolvedIds.add(highlightId);
    this.markKind.set(highlightId, kind);
    this.attachOwnedMark(highlightId, loc.cfi, kind);
  }

  removeMark(highlightId: string): void {
    const cfi = this.attachedCfi.get(highlightId);
    this.attachedCfi.delete(highlightId);
    this.markKind.delete(highlightId);
    this.resolvedIds.delete(highlightId);
    if (!cfi) return;
    const remaining = this.highlights.filter((h) => h.id !== highlightId);
    this.detachOwnedMark(highlightId, cfi, remaining);
  }

  setTint(loc: Locator | null): void {
    const cfi = this.resolveTintCfi(loc);
    if (this.tintCfi === cfi) return;
    if (this.tintCfi) this.rendition?.annotations.remove(this.tintCfi, "highlight");
    this.tintCfi = cfi;
    if (cfi && this.themeVars) {
      this.rendition?.annotations.highlight(
        cfi,
        {},
        undefined,
        AUDIO_TINT_MARK_CLASS,
        audioTintStyle(this.themeVars, this.focusModeHidden),
      );
    }
  }

  private resolveTintCfi(loc: Locator | null): string | null {
    if (!loc) return null;
    if (loc.cfi) return loc.cfi;
    if (!this.currentContents || this.currentContents.sectionIndex !== loc.sectionIndex) return null;
    const range = rangeFromTextOffsets(this.currentContents.document, loc.offset, loc.offset + loc.length);
    return range ? this.currentContents.cfiFromRange(range) : null;
  }

  markRect(highlightId: string): DOMRect | null {
    if (!this.container) return null;
    // marks-pane's `Highlight.bind()` copies every key of the `data` object
    // `attachOwnedMark` passes (`{highlightId}`) onto the mark's own group
    // element via `element.dataset[attr] = data[attr]` — so the group carries
    // `data-highlight-id` for free, no separate id-to-CFI lookup needed.
    const rect = this.container.querySelector(`.${HIGHLIGHT_MARK_CLASS}[data-highlight-id="${highlightId}"] rect`);
    return rect ? rect.getBoundingClientRect() : null;
  }

  // ── Theme ────────────────────────────────────────────────────────────

  applyTheme(vars: ReaderThemeVars): void {
    this.themeVars = vars;
    if (this.rendition) applyEpubTheme(this.rendition, vars);
    this.retintAll();
  }

  setFocusMode(hidden: boolean): void {
    this.focusModeHidden = hidden;
    this.retintAll();
  }

  private retintAll(): void {
    if (!this.rendition || !this.themeVars) return;
    // Re-tint every already-attached mark: fill-opacity/blend-mode differ
    // between paper and ink, so a highlight created under one theme must
    // repaint when the reader toggles to the other — and reading focus mode
    // needs the same repaint to hide/reveal marks. `annotations.highlight()`
    // doesn't update an existing mark in place — it stacks a new one — so
    // each mark is removed and re-added. Only the mark's owner is touched.
    for (const [highlightId, cfi] of this.attachedCfi) {
      if (!this.isMarkOwner(highlightId, cfi)) continue;
      const kind = this.markKind.get(highlightId);
      if (!kind) continue;
      this.rendition.annotations.remove(cfi, "highlight");
      this.rendition.annotations.highlight(
        cfi,
        { highlightId },
        undefined,
        HIGHLIGHT_MARK_CLASS,
        markStyleForKind(kind, this.themeVars, this.focusModeHidden),
      );
    }
    if (this.tintCfi) {
      this.rendition.annotations.remove(this.tintCfi, "highlight");
      this.rendition.annotations.highlight(
        this.tintCfi,
        {},
        undefined,
        AUDIO_TINT_MARK_CLASS,
        audioTintStyle(this.themeVars, this.focusModeHidden),
      );
    }
  }

  setFontScale(scale: number): void {
    this.fontScale = scale;
    if (!this.rendition) return;
    this.rendition.themes.fontSize(`${Math.round(scale * 100)}%`);
    this.applyGapForWidth(this.pinContainerWidth());
  }

  /** EPUB-only: re-measures every highlight overlay against the text it's
   * anchored to — `ReaderView`'s own font-scale/margin/pane-width/spread rAF
   * effect used to call the module-level `refreshHighlightOverlays` helper
   * directly; that helper is internal now. */
  refreshOverlays(): void {
    refreshHighlightOverlays(this.rendition);
  }

  setMargins(px: number): void {
    // M14: the margin's own pixel value is a CSS var ReaderView writes
    // directly onto the wrapper (`--reader-margin`) — it never touches
    // epub.js, and always been reached this way, not through a renderer
    // call. That write resizes the wrapper, which the ResizeObserver
    // installed in `mount()` already turns into a gap recompute + debounced
    // redisplay on its own (`handleContainerResize`) — nothing to do here
    // beyond bookkeeping the value for `applyGapForWidth`'s own formula.
    this.marginPx = px;
  }

  // ── Highlights / search marks (EPUB-only) ───────────────────────────

  setHighlights(highlights: HighlightWithThread[]): void {
    this.highlights = highlights;
  }

  getRenderedSectionText(sectionIndex: number): string | null {
    if (!this.currentContents || this.currentContents.sectionIndex !== sectionIndex) return null;
    return this.currentContents.document.body.textContent ?? "";
  }

  isLocatorVisible(loc: Locator): boolean {
    if (!this.currentContents || !this.container) return false;
    if (this.currentContents.sectionIndex !== loc.sectionIndex) return false;
    const range = rangeFromTextOffsets(this.currentContents.document, loc.offset, loc.offset + loc.length);
    if (!range) return false;
    const iframeEl = this.currentContents.document.defaultView?.frameElement as HTMLElement | null | undefined;
    if (!iframeEl) return false;
    const iframeRect = iframeEl.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();
    const left = iframeRect.left + rangeRect.left - containerRect.left;
    const right = iframeRect.left + rangeRect.right - containerRect.left;
    const top = iframeRect.top + rangeRect.top - containerRect.top;
    const bottom = iframeRect.top + rangeRect.bottom - containerRect.top;
    return right > 0 && left < containerRect.width && bottom > 0 && top < containerRect.height;
  }

  getViewportRectForSelection(): DOMRect | null {
    return this.lastSelectionViewportRect;
  }

  /** All currently rendered iframe documents (up to two, in spread mode) —
   * EPUB-only: the generic primitive `ReaderView`'s parent-document pointer
   * code (the ink/paper test, "is there a live native selection anywhere")
   * needs, since it has no `contents` of its own to ask. epub.js's own
   * `.d.ts` says `getContents()` returns one `Contents`; the implementation
   * returns an array (one per rendered view). */
  renderedFrames(): { document: Document; frameElement: HTMLElement | null }[] {
    const result = this.rendition?.getContents() as unknown;
    const contentsList: Contents[] = Array.isArray(result) ? (result as Contents[]) : result ? [result as Contents] : [];
    return contentsList.map((c) => ({
      document: c.document,
      frameElement: (c.document.defaultView?.frameElement as HTMLElement | null | undefined) ?? null,
    }));
  }

  clearSearchMarks(): void {
    for (const cfi of this.searchMarkCfis) {
      this.rendition?.annotations.remove(cfi, "highlight");
    }
    this.searchMarkCfis.clear();
  }

  /** `located` is `{index, start, end}` per hit, already resolved against
   * the current section's text (`getRenderedSectionText`) by the caller —
   * this only turns each into a CFI and paints it. */
  paintSearchMarks(located: { index: number; start: number; end: number }[], currentIndex: number): void {
    this.clearSearchMarks();
    if (!this.currentContents || !this.themeVars) return;
    const contents = this.currentContents;
    // ⚠️ Two different hits can resolve to the identical CFI (adjacent or
    // overlapping occurrences) — epub.js creates a second, unreachable
    // orphan mark if `.highlight()` is called twice for one CFI. At most one
    // mark per distinct CFI; the current hit wins the style if it collides
    // with a non-current one. A CFI a real highlight already owns is left
    // alone entirely — `attachOwnedMark` enforces the same rule in the
    // other direction.
    const currentByCfi = new Map<string, boolean>();
    for (const { index, start, end } of located) {
      const range = rangeFromTextOffsets(contents.document, start, end);
      if (!range) continue;
      const cfi = contents.cfiFromRange(range);
      if (this.cfiOwners.has(cfi)) continue;
      const isCurrent = index === currentIndex;
      currentByCfi.set(cfi, isCurrent || (currentByCfi.get(cfi) ?? false));
    }
    for (const [cfi, isCurrent] of currentByCfi) {
      this.searchMarkCfis.add(cfi);
      this.rendition?.annotations.highlight(
        cfi,
        {},
        undefined,
        SEARCH_MARK_CLASS,
        searchMarkStyle(this.themeVars, isCurrent, this.focusModeHidden),
      );
    }
  }

  // ── TOC / locations (EPUB-only) ─────────────────────────────────────

  getToc(): TocEntry[] {
    return this.book ? buildToc(this.book) : [];
  }

  /** Loads cached `book.locations` if this resource has ever generated them,
   * generating (and caching) fresh ones otherwise — resources are
   * immutable-on-import (settled decision 5), so a cached blob can never
   * rot. Resolves once `getToc()`/`currentLocation()`'s book-percent are
   * meaningful. */
  async ensureLocations(): Promise<void> {
    const book = this.book;
    const rendition = this.rendition;
    if (!book || !rendition) return;
    const cached = await fetchCachedLocations(this.resourceId);
    if (this.cancelled) return;
    if (cached) {
      book.locations.load(cached);
      rendition.reportLocation();
      return;
    }
    await book.locations.generate(LOCATIONS_CHAR_STEP);
    if (this.cancelled) return;
    rendition.reportLocation();
    saveCachedLocations(this.resourceId, book.locations.save());
  }

  /** EPUB-only: the progress dial commits a whole-book percent straight to a
   * CFI via `book.locations`, which has no format-neutral equivalent. */
  async goToPercent(percent: number): Promise<void> {
    const book = this.book;
    if (!book || !this.rendition) return;
    const cfi = book.locations.cfiFromPercentage(percent / 100);
    await this.rendition.display(cfi);
  }

  // ── Internals ────────────────────────────────────────────────────────

  /** M19.6 "the skipped last page of a chapter": the element epub.js
   * measures as `container` must be an *integer* pixel width — see
   * PAGE_CURL.md / the original comment history for the sub-pixel-rounding
   * root cause. Measured from `marginWrapper`, never from `container`'s own
   * box — once pinned, `container`'s box no longer reflects the *available*
   * space. */
  private pinContainerWidth(): number {
    const wrapper = this.marginWrapper;
    const container = this.container;
    if (!wrapper || !container) return 0;
    const computed = getComputedStyle(wrapper);
    const horizontalPadding = Number.parseFloat(computed.paddingLeft) + Number.parseFloat(computed.paddingRight);
    const integerWidth = Math.floor(wrapper.clientWidth - horizontalPadding);
    container.style.width = `${integerWidth}px`;
    return integerWidth;
  }

  private applyGapForWidth(width: number): void {
    const rendition = this.rendition;
    if (!rendition) return;
    const manager = (
      rendition as unknown as { manager?: { settings: { gap?: number }; updateLayout?: () => void } }
    ).manager;
    if (!manager) return;
    manager.settings.gap = computeReaderGap(width, this.spreadMode, this.fontScale);
    manager.updateLayout?.();

    window.clearTimeout(this.redisplayTimer);
    this.redisplayTimer = window.setTimeout(() => {
      const settled = this.currentCfi ? rendition.display(this.currentCfi) : Promise.resolve();
      void settled.then(() => refreshHighlightOverlays(rendition));
    }, 120);
  }

  private handleContainerResize(): void {
    const width = this.pinContainerWidth();
    if (Math.abs(width - this.lastGapWidth) < 1) return;
    this.lastGapWidth = width;
    this.applyGapForWidth(width);
  }

  private attachOwnedMark(highlightId: string, cfi: string, kind: HighlightKind): void {
    this.attachedCfi.set(highlightId, cfi);
    const owners = this.cfiOwners.get(cfi) ?? [];
    const alreadyOwned = owners.length > 0;
    if (!owners.includes(highlightId)) owners.push(highlightId);
    this.cfiOwners.set(cfi, owners);
    if (alreadyOwned) return;
    // M24.1 C: epub.js's annotation store is keyed by `cfiRange + type`, and
    // a search mark is type "highlight" too — adding a real highlight on
    // top of a search mark at the identical CFI would evict it, stranding
    // its rect. Take the CFI back first; the search mark is repainted from
    // the result set whenever the bar next changes.
    if (this.searchMarkCfis.has(cfi)) {
      this.rendition?.annotations.remove(cfi, "highlight");
      this.searchMarkCfis.delete(cfi);
    }
    if (!this.themeVars) return;
    this.rendition?.annotations.highlight(
      cfi,
      { highlightId },
      undefined,
      HIGHLIGHT_MARK_CLASS,
      markStyleForKind(kind, this.themeVars, this.focusModeHidden),
    );
  }

  private isMarkOwner(highlightId: string, cfi: string): boolean {
    return this.cfiOwners.get(cfi)?.[0] === highlightId;
  }

  private detachOwnedMark(highlightId: string, cfi: string, remainingHighlights: HighlightWithThread[]): void {
    const owners = this.cfiOwners.get(cfi) ?? [];
    const wasOwner = owners[0] === highlightId;
    const nextOwners = owners.filter((id) => id !== highlightId);

    if (!wasOwner) {
      this.cfiOwners.set(cfi, nextOwners);
      return;
    }

    this.rendition?.annotations.remove(cfi, "highlight");

    if (nextOwners.length === 0) {
      this.cfiOwners.delete(cfi);
      return;
    }

    this.cfiOwners.set(cfi, nextOwners);
    const newOwner = remainingHighlights.find((h) => h.id === nextOwners[0]);
    if (!newOwner || !this.themeVars) return;
    this.rendition?.annotations.highlight(
      cfi,
      { highlightId: newOwner.id },
      undefined,
      HIGHLIGHT_MARK_CLASS,
      markStyleForKind(newOwner.kind, this.themeVars, this.focusModeHidden),
    );
  }

  private markUnanchored(highlightId: string): void {
    this.unanchoredListeners.forEach((cb) => cb(highlightId));
  }

  /** Resolves this section's highlights against its now-rendered document:
   * CFI first, then a prefix/exact/suffix text search, then the stored
   * offset/length, per the anchoring rule (M40 §B, PDF.md §7.3). Each
   * highlight is resolved once — epub.js's Annotations store re-attaches
   * marks to every future render of the same section on its own. */
  private resolveHighlightsForSection(contents: Contents): void {
    const sectionText = contents.document.body.textContent ?? "";
    const candidates = this.highlights.filter(
      (h) => h.spineIndex === contents.sectionIndex && !this.resolvedIds.has(h.id),
    );

    for (const highlight of candidates) {
      this.resolvedIds.add(highlight.id);
      this.markKind.set(highlight.id, highlight.kind);

      const result = resolveAnchor<RangeLike>({
        tryCfi: () => (highlight.cfi ? (contents.range(highlight.cfi) as unknown as RangeLike) : null),
        sectionText,
        anchor: highlight,
        offset: highlight.offset,
        length: highlight.length,
      });

      if (result.status === "cfi" && highlight.cfi) {
        this.attachOwnedMark(highlight.id, highlight.cfi, highlight.kind);
      } else if (result.status === "fallback" || result.status === "offset") {
        const start = result.status === "fallback" ? result.match.start : result.start;
        const end = result.status === "fallback" ? result.match.end : result.end;
        const range = rangeFromTextOffsets(contents.document, start, end);
        if (range) {
          this.attachOwnedMark(highlight.id, contents.cfiFromRange(range), highlight.kind);
        } else {
          this.markUnanchored(highlight.id);
        }
      } else {
        this.markUnanchored(highlight.id);
      }
    }
  }

  /** Idempotent: called on every relocate, and again whenever a section
   * re-paginates under us. The chapter page comes from the container's own
   * geometry (pageTurn.ts), not epub.js's `location.start.displayed`, which
   * loses to sub-pixel `getBoundingClientRect` rounding right at page
   * boundaries. */
  private computeChapterPage(): { page: number; total: number } | null {
    const manager = managerOf(this.rendition);
    if (!manager?.container) return null;
    return chapterPageFromGeometry(readTurnGeometry(manager));
  }

  private handleSectionRepaginated(section: unknown): void {
    const manager = managerOf(this.rendition);
    const index = (section as { index?: number } | null | undefined)?.index;
    if (!manager || typeof index !== "number") return;
    if (index !== shownSectionIndex(manager)) return;
    requestAnimationFrame(() => {
      if (this.cancelled) return;
      const chapterPage = this.computeChapterPage();
      // A re-pagination re-breaks every line in the section, which is
      // exactly when the highlight overlays go stale — epub.js only
      // re-renders the marks pane when the view's *pixel size* changes,
      // which a re-pagination to the same expanded width does not do.
      refreshHighlightOverlays(this.rendition);
      if (chapterPage) {
        this.epubRelocatedListeners.forEach((cb) =>
          cb({ kind: "repaginated", spineIndex: index, cfi: null, atStart: false, atEnd: false, percent: null, chapterPage }),
        );
      }
    });
  }

  private handleRelocated(location: Location): void {
    this.currentCfi = location.start.cfi;
    this.currentSpineIndex = location.start.index;
    const chapterPage = this.computeChapterPage();
    const pct = location.start.percentage;

    this.epubRelocatedListeners.forEach((cb) =>
      cb({
        kind: "relocated",
        spineIndex: location.start.index,
        cfi: location.start.cfi,
        atStart: Boolean(location.atStart),
        atEnd: Boolean(location.atEnd),
        percent: typeof pct === "number" ? pct : null,
        chapterPage,
      }),
    );

    this.emit("relocated", {
      locator: { sectionIndex: location.start.index, offset: 0, length: 0, cfi: location.start.cfi },
      bookPercent: typeof pct === "number" ? Math.round(pct * 100) : null,
      sectionPercent: chapterPage ? chapterPage.page / chapterPage.total : 0,
    });
  }

  private handleRendered(_section: unknown, view: unknown): void {
    const contents = (view as ViewWithContents).contents;
    if (!contents) return;
    this.currentContents = contents;
    this.resolveHighlightsForSection(contents);
    this.sectionRenderedListeners.forEach((cb) => cb({ document: contents.document, sectionIndex: contents.sectionIndex }));

    // The section's fonts may still be loading; when they land, the text
    // re-breaks at the same expanded width and every overlay in it is
    // silently left behind.
    void contents.document.fonts?.ready.then(() => {
      refreshHighlightOverlays(this.rendition);
    });
  }

  private handleSelected(cfiRange: string, contents: Contents): void {
    const selection = contents.window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;
    const exact = range.toString();
    if (!exact.trim()) return;

    const { prefix, suffix } = getSelectionContext(contents.document, range, SELECTION_CONTEXT_MAX_LEN);

    const iframeEl = contents.document.defaultView?.frameElement as HTMLElement | null | undefined;
    if (iframeEl) {
      const iframeRect = iframeEl.getBoundingClientRect();
      const rangeRect = range.getBoundingClientRect();
      this.lastSelectionViewportRect = new DOMRect(
        iframeRect.left + rangeRect.left,
        iframeRect.top + rangeRect.top,
        rangeRect.width,
        rangeRect.height,
      );
    } else {
      this.lastSelectionViewportRect = null;
    }

    this.emit("selected", {
      text: exact,
      prefix,
      suffix,
      locator: { sectionIndex: contents.sectionIndex, offset: 0, length: 0, cfi: cfiRange },
    });
  }
}
