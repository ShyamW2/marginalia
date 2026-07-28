import type { ContextUsage } from "@marginalia/shared";

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}

/** M17 "context-window readout": e.g. "context 78K / 200K (39%, estimated)"
 * — must always render on a local model exactly as on Claude, and the
 * provenance label is not optional (an estimate must never read like a
 * measurement). */
export function formatContextUsage(usage: ContextUsage): string {
  const percent = Math.round(usage.percent);
  return `context ${formatTokens(usage.tokensUsed)} / ${formatTokens(usage.windowTokens)} (${percent}%, ${usage.provenance})`;
}
