import { describe, expect, it } from "vitest";
import { contextTokensForModel } from "./anthropic.js";

describe("contextTokensForModel", () => {
  it("returns 1M for the default Opus model", () => {
    expect(contextTokensForModel("claude-opus-4-8")).toBe(1_000_000);
  });

  it("returns 1M for Sonnet", () => {
    expect(contextTokensForModel("claude-sonnet-5")).toBe(1_000_000);
  });

  it("returns 200K for Haiku models, exact and by substring match", () => {
    expect(contextTokensForModel("claude-haiku-4-5")).toBe(200_000);
    expect(contextTokensForModel("claude-haiku-4-5-20251001")).toBe(200_000);
    expect(contextTokensForModel("some-future-haiku-snapshot")).toBe(200_000);
  });

  it("defaults to 1M for an unrecognized model string", () => {
    expect(contextTokensForModel("a-model-nobody-has-heard-of")).toBe(1_000_000);
  });
});
