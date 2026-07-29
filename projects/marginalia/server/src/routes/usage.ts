import { Router } from "express";
import type { RolePlanLimits, UsagePeriod } from "@marginalia/shared";
import { getDb } from "../db.js";
import {
  getLastDigestUsage,
  getLastUsageForRole,
  getUsageBreakdownSince,
  getUsageTotalsSince,
} from "../llm/usage.js";
import { getProviderRoles } from "../settings/providers.js";
import { AnthropicProvider } from "../llm/anthropic.js";
import { ClaudeAgentProvider } from "../llm/claudeAgent.js";
import { OpenAICompatProvider } from "../llm/openaiCompat.js";
import { getRawSettings } from "../settings/store.js";

export const usageRouter: Router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

function period(db: ReturnType<typeof getDb>, sinceIso: string): UsagePeriod {
  const totals = getUsageTotalsSince(db, sinceIso);
  const breakdown = getUsageBreakdownSince(db, sinceIso);
  const provenances = new Set(breakdown.map((r) => r.provenance));
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    costUsd: totals.callCount > 0 ? totals.costUsd : null,
    callCount: totals.callCount,
    provenance: provenances.size > 1 ? "mixed" : ([...provenances][0] ?? "estimated"),
    byBookAndOperation: breakdown,
  };
}

usageRouter.get("/summary", async (_req, res) => {
  const db = getDb();
  const now = Date.now();
  const todayStart = new Date(now - (now % DAY_MS)).toISOString();
  const sevenDaysAgo = new Date(now - 7 * DAY_MS).toISOString();
  const { maxResponseTokens } = getRawSettings(db);

  const lastDigestRow = getLastDigestUsage(db);

  const roles = getProviderRoles(db);
  const planLimits: RolePlanLimits[] = await Promise.all(
    roles.map(async (assignment): Promise<RolePlanLimits> => {
      if (!assignment.profile || !assignment.configured) {
        return {
          role: assignment.role,
          profileName: assignment.profile?.name ?? null,
          provider: assignment.profile?.provider ?? null,
          windows: null,
          isLocal: false,
          contextTokens: null,
          lastCall: null,
        };
      }
      const profile = assignment.profile;
      const isLocal = profile.provider === "openai-compatible";

      // planLimits() is only ever implemented on the claude-agent path
      // (SPEC: "an API the SDK itself marks experimental") — every other
      // provider simply has no windows to report, which the UI renders as
      // "plan limits unavailable", never an error.
      let windows: RolePlanLimits["windows"] = null;
      let contextTokens: number | null = null;
      try {
        if (profile.provider === "claude-agent") {
          const provider = new ClaudeAgentProvider(profile.claudeAgentModel, maxResponseTokens);
          contextTokens = provider.capabilities().contextTokens;
          const limits = provider.planLimits ? await provider.planLimits() : null;
          windows = limits?.windows ?? null;
        } else if (profile.provider === "anthropic") {
          const provider = new AnthropicProvider(
            profile.anthropicApiKey,
            profile.anthropicModel,
            maxResponseTokens,
          );
          contextTokens = provider.capabilities().contextTokens;
        } else if (profile.provider === "openai-compatible") {
          const provider = new OpenAICompatProvider({
            baseUrl: profile.openaiBaseUrl,
            model: profile.openaiModel,
            apiKey: profile.openaiApiKey,
            contextTokens: profile.openaiContextTokens,
            maxResponseTokens,
          });
          contextTokens = provider.capabilities().contextTokens;
        }
      } catch {
        windows = null;
      }

      const lastUsage = getLastUsageForRole(db, assignment.role);
      const lastCall = lastUsage
        ? {
            tokensUsed: lastUsage.inputTokens,
            contextPercent: contextTokens ? (lastUsage.inputTokens / contextTokens) * 100 : null,
            tokensPerSecond:
              lastUsage.durationMs > 0 ? lastUsage.outputTokens / (lastUsage.durationMs / 1000) : null,
            provenance: lastUsage.provenance,
          }
        : null;

      return {
        role: assignment.role,
        profileName: profile.name,
        provider: profile.provider,
        windows,
        isLocal,
        contextTokens,
        lastCall,
      };
    }),
  );

  res.json({
    today: period(db, todayStart),
    last7Days: period(db, sevenDaysAgo),
    lastDigest: lastDigestRow,
    planLimits,
  });
});
