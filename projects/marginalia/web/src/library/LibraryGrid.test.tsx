import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ResourceSummary } from "@marginalia/shared";
import { LibraryGrid } from "./LibraryGrid.js";

function makeResource(overrides: Partial<ResourceSummary> = {}): ResourceSummary {
  return {
    id: "res-1",
    title: "A Scanned Paper",
    author: null,
    format: "pdf",
    kind: "document",
    textLayer: true,
    metadata: {},
    importedAt: new Date().toISOString(),
    highlightCount: 0,
    threadCount: 0,
    lastReadAt: null,
    shelf: null,
    ...overrides,
  };
}

afterEach(cleanup);

describe("LibraryGrid", () => {
  // M39 §E3 (PDF.md §6): a scan has zero `resource_text` rows — nothing to
  // highlight and nothing to narrate — so the card says so plainly instead
  // of "No highlights yet" and a "Listen" button that would open onto an
  // explanation rather than actually listening.
  it("says there's no text layer, and omits Listen, for a scan resource", () => {
    render(
      <MemoryRouter>
        <LibraryGrid resources={[makeResource({ textLayer: false })]} publishingId={null} onPublish={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText("No text layer — preview only. OCR isn't supported yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Listen" })).toBeNull();
  });

  it("shows the normal highlight count and Listen button for a resource with a text layer", () => {
    render(
      <MemoryRouter>
        <LibraryGrid
          resources={[makeResource({ textLayer: true, highlightCount: 3 })]}
          publishingId={null}
          onPublish={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("3 highlights")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Listen" })).toBeTruthy();
  });
});
