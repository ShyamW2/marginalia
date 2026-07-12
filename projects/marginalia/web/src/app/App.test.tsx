import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App.js";

describe("App", () => {
  it("renders the library route by default", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByText("Marginalia")).toBeTruthy();
    expect(screen.getByText("Your library is empty")).toBeTruthy();
  });

  it("renders the settings route", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  });
});
