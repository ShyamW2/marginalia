import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@marginalia/shared";
import { useAccent } from "./useAccent.js";
import { resetAppearanceSettingsCache } from "./appearanceSync.js";

const STORAGE_KEY = "marginalia:accent";
const SAMPLE = { h: 210, s: 60, l: 45 };

function mockSettingsResponse(uiAccent: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ uiAccent }) as Settings,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.style.removeProperty("--color-accent");
  resetAppearanceSettingsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useAccent", () => {
  it("paints from localStorage synchronously", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE));
    mockSettingsResponse("");
    const { result } = renderHook(() => useAccent());
    expect(result.current.accent).toEqual(SAMPLE);
  });

  it("setAccent persists locally and pushes the JSON triple to the server", async () => {
    mockSettingsResponse("");
    const { result } = renderHook(() => useAccent());
    act(() => result.current.setAccent(SAMPLE));

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual(SAMPLE);
    await waitFor(() => {
      const putCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({
        uiAccent: JSON.stringify(SAMPLE),
      });
    });
  });

  it("M44: adopts the server's accent when localStorage has none", async () => {
    mockSettingsResponse(JSON.stringify(SAMPLE));
    const { result } = renderHook(() => useAccent());
    expect(result.current.accent).toBeNull();

    await waitFor(() => expect(result.current.accent).toEqual(SAMPLE));
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual(SAMPLE);
  });

  it("resetAccent clears locally and pushes an empty string", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE));
    mockSettingsResponse(JSON.stringify(SAMPLE));
    const { result } = renderHook(() => useAccent());

    act(() => result.current.resetAccent());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    await waitFor(() => {
      const putCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({ uiAccent: "" });
    });
  });
});
