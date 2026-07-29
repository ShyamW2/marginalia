import { useEffect, useState } from "react";
import type { UsagePeriod, UsageProvenanceValue, UsageSummary } from "@marginalia/shared";
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
          <span className={styles.statValue}>{formatCost(period.costUsd)}</span>
          <span className={styles.statLabel}>cost</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statValue}>{period.callCount}</span>
          <span className={styles.statLabel}>calls</span>
        </div>
      </div>

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
              <tr key={`${row.resourceId ?? "none"}-${row.operation}-${row.role ?? "none"}-${i}`}>
                <td>{row.resourceTitle ?? "(desk)"}</td>
                <td>{row.operation}</td>
                <td>
                  {formatTokens(row.inputTokens + row.outputTokens)}{" "}
                  <ProvenanceBadge provenance={row.provenance} />
                </td>
                <td>{formatCost(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
        whether it's reported by the provider or estimated locally.
      </p>

      <PeriodSummary title="Today" period={summary.today} />
      <PeriodSummary title="Last 7 days" period={summary.last7Days} />

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
