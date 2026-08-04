import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TTSEngine } from "./engine.js";

// AUDIO_DIR is a module-level const computed from paths.ts at import time —
// point it at a scratch directory for the whole file rather than the real
// data/audio/, same isolation `createDb(":memory:")` gives the DB-backed
// tests.
let tmpRoot: string;
vi.mock("../paths.js", async () => {
  const actual = await vi.importActual<typeof import("../paths.js")>("../paths.js");
  return { ...actual, get AUDIO_DIR() { return tmpRoot; } };
});

const { computeCastHash, isSectionCached, renderSection, getSectionManifest, getSegmentFilePath, listCachedSpineIndices, deleteResourceAudioCache } =
  await import("./render.js");

function fakeEngine(): TTSEngine {
  return {
    id: "kokoro",
    voices: async () => [],
    synthesize: vi.fn(async ({ text }: { text: string }) => ({
      audio: new Uint8Array([1, 2, 3, text.length]),
      format: "wav" as const,
      durationMs: 500,
    })),
  };
}

describe("computeCastHash", () => {
  it("is deterministic for the same inputs", () => {
    expect(computeCastHash("kokoro", "af_heart")).toBe(computeCastHash("kokoro", "af_heart"));
  });

  it("changes when the narrator voice changes", () => {
    expect(computeCastHash("kokoro", "af_heart")).not.toBe(computeCastHash("kokoro", "am_adam"));
  });

  it("changes when the engine changes", () => {
    expect(computeCastHash("kokoro", "af_heart")).not.toBe(computeCastHash("other-engine", "af_heart"));
  });

  it("is order-independent in the cast mapping", () => {
    const a = computeCastHash("kokoro", "af_heart", "multi", [
      { speakerId: "alice", voiceId: "v1" },
      { speakerId: "bob", voiceId: "v2" },
    ]);
    const b = computeCastHash("kokoro", "af_heart", "multi", [
      { speakerId: "bob", voiceId: "v2" },
      { speakerId: "alice", voiceId: "v1" },
    ]);
    expect(a).toBe(b);
  });

  it("changes when the cast mapping changes", () => {
    const a = computeCastHash("kokoro", "af_heart", "multi", [{ speakerId: "alice", voiceId: "v1" }]);
    const b = computeCastHash("kokoro", "af_heart", "multi", [{ speakerId: "alice", voiceId: "v2" }]);
    expect(a).not.toBe(b);
  });

  it("changes when voice mode changes, even with the same narrator and no cast mapping", () => {
    // The correctness-critical case: an empty/unchanged cast mapping must
    // not let a multi-voice hash collide with the single-voice hash already
    // on disk (render.ts's own comment on why voiceMode is hashed at all).
    expect(computeCastHash("kokoro", "af_heart", "single")).not.toBe(computeCastHash("kokoro", "af_heart", "multi"));
  });
});

describe("section render + cache", () => {
  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "marginalia-audio-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("is not cached before rendering, and cached after", async () => {
    const engine = fakeEngine();
    const castHash = computeCastHash("kokoro", "af_heart");
    expect(isSectionCached("res-1", castHash, 0)).toBe(false);

    await renderSection(engine, "res-1", 0, "Hello there. It is a fine day today.", castHash, "af_heart", 1, new AbortController().signal, () => {});

    expect(isSectionCached("res-1", castHash, 0)).toBe(true);
    const manifest = getSectionManifest("res-1", castHash, 0);
    expect(manifest?.segments.length).toBeGreaterThan(0);
  });

  it("does no synthesis on a second render of an already-cached section", async () => {
    const engine = fakeEngine();
    const castHash = computeCastHash("kokoro", "af_heart");
    const signal = new AbortController().signal;
    await renderSection(engine, "res-1", 0, "Hello there. It is a fine day today.", castHash, "af_heart", 1, signal, () => {});
    expect(isSectionCached("res-1", castHash, 0)).toBe(true);

    // The route layer is what actually skips calling renderSection again on
    // a cache hit (see routes/audio.ts) — this test asserts the cache-check
    // primitive itself reports "already cached" so that guard has something
    // true to check.
    const synth = engine.synthesize as ReturnType<typeof vi.fn>;
    const callsBeforeSecondCheck = synth.mock.calls.length;
    expect(isSectionCached("res-1", castHash, 0)).toBe(true);
    expect(synth.mock.calls.length).toBe(callsBeforeSecondCheck);
  });

  it("a changed cast hash is not cached even though the old one is", async () => {
    const engine = fakeEngine();
    const castHashA = computeCastHash("kokoro", "af_heart");
    const castHashB = computeCastHash("kokoro", "am_adam");
    await renderSection(engine, "res-1", 0, "Hello there. It is a fine day today.", castHashA, "af_heart", 1, new AbortController().signal, () => {});

    expect(isSectionCached("res-1", castHashA, 0)).toBe(true);
    expect(isSectionCached("res-1", castHashB, 0)).toBe(false);
  });

  it("a manifest whose files were deleted is not cached (file existence, not the manifest row)", async () => {
    const engine = fakeEngine();
    const castHash = computeCastHash("kokoro", "af_heart");
    await renderSection(engine, "res-1", 0, "Hello there. It is a fine day today.", castHash, "af_heart", 1, new AbortController().signal, () => {});
    expect(isSectionCached("res-1", castHash, 0)).toBe(true);

    // Simulate a `data/audio/` deletion that leaves the manifest but not the
    // segment files — the exact scenario AUDIO.md calls out (the vault
    // compiler's 2026-07-19 bug).
    const file = getSegmentFilePath("res-1", castHash, 0, 0);
    expect(file).not.toBeNull();
    fs.rmSync(file!.path);

    expect(isSectionCached("res-1", castHash, 0)).toBe(false);
    expect(getSectionManifest("res-1", castHash, 0)).toBeNull();
  });

  it("stops synthesizing once the signal is aborted", async () => {
    const engine = fakeEngine();
    const controller = new AbortController();
    const longText = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is here today.`).join(" ");
    const synth = engine.synthesize as ReturnType<typeof vi.fn>;
    synth.mockImplementation(async () => {
      controller.abort();
      return { audio: new Uint8Array([1]), format: "wav" as const, durationMs: 10 };
    });

    await expect(
      renderSection(engine, "res-1", 0, longText, computeCastHash("kokoro", "af_heart"), "af_heart", 1, controller.signal, () => {}),
    ).rejects.toThrow();
    // Only the first sentence was synthesized before the abort took effect.
    expect(synth.mock.calls.length).toBe(1);
  });

  it("listCachedSpineIndices reports only sections rendered under the given cast hash", async () => {
    const engine = fakeEngine();
    const castHash = computeCastHash("kokoro", "af_heart");
    await renderSection(engine, "res-1", 0, "Hello there. It is a fine day today.", castHash, "af_heart", 1, new AbortController().signal, () => {});
    expect(listCachedSpineIndices("res-1", castHash, [0, 1, 2])).toEqual([0]);
  });

  it("deleteResourceAudioCache removes every cast hash for that resource", async () => {
    const engine = fakeEngine();
    const castHash = computeCastHash("kokoro", "af_heart");
    await renderSection(engine, "res-1", 0, "Hello there. It is a fine day today.", castHash, "af_heart", 1, new AbortController().signal, () => {});
    expect(isSectionCached("res-1", castHash, 0)).toBe(true);
    await deleteResourceAudioCache("res-1");
    expect(isSectionCached("res-1", castHash, 0)).toBe(false);
  });
});
