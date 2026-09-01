import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { HighlightWithThread } from "@marginalia/shared";
import { Glossary, glossaryEntries, isGlossaryEntry, sortGlossaryEntries } from "./Glossary.js";

afterEach(cleanup);

let seq = 0;
function highlight(overrides: Partial<HighlightWithThread>): HighlightWithThread {
  seq += 1;
  return {
    id: `h${seq}`,
    resourceId: "res-1",
    exact: "word",
    prefix: "",
    suffix: "",
    cfi: "epubcfi(/6/4!/4/2)",
    spineIndex: 0,
    kind: "sage",
    origin: "reader",
    importance: 0,
    note: "",
    panelDx: 0,
    panelDy: 0,
    panelWidth: null,
    panelHeight: null,
    definition: "",
    definitionSource: "",
    createdAt: new Date(2026, 0, seq).toISOString(),
    thread: null,
    primaryHighlightId: null,
    ...overrides,
  };
}

describe("glossaryEntries", () => {
  it("is a filtered view: sage highlights that carry a definition, and nothing else", () => {
    const entries = glossaryEntries([
      highlight({ exact: "defined", definition: "(noun) a thing", definitionSource: "dictionary" }),
      // A sage highlight the reader made by hand — an annotation, not a
      // glossary entry. This is the case a `glossary` table would get wrong.
      highlight({ exact: "just marked" }),
      // A definition on some other kind can't exist today, but the filter
      // says "sage AND defined" rather than trusting that.
      highlight({ exact: "quoted", kind: "honey", definition: "(noun) a thing" }),
      highlight({ exact: "whitespace only", definition: "   " }),
    ]);

    expect(entries.map((e) => e.exact)).toEqual(["defined"]);
  });

  it("keeps the server's reading order rather than re-sorting", () => {
    // The server returns `ORDER BY spine_index, created_at`; the glossary is
    // "in reading order" precisely because it preserves that.
    const entries = glossaryEntries([
      highlight({ exact: "first", spineIndex: 1, definition: "d" }),
      highlight({ exact: "second", spineIndex: 4, definition: "d" }),
      highlight({ exact: "third", spineIndex: 9, definition: "d" }),
    ]);
    expect(entries.map((e) => e.exact)).toEqual(["first", "second", "third"]);
  });

  it("drops an entry the moment its definition is cleared — no separate cleanup step", () => {
    const defined = highlight({ exact: "ephemeral", definition: "(noun) a thing" });
    expect(glossaryEntries([defined])).toHaveLength(1);
    expect(glossaryEntries([{ ...defined, definition: "" }])).toHaveLength(0);
  });

  // M36 A4: a note on a definition highlight must not pull it back into
  // Annotations — `isGlossaryEntry` (which this is built on) stays a
  // two-condition test with no "...unless noted" clause.
  it("keeps a noted definition glossary-only", () => {
    const noted = highlight({ exact: "noted", definition: "(noun) a thing", note: "my own gloss" });
    expect(glossaryEntries([noted]).map((e) => e.exact)).toEqual(["noted"]);
  });
});

describe("isGlossaryEntry (M36 A1)", () => {
  it("is the exact predicate glossaryEntries filters with, exported for AnnotationsOverview to share", () => {
    const defined = highlight({ definition: "(noun) a thing" });
    const plain = highlight({});
    expect(isGlossaryEntry(defined)).toBe(true);
    expect(isGlossaryEntry(plain)).toBe(false);
    expect(glossaryEntries([defined, plain])).toEqual([defined]);
  });
});

describe("sortGlossaryEntries (M36 B)", () => {
  const first = highlight({ exact: "banana", spineIndex: 0, definition: "d", createdAt: "2026-01-03T00:00:00.000Z" });
  const second = highlight({ exact: "apple", spineIndex: 5, definition: "d", createdAt: "2026-01-01T00:00:00.000Z" });
  const third = highlight({ exact: "cherry", spineIndex: 2, definition: "d", createdAt: "2026-01-02T00:00:00.000Z" });
  const entries = [first, second, third];

  it("reading order is a passthrough — the server's spineIndex, createdAt order", () => {
    expect(sortGlossaryEntries(entries, "reading")).toEqual(entries);
  });

  it("A-Z sorts on the headword", () => {
    expect(sortGlossaryEntries(entries, "alpha").map((e) => e.exact)).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });

  it("chronological sorts on when the word was looked up, not where it sits in the book", () => {
    expect(sortGlossaryEntries(entries, "chrono").map((e) => e.exact)).toEqual([
      "apple",
      "cherry",
      "banana",
    ]);
  });
});

describe("Glossary", () => {
  it("lists exactly the defined words, with where each definition came from", () => {
    render(
      <Glossary
        highlights={[
          highlight({ exact: "serendipity", definition: "(noun) good luck", definitionSource: "dictionary" }),
          highlight({ exact: "grok", definition: "to understand deeply", definitionSource: "digest" }),
          highlight({ exact: "unmarked" }),
        ]}
        unanchoredIds={new Set()}
        sort="reading"
        onSortChange={vi.fn()}
        onJumpTo={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("serendipity")).toBeTruthy();
    expect(screen.getByText("grok")).toBeTruthy();
    expect(screen.queryByText("unmarked")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Glossary for this book" })).toBeTruthy();
    // The two paths are told apart in the list, not just in the card.
    expect(screen.getByText("Dictionary")).toBeTruthy();
    expect(screen.getByText("From the digest")).toBeTruthy();
  });

  it("jumps to the passage on click", () => {
    const onJumpTo = vi.fn();
    const entry = highlight({ exact: "serendipity", definition: "(noun) good luck" });
    render(
      <Glossary
        highlights={[entry]}
        unanchoredIds={new Set()}
        sort="reading"
        onSortChange={vi.fn()}
        onJumpTo={onJumpTo}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("serendipity"));
    expect(onJumpTo).toHaveBeenCalledWith(entry);
  });

  it("keeps an unanchored entry readable but not jumpable", () => {
    const entry = highlight({ exact: "serendipity", definition: "(noun) good luck" });
    render(
      <Glossary
        highlights={[entry]}
        unanchoredIds={new Set([entry.id])}
        sort="reading"
        onSortChange={vi.fn()}
        onJumpTo={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // The definition survives losing its anchor; only the jump is disabled.
    expect(screen.getByText("(noun) good luck")).toBeTruthy();
    expect(screen.getByRole("button", { name: /serendipity/ }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a designed empty state rather than an empty list", () => {
    render(
      <Glossary
        highlights={[highlight({ exact: "unmarked" })]}
        unanchoredIds={new Set()}
        sort="reading"
        onSortChange={vi.fn()}
        onJumpTo={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nothing defined yet/)).toBeTruthy();
  });

  it("offers the three sort modes and reports the reader's choice", () => {
    const onSortChange = vi.fn();
    render(
      <Glossary
        highlights={[
          highlight({ exact: "banana", definition: "d" }),
          highlight({ exact: "apple", definition: "d" }),
        ]}
        unanchoredIds={new Set()}
        sort="reading"
        onSortChange={onSortChange}
        onJumpTo={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "A–Z" }));
    expect(onSortChange).toHaveBeenCalledWith("alpha");
  });

  it("hides the sort control when there's nothing to sort", () => {
    render(
      <Glossary
        highlights={[highlight({ exact: "solo", definition: "d" })]}
        unanchoredIds={new Set()}
        sort="reading"
        onSortChange={vi.fn()}
        onJumpTo={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole("group", { name: "Sort the glossary" })).toBeNull();
  });
});
