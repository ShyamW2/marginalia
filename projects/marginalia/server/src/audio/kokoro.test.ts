import { afterEach, describe, expect, it, vi } from "vitest";
import { TTSError } from "./engine.js";

/** `KokoroEngine` caches its loaded model at module scope (deliberately —
 * the model is a large in-process resource, not something to reload per
 * request) — each test gets a fresh module instance via `vi.resetModules()`
 * so one test's mock/model doesn't leak into the next. */
async function freshKokoroModule() {
  vi.resetModules();
  return import("./kokoro.js");
}

afterEach(() => {
  vi.doUnmock("kokoro-js");
});

describe("KokoroEngine error mapping", () => {
  it("maps a network-shaped load failure to model_download_failed", async () => {
    vi.doMock("kokoro-js", () => ({
      KokoroTTS: { from_pretrained: vi.fn().mockRejectedValue(new Error("fetch failed: ENOTFOUND")) },
    }));
    const { KokoroEngine } = await freshKokoroModule();
    const engine = new KokoroEngine("/tmp/does-not-matter");

    await expect(engine.voices()).rejects.toMatchObject({
      code: "model_download_failed",
    } satisfies Partial<TTSError>);
  });

  it("maps a non-network load failure to model_unavailable (the ABI-mismatch case)", async () => {
    vi.doMock("kokoro-js", () => ({
      KokoroTTS: {
        from_pretrained: vi.fn().mockRejectedValue(new Error("Could not locate the bindings file")),
      },
    }));
    const { KokoroEngine } = await freshKokoroModule();
    const engine = new KokoroEngine("/tmp/does-not-matter");

    await expect(engine.voices()).rejects.toMatchObject({ code: "model_unavailable" });
  });

  it("maps an unknown voice id to unsupported_voice without touching the engine", async () => {
    const fakeModel = {
      voices: { af_heart: { name: "Heart", language: "en-us", gender: "Female" } },
      generate: vi.fn(),
    };
    vi.doMock("kokoro-js", () => ({
      KokoroTTS: { from_pretrained: vi.fn().mockResolvedValue(fakeModel) },
    }));
    const { KokoroEngine } = await freshKokoroModule();
    const engine = new KokoroEngine("/tmp/does-not-matter");

    await expect(engine.synthesize({ text: "hi", voiceId: "not_a_real_voice" })).rejects.toMatchObject({
      code: "unsupported_voice",
    });
    expect(fakeModel.generate).not.toHaveBeenCalled();
  });

  it("normalizes voice gender and derives accent from the voice's language", async () => {
    const fakeModel = {
      voices: {
        af_heart: { name: "Heart", language: "en-us", gender: "Female" },
        bm_george: { name: "George", language: "en-gb", gender: "Male" },
      },
    };
    vi.doMock("kokoro-js", () => ({
      KokoroTTS: { from_pretrained: vi.fn().mockResolvedValue(fakeModel) },
    }));
    const { KokoroEngine } = await freshKokoroModule();
    const engine = new KokoroEngine("/tmp/does-not-matter");

    const voices = await engine.voices();
    expect(voices).toEqual([
      { id: "af_heart", label: "Heart", gender: "female", accent: "american" },
      { id: "bm_george", label: "George", gender: "male", accent: "british" },
    ]);
  });

  it("wraps a synthesis-time throw as synthesis_failed", async () => {
    const fakeModel = {
      voices: { af_heart: { name: "Heart", language: "en-us", gender: "Female" } },
      generate: vi.fn().mockRejectedValue(new Error("onnx runtime crashed")),
    };
    vi.doMock("kokoro-js", () => ({
      KokoroTTS: { from_pretrained: vi.fn().mockResolvedValue(fakeModel) },
    }));
    const { KokoroEngine } = await freshKokoroModule();
    const engine = new KokoroEngine("/tmp/does-not-matter");

    await expect(engine.synthesize({ text: "hi", voiceId: "af_heart" })).rejects.toMatchObject({
      code: "synthesis_failed",
    });
  });
});

describe("KokoroEngine idle unload (M46, DESKTOP.md §4.2)", () => {
  it("disposes the ONNX session and reloads after 15 minutes idle", async () => {
    vi.useFakeTimers();
    const dispose = vi.fn().mockResolvedValue([]);
    const fromPretrained = vi
      .fn()
      .mockResolvedValue({ model: { dispose }, voices: { af_heart: { name: "Heart", language: "en-us", gender: "Female" } } });
    vi.doMock("kokoro-js", () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));
    const { KokoroEngine } = await freshKokoroModule();
    const engine = new KokoroEngine("/tmp/does-not-matter");

    await engine.voices();
    expect(fromPretrained).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(dispose).toHaveBeenCalledTimes(1);

    await engine.voices();
    expect(fromPretrained).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not unload while still within the idle window", async () => {
    vi.useFakeTimers();
    const dispose = vi.fn().mockResolvedValue([]);
    const fromPretrained = vi
      .fn()
      .mockResolvedValue({ model: { dispose }, voices: { af_heart: { name: "Heart", language: "en-us", gender: "Female" } } });
    vi.doMock("kokoro-js", () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));
    const { KokoroEngine } = await freshKokoroModule();
    const engine = new KokoroEngine("/tmp/does-not-matter");

    await engine.voices();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await engine.voices();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    // Each access resets the idle window, so 20 minutes of continued use
    // never crosses the 15-minute idle threshold in one uninterrupted gap.
    expect(dispose).not.toHaveBeenCalled();
    expect(fromPretrained).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("disposes the old session when the model path changes, not just on idle", async () => {
    vi.useFakeTimers();
    const disposeA = vi.fn().mockResolvedValue([]);
    const disposeB = vi.fn().mockResolvedValue([]);
    const voices = { af_heart: { name: "Heart", language: "en-us", gender: "Female" } };
    const fromPretrained = vi
      .fn()
      .mockResolvedValueOnce({ model: { dispose: disposeA }, voices })
      .mockResolvedValueOnce({ model: { dispose: disposeB }, voices });
    vi.doMock("kokoro-js", () => ({ KokoroTTS: { from_pretrained: fromPretrained } }));
    const { KokoroEngine } = await freshKokoroModule();

    const engineA = new KokoroEngine("/tmp/path-a");
    await engineA.voices();
    expect(disposeA).not.toHaveBeenCalled();

    const engineB = new KokoroEngine("/tmp/path-b");
    await engineB.voices();

    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(fromPretrained).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
