import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NavCluster } from "./NavCluster.js";
import { ChromeSlotProvider } from "./chromeSlot.js";
import { JobsProvider } from "../jobs/JobsContext.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";

afterEach(cleanup);

// Found live 2026-08-23: the reader's embedded NavCluster (ReaderView,
// M24.7 A) is mounted inside a route's `<Routes location>` override, whose
// `useLocation()` is permanently pinned to that route's own path — it can
// never see `/settings` open above it. Before `settingsOpen`/
// `onCloseSettings` existed, that instance's own `location.pathname ===
// "/settings"` toggle check silently always read "not open", so every `s`
// press took the "open" branch and stacked another `/settings` entry
// instead of closing the one already showing (n presses needed n Escapes to
// undo). These tests exercise exactly that trap directly on NavCluster,
// without needing the full reader/epub.js stack to reproduce the route
// nesting that causes it.
describe("NavCluster settings toggle", () => {
  it("closes via onCloseSettings when settingsOpen is true, even though the local route's location isn't /settings", () => {
    const onCloseSettings = vi.fn();
    render(
      <MemoryRouter initialEntries={["/read/book-1"]}>
        <JobsProvider>
          <ChromeSlotProvider>
            <NavCluster settingsTab="reading" settingsOpen onCloseSettings={onCloseSettings} />
          </ChromeSlotProvider>
        </JobsProvider>
      </MemoryRouter>,
    );

    fireEvent.keyDown(window, { key: SHORTCUT_KEYS.settings });

    expect(onCloseSettings).toHaveBeenCalledTimes(1);
  });
});
