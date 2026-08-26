// The extract() seam uses zod/v4 specifically: @anthropic-ai/sdk's
// zodOutputFormat() helper (used by the Anthropic implementation) requires
// zod/v4 schema instances — classic "zod" (v3-shaped, used for the HTTP
// boundary schemas in shared/) is a structurally different type. Schemas
// passed to extract() (the M6 vault-compiler concept extraction) must be
// built with `import { z } from "zod/v4"`.
import type { z } from "zod/v4";
import type Database from "better-sqlite3";
import type { ProviderRole } from "@marginalia/shared";
import { getRoleMaxResponseTokens, getRoleProfileRaw } from "../settings/providers.js";
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
  /** M20.6 job registry: threaded through so a cancelled digest/thematic/
   * theme-tagging job actually stops the in-flight call, not just the next
   * one queued behind it. */
  signal?: AbortSignal;
}

/** Token/cost counts for the most recent call on a provider instance. */
export interface ReportedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  costUsd?: number;
}

/** M22.5 H1 ("you cannot prove which model answered by asking the model"):
 * the model string the endpoint actually reported serving, when it echoed
 * one — distinct from `reportedUsage()`, which is about token counts, not
 * identity. A misconfigured or silently-substituting OpenAI-compatible
 * endpoint is otherwise invisible: the ledger would only ever show the
 * string we *asked* for. */
export type ReportedModel = string | null;

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
  /** The model the endpoint said it served on the most recent call, when it
   * echoed one (M22.5 H1) — openai-compatible only, today. */
  reportedModel?(): ReportedModel;
  /** Plan/quota utilization, when the provider exposes it (hosted only). */
  planLimits?(): Promise<PlanLimits | null>;
}

/**
 * Returns the provider configured for `role`, or null if that role has no
 * profile assigned yet — the reader must stay usable with no provider set
 * (SPEC: "configure a provider" nudge instead of erroring).
 *
 * M19 (docs/decisions.md 2026-07-29 later): `role` ("query" | "digest")
 * resolves to a *profile* (a complete named config) rather than reading a
 * single global provider config — every call site now says what it's doing,
 * so a long book can be digested on a local model while Claude answers
 * questions in the same session. `operation` still names the finer-grained
 * usage-ledger tag (M17, decisions.md 2026-07-28 later) — several operations
 * can share a role (extract/digest/cast all use the digest role). The
 * returned provider is pre-wrapped with `withUsageLedger` so every
 * stream()/extract() the caller makes through it is logged automatically,
 * tagged with both role and operation. Callers never log usage themselves.
 */
export function getProvider(
  db: Database.Database,
  role: ProviderRole,
  operation: LLMOperation,
  resourceId: string | null = null,
  onUsageLogged?: (row: UsageLedgerRow) => void,
  maxResponseTokensOverride?: number,
): LLMProvider | null {
  const profile = getRoleProfileRaw(db, role);
  if (!profile) return null;
  // M30 C: the role's configured response length is the default. The one
  // override, added with its rule attached: **a caller may only replace this
  // if it caps the reader-visible output itself.** Define does (<100 tokens,
  // enforced in dictionary/define.ts), and needs the larger provider budget
  // because on a reasoning model the role ceiling is spent on thinking
  // tokens the reader never sees — see the measurements in define.ts. Any
  // caller whose output goes straight to the reader must not use this.
  const maxResponseTokens =
    maxResponseTokensOverride ?? getRoleMaxResponseTokens(db, role);
  // Hoisted below into a plain const — a nested `function` declaration
  // capturing `profile` directly loses TS's null-narrowing on it (TS can't
  // prove the closure only runs after the `if (!profile)` guard above).
  const profileId = profile.id;

  function wrap(provider: LLMProvider, model: string): LLMProvider {
    return withUsageLedger(provider, db, model, operation, role, resourceId, profileId, onUsageLogged);
  }

  if (profile.provider === "anthropic") {
    if (!profile.anthropicApiKey) return null;
    return wrap(
      new AnthropicProvider(profile.anthropicApiKey, profile.anthropicModel, maxResponseTokens),
      profile.anthropicModel,
    );
  }

  if (profile.provider === "claude-agent") {
    // No key needed — the Agent SDK uses the machine's Claude Code login.
    // A missing/expired login surfaces as an LLMError("auth") at call time.
    return wrap(
      new ClaudeAgentProvider(profile.claudeAgentModel, maxResponseTokens),
      profile.claudeAgentModel,
    );
  }

  if (profile.provider === "openai-compatible") {
    if (!profile.openaiBaseUrl || !profile.openaiModel) return null;
    return wrap(
      new OpenAICompatProvider({
        baseUrl: profile.openaiBaseUrl,
        model: profile.openaiModel,
        apiKey: profile.openaiApiKey,
        contextTokens: profile.openaiContextTokens,
        maxResponseTokens,
      }),
      profile.openaiModel,
    );
  }

  return null;
}
