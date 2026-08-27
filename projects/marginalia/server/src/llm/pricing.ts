import type { UsageCostBasis } from "@marginalia/shared";

/**
 * M22.5 H4: "the one cost the ledger reports is the one you are not billed
 * for." First-party Anthropic API pricing, $ per million tokens (claude-api
 * skill's cached table, 2026-06-24) — covers only the models this app's
 * Settings can be pointed at (see ProviderPicker.tsx's placeholders/defaults),
 * not every model Anthropic has ever shipped. A profile pointed at a model
 * string not in this table prices as `null` (the caller marks the row
 * `unpriced`, never silently `$0`) rather than this table guessing at a
 * number that goes stale the moment pricing changes — deliberately small
 * and hand-reviewed, not fetched live. Cache-read tokens are billed at the
 * documented ~0.1x input rate; cache *write* isn't tracked in
 * `ReportedUsage` today, so it's priced as ordinary input (a known, minor
 * undercount — see NOTES.md).
 */
interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const CACHE_READ_MULTIPLIER = 0.1;

const ANTHROPIC_PRICING: Record<string, ModelPrice> = {
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-1": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-0": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-0": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
};

/** Prices one keyed Anthropic API call, or null if the model isn't in the
 * table — the caller's job to mark that `unpriced`, not `$0`. */
export function priceAnthropicCall(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
): number | null {
  const price = ANTHROPIC_PRICING[model];
  if (!price) return null;
  return (
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (cacheReadTokens / 1_000_000) * price.inputPerMTok * CACHE_READ_MULTIPLIER +
    (outputTokens / 1_000_000) * price.outputPerMTok
  );
}

/**
 * The one place that decides a ledger row's cost basis (decisions.md
 * 2026-08-04: "cost carries a basis"). `claude-agent` reports a real number
 * but it's notional (a subscription, never billed per-token); `anthropic`
 * is genuinely billed and priced from the table above; `openai-compatible`
 * is treated as local/free, matching what the provider itself has always
 * done (never populates `costUsd`).
 */
export function priceCall(
  providerId: "anthropic" | "openai-compatible" | "claude-agent" | "codex-cli",
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  reportedCostUsd: number | null,
): { costUsd: number | null; costBasis: Exclude<UsageCostBasis, "mixed"> } {
  if (providerId === "claude-agent" || providerId === "codex-cli") {
    // codex-cli never reports a dollar figure (verified live, NOTES.md
    // "M26") — reportedCostUsd is always null for it, same as claude-agent
    // on an SDK build that omits total_cost_usd. `notional` still applies:
    // a ChatGPT-subscription call is never billed per-token regardless of
    // whether the CLI can name a number for it.
    return { costUsd: reportedCostUsd, costBasis: "notional" };
  }
  if (providerId === "anthropic") {
    const priced = priceAnthropicCall(model, inputTokens, outputTokens, cacheReadTokens);
    return priced === null ? { costUsd: null, costBasis: "unpriced" } : { costUsd: priced, costBasis: "billed" };
  }
  return { costUsd: null, costBasis: "none" };
}
