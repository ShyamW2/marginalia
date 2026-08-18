import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ScanBookTheme } from "@marginalia/shared";
import { ThemeFilterKey } from "./ThemeFilterKey.js";

// The suite runs without `globals: true` — see SearchResultsCard.test.tsx's
// identical comment for why cleanup must be explicit here too.
afterEach(cleanup);

const bookThemes: ScanBookTheme[] = [
  { id: "t-1", name: "Isolation", colorIndex: 0, children: ["loneliness", "alienation"] },
  { id: "t-2", name: "Guilt", colorIndex: 1, children: ["shame"] },
];

describe("ThemeFilterKey", () => {
  it("falls back to the flat dropdown when no distillation has run yet", () => {
    const onSelectionChange = vi.fn();
    render(
      <ThemeFilterKey
        bookThemes={[]}
        themeVocabulary={["loneliness", "shame"]}
        selection={null}
        onSelectionChange={onSelectionChange}
      />,
    );
    const select = screen.getByLabelText("Filter by theme") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "shame" } });
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "specific", name: "shame" });
  });

  it("selects a book-level theme on click, and clears it on a second click", () => {
    const onSelectionChange = vi.fn();
    render(
      <ThemeFilterKey
        bookThemes={bookThemes}
        themeVocabulary={["loneliness", "alienation", "shame"]}
        selection={null}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Isolation" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "book", id: "t-1" });

    cleanup();
    onSelectionChange.mockClear();
    render(
      <ThemeFilterKey
        bookThemes={bookThemes}
        themeVocabulary={["loneliness", "alienation", "shame"]}
        selection={{ kind: "book", id: "t-1" }}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Isolation" }));
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it("reveals specific themes underneath a book-level theme on disclosure toggle", () => {
    const onSelectionChange = vi.fn();
    render(
      <ThemeFilterKey
        bookThemes={bookThemes}
        themeVocabulary={["loneliness", "alienation", "shame"]}
        selection={null}
        onSelectionChange={onSelectionChange}
      />,
    );
    expect(screen.queryByRole("button", { name: "loneliness" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show specific themes under Isolation" }));
    fireEvent.click(screen.getByRole("button", { name: "loneliness" }));
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "specific", name: "loneliness" });
  });
});
