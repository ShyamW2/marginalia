import { describe, expect, it } from "vitest";
import { formatPageNumber } from "./pageNumber.js";

describe("formatPageNumber", () => {
  it("is null when off, regardless of what data is available", () => {
    expect(formatPageNumber("off", 10, 200, 3, 20)).toBeNull();
  });

  it("book mode reports 1-based location index/total", () => {
    expect(formatPageNumber("book", 0, 799, null, null)).toBe("Page 1 of 800");
    expect(formatPageNumber("book", 399, 799, null, null)).toBe("Page 400 of 800");
  });

  it("book mode is null while locations haven't generated or loaded yet", () => {
    expect(formatPageNumber("book", null, null, 3, 20)).toBeNull();
  });

  it("chapter mode reports epub.js's own displayed page/total unchanged", () => {
    expect(formatPageNumber("chapter", null, null, 3, 20)).toBe("Page 3 of 20");
  });

  it("chapter mode is null before epub.js has reported a displayed page", () => {
    expect(formatPageNumber("chapter", 5, 900, null, null)).toBeNull();
  });
});
