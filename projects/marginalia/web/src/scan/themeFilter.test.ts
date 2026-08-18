import { describe, expect, it } from "vitest";
import type { ScanBookTheme } from "@marginalia/shared";
import { activeThemeNames } from "./themeFilter.js";

const bookThemes: ScanBookTheme[] = [
  { id: "t-1", name: "Isolation", colorIndex: 0, children: ["loneliness", "alienation"] },
  { id: "t-2", name: "Guilt", colorIndex: 1, children: ["shame"] },
];

describe("activeThemeNames", () => {
  it("returns null for no selection", () => {
    expect(activeThemeNames(null, bookThemes)).toBeNull();
  });

  it("expands a book-level selection to every child theme", () => {
    expect(activeThemeNames({ kind: "book", id: "t-1" }, bookThemes)).toEqual([
      "loneliness",
      "alienation",
    ]);
  });

  it("returns just the one name for a specific selection", () => {
    expect(activeThemeNames({ kind: "specific", name: "shame" }, bookThemes)).toEqual(["shame"]);
  });

  it("returns an empty array for a book-level id that no longer exists", () => {
    expect(activeThemeNames({ kind: "book", id: "gone" }, bookThemes)).toEqual([]);
  });
});
