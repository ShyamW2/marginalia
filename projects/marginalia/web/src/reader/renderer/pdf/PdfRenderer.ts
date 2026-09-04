/**
 * M40 §D (PDF.md §7.2, §7.5): the pdf.js implementation of `ResourceRenderer`
 * — the native, fixed-page PDF surface, distinct from `EpubRenderer`'s
 * reflowable one. **Not routed to from any UI yet** (M41 turns it on); this
 * file exists to prove the seam against a genuinely different kind of
 * consumer, which is M40's own reason for being a milestone rather than prep
 * folded into M41 (PDF.md §7 intro).
 *
 * Every pdfjs-dist import in the app lives here.
 *
 * SPEC-GAP: `Locator.sectionIndex` is always `0`. A real multi-section PDF
 * needs a persisted page→section table to know which `resource_text` row a
 * given page's characters belong to, and nothing builds one yet — that's
 * M41 §A2's "highlights are shared between reflow and native" problem, not
 * this milestone's. Treating the whole document as section 0 is exactly
 * PDF.md §4's fallback rule 3 ("one section for the whole document, under 40
 * pages") and is the only shape this file is tested against. See
 * `docs/marginalia/NOTES.md`.
 */
import { getDocument, Util } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { HighlightKind } from "@marginalia/shared";
import { getSelectionContext, offsetsForRange, rangeFromTextOffsets } from "../../selectionContext.js";
import { audioTintStyle, markStyleForKind } from "../../highlightKinds.js";
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

interface MarkRecord {
  loc: Locator;
  kind: HighlightKind;
  el: HTMLElement;
}

/**
 * Positions one absolutely-positioned box per client rect a Range spans
 * (PDF.md §7.5: "client rects from the text-layer Range → absolutely
 * positioned divs. `marks-pane` is CFI-keyed and is not reused here") —
 * `wrapper` itself covers the whole page 1:1 with `pageDiv` (so its
 * children's coordinates, measured from `pageDiv`'s own rect, need no
 * further translation) and is never the click/hover target itself.
 */
function paintRangeInto(wrapper: HTMLElement, range: Range, pageDiv: HTMLElement): void {
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
 * M40 §D: the second `ResourceRenderer` implementation. `capabilities`
 * follows PDF.md §7.5's table exactly — nothing reflows, nothing paginates
 * in the epub.js sense, so every layout knob but `textSelection` is off.
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

  private pageDiv: HTMLElement | null = null;
  private textLayerDiv: HTMLElement | null = null;
  private pageIndex = 0;
  /** Cumulative char offset of each page's own text within section 0 (see
   * the class comment's SPEC-GAP) — `pageOffsets[i]` is where page `i`'s
   * text begins; the implied end is `pageOffsets[i + 1]` (or "the rest",
   * for the last page). Built once, at mount. */
  private pageOffsets: number[] = [];

  private pinnedMarks = new Map<string, MarkRecord>();
  private tintEl: HTMLElement | null = null;
  private tintLoc: Locator | null = null;
  /** `sectionEnd` fires once per arrival at the last page, not once per
   * render of it (PDF.md §7.2: "an event, not a page-number comparison" —
   * re-rendering the same last page, e.g. a theme change, must not re-fire it). */
  private sectionEndFired = false;
  private cancelled = false;

  private eventListeners: { [K in keyof RendererEvents]?: Set<Listener<Parameters<RendererEvents[K]>[0]>> } = {};

  async mount(container: HTMLElement, resource: { id: string }, _opts: RendererOptions): Promise<void> {
    this.container = container;
    const res = await fetch(`/api/resources/${resource.id}/file`);
    const data = new Uint8Array(await res.arrayBuffer());
    this.doc = (await getDocument({ data }).promise) as unknown as PdfjsDocument;
    if (this.cancelled) return;
    await this.buildPageOffsets();
    if (this.cancelled) return;
    await this.renderPage(0);
  }

  destroy(): void {
    this.cancelled = true;
    this.container?.replaceChildren();
    this.container = null;
    this.pageDiv = null;
    this.textLayerDiv = null;
    this.doc = null;
    this.pinnedMarks.clear();
  }

  private async buildPageOffsets(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const offsets: number[] = [];
    let cumulative = 0;
    for (let i = 0; i < doc.numPages; i++) {
      offsets.push(cumulative);
      const page = await doc.getPage(i + 1);
      const content = await page.getTextContent();
      cumulative += textOfItems(content.items).length;
    }
    this.pageOffsets = offsets;
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

  // ── Navigation ────────────────────────────────────────────────────────

  async goTo(loc: Locator): Promise<void> {
    await this.renderPage(this.pageIndexForOffset(loc.offset));
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

  // ── Marks ────────────────────────────────────────────────────────────

  paintMark(highlightId: string, loc: Locator, kind: HighlightKind): void {
    const existing = this.pinnedMarks.get(highlightId);
    const el = existing?.el ?? document.createElement("div");
    el.className = MARK_CLASS;
    el.dataset.highlightId = highlightId;
    if (!existing) {
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.pointerEvents = "none";
      el.addEventListener("click", () => this.emit("markClicked", highlightId));
    }
    this.pinnedMarks.set(highlightId, { loc, kind, el });
    this.paintIfOnCurrentPage(highlightId);
  }

  removeMark(highlightId: string): void {
    const record = this.pinnedMarks.get(highlightId);
    if (!record) return;
    record.el.remove();
    this.pinnedMarks.delete(highlightId);
  }

  /** Repaints a pinned mark against the currently rendered page — a no-op,
   * leaving whatever was last painted removed, when its offset range falls
   * outside this page (it belongs to a page that isn't showing right now). */
  private paintIfOnCurrentPage(highlightId: string): void {
    const record = this.pinnedMarks.get(highlightId);
    if (!record || !this.pageDiv || !this.textLayerDiv) return;
    const pageStart = this.pageOffsets[this.pageIndex] ?? 0;
    const localStart = record.loc.offset - pageStart;
    const localEnd = localStart + record.loc.length;
    if (localStart < 0 || localEnd > this.pageLength(this.pageIndex)) {
      record.el.remove();
      return;
    }
    const range = rangeFromTextOffsets(this.textLayerDiv, localStart, localEnd);
    if (!range) {
      record.el.remove();
      return;
    }
    if (this.themeVars) applyMarkAttrs(record.el, markStyleForKind(record.kind, this.themeVars));
    paintRangeInto(record.el, range, this.pageDiv);
    if (!record.el.isConnected) this.pageDiv.insertBefore(record.el, this.textLayerDiv);
  }

  /** Mirrors `EpubRenderer.markRect`'s own convention: the *first* line box
   * of a (possibly multi-line) mark, not their union. */
  markRect(highlightId: string): DOMRect | null {
    const record = this.pinnedMarks.get(highlightId);
    if (!record?.el.isConnected) return null;
    const box = record.el.firstElementChild;
    return box ? box.getBoundingClientRect() : null;
  }

  setTint(loc: Locator | null): void {
    this.tintLoc = loc;
    if (this.tintEl) {
      this.tintEl.remove();
      this.tintEl = null;
    }
    if (!loc || !this.pageDiv || !this.textLayerDiv) return;
    const pageStart = this.pageOffsets[this.pageIndex] ?? 0;
    const localStart = loc.offset - pageStart;
    const localEnd = localStart + loc.length;
    if (localStart < 0 || localEnd > this.pageLength(this.pageIndex)) return;
    const range = rangeFromTextOffsets(this.textLayerDiv, localStart, localEnd);
    if (!range) return;

    const el = document.createElement("div");
    el.className = TINT_CLASS;
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.pointerEvents = "none";
    if (this.themeVars) applyMarkAttrs(el, audioTintStyle(this.themeVars));
    paintRangeInto(el, range, this.pageDiv);
    this.pageDiv.insertBefore(el, this.textLayerDiv);
    this.tintEl = el;
  }

  // ── Theme / layout knobs (capabilities false — the chrome never calls
  //    setFontScale/setMargins here, but the interface still needs them) ──

  applyTheme(vars: ReaderThemeVars): void {
    this.themeVars = vars;
    for (const id of this.pinnedMarks.keys()) this.paintIfOnCurrentPage(id);
    if (this.tintLoc) this.setTint(this.tintLoc);
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

    for (const id of this.pinnedMarks.keys()) this.paintIfOnCurrentPage(id);
    if (this.tintLoc) this.setTint(this.tintLoc);

    const pageStart = this.pageOffsets[this.pageIndex] ?? 0;
    this.emit("relocated", {
      locator: { sectionIndex: 0, offset: pageStart, length: 0 },
      bookPercent: doc.numPages > 1 ? this.pageIndex / (doc.numPages - 1) : 0,
      sectionPercent: (this.pageIndex + 1) / doc.numPages,
    });
    if (this.pageIndex === doc.numPages - 1) this.emitSectionEndOnce();
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
    const { start, end } = offsetsForRange(this.textLayerDiv, range);
    const pageStart = this.pageOffsets[this.pageIndex] ?? 0;

    this.emit("selected", {
      text: exact,
      prefix,
      suffix,
      locator: { sectionIndex: 0, offset: pageStart + start, length: end - start },
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
    if (!isTextItem(item) || !item.str) continue;
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
