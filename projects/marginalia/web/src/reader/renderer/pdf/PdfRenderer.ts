/**
 * M40 §D / M41 §A2 (PDF.md §7.2, §7.5, §4): the pdf.js implementation of
 * `ResourceRenderer` — the native, fixed-page PDF surface, distinct from
 * `EpubRenderer`'s reflowable one.
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
import type { TocEntry } from "../epub/toc.js";
import type {
  Locator,
  ReaderThemeVars,
  RendererCapabilities,
  RendererEvents,
  RendererOptions,
  ResourceRenderer,
} from "../types.js";

const TEXT_LAYER_CLASS = "marginalia-pdf-text-layer";
const MARK_CLASS = "marginalia-pdf-highlight";
const TINT_CLASS = "marginalia-pdf-audio-tint";
const SEARCH_MARK_CLASS = "marginalia-pdf-search-mark";
const SELECTION_CONTEXT_MAX_LEN = 64;
// 1.5x screen resolution — plenty for a fixed page; not tuned against a real
// display yet since nothing renders this to a screen (M41's job).
const RENDER_SCALE = 1.5;

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
 * in the section-aware one. Both are carried so `resolveAndPaintCurrentPage`
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
 * M40 §D / M41 §A2: the second `ResourceRenderer` implementation.
 * `capabilities` follows PDF.md §7.5's table exactly — nothing reflows,
 * nothing paginates in the epub.js sense, so every layout knob but
 * `textSelection` is off.
 */
export class PdfRenderer implements ResourceRenderer {
  readonly capabilities: RendererCapabilities = {
    spread: false,
    fontScale: false,
    margins: false,
    pageFold: false,
    pageNumbers: false,
    textSelection: true,
    advance: "image",
  };

  private container: HTMLElement | null = null;
  private doc: PdfjsDocument | null = null;
  private themeVars: ReaderThemeVars | null = null;
  private focusModeHidden = false;

  private pageDiv: HTMLElement | null = null;
  private textLayerDiv: HTMLElement | null = null;
  private pageIndex = 0;

  /** Legacy (no section data) coordinate system — cumulative char offset /
   * raw text of each page, built once at mount by concatenating every
   * page's own `getTextContent()`, whole document as section 0. */
  private pageOffsets: number[] = [];
  private pageTexts: string[] = [];

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

  private highlights: ResolvableHighlight[] = [];
  private pinnedMarkEls = new Map<string, HTMLElement>();
  private searchMarkEls = new Set<HTMLElement>();
  private tintTarget: Locator | null = null;
  private tintEl: HTMLElement | null = null;
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
    await this.renderPage(0);
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
    this.container?.replaceChildren();
    this.container = null;
    this.pageDiv = null;
    this.textLayerDiv = null;
    this.doc = null;
    this.pinnedMarkEls.clear();
    this.searchMarkEls.clear();
  }

  private async buildPageTexts(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const offsets: number[] = [];
    const texts: string[] = [];
    let cumulative = 0;
    for (let i = 0; i < doc.numPages; i++) {
      offsets.push(cumulative);
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      const text = textOfItems(content.items);
      texts.push(text);
      cumulative += text.length;
    }
    this.pageOffsets = offsets;
    this.pageTexts = texts;
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
    if (!this.doc) return;
    if (this.pageIndex >= this.doc.numPages - 1) {
      this.emitSectionEndOnce();
      return;
    }
    await this.renderPage(this.pageIndex + 1);
  }

  async prev(): Promise<void> {
    if (this.pageIndex <= 0) return;
    await this.renderPage(this.pageIndex - 1);
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

  /** A highlight `resolveAndPaintCurrentPage` could not place — never
   * fired (see the class comment's SPEC-GAP). Registered so `ReaderView`
   * can subscribe uniformly across both renderers without an `instanceof`
   * check. */
  onUnanchored(_cb: Listener<string>): () => void {
    return () => {};
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
    const el = this.pinnedMarkEls.get(highlightId);
    if (el) {
      el.remove();
      this.pinnedMarkEls.delete(highlightId);
    }
  }

  /** M41 §A2: the bulk-resolve path `EpubRenderer.setHighlights` mirrors —
   * a full loaded list, re-resolved against whichever page is currently
   * rendered (and again on every future render, since a PDF page's DOM is
   * ephemeral — `renderPage` calls this itself). */
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

  private paintOneMark(id: string, kind: HighlightKind, range: Range): void {
    if (!this.pageDiv || !this.textLayerDiv) return;
    let el = this.pinnedMarkEls.get(id);
    if (!el) {
      el = document.createElement("div");
      el.className = MARK_CLASS;
      el.dataset.highlightId = id;
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.pointerEvents = "none";
      el.addEventListener("click", () => this.emit("markClicked", id));
      this.pinnedMarkEls.set(id, el);
    }
    const attrs = this.themeVars ? markStyleForKind(kind, this.themeVars, this.focusModeHidden) : undefined;
    paintRangeInto(el, range, this.pageDiv, attrs);
    if (!el.isConnected) this.pageDiv.insertBefore(el, this.textLayerDiv);
  }

  /** Resolves every pinned highlight against whichever page is currently
   * rendered — called after every `renderPage` (a fresh DOM), and again
   * after `setHighlights`/`paintMark`/`applyTheme`/`setFocusMode` touch
   * state that could change what's resolvable or how it should look. */
  private resolveAndPaintCurrentPage(): void {
    if (!this.pageDiv || !this.textLayerDiv) return;
    const stillPresent = new Set<string>();

    if (this.hasSectionData) {
      const currentSection = this.sectionForPage(this.pageIndex);
      const pageText = this.pageTexts[this.pageIndex] ?? "";
      for (const h of this.highlights) {
        if (h.spineIndex !== currentSection || !h.exact) continue;
        const match = findAnchorInText(pageText, h);
        if (!match) continue;
        const range = rangeFromTextOffsets(this.textLayerDiv, match.start, match.end);
        if (!range) continue;
        stillPresent.add(h.id);
        this.paintOneMark(h.id, h.kind, range);
      }
    } else {
      const pageStart = this.pageOffsets[this.pageIndex] ?? 0;
      const pageLen = this.pageLength(this.pageIndex);
      for (const h of this.highlights) {
        if (h.spineIndex !== 0 || h.offset == null || h.length == null) continue;
        const localStart = h.offset - pageStart;
        const localEnd = localStart + h.length;
        if (localStart < 0 || localEnd > pageLen) continue;
        const range = rangeFromTextOffsets(this.textLayerDiv, localStart, localEnd);
        if (!range) continue;
        stillPresent.add(h.id);
        this.paintOneMark(h.id, h.kind, range);
      }
    }

    for (const [id, el] of this.pinnedMarkEls) {
      if (!stillPresent.has(id)) {
        el.remove();
        this.pinnedMarkEls.delete(id);
      }
    }
  }

  /** Mirrors `EpubRenderer`'s own convention: the *first* line box of a
   * (possibly multi-line) mark, not their union. */
  markRect(highlightId: string): DOMRect | null {
    const el = this.pinnedMarkEls.get(highlightId);
    if (!el?.isConnected) return null;
    const box = el.firstElementChild;
    return box ? box.getBoundingClientRect() : null;
  }

  setTint(loc: Locator | null): void {
    this.tintTarget = loc;
    this.paintTintForCurrentPage();
  }

  private paintTintForCurrentPage(): void {
    if (this.tintEl) {
      this.tintEl.remove();
      this.tintEl = null;
    }
    const loc = this.tintTarget;
    if (!loc || !this.pageDiv || !this.textLayerDiv) return;
    if (this.sectionForPage(this.pageIndex) !== loc.sectionIndex) return;

    let range: Range | null = null;
    if (this.hasSectionData) {
      const text = this.sectionTexts.get(loc.sectionIndex) ?? "";
      const quote = text.slice(loc.offset, loc.offset + loc.length);
      if (quote) {
        const match = findAnchorInText(this.pageTexts[this.pageIndex] ?? "", { exact: quote, prefix: "", suffix: "" });
        if (match) range = rangeFromTextOffsets(this.textLayerDiv, match.start, match.end);
      }
    } else {
      const pageStart = this.pageOffsets[this.pageIndex] ?? 0;
      const localStart = loc.offset - pageStart;
      const localEnd = localStart + loc.length;
      if (localStart >= 0 && localEnd <= this.pageLength(this.pageIndex)) {
        range = rangeFromTextOffsets(this.textLayerDiv, localStart, localEnd);
      }
    }
    if (!range) return;

    const el = document.createElement("div");
    el.className = TINT_CLASS;
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.pointerEvents = "none";
    const attrs = this.themeVars ? audioTintStyle(this.themeVars, this.focusModeHidden) : undefined;
    paintRangeInto(el, range, this.pageDiv, attrs);
    this.pageDiv.insertBefore(el, this.textLayerDiv);
    this.tintEl = el;
  }

  /** B2 (PDF.md §7.5): "text search against `resource_text` with text-layer
   * rect painting". `located` entries are offsets into whatever
   * `getRenderedSectionText` returned for the current page — `ReaderView`
   * locates hits against that same string before calling this, exactly as
   * it does for `EpubRenderer`. */
  paintSearchMarks(located: { index: number; start: number; end: number }[], currentIndex: number): void {
    this.clearSearchMarks();
    if (!this.pageDiv || !this.textLayerDiv || !this.themeVars) return;
    for (const { index, start, end } of located) {
      const range = rangeFromTextOffsets(this.textLayerDiv, start, end);
      if (!range) continue;
      const el = document.createElement("div");
      el.className = SEARCH_MARK_CLASS;
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.pointerEvents = "none";
      paintRangeInto(el, range, this.pageDiv, searchMarkStyle(this.themeVars, index === currentIndex));
      this.pageDiv.insertBefore(el, this.textLayerDiv);
      this.searchMarkEls.add(el);
    }
  }

  clearSearchMarks(): void {
    for (const el of this.searchMarkEls) el.remove();
    this.searchMarkEls.clear();
  }

  /** Which section's text the *currently rendered page* holds — null for
   * any other section, since only one page is ever live at a time (unlike
   * `EpubRenderer`, which lays a whole section out at once). B2/B3 both
   * read this to know whether there's anything to search on screen right
   * now. */
  getRenderedSectionText(sectionIndex: number): string | null {
    if (this.sectionForPage(this.pageIndex) !== sectionIndex) return null;
    return this.pageTexts[this.pageIndex] ?? "";
  }

  /** B3's own "should I auto-turn to catch up" check — true only when the
   * locator's section is the one currently on screen *and* its quote
   * actually resolves there (no separate viewport/scroll test: a rendered
   * PDF page has nothing to scroll past in this milestone). */
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
   * itself never mounts under `capabilities.pageFold = false`). The
   * document itself is what `hasLiveSelection`/`clearNativeSelection` need,
   * and both work unchanged against it. */
  renderedFrames(): { document: Document; frameElement: HTMLElement | null }[] {
    return this.pageDiv ? [{ document, frameElement: null }] : [];
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

  /** Nothing here ever reflows (every layout capability is false), so this
   * is just a safe re-run of the same resolution `applyTheme`/page renders
   * already do — kept real rather than a silent no-op so the call site
   * doesn't need an `instanceof` guard to know it's harmless. */
  refreshOverlays(): void {
    this.resolveAndPaintCurrentPage();
    this.paintTintForCurrentPage();
  }

  setFontScale(_scale: number): void {}
  setMargins(_px: number): void {}

  // ── Internals ────────────────────────────────────────────────────────

  private async renderPage(pageIndex: number): Promise<void> {
    const container = this.container;
    const doc = this.doc;
    if (!container || !doc) return;
    this.pageIndex = Math.max(0, Math.min(pageIndex, doc.numPages - 1));
    this.sectionEndFired = false;

    const page = await doc.getPage(this.pageIndex + 1);
    if (this.cancelled) return;
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    container.replaceChildren();
    const pageDiv = document.createElement("div");
    pageDiv.style.position = "relative";
    pageDiv.style.width = `${viewport.width}px`;
    pageDiv.style.height = `${viewport.height}px`;

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
    textLayerDiv.addEventListener("mouseup", () => this.handleSelection());
    pageDiv.appendChild(textLayerDiv);

    container.appendChild(pageDiv);
    this.pageDiv = pageDiv;
    this.textLayerDiv = textLayerDiv;
    // A fresh page is a fresh DOM (`replaceChildren` above) — nothing
    // painted into the old one survives, so the bookkeeping for it doesn't
    // either.
    this.pinnedMarkEls = new Map();
    this.searchMarkEls = new Set();
    this.tintEl = null;

    // Rasterization degrades, never fails — matches
    // server/src/library/pdf/rasterize.ts's own rule for exactly the same
    // reason: jsdom's canvas element has no 2D context without the native
    // `canvas` package, which this file deliberately doesn't add just to
    // satisfy a test environment. A real browser always has one.
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
    if (this.cancelled) return;

    const content = await page.getTextContent();
    if (this.cancelled) return;
    buildTextLayer(textLayerDiv, content.items, viewport);

    this.resolveAndPaintCurrentPage();
    this.paintTintForCurrentPage();

    const locator = this.currentLocation() ?? { sectionIndex: 0, offset: 0, length: 0 };
    this.emit("relocated", {
      locator,
      bookPercent: this.bookPercentForPage(this.pageIndex),
      sectionPercent: (this.pageIndex + 1) / doc.numPages,
    });

    const isLastOfSection = this.hasSectionData
      ? this.pageIndex === doc.numPages - 1 ||
        (this.pageSectionIndex[this.pageIndex + 1] ?? 0) !== (this.pageSectionIndex[this.pageIndex] ?? 0)
      : this.pageIndex === doc.numPages - 1;
    if (isLastOfSection) this.emitSectionEndOnce();
  }

  private handleSelection(): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !this.textLayerDiv) return;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return;
    if (!this.textLayerDiv.contains(range.commonAncestorContainer)) return;
    const exact = range.toString();
    if (!exact.trim()) return;

    const { prefix, suffix } = getSelectionContext(this.textLayerDiv, range, SELECTION_CONTEXT_MAX_LEN);
    // No iframe here (unlike EpubRenderer), so the Range's own client rect
    // is already viewport-relative — no frame-offset translation needed.
    this.lastSelectionViewportRect = range.getBoundingClientRect();

    const pageSection = this.sectionForPage(this.pageIndex);
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
      const offsets = offsetsForRange(this.textLayerDiv, range);
      const pageStart = this.pageOffsets[this.pageIndex] ?? 0;
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
 * constraint `renderPage`'s own raster skip works around, and this file
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
