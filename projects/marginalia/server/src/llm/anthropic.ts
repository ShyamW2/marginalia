import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  LLMError,
  type LLMExtractRequest,
  type LLMProvider,
  type LLMStreamRequest,
} from "./provider.js";

// M16 "max response length": THREAD_MAX_TOKENS became a persisted setting
// (default unchanged, decisions.md 2026-07-28) — but only for the thread
// *answer* path (stream()). SPEC-GAP: the task named this single constant,
// which extract() also happened to reuse for its own, unrelated structured-
// output ceiling (vault distillation, the M17 digest) — a low answer-length
// setting truncating those would corrupt JSON the caller expects to parse,
// which the acceptance criteria ("shortens answers") never asked for.
// Keeping extract() on its own fixed budget; logged in NOTES.md.
const EXTRACT_MAX_TOKENS = 8192;

// Context window per model (see docs/marginalia/SPEC.md's LLM layer section).
// Every current Claude model is 1M except the Haiku family, which caps at
// 200K — hardcoding 1M regardless of the configured model would overshoot
// the context builder's budget and risk a context_too_large error on Haiku.
const DEFAULT_CONTEXT_TOKENS = 1_000_000;
const MODEL_CONTEXT_TOKENS: Record<string, number> = {
  "claude-haiku-4-5": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-3-haiku-20240307": 200_000,
};

/**
 * Looks up the context window for a configured model string. Falls back to
 * matching on "haiku" in the id (covers future/unlisted Haiku snapshots)
 * before defaulting to the 1M ceiling every other current model shares.
 */
export function contextTokensForModel(model: string): number {
  const exact = MODEL_CONTEXT_TOKENS[model];
  if (exact !== undefined) return exact;
  if (model.includes("haiku")) return 200_000;
  return DEFAULT_CONTEXT_TOKENS;
}

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic" as const;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxResponseTokens: number;

  constructor(apiKey: string, model: string, maxResponseTokens = 8192) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.maxResponseTokens = maxResponseTokens;
  }

  capabilities(): { contextTokens: number; supportsCaching: boolean } {
    return { contextTokens: contextTokensForModel(this.model), supportsCaching: true };
  }

  async *stream(req: LLMStreamRequest): AsyncIterable<{ text: string }> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: this.maxResponseTokens,
        // Two-block system: stable instructions, then the large stable
        // book context with a cache breakpoint — follow-up questions on
        // the same book hit the cache (~0.1x input price). Never
        // interpolate anything volatile into either block.
        system: [
          { type: "text", text: req.instructions },
          {
            type: "text",
            text: req.bookContext,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: req.messages,
      },
      { signal: req.signal },
    );

    try {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { text: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      // eslint-disable-next-line no-console
      console.debug(
        `[anthropic] cache_read_input_tokens=${finalMessage.usage.cache_read_input_tokens ?? 0} cache_creation_input_tokens=${finalMessage.usage.cache_creation_input_tokens ?? 0}`,
      );
      if (finalMessage.stop_reason === "refusal") {
        throw new LLMError("refused", "The model declined to answer.");
      }
    } catch (err) {
      throw mapError(err);
    }
  }

  async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
    try {
      const message = await this.client.messages.parse({
        model: this.model,
        max_tokens: EXTRACT_MAX_TOKENS,
        system: req.instructions,
        messages: [{ role: "user", content: req.input }],
        output_config: {
          format: zodOutputFormat(req.schema),
        },
      });

      if (message.stop_reason === "refusal") {
        throw new LLMError("refused", "The model declined to answer.");
      }
      if (message.parsed_output === null) {
        throw new LLMError("extract_parse_failed");
      }
      return message.parsed_output as T;
    } catch (err) {
      throw mapError(err);
    }
  }
}

function mapError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new LLMError("auth", err.message);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new LLMError("rate_limit", err.message);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LLMError("network", err.message);
  }
  if (err instanceof Anthropic.BadRequestError) {
    // A too-large context ships as a 400 from the API; anything else
    // still gets surfaced, just not misclassified as a network failure.
    if (/context|too long|maximum context/i.test(err.message)) {
      return new LLMError("context_too_large", err.message);
    }
    return new LLMError("unknown", err.message);
  }
  if (err instanceof Anthropic.APIError) {
    return new LLMError("unknown", err.message);
  }
  return new LLMError("unknown", err instanceof Error ? err.message : String(err));
}
