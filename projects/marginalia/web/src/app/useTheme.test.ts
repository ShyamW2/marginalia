import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@marginalia/shared";
import { useTheme } from "./useTheme.js";
import { resetAppearanceSettingsCache } from "./appearanceSync.js";

const STORAGE_KEY = "marginalia:theme";

function mockSettingsResponse(uiTheme: Settings["uiTheme"]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ uiTheme }) as Settings,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  resetAppearanceSettingsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTheme", () => {
  it("paints from localStorage synchronously, before any fetch resolves", () => {
    window.localStorage.setItem(STORAGE_KEY, "ink");
    mockSettingsResponse("");
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe("ink");
    expect(document.documentElement.getAttribute("data-theme")).toBe("ink");
  });

  it("setChoice persists locally and pushes to the server", async () => {
    mockSettingsResponse("");
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setChoice("paper"));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("paper");
    await waitFor(() => {
      const putCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === "PUT");
      expect(putCall).toBeDefined();
      expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({ uiTheme: "paper" });
    });
  });

  it("M44: adopts the server's theme when localStorage disagrees (a fallback-port launch)", async () => {
    // Nothing in localStorage on this "origin" — the server remembers ink
    // from a previous launch on the usual port.
    mockSettingsResponse("ink");
    const { result } = renderHook(() => useTheme());
    expect(result.current.choice).toBe("system");

    await waitFor(() => expect(result.current.choice).toBe("ink"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("ink");
    expect(document.documentElement.getAttribute("data-theme")).toBe("ink");
  });

  it("leaves a matching local choice alone — no redundant re-application", async () => {
    window.localStorage.setItem(STORAGE_KEY, "paper");
    mockSettingsResponse("paper");
    const { result } = renderHook(() => useTheme());

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.choice).toBe("paper");
  });
});
