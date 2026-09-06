/**
 * M40 §D / M41 §A2/§C1 (PDF.md §7.2, §7.5, §7.6, §4): the pdf.js
 * implementation of `ResourceRenderer` — the native, fixed-page PDF surface,
 * distinct from `EpubRenderer`'s reflowable one.
 *
 * Every pdfjs-dist import in the app lives here.
 *
 * Two coordinate systems, chosen per resource by `hasSectionData`:
 *
 * - **Section-aware** (the common case for anything imported after
 *   migration 44): `/pdf-sections` gives a page->section table and
 *   `/text-sections` gives each section's canonical `resource_text`, both
 *   built at import from the exact same boundary detection
 *   (`buildSectionsWithPageIndex`, server-side). A `Locator`'s
 *   `(sectionIndex, offset, length)` is always a slice of that canonical
 *   text — never pdf.js's own raw per-page text, which differs from it in
 *   general (headers/footers stripped, columns reordered, hyphens
 *   rejoined). Resolving a stored Locator against the *currently rendered
 *   page* therefore goes through a **text search** (`findAnchorInText`,
 *   the same primitive `resolveAnchor`'s fallback step already uses) —
 *   reconstruct the quote from the canonical text, then find it in the
 *   page's own raw text — rather than trusting the offset as a raw index
 *   into anything pdf.js produced. This is what makes a highlight "shared
 *   between reflow and native" (M41 §A2): both panes resolve the same
 *   Locator against the same `resource_text`, just through different live
 *   text.
 * - **Legacy fallback** (a PDF imported before migration 44, or a fetch
 *   failure — degrades, never throws): the whole document is section 0 and
 *   offsets are raw pdf.js text, cumulative across pages
 *   (`pageOffsets`/`pageTexts`) — M40 §D's original, simpler behaviour,
 *   preserved exactly so an un-migrated PDF keeps working within native
 *   mode itself (cross-mode sharing just isn't available for it).
 *
 * M41 §C1 (PDF.md §7.6) adds adaptive layout on top of the above: one or
 * two pages can be mounted at once (`pageMounts`, keyed by page index,
 * replacing a single page's worth of DOM state), and — once the reader
 * zooms in past the active fit mode's own scale — a fully continuous
 * scrollable column takes over instead of discrete pages. Every method that
 * used to read a single `pageDiv`/`textLayerDiv`/mark-bookkeeping field now
 * operates over whichever entries of `pageMounts` are currently live; a
 * highlight resolves independently against each mounted page (never spans
 * two), which is what makes highlight/tint/search-mark painting correct
 * under spread or continuous layout with no extra bookkeeping — they
 * already re-derive their `Range` from the live text-layer DOM on every
 * call rather than caching pixel positions.
 *
 * SPEC-GAP, carried over from M40 §D and only partly closed here: a page
 * whose section starts partway down it is assigned to the section active at
 * its own *top* (`buildSectionsWithPageIndex`, server-side) — a highlight
 * in the sliver below the heading on that page anchors to the earlier
 * section. See `docs/marginalia/NOTES.md`.
 *
 * SPEC-GAP: `onUnanchored` never fires. Detecting "genuinely unresolvable
 * anywhere in its section" would mean checking every page of a (possibly
 * large) section before giving up, rather than just the current page a
 * real highlight was or wasn't resolved against — not attempted this
 * milestone. A native-mode highlight that can't be found is simply not
 * painted; the margin rail's distinct "unanchored" styling never applies to
 * it.
 */
import { GlobalWorkerOptions, getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
// M41 §A1, found live: pdf.js refuses to run at all without this — "No
// GlobalWorkerOptions.workerSrc specified" — thrown from inside
// getDocument() before it ever touches the bytes. Never surfaced in this
// file's own tests (jsdom's `getDocument` doesn't reach the worker-creation
// path the way a real browser does) or in M40 §D, which was headless and
// never actually mounted in one. `?url` is Vite's own asset-URL import
// suffix — it resolves to a real fetchable path in both dev and the built
// bundle, unlike a bare `import.meta.url` construction, which resolves
// against *this* file's URL rather than the worker's own.
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";

// Vitest's own module graph resolves the `?url` import to a real absolute
// path, but pdf.js's fake-worker fallback then tries to `import()` that path
// directly and fails (no such loader outside a real browser/Vite runtime) —
// and unlike the browser, pdf.js quietly runs workerless under jsdom without
// ever needing this assigned, which is what every test here already relies
// on. `import.meta.env.VITEST` is Vitest's own standard flag for telling the
// two apart (https://vitest.dev — set automatically, not project config).
if (!import.meta.env?.VITEST) {
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}
import type { HighlightKind, HighlightWithThread } from "@marginalia/shared";
import { findAnchorInText } from "@marginalia/shared";
import { getSelectionContext, offsetsForRange, rangeFromTextOffsets } from "../../selectionContext.js";
import { audioTintStyle, markStyleForKind, searchMarkStyle } from "../../highlightKinds.js";
import { scrollProgressFromGeometry } from "../../pageTurn.js";
import type { TocEntry } from "../epub/toc.js";
import type {
  Locator,
  ReaderThemeVars,
  RendererCapabilities,
  RendererEvents,
  RendererOptions,
  ResourceRenderer,
} from "../types.js";
import {
  clampZoomScale,
  computeFitScale,
  shouldShowSpread,
  ZOOM_STEP,
  type FitMode,
} from "./pdfLayout.js";

const TEXT_LAYER_CLASS = "marginalia-pdf-text-layer";
const MARK_CLASS = "marginalia-pdf-highlight";
const TINT_CLASS = "marginalia-pdf-audio-tint";
const SEARCH_MARK_CLASS = "marginalia-pdf-search-mark";
const SELECTION_CONTEXT_MAX_LEN = 64;
// M41 §C1's fallback for a container jsdom (or a not-yet-laid-out real
// browser frame) reports as zero-sized — `computeFitScale` would otherwise
// divide by zero into a scale of 0 (an invisible page). Matches the old,
// pre-§C1 hardcoded `RENDER_SCALE`, so every existing test that never mocks
// element geometry keeps rendering at the same pixel size it always did.
const FALLBACK_SCALE = 1.5;
// Below this, `userScale` is treated as "back at the active fit mode's own
// scale" rather than a real, still-zoomed-in override — sub-pixel float
// drift from repeated zoomIn/zoomOut multiplication/division must not leave
// a view permanently a hair off from snapping back to paginated.
const ZOOM_EPSILON = 0.005;
// One extra viewport of slack above/below the visible area, in continuous
// mode, before a mounted page is torn back down to a placeholder — keeps a
// small scroll from constantly promoting/demoting the same page.
const CONTINUOUS_BUFFER_VIEWPORTS = 1;

// Narrow, local shapes for what this file uses from pdfjs-dist's proxies —
// same pattern as server/src/library/pdf/extract.ts, which keeps the
// pdfjs-dist type surface confined to the file that actually touches it.
interface PdfjsTextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}
interface PdfjsViewport {
  width: number;
  height: number;
  transform: number[];
}
interface PdfjsPage {
  getViewport(params: { scale: number }): PdfjsViewport;
  getTextContent(): Promise<{ items: (PdfjsTextItem | Record<string, unknown>)[] }>;
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: PdfjsViewport }): { promise: Promise<void> };
}
interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
}

function isTextItem(item: PdfjsTextItem | Record<string, unknown>): item is PdfjsTextItem {
  return typeof (item as PdfjsTextItem).str === "string" && Array.isArray((item as PdfjsTextItem).transform);
}

/** Matches `buildTextLayer`'s own per-item text exactly — `hasEOL` becomes a
 * real `"\n"` character in both, so an offset computed against one text
 * always lands on the same character in the other. */
function textOfItems(items: (PdfjsTextItem | Record<string, unknown>)[]): string {
  return items.map((item) => (isTextItem(item) ? item.str + (item.hasEOL ? "\n" : "") : "")).join("");
}

type Listener<T> = (arg: T) => void;

/** A highlight reduced to what either resolution strategy needs — never the
 * full `HighlightWithThread` (thread/tag/note fields this file never
 * touches). `offset`/`length` are only meaningful in the legacy (no
 * section data) coordinate system; `exact`/`prefix`/`suffix` are only used
 * in the section-aware one. Both are carried so `resolveAndPaintPage`
 * can pick whichever the resource actually has. */
interface ResolvableHighlight {
  id: string;
  exact: string;
  prefix: string;
  suffix: string;
  spineIndex: number;
  kind: HighlightKind;
  offset: number | null;
  length: number | null;
}

/** M41 §C1: everything a single mounted page needs — replaces what used to
 * be five singular fields (`pageDiv`/`textLayerDiv`/`pinnedMarkEls`/
 * `searchMarkEls`/`tintEl`) now that 1-2 pages (spread) or several
 * (continuous scroll) can be live at once, keyed by page index in
 * `pageMounts`. */
interface PageMount {
  pageDiv: HTMLElement;
  textLayerDiv: HTMLElement;
  pinnedMarkEls: Map<string, HTMLElement>;
  searchMarkEls: Set<HTMLElement>;
  tintEl: HTMLElement | null;
}

/**
 * Positions one absolutely-positioned box per client rect a Range spans
 * (PDF.md §7.5: "client rects from the text-layer Range → absolutely
 * positioned divs. `marks-pane` is CFI-keyed and is not reused here") —
 * `wrapper` itself covers the whole page 1:1 with `pageDiv` (so its
 * children's coordinates, measured from `pageDiv`'s own rect, need no
 * further translation) and is never the click/hover target itself.
 */
function paintRangeInto(wrapper: HTMLElement, range: Range, pageDiv: HTMLElement, attrs?: Record<string, string>): void {
  wrapper.replaceChildren();
  const pageRect = pageDiv.getBoundingClientRect();
  for (const rect of Array.from(range.getClientRects())) {
    const box = document.createElement("div");
    box.style.position = "absolute";
    box.style.left = `${rect.left - pageRect.left}px`;
    box.style.top = `${rect.top - pageRect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
    box.style.pointerEvents = "auto";
    // The fill belongs on each line-rect box, not on `wrapper` — `wrapper`
    // spans the whole page (`inset: 0`) purely as these boxes' positioning
    // context, so painting it directly tints the entire page instead of
    // just the matched text (found live, M41 §A2 follow-up).
    if (attrs) applyMarkAttrs(box, attrs);
    wrapper.appendChild(box);
  }
}

/** Translates `markStyleForKind`'s SVG presentation-attribute map (built for
 * marks-pane's `setAttribute`-only channel, see highlightKinds.ts) into the
 * plain CSS these boxes actually need — same colours/opacities, no
 * duplicated logic. */
function applyMarkAttrs(el: HTMLElement, attrs: Record<string, string>): void {
  el.style.backgroundColor = attrs.fill ?? "transparent";
  el.style.opacity = attrs["fill-opacity"] ?? "1";
  const blend = /mix-blend-mode:\s*([a-z]+)/.exec(attrs.style ?? "");
  el.style.mixBlendMode = blend?.[1] ?? "normal";
}

/**
 * M40 §D / M41 §A2/§C1: the second `ResourceRenderer` implementation.
 * `capabilities` starts per PDF.md §7.5's table and now changes at runtime
 * (§7.6) as the reader zooms past the active fit mode's own scale.
 */
export class PdfRenderer implements ResourceRenderer {
  capabilities: RendererCapabilities = {
    spread: false,
    fontScale: false,
    margins: false,
    pageFold: false,
    pageNumbers: false,
    textSelection: true,
    zoom: true,
    advance: "image",
  };

  private container: HTMLElement | null = null;
  private doc: PdfjsDocument | null = null;
  private themeVars: ReaderThemeVars | null = null;
  private focusModeHidden = false;

  private pageIndex = 0;

  /** Legacy (no section data) coordinate system — cumulative char offset /
   * raw text of each page, built once at mount by concatenating every
   * page's own `getTextContent()`, whole document as section 0. */
  private pageOffsets: number[] = [];
  private pageTexts: string[] = [];
  /** Each page's own scale:1 viewport size — M41 §C1's spread/fit-scale
   * math needs this per page (real PDFs mix page sizes), collected in the
   * same eager per-page walk `buildPageTexts` already does. */
  private naturalPageSizes: { width: number; height: number }[] = [];

  /** Section-aware coordinate system — see the class comment. Empty when
   * the resource predates migration 44 or a fetch failed; `hasSectionData`
   * is false in exactly that case and every method below falls back to the
   * legacy system instead. */
  private pageSectionIndex: number[] = [];
  private sectionPageList = new Map<number, number[]>();
  private sectionTexts = new Map<number, string>();
  private sectionHrefs = new Map<number, string>();
  private sectionTitles = new Map<number, string>();
  private sectionStartOffset = new Map<number, number>();
  private totalCanonicalLength = 0;

  private get hasSectionData(): boolean {
    return this.pageSectionIndex.length > 0 && this.sectionTexts.size > 0;
  }

  // ── M41 §C1: layout/zoom state ───────────────────────────────────────
  private fitMode: FitMode = "fit-width";
  /** `null` = tracking the active fit mode's own live scale. Non-null = the
   * reader has stepped away via `zoomIn`/`zoomOut`, past which the view
   * becomes continuous scroll (`relayout`'s own rule, PDF.md §7.6). */
  private userScale: number | null = null;
  private currentFitScale = FALLBACK_SCALE;
  private effectiveScale = FALLBACK_SCALE;
  private pagesAcross: 1 | 2 = 1;
  private resizeObserver: ResizeObserver | null = null;
  /** Bumped on every `relayout()` call — async page-render work captures it
   * at start and bails (touching neither `pageMounts` nor the DOM) if it's
   * changed by the time an `await` resolves, so a resize/zoom spam can never
   * race two renders into the same container or paint a mark into an
   * already-discarded `pageDiv`. */
  private renderGeneration = 0;
  private pageMounts = new Map<number, PageMount>();
  private layoutListeners = new Set<Listener<void>>();

  // ── M41 §C1: continuous-scroll state (non-null only while
  // capabilities.advance === "scroll") ─────────────────────────────────
  private scrollHost: HTMLElement | null = null;
  private continuousSlots: HTMLElement[] = [];
  private continuousRafHandle: number | null = null;
  private handleContinuousScroll = (): void => {
    if (this.continuousRafHandle !== null) return;
    this.continuousRafHandle = requestAnimationFrame(() => {
      this.continuousRafHandle = null;
      void this.syncContinuousWindow();
    });
  };

  private highlights: ResolvableHighlight[] = [];
  private tintTarget: Locator | null = null;
  private lastSelectionViewportRect: DOMRect | null = null;
  /** `sectionEnd` fires once per arrival at the last page *of the current
   * section* (or the document, in the legacy system) — re-rendering the
   * same page (e.g. a theme change) must not re-fire it. */
  private sectionEndFired = false;
  private cancelled = false;

  private eventListeners: { [K in keyof RendererEvents]?: Set<Listener<Parameters<RendererEvents[K]>[0]>> } = {};

  async mount(container: HTMLElement, resource: { id: string }, _opts: RendererOptions): Promise<void> {
    this.container = container;
    const [pdfRes, textSectionsRes, pageSectionsRes, resourceRes] = await Promise.all([
      fetch(`/api/resources/${resource.id}/pdf-source`),
      fetch(`/api/resources/${resource.id}/text-sections`).catch(() => null),
      fetch(`/api/resources/${resource.id}/pdf-sections`).catch(() => null),
      fetch(`/api/resources/${resource.id}`).catch(() => null),
    ]);
    const data = new Uint8Array(await pdfRes.arrayBuffer());
    this.doc = (await getDocument({ data }).promise) as unknown as PdfjsDocument;
    if (this.cancelled) return;

    await this.loadSectionData(textSectionsRes, pageSectionsRes, resourceRes);
    if (this.cancelled) return;

    await this.buildPageTexts();
    if (this.cancelled) return;
    await this.relayout();
    if (this.cancelled) return;

    // jsdom has no ResizeObserver at all — degrades to "no live resize
    // reactivity", same "degrades, never throws" rule this file's own
    // canvas-context fallback already follows. The initial `relayout()`
    // above already ran regardless, so every test keeps working exactly as
    // before this landed.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => void this.relayout());
      this.resizeObserver.observe(container);
    }
  }

  /** Populates the section-aware coordinate system — degrades silently
   * (leaving `hasSectionData` false) on any missing/malformed response,
   * same "degrades, never fails" rule `rasterize.ts` and this file's own
   * canvas-context fallback already follow. */
  private async loadSectionData(
    textSectionsRes: Response | null,
    pageSectionsRes: Response | null,
    resourceRes: Response | null,
  ): Promise<void> {
    try {
      if (textSectionsRes?.ok) {
        const sections = (await textSectionsRes.json()) as { spineIndex: number; href: string; text: string }[];
        let cumulative = 0;
        for (const s of [...sections].sort((a, b) => a.spineIndex - b.spineIndex)) {
          this.sectionTexts.set(s.spineIndex, s.text);
          this.sectionHrefs.set(s.spineIndex, s.href);
          this.sectionStartOffset.set(s.spineIndex, cumulative);
          cumulative += s.text.length;
        }
        this.totalCanonicalLength = cumulative;
      }
    } catch {
      // no canonical text available — stays in the legacy system.
    }

    try {
      if (pageSectionsRes?.ok) {
        const pageSections = (await pageSectionsRes.json()) as number[];
        if (pageSections.length > 0) {
          this.pageSectionIndex = pageSections;
          pageSections.forEach((section, page) => {
            const list = this.sectionPageList.get(section) ?? [];
            list.push(page);
            this.sectionPageList.set(section, list);
          });
        }
      }
    } catch {
      // no page->section table — stays in the legacy system.
    }

    try {
      if (resourceRes?.ok) {
        const json = (await resourceRes.json()) as { metadata?: { chapterTitles?: Record<string, string> } };
        const chapterTitles = json.metadata?.chapterTitles ?? {};
        for (const sectionIndex of this.sectionTexts.keys()) {
          this.sectionTitles.set(sectionIndex, chapterTitles[String(sectionIndex)] ?? `Section ${sectionIndex + 1}`);
        }
      }
    } catch {
      // titles fall back to "Section N" per entry in getToc().
    }
  }

  destroy(): void {
    this.cancelled = true;
    this.renderGeneration++;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.teardownContinuous();
    this.container?.replaceChildren();
    this.container = null;
    this.doc = null;
    this.pageMounts = new Map();
  }

  private async buildPageTexts(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const offsets: number[] = [];
    const texts: string[] = [];
    const naturalSizes: { width: number; height: number }[] = [];
    let cumulative = 0;
    for (let i = 0; i < doc.numPages; i++) {
      offsets.push(cumulative);
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      const text = textOfItems(content.items);
      texts.push(text);
      cumulative += text.length;
      const natural = page.getViewport({ scale: 1 });
      naturalSizes.push({ width: natural.width, height: natural.height });
    }
    this.pageOffsets = offsets;
    this.pageTexts = texts;
    this.naturalPageSizes = naturalSizes;
  }

  private pageIndexForOffset(offset: number): number {
    let index = 0;
    for (let i = 0; i < this.pageOffsets.length; i++) {
      if (this.pageOffsets[i] <= offset) index = i;
    }
    return index;
  }

  /** Null (rather than `Infinity`) only ever means "past the last page" —
   * every real page has a defined length once `pageOffsets` is built. */
  private pageLength(pageIndex: number): number {
    const next = this.pageOffsets[pageIndex + 1];
    return next !== undefined ? next - this.pageOffsets[pageIndex] : Number.POSITIVE_INFINITY;
  }

  private sectionForPage(pageIndex: number): number {
    return this.hasSectionData ? (this.pageSectionIndex[pageIndex] ?? 0) : 0;
  }

  /** Canonical-text offset estimate for the *start* of `pageIndex` within
   * its own section — proportional (this page's rank among its section's
   * pages, times the section's text length), not exact: nothing ties a
   * page's raw text length to its canonical-text share of the section. Good
   * enough for a progress readout and a mode-switch handoff; not claimed to
   * be more than that. */
  private estimateSectionOffset(pageIndex: number): number {
    const section = this.sectionForPage(pageIndex);
    const pages = this.sectionPageList.get(section);
    if (!pages || pages.length === 0) return 0;
    const rank = pages.indexOf(pageIndex);
    const sectionLen = this.sectionTexts.get(section)?.length ?? 0;
    return rank <= 0 ? 0 : Math.round((rank / pages.length) * sectionLen);
  }

  private bookPercentForPage(pageIndex: number): number | null {
    const doc = this.doc;
    if (!doc) return null;
    if (this.hasSectionData && this.totalCanonicalLength > 0) {
      const section = this.sectionForPage(pageIndex);
      const sectionStart = this.sectionStartOffset.get(section) ?? 0;
      const offsetInSection = this.estimateSectionOffset(pageIndex);
      return Math.min(1, (sectionStart + offsetInSection) / this.totalCanonicalLength);
    }
    return doc.numPages > 1 ? pageIndex / (doc.numPages - 1) : 0;
  }

  // ── Navigation ────────────────────────────────────────────────────────

  async goTo(loc: Locator): Promise<void> {
    if (this.hasSectionData) {
      const pages = this.sectionPageList.get(loc.sectionIndex);
      if (pages && pages.length > 0) {
        const text = this.sectionTexts.get(loc.sectionIndex) ?? "";
        const quote = loc.length > 0 ? text.slice(loc.offset, loc.offset + loc.length) : "";
        if (quote) {
          for (const p of pages) {
            if (findAnchorInText(this.pageTexts[p] ?? "", { exact: quote, prefix: "", suffix: "" })) {
              await this.renderPage(p);
              return;
            }
          }
        }
        // Not found live (or nothing to search for, e.g. a bare "start of
        // section" jump) — a proportional pick within the section's own
        // page range, same honesty as estimateSectionOffset's own comment.
        const frac = text.length > 0 ? loc.offset / text.length : 0;
        const idx = Math.min(pages.length - 1, Math.max(0, Math.round(frac * (pages.length - 1))));
        await this.renderPage(pages[idx]);
        return;
      }
    }
    await this.renderPage(this.pageIndexForOffset(loc.offset));
  }

  /** EPUB-only-named but format-neutral in shape — see `EpubRenderer`'s own
   * comment on why it exists apart from `goTo`. Trivial here since `goTo`
   * already handles a cross-section jump on its own (no "must already be
   * rendered" limitation epub.js's `display(cfi)` step has). */
  async goToSpineIndex(index: number): Promise<void> {
    await this.goTo({ sectionIndex: index, offset: 0, length: 0 });
  }

  async goToHref(href: string): Promise<void> {
    for (const [sectionIndex, sectionHref] of this.sectionHrefs) {
      if (sectionHref === href) {
        await this.goTo({ sectionIndex, offset: 0, length: 0 });
        return;
      }
    }
  }

  async goToPercent(percent: number): Promise<void> {
    if (!this.hasSectionData || this.totalCanonicalLength <= 0) {
      const doc = this.doc;
      if (!doc) return;
      const idx = Math.min(doc.numPages - 1, Math.max(0, Math.round((percent / 100) * (doc.numPages - 1))));
      await this.renderPage(idx);
      return;
    }
    const targetOffset = (percent / 100) * this.totalCanonicalLength;
    let targetSection = 0;
    let targetSectionStart = 0;
    for (const [sectionIndex, start] of [...this.sectionStartOffset.entries()].sort((a, b) => a[1] - b[1])) {
      if (start > targetOffset) break;
      targetSection = sectionIndex;
      targetSectionStart = start;
    }
    await this.goTo({ sectionIndex: targetSection, offset: Math.round(targetOffset - targetSectionStart), length: 0 });
  }

  async next(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    if (this.capabilities.advance === "scroll") {
      this.scrollHost?.scrollBy({ top: this.scrollHost.clientHeight * 0.9, behavior: "auto" });
      return;
    }
    const step = this.pagesAcross === 2 ? 2 : 1;
    if (this.pageIndex + step > doc.numPages - 1) {
      this.emitSectionEndOnce();
      return;
    }
    await this.renderPage(this.pageIndex + step);
  }

  async prev(): Promise<void> {
    if (this.capabilities.advance === "scroll") {
      this.scrollHost?.scrollBy({ top: -(this.scrollHost.clientHeight * 0.9), behavior: "auto" });
      return;
    }
    if (this.pageIndex <= 0) return;
    const step = this.pagesAcross === 2 ? 2 : 1;
    await this.renderPage(Math.max(0, this.pageIndex - step));
  }

  currentLocation(): Locator | null {
    if (!this.doc) return null;
    if (this.hasSectionData) {
      return {
        sectionIndex: this.sectionForPage(this.pageIndex),
        offset: this.estimateSectionOffset(this.pageIndex),
        length: 0,
      };
    }
    return { sectionIndex: 0, offset: this.pageOffsets[this.pageIndex] ?? 0, length: 0 };
  }

  // ── Events ────────────────────────────────────────────────────────────

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

  private emitSectionEndOnce(): void {
    if (this.sectionEndFired) return;
    this.sectionEndFired = true;
    this.emit("sectionEnd", undefined as never);
  }

  /** A highlight `resolveAndPaintPage` could not place — never fired (see
   * the class comment's SPEC-GAP). Registered so `ReaderView` can subscribe
   * uniformly across both renderers without an `instanceof` check. */
  onUnanchored(_cb: Listener<string>): () => void {
    return () => {};
  }

  /** M41 §C1 (PDF.md §7.6): the PDF-only readout for the zoom control
   * cluster — not on the shared `ResourceRenderer` interface, same reasoning
   * as `onEpubRelocated`/`onSectionRendered`: a seam member only earns its
   * place once a second implementation needs it too, and EPUB has no zoom
   * concept (`capabilities.zoom` is permanently false there). Fires
   * whenever `relayout()` finishes — a resize, a zoom action, a fit-mode
   * change — so `ReaderView` can re-read `capabilities`/`getZoomMode`/
   * `getZoomPercent` fresh; `capabilities` itself is otherwise only read
   * once, at mount, by the chrome. */
  onLayoutChanged(cb: Listener<void>): () => void {
    this.layoutListeners.add(cb);
    return () => this.layoutListeners.delete(cb);
  }

  private emitLayoutChanged(): void {
    this.layoutListeners.forEach((cb) => cb());
  }

  getZoomMode(): "fit-width" | "fit-page" | "free" {
    return this.userScale === null ? this.fitMode : "free";
  }

  getZoomPercent(): number {
    return Math.round(this.effectiveScale * 100);
  }

  // ── Marks ────────────────────────────────────────────────────────────

  private upsertHighlight(entry: ResolvableHighlight): void {
    const idx = this.highlights.findIndex((h) => h.id === entry.id);
    if (idx >= 0) this.highlights[idx] = entry;
    else this.highlights.push(entry);
  }

  /** The trusted, just-created-from-a-live-selection path (mirrors
   * `EpubRenderer.paintMark`'s own role) — distinct from `setHighlights`,
   * which resolves a whole loaded list. Reconstructs a searchable quote
   * from the canonical section text when one is available; in the legacy
   * system there is no quote to reconstruct, so the entry carries the raw
   * offset/length instead and resolves numerically. */
  paintMark(highlightId: string, loc: Locator, kind: HighlightKind): void {
    if (this.hasSectionData) {
      const text = this.sectionTexts.get(loc.sectionIndex) ?? "";
      const exact = text.slice(loc.offset, loc.offset + loc.length);
      this.upsertHighlight({ id: highlightId, exact, prefix: "", suffix: "", spineIndex: loc.sectionIndex, kind, offset: null, length: null });
    } else {
      this.upsertHighlight({ id: highlightId, exact: "", prefix: "", suffix: "", spineIndex: 0, kind, offset: loc.offset, length: loc.length });
    }
    this.resolveAndPaintCurrentPage();
  }

  removeMark(highlightId: string): void {
    this.highlights = this.highlights.filter((h) => h.id !== highlightId);
    for (const mount of this.pageMounts.values()) {
      const el = mount.pinnedMarkEls.get(highlightId);
      if (el) {
        el.remove();
        mount.pinnedMarkEls.delete(highlightId);
      }
    }
  }

  /** M41 §A2: the bulk-resolve path `EpubRenderer.setHighlights` mirrors —
   * a full loaded list, re-resolved against whichever page(s) are currently
   * mounted (and again on every future render, since a PDF page's DOM is
   * ephemeral — `renderPaginated`/`syncContinuousWindow` call this
   * themselves). */
  setHighlights(highlights: HighlightWithThread[]): void {
    this.highlights = highlights.map((h) => ({
      id: h.id,
      exact: h.exact,
      prefix: h.prefix,
      suffix: h.suffix,
      spineIndex: h.spineIndex,
      kind: h.kind,
      offset: h.offset,
      length: h.length,
    }));
    this.resolveAndPaintCurrentPage();
  }

  private paintOneMark(mount: PageMount, id: string, kind: HighlightKind, range: Range): void {
    let el = mount.pinnedMarkEls.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = MARK_CLASS;
      el.dataset.highlightId = id;
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.pointerEvents = "none";
      el.addEventListener("click", () => this.emit("markClicked", id));
      mount.pinnedMarkEls.set(id, el);
    }
    const attrs = this.themeVars ? markStyleForKind(kind, this.themeVars, this.focusModeHidden) : undefined;
    paintRangeInto(el, range, mount.pageDiv, attrs);
    if (!el.isConnected) mount.pageDiv.insertBefore(el, mount.textLayerDiv);
  }

  /** Resolves every pinned highlight against every currently-mounted page —
   * called after every fresh render (a fresh DOM per mount), and again
   * after `setHighlights`/`paintMark`/`applyTheme`/`setFocusMode` touch
   * state that could change what's resolvable or how it should look. A
   * highlight resolves independently per page (never spans two), so
   * iterating every mount is always safe regardless of single/spread/
   * continuous layout. */
  private resolveAndPaintCurrentPage(): void {
    for (const [pageIndex, mount] of this.pageMounts) {
      this.resolveAndPaintPage(pageIndex, mount);
    }
  }

  private resolveAndPaintPage(pageIndex: number, mount: PageMount): void {
    const stillPresent = new Set<string>();

    if (this.hasSectionData) {
      const currentSection = this.sectionForPage(pageIndex);
      const pageText = this.pageTexts[pageIndex] ?? "";
      for (const h of this.highlights) {
        if (h.spineIndex !== currentSection || !h.exact) continue;
        const match = findAnchorInText(pageText, h);
        if (!match) continue;
        const range = rangeFromTextOffsets(mount.textLayerDiv, match.start, match.end);
        if (!range) continue;
        stillPresent.add(h.id);
        this.paintOneMark(mount, h.id, h.kind, range);
      }
    } else {
      const pageStart = this.pageOffsets[pageIndex] ?? 0;
      const pageLen = this.pageLength(pageIndex);
      for (const h of this.highlights) {
        if (h.spineIndex !== 0 || h.offset == null || h.length == null) continue;
        const localStart = h.offset - pageStart;
        const localEnd = localStart + h.length;
        if (localStart < 0 || localEnd > pageLen) continue;
        const range = rangeFromTextOffsets(mount.textLayerDiv, localStart, localEnd);
        if (!range) continue;
        stillPresent.add(h.id);
        this.paintOneMark(mount, h.id, h.kind, range);
      }
    }

    for (const [id, el] of mount.pinnedMarkEls) {
      if (!stillPresent.has(id)) {
        el.remove();
        mount.pinnedMarkEls.delete(id);
      }
    }
  }

  /** Mirrors `EpubRenderer`'s own convention: the *first* line box of a
   * (possibly multi-line) mark, not their union. Searches every mounted
   * page — a highlight lives on exactly one, but which one isn't known
   * ahead of time under spread/continuous layout. */
  markRect(highlightId: string): DOMRect | null {
    for (const mount of this.pageMounts.values()) {
      const el = mount.pinnedMarkEls.get(highlightId);
      if (!el?.isConnected) continue;
      const box = el.firstElementChild;
      if (box) return box.getBoundingClientRect();
    }
    return null;
  }

  setTint(loc: Locator | null): void {
    this.tintTarget = loc;
    this.paintTintForCurrentPage();
  }

  private paintTintForCurrentPage(): void {
    for (const [pageIndex, mount] of this.pageMounts) {
      this.paintTintForPage(pageIndex, mount);
    }
  }

  private paintTintForPage(pageIndex: number, mount: PageMount): void {
    if (mount.tintEl) {
      mount.tintEl.remove();
      mount.tintEl = null;
    }
    const loc = this.tintTarget;
    if (!loc) return;
    if (this.sectionForPage(pageIndex) !== loc.sectionIndex) return;

    let range: Range | null = null;
    if (this.hasSectionData) {
      const text = this.sectionTexts.get(loc.sectionIndex) ?? "";
      const quote = text.slice(loc.offset, loc.offset + loc.length);
      if (quote) {
        const match = findAnchorInText(this.pageTexts[pageIndex] ?? "", { exact: quote, prefix: "", suffix: "" });
        if (match) range = rangeFromTextOffsets(mount.textLayerDiv, match.start, match.end);
      }
    } else {
      const pageStart = this.pageOffsets[pageIndex] ?? 0;
      const localStart = loc.offset - pageStart;
      const localEnd = localStart + loc.length;
      if (localStart >= 0 && localEnd <= this.pageLength(pageIndex)) {
        range = rangeFromTextOffsets(mount.textLayerDiv, localStart, localEnd);
      }
    }
    if (!range) return;

    const el = document.createElement("div");
    el.className = TINT_CLASS;
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.pointerEvents = "none";
    const attrs = this.themeVars ? audioTintStyle(this.themeVars, this.focusModeHidden) : undefined;
    paintRangeInto(el, range, mount.pageDiv, attrs);
    mount.pageDiv.insertBefore(el, mount.textLayerDiv);
    mount.tintEl = el;
  }

  /** B2 (PDF.md §7.5): "text search against `resource_text` with text-layer
   * rect painting". `located` entries are offsets into whatever
   * `getRenderedSectionText` returned for the current page — `ReaderView`
   * locates hits against that same string before calling this, exactly as
   * it does for `EpubRenderer`. Paints only onto the current page's own
   * mount, matching `getRenderedSectionText`'s own single-page scope. */
  paintSearchMarks(located: { index: number; start: number; end: number }[], currentIndex: number): void {
    this.clearSearchMarks();
    const mount = this.pageMounts.get(this.pageIndex);
    if (!mount || !this.themeVars) return;
    for (const { index, start, end } of located) {
      const range = rangeFromTextOffsets(mount.textLayerDiv, start, end);
      if (!range) continue;
      const el = document.createElement("div");
      el.className = SEARCH_MARK_CLASS;
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.pointerEvents = "none";
      paintRangeInto(el, range, mount.pageDiv, searchMarkStyle(this.themeVars, index === currentIndex));
      mount.pageDiv.insertBefore(el, mount.textLayerDiv);
      mount.searchMarkEls.add(el);
    }
  }

  clearSearchMarks(): void {
    for (const mount of this.pageMounts.values()) {
      for (const el of mount.searchMarkEls) el.remove();
      mount.searchMarkEls.clear();
    }
  }

  /** Which section's text the *currently rendered page* holds — null for
   * any other section. B2/B3 both read this to know whether there's
   * anything to search on screen right now. */
  getRenderedSectionText(sectionIndex: number): string | null {
    if (this.sectionForPage(this.pageIndex) !== sectionIndex) return null;
    return this.pageTexts[this.pageIndex] ?? "";
  }

  /** B3's own "should I auto-turn to catch up" check — true only when the
   * locator's section is the one currently on screen *and* its quote
   * actually resolves there. */
  isLocatorVisible(loc: Locator): boolean {
    if (this.sectionForPage(this.pageIndex) !== loc.sectionIndex) return false;
    if (this.hasSectionData) {
      const text = this.sectionTexts.get(loc.sectionIndex) ?? "";
      const quote = text.slice(loc.offset, loc.offset + loc.length);
      if (!quote) return false;
      return Boolean(findAnchorInText(this.pageTexts[this.pageIndex] ?? "", { exact: quote, prefix: "", suffix: "" }));
    }
    const pageStart = this.pageOffsets[this.pageIndex] ?? 0;
    const localStart = loc.offset - pageStart;
    const localEnd = localStart + loc.length;
    return localStart >= 0 && localEnd <= this.pageLength(this.pageIndex);
  }

  getViewportRectForSelection(): DOMRect | null {
    return this.lastSelectionViewportRect;
  }

  /** No iframe to isolate against (unlike `EpubRenderer`, one per section) —
   * `frameElement: null` is correct, not a stub: `pointerOverInkAt`'s own
   * ink test already skips any frame with no element, which is exactly
   * "the fold's ink/paper distinction doesn't apply here" (B4: the fold
   * itself never mounts under `capabilities.pageFold = false`). */
  renderedFrames(): { document: Document; frameElement: HTMLElement | null }[] {
    return this.pageMounts.size > 0 ? [{ document, frameElement: null }] : [];
  }

  getToc(): TocEntry[] {
    const entries: TocEntry[] = [];
    for (const [sectionIndex, href] of this.sectionHrefs) {
      const startOffset = this.sectionStartOffset.get(sectionIndex) ?? 0;
      const percent = this.totalCanonicalLength > 0 ? (startOffset / this.totalCanonicalLength) * 100 : null;
      entries.push({
        label: this.sectionTitles.get(sectionIndex) ?? `Section ${sectionIndex + 1}`,
        href,
        spineIndex: sectionIndex,
        percent,
        depth: 0,
      });
    }
    return entries.sort((a, b) => (a.spineIndex ?? 0) - (b.spineIndex ?? 0));
  }

  /** No-op: unlike epub.js's `book.locations`, percents here are already
   * computed at mount from `resource_text`'s own character lengths — there
   * is no separate async generation step. */
  async ensureLocations(): Promise<void> {}

  // ── Theme / layout knobs ─────────────────────────────────────────────

  applyTheme(vars: ReaderThemeVars): void {
    this.themeVars = vars;
    this.resolveAndPaintCurrentPage();
    this.paintTintForCurrentPage();
  }

  /** Reading focus mode (DESIGN.md): marks stay resolved but paint
   * invisible — `markStyleForKind`/`audioTintStyle`'s own `hidden` param,
   * same mechanism `EpubRenderer.retintAll` uses. */
  setFocusMode(hidden: boolean): void {
    this.focusModeHidden = hidden;
    this.resolveAndPaintCurrentPage();
    this.paintTintForCurrentPage();
  }

  /** Nothing here ever reflows, so this is just a safe re-run of the same
   * resolution `applyTheme`/page renders already do — kept real rather than
   * a silent no-op so the call site doesn't need an `instanceof` guard to
   * know it's harmless. */
  refreshOverlays(): void {
    this.resolveAndPaintCurrentPage();
    this.paintTintForCurrentPage();
  }

  setFontScale(_scale: number): void {}
  setMargins(_px: number): void {}

  /** M41 §C1 (PDF.md §7.6). */
  setZoomMode(mode: FitMode): void {
    this.fitMode = mode;
    this.userScale = null;
    void this.relayout();
  }

  zoomIn(): void {
    this.userScale = clampZoomScale((this.userScale ?? this.currentFitScale) * ZOOM_STEP);
    void this.relayout();
  }

  zoomOut(): void {
    const next = (this.userScale ?? this.currentFitScale) / ZOOM_STEP;
    this.userScale = next <= this.currentFitScale + ZOOM_EPSILON ? null : clampZoomScale(next);
    void this.relayout();
  }

  // ── Internals: layout ────────────────────────────────────────────────

  /** The navigation entry point (`goTo`/`next`/`prev` all funnel through
   * this) — sets the target page, then defers all actual rendering to
   * `relayout()`, the single function that decides single/spread/
   * continuous and builds the DOM to match. */
  private async renderPage(pageIndex: number): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    this.pageIndex = Math.max(0, Math.min(pageIndex, doc.numPages - 1));
    this.sectionEndFired = false;
    await this.relayout();
  }

  /**
   * M41 §C1 (PDF.md §7.6): the central layout decision, called from the
   * `ResizeObserver`, `setZoomMode`/`zoomIn`/`zoomOut`, and `renderPage`.
   * Continuous scroll is *derived* state, never a separately-tracked flag
   * that could drift from it: `advance` is `"scroll"` exactly when
   * `userScale` is non-null, recomputed here every time, so a container
   * growing back up (or zooming back down) to meet the fit scale snaps back
   * to paginated single/spread automatically in either direction.
   */
  private async relayout(): Promise<void> {
    const container = this.container;
    const doc = this.doc;
    if (!container || !doc) return;
    const generation = ++this.renderGeneration;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const natural = this.naturalPageSizes[this.pageIndex] ?? { width: 0, height: 0 };

    if (containerWidth <= 0) {
      // Not yet laid out (or jsdom, which never lays out at all) —
      // FALLBACK_SCALE keeps every existing test's pixel expectations
      // exactly what they were before this landed.
      this.pagesAcross = 1;
      this.currentFitScale = FALLBACK_SCALE;
    } else {
      this.pagesAcross = this.userScale === null && shouldShowSpread(containerWidth, natural.width) ? 2 : 1;
      // Stable, even-aligned pairing (0|1, 2|3, ...) whenever a spread is
      // showing — idempotent if already even, and what re-pairs a page that
      // was alone (odd index) the moment a spread becomes available.
      if (this.pagesAcross === 2 && this.pageIndex % 2 === 1) this.pageIndex -= 1;
      this.currentFitScale =
        computeFitScale(this.fitMode, containerWidth, containerHeight, natural.width, natural.height, this.pagesAcross) ||
        FALLBACK_SCALE;
    }

    // Snap-back: a resize (or the container simply finishing layout) that
    // brings the fit scale back up to meet a standing zoom-in undoes it,
    // exactly as zooming back down by hand would.
    if (this.userScale !== null && this.userScale <= this.currentFitScale + ZOOM_EPSILON) {
      this.userScale = null;
    }

    this.effectiveScale = this.userScale ?? this.currentFitScale;
    const nextAdvance: "image" | "scroll" = this.userScale !== null ? "scroll" : "image";
    this.capabilities = {
      ...this.capabilities,
      advance: nextAdvance,
      spread: nextAdvance === "image" && this.pagesAcross === 2,
    };

    if (nextAdvance === "scroll") {
      if (!this.scrollHost) {
        container.replaceChildren();
        this.pageMounts = new Map();
        const scrollHost = document.createElement("div");
        scrollHost.style.cssText = "width:100%;height:100%;overflow:auto;position:relative;";
        container.appendChild(scrollHost);
        this.scrollHost = scrollHost;
      }
      await this.rebuildContinuousColumn(generation);
    } else {
      this.teardownContinuous();
      await this.renderPaginated(generation);
    }

    if (generation !== this.renderGeneration) return;
    this.emitLayoutChanged();
  }

  /** Builds the extracted, reusable per-page render — everything from
   * "fetch the page → canvas/text-layer DOM → raster → text layer",
   * parameterized on scale instead of a hardcoded constant. Returns `null`
   * (touching neither the DOM nor `pageMounts`) if cancelled or superseded
   * by a later `relayout()` mid-flight — the fix for a resize/zoom spam
   * racing two renders into the same container. */
  private async renderPageInto(pageIndex: number, scale: number, generation: number): Promise<PageMount | null> {
    const doc = this.doc;
    if (!doc) return null;
    const page = await doc.getPage(pageIndex + 1);
    if (this.cancelled || generation !== this.renderGeneration) return null;
    const viewport = page.getViewport({ scale });

    const pageDiv = document.createElement("div");
    pageDiv.style.position = "relative";
    pageDiv.style.width = `${viewport.width}px`;
    pageDiv.style.height = `${viewport.height}px`;
    pageDiv.style.flex = "none";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    pageDiv.appendChild(canvas);

    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = TEXT_LAYER_CLASS;
    textLayerDiv.style.position = "absolute";
    textLayerDiv.style.inset = "0";
    textLayerDiv.addEventListener("mouseup", () => this.handleSelection(pageIndex, textLayerDiv));
    pageDiv.appendChild(textLayerDiv);

    // Rasterization degrades, never fails — matches
    // server/src/library/pdf/rasterize.ts's own rule for exactly the same
    // reason: jsdom's canvas element has no 2D context without the native
    // `canvas` package, which this file deliberately doesn't add just to
    // satisfy a test environment. A real browser always has one.
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
    if (this.cancelled || generation !== this.renderGeneration) return null;

    const content = await page.getTextContent();
    if (this.cancelled || generation !== this.renderGeneration) return null;
    buildTextLayer(textLayerDiv, content.items, viewport);

    return { pageDiv, textLayerDiv, pinnedMarkEls: new Map(), searchMarkEls: new Set(), tintEl: null };
  }

  /** Single or 2-up spread, discrete pages — `relayout()`'s paginated
   * branch. */
  private async renderPaginated(generation: number): Promise<void> {
    const doc = this.doc;
    const container = this.container;
    if (!doc || !container) return;

    let indices = [this.pageIndex];
    if (this.pagesAcross === 2 && this.pageIndex + 1 <= doc.numPages - 1) {
      indices = [this.pageIndex, this.pageIndex + 1];
    }

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "row";
    wrapper.style.alignItems = "flex-start";
    wrapper.style.justifyContent = "center";
    wrapper.style.gap = "0";

    const newMounts = new Map<number, PageMount>();
    for (const idx of indices) {
      const mount = await this.renderPageInto(idx, this.effectiveScale, generation);
      if (!mount) return; // cancelled, or superseded — a later relayout owns the DOM now
      newMounts.set(idx, mount);
      wrapper.appendChild(mount.pageDiv);
    }
    if (generation !== this.renderGeneration) return;

    container.replaceChildren(wrapper);
    this.pageMounts = newMounts;
    this.resolveAndPaintCurrentPage();
    this.paintTintForCurrentPage();

    const locator = this.currentLocation() ?? { sectionIndex: 0, offset: 0, length: 0 };
    this.emit("relocated", {
      locator,
      bookPercent: this.bookPercentForPage(this.pageIndex),
      sectionPercent: (this.pageIndex + 1) / doc.numPages,
    });

    const lastVisibleIndex = indices[indices.length - 1];
    const isLastOfSection = this.hasSectionData
      ? lastVisibleIndex === doc.numPages - 1 ||
        (this.pageSectionIndex[lastVisibleIndex + 1] ?? 0) !== (this.pageSectionIndex[lastVisibleIndex] ?? 0)
      : lastVisibleIndex === doc.numPages - 1;
    if (isLastOfSection) this.emitSectionEndOnce();
  }

  private teardownContinuous(): void {
    if (this.scrollHost) {
      this.scrollHost.removeEventListener("scroll", this.handleContinuousScroll);
    }
    if (this.continuousRafHandle !== null) {
      cancelAnimationFrame(this.continuousRafHandle);
      this.continuousRafHandle = null;
    }
    this.scrollHost = null;
    this.continuousSlots = [];
  }

  /** Rebuilds the whole placeholder column at the current `effectiveScale`
   * — called on every entry into continuous mode and every further zoom
   * change while already there (a full canvas re-render either way, since
   * the scale genuinely changed). Scrolls the anchor page (`this.pageIndex`)
   * to the top, then hands off to `syncContinuousWindow` to populate the
   * actual visible window. */
  private async rebuildContinuousColumn(generation: number): Promise<void> {
    const doc = this.doc;
    const scrollHost = this.scrollHost;
    if (!doc || !scrollHost) return;

    scrollHost.removeEventListener("scroll", this.handleContinuousScroll);
    scrollHost.replaceChildren();
    this.pageMounts = new Map();
    this.continuousSlots = [];

    for (let i = 0; i < doc.numPages; i++) {
      const natural = this.naturalPageSizes[i] ?? { width: 0, height: 0 };
      const placeholder = document.createElement("div");
      placeholder.style.width = `${natural.width * this.effectiveScale}px`;
      placeholder.style.height = `${natural.height * this.effectiveScale}px`;
      placeholder.style.margin = "0 auto 16px";
      placeholder.dataset.pageIndex = String(i);
      scrollHost.appendChild(placeholder);
      this.continuousSlots.push(placeholder);
    }
    if (generation !== this.renderGeneration) return;

    this.continuousSlots[this.pageIndex]?.scrollIntoView({ block: "start" });
    scrollHost.addEventListener("scroll", this.handleContinuousScroll, { passive: true });
    await this.syncContinuousWindow();
  }

  /** Promotes near-visible placeholders to real rendered pages, demotes
   * real pages that have scrolled well out of view back to placeholders
   * (bounding DOM/canvas count regardless of document length), picks
   * "current page" as whichever slot has the greatest overlap with the
   * viewport, and reports position via the same `scrollProgressFromGeometry`
   * `EpubRenderer`'s own scrolled flow already uses — zero new progress
   * math, no risk of the two renderers' semantics drifting apart. rAF-
   * debounced by `handleContinuousScroll`, mirroring the existing
   * `panelFollowRaf` "no more than once a frame" pattern already in
   * ReaderView.tsx. */
  private async syncContinuousWindow(): Promise<void> {
    const scrollHost = this.scrollHost;
    const doc = this.doc;
    if (!scrollHost || !doc) return;
    const generation = this.renderGeneration;
    const hostRect = scrollHost.getBoundingClientRect();
    const buffer = hostRect.height * CONTINUOUS_BUFFER_VIEWPORTS;

    let bestIndex = this.pageIndex;
    let bestOverlap = -Infinity;
    const toMount: number[] = [];
    for (let i = 0; i < this.continuousSlots.length; i++) {
      const rect = this.continuousSlots[i].getBoundingClientRect();
      const overlap = Math.min(rect.bottom, hostRect.bottom) - Math.max(rect.top, hostRect.top);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIndex = i;
      }
      const nearVisible = rect.bottom >= hostRect.top - buffer && rect.top <= hostRect.bottom + buffer;
      if (nearVisible) toMount.push(i);
    }

    for (const [idx, mount] of [...this.pageMounts]) {
      if (toMount.includes(idx)) continue;
      const placeholder = document.createElement("div");
      placeholder.style.width = mount.pageDiv.style.width;
      placeholder.style.height = mount.pageDiv.style.height;
      placeholder.style.margin = "0 auto 16px";
      placeholder.dataset.pageIndex = String(idx);
      this.continuousSlots[idx]?.replaceWith(placeholder);
      this.continuousSlots[idx] = placeholder;
      this.pageMounts.delete(idx);
    }

    for (const idx of toMount) {
      if (this.pageMounts.has(idx)) continue;
      const mount = await this.renderPageInto(idx, this.effectiveScale, generation);
      if (!mount || generation !== this.renderGeneration) continue;
      mount.pageDiv.style.margin = "0 auto 16px";
      this.continuousSlots[idx]?.replaceWith(mount.pageDiv);
      this.continuousSlots[idx] = mount.pageDiv;
      this.pageMounts.set(idx, mount);
      this.resolveAndPaintPage(idx, mount);
      this.paintTintForPage(idx, mount);
    }
    if (generation !== this.renderGeneration) return;

    if (bestIndex !== this.pageIndex) {
      this.pageIndex = bestIndex;
      this.sectionEndFired = false;
    }

    const scrollProgress = scrollProgressFromGeometry({
      scrollTop: scrollHost.scrollTop,
      scrollHeight: scrollHost.scrollHeight,
      clientHeight: scrollHost.clientHeight,
    });
    this.emit("relocated", {
      locator: this.currentLocation() ?? { sectionIndex: 0, offset: 0, length: 0 },
      bookPercent: this.bookPercentForPage(this.pageIndex),
      sectionPercent: scrollProgress.percent,
    });
    if (scrollProgress.atBottom) this.emitSectionEndOnce();
  }

  private handleSelection(pageIndex: number, textLayerDiv: HTMLElement): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;
    if (!textLayerDiv.contains(range.commonAncestorContainer)) return;
    const exact = range.toString();
    if (!exact.trim()) return;

    const { prefix, suffix } = getSelectionContext(textLayerDiv, range, SELECTION_CONTEXT_MAX_LEN);
    // No iframe here (unlike EpubRenderer), so the Range's own client rect
    // is already viewport-relative — no frame-offset translation needed.
    this.lastSelectionViewportRect = range.getBoundingClientRect();

    const pageSection = this.sectionForPage(pageIndex);
    const sectionText = this.sectionTexts.get(pageSection);
    let locatorOffset: number;
    let locatorLength: number;
    // M41 §A2: locate the selection in the section's *canonical* text (what
    // resource_text stores, and what the reflow pane's own highlights are
    // measured against) rather than trusting a raw offset into pdf.js's own
    // text — that's what makes the resulting Locator resolvable from the
    // reflow pane too.
    const match = sectionText ? findAnchorInText(sectionText, { exact, prefix, suffix }) : null;
    if (match) {
      locatorOffset = match.start;
      locatorLength = match.end - match.start;
    } else {
      // No canonical text (legacy resource), or the selection genuinely
      // doesn't appear there verbatim — falls back to a raw offset local to
      // this renderer's own document-cumulative space. Still anchors fine
      // within native mode itself; only cross-mode sharing degrades.
      const offsets = offsetsForRange(textLayerDiv, range);
      const pageStart = this.pageOffsets[pageIndex] ?? 0;
      locatorOffset = pageStart + offsets.start;
      locatorLength = offsets.end - offsets.start;
    }

    this.emit("selected", {
      text: exact,
      prefix,
      suffix,
      locator: { sectionIndex: pageSection, offset: locatorOffset, length: locatorLength },
    });
  }
}

/**
 * No official pdf.js `TextLayer` here, on purpose: its font-ascent
 * measurement (`TextLayer#getAscent`) needs a real 2D canvas context, which
 * jsdom doesn't provide without the native `canvas` package — the same
 * constraint `renderPageInto`'s own raster skip works around, and this file
 * doesn't take on that dependency just to borrow the official builder. Each
 * item is positioned straight from its own `transform`, matched against the
 * viewport the same way pdf.js's own builder does internally
 * (`Util.transform(viewport.transform, item.transform)`): real text nodes,
 * real Ranges, invisible (the raster canvas is the visible page) — enough
 * for selection/highlighting to work correctly. Not pixel-perfect glyph
 * spacing, which doesn't matter yet for a surface nothing renders to a
 * screen (M41 can swap in the official builder if this turns out not to be
 * enough once it actually is on one).
 */
function buildTextLayer(
  container: HTMLElement,
  items: (PdfjsTextItem | Record<string, unknown>)[],
  viewport: PdfjsViewport,
): void {
  container.replaceChildren();
  for (const item of items) {
    if (!isTextItem(item)) continue;
    if (!item.str) {
      // `textOfItems` (pageTexts, used for offset matching) still counts
      // this item's EOL as a "\n" character even with no visible glyph —
      // skipping it here entirely desyncs every later offset from the
      // DOM's own text-node walk (`rangeFromTextOffsets`), found live as a
      // highlight landing ~20 characters into its own quote.
      if (item.hasEOL) container.appendChild(document.createTextNode("\n"));
      continue;
    }
    const tx = Util.transform(viewport.transform, item.transform) as number[];
    const angle = Math.atan2(tx[1], tx[0]);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const span = document.createElement("span");
    span.textContent = item.str + (item.hasEOL ? "\n" : "");
    span.style.position = "absolute";
    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontHeight}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.lineHeight = "1";
    span.style.whiteSpace = "pre";
    span.style.color = "transparent";
    span.style.transformOrigin = "0 0";
    if (angle !== 0) span.style.transform = `rotate(${angle}rad)`;
    container.appendChild(span);
  }
}
