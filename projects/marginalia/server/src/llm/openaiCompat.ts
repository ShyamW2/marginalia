import {
  LLMError,
  type LLMExtractRequest,
  type LLMProvider,
  type LLMStreamRequest,
  type ReportedUsage,
} from "./provider.js";

/** Raw `usage` object shape shared by OpenAI-compatible chat-completions
 * responses (streaming, when `stream_options.include_usage` is honoured, and
 * non-streaming) — snake_case, matching the wire format directly. */
export interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

function toReportedUsage(usage: OpenAIUsage | undefined): ReportedUsage | null {
  if (!usage || typeof usage.prompt_tokens !== "number" || typeof usage.completion_tokens !== "number") {
    return null;
  }
  return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
}

// M16: see the matching comment in anthropic.ts — the answer-length setting
// only governs stream(), not extract()'s own, unrelated structured-output
// budget (vault distillation / the M17 digest).
const EXTRACT_MAX_TOKENS = 8192;

// M29 (decisions.md 2026-08-22): neither fetch() below had any deadline — a
// stalled connection (a local endpoint like Ollama mid-model-load, or a
// dropped connection that never actually closes) hung the request
// indefinitely instead of failing. 5 minutes is generous enough for a slow
// local model on a full chapter, while still turning "hangs forever" into a
// bounded, recoverable LLMError("network", ...).
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

/** Combines the caller's own abort signal (job cancellation) with a fixed
 * request timeout, so either one aborts the fetch. */
function withRequestTimeout(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

/** Splits an async stream of text chunks into lines (SSE is line-delimited). */
export async function* sseLines(
  chunks: AsyncIterable<string>,
): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      yield buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.length > 0) yield buffer;
}

/**
 * Parses an OpenAI-compatible chat-completions SSE stream (`data: {...}`
 * lines, terminated by `data: [DONE]`) into text chunks from
 * `choices[0].delta.content`. Exported standalone so it's testable against a
 * mocked async-iterable stream without a real HTTP server.
 *
 * `usageSink`, when given, is written to (never yielded — the generator's
 * shape stays `{text}`-only for existing callers/tests) whenever a chunk
 * carries a `usage` field — the last one wins, which is the final chunk when
 * the request set `stream_options: {include_usage: true}`. Endpoints that
 * ignore that option simply never populate it, and the sink stays untouched.
 *
 * `modelSink`, when given, records the `model` field every chunk that has
 * one echoes (M22.5 H1: "record what the endpoint says it served, not only
 * what we asked for") — independent of `usageSink`, since a model string
 * can arrive on endpoints that never send usage numbers at all.
 */
export async function* parseOpenAICompatSSE(
  chunks: AsyncIterable<string>,
  usageSink?: { current: OpenAIUsage | null },
  modelSink?: { current: string | null },
): AsyncGenerator<{ text: string }> {
  for await (const line of sseLines(chunks)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    if (data.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue; // skip malformed/partial lines
    }

    const body = parsed as Record<string, unknown> | null;
    if (usageSink && body?.usage) {
      usageSink.current = body.usage as OpenAIUsage;
    }
    if (modelSink && typeof body?.model === "string" && body.model.length > 0) {
      modelSink.current = body.model;
    }

    const text = body?.choices as { delta?: { content?: unknown } }[] | undefined;
    const content = text?.[0]?.delta?.content;
    if (typeof content === "string" && content.length > 0) {
      yield { text: content };
    }
  }
}

async function* webStreamToStrings(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

interface OpenAICompatConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  contextTokens: number;
  /** M16 "max response length" — defaults to today's hardcoded value. */
  maxResponseTokens?: number;
}

export class OpenAICompatProvider implements LLMProvider {
  readonly id = "openai-compatible" as const;
  private readonly config: OpenAICompatConfig;
  // M17 usage accounting: set at the end of the most recent stream()/
  // extract() call. No standard cost field exists across arbitrary
  // OpenAI-compatible servers, so `costUsd` is never populated here.
  private lastUsage: ReportedUsage | null = null;
  // M22.5 H1: the `model` field the response itself echoed, when it did —
  // null on every call until an endpoint actually sends one.
  private lastServedModel: string | null = null;

  constructor(config: OpenAICompatConfig) {
    this.config = config;
  }

  capabilities(): { contextTokens: number; supportsCaching: boolean } {
    return { contextTokens: this.config.contextTokens, supportsCaching: false };
  }

  reportedUsage(): ReportedUsage | null {
    return this.lastUsage;
  }

  reportedModel(): string | null {
    return this.lastServedModel;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
    return headers;
  }

  private url(): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  async *stream(req: LLMStreamRequest): AsyncIterable<{ text: string }> {
    // No cache API for arbitrary OpenAI-compatible servers — book context
    // blocks are joined in order after the stable instructions. `cache` is
    // ignored (M34 §A3), but the ordering itself still helps a
    // llama.cpp-backed server reuse its own KV cache.
    const systemMessage = [req.instructions, ...req.bookContext.map((b) => b.text)].join("\n\n");

    let response: Response;
    try {
      response = await fetch(this.url(), {
        method: "POST",
        headers: this.headers(),
        signal: withRequestTimeout(req.signal),
        body: JSON.stringify({
          model: this.config.model,
          stream: true,
          // M17: requested on every call — endpoints that don't recognize
          // it (many do; OpenAI, OpenRouter, recent Ollama/LM Studio) just
          // ignore the field, and reportedUsage() falls back to the ledger
          // wrapper's own estimate in that case.
          stream_options: { include_usage: true },
          max_tokens: this.config.maxResponseTokens ?? 8192,
          messages: [
            { role: "system", content: systemMessage },
            ...req.messages,
          ],
        }),
      });
    } catch (err) {
      throw new LLMError("network", err instanceof Error ? err.message : String(err));
    }

    if (!response.ok) {
      throw await mapHttpError(response);
    }
    if (!response.body) {
      throw new LLMError("network", "empty response body");
    }

    const usageSink: { current: OpenAIUsage | null } = { current: null };
    const modelSink: { current: string | null } = { current: null };
    try {
      yield* parseOpenAICompatSSE(webStreamToStrings(response.body), usageSink, modelSink);
    } finally {
      this.lastUsage = toReportedUsage(usageSink.current ?? undefined);
      this.lastServedModel = modelSink.current;
    }
  }

  async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
    return this.extractAttempt(req, 0);
  }

  private async extractAttempt<T>(
    req: LLMExtractRequest<T>,
    attempt: number,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.url(), {
        method: "POST",
        headers: this.headers(),
        signal: withRequestTimeout(req.signal),
        body: JSON.stringify({
          model: this.config.model,
          response_format: { type: "json_object" },
          max_tokens: EXTRACT_MAX_TOKENS,
          messages: [
            { role: "system", content: req.instructions },
            { role: "user", content: req.input },
          ],
        }),
      });
    } catch (err) {
      throw new LLMError("network", err instanceof Error ? err.message : String(err));
    }

    if (!response.ok) {
      throw await mapHttpError(response);
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: OpenAIUsage;
      model?: string;
    };
    this.lastUsage = toReportedUsage(body.usage);
    this.lastServedModel = typeof body.model === "string" && body.model.length > 0 ? body.model : null;
    const content = body.choices?.[0]?.message?.content;

    let candidate: unknown;
    try {
      candidate = content ? JSON.parse(content) : undefined;
    } catch {
      candidate = undefined;
    }

    const result = req.schema.safeParse(candidate);
    if (result.success) return result.data;

    if (attempt === 0) {
      return this.extractAttempt(
        {
          ...req,
          input: `${req.input}\n\nYour previous output failed schema validation: ${result.error.message}\nReturn valid JSON matching the schema.`,
        },
        1,
      );
    }

    throw new LLMError("extract_parse_failed");
  }
}

async function mapHttpError(response: Response): Promise<LLMError> {
  const message = await response.text().catch(() => response.statusText);
  if (response.status === 401 || response.status === 403) {
    return new LLMError("auth", message);
  }
  if (response.status === 429) {
    return new LLMError("rate_limit", message);
  }
  if (response.status === 413) {
    return new LLMError("context_too_large", message);
  }
  return new LLMError("unknown", message);
}
