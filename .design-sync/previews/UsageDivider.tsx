import { UsageDivider } from "@marginalia/web";

/*
 * The Usage divider in Settings. It takes no props — it reads
 * `GET /api/usage/summary` itself, stubbed by the preview provider with a
 * UsageSummary-shaped payload (today / last 7 days / last digest / per-role
 * plan limits).
 *
 * The seeded data deliberately covers both branches the divider has to
 * handle: a hosted role with real quota windows, and a local role with no
 * quota API at all — which shows tokens, context percentage and speed
 * instead, never a blank or an error. It also exercises the billed-vs-
 * notional split: a subscription week reads as its billed total rather than
 * a phantom charge.
 */
const frame: React.CSSProperties = {
  maxWidth: 620,
  padding: 16,
  borderRadius: 10,
  background: "var(--color-bg-raised)",
  border: "1px solid var(--color-border)",
};

/** The divider as Settings shows it, against a realistic ledger. */
export function Summary() {
  return (
    <div style={frame}>
      <UsageDivider />
    </div>
  );
}
