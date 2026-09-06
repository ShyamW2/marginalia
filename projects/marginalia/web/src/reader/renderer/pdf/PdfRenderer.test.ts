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
      return { ok: true, json: async () => ({ metadata: { chapterTitles } }) };
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
    expect(renderer.capabilities).toEqual({
      spread: false,
      fontScale: false,
      margins: false,
      pageFold: false,
      pageNumbers: false,
      textSelection: true,
      zoom: true,
      advance: "image",
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
      { label: "Chapter One", href: "section-000.xhtml", spineIndex: 0, percent: 0, depth: 0 },
      {
        label: "Chapter Two",
        href: "section-001.xhtml",
        spineIndex: 1,
        percent: (sections[0].text.length / (sections[0].text.length + sections[1].text.length)) * 100,
        depth: 0,
      },
    ]);

    renderer.destroy();
  });
});

describe("PdfRenderer — zoom/layout (M41 §C1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("zooming in past the fit-width scale switches to continuous scroll; zooming back down snaps to paginated", async () => {
    const bytes = loadFixturePdf();
    stubResourceFetch(bytes);

    const container = document.createElement("div");
    // Small on purpose — a low fit scale means only a few zoomIn() steps are
    // needed to cross it.
    mockContainerSize(container, 200, 260);
    const renderer = new PdfRenderer();
    await renderer.mount(container, { id: "fixture" }, { flow: "paginated", spread: "auto", fontScale: 1, marginPx: 0 });

    expect(renderer.capabilities.advance).toBe("image");
    expect(renderer.getZoomMode()).toBe("fit-width");

    let layoutChanges = 0;
    renderer.onLayoutChanged(() => {
      layoutChanges += 1;
    });

    for (let i = 0; i < 20 && renderer.capabilities.advance !== "scroll"; i++) {
      renderer.zoomIn();
    }
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

    for (let i = 0; i < 20 && renderer.capabilities.advance !== "image"; i++) {
      renderer.zoomOut();
    }
    expect(renderer.capabilities.advance).toBe("image");
    expect(renderer.getZoomMode()).toBe("fit-width");

    renderer.destroy();
  });

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
