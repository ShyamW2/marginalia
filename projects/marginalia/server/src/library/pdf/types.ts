/**
 * Shared shapes for the PDF extractor (PDF.md §3). Deliberately narrow and
 * decoupled from pdfjs-dist's own types — `extract.ts` is the only module
 * that touches pdfjs-dist directly, everything downstream works off this.
 */

/** One glyph run from `page.getTextContent()`, flattened to what §3's
 *  heuristics actually use. `x`/`y` are `transform[4]`/`transform[5]` — PDF
 *  user space, origin bottom-left, y increasing upward. */
export interface RawTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

/** One assembled line (§3.3) — several `RawTextItem`s joined left to right. */
export interface PdfLine {
  items: RawTextItem[];
  text: string;
  /** Baseline y of the line (its first item's y). */
  y: number;
  leftEdge: number;
  /** Representative font size — the median item height on the line. */
  fontSize: number;
  fontNames: string[];
}

/** A rasterized region replacing a run of the page — an equation band
 *  (§3.4) or a figure/table (§3.5). `image` is null when rasterization
 *  degraded (canvas unavailable or threw) — the block still holds its
 *  place in reading order but contributes no picture. */
export interface PdfRasterBlock {
  kind: "equation" | "figure";
  image: Buffer | null;
  /** Figure only: the caption text, already present as its own `line`
   *  block in the surrounding flow — carried here only for the `<figure>`'s
   *  alt/figcaption when the generated EPUB is built (B2). */
  caption?: string;
  y: number;
  /** The source page — PDF.md §3.5's `images/fig-p<page>-<n>.png` naming,
   *  applied when the generated EPUB embeds it (B2). */
  page: number;
}

export type PdfBlock = { kind: "line"; line: PdfLine } | PdfRasterBlock;

export interface PdfPageContent {
  pageIndex: number;
  width: number;
  height: number;
  /** In final reading order: header/footer stripped, columns resolved,
   *  equations and figures replaced by raster blocks. */
  blocks: PdfBlock[];
}

export interface ExtractedPdf {
  title: string | null;
  /** PDF's own outline (bookmarks), if present — §4's first fallback rung. */
  outline: PdfOutlineEntry[];
  pages: PdfPageContent[];
  /** True when >50% of pages yielded under 100 extracted characters —
   *  PDF.md §6. The scan-detection decision, computed once at extraction
   *  time so callers don't re-derive it. */
  isScan: boolean;
}

export interface PdfOutlineEntry {
  title: string;
  /** 0-based page index this entry resolves to. Null when the destination
   *  couldn't be resolved to a page (a named destination pdfjs didn't know). */
  pageIndex: number | null;
  /** The destination's y in PDF user space, if resolvable — used to split a
   *  page's text at the heading rather than rounding to the page boundary
   *  (PDF.md §4 ⚠️). Null when unresolvable. */
  y: number | null;
}
