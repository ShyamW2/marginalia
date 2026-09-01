import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import {
  AddThreadAnchorBodySchema,
  CreateThreadBodySchema,
  CreateThreadMessageBodySchema,
} from "@marginalia/shared";
import type { ContextLadderDepth, ContextUsage, Highlight, Resource } from "@marginalia/shared";
import { getDb } from "../db.js";
import { getHighlightById, listHighlightsForThread } from "../annotations/highlights.js";
import {
  getReadingPosition,
  getResourceById,
  getResourceTextSections,
} from "../library/store.js";
import {
  addThreadAnchor,
  createMessage,
  getAnchoredThreadId,
  getOrCreateThread,
  getThreadById,
  getThreadWithMessages,
  listMessagesForThread,
} from "../annotations/threads.js";
import { getProvider, LLMError, type ContextBlock, type LLMErrorCode, type LLMProvider } from "../llm/provider.js";
import { buildContext, buildDigestContext, buildOffContext, WINDOWED_CONTEXT_NOTE } from "../llm/context.js";
import { buildMessageProvenance, computeContextUsage, linkUsageToMessage, type UsageLedgerRow } from "../llm/usage.js";
import { getBookDigest } from "../digest/store.js";
import { resolveContextLadderDepth } from "../digest/ladder.js";
import { getBrief, hashBrief } from "../digest/thematicStore.js";
import { getLookahead } from "../digest/lookahead.js";
import { isChapterVisible, visibleChapterDigests, visibleThematicDigests } from "../digest/visibility.js";
import { selectThematicChapters } from "../digest/thematicSelection.js";

export const threadsRouter: Router = Router();

const DIGEST_CHAPTER_UNCOVERED_NOTE =
  "This passage's chapter hasn't been digested yet — this answer is grounded " +
  "in the rest of the book's digest and the pages around your highlight, not " +
  "a summary of this specific chapter.";

export interface ResolvedContext {
  instructions: string;
  bookContext: ContextBlock[];
  userMessage: (question: string) => string;
  contextNote: string | null;
  contextDepth: ContextLadderDepth;
  contextChapters: number[];
  /** M34 §D: the thematic chapters (§C's ranked selection) that fed this
   * answer, alongside contextChapters' plot-digest chapters. */
  contextThematicChapters: number[];
  /** M34 §D: whether §B5's lookahead mask was applied for this answer. */
  contextMasked: boolean;
}

/**
 * Picks the context-ladder rung for this book (decisions.md 2026-07-28
 * later) and builds the matching context. Every rung produces the same
 * shape so the caller (streamThreadReply / the two routes below) doesn't
 * need to know which one ran — only the "answer transparency" record does.
 */
export function resolveContext(
  db: Database.Database,
  provider: LLMProvider,
  resource: Resource,
  highlight: Highlight,
): ResolvedContext {
  const sections = getResourceTextSections(db, resource.id);
  const chapterTitles = resource.metadata.chapterTitles;
  const readingPosition = getReadingPosition(db, resource.id) ?? null;
  const bookDigest = getBookDigest(db, resource.id);
  const depth = resolveContextLadderDepth(db, resource.id, Boolean(bookDigest));

  // M34 §B: the mask, applied at every rung that reads it. The highlight's
  // own chapter is always visible regardless of the bookmark — the reader
  // is actively asking about it, and a stale/lagging bookmark must never
  // make that chapter read as masked (it would show as "not digested yet"
  // instead, a different and misleading designed state).
  const bookmarkSpineIndex = readingPosition?.spineIndex ?? -1;
  const noMask = getLookahead(db, resource.id);
  const visibilityOpts = {
    bookmarkSpineIndex,
    revealedSpineIndices: new Set([highlight.spineIndex]),
    noMask,
  };

  if (depth === "off") {
    const built = buildOffContext({
      title: resource.title,
      author: resource.author,
      sections,
      highlight,
      chapterTitles,
      readingPosition,
    });
    return {
      instructions: built.instructions,
      bookContext: built.bookContext,
      userMessage: built.userMessage,
      contextNote: null,
      contextDepth: "off",
      contextChapters: [],
      contextThematicChapters: [],
      contextMasked: !noMask,
    };
  }

  if (depth === "digest") {
    // §B2: stops shipping every chapter's summary and analysis — only what
    // the mask allows through.
    const chapterDigests = visibleChapterDigests(db, resource.id, visibilityOpts);
    const currentBriefHash = hashBrief(getBrief(db, resource.id).text);
    const thematicCandidates = visibleThematicDigests(db, resource.id, visibilityOpts)
      .filter((t) => t.briefHash === currentBriefHash)
      // M35 §C1: the context ladder's thematic block only ever names themes
      // (context.ts's DigestThematicSummary), never quotes them.
      .map((t) => ({ spineIndex: t.spineIndex, analysis: t.analysis, themes: t.themes.map((theme) => theme.name) }));
    // M34 §C: narrowed from "every visible, briefed chapter" to the
    // highlight's own chapter, the previous one, and a ranked few more.
    const thematicChapters = selectThematicChapters(
      db,
      resource.id,
      thematicCandidates,
      highlight.spineIndex,
    );
    const built = buildDigestContext({
      title: resource.title,
      author: resource.author,
      sections,
      highlight,
      chapterTitles,
      readingPosition,
      bookDigest: bookDigest
        ? { synopsis: bookDigest.synopsis, cast: bookDigest.cast, themes: bookDigest.themes }
        : null,
      chapterDigests,
      thematicChapters,
    });
    return {
      instructions: built.instructions,
      bookContext: built.bookContext,
      userMessage: built.userMessage,
      contextNote: built.highlightChapterCovered ? null : DIGEST_CHAPTER_UNCOVERED_NOTE,
      contextDepth: "digest",
      contextChapters: built.chaptersUsed,
      contextThematicChapters: built.thematicChaptersUsed,
      contextMasked: !noMask,
    };
  }

  // §B4: Full is masked as well — it used to ship the literal text of
  // unread chapters, stopped only by a sentence in the instructions.
  const visibleSections = sections.filter((s) => isChapterVisible(s.spineIndex, visibilityOpts));
  const built = buildContext({
    title: resource.title,
    author: resource.author,
    sections: visibleSections,
    highlight,
    contextTokens: provider.capabilities().contextTokens,
    chapterTitles,
    readingPosition,
  });
  return {
    instructions: built.instructions,
    bookContext: built.bookContext,
    userMessage: built.userMessage,
    contextNote: built.windowed ? WINDOWED_CONTEXT_NOTE : null,
    contextDepth: "full",
    contextChapters: [],
    contextThematicChapters: [],
    contextMasked: !noMask,
  };
}

/**
 * Human-facing SSE `{error}` message per LLMError code. Provider error
 * bodies (raw HTTP text, SDK exception messages) can contain endpoint
 * details, stack-shaped text, or in principle provider-side account info —
 * none of that belongs in a client-visible stream. The raw `err.message` is
 * logged server-side instead (see streamThreadReply's catch block).
 */
const ERROR_MESSAGES: Record<LLMErrorCode, string> = {
  auth: "Authentication with the LLM provider failed. Check the API key in Settings.",
  rate_limit: "The LLM provider is rate-limiting requests right now. Try again shortly.",
  context_too_large: "This book is too large for the configured provider's context window.",
  extract_parse_failed: "The model's response couldn't be understood.",
  network: "Couldn't reach the LLM provider. Check the connection or endpoint settings.",
  refused: "The model declined to answer that question.",
  unknown: "Something went wrong talking to the LLM provider.",
};

/**
 * Persists the user question and the assistant's answer together, in one
 * transaction, only once the answer is known — SPEC requires persisting on
 * completion so a failed/aborted turn never leaves a dangling question row
 * (which Retry would otherwise duplicate on re-post).
 */
function persistExchange(
  db: Database.Database,
  threadId: string,
  userContent: string,
  assistantContent: string,
  transparency: {
    contextNote: string | null;
    contextDepth: ContextLadderDepth;
    contextChapters: number[];
    contextThematicChapters: number[];
    contextMasked: boolean;
  },
) {
  const run = db.transaction(() => {
    createMessage(db, threadId, "user", userContent);
    return createMessage(db, threadId, "assistant", assistantContent, transparency);
  });
  return run();
}

/**
 * SSE contract (SPEC): `data: {"text": "..."}` per chunk, then either
 * `data: {"done": true, "messageId": ...}` on success or
 * `data: {"error": "..."}` on failure — never both. Aborts the provider
 * call on client disconnect; a partial answer is never persisted.
 */
async function streamThreadReply(
  req: Request,
  res: Response,
  threadId: string,
  provider: LLMProvider,
  instructions: string,
  bookContext: ContextBlock[],
  messages: { role: "user" | "assistant"; content: string }[],
  userContent: string,
  transparency: {
    contextNote: string | null;
    contextDepth: ContextLadderDepth;
    contextChapters: number[];
    contextThematicChapters: number[];
    contextMasked: boolean;
  },
  /** M17 "context-window readout": populated by the usage-ledger wrapper's
   * onLogged callback once the call completes — read here rather than
   * re-querying the ledger, which would race concurrent requests. Also the
   * M22.5 H2 source for the answer's provenance byline. */
  usageRowRef: { current: UsageLedgerRow | null },
  contextWindowTokens: number,
): Promise<void> {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.on("error", () => {
    // client-side socket errors after disconnect are expected — nothing to do
  });

  const db = getDb();
  const controller = new AbortController();
  let disconnected = false;
  // `req.on("close")` fires once the *request* body has been fully read —
  // which happens right after body-parsing, long before we're done writing
  // the response — so it's useless as a disconnect signal here. The
  // response's own "close" only fires when its underlying connection ends;
  // guard against our own res.end() (a clean finish) looking like one.
  res.on("close", () => {
    if (res.writableEnded) return;
    disconnected = true;
    controller.abort();
  });

  let fullText = "";
  try {
    for await (const chunk of provider.stream({
      instructions,
      bookContext,
      messages,
      // M34 §A6: the query role's cache breakpoints live an hour, not the
      // 5-minute default — a reader who reads for a while before asking
      // should still land on a warm cache. Ignored by every non-Anthropic
      // provider and by any block that isn't itself marked `cache`.
      cacheTtl: "1h",
      signal: controller.signal,
    })) {
      if (disconnected) break;
      fullText += chunk.text;
      res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
    }
    if (!disconnected) {
      const assistantMessage = persistExchange(db, threadId, userContent, fullText, transparency);
      // M22.5 H2: the usage row is logged (inside provider.stream()'s own
      // finally) before the message exists to link it to — link it now,
      // the first moment both ids are known.
      if (usageRowRef.current) linkUsageToMessage(db, usageRowRef.current.id, assistantMessage.id);
      const contextUsage: ContextUsage | null = usageRowRef.current
        ? computeContextUsage(usageRowRef.current, contextWindowTokens)
        : null;
      res.write(
        `data: ${JSON.stringify({
          done: true,
          messageId: assistantMessage.id,
          threadId,
          contextNote: transparency.contextNote,
          contextUsage,
          contextDepth: transparency.contextDepth,
          contextChapters: transparency.contextChapters,
          contextThematicChapters: transparency.contextThematicChapters,
          contextMasked: transparency.contextMasked,
          provenance: buildMessageProvenance(db, usageRowRef.current),
        })}\n\n`,
      );
    }
  } catch (err) {
    if (!disconnected) {
      // eslint-disable-next-line no-console
      console.error("[threads] provider error:", err);
      const message =
        err instanceof LLMError ? ERROR_MESSAGES[err.code] : ERROR_MESSAGES.unknown;
      res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    }
  } finally {
    if (!disconnected) res.end();
  }
}

threadsRouter.post("/", async (req, res) => {
  const parsed = CreateThreadBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { highlightId, question } = parsed.data;

  const db = getDb();
  const highlight = getHighlightById(db, highlightId);
  if (!highlight) {
    res.status(404).json({ error: "highlight_not_found" });
    return;
  }
  const resource = getResourceById(db, highlight.resourceId);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }

  const usageRowRef: { current: UsageLedgerRow | null } = {
    current: null,
  };
  const provider = getProvider(db, "query", "thread", resource.id, (row) => {
    usageRowRef.current = row;
  });
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const thread = getOrCreateThread(db, highlightId);
  const priorMessages = listMessagesForThread(db, thread.id);

  const {
    instructions,
    bookContext,
    userMessage,
    contextNote,
    contextDepth,
    contextChapters,
    contextThematicChapters,
    contextMasked,
  } = resolveContext(db, provider, resource, highlight);

  // The highlight-quote framing only belongs on the thread's first question —
  // repeating it on every follow-up would waste tokens and read oddly.
  const userContent = priorMessages.length === 0 ? userMessage(question) : question;

  const providerMessages = [
    ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userContent },
  ];

  await streamThreadReply(
    req,
    res,
    thread.id,
    provider,
    instructions,
    bookContext,
    providerMessages,
    userContent,
    { contextNote, contextDepth, contextChapters, contextThematicChapters, contextMasked },
    usageRowRef,
    provider.capabilities().contextTokens,
  );
});

threadsRouter.post("/:id/messages", async (req, res) => {
  const parsed = CreateThreadMessageBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { question } = parsed.data;

  const db = getDb();
  const thread = getThreadById(db, req.params.id);
  if (!thread) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const highlight = getHighlightById(db, thread.highlightId);
  if (!highlight) {
    res.status(404).json({ error: "highlight_not_found" });
    return;
  }
  const resource = getResourceById(db, highlight.resourceId);
  if (!resource) {
    res.status(404).json({ error: "resource_not_found" });
    return;
  }

  const usageRowRef: { current: UsageLedgerRow | null } = {
    current: null,
  };
  const provider = getProvider(db, "query", "thread", resource.id, (row) => {
    usageRowRef.current = row;
  });
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const priorMessages = listMessagesForThread(db, thread.id);
  const {
    instructions,
    bookContext,
    contextNote,
    contextDepth,
    contextChapters,
    contextThematicChapters,
    contextMasked,
  } = resolveContext(db, provider, resource, highlight);

  const providerMessages = [
    ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: question },
  ];

  await streamThreadReply(
    req,
    res,
    thread.id,
    provider,
    instructions,
    bookContext,
    providerMessages,
    question,
    { contextNote, contextDepth, contextChapters, contextThematicChapters, contextMasked },
    usageRowRef,
    provider.capabilities().contextTokens,
  );
});

threadsRouter.get("/:id", (req, res) => {
  const thread = getThreadWithMessages(getDb(), req.params.id);
  if (!thread) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(thread);
});

/**
 * M35 §D4: every anchor of a thread, reading-order — the client's `< >`
 * traversal fetches this once per opened panel rather than getting anchors
 * bundled onto every highlight in the resource's own list (which would grow
 * that response for a feature only a multi-anchor thread ever uses).
 */
threadsRouter.get("/:id/anchors", (req, res) => {
  const db = getDb();
  const thread = getThreadById(db, req.params.id);
  if (!thread) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  let sources = listHighlightsForThread(db, thread.id);
  // Falls back to the primary alone if thread_anchors somehow has nothing —
  // shouldn't happen (createThread and migration 34 both guarantee
  // coverage), but a thread must never report zero anchors of its own.
  if (sources.length === 0) {
    const primary = getHighlightById(db, thread.highlightId);
    if (primary) sources = [primary];
  }
  const anchors = sources.map((h) => ({
    highlightId: h.id,
    exact: h.exact,
    spineIndex: h.spineIndex,
  }));
  res.json({ anchors });
});

/**
 * M35 §G3: the write-side counterpart to the anchors read above — links one
 * more highlight to an existing annotation. The ground rule (decisions.md
 * 2026-09-01 evening): a highlight may join a thread, a thread may never
 * join a thread. `getAnchoredThreadId` tells apart "already anchors *this*
 * thread" (no-op, 200 — the reader double-clicked, or a retry) from "already
 * anchors a *different* one" (409 — refuse rather than silently merging two
 * annotations).
 */
threadsRouter.post("/:id/anchors", (req, res) => {
  const db = getDb();
  const thread = getThreadById(db, req.params.id);
  if (!thread) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = AddThreadAnchorBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const highlight = getHighlightById(db, parsed.data.highlightId);
  if (!highlight) {
    res.status(404).json({ error: "highlight_not_found" });
    return;
  }
  const primary = getHighlightById(db, thread.highlightId);
  if (primary && highlight.resourceId !== primary.resourceId) {
    res.status(400).json({ error: "cross_resource" });
    return;
  }

  const existingThreadId = getAnchoredThreadId(db, highlight.id);
  if (existingThreadId === thread.id) {
    res.json({ highlightId: highlight.id, threadId: thread.id });
    return;
  }
  if (existingThreadId !== undefined) {
    res.status(409).json({ error: "highlight_already_anchored" });
    return;
  }

  addThreadAnchor(db, thread.id, highlight.id);
  res.status(201).json({ highlightId: highlight.id, threadId: thread.id });
});
