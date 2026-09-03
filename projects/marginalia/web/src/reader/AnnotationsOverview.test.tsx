import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HighlightKind, HighlightWithThread } from "@marginalia/shared";
import { AnnotationsOverview } from "./AnnotationsOverview.js";

afterEach(cleanup);

const labels: Record<HighlightKind, string> = {
  rose: "Rose",
  sage: "Sage",
  honey: "Honey",
  slate: "Slate",
};

let seq = 0;
function highlight(overrides: Partial<HighlightWithThread>): HighlightWithThread {
  seq += 1;
  return {
    id: `h${seq}`,
    resourceId: "res-1",
    exact: "quoted text",
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
    createdAt: new Date(2026, 0, seq).toISOString(),
    thread: null,
    primaryHighlightId: null,
    ...overrides,
  };
}

// M36 A2/A3/A4: this is the counterpart to Glossary.test.tsx's
// glossaryEntries suite — same predicate, opposite direction.
describe("AnnotationsOverview — glossary exclusion (M36 A)", () => {
  it("excludes a defined sage highlight (a glossary entry) from the list", () => {
    const defined = highlight({ exact: "serendipity", kind: "sage", definition: "(noun) good luck" });
    render(
      <AnnotationsOverview
        highlights={[defined]}
        unanchoredIds={new Set()}
        onJumpTo={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        labels={labels}
      />,
    );
    expect(screen.queryByText(/serendipity/)).toBeNull();
    expect(screen.getByText("No highlights yet in this book.")).toBeTruthy();
  });

  it("keeps a plain sage highlight (no definition) in the list — it's an ordinary mark", () => {
    const plain = highlight({ exact: "just marked", kind: "sage" });
    render(
      <AnnotationsOverview
        highlights={[plain]}
        unanchoredIds={new Set()}
        onJumpTo={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        labels={labels}
      />,
    );
    expect(screen.getByText(/just marked/)).toBeTruthy();
  });

  it("keeps a defined sage highlight out even when it also carries a note (decided 2026-08-31: glossary only)", () => {
    const notedDefinition = highlight({
      exact: "noted word",
      kind: "sage",
      definition: "(noun) a thing",
      note: "my own gloss",
    });
    render(
      <AnnotationsOverview
        highlights={[notedDefinition]}
        unanchoredIds={new Set()}
        onJumpTo={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        labels={labels}
      />,
    );
    expect(screen.queryByText(/noted word/)).toBeNull();
  });

  it("counts only visible (non-glossary) highlights in the header", () => {
    const defined = highlight({ exact: "defined", kind: "sage", definition: "d" });
    const rose = highlight({ exact: "rose mark", kind: "rose" });
    render(
      <AnnotationsOverview
        highlights={[defined, rose]}
        unanchoredIds={new Set()}
        onJumpTo={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        labels={labels}
      />,
    );
    expect(screen.getByText("Annotations (1)")).toBeTruthy();
  });
});
