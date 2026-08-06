import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractCoverImage, extractEpub, guessImageMimeType, htmlToText } from "./epub.js";
import { WORKSPACE_ROOT } from "../paths.js";

const aliceBuffer = fs.readFileSync(
  path.join(WORKSPACE_ROOT, "fixtures", "alice-in-wonderland.epub"),
);
// The second fixture is a *different* book on purpose — several tests below
// only mean something across two distinct files. Both fixtures are Project
// Gutenberg texts marked "Public domain in the USA" (SHIPPING.md rung 1
// step 3); nothing here may use a fixture whose translation is still in
// copyright.
const jekyllBuffer = fs.readFileSync(
  path.join(WORKSPACE_ROOT, "fixtures", "jekyll-and-hyde.epub"),
);

describe("extractEpub", () => {
  it("extracts title and author from Alice in Wonderland", () => {
    const result = extractEpub(aliceBuffer);
    expect(result.title).toBe("Alice's Adventures in Wonderland");
    expect(result.author).toBe("Lewis Carroll");
    expect(result.metadata.language).toBe("en");
  });

  it("extracts every spine item, in order, with mostly non-empty text", () => {
    const result = extractEpub(aliceBuffer);
    expect(result.spine).toHaveLength(14);
    result.spine.forEach((item, index) => {
      expect(item.spineIndex).toBe(index);
    });
    // The cover page (spine item 0) is an image-only wrapper with no text —
    // every other spine item must have extracted text.
    result.spine.slice(1).forEach((item) => {
      expect(item.text.length).toBeGreaterThan(0);
    });

    const combined = result.spine.map((item) => item.text).join("\n");
    expect(combined).toContain("White Rabbit");
  });

  it("extracts title, author, and spine for Jekyll and Hyde", () => {
    const result = extractEpub(jekyllBuffer);
    // Lowercase "strange" is what the file's own dc:title says — asserting
    // the metadata as published, not as we'd like it capitalised.
    expect(result.title).toBe("The strange case of Dr. Jekyll and Mr. Hyde");
    expect(result.author).toBe("Robert Louis Stevenson");
    expect(result.spine).toHaveLength(13);
    // The cover page (spine item 0) is an image-only wrapper with no text.
    for (const item of result.spine.slice(1)) {
      expect(item.text.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic across repeated extractions of the same bytes", () => {
    const a = extractEpub(aliceBuffer);
    const b = extractEpub(aliceBuffer);
    expect(a).toEqual(b);
  });

  it("extracts chapter titles from the NCX, keyed by spine index, one per href", () => {
    const result = extractEpub(jekyllBuffer);
    // The real toc.ncx has 13 navPoints but only 12 distinct spine hrefs:
    // the title page and "Contents" share one href via different #fragments
    // (#pgepubid00000 / #pgepubid00001), so the first navPoint's label wins
    // that href and "Contents" never appears. That collision is the point of
    // this test — a replacement fixture without one would not exercise it.
    expect(result.metadata.chapterTitles).toEqual({
      "1": "The Strange Case Of Dr. Jekyll And Mr. Hyde",
      "2": "STORY OF THE DOOR",
      "3": "SEARCH FOR MR. HYDE",
      "4": "DR. JEKYLL WAS QUITE AT EASE",
      "5": "THE CAREW MURDER CASE",
      "6": "INCIDENT OF THE LETTER",
      "7": "INCIDENT OF DR. LANYON",
      "8": "INCIDENT AT THE WINDOW",
      "9": "THE LAST NIGHT",
      "10": "DR. LANYON’S NARRATIVE",
      "11": "HENRY JEKYLL’S FULL STATEMENT OF THE CASE",
      "12": "THE FULL PROJECT GUTENBERG™ LICENSE",
    });
  });

  it("Alice's real chapter titles resolve too, not just Jekyll and Hyde's", () => {
    const result = extractEpub(aliceBuffer);
    expect(result.metadata.chapterTitles).toBeDefined();
    expect(Object.keys(result.metadata.chapterTitles!).length).toBeGreaterThan(0);
    for (const [spineIndex, title] of Object.entries(result.metadata.chapterTitles!)) {
      expect(result.spine[Number(spineIndex)]).toBeDefined();
      expect(title.length).toBeGreaterThan(0);
    }
  });
});

describe("extractCoverImage", () => {
  const aliceFilePath = path.join(WORKSPACE_ROOT, "fixtures", "alice-in-wonderland.epub");
  const jekyllFilePath = path.join(
    WORKSPACE_ROOT,
    "fixtures",
    "jekyll-and-hyde.epub",
  );

  it("reads the declared cover's real bytes out of the archive", () => {
    const { metadata } = extractEpub(aliceBuffer);
    expect(metadata.coverHref).toBeDefined();

    const data = extractCoverImage(aliceFilePath, metadata.coverHref!);
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThan(0);
    // JPEG magic bytes — confirms this is real image data, not the zip
    // entry's raw text or something malformed.
    expect(data!.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });

  it("is deterministic and file-specific across two different books", () => {
    const alice = extractEpub(aliceBuffer);
    const jekyll = extractEpub(jekyllBuffer);

    const aliceCover = extractCoverImage(aliceFilePath, alice.metadata.coverHref!);
    const jekyllCover = extractCoverImage(
      jekyllFilePath,
      jekyll.metadata.coverHref!,
    );

    expect(aliceCover).toEqual(extractCoverImage(aliceFilePath, alice.metadata.coverHref!));
    expect(aliceCover).not.toEqual(jekyllCover);
  });

  it("returns undefined for a cover path absent from the archive", () => {
    expect(extractCoverImage(aliceFilePath, "OEBPS/does-not-exist.jpg")).toBeUndefined();
  });
});

describe("guessImageMimeType", () => {
  it("maps common cover extensions to their content-type", () => {
    expect(guessImageMimeType("OEBPS/cover.jpg")).toBe("image/jpeg");
    expect(guessImageMimeType("OEBPS/cover.jpeg")).toBe("image/jpeg");
    expect(guessImageMimeType("OEBPS/cover.PNG")).toBe("image/png");
    expect(guessImageMimeType("OEBPS/cover.gif")).toBe("image/gif");
    expect(guessImageMimeType("OEBPS/cover.svg")).toBe("image/svg+xml");
    expect(guessImageMimeType("OEBPS/cover.webp")).toBe("image/webp");
  });

  it("falls back to a generic binary type for an unrecognized extension", () => {
    expect(guessImageMimeType("OEBPS/cover.bmp")).toBe("application/octet-stream");
  });
});

describe("htmlToText", () => {
  it("drops head/title content and keeps only the body text", () => {
    const html = `<html><head><title>Secret Title</title></head><body><p>Visible text</p></body></html>`;
    expect(htmlToText(html)).toBe("Visible text");
  });

  it("strips script and style content", () => {
    const html = `<body><style>.x{color:red}</style><p>Kept</p><script>alert(1)</script></body>`;
    expect(htmlToText(html)).toBe("Kept");
  });

  it("inserts newlines at block boundaries", () => {
    const html = `<body><p>First</p><p>Second</p></body>`;
    expect(htmlToText(html)).toBe("First\nSecond");
  });
});
