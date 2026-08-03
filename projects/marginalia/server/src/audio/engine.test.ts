import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { getEngine } from "./registry.js";
import { KokoroEngine } from "./kokoro.js";
import { TTSError } from "./engine.js";

describe("getEngine", () => {
  it("resolves to KokoroEngine on an untouched database (works with zero setup)", () => {
    const engine = getEngine(createDb(":memory:"));
    expect(engine).toBeInstanceOf(KokoroEngine);
    expect(engine.id).toBe("kokoro");
  });
});

describe("TTSError", () => {
  it("carries its code and a readable message", () => {
    const err = new TTSError("model_unavailable", "onnxruntime-node failed to load");
    expect(err.code).toBe("model_unavailable");
    expect(err.message).toBe("onnxruntime-node failed to load");
    expect(err.name).toBe("TTSError");
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults its message to the code when none is given", () => {
    expect(new TTSError("synthesis_failed").message).toBe("synthesis_failed");
  });
});
