import { useEffect, useMemo, useState } from "react";
import type { UsageBreakdownRow, UsageCostBasis, UsagePeriod, UsageProvenanceValue, UsageSummary } from "@marginalia/shared";
import styles from "./UsageDivider.module.css";

async function fetchUsageSummary(): Promise<UsageSummary | null> {
  try {
    const res = await fetch("/api/usage/summary");
    if (!res.ok) return null;
    return (await res.json()) as UsageSummary;
  } catch {
    return null;
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(costUsd: number | null): string {
  if (costUsd === null) return "—";
  return `$${costUsd.toFixed(2)}`;
}

const PROVENANCE_LABEL: Record<UsageProvenanceValue, string> = {
  reported: "reported",
  measured: "measured",
  estimated: "estimated",
  mixed: "mixed — reported + estimated",
};

/** Every figure carries its provenance (decisions.md 2026-07-28 later: "an
 * estimate is never dressed up as a measurement") — this badge is the one
 * place that label renders, so every number in the divider looks the same. */
function ProvenanceBadge({ provenance }: { provenance: UsageProvenanceValue }) {
  return (
    <span className={`${styles.badge} ${provenance === "reported" ? styles.badgeReported : styles.badgeEstimated}`}>
      {PROVENANCE_LABEL[provenance]}
    </span>
  );
}

/** M22.5 H4: "the one cost the ledger reports is the one you are not billed
 * for" — this badge is the one place a dollar figure says what kind of
 * number it is, so `$0.42` never reads the same whether it's real spend or
 * a subscription's own notional estimate. */
const COST_BASIS_LABEL: Record<UsageCostBasis, string> = {
  billed: "billed",
  notional: "notional — not billed",
  none: "local — free",
  unpriced: "unpriced",
  mixed: "mixed basis",
};

function CostBasisBadge({ basis }: { basis: UsageCostBasis }) {
  return (
    <span className={`${styles.badge} ${basis === "billed" ? styles.badgeReported : styles.badgeEstimated}`}>
      {COST_BASIS_LABEL[basis]}
    </span>
  );
}

function PeriodSummary({ title, period }: { title: string; period: UsagePeriod }) {
  return (
    <div className={styles.periodCard}>
      <div className={styles.periodHeader}>
        <h4 className={styles.periodTitle}>{title}</h4>
        <ProvenanceBadge provenance={period.provenance} />
      </div>
      <div className={styles.periodStats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatTokens(period.inputTokens)}</span>
          <span className={styles.statLabel}>input tokens</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatTokens(period.outputTokens)}</span>
          <span className={styles.statLabel}>output tokens</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatCost(period.billedCostUsd)}</span>
          <span className={styles.statLabel}>billed</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{period.callCount}</span>
          <span className={styles.statLabel}>calls</span>
        </div>
      </div>
      {period.notionalCostUsd > 0 && (
        <p className={styles.notionalNote}>
          + {formatCost(period.notionalCostUsd)} notional (what a subscription's usage would have cost on the
          API — not spend)
        </p>
      )}

      {period.byBookAndOperation.length === 0 ? (
        <p className={styles.emptyRow}>Nothing logged yet.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Book</th>
              <th>Operation</th>
              <th>Tokens</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {period.byBookAndOperation.map((row, i) => (
              <tr key={`${row.resourceId ?? "none"}-${row.operation}-${row.role ?? "none"}-${row.model ?? "none"}-${i}`}>
                <td>{row.resourceTitle ?? "(desk)"}</td>
                <td>{row.operation}</td>
                <td>
                  {formatTokens(row.inputTokens + row.outputTokens)}{" "}
                  <ProvenanceBadge provenance={row.provenance} />
                </td>
                <td>
                  {formatCost(row.costUsd)} <CostBasisBadge basis={row.costBasis} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface ProviderModelGroup {
  key: string;
  provider: string | null;
  model: string | null;
  isLocal: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  costUsd: number;
  costBasis: UsageCostBasis;
  callCount: number;
}

/** M22.5 H5: re-rolls the same rows the by-book table already has into
 * groups by (provider, model) — a widening of the server's query, not a
 * second endpoint (decisions.md 2026-08-04: "nearly all of it is already
 * recorded and thrown away"). */
function groupByProviderModel(rows: UsageBreakdownRow[]): ProviderModelGroup[] {
  const map = new Map<string, ProviderModelGroup>();
  for (const row of rows) {
    const key = `${row.provider ?? "unknown"}::${row.model ?? "unknown"}`;
    const costUsd = row.costUsd ?? 0;
    const existing = map.get(key);
    if (existing) {
      existing.inputTokens += row.inputTokens;
      existing.outputTokens += row.outputTokens;
      existing.cacheReadTokens += row.cacheReadTokens;
      existing.cacheCreationTokens += row.cacheCreationTokens;
      existing.durationMs += row.durationMs;
      existing.costUsd += costUsd;
      existing.callCount += row.callCount;
      if (existing.costBasis !== row.costBasis) existing.costBasis = "mixed";
    } else {
      map.set(key, {
        key,
        provider: row.provider,
        model: row.model,
        // Matches the definition `RolePlanLimits.isLocal` already uses for
        // "Plan utilization" below — openai-compatible covers both a local
        // Ollama and a hosted OpenRouter (decisions.md's own named gap),
        // so this reads as "the tok/s branch applies", not a verified fact.
        isLocal: row.provider === "openai-compatible",
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheCreationTokens: row.cacheCreationTokens,
        durationMs: row.durationMs,
        costUsd,
        costBasis: row.costBasis,
        callCount: row.callCount,
      });
    }
  }
  return [...map.values()];
}

type SortMode = "tokens" | "name";

function sortGroups(groups: ProviderModelGroup[], mode: SortMode): ProviderModelGroup[] {
  const sorted = [...groups];
  if (mode === "name") {
    sorted.sort((a, b) => `${a.provider}${a.model}`.localeCompare(`${b.provider}${b.model}`));
  } else {
    sorted.sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  }
  return sorted;
}

function ProviderModelBreakdown({ period }: { period: UsagePeriod }) {
  const [sortMode, setSortMode] = useState<SortMode>("tokens");
  const groups = useMemo(
    () => sortGroups(groupByProviderModel(period.byBookAndOperation), sortMode),
    [period, sortMode],
  );

  if (groups.length === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.periodHeader}>
        <h4 className={styles.sectionTitle}>Last 7 days, by provider &amp; model</h4>
        <button
          type="button"
          className={styles.sortToggle}
          onClick={() => setSortMode((m) => (m === "tokens" ? "name" : "tokens"))}
        >
          sort: {sortMode === "tokens" ? "tokens" : "name"}
        </button>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Cache read</th>
            <th>Cache write</th>
            <th>Speed / cost</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <td>{g.provider ?? "unknown profile"}</td>
              <td>{g.model ?? "—"}</td>
              <td>{formatTokens(g.inputTokens + g.outputTokens)}</td>
              <td>{g.cacheReadTokens > 0 ? formatTokens(g.cacheReadTokens) : "—"}</td>
              <td>{g.cacheCreationTokens > 0 ? formatTokens(g.cacheCreationTokens) : "—"}</td>
              <td>
                {g.isLocal ? (
                  g.durationMs > 0 ? (
                    `${(g.outputTokens / (g.durationMs / 1000)).toFixed(0)} tok/s`
                  ) : (
                    "—"
                  )
                ) : (
                  <>
                    {formatCost(g.costUsd)} <CostBasisBadge basis={g.costBasis} />
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsageDivider() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsageSummary().then((s) => {
      setSummary(s);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return <p className={styles.hint}>Loading usage…</p>;
  }
  if (!summary) {
    return <p className={styles.hint}>Couldn't load usage.</p>;
  }

  return (
    <div className={styles.page}>
      <p className={styles.hint}>
        What your reading has cost, broken down by book and by operation. Every figure says
        whether it's reported by the provider or estimated locally — and every dollar figure says
        whether it's real spend, a subscription's notional estimate, or genuinely free.
      </p>

      <PeriodSummary title="Today" period={summary.today} />
      <PeriodSummary title="Last 7 days" period={summary.last7Days} />
      <ProviderModelBreakdown period={summary.last7Days} />

      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Last digest run</h4>
        {summary.lastDigest ? (
          <p className={styles.lastDigest}>
            <strong>{summary.lastDigest.resourceTitle ?? "Untitled"}</strong> —{" "}
            {formatCost(summary.lastDigest.costUsd)}{" "}
            <ProvenanceBadge provenance={summary.lastDigest.provenance} />
          </p>
        ) : (
          <p className={styles.emptyRow}>No digest has run yet.</p>
        )}
      </div>

      <div className={styles.section}>
        <h4 className={styles.sectionTitle}>Plan utilization</h4>
        {summary.planLimits.map((role) => (
          <div key={role.role} className={styles.planRow}>
            <span className={styles.planRoleLabel}>
              {role.role === "query" ? "Query" : "Digest"}
              {role.profileName ? ` — ${role.profileName}` : ""}
            </span>
            {!role.profileName ? (
              <span className={styles.planUnavailable}>not configured</span>
            ) : role.isLocal ? (
              <span className={styles.planLocal}>
                {role.contextTokens ? `${formatTokens(role.contextTokens)} token context` : "local model"}
                {role.lastCall ? (
                  <>
                    {" · "}
                    {formatTokens(role.lastCall.tokensUsed)} tokens used
                    {role.lastCall.contextPercent !== null
                      ? ` (${Math.round(role.lastCall.contextPercent)}%)`
                      : ""}
                    {role.lastCall.tokensPerSecond !== null
                      ? ` · ${role.lastCall.tokensPerSecond.toFixed(0)} tok/s`
                      : ""}
                  </>
                ) : (
                  " · no calls yet"
                )}
              </span>
            ) : role.windows && role.windows.length > 0 ? (
              <span className={styles.planWindows}>
                {role.windows.map((w) => (
                  <span key={w.label} className={styles.planWindow}>
                    {w.label}: {w.utilization !== null ? `${Math.round(w.utilization * 100)}%` : "—"}
                    {w.resetsAt ? ` (resets ${new Date(w.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : ""}
                  </span>
                ))}
              </span>
            ) : (
              <span className={styles.planUnavailable}>plan limits unavailable</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
