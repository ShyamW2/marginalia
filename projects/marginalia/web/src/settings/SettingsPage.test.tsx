import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  ProviderProfile,
  ProviderRoleAssignment,
  Settings,
  UsageSummary,
} from "@marginalia/shared";
import { SettingsPage } from "./SettingsPage.js";

const SETTINGS: Settings = {
  vaultPath: "",
  cursorStyle: "custom",
  cursorTrailEnabled: true,
  spreadMode: "single",
  readerMargin: "normal",
  readerFontScale: 1,
  scanCrtIntensity: 0.6,
  pageNumberMode: "off",
  maxResponseTokens: 8192,
  digestTokenBudget: 0,
};

const DEFAULT_PROFILE: ProviderProfile = {
  id: "default",
  name: "Default",
  provider: "anthropic",
  anthropicModel: "claude-opus-4-8",
  anthropicApiKey: "",
  claudeAgentModel: "claude-sonnet-5",
  openaiBaseUrl: "",
  openaiModel: "",
  openaiApiKey: "",
  openaiContextTokens: 32768,
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

const ROLES: ProviderRoleAssignment[] = [
  { role: "query", profileId: "default", profile: DEFAULT_PROFILE, configured: false },
  { role: "digest", profileId: "default", profile: DEFAULT_PROFILE, configured: false },
];

const USAGE_SUMMARY: UsageSummary = {
  today: { inputTokens: 0, outputTokens: 0, costUsd: null, callCount: 0, provenance: "estimated", byBookAndOperation: [] },
  last7Days: { inputTokens: 0, outputTokens: 0, costUsd: null, callCount: 0, provenance: "estimated", byBookAndOperation: [] },
  lastDigest: null,
  planLimits: [],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// This project's vitest.config.ts doesn't set `globals: true`, so
// @testing-library/react's import-time auto-cleanup (which checks for a
// *global* `afterEach`) never registers — every other test file here either
// doesn't use RTL or renders distinguishable content per test, so the leak
// went unnoticed. This file renders the same SettingsPage repeatedly, so
// leftover DOM from a prior test directly collides with the next query.
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/settings")) return jsonResponse(SETTINGS);
      if (url.includes("/api/provider-profiles")) return jsonResponse([DEFAULT_PROFILE]);
      if (url.includes("/api/provider-roles")) return jsonResponse(ROLES);
      if (url.includes("/api/usage/summary")) return jsonResponse(USAGE_SUMMARY);
      return jsonResponse({});
    }),
  );
});

describe("SettingsPage binder", () => {
  it("renders a real tablist with all six dividers", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage />
      </MemoryRouter>,
    );

    const tablist = await screen.findByRole("tablist", { name: "Settings sections" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Reading", "LLM", "Usage", "Scan", "Audio", "Desk"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].getAttribute("tabIndex") ?? tabs[0].tabIndex).not.toBe(-1);
  });

  it("switching to the LLM tab shows both provider roles", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage />
      </MemoryRouter>,
    );

    const tablist = await screen.findByRole("tablist", { name: "Settings sections" });
    fireEvent.click(within(tablist).getByRole("tab", { name: "LLM" }));

    expect(await screen.findByRole("heading", { name: "Query" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Digest" })).toBeTruthy();
  });

  it("arrow keys move focus and selection across the tablist (WAI-ARIA tabs pattern)", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage />
      </MemoryRouter>,
    );

    const tablist = await screen.findByRole("tablist", { name: "Settings sections" });
    const readingTab = within(tablist).getByRole("tab", { name: "Reading" });
    const llmTab = within(tablist).getByRole("tab", { name: "LLM" });

    readingTab.focus();
    fireEvent.keyDown(readingTab, { key: "ArrowRight" });

    expect(llmTab.getAttribute("aria-selected")).toBe("true");
    expect(readingTab.getAttribute("aria-selected")).toBe("false");
    expect(document.activeElement).toBe(llmTab);
  });

  it("opens directly to the LLM divider when location.state requests it (the reader/scan pickers' click-through)", async () => {
    render(
      <MemoryRouter
        initialEntries={[{ pathname: "/settings", state: { settingsTab: "llm" } }]}
      >
        <SettingsPage />
      </MemoryRouter>,
    );

    const tablist = await screen.findByRole("tablist", { name: "Settings sections" });
    expect(within(tablist).getByRole("tab", { name: "LLM" }).getAttribute("aria-selected")).toBe("true");
  });

  it("the Usage tab has no Save bar (read-only), unlike Reading/Scan/Desk", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SettingsPage />
      </MemoryRouter>,
    );

    const tablist = await screen.findByRole("tablist", { name: "Settings sections" });
    expect(screen.queryByRole("button", { name: "Save" })).toBeTruthy(); // default Reading tab

    fireEvent.click(within(tablist).getByRole("tab", { name: "Usage" }));
    await screen.findByText(/Loading usage|Couldn't load usage|Today/);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
