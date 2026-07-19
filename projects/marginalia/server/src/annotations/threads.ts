import crypto from "node:crypto";
import type Database from "better-sqlite3";
import type { Message, MessageRole, Thread, ThreadWithMessages } from "@marginalia/shared";

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
  created_at: string;
}

function rowToThread(row: ThreadRow): Thread {
  return { id: row.id, highlightId: row.highlight_id, createdAt: row.created_at };
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role as MessageRole,
    content: row.content,
    createdAt: row.created_at,
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

export function listMessagesForThread(db: Database.Database, threadId: string): Message[] {
  const rows = db
    .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at")
    .all(threadId) as MessageRow[];
  return rows.map(rowToMessage);
}

export function createMessage(
  db: Database.Database,
  threadId: string,
  role: MessageRole,
  content: string,
): Message {
  const message: Message = {
    id: crypto.randomUUID(),
    threadId,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, created_at)
     VALUES (@id, @threadId, @role, @content, @createdAt)`,
  ).run(message);
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
