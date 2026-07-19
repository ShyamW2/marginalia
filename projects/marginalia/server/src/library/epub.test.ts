import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractCoverImage, extractEpub, guessImageMimeType, htmlToText } from "./epub.js";
import { WORKSPACE_ROOT } from "../paths.js";

const aliceBuffer = fs.readFileSync(
  path.join(WORKSPACE_ROOT, "fixtures", "alice-in-wonderland.epub"),
);
const metamorphosisBuffer = fs.readFileSync(
  path.join(WORKSPACE_ROOT, "fixtures", "metamorphosis.epub"),
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

  it("extracts title, author, and spine for Metamorphosis", () => {
    const result = extractEpub(metamorphosisBuffer);
    expect(result.title).toBe("Metamorphosis");
    expect(result.author).toBe("Franz Kafka");
    expect(result.spine).toHaveLength(5);
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
});

describe("extractCoverImage", () => {
  const aliceFilePath = path.join(WORKSPACE_ROOT, "fixtures", "alice-in-wonderland.epub");
  const metamorphosisFilePath = path.join(
    WORKSPACE_ROOT,
    "fixtures",
    "metamorphosis.epub",
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
    const metamorphosis = extractEpub(metamorphosisBuffer);

    const aliceCover = extractCoverImage(aliceFilePath, alice.metadata.coverHref!);
    const metamorphosisCover = extractCoverImage(
      metamorphosisFilePath,
      metamorphosis.metadata.coverHref!,
    );

    expect(aliceCover).toEqual(extractCoverImage(aliceFilePath, alice.metadata.coverHref!));
    expect(aliceCover).not.toEqual(metamorphosisCover);
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
