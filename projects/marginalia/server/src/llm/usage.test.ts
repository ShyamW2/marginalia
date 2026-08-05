import { describe, expect, it } from "vitest";
import { createDb } from "../db.js";
import {
  buildMessageProvenance,
  getUsageBreakdownSince,
  getUsageTotalsSince,
  linkUsageToMessage,
  recordUsage,
  withUsageLedger,
} from "./usage.js";
import type { LLMProvider, ReportedUsage } from "./provider.js";

// llm_usage.profile_id / .message_id are real foreign keys (better-sqlite3
// runs with `foreign_keys = ON`, db.ts) — tests that populate them need a
// row that actually exists, not an arbitrary string.
function seedProfile(db: ReturnType<typeof createDb>, id: string, name = id) {
  db.prepare(
    `INSERT INTO provider_profiles
       (id, name, provider, anthropic_model, anthropic_api_key, claude_agent_model,
        openai_base_url, openai_model, openai_api_key, openai_context_tokens,
        created_at, updated_at)
     VALUES (@id, @name, 'openai-compatible', '', '', '', '', '', '', '32768', @now, @now)`,
  ).run({ id, name, now: new Date().toISOString() });
}

function seedMessage(db: ReturnType<typeof createDb>, messageId: string) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO resources (id, title, author, format, file_path, metadata, imported_at)
     VALUES ('res-1', 'Title', 'Author', 'epub', '/tmp/x.epub', '{}', @now)`,
  ).run({ now });
  db.prepare(
    `INSERT INTO highlights (id, resource_id, exact, prefix, suffix, cfi, spine_index, kind, created_at)
     VALUES ('hl-1', 'res-1', 'quote', '', '', 'epubcfi(/6/4!/4/2)', 0, 'rose', @now)`,
  ).run({ now });
  db.prepare(`INSERT INTO threads (id, highlight_id, created_at) VALUES ('thread-1', 'hl-1', @now)`).run({ now });
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, created_at) VALUES (@messageId, 'thread-1', 'assistant', 'hi', @now)`,
  ).run({ messageId, now });
}

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

const BASE_ROW = {
  modelSource: "configured" as const,
  role: "query" as const,
  resourceId: null,
  messageId: null,
  profileId: null,
};

describe("recordUsage / getUsageTotalsSince", () => {
  it("persists a row and rolls it up in totals since a timestamp, split by cost basis", () => {
    const db = createDb(":memory:");
    recordUsage(db, {
      ...BASE_ROW,
      provider: "anthropic",
      model: "claude-opus-4-8",
      operation: "thread",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      costUsd: 0.03,
      costBasis: "billed",
      provenance: "reported",
      durationMs: 1200,
    });
    recordUsage(db, {
      ...BASE_ROW,
      provider: "claude-agent",
      model: "claude-sonnet-5",
      operation: "thread",
      inputTokens: 40,
      outputTokens: 8,
      cacheReadTokens: null,
      costUsd: 0.5,
      costBasis: "notional",
      provenance: "reported",
      durationMs: 900,
    });
    recordUsage(db, {
      ...BASE_ROW,
      provider: "openai-compatible",
      model: "local-model",
      operation: "extract",
      role: "digest",
      inputTokens: 50,
      outputTokens: 10,
      cacheReadTokens: null,
      costUsd: null,
      costBasis: "none",
      provenance: "estimated",
      durationMs: 300,
    });

    const totals = getUsageTotalsSince(db, "2000-01-01T00:00:00.000Z");
    expect(totals.inputTokens).toBe(190);
    expect(totals.outputTokens).toBe(38);
    expect(totals.callCount).toBe(3);
    // M22.5 H4: billed sums only the genuinely-charged row; notional is
    // reported separately and never folded into the total a reader would
    // treat as real spend.
    expect(totals.billedCostUsd).toBeCloseTo(0.03);
    expect(totals.notionalCostUsd).toBeCloseTo(0.5);

    // A "since" timestamp in the future excludes everything — survives a
    // restart in the sense that it's a plain durable SELECT, not in-memory
    // state.
    const future = getUsageTotalsSince(db, "2999-01-01T00:00:00.000Z");
    expect(future.callCount).toBe(0);
    db.close();
  });
});

describe("getUsageBreakdownSince", () => {
  it("groups by provider/model/profile in addition to book/operation/role (M22.5 H5)", () => {
    const db = createDb(":memory:");
    seedProfile(db, "profile-a");
    seedProfile(db, "profile-b");
    recordUsage(db, {
      ...BASE_ROW,
      provider: "openai-compatible",
      model: "llama3",
      profileId: "profile-a",
      operation: "thread",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: null,
      costUsd: null,
      costBasis: "none",
      provenance: "estimated",
      durationMs: 1000, // 50 output tokens / 1s -> 50 tok/s, hand-checkable
    });
    recordUsage(db, {
      ...BASE_ROW,
      provider: "openai-compatible",
      model: "llama3",
      profileId: "profile-a",
      operation: "thread",
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: null,
      costUsd: null,
      costBasis: "none",
      provenance: "estimated",
      durationMs: 500,
    });
    recordUsage(db, {
      ...BASE_ROW,
      provider: "anthropic",
      model: "claude-opus-4-8",
      profileId: "profile-b",
      operation: "thread",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      costUsd: 0.001,
      costBasis: "billed",
      provenance: "reported",
      durationMs: 200,
    });

    const rows = getUsageBreakdownSince(db, "2000-01-01T00:00:00.000Z");
    expect(rows).toHaveLength(2);

    const local = rows.find((r) => r.provider === "openai-compatible")!;
    expect(local.model).toBe("llama3");
    expect(local.profileId).toBe("profile-a");
    expect(local.callCount).toBe(2);
    expect(local.outputTokens).toBe(60);
    expect(local.durationMs).toBe(1500);
    // Hand-check: 60 output tokens over 1500ms = 40 tok/s.
    expect(local.outputTokens / (local.durationMs / 1000)).toBeCloseTo(40);
    expect(local.costBasis).toBe("none");

    const hosted = rows.find((r) => r.provider === "anthropic")!;
    expect(hosted.profileId).toBe("profile-b");
    expect(hosted.cacheReadTokens).toBe(3);
    expect(hosted.costBasis).toBe("billed");
  });

  it("rolls up rows with no linked profile as null, and marks a mixed cost basis", () => {
    const db = createDb(":memory:");
    recordUsage(db, {
      ...BASE_ROW,
      provider: "anthropic",
      model: "claude-opus-4-8",
      operation: "thread",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: null,
      costUsd: 0.01,
      costBasis: "billed",
      provenance: "reported",
      durationMs: 100,
    });
    recordUsage(db, {
      ...BASE_ROW,
      provider: "anthropic",
      model: "claude-opus-4-8",
      operation: "thread",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: null,
      costUsd: null,
      costBasis: "unpriced",
      provenance: "reported",
      durationMs: 100,
    });

    const rows = getUsageBreakdownSince(db, "2000-01-01T00:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0].profileId).toBeNull();
    expect(rows[0].costBasis).toBe("mixed");
  });
});

describe("linkUsageToMessage / buildMessageProvenance", () => {
  it("links a usage row to a message id and builds provenance from it", () => {
    const db = createDb(":memory:");
    seedMessage(db, "message-1");
    const row = recordUsage(db, {
      ...BASE_ROW,
      provider: "anthropic",
      model: "claude-opus-4-8",
      operation: "thread",
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: null,
      costUsd: 0.01,
      costBasis: "billed",
      provenance: "reported",
      durationMs: 100,
    });

    linkUsageToMessage(db, row.id, "message-1");
    const linked = db.prepare("SELECT message_id FROM llm_usage WHERE id = ?").get(row.id) as {
      message_id: string;
    };
    expect(linked.message_id).toBe("message-1");

    // No profile row exists for this call — provenance still builds, with
    // profileName null rather than throwing.
    const provenance = buildMessageProvenance(db, row);
    expect(provenance).toEqual({
      profileName: null,
      provider: "anthropic",
      model: "claude-opus-4-8",
      endpointHost: "api.anthropic.com",
    });
    db.close();
  });

  it("returns null for no usage row (a message this app didn't itself generate, or pre-M22.5)", () => {
    const db = createDb(":memory:");
    expect(buildMessageProvenance(db, null)).toBeNull();
    db.close();
  });
});

describe("withUsageLedger", () => {
  it("logs a 'reported' row using the provider's own reportedUsage() after stream(), priced from the model table", async () => {
    const db = createDb(":memory:");
    const usage: ReportedUsage = { inputTokens: 1_000_000, outputTokens: 200_000 };
    const provider = makeFakeProvider({ id: "anthropic", reportedUsage: () => usage });
    const wrapped = withUsageLedger(provider, db, "claude-opus-4-8", "thread", "query", null, null);

    const text = await drain(
      wrapped.stream({ instructions: "i", bookContext: "b", messages: [] }),
    );
    expect(text).toBe("hello world");

    const totals = getUsageTotalsSince(db, "2000-01-01T00:00:00.000Z");
    expect(totals.callCount).toBe(1);
    expect(totals.inputTokens).toBe(1_000_000);
    expect(totals.outputTokens).toBe(200_000);
    // 1M input tokens @ $5/MTok + 200k output @ $25/MTok = $5 + $5 = $10.
    expect(totals.billedCostUsd).toBeCloseTo(10);

    const row = db.prepare("SELECT provenance, model, operation, cost_basis, model_source FROM llm_usage").get() as {
      provenance: string;
      model: string;
      operation: string;
      cost_basis: string;
      model_source: string;
    };
    expect(row.provenance).toBe("reported");
    expect(row.model).toBe("claude-opus-4-8");
    expect(row.operation).toBe("thread");
    expect(row.cost_basis).toBe("billed");
    expect(row.model_source).toBe("configured");
    db.close();
  });

  it("prices a claude-agent call as notional, never billed", async () => {
    const db = createDb(":memory:");
    const usage: ReportedUsage = { inputTokens: 10, outputTokens: 2, costUsd: 0.42 };
    const provider = makeFakeProvider({ id: "claude-agent", reportedUsage: () => usage });
    const wrapped = withUsageLedger(provider, db, "claude-sonnet-5", "thread", "query", null, null);
    await drain(wrapped.stream({ instructions: "i", bookContext: "b", messages: [] }));

    const row = db.prepare("SELECT cost_basis, cost_usd FROM llm_usage").get() as {
      cost_basis: string;
      cost_usd: number;
    };
    expect(row.cost_basis).toBe("notional");
    expect(row.cost_usd).toBeCloseTo(0.42);

    const totals = getUsageTotalsSince(db, "2000-01-01T00:00:00.000Z");
    // Notional never counts as billed spend (decisions.md 2026-08-04).
    expect(totals.billedCostUsd).toBe(0);
    expect(totals.notionalCostUsd).toBeCloseTo(0.42);
    db.close();
  });

  it("marks a keyed Anthropic call unpriced (not silently free) when the model isn't in the pricing table", async () => {
    const db = createDb(":memory:");
    const usage: ReportedUsage = { inputTokens: 10, outputTokens: 2 };
    const provider = makeFakeProvider({ id: "anthropic", reportedUsage: () => usage });
    const wrapped = withUsageLedger(provider, db, "claude-some-future-model", "thread", "query", null, null);
    await drain(wrapped.stream({ instructions: "i", bookContext: "b", messages: [] }));

    const row = db.prepare("SELECT cost_basis, cost_usd FROM llm_usage").get() as {
      cost_basis: string;
      cost_usd: number | null;
    };
    expect(row.cost_basis).toBe("unpriced");
    expect(row.cost_usd).toBeNull();
    db.close();
  });

  it("records the endpoint's served model over the configured one, and marks the source (M22.5 H1)", async () => {
    const db = createDb(":memory:");
    const provider = makeFakeProvider({
      id: "openai-compatible",
      reportedUsage: () => ({ inputTokens: 10, outputTokens: 2 }),
      reportedModel: () => "actually-a-different-model",
    });
    const wrapped = withUsageLedger(provider, db, "configured-model-name", "thread", "query", null, null);
    await drain(wrapped.stream({ instructions: "i", bookContext: "b", messages: [] }));

    const row = db.prepare("SELECT model, model_source FROM llm_usage").get() as {
      model: string;
      model_source: string;
    };
    expect(row.model).toBe("actually-a-different-model");
    expect(row.model_source).toBe("endpoint");
    db.close();
  });

  it("marks the configured model when the endpoint reports none", async () => {
    const db = createDb(":memory:");
    const provider = makeFakeProvider({ reportedUsage: () => ({ inputTokens: 10, outputTokens: 2 }) });
    const wrapped = withUsageLedger(provider, db, "configured-model-name", "thread", "query", null, null);
    await drain(wrapped.stream({ instructions: "i", bookContext: "b", messages: [] }));

    const row = db.prepare("SELECT model, model_source FROM llm_usage").get() as {
      model: string;
      model_source: string;
    };
    expect(row.model).toBe("configured-model-name");
    expect(row.model_source).toBe("configured");
    db.close();
  });

  it("records the profile id passed in, for the local-vs-hosted distinction (M22.5 H5)", async () => {
    const db = createDb(":memory:");
    seedProfile(db, "profile-xyz");
    const provider = makeFakeProvider({ reportedUsage: () => ({ inputTokens: 10, outputTokens: 2 }) });
    const wrapped = withUsageLedger(provider, db, "m", "thread", "query", null, "profile-xyz");
    await drain(wrapped.stream({ instructions: "i", bookContext: "b", messages: [] }));

    const row = db.prepare("SELECT profile_id FROM llm_usage").get() as { profile_id: string };
    expect(row.profile_id).toBe("profile-xyz");
    db.close();
  });

  it("falls back to an 'estimated' row when the provider doesn't implement reportedUsage()", async () => {
    const db = createDb(":memory:");
    const provider = makeFakeProvider(); // no reportedUsage member at all
    const wrapped = withUsageLedger(provider, db, "test-model", "extract", "digest", null, null);

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
    const wrapped = withUsageLedger(provider, db, "test-model", "thread", "query", null, null);

    await expect(
      drain(wrapped.stream({ instructions: "i", bookContext: "b", messages: [] })),
    ).rejects.toThrow("boom");

    const totals = getUsageTotalsSince(db, "2000-01-01T00:00:00.000Z");
    expect(totals.callCount).toBe(1);
    db.close();
  });

  it("passes through planLimits() only when the wrapped provider implements it", async () => {
    const db = createDb(":memory:");
    const withoutPlanLimits = withUsageLedger(makeFakeProvider(), db, "m", "thread", "query", null, null);
    expect(withoutPlanLimits.planLimits).toBeUndefined();

    const withPlanLimits = withUsageLedger(
      makeFakeProvider({ planLimits: async () => ({ windows: [] }) }),
      db,
      "m",
      "thread",
      "query",
      null,
      null,
    );
    await expect(withPlanLimits.planLimits?.()).resolves.toEqual({ windows: [] });
    db.close();
  });
});
