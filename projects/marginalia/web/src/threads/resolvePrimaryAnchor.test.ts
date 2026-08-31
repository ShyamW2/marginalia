import { describe, expect, it } from "vitest";
import type { HighlightWithThread } from "@marginalia/shared";
import { resolveOpenHighlightId } from "./resolvePrimaryAnchor.js";

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
