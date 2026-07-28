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
import { withUsageLedger, type LLMOperation, type UsageLedgerRow } from "./usage.js";

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

/** Token/cost counts for the most recent call on a provider instance. */
export interface ReportedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

/** One plan/quota utilization window (e.g. "5-hour", "7-day"). */
export interface PlanLimitWindow {
  label: string;
  utilization: number | null;
  resetsAt: string | null;
}

export interface PlanLimits {
  windows: PlanLimitWindow[];
}

export interface LLMProvider {
  readonly id: "anthropic" | "openai-compatible" | "claude-agent";
  capabilities(): { contextTokens: number; supportsCaching: boolean };
  stream(req: LLMStreamRequest): AsyncIterable<{ text: string }>;
  extract<T>(req: LLMExtractRequest<T>): Promise<T>;

  // --- M17 usage accounting. OPTIONAL by design (SPEC): not every provider
  // can report these, and optionality encodes "may be absent" in the type
  // system rather than in a comment. Absence is a normal state the UI
  // renders, never an error.
  /** Token/cost counts for the most recent stream()/extract() call. */
  reportedUsage?(): ReportedUsage | null;
  /** Plan/quota utilization, when the provider exposes it (hosted only). */
  planLimits?(): Promise<PlanLimits | null>;
}

/**
 * Returns the configured provider, or null if none is configured yet (no API
 * key / base URL set) — the reader must stay usable with no provider set
 * (SPEC: "configure a provider" nudge instead of erroring).
 *
 * `operation` names what this call is for (M17 usage ledger, decisions.md
 * 2026-07-28 later) — the returned provider is pre-wrapped with
 * `withUsageLedger` so every stream()/extract() the caller makes through it
 * is logged automatically. Callers never log usage themselves.
 */
export function getProvider(
  db: Database.Database,
  operation: LLMOperation,
  onUsageLogged?: (row: Omit<UsageLedgerRow, "id" | "createdAt">) => void,
): LLMProvider | null {
  const settings = getRawSettings(db);

  function wrap(provider: LLMProvider, model: string): LLMProvider {
    return withUsageLedger(provider, db, model, operation, onUsageLogged);
  }

  if (settings.provider === "anthropic") {
    if (!settings.anthropicApiKey) return null;
    return wrap(
      new AnthropicProvider(
        settings.anthropicApiKey,
        settings.anthropicModel,
        settings.maxResponseTokens,
      ),
      settings.anthropicModel,
    );
  }

  if (settings.provider === "claude-agent") {
    // No key needed — the Agent SDK uses the machine's Claude Code login.
    // A missing/expired login surfaces as an LLMError("auth") at call time.
    return wrap(
      new ClaudeAgentProvider(settings.claudeAgentModel, settings.maxResponseTokens),
      settings.claudeAgentModel,
    );
  }

  if (settings.provider === "openai-compatible") {
    if (!settings.openaiBaseUrl || !settings.openaiModel) return null;
    return wrap(
      new OpenAICompatProvider({
        baseUrl: settings.openaiBaseUrl,
        model: settings.openaiModel,
        apiKey: settings.openaiApiKey,
        contextTokens: settings.openaiContextTokens,
        maxResponseTokens: settings.maxResponseTokens,
      }),
      settings.openaiModel,
    );
  }

  return null;
}
