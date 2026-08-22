import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SearchResultsCard } from "./SearchResultsCard.js";
import type { SearchResultRow } from "./searchRows.js";

function row(index: number, overrides: Partial<SearchResultRow> = {}): SearchResultRow {
  return {
    index,
    before: "on the ",
    match: "roof",
    after: ", and the sound",
    source: "Book text",
    chapter: "Chapter Three",
    page: `p. ${100 + index}`,
    percent: `${10 + index}%`,
    ...overrides,
  };
}

function renderCard(props: Partial<Parameters<typeof SearchResultsCard>[0]> = {}) {
  const onSelect = vi.fn();
  const onOpenInScan = vi.fn();
  const bounds = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
  bounds.current = document.createElement("div");
  render(
    <SearchResultsCard
      rows={[row(0), row(1), row(2)]}
      currentIndex={1}
      query="roof"
      loading={false}
      onSelect={onSelect}
      onClose={() => {}}
      appBoundsRef={bounds as React.RefObject<HTMLDivElement>}
      reversed={false}
      onToggleReversed={() => {}}
      onOpenInScan={onOpenInScan}
      {...props}
    />,
  );
  return { onSelect, onOpenInScan };
}

// The suite runs without `globals: true`, so testing-library's automatic
// cleanup never arms itself — without this every render in this file stacks
// up in the same document and the queries below start matching the previous
// test's card.
afterEach(cleanup);

describe("SearchResultsCard", () => {
  it("shows one row per hit, with page and percent, under one sticky chapter header", () => {
    renderCard();
    expect(screen.getAllByRole("button", { name: /roof/ })).toHaveLength(3);
    expect(screen.getByText("p. 101")).toBeTruthy();
    expect(screen.getByText("11%")).toBeTruthy();
    // The chapter name moved to the sticky group header (M24.7 §E) — it no
    // longer repeats on every row.
    expect(screen.getAllByText("Chapter Three")).toHaveLength(1);
  });

  it("selects by the hit's index in the result set, not by row position", () => {
    // A result set the card is only showing the tail of: the row's own
    // number is what `‹ ›` steps, so the click must carry that, never the
    // position in this list.
    const { onSelect } = renderCard({ rows: [row(7), row(8)], currentIndex: -1 });
    fireEvent.click(screen.getAllByRole("button", { name: /roof/ })[1]);
    expect(onSelect).toHaveBeenCalledWith(8);
  });

  it("marks the hit the cursor is standing on", () => {
    renderCard();
    const current = screen.getAllByRole("button", { name: /roof/ })[1];
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.getAttribute("data-hit-index")).toBe("1");
  });

  it("says so when a query found nothing", () => {
    renderCard({ rows: [], currentIndex: -1 });
    expect(screen.getByText(/Nothing found for/)).toBeTruthy();
  });

  it("counts the results and the chapters they fall in", () => {
    renderCard();
    expect(screen.getByText("3 in 1 chapter")).toBeTruthy();
  });

  it("keeps hits from two different chapters under two separate headers", () => {
    renderCard({ rows: [row(0), row(1, { chapter: "Chapter Four" })], currentIndex: -1 });
    expect(screen.getByText("Chapter Three")).toBeTruthy();
    expect(screen.getByText("Chapter Four")).toBeTruthy();
    expect(screen.getByText("2 in 2 chapters")).toBeTruthy();
  });

  it("shift+enter on a row hands that hit off to the Scan", () => {
    const { onOpenInScan } = renderCard();
    const current = screen.getAllByRole("button", { name: /roof/ })[2];
    fireEvent.keyDown(current, { key: "Enter", shiftKey: true });
    expect(onOpenInScan).toHaveBeenCalledWith(2);
  });
});
