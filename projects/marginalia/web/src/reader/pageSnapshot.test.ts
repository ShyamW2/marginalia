import { describe, expect, it, vi } from "vitest";
import {
  buildOverlaySvg,
  buildSnapshotSvg,
  captureViewport,
  collectStyleText,
  inlineCssUrls,
  type CaptureViewport,
} from "./pageSnapshot.js";

const viewport: CaptureViewport = {
  width: 1102,
  height: 598,
  scrollX: 5510,
  scrollY: 0,
  contentWidth: 7714,
  contentHeight: 598,
};

/** A container/scroller/view/iframe chain with the layout numbers jsdom does
 * not compute, matching what epub.js actually builds (measured live,
 * NOTES.md 2026-08-02). */
function stubStage(overrides: { scrollWidth?: number; clientWidth?: number } = {}) {
  const container = document.createElement("div");
  const scroller = document.createElement("div");
  const view = document.createElement("div");
  const frame = document.createElement("iframe");
  container.append(scroller);
  scroller.append(view);
  view.append(frame);

  const define = (el: HTMLElement, values: Record<string, number>) => {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(el, key, { value, configurable: true });
    }
  };
  define(container, { scrollWidth: 1102, clientWidth: 1102, scrollHeight: 598, clientHeight: 598 });
  define(scroller, {
    scrollWidth: overrides.scrollWidth ?? 7714,
    clientWidth: overrides.clientWidth ?? 1102,
    scrollHeight: 598,
    clientHeight: 598,
    scrollLeft: 5510,
    scrollTop: 0,
  });
  define(frame, { offsetWidth: 7714, offsetHeight: 598 });
  return { container, scroller, view, frame };
}

describe("captureViewport", () => {
  it("finds the scrolling element by its overflow, not by class name", () => {
    // epub.js's `.epub-container` is a dependency's internal name and the
    // nesting depth is not ours to rely on — the first ancestor whose content
    // overflows it is the scroller by definition.
    const { container, frame } = stubStage();
    expect(captureViewport(container, frame)).toEqual({
      width: 1102,
      height: 598,
      scrollX: 5510,
      scrollY: 0,
      contentWidth: 7714,
      contentHeight: 598,
    });
  });

  it("falls back to the container when nothing overflows", () => {
    const { container, frame } = stubStage({ scrollWidth: 1102 });
    const result = captureViewport(container, frame);
    expect(result.width).toBe(1102);
    expect(result.scrollX).toBe(0);
  });
});

describe("buildSnapshotSvg", () => {
  it("translates the content so the scrolled-to page lands in the window", () => {
    // The whole point of the module: a paginated section is laid out many
    // viewports wide and the snapshot depicts one window into it.
    const svg = buildSnapshotSvg(viewport, "rgb(250, 247, 240)", "<p/>");
    expect(svg).toContain("margin-left:-5510px");
    expect(svg).toContain("width:7714px");
    expect(svg).toContain('width="1102" height="598"');
    expect(svg).toContain("background:rgb(250, 247, 240)");
  });

  it("clips the window and keeps the content positioned for the overlays", () => {
    const svg = buildSnapshotSvg(viewport, "#fff", "");
    expect(svg).toContain("overflow:hidden");
    expect(svg).toContain("position:relative");
  });
});

describe("buildOverlaySvg", () => {
  it("renders the marks through a foreignObject, not as bare SVG", () => {
    // marks-pane sizes its <svg> with a *CSS* `width: 7714px !important`,
    // which only means anything in an HTML formatting context. Nested
    // directly in SVG the element keeps its default 100% viewport and clips
    // away every rect past it — measured as a silent 0% highlight wash.
    const svg = buildOverlaySvg(viewport, "<svg/>");
    expect(svg).toContain("foreignObject");
    expect(svg).toContain("margin-left:-5510px");
  });

  it("is transparent, so it composites over the page rather than hiding it", () => {
    expect(buildOverlaySvg(viewport, "<svg/>")).toContain("background:transparent");
  });
});

describe("collectStyleText", () => {
  it("dumps rules rather than copying the <link>s that cannot load", () => {
    // epub.js serves the section's CSS from blob: URLs, which an SVG image
    // will not fetch; the rules behind them are readable and are what travel.
    const style = document.createElement("style");
    style.textContent = "p { color: rgb(1, 2, 3); }";
    document.head.append(style);
    try {
      expect(collectStyleText(document)).toContain("color: rgb(1, 2, 3)");
    } finally {
      style.remove();
    }
  });

  it("skips a sheet that refuses to expose its rules", () => {
    // A cross-origin sheet throws on `cssRules` by design. Losing its styling
    // is a worse-looking snapshot, never a failed one.
    const doc = {
      styleSheets: [
        {
          get cssRules(): CSSRuleList {
            throw new DOMException("cross-origin", "SecurityError");
          },
        },
      ],
    } as unknown as Document;
    expect(collectStyleText(doc)).toBe("");
  });
});

describe("inlineCssUrls", () => {
  it("inlines every url() so fonts and images cannot silently fall back", async () => {
    const fetchAsset = vi.fn(async (url: string) => `data:font/woff2;base64,${url.length}`);
    const css = '@font-face { src: url("blob:http://x/abc") format("woff2"); }';
    const out = await inlineCssUrls(css, fetchAsset);
    expect(out).toContain('url("data:font/woff2;base64,17")');
    expect(out).not.toContain("blob:");
  });

  it("leaves data: URIs alone and never refetches a repeated asset", async () => {
    const fetchAsset = vi.fn(async () => "data:image/png;base64,AAAA");
    const css = "a{background:url(blob:x)}b{background:url(blob:x)}c{background:url(data:image/gif;base64,B)}";
    await inlineCssUrls(css, fetchAsset);
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(fetchAsset).toHaveBeenCalledWith("blob:x");
  });

  it("keeps the original url() when the asset cannot be had", async () => {
    const css = "a{background:url(blob:gone)}";
    expect(await inlineCssUrls(css, async () => null)).toBe(css);
  });

  it("does no work at all when there is nothing to inline", async () => {
    const fetchAsset = vi.fn(async () => "data:,");
    expect(await inlineCssUrls("p{color:red}", fetchAsset)).toBe("p{color:red}");
    expect(fetchAsset).not.toHaveBeenCalled();
  });

  it("never fetches an @namespace declaration's url() — it is an identifier, not an asset", async () => {
    // M31 §0h, found live on the iPad: EPUB content CSS routinely opens with
    // exactly these two lines, and a real w3.org/idpf.org fetch always fails
    // (CORS) while costing a network round-trip the capture cannot afford.
    const fetchAsset = vi.fn(async () => "data:font/woff2;base64,AAAA");
    const css =
      '@namespace url(http://www.w3.org/1999/xhtml);\n' +
      '@namespace epub url("http://www.idpf.org/2007/ops");\n' +
      '@font-face { src: url("blob:http://x/abc") format("woff2"); }';
    const out = await inlineCssUrls(css, fetchAsset);
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(fetchAsset).toHaveBeenCalledWith("blob:http://x/abc");
    expect(out).toContain("@namespace url(http://www.w3.org/1999/xhtml);");
    expect(out).toContain('@namespace epub url("http://www.idpf.org/2007/ops");');
    expect(out).toContain('url("data:font/woff2;base64,AAAA")');
  });
});
