import { describe, expect, it } from "vitest";
import { isReaderOrigin } from "./highlightOrigin.js";

describe("isReaderOrigin", () => {
  it("is true for a reader-made highlight", () => {
    expect(isReaderOrigin({ origin: "reader" })).toBe(true);
  });

  it("is false for a thematic-origin highlight", () => {
    expect(isReaderOrigin({ origin: "thematic" })).toBe(false);
  });
});
