import { describe, expect, it } from "vitest";
import type { HighlightWithThread } from "@marginalia/shared";
import { groupHighlightsByThread, groupPrimary, resolveOpenHighlightId } from "./resolvePrimaryAnchor.js";

function highlight(overrides: Partial<HighlightWithThread> = {}): HighlightWithThread {
  return {
    id: "h-1",
    resourceId: "res-1",
    exact: "quote",
    prefix: "",
    suffix: "",
    cfi: "epubcfi(/6/4!/4/2)",
    spineIndex: 0,
    kind: "rose",
    origin: "reader",
    importance: 0,
    note: "",
    panelDx: 0,
    panelDy: 0,
    panelWidth: null,
    panelHeight: null,
    offset: null,
    length: null,
    definition: "",
    definitionSource: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    thread: null,
    primaryHighlightId: null,
    ...overrides,
  };
}

describe("resolveOpenHighlightId", () => {
  it("resolves an ordinary highlight (no thread, no primary) to itself", () => {
    const pool = [highlight({ id: "h-1" })];
    expect(resolveOpenHighlightId(pool, "h-1")).toBe("h-1");
  });

  it("resolves a thread's own primary highlight to itself", () => {
    const pool = [
      highlight({ id: "h-primary", thread: { id: "t-1", hasAnswer: true, messageCount: 2 } }),
    ];
    expect(resolveOpenHighlightId(pool, "h-primary")).toBe("h-primary");
  });

  it("resolves a secondary anchor to its thread's primary", () => {
    const pool = [
      highlight({ id: "h-primary", thread: { id: "t-1", hasAnswer: true, messageCount: 2 } }),
      highlight({ id: "h-secondary", thread: null, primaryHighlightId: "h-primary" }),
    ];
    expect(resolveOpenHighlightId(pool, "h-secondary")).toBe("h-primary");
  });

  it("falls back to the given id when it isn't found in the pool at all", () => {
    expect(resolveOpenHighlightId([], "missing")).toBe("missing");
  });
});

describe("groupHighlightsByThread", () => {
  it("keeps an ordinary highlight (no thread) as its own group of one", () => {
    const pool = [highlight({ id: "h-1" }), highlight({ id: "h-2" })];
    const groups = groupHighlightsByThread(pool);
    expect(groups).toEqual([[pool[0]], [pool[1]]]);
  });

  it("groups a primary and its secondary anchors under the primary's own id, regardless of list order", () => {
    const primary = highlight({ id: "h-primary", thread: { id: "t-1", hasAnswer: false, messageCount: 1 } });
    const secondaryA = highlight({ id: "h-sec-a", primaryHighlightId: "h-primary" });
    const secondaryB = highlight({ id: "h-sec-b", primaryHighlightId: "h-primary" });
    const other = highlight({ id: "h-other" });
    const groups = groupHighlightsByThread([secondaryA, primary, other, secondaryB]);
    // Order-preserving on first sighting: secondaryA is seen first, so its
    // group's position is where the group lands, even though the primary
    // itself appears later in the input.
    expect(groups).toEqual([[secondaryA, primary, secondaryB], [other]]);
  });
});

describe("groupPrimary", () => {
  it("picks the primary out of a mixed group", () => {
    const primary = highlight({ id: "h-primary", thread: { id: "t-1", hasAnswer: true, messageCount: 3 } });
    const secondary = highlight({ id: "h-sec", primaryHighlightId: "h-primary" });
    expect(groupPrimary([secondary, primary])).toBe(primary);
  });

  it("falls back to the first member for a threadless group of one", () => {
    const solo = highlight({ id: "h-solo" });
    expect(groupPrimary([solo])).toBe(solo);
  });
});
