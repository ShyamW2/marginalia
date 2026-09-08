import AdmZip from "adm-zip";
import type { PdfBlock, PdfLine } from "./types.js";
import type { PdfSection } from "./sections.js";
import { linesToParagraphs } from "./lines.js";

export interface GeneratedEpub {
  buffer: Buffer;
  /** Keyed by `String(spineIndex)`, the same shape (and the same route
   *  `extractChapterTitles` populates it through, B4) as an imported EPUB's
   *  `metadata.chapterTitles`. */
  chapterTitles: Record<string, string>;
}

export interface GenerateReflowEpubParams {
  title: string;
  author: string | null;
  sections: PdfSection[];
  /** dc:identifier — pass the resource id once import (M39 §C) computes
   *  one. Falls back to a fixed placeholder so this module has no notion
   *  of resource identity of its own (§2's id computation is C1's job). */
  identifier?: string;
}

const OEBPS = "OEBPS";
// Fixed, not `new Date()` — PDF.md §2's "byte-reproducible... no timestamps"
// applies to every entry, and EPUB3 also requires a dcterms:modified meta.
const FIXED_TIMESTAMP = "2020-01-01T00:00:00Z";
const FIXED_ZIP_DATE = new Date(FIXED_TIMESTAMP);

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function padIndex(n: number): string {
  return String(n).padStart(3, "0");
}

interface ImageRef {
  id: string;
  href: string;
  buffer: Buffer;
}

/** Assigns every rasterized block a stable `images/fig-p<page>-<n>.png`
 *  href (PDF.md §3.5), `<n>` counting sequentially per page across the
 *  whole document — deterministic because sections and their blocks are
 *  already in document order (§2's byte-reproducibility). Blocks whose
 *  rasterization degraded (`image: null`, A0/A5/A6's ⚠️) get no image and
 *  are skipped entirely when the section XHTML is built. */
function collectImages(sections: PdfSection[]): Map<PdfBlock, ImageRef> {
  const refs = new Map<PdfBlock, ImageRef>();
  const countByPage = new Map<number, number>();
  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.kind !== "equation" && block.kind !== "figure" && block.kind !== "table") continue;
      if (!block.image) continue;
      const n = countByPage.get(block.page) ?? 0;
      countByPage.set(block.page, n + 1);
      const id = `img-p${block.page}-${n}`;
      refs.set(block, { id, href: `images/fig-p${block.page}-${n}.png`, buffer: block.image });
    }
  }
  return refs;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Drops the leading run of `line` blocks whose joined text matches the
 *  section's title exactly (whitespace-normalized) — the heading
 *  sections.ts derived the title from. A title built from an outline entry
 *  (rather than detected from the page's own heading text) may not match
 *  verbatim; when it doesn't, nothing is stripped, which just leaves the
 *  harmless duplication this function otherwise avoids rather than risking
 *  eating real body content on a false match. */
function stripLeadingTitleLines(blocks: PdfBlock[], title: string): PdfBlock[] {
  const normalizedTitle = normalizeWhitespace(title);
  let end = 0;
  let joined = "";
  while (end < blocks.length) {
    const block = blocks[end];
    if (block.kind !== "line") break;
    joined = normalizeWhitespace(joined ? `${joined} ${block.line.text}` : block.line.text);
    end++;
    if (joined === normalizedTitle) return blocks.slice(end);
    if (!normalizedTitle.startsWith(joined)) break;
  }
  return blocks;
}

function sectionXhtml(section: PdfSection, images: Map<PdfBlock, ImageRef>): string {
  const parts: string[] = [];
  let pendingLines: PdfLine[] = [];
  // M42 §C4: the id the *next* flush's first paragraph should carry — set
  // only when a subheading's own line is about to start a fresh pending
  // batch (see the forced break below).
  let pendingId = "";
  let nextSubIndex = 0;

  const flushParagraphs = () => {
    if (pendingLines.length === 0) return;
    linesToParagraphs(pendingLines).forEach((paragraph, i) => {
      const idAttr = i === 0 && pendingId ? ` id="${pendingId}"` : "";
      parts.push(`<p${idAttr}>${escapeXml(paragraph)}</p>`);
    });
    pendingLines = [];
    pendingId = "";
  };

  // The heading line(s) that gave this section its title are still the
  // first `line` block(s) in `section.blocks` (sections.ts never removes
  // them — `resource_text` legitimately includes a chapter's own heading,
  // matching how EPUB spine text already works). Only the `<h1>` above
  // should say the title; skip re-printing it as the first `<p>` too.
  const bodyBlocks = stripLeadingTitleLines(section.blocks, section.title);

  for (const block of bodyBlocks) {
    if (block.kind === "line") {
      // M42 §C4: a heading is always its own paragraph in the rendered
      // EPUB, whether or not the source PDF's own line spacing happens to
      // produce a gap/indent-based paragraph break there — real PDFs with
      // otherwise-uniform line spacing were found live not to (NOTES.md
      // "M42 — subheading offsets"), which left a subheading's line merged
      // into the *previous* paragraph and its `#loc-` anchor pointing at
      // nothing. `startsWith`, not exact equality: a coalesced multi-line
      // heading's *first* line is a prefix of the full (possibly
      // outline-derived, possibly non-verbatim — same trade-off
      // `stripLeadingTitleLines` above already accepts) title.
      const sub = section.subheadings[nextSubIndex];
      const lineText = normalizeWhitespace(block.line.text);
      // ⚠️ `lineText` must be checked non-empty before `startsWith` — an
      // *empty* string is a prefix of everything, so a blank line (there
      // are plenty, real PDFs found live) would otherwise satisfy this
      // check immediately and consume the subheading against the wrong,
      // blank paragraph, long before its real heading line ever arrives.
      if (sub && lineText && normalizeWhitespace(sub.title).startsWith(lineText)) {
        // Isolated as its own single-line paragraph, not merely started as
        // one — otherwise whatever body content follows with no gap of its
        // own (the same uniform-spacing shape above) would still fuse onto
        // the heading's paragraph, one flush too late.
        flushParagraphs();
        pendingLines.push(block.line);
        pendingId = `loc-${sub.offset}`;
        flushParagraphs();
        nextSubIndex++;
        continue;
      }
      pendingLines.push(block.line);
      continue;
    }
    flushParagraphs();

    const ref = images.get(block);
    if (!ref) continue; // degraded rasterization — nothing to embed (§3 ⚠️)

    if (block.kind === "equation") {
      parts.push(`<figure class="equation"><img src="${ref.href}" alt="Equation" /></figure>`);
    } else {
      const caption = block.caption ? escapeXml(block.caption) : "";
      const figcaption = caption ? `<figcaption>${caption}</figcaption>` : "";
      const className = block.kind === "table" ? ' class="table"' : "";
      parts.push(`<figure${className}><img src="${ref.href}" alt="${caption}" />${figcaption}</figure>`);
    }
  }
  flushParagraphs();

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml">',
    `<head><meta charset="utf-8" /><title>${escapeXml(section.title)}</title></head>`,
    "<body>",
    `<h1>${escapeXml(section.title)}</h1>`,
    ...parts,
    "</body>",
    "</html>",
  ].join("\n");
}

function buildContainerXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    "  <rootfiles>",
    `    <rootfile full-path="${OEBPS}/content.opf" media-type="application/oebps-package+xml"/>`,
    "  </rootfiles>",
    "</container>",
  ].join("\n");
}

function buildOpf(params: {
  title: string;
  author: string | null;
  identifier: string;
  sections: PdfSection[];
  images: ImageRef[];
}): string {
  const { title, author, identifier, sections, images } = params;

  const manifestItems = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    ...sections.map((s) => `<item id="section-${padIndex(s.spineIndex)}" href="${s.href}" media-type="application/xhtml+xml"/>`),
    ...images.map((img) => `<item id="${img.id}" href="${img.href}" media-type="image/png"/>`),
  ];

  const spineItems = sections.map((s) => `<itemref idref="section-${padIndex(s.spineIndex)}"/>`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `    <dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>`,
    `    <dc:title>${escapeXml(title)}</dc:title>`,
    "    <dc:language>en</dc:language>",
    ...(author ? [`    <dc:creator>${escapeXml(author)}</dc:creator>`] : []),
    `    <meta property="dcterms:modified">${FIXED_TIMESTAMP}</meta>`,
    "  </metadata>",
    `  <manifest>${manifestItems.join("")}</manifest>`,
    `  <spine toc="ncx">${spineItems.join("")}</spine>`,
    "</package>",
  ].join("\n");
}

/** An NCX alongside the EPUB3 nav — not for a hypothetical EPUB2 reader,
 *  but because `extractChapterTitles` (epub.ts) — the route B4 asks this
 *  to populate `metadata.chapterTitles` through — reads titles from the
 *  NCX's `navMap`, not the nav document (SPEC-GAP noted at epub.ts:80: no
 *  EPUB3 `nav.xhtml` parsing exists yet). Both documents are real and
 *  correct; this one is also what today's parser actually reads. */
function buildNcx(params: { title: string; identifier: string; sections: PdfSection[] }): string {
  const { title, identifier, sections } = params;
  // M42 §C4: a depth-2+ subheading gets its own nested `navPoint`, sharing
  // its parent section's `href` with a `#loc-<offset>` fragment —
  // `extractChapterTitles` (epub.ts) already resolves "several navPoints,
  // one href" by keeping the *first* title per href, so nesting these
  // under their section (listed before its children) doesn't disturb
  // `metadata.chapterTitles`, which still means the section's own title.
  let playOrder = 0;
  const navPoints = sections
    .map((s) => {
      playOrder++;
      const sectionPoint = `<navPoint id="navpoint-${playOrder}" playOrder="${playOrder}"><navLabel><text>${escapeXml(
        s.title,
      )}</text></navLabel><content src="${s.href}"/>`;
      const childPoints = s.subheadings
        .map((sub) => {
          playOrder++;
          return `<navPoint id="navpoint-${playOrder}" playOrder="${playOrder}"><navLabel><text>${escapeXml(
            sub.title,
          )}</text></navLabel><content src="${s.href}#loc-${sub.offset}"/></navPoint>`;
        })
        .join("");
      return `${sectionPoint}${childPoints}</navPoint>`;
    })
    .join("");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
    "  <head>",
    `    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>`,
    '    <meta name="dtb:depth" content="1"/>',
    "  </head>",
    `  <docTitle><text>${escapeXml(title)}</text></docTitle>`,
    `  <navMap>${navPoints}</navMap>`,
    "</ncx>",
  ].join("\n");
}

function buildNav(params: { sections: PdfSection[] }): string {
  // M42 §C4: a depth-2+ subheading nests inside its section's own `<li>`
  // as a plain EPUB3 nav sub-list, jumping to the same file's `#loc-<offset>`
  // in-page anchor rather than a separate spine item.
  const items = params.sections
    .map((s) => {
      const subItems = s.subheadings
        .map((sub) => `<li><a href="${s.href}#loc-${sub.offset}">${escapeXml(sub.title)}</a></li>`)
        .join("");
      const nested = subItems ? `<ol>${subItems}</ol>` : "";
      return `<li><a href="${s.href}">${escapeXml(s.title)}</a>${nested}</li>`;
    })
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">',
    '<head><meta charset="utf-8" /><title>Table of Contents</title></head>',
    "<body>",
    '<nav epub:type="toc" id="toc"><h1>Table of Contents</h1><ol>',
    items,
    "</ol></nav>",
    "</body>",
    "</html>",
  ].join("\n");
}

/**
 * PDF.md §4.1/B2–B4: generates a real, valid EPUB (container.xml, an OPF
 * with a spine in reading order, embedded figure images, a real EPUB 3 nav
 * document, and an NCX so `extractChapterTitles` populates
 * `metadata.chapterTitles`). Byte-reproducible for the same `sections` —
 * every id and filename is derived from `spineIndex`/page index, nothing
 * from `Date.now()` or object/map iteration order, and every zip entry's
 * timestamp is pinned to `FIXED_ZIP_DATE`.
 */
export function generateReflowEpub(params: GenerateReflowEpubParams): GeneratedEpub {
  const { title, author, sections, identifier = "urn:marginalia:reflow" } = params;

  const images = [...collectImages(sections).entries()];
  const imageRefs = images.map(([, ref]) => ref);
  const imagesByBlock = new Map(images);

  const zip = new AdmZip();
  const addEntry = (entryName: string, content: Buffer | string) => {
    const entry = zip.addFile(entryName, Buffer.isBuffer(content) ? content : Buffer.from(content, "utf-8"));
    entry.header.time = FIXED_ZIP_DATE;
  };

  addEntry("mimetype", "application/epub+zip");
  addEntry("META-INF/container.xml", buildContainerXml());
  addEntry(
    `${OEBPS}/content.opf`,
    buildOpf({ title, author, identifier, sections, images: imageRefs }),
  );
  addEntry(`${OEBPS}/nav.xhtml`, buildNav({ sections }));
  addEntry(`${OEBPS}/toc.ncx`, buildNcx({ title, identifier, sections }));
  for (const section of sections) {
    addEntry(`${OEBPS}/${section.href}`, sectionXhtml(section, imagesByBlock));
  }
  for (const ref of imageRefs) {
    addEntry(`${OEBPS}/${ref.href}`, ref.buffer);
  }

  const chapterTitles: Record<string, string> = {};
  for (const section of sections) chapterTitles[String(section.spineIndex)] = section.title;

  return { buffer: zip.toBuffer(), chapterTitles };
}
