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
