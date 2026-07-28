import { Router } from "express";
import {
  DigestStatusSchema,
  StartDigestBodySchema,
  UpdateContextLadderBodySchema,
  type DigestStatus,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import { getReadingPosition, getResourceById, getResourceTextSections } from "../library/store.js";
import { getProvider, LLMError, type LLMErrorCode } from "../llm/provider.js";
import { sectionLabel } from "../llm/context.js";
import { getRawSettings } from "../settings/store.js";
import { estimateDigestRun, runDigest } from "../digest/build.js";
import { writeDigestMarkdown, renderDigestMarkdown } from "../digest/markdown.js";
import {
  getBookDigest,
  getDigestRun,
  listChapterDigests,
} from "../digest/store.js";
import {
  getStoredContextLadderDepth,
  resolveContextLadderDepth,
  setContextLadderDepth,
} from "../digest/ladder.js";

export const digestRouter: Router = Router();

const ERROR_STATUS: Record<LLMErrorCode, number> = {
  auth: 401,
  rate_limit: 429,
  context_too_large: 413,
  extract_parse_failed: 502,
  network: 502,
  refused: 502,
  unknown: 502,
};

function buildDigestStatus(db: ReturnType<typeof getDb>, resourceId: string): DigestStatus {
  const resource = getResourceById(db, resourceId);
  if (!resource) throw new Error("resource not found");

  const sections = getResourceTextSections(db, resourceId).sort(
    (a, b) => a.spineIndex - b.spineIndex,
  );
  const chapterDigests = listChapterDigests(db, resourceId);
  const byIndex = new Map(chapterDigests.map((c) => [c.spineIndex, c]));
  const book = getBookDigest(db, resourceId);
  const run = getDigestRun(db, resourceId);
  const totalLength = sections.reduce((sum, s) => sum + s.text.length, 0);
  // M18 "chapter labels are spoilers too" (decisions.md 2026-07-29 later):
  // gate by the reader's furthest saved position, same signal M17's
  // answer-time spoiler guard uses. No bookmark at all (never opened this
  // book) is treated as "nothing revealed yet" — the conservative default —
  // rather than showing every title up front.
  const bookmarkSpineIndex = getReadingPosition(db, resourceId)?.spineIndex ?? -1;

  let cursor = 0;
  const chapters = sections.map((s, index) => {
    const digest = byIndex.get(s.spineIndex);
    const startPercent = totalLength > 0 ? cursor / totalLength : 0;
    const lengthPercent = totalLength > 0 ? s.text.length / totalLength : 0;
    cursor += s.text.length;
    const pastBookmark = s.spineIndex > bookmarkSpineIndex;
    return {
      spineIndex: s.spineIndex,
      label: sectionLabel(s.spineIndex, resource.metadata.chapterTitles),
      chapterNumber: index + 1,
      startPercent,
      lengthPercent,
      digested: Boolean(digest),
      summary: digest?.summary ?? null,
      themes: digest?.themes ?? [],
      characters: digest?.characters ?? [],
      generatedAt: digest?.generatedAt ?? null,
      title: pastBookmark ? null : digest?.title ?? null,
    };
  });

  return {
    totalChapters: sections.length,
    chapters,
    book: book
      ? {
          synopsis: book.synopsis,
          cast: book.cast,
          themes: book.themes,
          generatedAt: book.generatedAt,
        }
      : null,
    run: run
      ? {
          spineStart: run.spineStart,
          spineEnd: run.spineEnd,
          status: run.status,
          failedSpineIndices: run.failedSpineIndices,
          resumesAt: run.resumesAt,
          lastError: run.lastError,
          updatedAt: run.updatedAt,
        }
      : null,
  };
}

digestRouter.get("/:id/digest", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  res.json(DigestStatusSchema.parse(buildDigestStatus(db, resource.id)));
});

digestRouter.get("/:id/digest/markdown", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  res.json({ content: renderDigestMarkdown(db, resource) });
});

digestRouter.get("/:id/digest/preflight", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const spineStart = Number(req.query.start ?? 0);
  const spineEnd = Number(req.query.end ?? 0);
  if (!Number.isInteger(spineStart) || !Number.isInteger(spineEnd) || spineStart > spineEnd) {
    res.status(400).json({ error: "invalid_range" });
    return;
  }

  const provider = getProvider(db, "digest");
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }
  const sections = getResourceTextSections(db, resource.id);
  const preflight = estimateDigestRun(sections, spineStart, spineEnd, provider.capabilities().contextTokens);
  const { digestTokenBudget } = getRawSettings(db);
  const tokenBudgetExceeded = digestTokenBudget > 0 && preflight.estimatedInputTokens > digestTokenBudget;

  // Best-effort — planLimits() is opportunistic and provider-specific (only
  // claude-agent implements it); never block the preflight response on it.
  const respond = (planLimits: Awaited<ReturnType<NonNullable<typeof provider.planLimits>>> | null) => {
    res.json({
      ...preflight,
      tokenBudgetExceeded,
      planLimits,
    });
  };
  if (provider.planLimits) {
    provider.planLimits().then(respond).catch(() => respond(null));
  } else {
    respond(null);
  }
});

digestRouter.post("/:id/digest", async (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const parsed = StartDigestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { spineStart, spineEnd } = parsed.data;
  if (spineStart > spineEnd) {
    res.status(400).json({ error: "invalid_range" });
    return;
  }

  const provider = getProvider(db, "digest");
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const sections = getResourceTextSections(db, resource.id);
  const { digestTokenBudget } = getRawSettings(db);
  if (digestTokenBudget > 0) {
    const preflight = estimateDigestRun(sections, spineStart, spineEnd, provider.capabilities().contextTokens);
    if (preflight.estimatedInputTokens > digestTokenBudget) {
      res.status(400).json({ error: "digest_token_budget_exceeded" });
      return;
    }
  }

  try {
    await runDigest(db, provider, resource, sections, spineStart, spineEnd);
    writeDigestMarkdown(db, resource);
    res.json(DigestStatusSchema.parse(buildDigestStatus(db, resource.id)));
  } catch (err) {
    if (err instanceof LLMError) {
      // eslint-disable-next-line no-console
      console.error(`[digest] ${err.code}: ${err.message}`);
      res.status(ERROR_STATUS[err.code]).json({ error: err.code });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[digest]", err);
    res.status(500).json({ error: "digest_failed" });
  }
});

digestRouter.get("/:id/context-ladder", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const hasBookDigest = Boolean(getBookDigest(db, resource.id));
  res.json({
    depth: resolveContextLadderDepth(db, resource.id, hasBookDigest),
    explicit: getStoredContextLadderDepth(db, resource.id) !== null,
  });
});

digestRouter.put("/:id/context-ladder", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const parsed = UpdateContextLadderBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setContextLadderDepth(db, resource.id, parsed.data.depth);
  res.json({ depth: parsed.data.depth });
});
