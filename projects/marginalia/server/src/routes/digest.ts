import { Router } from "express";
import {
  CreateChapterAnchorBodySchema,
  DigestStatusSchema,
  StartDigestBodySchema,
  StartThematicDigestBodySchema,
  ThematicStatusSchema,
  UNRESOLVABLE_CHAPTER_ANCHOR_CFI,
  UpdateBriefBodySchema,
  UpdateContextLadderBodySchema,
  UpdateChapterQuestionNoteBodySchema,
  UpdateLookaheadBodySchema,
  UpdateShowThematicQuotesBodySchema,
  UpsertChapterQuestionBodySchema,
  type DigestStatus,
  type ThematicStatus,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import { getReadingPosition, getResourceById, getResourceTextSections } from "../library/store.js";
import { getProvider, LLMError } from "../llm/provider.js";
import { sectionLabel, sectionRangeUiLabel } from "../llm/context.js";
import { getRawSettings } from "../settings/store.js";
import { estimateDigestRun, refreshBookDigestSnapshotInBackground, runDigest } from "../digest/build.js";
import { runThematicDigest } from "../digest/thematicBuild.js";
import { runThemeTagging } from "../digest/themeTagging.js";
import { runThemeDistillation } from "../digest/themeDistillation.js";
import { listBookThemes } from "../digest/canonicalThemes.js";
import { chapterStartAnchor, locateQuoteAnchor } from "../digest/chapterAnchor.js";
import { writeDigestMarkdown, renderDigestMarkdown } from "../digest/markdown.js";
import {
  getBookDigest,
  getBookDigestSnapshot,
  getDigestRun,
  listChapterDigests,
} from "../digest/store.js";
import {
  getBrief,
  getThematicRun,
  hashBrief,
  isThematicStale,
  listThematicDigests,
  putBrief,
} from "../digest/thematicStore.js";
import {
  getStoredContextLadderDepth,
  resolveContextLadderDepth,
  setContextLadderDepth,
} from "../digest/ladder.js";
import { getLookahead, setLookahead } from "../digest/lookahead.js";
import { getShowThematicQuotes, setShowThematicQuotes } from "../digest/thematicQuoteVisibility.js";
import { isChapterVisible } from "../digest/visibility.js";
import { createHighlight, findHighlightByExact, type AnchorSource } from "../annotations/highlights.js";
import {
  getChapterQuestion,
  listChapterQuestions,
  seedChapterQuestionIfAbsent,
  setChapterQuestionNote,
  upsertChapterQuestion,
} from "../digest/chapterQuestions.js";
import { startJob } from "../jobs/registry.js";

export const digestRouter: Router = Router();

/** `?reveal=0,3,5` — spine indices the reader has explicitly revealed this
 * session (client-tracked; never persisted server-side — "revealing is
 * per-item and does not unlock the rest", decisions.md 2026-07-29 later). */
function parseRevealedIndices(raw: unknown): Set<number> {
  if (typeof raw !== "string" || raw.length === 0) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
}

function buildDigestStatus(
  db: ReturnType<typeof getDb>,
  resourceId: string,
  revealedSpineIndices: Set<number>,
  revealBook: boolean,
): DigestStatus {
  const resource = getResourceById(db, resourceId);
  if (!resource) throw new Error("resource not found");

  const sections = getResourceTextSections(db, resourceId).sort(
    (a, b) => a.spineIndex - b.spineIndex,
  );
  const chapterDigests = listChapterDigests(db, resourceId);
  const byIndex = new Map(chapterDigests.map((c) => [c.spineIndex, c]));
  const fullBook = getBookDigest(db, resourceId);
  const snapshot = getBookDigestSnapshot(db, resourceId);
  const run = getDigestRun(db, resourceId);
  const totalLength = sections.reduce((sum, s) => sum + s.text.length, 0);
  // M18 "chapter labels are spoilers too" (decisions.md 2026-07-29 later):
  // gate by the reader's furthest saved position, same signal M17's
  // answer-time spoiler guard uses. No bookmark at all (never opened this
  // book) is treated as "nothing revealed yet" — the conservative default —
  // rather than showing every title up front.
  const bookmarkSpineIndex = getReadingPosition(db, resourceId)?.spineIndex ?? -1;
  // M34 §B5/§B1: the per-book lookahead toggle bypasses the mask everywhere,
  // routed through the same helper every other reader-facing consumer uses.
  const noMask = getLookahead(db, resourceId);

  let cursor = 0;
  const chapters = sections.map((s, index) => {
    const digest = byIndex.get(s.spineIndex);
    const startPercent = totalLength > 0 ? cursor / totalLength : 0;
    const lengthPercent = totalLength > 0 ? s.text.length / totalLength : 0;
    cursor += s.text.length;
    const pastBookmark = s.spineIndex > bookmarkSpineIndex;
    // M19.5 "chapter entries gate exactly": summary/themes/characters/title
    // are only ever included when not past the bookmark, or explicitly
    // revealed — redacted server-side, never just hidden client-side.
    const revealed = isChapterVisible(s.spineIndex, { bookmarkSpineIndex, revealedSpineIndices, noMask });
    const showContent = Boolean(digest) && revealed;
    return {
      spineIndex: s.spineIndex,
      label: sectionLabel(s.spineIndex, resource.metadata.chapterTitles),
      chapterNumber: index + 1,
      startPercent,
      lengthPercent,
      digested: Boolean(digest),
      summary: showContent ? (digest?.summary ?? null) : null,
      themes: showContent ? (digest?.themes ?? []) : [],
      characters: showContent ? (digest?.characters ?? []) : [],
      generatedAt: digest?.generatedAt ?? null,
      title: showContent ? (digest?.title ?? null) : null,
      // Not spoiler-gated, unlike `title` above — the EPUB's own NCX title
      // (same source `ScanChapter` already surfaces via the Scan's chapter
      // dial, digested or not), so a chapter without a digest yet still
      // shows a real name instead of a bare positional fallback.
      tocTitle: resource.metadata.chapterTitles?.[String(s.spineIndex)] ?? null,
      pastBookmark,
      revealed,
    };
  });

  const chaptersPastBookmarkDigested = chapterDigests.some((c) => c.spineIndex > bookmarkSpineIndex);

  return {
    totalChapters: sections.length,
    chapters,
    book:
      fullBook || snapshot
        ? {
            safe: snapshot
              ? {
                  synopsis: snapshot.synopsis,
                  cast: snapshot.cast,
                  narratorGender: snapshot.narratorGender,
                  themes: snapshot.themes,
                  generatedAt: snapshot.generatedAt,
                }
              : null,
            // M34 §B5: lookahead on reveals the full book-level digest the
            // same way an explicit `revealBook` click already does — the
            // toggle is "no mask at any rung", not "no mask except this one".
            full:
              (revealBook || noMask) && fullBook
                ? {
                    synopsis: fullBook.synopsis,
                    cast: fullBook.cast,
                    narratorGender: fullBook.narratorGender,
                    themes: fullBook.themes,
                    generatedAt: fullBook.generatedAt,
                  }
                : null,
            hasMoreToReveal: chaptersPastBookmarkDigested && !noMask,
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
  const bookmarkSpineIndex = getReadingPosition(db, resource.id)?.spineIndex ?? -1;
  // M29 (decisions.md 2026-08-22): fire-and-forget, not awaited — see
  // refreshBookDigestSnapshotInBackground's own comment for why this used to
  // block (and sometimes fail) the whole digest-open response. The response
  // below always carries whatever snapshot already exists; a fresher one
  // lands on a later open/poll once the background refresh completes.
  const provider = getProvider(db, "digest", "digest", resource.id);
  refreshBookDigestSnapshotInBackground(db, provider, resource, bookmarkSpineIndex);

  const revealed = parseRevealedIndices(req.query.reveal);
  const revealBook = req.query.revealBook === "1" || req.query.revealBook === "true";
  res.json(DigestStatusSchema.parse(buildDigestStatus(db, resource.id, revealed, revealBook)));
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

  const provider = getProvider(db, "digest", "digest", resource.id);
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

  const provider = getProvider(db, "digest", "digest", resource.id);
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

  // M20.6 "the job registry": this used to await the whole run before
  // responding — one blocking request with no id, no progress and no real
  // cancellation. It now starts a job and returns immediately; the tasks
  // tray watches it via GET /api/jobs/:id/events and the client re-fetches
  // this same GET /:id/digest for the actual content once the job completes.
  const job = startJob(
    "digest",
    resource.id,
    resource.title,
    async (signal, reportProgress) => {
      try {
        await runDigest(db, provider, resource, sections, spineStart, spineEnd, signal, (current, total, message) =>
          reportProgress({ current, total, message }),
        );
        writeDigestMarkdown(db, resource);
      } catch (err) {
        if (err instanceof LLMError) {
          // eslint-disable-next-line no-console
          console.error(`[digest] ${err.code}: ${err.message}`);
        } else {
          // eslint-disable-next-line no-console
          console.error("[digest]", err);
        }
        throw err;
      }
    },
    sectionRangeUiLabel(sections, spineStart, spineEnd, resource.metadata.chapterTitles),
  );
  res.status(202).json({ jobId: job.id });
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

// M34 §B5/§B6: the lookahead/spoilers toggle — independent of the depth
// above (settled decision 8's amendment: "two questions", not folded into
// ContextLadderDepth).
digestRouter.get("/:id/lookahead", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  res.json({ enabled: getLookahead(db, resource.id) });
});

digestRouter.put("/:id/lookahead", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const parsed = UpdateLookaheadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setLookahead(db, resource.id, parsed.data.enabled);
  res.json({ enabled: parsed.data.enabled });
});

// M35 §C7: the thematic-quotes show/hide toggle — same GET/PUT shape as
// lookahead above, independent of it and of everything else on this table.
digestRouter.get("/:id/show-thematic-quotes", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  res.json({ enabled: getShowThematicQuotes(db, resource.id) });
});

digestRouter.put("/:id/show-thematic-quotes", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const parsed = UpdateShowThematicQuotesBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  setShowThematicQuotes(db, resource.id, parsed.data.enabled);
  res.json({ enabled: parsed.data.enabled });
});

// ---------------------------------------------------------------------------
// M19.5 — reader briefs & the thematic layer
// ---------------------------------------------------------------------------

digestRouter.get("/:id/brief", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const brief = getBrief(db, resource.id);
  res.json({ text: brief.text, updatedAt: brief.updatedAt });
});

digestRouter.put("/:id/brief", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const parsed = UpdateBriefBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const brief = putBrief(db, resource.id, parsed.data.text);
  res.json({ text: brief.text, updatedAt: brief.updatedAt });
});

function buildThematicStatus(
  db: ReturnType<typeof getDb>,
  resourceId: string,
  revealedSpineIndices: Set<number>,
): ThematicStatus {
  const brief = getBrief(db, resourceId);
  const currentBriefHash = hashBrief(brief.text);
  const thematic = listThematicDigests(db, resourceId);
  const byIndex = new Map(thematic.map((t) => [t.spineIndex, t]));
  const sections = getResourceTextSections(db, resourceId).sort((a, b) => a.spineIndex - b.spineIndex);
  const run = getThematicRun(db, resourceId);
  // Same spoiler signal as the plot layer's buildDigestStatus — a thematic
  // reading and the questions it poses are just as spoiler-bearing.
  const bookmarkSpineIndex = getReadingPosition(db, resourceId)?.spineIndex ?? -1;
  const noMask = getLookahead(db, resourceId);

  const chapters = sections.map((s) => {
    const t = byIndex.get(s.spineIndex);
    const pastBookmark = s.spineIndex > bookmarkSpineIndex;
    const revealed = isChapterVisible(s.spineIndex, { bookmarkSpineIndex, revealedSpineIndices, noMask });
    const showContent = Boolean(t) && revealed;
    // M35 §F2: normalize each theme's quotes to the *located* exact substring
    // of this chapter's own text before they ever reach the client — the
    // same reasoning as §E6's `startQuote` (decisions.md 2026-09-01 later):
    // the stored quote is the model's raw text, which can differ from the
    // book's own typography (curly quotes, an em dash) in exactly the cases
    // `locateQuoteAnchor`'s tiered fold already forgives. A quote reaching
    // here already passed §C3's evidence filter, so this always locates —
    // the `?? quote` fallback exists only so a schema change here can never
    // crash the route, not because it's expected to trigger.
    const themes = showContent
      ? (t?.themes ?? []).map((theme) => ({
          ...theme,
          quotes: theme.quotes.map((quote) => locateQuoteAnchor(s.text, quote)?.exact ?? quote),
        }))
      : [];
    return {
      spineIndex: s.spineIndex,
      analyzed: Boolean(t),
      analysis: showContent ? (t?.analysis ?? null) : null,
      themes,
      questions: showContent ? (t?.questions ?? []) : [],
      briefText: showContent ? (t?.briefText ?? null) : null,
      stale: t ? isThematicStale(t, currentBriefHash) : false,
      generatedAt: t?.generatedAt ?? null,
      pastBookmark,
      revealed,
    };
  });

  return {
    brief: { text: brief.text, updatedAt: brief.updatedAt },
    chapters,
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

digestRouter.get("/:id/thematic", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const revealed = parseRevealedIndices(req.query.reveal);
  res.json(ThematicStatusSchema.parse(buildThematicStatus(db, resource.id, revealed)));
});

digestRouter.post("/:id/thematic", async (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const parsed = StartThematicDigestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { spineStart, spineEnd } = parsed.data;
  if (spineStart > spineEnd) {
    res.status(400).json({ error: "invalid_range" });
    return;
  }

  const provider = getProvider(db, "digest", "thematic", resource.id);
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const sections = getResourceTextSections(db, resource.id);
  const job = startJob(
    "thematic",
    resource.id,
    resource.title,
    async (signal, reportProgress) => {
      try {
        await runThematicDigest(db, provider, resource, sections, spineStart, spineEnd, signal, (current, total, message) =>
          reportProgress({ current, total, message }),
        );
      } catch (err) {
        if (err instanceof LLMError) {
          // eslint-disable-next-line no-console
          console.error(`[thematic] ${err.code}: ${err.message}`);
        } else {
          // eslint-disable-next-line no-console
          console.error("[thematic]", err);
        }
        throw err;
      }
    },
    sectionRangeUiLabel(sections, spineStart, spineEnd, resource.metadata.chapterTitles),
  );
  res.status(202).json({ jobId: job.id });
});

/**
 * Turns a posed question's verbatim quote into a real, clickable highlight
 * (decision 11: the model returns text, code locates it) — the seam that
 * lets "click a question, open a thread" reuse the existing highlight/
 * thread machinery instead of inventing a parallel one. Re-clicking the
 * same question reuses its highlight (dedup by exact text) rather than
 * spawning a duplicate thread.
 *
 * M35 §B2: an unlocatable *posed* quote no longer falls back to a highlight
 * pinned to the chapter's first 120 characters — "a wrong anchor is worse
 * than no anchor." It becomes a chapter-level question instead (M32 B's
 * `chapter_questions`), which already has exactly this shape: "a question
 * about the chapter as a whole, with nothing to anchor to."
 * `seedChapterQuestionIfAbsent` never overwrites a question the reader
 * already wrote for that chapter — a posed question that can't be pinned to
 * a passage still shouldn't clobber the reader's own.
 *
 * ⚠️ This is scoped to a *real* quote that failed to locate — an **empty**
 * quote (the Scan's book-band click-through, ScanPage.tsx's
 * `handleOpenChapter`) never had a passage to anchor to in the first place,
 * so it keeps going straight to `chapterStartAnchor` exactly as before.
 * Conflating the two would break "click a band, land at the chapter start."
 */
digestRouter.post("/:id/chapter-anchor", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const parsed = CreateChapterAnchorBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { spineIndex, quote, text } = parsed.data;
  const section = getResourceTextSections(db, resource.id).find((s) => s.spineIndex === spineIndex);
  if (!section) {
    res.status(404).json({ error: "chapter_not_found" });
    return;
  }

  const hasQuote = quote.trim().length > 0;
  const located = hasQuote ? locateQuoteAnchor(section.text, quote) : null;

  // M35 §B2: a real quote that didn't locate becomes a chapter question,
  // not a highlight.
  if (hasQuote && !located) {
    const chapterQuestion = seedChapterQuestionIfAbsent(db, resource.id, spineIndex, text);
    res.status(200).json({ highlight: null, chapterQuestion });
    return;
  }

  // M34 §0a: which anchor a highlight got — 'quote' when a real quote
  // located, 'chapter_start' for the Scan's empty-quote case (never a posed
  // question anymore, now that §B2 routes those misses to a chapter
  // question instead).
  const anchor = located ?? chapterStartAnchor(section.text);
  const anchorSource: AnchorSource = located ? "quote" : "chapter_start";
  const existing = findHighlightByExact(db, resource.id, spineIndex, anchor.exact);
  if (existing) {
    res.json({ highlight: existing, chapterQuestion: null });
    return;
  }

  const highlight = createHighlight(db, {
    resourceId: resource.id,
    exact: anchor.exact,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
    // Deliberately unresolvable — this anchor was never rendered from a
    // live epub.js selection, so there's no real CFI to give it. The
    // reader's existing anchor-resolution fallback (SPEC: CFI fails ->
    // search prefix+exact+suffix) is what actually locates it on render;
    // see web/src/reader/anchorResolution.ts.
    cfi: UNRESOLVABLE_CHAPTER_ANCHOR_CFI,
    spineIndex,
    kind: "slate", // "a question about the text" — the existing kind Ask defaults to
    anchorSource,
    offset: anchor.offset,
    length: anchor.length,
  });
  res.status(201).json({ highlight, chapterQuestion: null });
});

// ---------------------------------------------------------------------------
// M32 B — a chapter-level question of your own (no passage to anchor to)
// ---------------------------------------------------------------------------

digestRouter.get("/:id/chapter-questions", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  res.json({ questions: listChapterQuestions(db, resource.id) });
});

digestRouter.put("/:id/chapter-questions/:spineIndex", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const spineIndex = Number(req.params.spineIndex);
  if (!Number.isInteger(spineIndex) || spineIndex < 0) {
    res.status(400).json({ error: "invalid_spine_index" });
    return;
  }
  const parsed = UpsertChapterQuestionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  res.json(upsertChapterQuestion(db, resource.id, spineIndex, parsed.data.question));
});

digestRouter.put("/:id/chapter-questions/:spineIndex/note", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  const spineIndex = Number(req.params.spineIndex);
  if (!Number.isInteger(spineIndex) || spineIndex < 0) {
    res.status(400).json({ error: "invalid_spine_index" });
    return;
  }
  const parsed = UpdateChapterQuestionNoteBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  if (!getChapterQuestion(db, resource.id, spineIndex)) {
    res.status(404).json({ error: "chapter_question_not_found" });
    return;
  }
  setChapterQuestionNote(db, resource.id, spineIndex, parsed.data.note);
  res.json(getChapterQuestion(db, resource.id, spineIndex));
});

/**
 * Tags every not-yet-tagged highlight in this resource against the book's
 * theme vocabulary — the Mine layer's theme signal for the scan (decisions.md
 * 2026-07-29 later). A no-op (200, `{tagged: 0}`) if the book has no
 * thematic layer yet rather than an error — there's simply nothing to tag
 * against.
 */
digestRouter.post("/:id/theme-tagging", async (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }

  const provider = getProvider(db, "digest", "extract", resource.id);
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const job = startJob("theme-tagging", resource.id, resource.title, async (signal, reportProgress) => {
    try {
      await runThemeTagging(db, provider, resource.id, signal, (current, total, message) =>
        reportProgress({ current, total, message }),
      );
    } catch (err) {
      if (err instanceof LLMError) {
        // eslint-disable-next-line no-console
        console.error(`[theme-tagging] ${err.code}: ${err.message}`);
      } else {
        // eslint-disable-next-line no-console
        console.error("[theme-tagging]", err);
      }
      throw err;
    }
  });
  res.status(202).json({ jobId: job.id });
});

/**
 * M24.5 "themes worth colouring": this book's currently-distilled book-level
 * themes, each with the chapter-level themes underneath it — what the
 * Scan's colour-keyed filter renders (`ScanBookLayer.bookThemes`, computed
 * the same way via `annotations/scan.ts`). A thin read here too so the
 * digest page can show the result of a distillation run without pulling in
 * the whole scan payload.
 */
digestRouter.get("/:id/theme-distillation", (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }
  res.json({ bookThemes: listBookThemes(db, resource.id) });
});

/**
 * Distils this book's per-chapter theme vocabulary into ~6-8 book-level
 * themes (TASKS.md M24.5 §1) and resolves each against the library-wide
 * canonical vocabulary (§3). A no-op (200, `{bookThemes: []}`) if no chapter
 * has a thematic layer yet, same "nothing to do, not an error" shape as
 * theme-tagging above.
 */
digestRouter.post("/:id/theme-distillation", async (req, res) => {
  const db = getDb();
  const resource = getResourceById(db, req.params.id);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }

  const provider = getProvider(db, "digest", "theme-distillation", resource.id);
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const job = startJob(
    "theme-distillation",
    resource.id,
    resource.title,
    async (signal) => {
      try {
        await runThemeDistillation(db, provider, resource, signal);
      } catch (err) {
        if (err instanceof LLMError) {
          // eslint-disable-next-line no-console
          console.error(`[theme-distillation] ${err.code}: ${err.message}`);
        } else {
          // eslint-disable-next-line no-console
          console.error("[theme-distillation]", err);
        }
        throw err;
      }
    },
  );
  res.status(202).json({ jobId: job.id });
});
