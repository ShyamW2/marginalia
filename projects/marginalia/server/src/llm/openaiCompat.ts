import {
  LLMError,
  type LLMExtractRequest,
  type LLMProvider,
  type LLMStreamRequest,
} from "./provider.js";

const THREAD_MAX_TOKENS = 8192;

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
 */
export async function* parseOpenAICompatSSE(
  chunks: AsyncIterable<string>,
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

    const text = (parsed as Record<string, unknown> | null)?.choices as
      | { delta?: { content?: unknown } }[]
      | undefined;
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
}

export class OpenAICompatProvider implements LLMProvider {
  readonly id = "openai-compatible" as const;
  private readonly config: OpenAICompatConfig;

  constructor(config: OpenAICompatConfig) {
    this.config = config;
  }

  capabilities(): { contextTokens: number; supportsCaching: boolean } {
    return { contextTokens: this.config.contextTokens, supportsCaching: false };
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
    // rides in the system message, after the stable instructions.
    const systemMessage = `${req.instructions}\n\n${req.bookContext}`;

    let response: Response;
    try {
      response = await fetch(this.url(), {
        method: "POST",
        headers: this.headers(),
        signal: req.signal,
        body: JSON.stringify({
          model: this.config.model,
          stream: true,
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

    yield* parseOpenAICompatSSE(webStreamToStrings(response.body));
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
        body: JSON.stringify({
          model: this.config.model,
          response_format: { type: "json_object" },
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
    };
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
