import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { LLMProviderId, MessageProvenance, ProviderRole, UsageCostBasis } from "@marginalia/shared";
import type {
  LLMExtractRequest,
  LLMProvider,
  LLMStreamRequest,
} from "./provider.js";
import { priceCall } from "./pricing.js";
import { getProviderProfile } from "../settings/providers.js";

/**
 * M17 usage ledger (docs/decisions.md 2026-07-28 later). One row per
 * provider call — the four operations the digest work introduces
 * ("thread" already existed; "extract" covers vault distillation and the
 * desk notepad; "digest"/"cast" are M17/M22). "thematic" is M19.5's own tag,
 * kept separate from "digest" even though both resolve to the digest role
 * (decisions.md: roles are reused across features, but the ledger's
 * "broken down by operation" would lose the plot/thematic distinction this
 * milestone exists to draw if the two shared a tag).
 */
export type LLMOperation =
  | "thread"
  | "extract"
  | "digest"
  | "cast"
  | "thematic"
  | "theme-distillation"
  // M30 C: Define's digest-rung fallback. Its own tag rather than "thread"
  // because it is the one operation in the app with a hard *product* cap on
  // output length — a ledger that folded it into threads would hide both
  // that Define is cheap and that a book is being defined at rather than
  // discussed.
  | "define";

/**
 * Every number's provenance: `reported` (the provider returned real counts),
 * `measured` (tokenized locally with a real tokenizer), or `estimated` (the
 * `CHARS_PER_TOKEN` heuristic below, +/-30%). SPEC-GAP: this project has no
 * local tokenizer dependency, so nothing currently produces `measured` — the
 * type allows it for forward compatibility, but only `reported`/`estimated`
 * are ever written today. Recorded in NOTES.md "M17" rather than faked.
 */
export type UsageProvenance = "reported" | "measured" | "estimated";

/** M22.5 H1: which of `model`'s two possible sources this row records —
 * the endpoint's own echoed string, or (absent that) the profile's
 * configured one. See openaiCompat.ts's `reportedModel()`. */
export type ModelSource = "endpoint" | "configured";

/** M22.5 H4: excludes `mixed`, which only ever appears on a rolled-up
 * group, never a single ledger row. */
export type RowCostBasis = Exclude<UsageCostBasis, "mixed">;

export interface UsageLedgerRow {
  id: string;
  provider: string;
  model: string;
  modelSource: ModelSource;
  operation: LLMOperation;
  /** M19: which named role (query/digest) made this call — null only for
   * ledger rows written before M19 introduced roles. */
  role: ProviderRole | null;
  /** M19: which book this call was about, when there is one — the desk
   * notepad's extract() calls aren't tied to a single resource. */
  resourceId: string | null;
  /** M22.5 H2: the answer this call produced, once it exists — null at the
   * moment of logging (the message isn't persisted yet; see threads.ts's
   * `persistExchange` ordering) and linked in afterward via
   * `linkUsageToMessage`. Pre-M22.5 rows stay null forever. */
  messageId: string | null;
  /** M22.5 H5: which provider *profile* made this call — `provider` alone
   * can't distinguish a local Ollama from a hosted OpenRouter, both
   * `openai-compatible`. Null for pre-M22.5 rows. */
  profileId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  costUsd: number | null;
  costBasis: RowCostBasis;
  provenance: UsageProvenance;
  durationMs: number;
  createdAt: string;
}

// Matches llm/context.ts's own CHARS_PER_TOKEN (SPEC's conservative
// estimate). Duplicated rather than imported — it's one constant, and
// coupling this file to context.ts for it isn't worth the dependency.
const CHARS_PER_TOKEN = 3.5;

function estimateTokens(chars: number): number {
  return Math.max(0, Math.round(chars / CHARS_PER_TOKEN));
}

/** Writes one row and returns it in full (id + createdAt included) — the
 * caller (`withUsageLedger`'s `onLogged`) needs the id to later link a
 * message to it, which a void return couldn't support. */
export function recordUsage(
  db: Database.Database,
  row: Omit<UsageLedgerRow, "id" | "createdAt">,
): UsageLedgerRow {
  const full: UsageLedgerRow = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...row,
  };
  db.prepare(
    `INSERT INTO llm_usage
       (id, provider, model, model_source, operation, role, resource_id, message_id, profile_id,
        input_tokens, output_tokens, cache_read_tokens, cost_usd, cost_basis, provenance,
        duration_ms, created_at)
     VALUES
       (@id, @provider, @model, @modelSource, @operation, @role, @resourceId, @messageId, @profileId,
        @inputTokens, @outputTokens, @cacheReadTokens, @costUsd, @costBasis, @provenance,
        @durationMs, @createdAt)`,
  ).run(full);
  return full;
}

/** M22.5 H2: called once the answer a usage row paid for actually has an
 * id — `recordUsage` runs inside the provider stream's own `finally`,
 * before `persistExchange` creates the message (see threads.ts), so the
 * link can only be written after the fact. A no-op if `usageId` doesn't
 * exist (defensive; every real caller has just created the row). */
export function linkUsageToMessage(db: Database.Database, usageId: string, messageId: string): void {
  db.prepare("UPDATE llm_usage SET message_id = ? WHERE id = ?").run(messageId, usageId);
}

/** M22.5 H2: "which model actually answered" — the byline under an
 * assistant message, built from its own ledger row rather than whatever
 * the settings UI currently holds (a profile can be renamed/reconfigured
 * after the fact). Shared by the live SSE `done` payload (threads.ts) and
 * any future re-read of a persisted message. */
export function buildMessageProvenance(
  db: Database.Database,
  row: Pick<UsageLedgerRow, "provider" | "model" | "profileId"> | null,
): MessageProvenance | null {
  if (!row) return null;
  const profile = row.profileId ? getProviderProfile(db, row.profileId) : null;
  return {
    profileName: profile?.name ?? null,
    provider: row.provider as LLMProviderId,
    model: row.model,
    endpointHost: endpointHostFor(row.provider, profile?.openaiBaseUrl ?? null),
  };
}

/** Exported so `annotations/threads.ts` can reuse it for the JOIN-based
 * read path — the SSE path above and the persisted-message read path
 * (`listMessagesForThread`) must agree on what an "endpoint host" is. */
export function endpointHostFor(provider: string, openaiBaseUrl: string | null): string | null {
  if (provider === "anthropic") return "api.anthropic.com";
  if (provider === "claude-agent") return "Claude Code (subscription)";
  if (provider === "openai-compatible") {
    if (!openaiBaseUrl) return null;
    try {
      return new URL(openaiBaseUrl).host;
    } catch {
      return openaiBaseUrl;
    }
  }
  return null;
}

/** M17 "context-window readout": tokens spent on a single call over the
 * provider's context window, works identically for every provider — the
 * window is `capabilities().contextTokens` (for local models, that's the
 * `openaiContextTokens` setting the user already configures). */
export interface ContextUsage {
  tokensUsed: number;
  windowTokens: number;
  percent: number;
  provenance: UsageProvenance;
}

export function computeContextUsage(
  row: Pick<UsageLedgerRow, "inputTokens" | "provenance">,
  windowTokens: number,
): ContextUsage {
  const percent = windowTokens > 0 ? (row.inputTokens / windowTokens) * 100 : 0;
  return {
    tokensUsed: row.inputTokens,
    windowTokens,
    percent,
    provenance: row.provenance,
  };
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  /** M22.5 H4: split by basis, not one blended number — see
   * `UsagePeriod.billedCostUsd`/`notionalCostUsd` in shared/src/schemas.ts. */
  billedCostUsd: number;
  notionalCostUsd: number;
  callCount: number;
}

/** Totals since an ISO timestamp — the Settings "Usage" divider's "today" /
 * "7 days" rollups (M19) read through this; kept here so that UI's data
 * layer is a one-line query, not a second copy of the aggregation. */
export function getUsageTotalsSince(db: Database.Database, sinceIso: string): UsageTotals {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS input_tokens,
         COALESCE(SUM(output_tokens), 0) AS output_tokens,
         COALESCE(SUM(CASE WHEN cost_basis = 'billed' THEN cost_usd ELSE 0 END), 0) AS billed_cost_usd,
         COALESCE(SUM(CASE WHEN cost_basis = 'notional' THEN cost_usd ELSE 0 END), 0) AS notional_cost_usd,
         COUNT(*) AS call_count
       FROM llm_usage WHERE created_at >= ?`,
    )
    .get(sinceIso) as {
    input_tokens: number;
    output_tokens: number;
    billed_cost_usd: number;
    notional_cost_usd: number;
    call_count: number;
  };
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    billedCostUsd: row.billed_cost_usd,
    notionalCostUsd: row.notional_cost_usd,
    callCount: row.call_count,
  };
}

export interface UsageBreakdownRow {
  resourceId: string | null;
  resourceTitle: string | null;
  operation: LLMOperation;
  role: ProviderRole | null;
  provider: LLMProviderId | null;
  model: string | null;
  profileId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number;
  costUsd: number | null;
  costBasis: RowCostBasis | "mixed";
  provenance: UsageProvenance | "mixed";
  callCount: number;
}

/**
 * Rolls calls up by (book, operation, role, provider, model, profile) — a
 * widening of the original (book, operation) grouping (M22.5 H5,
 * decisions.md 2026-08-04: "nearly all of it is already recorded and
 * thrown away"). The Usage divider still shows the by-book table from this
 * same array; it additionally re-groups these rows by provider/model
 * client-side rather than the server building a second, parallel query.
 * `provenance`/`costBasis` are `mixed` when a group spans more than one
 * value, so the UI never labels a blended figure as either alone.
 */
export function getUsageBreakdownSince(
  db: Database.Database,
  sinceIso: string,
): UsageBreakdownRow[] {
  const rows = db
    .prepare(
      `SELECT
         u.resource_id AS resource_id,
         r.title AS resource_title,
         u.operation AS operation,
         u.role AS role,
         u.provider AS provider,
         u.model AS model,
         u.profile_id AS profile_id,
         COALESCE(SUM(u.input_tokens), 0) AS input_tokens,
         COALESCE(SUM(u.output_tokens), 0) AS output_tokens,
         COALESCE(SUM(u.cache_read_tokens), 0) AS cache_read_tokens,
         COALESCE(SUM(u.duration_ms), 0) AS duration_ms,
         SUM(u.cost_usd) AS cost_usd,
         COUNT(*) AS call_count,
         COUNT(DISTINCT u.provenance) AS provenance_count,
         MIN(u.provenance) AS single_provenance,
         COUNT(DISTINCT u.cost_basis) AS cost_basis_count,
         MIN(u.cost_basis) AS single_cost_basis
       FROM llm_usage u
       LEFT JOIN resources r ON r.id = u.resource_id
       WHERE u.created_at >= ?
       GROUP BY u.resource_id, u.operation, u.role, u.provider, u.model, u.profile_id
       ORDER BY input_tokens DESC`,
    )
    .all(sinceIso) as {
    resource_id: string | null;
    resource_title: string | null;
    operation: LLMOperation;
    role: ProviderRole | null;
    provider: LLMProviderId | null;
    model: string | null;
    profile_id: string | null;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    duration_ms: number;
    cost_usd: number | null;
    call_count: number;
    provenance_count: number;
    single_provenance: UsageProvenance;
    cost_basis_count: number;
    single_cost_basis: RowCostBasis;
  }[];

  return rows.map((row) => ({
    resourceId: row.resource_id,
    resourceTitle: row.resource_title,
    operation: row.operation,
    role: row.role,
    provider: row.provider,
    model: row.model,
    profileId: row.profile_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    durationMs: row.duration_ms,
    costUsd: row.cost_usd,
    costBasis: row.cost_basis_count > 1 ? "mixed" : row.single_cost_basis,
    provenance: row.provenance_count > 1 ? "mixed" : row.single_provenance,
    callCount: row.call_count,
  }));
}

export interface LastRoleUsageRow {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  provenance: UsageProvenance;
  createdAt: string;
}

/** The most recent call made under a role — the Usage divider's "local
 * models show tokens, context percentage, and speed" (TASKS.md M19): local
 * providers have no quota API to report, so the divider falls back to what
 * the ledger already knows about the last call this role actually made. */
export function getLastUsageForRole(db: Database.Database, role: ProviderRole): LastRoleUsageRow | null {
  const row = db
    .prepare(
      `SELECT input_tokens AS input_tokens, output_tokens AS output_tokens,
              duration_ms AS duration_ms, provenance AS provenance, created_at AS created_at
       FROM llm_usage
       WHERE role = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(role) as
    | { input_tokens: number; output_tokens: number; duration_ms: number; provenance: UsageProvenance; created_at: string }
    | undefined;
  if (!row) return null;
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    durationMs: row.duration_ms,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

export interface LastDigestUsageRow {
  resourceId: string;
  resourceTitle: string | null;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  provenance: UsageProvenance;
  createdAt: string;
}

/** The most recent digest-operation call, book-scoped — the Usage divider's
 * "the last digest run's cost". A digest run is many calls (one per
 * chapter); this deliberately reports the latest single call rather than
 * summing an ambiguous "run", since runs aren't tracked as a unit here. */
export function getLastDigestUsage(db: Database.Database): LastDigestUsageRow | null {
  const row = db
    .prepare(
      `SELECT u.resource_id AS resource_id, r.title AS resource_title,
              u.cost_usd AS cost_usd, u.input_tokens AS input_tokens,
              u.output_tokens AS output_tokens, u.provenance AS provenance,
              u.created_at AS created_at
       FROM llm_usage u
       LEFT JOIN resources r ON r.id = u.resource_id
       WHERE u.operation = 'digest' AND u.resource_id IS NOT NULL
       ORDER BY u.created_at DESC
       LIMIT 1`,
    )
    .get() as
    | {
        resource_id: string;
        resource_title: string | null;
        cost_usd: number | null;
        input_tokens: number;
        output_tokens: number;
        provenance: UsageProvenance;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    resourceId: row.resource_id,
    resourceTitle: row.resource_title,
    costUsd: row.cost_usd,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    provenance: row.provenance,
    createdAt: row.created_at,
  };
}

/**
 * Decorates a provider so every stream()/extract() call writes exactly one
 * `llm_usage` row — the "one place in the seam" decisions.md calls for, so
 * no route or future call site can forget to log. Prefers the provider's
 * own `reportedUsage()` when it implements the optional member; otherwise
 * falls back to the chars/token estimate, always labeled `estimated`.
 */
export function withUsageLedger(
  provider: LLMProvider,
  db: Database.Database,
  model: string,
  operation: LLMOperation,
  /** M19: which role resolved to this provider instance — recorded on every
   * row so the ledger can answer "which model ran this?" per decisions.md
   * 2026-07-29 (later). */
  role: ProviderRole,
  /** M19: the book this call is about, when there is one (the desk notepad's
   * extract() calls have none). */
  resourceId: string | null,
  /** M22.5 H5: which profile resolved to this provider instance — the
   * ledger's own answer to "is this local?" (via the profile's base URL),
   * distinct from `provider` (which `openai-compatible` alone can't answer). */
  profileId: string | null,
  /** M17 "context-window readout": fired synchronously right after the row
   * is written, so a caller (a route) can read back exactly what was logged
   * for *this* call — without a re-query, which would race concurrent
   * requests logging their own rows in between. */
  onLogged?: (row: UsageLedgerRow) => void,
): LLMProvider {
  function inputCharsOf(req: LLMStreamRequest): number {
    return (
      req.instructions.length +
      req.bookContext.length +
      req.messages.reduce((sum, m) => sum + m.content.length, 0)
    );
  }

  function log(inputChars: number, outputChars: number, startedAt: number): void {
    const durationMs = Date.now() - startedAt;
    const reported = provider.reportedUsage?.() ?? null;
    // M22.5 H1: the endpoint's own served-model string, when it echoed one —
    // only openai-compatible responses do today. Recording *which* of the
    // two this is (rather than silently preferring one) is the point.
    const servedModel = provider.reportedModel?.() ?? null;
    const recordedModel = servedModel ?? model;
    const modelSource: ModelSource = servedModel ? "endpoint" : "configured";

    const inputTokens = reported ? reported.inputTokens : estimateTokens(inputChars);
    const outputTokens = reported ? reported.outputTokens : estimateTokens(outputChars);
    const cacheReadTokens = reported?.cacheReadTokens ?? null;
    const provenance: UsageProvenance = reported ? "reported" : "estimated";

    const priced = priceCall(
      provider.id,
      recordedModel,
      inputTokens,
      outputTokens,
      cacheReadTokens ?? 0,
      reported?.costUsd ?? null,
    );

    const row = recordUsage(db, {
      provider: provider.id,
      model: recordedModel,
      modelSource,
      operation,
      role,
      resourceId,
      messageId: null,
      profileId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd: priced.costUsd,
      costBasis: priced.costBasis,
      provenance,
      durationMs,
    });
    onLogged?.(row);
  }

  return {
    id: provider.id,
    capabilities: () => provider.capabilities(),
    async *stream(req: LLMStreamRequest) {
      const startedAt = Date.now();
      let outputChars = 0;
      try {
        for await (const chunk of provider.stream(req)) {
          outputChars += chunk.text.length;
          yield chunk;
        }
      } finally {
        log(inputCharsOf(req), outputChars, startedAt);
      }
    },
    async extract<T>(req: LLMExtractRequest<T>): Promise<T> {
      const startedAt = Date.now();
      let outputChars = 0;
      try {
        const result = await provider.extract(req);
        // extract() returns structured data, not raw text — its JSON length
        // is the only output-size signal available without changing the seam.
        outputChars = JSON.stringify(result).length;
        return result;
      } finally {
        log(req.instructions.length + req.input.length, outputChars, startedAt);
      }
    },
    reportedUsage: provider.reportedUsage?.bind(provider),
    reportedModel: provider.reportedModel?.bind(provider),
    planLimits: provider.planLimits?.bind(provider),
  };
}
