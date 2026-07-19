import AdmZip from "adm-zip";
import { Parser } from "htmlparser2";
import path from "node:path";
import type { ResourceMetadata } from "@marginalia/shared";

export interface ExtractedSpineItem {
  spineIndex: number;
  href: string;
  text: string;
}

export interface ExtractedEpub {
  title: string;
  author: string | null;
  metadata: ResourceMetadata;
  spine: ExtractedSpineItem[];
}

interface OpfManifestItem {
  href: string; // resolved to a path inside the zip
}

interface OpfResult {
  title: string;
  author: string | null;
  language?: string;
  publisher?: string;
  coverHref?: string;
  manifest: Map<string, OpfManifestItem>;
  spineIdRefs: string[];
}

const BOM = /^\uFEFF/;

/** Extracts title/author/spine text from an EPUB file's raw bytes. */
export function extractEpub(buffer: Buffer): ExtractedEpub {
  const zip = new AdmZip(buffer);

  const containerXml = readZipText(zip, "META-INF/container.xml");
  const opfPath = findRootfilePath(containerXml);
  const opfDir = path.posix.dirname(opfPath);

  const opfXml = readZipText(zip, opfPath);
  const opf = parseOpf(opfXml, opfDir);

  const spine: ExtractedSpineItem[] = [];
  opf.spineIdRefs.forEach((idref, index) => {
    const item = opf.manifest.get(idref);
    // A spine itemref pointing at an id absent from the manifest is
    // malformed EPUB; skip it rather than fail the whole import.
    if (!item) return;
    const html = readZipText(zip, item.href);
    spine.push({ spineIndex: index, href: item.href, text: htmlToText(html) });
  });

  const metadata: ResourceMetadata = {};
  if (opf.language) metadata.language = opf.language;
  if (opf.publisher) metadata.publisher = opf.publisher;
  if (opf.coverHref) metadata.coverHref = opf.coverHref;

  return {
    title: opf.title,
    author: opf.author,
    metadata,
    spine,
  };
}

function readZipText(zip: AdmZip, entryName: string): string {
  const entry = zip.getEntry(entryName);
  if (!entry) {
    throw new Error(`epub is missing expected entry: ${entryName}`);
  }
  return entry.getData().toString("utf-8").replace(BOM, "");
}

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** Guesses an image content-type from a cover entry's file extension. */
export function guessImageMimeType(href: string): string {
  return IMAGE_MIME_BY_EXTENSION[path.posix.extname(href).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Reads the resource's cover image bytes straight out of its stored EPUB
 * archive (immutable-on-import, so this is always the same bytes for a
 * given resource id — no derived file to cache separately). Returns
 * `undefined` if the EPUB has no declared cover or the entry is missing.
 */
export function extractCoverImage(
  epubFilePath: string,
  coverHref: string,
): Buffer | undefined {
  const zip = new AdmZip(epubFilePath);
  const entry = zip.getEntry(coverHref);
  return entry?.getData();
}

function findRootfilePath(containerXml: string): string {
  let rootfilePath: string | undefined;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (name === "rootfile" && attribs["full-path"] && !rootfilePath) {
          rootfilePath = attribs["full-path"];
        }
      },
    },
    { xmlMode: true },
  );
  parser.write(containerXml);
  parser.end();

  if (!rootfilePath) {
    throw new Error(
      "could not find an OPF rootfile in META-INF/container.xml",
    );
  }
  return rootfilePath;
}

function resolveZipPath(baseDir: string, href: string): string {
  const withoutFragment = href.split("#")[0] ?? href;
  const decoded = decodeURIComponent(withoutFragment);
  return path.posix.normalize(path.posix.join(baseDir, decoded));
}

const localName = (name: string): string =>
  name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;

function parseOpf(xml: string, opfDir: string): OpfResult {
  const manifest = new Map<string, OpfManifestItem>();
  const spineIdRefs: string[] = [];

  let title = "";
  let author = "";
  let language = "";
  let publisher = "";
  let coverManifestId: string | undefined;

  let capturing: "title" | "creator" | "language" | "publisher" | null = null;
  let titleCaptured = false;
  let creatorCaptured = false;
  let languageCaptured = false;
  let publisherCaptured = false;

  const parser = new Parser(
    {
      onopentag(name, attribs) {
        const local = localName(name);
        if (local === "title" && !titleCaptured) {
          capturing = "title";
        } else if (local === "creator" && !creatorCaptured) {
          capturing = "creator";
        } else if (local === "language" && !languageCaptured) {
          capturing = "language";
        } else if (local === "publisher" && !publisherCaptured) {
          capturing = "publisher";
        } else if (
          local === "meta" &&
          attribs.name === "cover" &&
          attribs.content
        ) {
          coverManifestId = attribs.content;
        } else if (local === "item" && attribs.id && attribs.href) {
          manifest.set(attribs.id, {
            href: resolveZipPath(opfDir, attribs.href),
          });
        } else if (local === "itemref" && attribs.idref) {
          spineIdRefs.push(attribs.idref);
        }
      },
      ontext(text) {
        if (capturing === "title") title += text;
        else if (capturing === "creator") author += text;
        else if (capturing === "language") language += text;
        else if (capturing === "publisher") publisher += text;
      },
      onclosetag(name) {
        const local = localName(name);
        if (local === "title" && capturing === "title") {
          capturing = null;
          titleCaptured = true;
        } else if (local === "creator" && capturing === "creator") {
          capturing = null;
          creatorCaptured = true;
        } else if (local === "language" && capturing === "language") {
          capturing = null;
          languageCaptured = true;
        } else if (local === "publisher" && capturing === "publisher") {
          capturing = null;
          publisherCaptured = true;
        }
      },
    },
    { xmlMode: true },
  );
  parser.write(xml);
  parser.end();

  const coverHref = coverManifestId
    ? manifest.get(coverManifestId)?.href
    : undefined;

  return {
    title: title.trim() || "Untitled",
    author: author.trim() || null,
    language: language.trim() || undefined,
    publisher: publisher.trim() || undefined,
    coverHref,
    manifest,
    spineIdRefs,
  };
}

const SKIP_TAGS = new Set(["script", "style", "head"]);
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "section",
  "article",
  "blockquote",
  "tr",
  "table",
  "ul",
  "ol",
  "hr",
  "header",
  "footer",
  "figure",
  "figcaption",
]);

/** Strips tags from an (X)HTML document, keeping rough paragraph breaks. */
export function htmlToText(html: string): string {
  let text = "";
  let skipDepth = 0;

  const parser = new Parser({
    onopentag(name) {
      if (SKIP_TAGS.has(name)) {
        skipDepth++;
      } else if (BLOCK_TAGS.has(name) && skipDepth === 0) {
        text += "\n";
      }
    },
    ontext(chunk) {
      if (skipDepth === 0) text += chunk;
    },
    onclosetag(name) {
      if (SKIP_TAGS.has(name)) skipDepth = Math.max(0, skipDepth - 1);
    },
  });
  parser.write(html);
  parser.end();

  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
