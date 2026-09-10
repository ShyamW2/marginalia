import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitDeskViewMode, loadDeskViewMode, parseServerDeskViewMode } from "./deskViewBus.js";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseServerDeskViewMode", () => {
  it("accepts the three real modes", () => {
    expect(parseServerDeskViewMode("desk")).toBe("desk");
    expect(parseServerDeskViewMode("list")).toBe("list");
    expect(parseServerDeskViewMode("shelf")).toBe("shelf");
  });

  it("returns null for unset (\"\") or anything unrecognized", () => {
    expect(parseServerDeskViewMode("")).toBeNull();
    expect(parseServerDeskViewMode("bogus")).toBeNull();
  });
});

describe("emitDeskViewMode", () => {
  it("M44: pushes the mode to the sidecar store alongside localStorage", () => {
    emitDeskViewMode("shelf");
    expect(loadDeskViewMode()).toBe("shelf");
    expect(fetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ uiDeskViewMode: "shelf" }),
      }),
    );
  });
});
