import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import {
  LLMError,
  type LLMExtractRequest,
  type LLMProvider,
  type LLMStreamRequest,
  type PlanLimits,
  type ReportedUsage,
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
  private readonly maxResponseTokens?: number;
  // M17 usage accounting: set at the end of the most recent stream()/
  // extract() call. `lastQuery` is kept around only so planLimits() has a
  // live control channel to ask — a fresh provider instance is constructed
  // per request (llm/provider.ts's getProvider()), so neither field crosses
  // requests.
  private lastUsage: ReportedUsage | null = null;
  private lastQuery: Query | null = null;

  constructor(model: string, maxResponseTokens?: number) {
    this.model = model;
    this.maxResponseTokens = maxResponseTokens;
  }

  capabilities(): { contextTokens: number; supportsCaching: boolean } {
    // Subscription sessions get the standard 200K window unless the user has
    // opted into a 1M-context model variant. The harness manages prompt
    // caching internally, so caching is "free" from our side.
    const contextTokens = this.model.includes("[1m]") ? 1_000_000 : 200_000;
    return { contextTokens, supportsCaching: true };
  }

  reportedUsage(): ReportedUsage | null {
    return this.lastUsage;
  }

  /**
   * Opportunistic (decisions.md 2026-07-28 later): the Agent SDK's
   * `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` exposes
   * real plan-limit windows with reset times, but its own name is the
   * contract — unstable, removable without notice. Feature-detected (the
   * method may not exist on an older SDK build), wrapped in try/catch, and
   * asked of the most recent call's `Query` object rather than spinning up a
   * fresh one — this method's actual behavior on a torn-down control channel
   * couldn't be verified live in this environment (no `claude` CLI
   * available), so failing closed to "unavailable" is the safe default.
   */
  async planLimits(): Promise<PlanLimits | null> {
    const q = this.lastQuery;
    if (!q) return null;
    const usageFn = (q as unknown as Record<string, unknown>)
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof usageFn !== "function") return null;

    try {
      const usage = (await (usageFn as () => Promise<unknown>).call(q)) as {
        rate_limits_available: boolean;
        rate_limits: Record<
          string,
          { utilization: number | null; resets_at: string | null } | null | undefined
        > | null;
      };
      if (!usage.rate_limits_available || !usage.rate_limits) return null;

      const labels: Record<string, string> = {
        five_hour: "5-hour",
        seven_day: "7-day",
        seven_day_opus: "7-day (Opus)",
        seven_day_sonnet: "7-day (Sonnet)",
      };
      const windows = Object.entries(labels)
        .map(([key, label]) => {
          const window = usage.rate_limits?.[key];
          if (!window) return null;
          return { label, utilization: window.utilization, resetsAt: window.resets_at };
        })
        .filter((w): w is NonNullable<typeof w> => w !== null);

      return { windows };
    } catch {
      return null;
    }
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
          // M16 "max response length": the Agent SDK exposes no `max_tokens`
          // knob (decisions.md 2026-07-28) — the setting can only be
          // *requested* here as a system-prompt instruction, never enforced
          // the way the token-metered providers enforce it. The Settings UI
          // must say so next to the field rather than implying a guarantee.
          systemPrompt: `${req.instructions}${lengthInstruction(this.maxResponseTokens)}\n\n${req.bookContext}`,
          maxTurns: 1,
          includePartialMessages: true,
        },
      });
      this.lastQuery = q;

      for await (const message of q) {
        if (
          message.type === "stream_event" &&
          message.event.type === "content_block_delta" &&
          message.event.delta.type === "text_delta"
        ) {
          yield { text: message.event.delta.text };
        } else if (message.type === "result") {
          this.lastUsage = {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cacheReadTokens: message.usage.cache_read_input_tokens ?? undefined,
            costUsd: message.total_cost_usd,
          };
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
      this.lastQuery = q;

      for await (const message of q) {
        if (message.type === "result") {
          this.lastUsage = {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cacheReadTokens: message.usage.cache_read_input_tokens ?? undefined,
            costUsd: message.total_cost_usd,
          };
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
 * A soft, prose-only stand-in for the `max_tokens` param this provider can't
 * set. ~0.75 words/token is the rough Claude-tokenizer average for English
 * prose — good enough for an instruction, not a real budget.
 */
function lengthInstruction(maxResponseTokens?: number): string {
  if (!maxResponseTokens) return "";
  const words = Math.round(maxResponseTokens * 0.75);
  return `\n\nKeep your response under approximately ${maxResponseTokens} tokens (roughly ${words} words). This is a soft target you should aim for, not an enforced limit.`;
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
