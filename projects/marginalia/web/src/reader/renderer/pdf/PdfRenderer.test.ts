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
