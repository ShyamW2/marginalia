/**
 * PDF.md §2: a PDF resource's id is `sha256(pdfBytes ‖ ":" ‖ EXTRACTOR_VERSION)`.
 * Bump by hand whenever a change to extraction (this directory) alters its
 * output — never in place. Re-importing under a new version produces a new,
 * separate resource beside the old one (decision 5); `cli/reanchorPdf.ts`
 * moves highlights across that boundary.
 */
export const EXTRACTOR_VERSION = 1;
