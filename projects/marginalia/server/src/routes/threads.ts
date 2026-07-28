import { Router, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import {
  CreateThreadBodySchema,
  CreateThreadMessageBodySchema,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import { getHighlightById } from "../annotations/highlights.js";
import {
  getReadingPosition,
  getResourceById,
  getResourceTextSections,
} from "../library/store.js";
import {
  createMessage,
  getOrCreateThread,
  getThreadById,
  getThreadWithMessages,
  listMessagesForThread,
} from "../annotations/threads.js";
import { getProvider, LLMError, type LLMErrorCode, type LLMProvider } from "../llm/provider.js";
import { buildContext, WINDOWED_CONTEXT_NOTE } from "../llm/context.js";
import { computeContextUsage, type UsageLedgerRow } from "../llm/usage.js";
import type { ContextUsage } from "@marginalia/shared";

export const threadsRouter: Router = Router();

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
  contextNote: string | null,
) {
  const run = db.transaction(() => {
    createMessage(db, threadId, "user", userContent);
    return createMessage(db, threadId, "assistant", assistantContent, contextNote);
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
  bookContext: string,
  messages: { role: "user" | "assistant"; content: string }[],
  userContent: string,
  contextNote: string | null,
  /** M17 "context-window readout": populated by the usage-ledger wrapper's
   * onLogged callback once the call completes — read here rather than
   * re-querying the ledger, which would race concurrent requests. */
  usageRowRef: { current: Omit<UsageLedgerRow, "id" | "createdAt"> | null },
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
      signal: controller.signal,
    })) {
      if (disconnected) break;
      fullText += chunk.text;
      res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
    }
    if (!disconnected) {
      const assistantMessage = persistExchange(
        db,
        threadId,
        userContent,
        fullText,
        contextNote,
      );
      const contextUsage: ContextUsage | null = usageRowRef.current
        ? computeContextUsage(usageRowRef.current, contextWindowTokens)
        : null;
      res.write(
        `data: ${JSON.stringify({
          done: true,
          messageId: assistantMessage.id,
          threadId,
          contextNote,
          contextUsage,
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

  const usageRowRef: { current: Omit<UsageLedgerRow, "id" | "createdAt"> | null } = {
    current: null,
  };
  const provider = getProvider(db, "thread", (row) => {
    usageRowRef.current = row;
  });
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const thread = getOrCreateThread(db, highlightId);
  const priorMessages = listMessagesForThread(db, thread.id);

  const sections = getResourceTextSections(db, resource.id);
  const { instructions, bookContext, userMessage, windowed } = buildContext({
    title: resource.title,
    author: resource.author,
    sections,
    highlight,
    contextTokens: provider.capabilities().contextTokens,
    chapterTitles: resource.metadata.chapterTitles,
    readingPosition: getReadingPosition(db, resource.id) ?? null,
  });

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
    windowed ? WINDOWED_CONTEXT_NOTE : null,
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

  const usageRowRef: { current: Omit<UsageLedgerRow, "id" | "createdAt"> | null } = {
    current: null,
  };
  const provider = getProvider(db, "thread", (row) => {
    usageRowRef.current = row;
  });
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const priorMessages = listMessagesForThread(db, thread.id);
  const sections = getResourceTextSections(db, resource.id);
  const { instructions, bookContext, windowed } = buildContext({
    title: resource.title,
    author: resource.author,
    sections,
    highlight,
    contextTokens: provider.capabilities().contextTokens,
    chapterTitles: resource.metadata.chapterTitles,
    readingPosition: getReadingPosition(db, resource.id) ?? null,
  });

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
    windowed ? WINDOWED_CONTEXT_NOTE : null,
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
