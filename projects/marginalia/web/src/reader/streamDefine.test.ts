import { afterEach, describe, expect, it, vi } from "vitest";
import { streamDefine, type DefineStreamHandlers } from "./streamDefine.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A `Response`-shaped fake whose `body` is a real ReadableStream emitting
 * the given SSE-formatted chunks, one write per chunk — same shape
 * `streamDefine`'s reader.read() loop expects from a live fetch(). */
function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, body: stream } as unknown as Response;
}

function handlers(): DefineStreamHandlers & {
  steps: string[];
  text: string;
  done: unknown;
  errors: string[];
} {
  const result = {
    steps: [] as string[],
    text: "",
    done: null as unknown,
    errors: [] as string[],
    onStep: (step: string) => result.steps.push(step),
    onText: (text: string) => {
      result.text += text;
    },
    onDone: (definition: unknown) => {
      result.done = definition;
    },
    onError: (message: string) => result.errors.push(message),
  };
  return result;
}

describe("streamDefine", () => {
  it("dispatches step, text, and done events in order", async () => {
    const h = handlers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          `data: ${JSON.stringify({ step: 'Searching "A Book" for "timshel"…' })}\n\n`,
          `data: ${JSON.stringify({ step: "Reading context around 6 occurrences…" })}\n\n`,
          `data: ${JSON.stringify({ text: "A Hebrew word " })}\n\n`,
          `data: ${JSON.stringify({ text: "meaning thou mayest." })}\n\n`,
          `data: ${JSON.stringify({
            done: true,
            definition: {
              headword: "timshel",
              definition: "A Hebrew word meaning thou mayest.",
              source: "digest",
              attribution: "A Book",
              reason: "",
            },
          })}\n\n`,
        ]),
      ),
    );

    await streamDefine("/api/highlights/h1/definition/deepen", { role: "query" }, h, new AbortController().signal);

    expect(h.steps).toEqual([
      'Searching "A Book" for "timshel"…',
      "Reading context around 6 occurrences…",
    ]);
    expect(h.text).toBe("A Hebrew word meaning thou mayest.");
    expect(h.done).toMatchObject({ headword: "timshel", source: "digest" });
    expect(h.errors).toEqual([]);
  });

  it("dispatches error events and never calls onDone for them", async () => {
    const h = handlers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([`data: ${JSON.stringify({ error: "Something went wrong." })}\n\n`])),
    );

    await streamDefine("/api/highlights/h1/definition/deepen", {}, h, new AbortController().signal);

    expect(h.errors).toEqual(["Something went wrong."]);
    expect(h.done).toBeNull();
  });

  it("reports a non-ok response's error body instead of parsing it as a stream", async () => {
    const h = handlers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "not_found" }) }) as unknown as Response),
    );

    await streamDefine("/api/highlights/missing/definition/deepen", {}, h, new AbortController().signal);

    expect(h.errors).toEqual(["not_found"]);
  });
});
