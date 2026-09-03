import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { extractPdf, PdfInvalidError } from "./extract.js";
import { blocksToText } from "./lines.js";

/** Builds a small real PDF in memory via pdfkit — an end-to-end fixture for
 *  `extractPdf`'s pdfjs-dist integration, distinct from the pure-function
 *  unit tests elsewhere in this directory which exercise each heuristic
 *  against synthetic `getTextContent()`-shaped items directly. */
async function buildFixturePdf(): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: "A Small Test Paper" } });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  for (const [pageIndex, body] of [
    "This is the first page of the test paper, with enough text in this paragraph to " +
      "read as a real page of prose rather than a caption or a stray fragment of a line.",
    "This is the second page, continuing the discussion from the previous one at some " +
      "length, so that a reader skimming the extracted text can tell the pages apart.",
    "This is the third and final page, wrapping up the paper's short argument with a " +
      "closing paragraph that is, again, long enough to look like real body text.",
  ].entries()) {
    if (pageIndex > 0) doc.addPage();
    doc.fontSize(9).text("Running Header — Test Paper", 50, 40);
    doc.fontSize(12).text(body, 50, 120, { width: 495 });
    doc.fontSize(9).text(`Page ${pageIndex + 1}`, 50, 780);
  }

  doc.end();
  return finished;
}

describe("extractPdf", () => {
  it("extracts every page's text, in order, with running headers/footers stripped", async () => {
    const buffer = await buildFixturePdf();

    const result = await extractPdf(buffer);

    expect(result.pages).toHaveLength(3);
    result.pages.forEach((page, index) => {
      expect(page.pageIndex).toBe(index);
      const text = blocksToText(page.blocks);
      expect(text).not.toContain("Running Header");
      expect(text).not.toMatch(/^Page \d/m);
    });

    expect(blocksToText(result.pages[0].blocks)).toContain("first page of the test paper");
    expect(blocksToText(result.pages[1].blocks)).toContain("second page, continuing");
    expect(blocksToText(result.pages[2].blocks)).toContain("third and final page");
  });

  it("reads the PDF's own title from its metadata", async () => {
    const buffer = await buildFixturePdf();

    const result = await extractPdf(buffer);

    expect(result.title).toBe("A Small Test Paper");
  });

  it("is not flagged as a scan when every page has real extracted text", async () => {
    const buffer = await buildFixturePdf();

    const result = await extractPdf(buffer);

    expect(result.isScan).toBe(false);
  });

  // M39 §C6 (PDF.md §2.1): "Corrupt or not actually a PDF" is a designed
  // failure state (`invalid_pdf`), not an unhandled crash.
  it("throws PdfInvalidError for bytes that aren't a real PDF", async () => {
    await expect(extractPdf(Buffer.from("this is not a pdf"))).rejects.toBeInstanceOf(PdfInvalidError);
  });

  it("reports per-page progress and stops promptly when aborted", async () => {
    const buffer = await buildFixturePdf();
    const seen: number[][] = [];

    const controller = new AbortController();
    const promise = extractPdf(buffer, {
      signal: controller.signal,
      onPage: (current, total) => {
        seen.push([current, total]);
        if (current === 1) controller.abort();
      },
    });

    await expect(promise).rejects.toThrow();
    expect(seen[0]).toEqual([1, 3]);
    // Aborted after page 1 — the loop must not have gone on to page 2 or 3.
    expect(seen).toHaveLength(1);
  });
});
