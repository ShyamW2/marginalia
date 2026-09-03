import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ResourceSummary } from "@marginalia/shared";
import { BookActionCard } from "./BookActionCard.js";

function makeResource(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    id: "res-1",
    title: "A Scanned Paper",
    author: "Some Author",
    format: "pdf",
    kind: "document",
    textLayer: true,
    metadata: {},
    importedAt: new Date().toISOString(),
    highlightCount: 2,
    threadCount: 1,
    lastReadAt: null,
    shelf: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("BookActionCard", () => {
  // M39 §E3 (PDF.md §6): with zero `resource_text` rows, Digest/Scan/Listen
  // would each open onto an empty surface — say so plainly and omit them,
  // rather than three controls that do nothing.
  it("says there's no text layer, and omits Digest/Scan/Listen, for a scan resource", () => {
    render(
      <MemoryRouter>
        <BookActionCard resource={makeResource({ textLayer: false })} publishing={false} onPublish={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("No text layer — preview only. OCR isn't supported yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Read digest" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open scan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Listen" })).toBeNull();
    // Publish stays — harmless for an empty book, and not what this scoped.
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  it("shows the normal meta row and every action for a resource with a text layer", () => {
    render(
      <MemoryRouter>
        <BookActionCard resource={makeResource({ textLayer: true })} publishing={false} onPublish={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("2 highlights")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Listen" })).toBeTruthy();
  });
});
