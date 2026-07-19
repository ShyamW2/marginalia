import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";

describe("App", () => {
  it("renders the library route by default", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    // Routes are code-split (React.lazy) — chunk resolution is async even
    // when instant, so the route's content can't be asserted synchronously.
    expect(screen.getByText("Marginalia")).toBeTruthy();
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
});
