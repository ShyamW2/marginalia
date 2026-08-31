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
import { createHighlight, findHighlightByExact, type AnchorSource } from "../annotations/highlights.js";
import {
  getChapterQuestion,
  listChapterQuestions,
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
    const revealed = !pastBookmark || revealedSpineIndices.has(s.spineIndex);
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
            full:
              revealBook && fullBook
                ? {
                    synopsis: fullBook.synopsis,
                    cast: fullBook.cast,
                    narratorGender: fullBook.narratorGender,
                    themes: fullBook.themes,
                    generatedAt: fullBook.generatedAt,
                  }
                : null,
            hasMoreToReveal: chaptersPastBookmarkDigested,
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

  const chapters = sections.map((s) => {
    const t = byIndex.get(s.spineIndex);
    const pastBookmark = s.spineIndex > bookmarkSpineIndex;
    const revealed = !pastBookmark || revealedSpineIndices.has(s.spineIndex);
    const showContent = Boolean(t) && revealed;
    return {
      spineIndex: s.spineIndex,
      analyzed: Boolean(t),
      analysis: showContent ? (t?.analysis ?? null) : null,
      themes: showContent ? (t?.themes ?? []) : [],
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
  const { spineIndex, quote } = parsed.data;
  const section = getResourceTextSections(db, resource.id).find((s) => s.spineIndex === spineIndex);
  if (!section) {
    res.status(404).json({ error: "chapter_not_found" });
    return;
  }

  // M34 §0a: record *which* of these two paths fired. The fallback is
  // invisible after the fact — a chapter-start anchor is a perfectly valid
  // highlight — so without this column "how often does a posed question's
  // quote fail to locate?" is unanswerable, and M35 §B is sized by argument
  // instead of by data.
  const located = locateQuoteAnchor(section.text, quote);
  const anchor = located ?? chapterStartAnchor(section.text);
  const anchorSource: AnchorSource = located ? "quote" : "chapter_start";
  const existing = findHighlightByExact(db, resource.id, spineIndex, anchor.exact);
  if (existing) {
    res.json(existing);
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
  });
  res.status(201).json(highlight);
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
