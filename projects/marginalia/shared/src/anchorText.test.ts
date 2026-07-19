import { describe, expect, it } from "vitest";
import { findAnchorInText } from "./anchorText.js";

describe("findAnchorInText — whitespace-insensitive fallback", () => {
  it("finds text across a newline where the anchor's exact has a plain space (e.g. a <br> extracted as \\n)", () => {
    const text = "One morning, when Gregor Samsa woke from troubled dreams, he found himself\ntransformed in his bed.";
    const match = findAnchorInText(text, {
      exact: "he found himself transformed in his bed",
      prefix: "dreams, ",
      suffix: ".",
    });
    expect(match).not.toBeNull();
    expect(text.slice(match!.start, match!.start + 17)).toBe("he found himself\n");
  });

  it("still prefers the byte-exact match when one exists (fast path untouched)", () => {
    const text = "before target after";
    const match = findAnchorInText(text, { prefix: "before ", exact: "target", suffix: " after" });
    expect(match).toEqual({ start: 7, end: 13 });
  });

  it("returns null when the text is genuinely absent even after normalizing whitespace", () => {
    const text = "this passage has nothing in common with the anchor";
    const match = findAnchorInText(text, {
      exact: "completely different words",
      prefix: "",
      suffix: "",
    });
    expect(match).toBeNull();
  });
});
