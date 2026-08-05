import { describe, expect, it } from "vitest";
import { parseOpenAICompatSSE, sseLines, type OpenAIUsage } from "./openaiCompat.js";

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
