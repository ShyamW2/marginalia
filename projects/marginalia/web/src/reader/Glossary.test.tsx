import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { HighlightWithThread } from "@marginalia/shared";
import { Glossary, glossaryEntries } from "./Glossary.js";

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
        onJumpTo={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nothing defined yet/)).toBeTruthy();
  });
});
