// The extract() seam uses zod/v4 specifically: @anthropic-ai/sdk's
// zodOutputFormat() helper (used by the Anthropic implementation) requires
// zod/v4 schema instances — classic "zod" (v3-shaped, used for the HTTP
// boundary schemas in shared/) is a structurally different type. Schemas
// passed to extract() (the M6 vault-compiler concept extraction) must be
// built with `import { z } from "zod/v4"`.
import type { z } from "zod/v4";
import type Database from "better-sqlite3";
import { getRawSettings } from "../settings/store.js";
import { AnthropicProvider } from "./anthropic.js";
import { ClaudeAgentProvider } from "./claudeAgent.js";
import { OpenAICompatProvider } from "./openaiCompat.js";

export type LLMErrorCode =
  | "auth"
  | "rate_limit"
  | "context_too_large"
  | "extract_parse_failed"
  | "network"
  | "refused"
  | "unknown";

export class LLMError extends Error {
  readonly code: LLMErrorCode;

  constructor(code: LLMErrorCode, message?: string) {
    super(message ?? code);
    this.name = "LLMError";
    this.code = code;
  }
}

export interface LLMStreamRequest {
  /** Stable system instructions. */
  instructions: string;
  /** Large, stable per-book context (cacheable). */
  bookContext: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
}

export interface LLMExtractRequest<T> {
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
}

export interface LLMProvider {
  readonly id: "anthropic" | "openai-compatible" | "claude-agent";
  capabilities(): { contextTokens: number; supportsCaching: boolean };
  stream(req: LLMStreamRequest): AsyncIterable<{ text: string }>;
  extract<T>(req: LLMExtractRequest<T>): Promise<T>;
}

/**
 * Returns the configured provider, or null if none is configured yet (no API
 * key / base URL set) — the reader must stay usable with no provider set
 * (SPEC: "configure a provider" nudge instead of erroring).
 */
export function getProvider(db: Database.Database): LLMProvider | null {
  const settings = getRawSettings(db);

  if (settings.provider === "anthropic") {
    if (!settings.anthropicApiKey) return null;
    return new AnthropicProvider(
      settings.anthropicApiKey,
      settings.anthropicModel,
      settings.maxResponseTokens,
    );
  }

  if (settings.provider === "claude-agent") {
    // No key needed — the Agent SDK uses the machine's Claude Code login.
    // A missing/expired login surfaces as an LLMError("auth") at call time.
    return new ClaudeAgentProvider(settings.claudeAgentModel, settings.maxResponseTokens);
  }

  if (settings.provider === "openai-compatible") {
    if (!settings.openaiBaseUrl || !settings.openaiModel) return null;
    return new OpenAICompatProvider({
      baseUrl: settings.openaiBaseUrl,
      model: settings.openaiModel,
      apiKey: settings.openaiApiKey,
      contextTokens: settings.openaiContextTokens,
      maxResponseTokens: settings.maxResponseTokens,
    });
  }

  return null;
}
