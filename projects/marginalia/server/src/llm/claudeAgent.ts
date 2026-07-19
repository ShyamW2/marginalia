import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import {
  LLMError,
  type LLMExtractRequest,
  type LLMProvider,
  type LLMStreamRequest,
} from "./provider.js";

/**
 * Claude subscription provider (decisions.md 2026-07-17 / 2026-07-19): routes
 * through the Claude Agent SDK, which spawns the bundled Claude Code CLI and
 * authenticates with the machine's Claude Code login (`claude /login`, or a
 * long-lived `claude setup-token` token in CLAUDE_CODE_OAUTH_TOKEN). Usage
 * bills against the user's Pro/Max subscription, not per-token API billing.
 *
 * All built-in tools are disabled (`tools: []`) — the model only ever returns
 * text or structured JSON, same contract as the other providers.
 */
export class ClaudeAgentProvider implements LLMProvider {
  readonly id = "claude-agent" as const;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
  }

  capabilities(): { contextTokens: number; supportsCaching: boolean } {
    // Subscription sessions get the standard 200K window unless the user has
    // opted into a 1M-context model variant. The harness manages prompt
    // caching internally, so caching is "free" from our side.
    const contextTokens = this.model.includes("[1m]") ? 1_000_000 : 200_000;
    return { contextTokens, supportsCaching: true };
  }

  private baseOptions(signal?: AbortSignal) {
    const abortController = new AbortController();
    if (signal) {
      if (signal.aborted) abortController.abort();
      else signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }
    return {
      model: this.model,
      tools: [] as string[],
      settingSources: [] as never[],
      abortController,
      // Force subscription auth: an inherited ANTHROPIC_API_KEY would silently
      // switch billing to the API. Everything else (HOME, PATH — needed to find
      // the login credentials) is inherited.
      env: { ...process.env, ANTHROPIC_API_KEY: undefined },
    };
  }

  async *stream(req: LLMStreamRequest): AsyncIterable<{ text: string }> {
    const prompt = renderTranscript(req.messages);

    try {
      const q = query({
        prompt,
        options: {
          ...this.baseOptions(req.signal),
          systemPrompt: `${req.instructions}\n\n${req.bookContext}`,
          maxTurns: 1,
          includePartialMessages: true,
        },
      });

      for await (const message of q) {
        if (
          message.type === "stream_event" &&
          message.event.type === "content_block_delta" &&
          message.event.delta.type === "text_delta"
        ) {
          yield { text: message.event.delta.text };
        } else if (message.type === "result") {
          if (message.subtype !== "success" || message.is_error) {
            const errors = message.subtype === "success" ? [] : message.errors;
            throw mapAgentError(errors.join("; ") || message.subtype);
          }
        }
      }
    } catch (err) {
      throw err instanceof LLMError ? err : mapAgentError(errMessage(err));
    }
  }

  async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
    return this.extractAttempt(req, 0);
  }

  private async extractAttempt<T>(req: LLMExtractRequest<T>, attempt: number): Promise<T> {
    let structured: unknown;
    let resultText = "";

    try {
      const q = query({
        prompt: req.input,
        options: {
          ...this.baseOptions(),
          systemPrompt: req.instructions,
          // No tools, but leave headroom for the harness's internal
          // structured-output retry turns.
          maxTurns: 4,
          outputFormat: {
            type: "json_schema",
            schema: toAgentJsonSchema(req.schema as z.ZodType<unknown>),
          },
        },
      });

      for await (const message of q) {
        if (message.type === "result") {
          if (message.subtype === "error_max_structured_output_retries") {
            throw new LLMError("extract_parse_failed");
          }
          if (message.subtype !== "success" || message.is_error) {
            const errors = message.subtype === "success" ? [] : message.errors;
            throw mapAgentError(errors.join("; ") || message.subtype);
          }
          structured = message.structured_output;
          resultText = message.result;
        }
      }
    } catch (err) {
      throw err instanceof LLMError ? err : mapAgentError(errMessage(err));
    }

    if (structured === undefined) {
      // Older harness builds may omit structured_output — fall back to the
      // result text, which the schema constraint makes valid JSON on success.
      try {
        structured = JSON.parse(resultText);
      } catch {
        structured = undefined;
      }
    }

    const parsed = req.schema.safeParse(structured);
    if (parsed.success) return parsed.data;

    if (attempt === 0) {
      return this.extractAttempt(
        {
          ...req,
          input: `${req.input}\n\nYour previous output failed schema validation: ${parsed.error.message}\nReturn valid JSON matching the schema.`,
        },
        1,
      );
    }
    throw new LLMError("extract_parse_failed");
  }
}

/**
 * The Agent SDK takes a single prompt string, not a role-structured message
 * array, so thread history is rendered as a labeled transcript. Threads are
 * short Q&A chains, so the fidelity loss is acceptable (SPEC seam note).
 */
export function renderTranscript(
  messages: { role: "user" | "assistant"; content: string }[],
): string {
  if (messages.length === 1) return messages[0].content;
  return messages
    .map((m) => `${m.role === "user" ? "[User]" : "[Assistant]"}\n${m.content}`)
    .join("\n\n");
}

/**
 * The CLI validates --json-schema with a draft-07 validator; zod v4's default
 * 2020-12 `$schema` marker makes it reject the whole schema ("no schema with
 * key or ref ..."). Emit draft-7 and drop the marker entirely.
 */
function toAgentJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The Agent SDK surfaces failures as thrown Errors or result-message error
 * strings from the spawned CLI, not typed API exceptions — classify by
 * message text.
 */
function mapAgentError(message: string): LLMError {
  if (/log ?in|logged out|authenticat|credential|oauth|api key|setup-token/i.test(message)) {
    return new LLMError(
      "auth",
      `Claude subscription login not available: ${message}. Run \`claude /login\` or set CLAUDE_CODE_OAUTH_TOKEN via \`claude setup-token\`.`,
    );
  }
  if (/rate ?limit|usage limit|out of (credits|usage)|429/i.test(message)) {
    return new LLMError("rate_limit", message);
  }
  if (/prompt is too long|context.*(exceed|too large|too long)/i.test(message)) {
    return new LLMError("context_too_large", message);
  }
  if (/abort/i.test(message)) {
    return new LLMError("unknown", message);
  }
  if (/ENOENT|ECONNREFUSED|network|fetch failed/i.test(message)) {
    return new LLMError("network", message);
  }
  return new LLMError("unknown", message);
}
