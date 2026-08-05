import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type {
  ContextLadderDepth,
  LLMProviderId,
  Message,
  MessageProvenance,
  MessageRole,
  Thread,
  ThreadWithMessages,
} from "@marginalia/shared";
import { endpointHostFor } from "../llm/usage.js";

interface ThreadRow {
  id: string;
  highlight_id: string;
  created_at: string;
}

interface MessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  context_note: string | null;
  context_depth: string | null;
  context_chapters: string;
  created_at: string;
  // M22.5 H2: populated only by the LEFT JOIN in listMessagesForThread —
  // absent (undefined) on a bare `SELECT * FROM messages` row, which reads
  // the same as "no linked usage row" below.
  usage_provider?: string | null;
  usage_model?: string | null;
  profile_name?: string | null;
  profile_openai_base_url?: string | null;
}

function rowToThread(row: ThreadRow): Thread {
  return { id: row.id, highlightId: row.highlight_id, createdAt: row.created_at };
}

function rowToMessage(row: MessageRow): Message {
  const provenance: MessageProvenance | null = row.usage_provider
    ? {
        profileName: row.profile_name ?? null,
        provider: row.usage_provider as LLMProviderId,
        model: row.usage_model ?? null,
        endpointHost: endpointHostFor(row.usage_provider, row.profile_openai_base_url ?? null),
      }
    : null;
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role as MessageRole,
    content: row.content,
    contextNote: row.context_note,
    contextDepth: row.context_depth as ContextLadderDepth | null,
    contextChapters: JSON.parse(row.context_chapters),
    createdAt: row.created_at,
    provenance,
  };
}

export function getThreadByHighlightId(
  db: Database.Database,
  highlightId: string,
): Thread | undefined {
  const row = db
    .prepare("SELECT * FROM threads WHERE highlight_id = ?")
    .get(highlightId) as ThreadRow | undefined;
  return row ? rowToThread(row) : undefined;
}

export function getThreadById(db: Database.Database, id: string): Thread | undefined {
  const row = db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as
    | ThreadRow
    | undefined;
  return row ? rowToThread(row) : undefined;
}

export function createThread(db: Database.Database, highlightId: string): Thread {
  const thread: Thread = {
    id: crypto.randomUUID(),
    highlightId,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO threads (id, highlight_id, created_at) VALUES (@id, @highlightId, @createdAt)`,
  ).run(thread);
  return thread;
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    (err as { code: string }).code.startsWith("SQLITE_CONSTRAINT")
  );
}

/**
 * Finds or creates the thread for a highlight, recovering from the
 * `UNIQUE(highlight_id)` race: two near-simultaneous first-questions on the
 * same highlight can both see no existing thread and both attempt to
 * create one — the loser's insert fails the unique constraint. Rather than
 * surfacing that as a 500, reuse the thread the winner just created.
 */
export function getOrCreateThread(db: Database.Database, highlightId: string): Thread {
  const existing = getThreadByHighlightId(db, highlightId);
  if (existing) return existing;

  try {
    return createThread(db, highlightId);
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const thread = getThreadByHighlightId(db, highlightId);
      if (thread) return thread;
    }
    throw err;
  }
}

/**
 * M22.5 H2: LEFT JOINs the message's own `llm_usage` row (by `message_id`,
 * added in the same migration that makes this join possible) and, through
 * it, the provider profile that made the call — so `rowToMessage` can build
 * a byline without a second query per message. No usage row (pre-M22.5
 * messages, or a message this app didn't itself generate) just means
 * `usage_provider` is null, which `rowToMessage` reads as "no provenance".
 */
export function listMessagesForThread(db: Database.Database, threadId: string): Message[] {
  const rows = db
    .prepare(
      `SELECT m.*,
              u.provider AS usage_provider,
              u.model AS usage_model,
              p.name AS profile_name,
              p.openai_base_url AS profile_openai_base_url
       FROM messages m
       LEFT JOIN llm_usage u ON u.message_id = m.id
       LEFT JOIN provider_profiles p ON p.id = u.profile_id
       WHERE m.thread_id = ?
       ORDER BY m.created_at`,
    )
    .all(threadId) as MessageRow[];
  return rows.map(rowToMessage);
}

export interface CreateMessageTransparency {
  contextNote?: string | null;
  contextDepth?: ContextLadderDepth | null;
  contextChapters?: number[];
}

export function createMessage(
  db: Database.Database,
  threadId: string,
  role: MessageRole,
  content: string,
  transparency: CreateMessageTransparency = {},
): Message {
  const message: Message = {
    id: crypto.randomUUID(),
    threadId,
    role,
    content,
    contextNote: transparency.contextNote ?? null,
    contextDepth: transparency.contextDepth ?? null,
    contextChapters: transparency.contextChapters ?? [],
    createdAt: new Date().toISOString(),
    // The usage row (if any) is linked to this message's id only after
    // this call returns (see routes/threads.ts's linkUsageToMessage) — a
    // freshly-created message never has provenance yet by construction.
    provenance: null,
  };
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, context_note, context_depth, context_chapters, created_at)
     VALUES (@id, @threadId, @role, @content, @contextNote, @contextDepth, @contextChapters, @createdAt)`,
  ).run({
    ...message,
    contextChapters: JSON.stringify(message.contextChapters),
  });
  return message;
}

export function getThreadWithMessages(
  db: Database.Database,
  id: string,
): ThreadWithMessages | undefined {
  const thread = getThreadById(db, id);
  if (!thread) return undefined;
  return { ...thread, messages: listMessagesForThread(db, id) };
}
