import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { hashPdfBuffer } from "./importPdf.js";
import { EXTRACTOR_VERSION } from "./pdf/version.js";

/**
 * `importPdf` itself writes real files under `LIBRARY_DIR` and touches the
 * singleton db (same shape as `importEpub`, which has no direct test either
 * for the same reason) — covered by live driving per M39's own acceptance
 * note (TASKS.md: "not a headless milestone"), not a unit test here. This
 * file covers the one pure, safety-critical piece: PDF.md §2's identity
 * rule, `sha256(pdfBytes ‖ ":" ‖ EXTRACTOR_VERSION)`.
 */
describe("hashPdfBuffer", () => {
  it("matches PDF.md §2's formula exactly", () => {
    const buffer = Buffer.from("pdf bytes");
    const expected = crypto
      .createHash("sha256")
      .update(buffer)
      .update(`:${EXTRACTOR_VERSION}`)
      .digest("hex");

    expect(hashPdfBuffer(buffer)).toBe(expected);
  });

  it("is deterministic for the same bytes", () => {
    const buffer = Buffer.from("same bytes");
    expect(hashPdfBuffer(buffer)).toBe(hashPdfBuffer(Buffer.from(buffer)));
  });

  it("differs for different bytes", () => {
    expect(hashPdfBuffer(Buffer.from("a"))).not.toBe(hashPdfBuffer(Buffer.from("b")));
  });
});
