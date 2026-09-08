import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
// Node's own `URL`, not the global jsdom patches in for browser parity —
// `fileURLToPath` rejects a jsdom-constructed URL instance with "The URL
// must be of scheme file" even when its `.href` is a well-formed file: URL,
// found live wiring this fixture load up.
import { URL, fileURLToPath } from "node:url";
import { PdfRenderer } from "./PdfRenderer.js";
import { serializeLocator, parseSerializedLocator } from "../types.js";
import { rangeFromTextOffsets } from "../../selectionContext.js";

/**
 * A static two-page fixture (`fixtures/pdf-renderer-sample.pdf`, "The quick
 * brown fox..." / "A second page..."), generated once via pdfkit under plain
 * Node and committed — same fixture *shape* as
 * server/src/library/pdf/extract.test.ts's pdfkit-built one, but not built
 * inline here. Found live: pdfkit branches on `typeof document`
 * (`ICC_PROFILE_PATH`'s resolution) and produces a genuinely corrupt content
 * stream ("Bad FCHECK in flate stream") when built inside this file's own
 * jsdom environment — a static binary sidesteps it entirely, the same way
 * the epub fixtures in this directory are static files rather than
 * generated per test run.
 */
function loadFixturePdf(): Uint8Array {
  // `new URL(literal, import.meta.url)` as one expression is Vite's own
  // static-asset-URL pattern (it rewrites the literal at build time) — the
  // rewritten value isn't a `file:` URL, so `fileURLToPath` below rejects it.
  // Routing `import.meta.url` through a variable first avoids that rewrite.
  const thisFileUrl = import.meta.url;
  const path = fileURLToPath(new URL("../../../../../fixtures/pdf-renderer-sample.pdf", thisFileUrl));
  return new Uint8Array(fs.readFileSync(path));
}

function stubResourceFetch(bytes: Uint8Array): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })),
  );
}

/**
 * M41 §A2: a URL-routing stub for the section-aware path — `/pdf-source`
 * gets the fixture's raw bytes, `/text-sections`/`/pdf-sections` get real
 * JSON (unlike `stubResourceFetch`'s single undifferentiated response,
 * which is what made the M40 §D tests above exercise the *legacy* fallback
 * all along: `.json()` doesn't exist on that stub's response shape, so
 * `loadSectionData`'s own try/catch always degraded).
 */
function stubResourceFetchWithSections(
  bytes: Uint8Array,
  sections: { spineIndex: number; href: string; text: string }[],
  pageSections: number[],
  chapterTitles: Record<string, string> = {},
  subheadings: Record<string, { title: string; depth: number; offset: number }[]> = {},
): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/pdf-source")) {
        return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      }
      if (url.endsWith("/text-sections")) {
        return { ok: true, json: async () => sections };
      }
      if (url.endsWith("/pdf-sections")) {
        return { ok: true, json: async () => pageSections };
      }
      return { ok: true, json: async () => ({ metadata: { chapterTitles, subheadings } }) };
    }),
  );
}

/** jsdom never lays anything out, so every element's `clientWidth`/
 * `clientHeight` reads 0 by default — M41 §C1's layout math needs a real
 * (mocked) container size to exercise its spread/zoom decisions at all
 * rather than always falling back to `FALLBACK_SCALE`'s single-page path. */
function mockContainerSize(container: HTMLElement, width: number, height: number): void {
  Object.defineProperty(container, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(container, "clientHeight", { configurable: true, value: height });
}

/** M42 §D1's `setZoomScale` debounces the real re-render behind
 * `relayout()`'s several real `await`s (getPage/getTextContent/render) —
 * same reason the zoom-threshold test above polls on real timers rather
 * than a single `await` (its own comment explains why fake timers don't
 * mix cleanly with pdf.js's own internal scheduling). Deduplicated here
 * since the continuous-zoom tests below need the same poll repeatedly. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Selects the DOM range covering `needle` inside `container`'s flattened
 * text and installs it as the live window selection — the same shape a real
 * mouse drag over the text layer produces. */
function selectText(container: HTMLElement, needle: string): Range {
  const full = container.textContent ?? "";
  const start = full.indexOf(needle);
  if (start < 0) throw new Error(`fixture text layer does not contain ${JSON.stringify(needle)}`);
  const range = rangeFromTextOffsets(container, start, start + needle.length);
  if (!range) throw new Error("could not build a range for the selected text");
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

describe("PdfRenderer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has the M40 §D capability profile: fixed pages, no reflow, real text selection", () => {
    const renderer = new PdfRenderer();
    // M43 §D1: `advance` starts "scroll" (not "image") before the first
    // `relayout()` — see that field's own comment.
    expect(renderer.capabilities).toEqual({
      spread: false,
      fontScale: false,
      margins: false,
      pageFold: false,
      pageNumbers: false,
      textSelection: true,
      zoom: true,
      advance: "scroll",
    });
  });

  it("mounts a real PDF, selects text via a DOM Range, paints a mark, and round-trips the Locator", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new PdfRenderer();

    const relocations: { locator: { sectionIndex: number; offset: number } }[] = [];
    renderer.on("relocated", (pos) => relocations.push(pos));
    const selections: { text: string; prefix: string; suffix: string; locator: { sectionIndex: number; offset: number; length: number } }[] = [];
    renderer.on("selected", (sel) => selections.push(sel));

    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    // A real page rendered: a canvas for the raster, real text nodes for
    // selection, per PDF.md §7.5's "pdf.js canvas + text layer".
    const textLayer = container.querySelector(".marginalia-pdf-text-layer") as HTMLElement;
    expect(textLayer).toBeTruthy();
    expect(container.querySelector("canvas")).toBeTruthy();
    expect(textLayer.textContent).toContain("quick brown fox");
    expect(relocations).toHaveLength(1);
    expect(relocations[0].locator.sectionIndex).toBe(0);
    expect(relocations[0].locator.offset).toBe(0);

    // D2: selection via the text layer's real DOM Ranges.
    selectText(textLayer, "quick brown fox");
    textLayer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(selections).toHaveLength(1);
    const sel = selections[0];
    expect(sel.text).toBe("quick brown fox");
    expect(sel.prefix.endsWith("The ")).toBe(true);
    expect(sel.suffix.startsWith(" jumps over")).toBe(true);
    expect(sel.locator.sectionIndex).toBe(0);
    expect(sel.locator.length).toBe("quick brown fox".length);

    // Round-trips through the serialized form written to `reading_state`.
    const roundTripped = parseSerializedLocator(serializeLocator(sel.locator));
    expect(roundTripped).toEqual(sel.locator);

    // D3: highlight painting from the Range's client rects into an
    // absolutely-positioned div, keyed off the resolved Locator — not the
    // live selection, exactly as a highlight loaded from storage would be.
    renderer.paintMark("h1", roundTripped, "rose");
    const mark = container.querySelector('.marginalia-pdf-highlight[data-highlight-id="h1"]');
    expect(mark).toBeTruthy();
    expect(renderer.markRect("h1")).not.toBeNull();

    renderer.removeMark("h1");
    expect(container.querySelector('.marginalia-pdf-highlight[data-highlight-id="h1"]')).toBeNull();
    expect(renderer.markRect("h1")).toBeNull();

    renderer.destroy();
  });

  it("A1: merges per-span text-layer client rects into one box per visual line", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    // Simulates pdf.js's real text layer: two spans on one visual line (a
    // sub-pixel gap and slight height jitter between them, both of which
    // must merge into a single box) plus one span on a second line.
    const spanRects = [
      { top: 100, bottom: 116, left: 10, right: 40, width: 30, height: 16 },
      { top: 100.4, bottom: 116.4, left: 40.3, right: 70, width: 29.7, height: 16 },
      { top: 140, bottom: 156, left: 10, right: 55, width: 45, height: 16 },
    ] as DOMRect[];
    const originalGetClientRects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function () {
      return Object.assign([...spanRects], { item: (i: number) => spanRects[i] ?? null }) as unknown as DOMRectList;
    };
    try {
      renderer.paintMark("h1", { sectionIndex: 0, offset: 0, length: 1 }, "rose");
    } finally {
      Range.prototype.getClientRects = originalGetClientRects;
    }

    const mark = container.querySelector('.marginalia-pdf-highlight[data-highlight-id="h1"]') as HTMLElement;
    expect(mark).toBeTruthy();
    // One box per visual line, not one per text-layer span — three spans
    // collapse to two boxes.
    expect(mark.children.length).toBe(2);

    const [line1, line2] = Array.from(mark.children) as HTMLElement[];
    // Line one spans the full leftmost-to-rightmost extent of its two
    // merged spans, with no gap or double-painted overlap between them.
    expect(line1.style.left).toBe("10px");
    expect(line1.style.width).toBe("60px");
    expect(line1.style.top).toBe("100px");
    // Line two is its own, separate box ending at its own text extent —
    // not the container's full width.
    expect(line2.style.left).toBe("10px");
    expect(line2.style.width).toBe("45px");
    expect(line2.style.top).toBe("140px");

    renderer.destroy();
  });

  it("M43 §B1: the canvas backing store scales with (a capped) devicePixelRatio, while the CSS/viewport-keyed geometry stays unscaled", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    async function mountAtDpr(dpr: number) {
      const originalDescriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: dpr });
      const container = document.createElement("div");
      document.body.appendChild(container);
      const renderer = new PdfRenderer();
      try {
        await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
        const pageDiv = container.querySelector("canvas")?.parentElement as HTMLElement;
        const canvas = container.querySelector("canvas") as HTMLCanvasElement;
        const cssWidth = parseFloat(pageDiv.style.width);
        return {
          cssWidth,
          backingWidth: canvas.width,
          backingHeight: canvas.height,
          canvasCssWidth: canvas.style.width,
          canvasCssHeight: canvas.style.height,
          renderer,
        };
      } finally {
        if (originalDescriptor) Object.defineProperty(window, "devicePixelRatio", originalDescriptor);
      }
    }

    const at1x = await mountAtDpr(1);
    at1x.renderer.destroy();
    // DPR 1: backing store matches the CSS size exactly — today's behaviour,
    // unchanged.
    expect(at1x.backingWidth).toBe(Math.round(at1x.cssWidth));

    const at2x = await mountAtDpr(2);
    at2x.renderer.destroy();
    // DPR 2: the CSS box (and therefore the text layer / mark-painting
    // geometry, which is keyed to `viewport`, not the backing store) is
    // identical — only the backing store doubles.
    expect(at2x.cssWidth).toBeCloseTo(at1x.cssWidth, 5);
    expect(at2x.backingWidth).toBe(Math.round(at2x.cssWidth * 2));

    // Capped at 2.5 rather than trusting an unbounded reported value — a
    // DPR of 4 must not render 16x the pixels.
    const at4x = await mountAtDpr(4);
    at4x.renderer.destroy();
    expect(at4x.backingWidth).toBe(Math.round(at4x.cssWidth * 2.5));

    // §B1 corrective, found live: <canvas> is a *replaced* element, so
    // `position:absolute; inset:0` alone does not stretch it to its
    // container the way it would a plain div — once the backing store
    // (canvas.width/height) diverged from the CSS box at dpr>1, an
    // unstyled canvas rendered at its own intrinsic (backing-store) size
    // instead, showing only the top-left 1/dpr fraction of the page. The
    // CSS box must be pinned explicitly.
    for (const m of [at1x, at2x, at4x]) {
      expect(m.canvasCssWidth).toBe(`${m.cssWidth}px`);
      expect(parseFloat(m.canvasCssHeight)).toBeGreaterThan(0);
    }
  });

  it("M43 §A corrective: buildTextLayer applies a scaleX correction so each span's on-screen width matches the PDF's own glyph metrics, not the browser's substitute-font advance width", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    // jsdom has no 2D context at all without the native `canvas` package
    // (every other test in this file relies on that to exercise
    // `renderPageInto`'s "rasterization degrades, never fails" path) — stub
    // one in only for `getMeasureCtx`'s own canvas (marked with a data
    // attribute for exactly this), leaving the page's own raster canvas on
    // jsdom's real `null` fallback, unaffected. A fixed, text-independent
    // `measureText` guarantees the browser-measured width differs from the
    // PDF's own — proving the correction actually ran, not asserting its
    // exact factor (which would just duplicate the formula under test).
    //
    // `getMeasureCtx()` caches its result in a module-level variable, so a
    // fresh module instance is needed here (`vi.resetModules` + a dynamic
    // re-import) — reusing the top-level `PdfRenderer` import would just
    // see whatever an *earlier* test's mount already resolved that cache
    // to (`null`, on plain jsdom), before this stub ever had a chance to run.
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "2d" && this.dataset.marginaliaMeasureCanvas === "1") {
        return { font: "", measureText: () => ({ width: 100 }) } as unknown as ReturnType<typeof originalGetContext>;
      }
      return (originalGetContext as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;

    const container = document.createElement("div");
    document.body.appendChild(container);
    let renderer: InstanceType<typeof PdfRenderer>;
    try {
      vi.resetModules();
      const { PdfRenderer: FreshPdfRenderer } = await import("./PdfRenderer.js");
      renderer = new FreshPdfRenderer();
      await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    } finally {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
      vi.resetModules();
    }

    const textLayer = container.querySelector(".marginalia-pdf-text-layer") as HTMLElement;
    const span = textLayer.querySelector("span") as HTMLElement | null;
    expect(span?.textContent).toBeTruthy();
    const match = /scaleX\(([-\d.]+)\)/.exec(span?.style.transform ?? "");
    expect(match).toBeTruthy();
    const scale = Number(match?.[1]);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThan(0);

    renderer.destroy();
  });

  it("A2: emits 'deselected' on a container click away from a selection, but not on a mark or a live selection", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new PdfRenderer();
    const deselections: number[] = [];
    renderer.onDeselected(() => deselections.push(1));

    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    const textLayer = container.querySelector(".marginalia-pdf-text-layer") as HTMLElement;

    // A live (non-collapsed) selection: a click bubbling up through it must
    // not dismiss — matches `handleContentClick`'s own
    // `getSelection()?.toString()` guard.
    selectText(textLayer, "quick brown fox");
    container.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(deselections).toHaveLength(0);

    // A click that collapses (or lands after) the selection — the case
    // `handleSelection`'s own `if (range.collapsed) return;` leaves nothing
    // else to fire on — does dismiss.
    window.getSelection()?.removeAllRanges();
    container.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(deselections).toHaveLength(1);

    // A click on a painted mark is the mark's own `markClicked` path, not a
    // click-away — must not also dismiss.
    renderer.paintMark("h1", { sectionIndex: 0, offset: 0, length: 1 }, "rose");
    const mark = container.querySelector('.marginalia-pdf-highlight[data-highlight-id="h1"]') as HTMLElement;
    mark.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(deselections).toHaveLength(1);

    renderer.destroy();
  });

  it("M43 §A corrective: a painted mark is stacked after (on top of) the text layer, so a real click resolves to it rather than the fully-covering text layer beneath", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    renderer.paintMark("h1", { sectionIndex: 0, offset: 0, length: 1 }, "rose");
    const textLayer = container.querySelector(".marginalia-pdf-text-layer") as HTMLElement;
    const mark = container.querySelector('.marginalia-pdf-highlight[data-highlight-id="h1"]') as HTMLElement;
    expect(textLayer).toBeTruthy();
    expect(mark).toBeTruthy();
    // DOCUMENT_POSITION_FOLLOWING on the text layer means the mark comes
    // *after* it in the shared `pageDiv` — later in DOM order paints (and
    // hit-tests) on top with no explicit z-index needed, matching
    // `EpubRenderer`'s marks-pane sitting above its iframe.
    expect(textLayer.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    renderer.destroy();
  });

  it("M43 §A corrective: setActiveHighlight lifts a mark's fill-opacity, and clearing it restores the resting wash", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new PdfRenderer();
    renderer.applyTheme({
      bg: "#fff",
      text: "#000",
      accent: "#000",
      fontSerif: "serif",
      highlight: "#ff0",
      highlightActive: "#f80",
      border: "#ccc",
      kindColors: { rose: "#ff0000", sage: "#00ff00", honey: "#ffff00", slate: "#0000ff" },
      colorScheme: "light",
    });
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    renderer.paintMark("h1", { sectionIndex: 0, offset: 0, length: 1 }, "rose");
    const box = () =>
      (container.querySelector('.marginalia-pdf-highlight[data-highlight-id="h1"]') as HTMLElement).firstElementChild as HTMLElement;
    const restingOpacity = box().style.opacity;

    renderer.setActiveHighlight("h1");
    expect(Number(box().style.opacity)).toBeGreaterThan(Number(restingOpacity));

    renderer.setActiveHighlight(null);
    expect(box().style.opacity).toBe(restingOpacity);

    renderer.destroy();
  });

  it("D4: paginates page-to-page with next()/prev() and reports sectionEnd once at the last page", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    const renderer = new PdfRenderer();
    let sectionEndCount = 0;
    renderer.on("sectionEnd", () => {
      sectionEndCount += 1;
    });

    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    expect(container.querySelector(".marginalia-pdf-text-layer")?.textContent).toContain("quick brown fox");

    await renderer.next();
    expect(container.querySelector(".marginalia-pdf-text-layer")?.textContent).toContain("second page");
    expect(sectionEndCount).toBe(1);

    // Calling next() again at the last page reports the same arrival again
    // (a caller pressing "next" repeatedly at the end), not a second event
    // for the render that already fired one.
    await renderer.next();
    expect(sectionEndCount).toBe(1);

    await renderer.prev();
    expect(container.querySelector(".marginalia-pdf-text-layer")?.textContent).toContain("quick brown fox");

    renderer.destroy();
  });
});

// M41 §A2 (PDF.md §4/§7.5): "highlights are shared between reflow and
// native" — the section-aware path, exercised against the same two-page
// fixture but with real /text-sections and /pdf-sections responses this
// time (the M40 §D tests above never had those, so they only ever
// exercised the legacy single-section fallback).
describe("PdfRenderer — section-aware (M41 §A2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sections = [
    { spineIndex: 0, href: "section-000.xhtml", text: "Front matter. The quick brown fox jumps over the lazy dog." },
    { spineIndex: 1, href: "section-001.xhtml", text: "A second page of content, with more words to search for." },
  ];
  const pageSections = [0, 1]; // page 0 -> section 0, page 1 -> section 1
  const chapterTitles = { "0": "Chapter One", "1": "Chapter Two" };

  it("resolves a selection's Locator against the canonical section text, not raw pdf.js text", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetchWithSections(bytes, sections, pageSections, chapterTitles);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new PdfRenderer();
    const selections: { locator: { sectionIndex: number; offset: number; length: number } }[] = [];
    renderer.on("selected", (sel) => selections.push(sel));

    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    const textLayer = container.querySelector(".marginalia-pdf-text-layer") as HTMLElement;

    selectText(textLayer, "quick brown fox");
    textLayer.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(selections).toHaveLength(1);
    const loc = selections[0].locator;
    expect(loc.sectionIndex).toBe(0);
    // The canonical section text's own index of "quick brown fox" — proves
    // this isn't the raw-page-relative offset (the page's own text starts
    // differently, with no "Front matter." prefix).
    expect(loc.offset).toBe(sections[0].text.indexOf("quick brown fox"));
    expect(loc.length).toBe("quick brown fox".length);

    renderer.destroy();
  });

  it("a highlight pinned to a different section only paints once its own page renders", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetchWithSections(bytes, sections, pageSections, chapterTitles);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    const secondPageText = sections[1].text;
    const offset = secondPageText.indexOf("second page");
    renderer.paintMark("h-section-1", { sectionIndex: 1, offset, length: "second page".length }, "honey");

    // Still on page 0 (section 0) — a section-1 highlight has nothing to
    // paint against yet.
    expect(container.querySelector('.marginalia-pdf-highlight[data-highlight-id="h-section-1"]')).toBeNull();

    await renderer.next();
    expect(container.querySelector(".marginalia-pdf-text-layer")?.textContent).toContain("second page");
    expect(container.querySelector('.marginalia-pdf-highlight[data-highlight-id="h-section-1"]')).toBeTruthy();

    renderer.destroy();
  });

  it("goTo finds the right page for a section+offset it isn't currently showing", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetchWithSections(bytes, sections, pageSections, chapterTitles);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    expect(container.querySelector(".marginalia-pdf-text-layer")?.textContent).toContain("quick brown fox");

    const offset = sections[1].text.indexOf("second page");
    await renderer.goTo({ sectionIndex: 1, offset, length: "second page".length });
    expect(container.querySelector(".marginalia-pdf-text-layer")?.textContent).toContain("second page");

    renderer.destroy();
  });

  it("fires sectionEnd once per section arrival, not only at the document's end", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetchWithSections(bytes, sections, pageSections, chapterTitles);

    const container = document.createElement("div");
    const renderer = new PdfRenderer();
    let sectionEndCount = 0;
    renderer.on("sectionEnd", () => {
      sectionEndCount += 1;
    });

    // Page 0 is section 0's *only* page — arriving at it (mount) is already
    // arriving at the end of its section, unlike the legacy (single-
    // section) test above where sectionEnd only ever fires at the very end.
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    expect(sectionEndCount).toBe(1);

    await renderer.next();
    expect(sectionEndCount).toBe(2);

    renderer.destroy();
  });

  it("getToc returns one entry per section with its href, title, and cumulative percent", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetchWithSections(bytes, sections, pageSections, chapterTitles);

    const container = document.createElement("div");
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    const toc = renderer.getToc();
    expect(toc).toEqual([
      { label: "Chapter One", href: "section-000.xhtml", spineIndex: 0, percent: 0, depth: 0, offset: null },
      {
        label: "Chapter Two",
        href: "section-001.xhtml",
        spineIndex: 1,
        percent: (sections[0].text.length / (sections[0].text.length + sections[1].text.length)) * 100,
        depth: 0,
        offset: null,
      },
    ]);

    renderer.destroy();
  });

  // M42 §C4: the native pane's own copy of a section's depth-2+
  // subheadings, read from `resource.metadata.subheadings` rather than
  // parsed out of a generated EPUB's nav (that's the reflow pane's route).
  it("getToc interleaves a section's subheadings right after it, each with its own offset", async () => {
    const bytes = loadFixturePdf();
    const subheadings = { "0": [{ title: "1.1 Background", depth: 2, offset: 14 }] };
    stubResourceFetchWithSections(bytes, sections, pageSections, chapterTitles, subheadings);

    const container = document.createElement("div");
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    const toc = renderer.getToc();

    expect(toc.map((e) => ({ label: e.label, spineIndex: e.spineIndex, depth: e.depth, offset: e.offset }))).toEqual([
      { label: "Chapter One", spineIndex: 0, depth: 0, offset: null },
      { label: "1.1 Background", spineIndex: 0, depth: 2, offset: 14 },
      { label: "Chapter Two", spineIndex: 1, depth: 0, offset: null },
    ]);
    // The subheading shares its section's own href — a jump target within
    // it, not a spine item of its own.
    expect(toc[1].href).toBe("section-000.xhtml");

    renderer.destroy();
  });
});

describe("PdfRenderer — zoom/layout (M41 §C1, amended M43 §C2/§D1–D2)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to continuous scroll — the one paginated state needs an explicit, legible fit-spread selection", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    // Comfortably wide enough for a legible spread, so the only thing
    // keeping this out of the paginated state is the toggle's own default.
    mockContainerSize(container, 1600, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    expect(renderer.capabilities.advance).toBe("scroll");
    expect(renderer.capabilities.spread).toBe(false);
    expect(renderer.getZoomMode()).toBe("fit-page");

    renderer.destroy();
  });

  it("selecting fit-spread at a legible width is the one paginated state; zooming in drops back to scroll, zooming out snaps back", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    mockContainerSize(container, 1600, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    let layoutChanges = 0;
    renderer.onLayoutChanged(() => {
      layoutChanges += 1;
    });

    renderer.setZoomMode("fit-spread");
    expect(renderer.capabilities.advance).toBe("image");
    expect(renderer.capabilities.spread).toBe(true);
    expect(renderer.getZoomMode()).toBe("fit-spread");

    renderer.zoomIn();
    expect(renderer.capabilities.advance).toBe("scroll");
    expect(renderer.getZoomMode()).toBe("free");
    // Let the async DOM rebuild the capability flip already committed to
    // (synchronously, before relayout's own first await) actually settle —
    // several event-loop turns, not one, since renderPageInto chains
    // multiple real awaits (getPage, getTextContent).
    for (let i = 0; i < 10 && layoutChanges === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(layoutChanges).toBeGreaterThan(0);

    renderer.zoomOut();
    expect(renderer.capabilities.advance).toBe("image");
    expect(renderer.getZoomMode()).toBe("fit-spread");

    renderer.destroy();
  });

  it("fit-spread resolves to 1-up (no paginated state) at a width too narrow for a legible spread", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    mockContainerSize(container, 200, 260);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    renderer.setZoomMode("fit-spread");
    expect(renderer.getZoomMode()).toBe("fit-spread");
    // Selected, but not legible at this width — same fallback the
    // capability-profile table (PDF.md §7.6) already documented.
    expect(renderer.capabilities.advance).toBe("scroll");
    expect(renderer.capabilities.spread).toBe(false);

    renderer.destroy();
  });
});

describe("PdfRenderer — continuous zoom (M42 §D1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("setZoomScale commits userScale synchronously but defers the real re-render until the gesture pauses", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);
    const container = document.createElement("div");
    mockContainerSize(container, 800, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    expect(renderer.getZoomMode()).toBe("fit-page");

    let layoutChanges = 0;
    renderer.onLayoutChanged(() => (layoutChanges += 1));

    renderer.setZoomScale(3);
    // Synchronous: the gesture's target scale is live immediately (the
    // whole point — a slider/wheel/pinch reads this back mid-drag), well
    // before any real re-render has happened.
    expect(renderer.getZoomMode()).toBe("free");
    expect(layoutChanges).toBe(0);

    await waitFor(() => layoutChanges > 0);
    expect(renderer.getZoomPercent()).toBe(300);

    renderer.destroy();
  });

  it("several quick setZoomScale calls (a live drag/wheel/pinch) coalesce into exactly one real re-render", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);
    const container = document.createElement("div");
    mockContainerSize(container, 800, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    let layoutChanges = 0;
    renderer.onLayoutChanged(() => (layoutChanges += 1));

    // Each call resets the debounce — 15ms apart is well inside
    // ZOOM_COMMIT_DEBOUNCE_MS (120ms), so none of these should land a real
    // re-render on its own.
    for (let i = 0; i < 8; i++) {
      renderer.setZoomScale(1.5 + i * 0.1);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    expect(layoutChanges).toBe(0);

    await waitFor(() => layoutChanges > 0);
    expect(layoutChanges).toBe(1);
    // Lands on the last requested scale, not an intermediate one.
    expect(renderer.getZoomPercent()).toBe(Math.round((1.5 + 7 * 0.1) * 100));

    renderer.destroy();
  });

  it("snaps back to the active fit mode when the gesture settles back at (or below) the fit scale", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);
    const container = document.createElement("div");
    mockContainerSize(container, 800, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    let layoutChanges = 0;
    renderer.onLayoutChanged(() => (layoutChanges += 1));

    renderer.setZoomScale(0.01); // far below any real fit scale
    expect(renderer.getZoomMode()).toBe("fit-page");

    await waitFor(() => layoutChanges > 0);
    expect(renderer.getZoomMode()).toBe("fit-page");
    // M43 §D1: fit-page (never selected as fit-spread here) is never the
    // paginated state — this container would have been legible for a
    // spread under the old auto-derived model, which is exactly what this
    // test used to assert; scroll is now right regardless of width.
    expect(renderer.capabilities.advance).toBe("scroll");

    renderer.destroy();
  });

  it("applies a live CSS-transform preview to the rendered page immediately, ahead of the debounced real re-render", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);
    const container = document.createElement("div");
    mockContainerSize(container, 1600, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    // M43 §D2: `applyZoomPreview` only has a wrapper to scale in the one
    // paginated state (an explicit, legible fit-spread) — every other state
    // is continuous scroll, which mounts a scroll host instead (see
    // `applyZoomPreview`'s own comment on why it's a no-op there).
    let layoutChanges = 0;
    renderer.onLayoutChanged(() => (layoutChanges += 1));
    renderer.setZoomMode("fit-spread");
    await waitFor(() => layoutChanges > 0);
    expect(renderer.capabilities.advance).toBe("image");

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.transform).toBe("");

    renderer.setZoomScale(2.5);
    // Same node — the preview scales what's already on screen rather than
    // waiting for a fresh raster.
    expect(container.firstElementChild).toBe(wrapper);
    expect(wrapper.style.transform).toMatch(/^scale\(/);

    renderer.destroy();
  });

  it("a real (non-Ctrl) wheel scroll passes through untouched in continuous scroll — only Ctrl/Cmd+wheel zooms", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);
    const container = document.createElement("div");
    mockContainerSize(container, 800, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    expect(renderer.capabilities.advance).toBe("scroll");

    const plain = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    container.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(renderer.getZoomMode()).toBe("fit-page");

    const ctrlZoom = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true });
    container.dispatchEvent(ctrlZoom);
    expect(ctrlZoom.defaultPrevented).toBe(true);
    expect(renderer.getZoomMode()).toBe("free");

    renderer.destroy();
  });

  it("M43 §D3: a plain wheel scroll in the one paginated (spread) state turns the page instead, filtering sub-threshold deltas and cooldown-window repeats", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);
    const container = document.createElement("div");
    mockContainerSize(container, 1600, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    let layoutChanges = 0;
    renderer.onLayoutChanged(() => (layoutChanges += 1));
    renderer.setZoomMode("fit-spread");
    await waitFor(() => layoutChanges > 0);
    expect(renderer.capabilities.advance).toBe("image");

    const nextSpy = vi.spyOn(renderer, "next");

    // Below the threshold — not a real turn gesture (some trackpads fire a
    // near-zero tick on touch-down) — ignored entirely.
    const tiny = new WheelEvent("wheel", { deltaY: 2, cancelable: true });
    container.dispatchEvent(tiny);
    expect(tiny.defaultPrevented).toBe(false);
    expect(nextSpy).not.toHaveBeenCalled();

    // A real downward scroll turns the page forward...
    const down = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    container.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(nextSpy).toHaveBeenCalledTimes(1);

    // ...and a second one immediately after, inside the cooldown, is
    // swallowed — one turn per gesture, not one per wheel tick.
    const down2 = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    container.dispatchEvent(down2);
    expect(nextSpy).toHaveBeenCalledTimes(1);

    renderer.destroy();
  });

  it("M43 §D3: an upward scroll in the paginated state turns the page backward", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);
    const container = document.createElement("div");
    mockContainerSize(container, 1600, 1000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    let layoutChanges = 0;
    renderer.onLayoutChanged(() => (layoutChanges += 1));
    renderer.setZoomMode("fit-spread");
    await waitFor(() => layoutChanges > 0);

    const prevSpy = vi.spyOn(renderer, "prev");
    const up = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
    container.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(prevSpy).toHaveBeenCalledTimes(1);

    renderer.destroy();
  });
});

describe("PdfRenderer — spread advance (M41 §C1)", () => {
  it("a spread (pagesAcross === 2) makes a single next() call advance by 2 pages", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    // Wide enough to spread regardless of the fixture's own natural page
    // width — MIN_SPREAD_SCALE (0.6) needs containerWidth >= 1.2x the
    // natural width of *two* pages, and no real PDF page is anywhere near
    // this wide.
    mockContainerSize(container, 6000, 4000);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });
    // M43 §C2: spread is no longer automatic from container width alone —
    // it needs the explicit toggle too.
    renderer.setZoomMode("fit-spread");

    expect(renderer.capabilities.spread).toBe(true);
    // Legacy (no section data) path: `currentLocation().offset` is
    // `pageOffsets[pageIndex]` — 0 while anchored on page 0, and some
    // positive value (page 0's own text length) once genuinely on page 1.
    expect(renderer.currentLocation()?.offset).toBe(0);

    // The fixture has exactly 2 pages. A step of 2 from page 0 overflows
    // past the last page (index 1) and is blocked — `pageIndex` stays put.
    // A step of 1 (the bug this guards against) would instead successfully
    // land on page 1, changing the reported offset.
    await renderer.next();
    expect(renderer.currentLocation()?.offset).toBe(0);

    renderer.destroy();
  });
});
