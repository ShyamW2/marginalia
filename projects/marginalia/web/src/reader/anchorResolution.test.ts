import { describe, expect, it } from "vitest";
import { findAnchorInText, resolveAnchor } from "./anchorResolution.js";

describe("findAnchorInText", () => {
  it("finds the exact match using prefix+exact+suffix context", () => {
    const text = "Alice was beginning to get very tired of sitting by her sister.";
    const match = findAnchorInText(text, {
      prefix: "Alice was ",
      exact: "beginning",
      suffix: " to get",
    });
    expect(match).toEqual({ start: 10, end: 19 });
    expect(text.slice(match!.start, match!.end)).toBe("beginning");
  });

  it("falls back to the exact text alone when the surrounding context has drifted", () => {
    const text = "Something else entirely, but the White Rabbit ran past.";
    const match = findAnchorInText(text, {
      prefix: "no longer here ",
      exact: "White Rabbit",
      suffix: " no longer here either",
    });
    expect(match).toEqual({ start: 33, end: 45 });
    expect(text.slice(match!.start, match!.end)).toBe("White Rabbit");
  });

  it("returns null when neither the full context nor the exact text is found", () => {
    const text = "This passage does not contain the quoted text at all.";
    const match = findAnchorInText(text, {
      prefix: "before ",
      exact: "missing phrase",
      suffix: " after",
    });
    expect(match).toBeNull();
  });
});

describe("resolveAnchor", () => {
  const anchor = { prefix: "before ", exact: "target", suffix: " after" };
  const sectionText = "before target after";

  it("resolves via CFI when it points at a valid, non-collapsed range", () => {
    const result = resolveAnchor({
      tryCfi: () => ({ collapsed: false }),
      sectionText,
      anchor,
    });
    expect(result.status).toBe("cfi");
  });

  it("falls back to text search when the CFI is broken (throws)", () => {
    const result = resolveAnchor({
      tryCfi: () => {
        throw new Error("invalid cfi");
      },
      sectionText,
      anchor,
    });
    expect(result).toEqual({
      status: "fallback",
      match: { start: 7, end: 13 },
    });
  });

  it("falls back to text search when the CFI resolves to a collapsed (empty) range", () => {
    const result = resolveAnchor({
      tryCfi: () => ({ collapsed: true }),
      sectionText,
      anchor,
    });
    expect(result.status).toBe("fallback");
  });

  it("flags unanchored when the CFI is broken and the text search also fails", () => {
    const result = resolveAnchor({
      tryCfi: () => null,
      sectionText: "nothing relevant in this section",
      anchor,
    });
    expect(result).toEqual({ status: "unanchored" });
  });
});
