import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ReaderPage } from "./ReaderPage.js";

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function stubFetch(resource: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input === `/api/resources/${resource.id}`) {
        return { ok: true, json: async () => resource } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }),
  );
}

describe("ReaderPage", () => {
  // M39 §E3 (PDF.md §6): a scan (`textLayer: false`) has no reader at all in
  // this milestone — opening it must explain why rather than mounting
  // `ReaderView`, which would otherwise try to load a `.reflow.epub` that
  // was never generated for it.
  it("explains a scan's missing text layer instead of mounting the reader", async () => {
    stubFetch({
      id: "scan-1",
      title: "A Scanned Paper",
      author: null,
      format: "pdf",
      kind: "document",
      textLayer: false,
      metadata: {},
      importedAt: new Date().toISOString(),
    });

    render(
      <MemoryRouter initialEntries={["/read/scan-1"]}>
        <Routes>
          <Route path="/read/:id" element={<ReaderPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("No text layer — preview only. OCR isn't supported yet.")).toBeTruthy();
    expect(screen.getByText("A Scanned Paper")).toBeTruthy();
  });
});
