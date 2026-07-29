import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { ProviderRole } from "@marginalia/shared";
import type {
  LLMExtractRequest,
  LLMProvider,
  LLMStreamRequest,
} from "./provider.js";

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
export type LLMOperation = "thread" | "extract" | "digest" | "cast" | "thematic";

/**
 * Every number's provenance: `reported` (the provider returned real counts),
 * `measured` (tokenized locally with a real tokenizer), or `estimated` (the
 * `CHARS_PER_TOKEN` heuristic below, +/-30%). SPEC-GAP: this project has no
 * local tokenizer dependency, so nothing currently produces `measured` — the
 * type allows it for forward compatibility, but only `reported`/`estimated`
 * are ever written today. Recorded in NOTES.md "M17" rather than faked.
 */
export type UsageProvenance = "reported" | "measured" | "estimated";

export interface UsageLedgerRow {
  id: string;
  provider: string;
  model: string;
  operation: LLMOperation;
  /** M19: which named role (query/digest) made this call — null only for
   * ledger rows written before M19 introduced roles. */
  role: ProviderRole | null;
  /** M19: which book this call was about, when there is one — the desk
   * notepad's extract() calls aren't tied to a single resource. */
  resourceId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number | null;
  costUsd: number | null;
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

export function recordUsage(
  db: Database.Database,
  row: Omit<UsageLedgerRow, "id" | "createdAt">,
): void {
  db.prepare(
    `INSERT INTO llm_usage
       (id, provider, model, operation, role, resource_id, input_tokens, output_tokens,
        cache_read_tokens, cost_usd, provenance, duration_ms, created_at)
     VALUES
       (@id, @provider, @model, @operation, @role, @resourceId, @inputTokens, @outputTokens,
        @cacheReadTokens, @costUsd, @provenance, @durationMs, @createdAt)`,
  ).run({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...row,
  });
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
  costUsd: number;
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
         COALESCE(SUM(cost_usd), 0) AS cost_usd,
         COUNT(*) AS call_count
       FROM llm_usage WHERE created_at >= ?`,
    )
    .get(sinceIso) as {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    call_count: number;
  };
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    callCount: row.call_count,
  };
}

export interface UsageBreakdownRow {
  resourceId: string | null;
  resourceTitle: string | null;
  operation: LLMOperation;
  role: ProviderRole | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  provenance: UsageProvenance | "mixed";
  callCount: number;
}

/** Rolls calls up by (book, operation) — the Usage divider's acceptance
 * criterion is "totals ... broken down by book and by operation". Provenance
 * is `mixed` when a group contains both reported and estimated calls, so the
 * UI never labels a blended number as either alone. */
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
         COALESCE(SUM(u.input_tokens), 0) AS input_tokens,
         COALESCE(SUM(u.output_tokens), 0) AS output_tokens,
         SUM(u.cost_usd) AS cost_usd,
         COUNT(*) AS call_count,
         COUNT(DISTINCT u.provenance) AS provenance_count,
         MIN(u.provenance) AS single_provenance
       FROM llm_usage u
       LEFT JOIN resources r ON r.id = u.resource_id
       WHERE u.created_at >= ?
       GROUP BY u.resource_id, u.operation, u.role
       ORDER BY input_tokens DESC`,
    )
    .all(sinceIso) as {
    resource_id: string | null;
    resource_title: string | null;
    operation: LLMOperation;
    role: ProviderRole | null;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number | null;
    call_count: number;
    provenance_count: number;
    single_provenance: UsageProvenance;
  }[];

  return rows.map((row) => ({
    resourceId: row.resource_id,
    resourceTitle: row.resource_title,
    operation: row.operation,
    role: row.role,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
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
  /** M17 "context-window readout": fired synchronously right after the row
   * is written, so a caller (a route) can read back exactly what was logged
   * for *this* call — without a re-query, which would race concurrent
   * requests logging their own rows in between. */
  onLogged?: (row: Omit<UsageLedgerRow, "id" | "createdAt">) => void,
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
    const row: Omit<UsageLedgerRow, "id" | "createdAt"> = reported
      ? {
          provider: provider.id,
          model,
          operation,
          role,
          resourceId,
          inputTokens: reported.inputTokens,
          outputTokens: reported.outputTokens,
          cacheReadTokens: reported.cacheReadTokens ?? null,
          costUsd: reported.costUsd ?? null,
          provenance: "reported",
          durationMs,
        }
      : {
          provider: provider.id,
          model,
          operation,
          role,
          resourceId,
          inputTokens: estimateTokens(inputChars),
          outputTokens: estimateTokens(outputChars),
          cacheReadTokens: null,
          costUsd: null,
          provenance: "estimated",
          durationMs,
        };
    recordUsage(db, row);
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
    planLimits: provider.planLimits?.bind(provider),
  };
}
