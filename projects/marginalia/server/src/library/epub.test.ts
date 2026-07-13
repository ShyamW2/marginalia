import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractEpub, htmlToText } from "./epub.js";
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
