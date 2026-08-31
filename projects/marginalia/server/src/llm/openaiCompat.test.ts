import { describe, expect, it } from "vitest";
// extract() requires zod/v4 schema instances — see llm/provider.ts's comment.
import { z } from "zod/v4";
import { OpenAICompatProvider, parseOpenAICompatSSE, sseLines, type OpenAIUsage } from "./openaiCompat.js";

async function* fromChunks(chunks: string[]): AsyncGenerator<string> {
  for (const chunk of chunks) yield chunk;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("sseLines", () => {
  it("splits a stream into lines regardless of chunk boundaries", async () => {
    const lines = await collect(sseLines(fromChunks(["line one\nli", "ne two\nline three"])));
    expect(lines).toEqual(["line one", "line two", "line three"]);
  });

  it("strips trailing carriage returns", async () => {
    const lines = await collect(sseLines(fromChunks(["a\r\nb\r\n"])));
    expect(lines).toEqual(["a", "b"]);
  });
});

describe("parseOpenAICompatSSE", () => {
  it("extracts delta content from data lines", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      "data: [DONE]\n",
    ];
    const events = await collect(parseOpenAICompatSSE(fromChunks(chunks)));
    expect(events).toEqual([{ text: "Hel" }, { text: "lo" }]);
  });

  it("stops at the [DONE] sentinel and ignores anything after", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"a"}}]}\n',
      "data: [DONE]\n",
      'data: {"choices":[{"delta":{"content":"should not appear"}}]}\n',
    ];
    const events = await collect(parseOpenAICompatSSE(fromChunks(chunks)));
    expect(events).toEqual([{ text: "a" }]);
  });

  it("skips non-data lines and empty deltas", async () => {
    const chunks = [
      ": heartbeat comment\n",
      "\n",
      'data: {"choices":[{"delta":{}}]}\n',
      'data: {"choices":[{"delta":{"content":"real"}}]}\n',
      "data: [DONE]\n",
    ];
    const events = await collect(parseOpenAICompatSSE(fromChunks(chunks)));
    expect(events).toEqual([{ text: "real" }]);
  });

  it("handles a single data line split across multiple chunks", async () => {
    const chunks = [
      'data: {"choices":[{"delta"',
      ':{"content":"split"}}]}\n',
      "data: [DONE]\n",
    ];
    const events = await collect(parseOpenAICompatSSE(fromChunks(chunks)));
    expect(events).toEqual([{ text: "split" }]);
  });

  it("skips malformed JSON without throwing", async () => {
    const chunks = [
      "data: {not valid json\n",
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n',
      "data: [DONE]\n",
    ];
    const events = await collect(parseOpenAICompatSSE(fromChunks(chunks)));
    expect(events).toEqual([{ text: "ok" }]);
  });

  it("M17: captures the trailing usage chunk into the optional sink without yielding it", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
      'data: {"choices":[],"usage":{"prompt_tokens":42,"completion_tokens":7}}\n',
      "data: [DONE]\n",
    ];
    const usageSink: { current: OpenAIUsage | null } = { current: null };
    const events = await collect(parseOpenAICompatSSE(fromChunks(chunks), usageSink));
    expect(events).toEqual([{ text: "hi" }]);
    expect(usageSink.current).toEqual({ prompt_tokens: 42, completion_tokens: 7 });
  });

  it("M17: leaves the usage sink untouched when the endpoint never sends usage", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
      "data: [DONE]\n",
    ];
    const usageSink: { current: OpenAIUsage | null } = { current: null };
    await collect(parseOpenAICompatSSE(fromChunks(chunks), usageSink));
    expect(usageSink.current).toBeNull();
  });

  it("M22.5 H1: captures the served model into the optional sink, independent of the usage sink", async () => {
    const chunks = [
      'data: {"model":"llama3:8b-instruct-actually","choices":[{"delta":{"content":"hi"}}]}\n',
      "data: [DONE]\n",
    ];
    const modelSink: { current: string | null } = { current: null };
    const events = await collect(parseOpenAICompatSSE(fromChunks(chunks), undefined, modelSink));
    expect(events).toEqual([{ text: "hi" }]);
    expect(modelSink.current).toBe("llama3:8b-instruct-actually");
  });

  it("M22.5 H1: leaves the model sink null when the endpoint never echoes a model field", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
      "data: [DONE]\n",
    ];
    const modelSink: { current: string | null } = { current: null };
    await collect(parseOpenAICompatSSE(fromChunks(chunks), undefined, modelSink));
    expect(modelSink.current).toBeNull();
  });
});

// M29 (decisions.md 2026-08-22): extract()/stream() used to pass `req.signal` straight
// through to fetch() with no deadline of its own — a stalled connection (a local endpoint
// like Ollama mid-model-load) hung indefinitely instead of failing. Confirms the fix is
// actually wired: fetch gets a *combined* signal that still honours the caller's own
// cancellation, not a plain pass-through and not a signal that only the timeout controls.
describe("OpenAICompatProvider request timeout wiring", () => {
  it("extract() passes fetch a combined signal, distinct from the caller's own, that still aborts when the caller cancels", async () => {
    let capturedSignal: AbortSignal | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      throw new Error("network boom");
    }) as typeof fetch;

    try {
      const provider = new OpenAICompatProvider({
        baseUrl: "http://localhost:11434/v1",
        model: "test-model",
        apiKey: "",
        contextTokens: 32_768,
      });
      const controller = new AbortController();
      await expect(
        provider.extract({
          instructions: "x",
          input: "y",
          schema: z.object({ ok: z.boolean() }),
          signal: controller.signal,
        }),
      ).rejects.toThrow();

      expect(capturedSignal).toBeInstanceOf(AbortSignal);
      expect(capturedSignal).not.toBe(controller.signal);
      expect(capturedSignal?.aborted).toBe(false);
      controller.abort();
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stream() passes fetch a combined signal the same way", async () => {
    let capturedSignal: AbortSignal | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined;
      throw new Error("network boom");
    }) as typeof fetch;

    try {
      const provider = new OpenAICompatProvider({
        baseUrl: "http://localhost:11434/v1",
        model: "test-model",
        apiKey: "",
        contextTokens: 32_768,
      });
      const controller = new AbortController();
      const iterator = provider.stream({
        instructions: "x",
        bookContext: [{ text: "y" }],
        messages: [],
        signal: controller.signal,
      })[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toThrow();

      expect(capturedSignal).toBeInstanceOf(AbortSignal);
      expect(capturedSignal).not.toBe(controller.signal);
      expect(capturedSignal?.aborted).toBe(false);
      controller.abort();
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
