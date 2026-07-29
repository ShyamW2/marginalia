import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import { getUsageTotalsSince, recordUsage, withUsageLedger } from "./usage.js";
import type { LLMProvider, ReportedUsage } from "./provider.js";

function makeFakeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    id: "openai-compatible",
    capabilities: () => ({ contextTokens: 32_000, supportsCaching: false }),
    async *stream() {
      yield { text: "hello " };
      yield { text: "world" };
    },
    async extract() {
      return { ok: true } as never;
    },
    ...overrides,
  };
}

async function drain(iterable: AsyncIterable<{ text: string }>): Promise<string> {
  let out = "";
  for await (const chunk of iterable) out += chunk.text;
  return out;
}

describe("recordUsage / getUsageTotalsSince", () => {
  it("persists a row and rolls it up in totals since a timestamp", () => {
    const db = createDb(":memory:");
    recordUsage(db, {
      provider: "anthropic",
      model: "claude-opus-4-8",
      operation: "thread",
      role: "query",
      resourceId: null,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      costUsd: 0.03,
      provenance: "reported",
      durationMs: 1200,
    });
    recordUsage(db, {
      provider: "openai-compatible",
      model: "local-model",
      operation: "extract",
      role: "digest",
      resourceId: null,
      inputTokens: 50,
      outputTokens: 10,
      cacheReadTokens: null,
      costUsd: null,
      provenance: "estimated",
      durationMs: 300,
    });

    const totals = getUsageTotalsSince(db, "2000-01-01T00:00:00.000Z");
    expect(totals.inputTokens).toBe(150);
    expect(totals.outputTokens).toBe(30);
    expect(totals.costUsd).toBeCloseTo(0.03);
    expect(totals.callCount).toBe(2);

    // A "since" timestamp in the future excludes everything — survives a
    // restart in the sense that it's a plain durable SELECT, not in-memory
    // state.
    const future = getUsageTotalsSince(db, "2999-01-01T00:00:00.000Z");
    expect(future.callCount).toBe(0);
    db.close();
  });
});

describe("withUsageLedger", () => {
  it("logs a 'reported' row using the provider's own reportedUsage() after stream()", async () => {
    const db = createDb(":memory:");
    const usage: ReportedUsage = { inputTokens: 10, outputTokens: 2, costUsd: 0.01 };
    const provider = makeFakeProvider({ reportedUsage: () => usage });
    const wrapped = withUsageLedger(provider, db, "test-model", "thread", "query", null);

    const text = await drain(
      wrapped.stream({ instructions: "i", bookContext: "b", messages: [] }),
    );
    expect(text).toBe("hello world");

    const totals = getUsageTotalsSince(db, "2000-01-01T00:00:00.000Z");
    expect(totals.callCount).toBe(1);
    expect(totals.inputTokens).toBe(10);
    expect(totals.outputTokens).toBe(2);
    expect(totals.costUsd).toBeCloseTo(0.01);

    const row = db.prepare("SELECT provenance, model, operation FROM llm_usage").get() as {
      provenance: string;
      model: string;
      operation: string;
    };
    expect(row.provenance).toBe("reported");
    expect(row.model).toBe("test-model");
    expect(row.operation).toBe("thread");
    db.close();
  });

  it("falls back to an 'estimated' row when the provider doesn't implement reportedUsage()", async () => {
    const db = createDb(":memory:");
    const provider = makeFakeProvider(); // no reportedUsage member at all
    const wrapped = withUsageLedger(provider, db, "test-model", "extract", "digest", null);

    await wrapped.extract({ instructions: "i", input: "some input text", schema: undefined as never });

    const row = db.prepare("SELECT provenance, input_tokens, output_tokens FROM llm_usage").get() as {
      provenance: string;
      input_tokens: number;
      output_tokens: number;
    };
    expect(row.provenance).toBe("estimated");
    expect(row.input_tokens).toBeGreaterThan(0);
    expect(row.output_tokens).toBeGreaterThan(0);
    db.close();
  });

  it("logs even when the wrapped call throws — a failed call still consumed tokens", async () => {
    const db = createDb(":memory:");
    const provider = makeFakeProvider({
      // eslint-disable-next-line require-yield
      async *stream(): AsyncIterable<{ text: string }> {
        throw new Error("boom");
      },
    });
    const wrapped = withUsageLedger(provider, db, "test-model", "thread", "query", null);

    await expect(
      drain(wrapped.stream({ instructions: "i", bookContext: "b", messages: [] })),
    ).rejects.toThrow("boom");

    const totals = getUsageTotalsSince(db, "2000-01-01T00:00:00.000Z");
    expect(totals.callCount).toBe(1);
    db.close();
  });

  it("passes through planLimits() only when the wrapped provider implements it", async () => {
    const db = createDb(":memory:");
    const withoutPlanLimits = withUsageLedger(makeFakeProvider(), db, "m", "thread", "query", null);
    expect(withoutPlanLimits.planLimits).toBeUndefined();

    const withPlanLimits = withUsageLedger(
      makeFakeProvider({ planLimits: async () => ({ windows: [] }) }),
      db,
      "m",
      "thread",
      "query",
      null,
    );
    await expect(withPlanLimits.planLimits?.()).resolves.toEqual({ windows: [] });
    db.close();
  });
});
