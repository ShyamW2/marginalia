import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, type Location } from "react-router-dom";
import { App, findOverlayPathname } from "./App.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";

// This suite doesn't use vitest's `globals: true`, so RTL's automatic
// afterEach cleanup never registers — without this, each `render()` below
// piles onto the previous test's DOM instead of replacing it, and two tests
// both landing on /settings collide on "found multiple Settings headings".
afterEach(cleanup);

/** Builds just enough of a `Location` for `findOverlayPathname` — it only
 * ever reads `.pathname` and `.state.background`. */
function loc(pathname: string, background?: Location): Location {
  return { pathname, search: "", hash: "", state: background ? { background } : null, key: "test" } as Location;
}

describe("App", () => {
  it("renders the library route by default", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    // Routes are code-split (React.lazy) — chunk resolution is async even
    // when instant, so the route's content can't be asserted synchronously.
    // The floating nav cluster (M19.7) is App-level, not code-split, so it's
    // there immediately.
    expect(screen.getByRole("link", { name: "Library" })).toBeTruthy();
    expect(await screen.findByText("Your library is empty")).toBeTruthy();
  });

  it("renders the settings route", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
  });

  it("`s` closes settings when it's already open, instead of stacking a second /settings entry", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "s" });

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull());
    expect(await screen.findByText("Your library is empty")).toBeTruthy();
  });

  it.each([SHORTCUT_KEYS.desk, SHORTCUT_KEYS.list])(
    "%s closes an open Settings and lands on the desk (M22.5)",
    async (key) => {
      render(
        <MemoryRouter initialEntries={["/settings"]}>
          <App />
        </MemoryRouter>,
      );
      expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();

      fireEvent.keyDown(window, { key });

      await waitFor(() => expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull());
      expect(await screen.findByText("Your library is empty")).toBeTruthy();
    },
  );
});

describe("findOverlayPathname", () => {
  it("finds a prefix at the current location", () => {
    expect(findOverlayPathname(loc("/scan/book-1"), "/scan/")).toBe("/scan/book-1");
  });

  it("finds a prefix one level back, behind an open Settings", () => {
    const scan = loc("/scan/book-1");
    expect(findOverlayPathname(loc("/settings", scan), "/scan/")).toBe("/scan/book-1");
  });

  it("walks the whole chain — a Settings stacked on a Settings stacked on a Scan (M22.5)", () => {
    const scan = loc("/scan/book-1");
    const settingsOverScan = loc("/settings", scan);
    const settingsOverSettings = loc("/settings", settingsOverScan);
    expect(findOverlayPathname(settingsOverSettings, "/scan/")).toBe("/scan/book-1");
  });

  it("returns null when the prefix isn't anywhere in the chain", () => {
    expect(findOverlayPathname(loc("/settings", loc("/")), "/scan/")).toBeNull();
  });
});
