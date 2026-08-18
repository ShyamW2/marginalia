import { describe, expect, it } from "vitest";
import type { SearchHit } from "@marginalia/shared";
import { hitsForSection, searchHitSourceLabel, stepFindCursor } from "./findCursor.js";

function hit(spineIndex: number): SearchHit {
  return {
    source: "text",
    spineIndex,
    offset: 0,
    percent: 0,
    snippet: "",
    anchor: { prefix: "", exact: "x", suffix: "" },
    highlightId: null,
  };
}

describe("stepFindCursor", () => {
  it("returns -1 when there are no hits", () => {
    expect(stepFindCursor(-1, 0, "next")).toBe(-1);
    expect(stepFindCursor(-1, 0, "prev")).toBe(-1);
  });

  it("lands on the first hit going next from nothing selected", () => {
    expect(stepFindCursor(-1, 5, "next")).toBe(0);
  });

  it("lands on the last hit going prev from nothing selected", () => {
    expect(stepFindCursor(-1, 5, "prev")).toBe(4);
  });

  it("steps forward and wraps past the last hit", () => {
    expect(stepFindCursor(0, 3, "next")).toBe(1);
    expect(stepFindCursor(2, 3, "next")).toBe(0);
  });

  it("steps backward and wraps past the first hit", () => {
    expect(stepFindCursor(1, 3, "prev")).toBe(0);
    expect(stepFindCursor(0, 3, "prev")).toBe(2);
  });

  it("wraps correctly with only one hit", () => {
    expect(stepFindCursor(0, 1, "next")).toBe(0);
    expect(stepFindCursor(0, 1, "prev")).toBe(0);
  });
});

describe("hitsForSection", () => {
  it("returns only the hits in the given section, with their original index", () => {
    const hits = [hit(0), hit(1), hit(1), hit(2)];
    expect(hitsForSection(hits, 1)).toEqual([
      { hit: hits[1], index: 1 },
      { hit: hits[2], index: 2 },
    ]);
  });

  it("returns an empty array when nothing matches the section", () => {
    expect(hitsForSection([hit(0), hit(1)], 9)).toEqual([]);
  });
});

describe("searchHitSourceLabel", () => {
  it("gives every source a distinct, human-legible label", () => {
    const labels = [
      searchHitSourceLabel("text"),
      searchHitSourceLabel("highlight"),
      searchHitSourceLabel("note"),
      searchHitSourceLabel("thread"),
    ];
    expect(new Set(labels).size).toBe(4);
  });
});
