import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "@marginalia/shared";
import { usePaperTint } from "./usePaperTint.js";
import { resetAppearanceSettingsCache } from "./appearanceSync.js";

const STORAGE_KEY = "marginalia:paperHue";

function mockSettingsResponse(uiPaperTintHue: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ uiPaperTintHue }) as Settings,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetAppearanceSettingsCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePaperTint", () => {
  it("paints from localStorage synchronously", () => {
    window.localStorage.setItem(STORAGE_KEY, "40");
    mockSettingsResponse("");
    const { result } = renderHook(() => usePaperTint());
    expect(result.current.hue).toBe(40);
  });

  it("setHue persists locally and pushes to the server as a string", async () => {
    mockSettingsResponse("");
    const { result } = renderHook(() => usePaperTint());
    act(() => result.current.setHue(120));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("120");
    await waitFor(() => {
      const putCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({ uiPaperTintHue: "120" });
    });
  });

  it("M44: adopts the server's hue when localStorage has none", async () => {
    mockSettingsResponse("200");
    const { result } = renderHook(() => usePaperTint());
    expect(result.current.hue).toBeNull();

    await waitFor(() => expect(result.current.hue).toBe(200));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("200");
  });

  it("resetHue clears locally and pushes an empty string", async () => {
    window.localStorage.setItem(STORAGE_KEY, "40");
    mockSettingsResponse("40");
    const { result } = renderHook(() => usePaperTint());

    act(() => result.current.resetHue());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    await waitFor(() => {
      const putCall = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([, init]) => init?.method === "PUT");
      expect(JSON.parse((putCall![1] as RequestInit).body as string)).toEqual({ uiPaperTintHue: "" });
    });
  });
});
