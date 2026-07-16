import { Router, type Request, type Response } from "express";
import {
  CreateThreadBodySchema,
  CreateThreadMessageBodySchema,
} from "@marginalia/shared";
import { getDb } from "../db.js";
import { getHighlightById } from "../annotations/highlights.js";
import { getResourceById, getResourceTextSections } from "../library/store.js";
import {
  createMessage,
  createThread,
  getThreadByHighlightId,
  getThreadById,
  getThreadWithMessages,
  listMessagesForThread,
} from "../annotations/threads.js";
import { getProvider, LLMError, type LLMProvider } from "../llm/provider.js";
import { buildContext } from "../llm/context.js";

export const threadsRouter: Router = Router();

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
      const assistantMessage = createMessage(db, threadId, "assistant", fullText);
      res.write(
        `data: ${JSON.stringify({ done: true, messageId: assistantMessage.id, threadId })}\n\n`,
      );
    }
  } catch (err) {
    if (!disconnected) {
      const message =
        err instanceof LLMError ? `${err.code}: ${err.message}` : "Something went wrong.";
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

  const provider = getProvider(db);
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const thread = getThreadByHighlightId(db, highlightId) ?? createThread(db, highlightId);
  const priorMessages = listMessagesForThread(db, thread.id);

  const sections = getResourceTextSections(db, resource.id);
  const { instructions, bookContext, userMessage } = buildContext({
    title: resource.title,
    author: resource.author,
    sections,
    highlight,
    contextTokens: provider.capabilities().contextTokens,
  });

  // The highlight-quote framing only belongs on the thread's first question —
  // repeating it on every follow-up would waste tokens and read oddly.
  const userContent = priorMessages.length === 0 ? userMessage(question) : question;
  createMessage(db, thread.id, "user", userContent);

  const providerMessages = [
    ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userContent },
  ];

  await streamThreadReply(req, res, thread.id, provider, instructions, bookContext, providerMessages);
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

  const provider = getProvider(db);
  if (!provider) {
    res.status(400).json({ error: "provider_unconfigured" });
    return;
  }

  const priorMessages = listMessagesForThread(db, thread.id);
  const sections = getResourceTextSections(db, resource.id);
  const { instructions, bookContext } = buildContext({
    title: resource.title,
    author: resource.author,
    sections,
    highlight,
    contextTokens: provider.capabilities().contextTokens,
  });

  createMessage(db, thread.id, "user", question);
  const providerMessages = [
    ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: question },
  ];

  await streamThreadReply(req, res, thread.id, provider, instructions, bookContext, providerMessages);
});

threadsRouter.get("/:id", (req, res) => {
  const thread = getThreadWithMessages(getDb(), req.params.id);
  if (!thread) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(thread);
});
