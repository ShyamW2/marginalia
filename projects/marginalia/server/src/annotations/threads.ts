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
  context_thematic_chapters: string;
  masked: number | null;
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

/** M35 §D1: one of a thread's (possibly several) targets — the primary one
 * still lives on `threads.highlight_id` (settled decision, unchanged), this
 * table is the *other* anchors. `ordinal` is creation order, not reading
 * order (§D4's `< >` traversal sorts by spineIndex/offset instead, since
 * that's the order a reader walks the book in, not the order quotes were
 * proposed) — but creation order is exactly what deleteHighlight's
 * promote-the-next-anchor rule needs. */
export interface ThreadAnchor {
  threadId: string;
  highlightId: string;
  ordinal: number;
}

interface ThreadAnchorRow {
  thread_id: string;
  highlight_id: string;
  ordinal: number;
}

function rowToThreadAnchor(row: ThreadAnchorRow): ThreadAnchor {
  return { threadId: row.thread_id, highlightId: row.highlight_id, ordinal: row.ordinal };
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
    contextThematicChapters: JSON.parse(row.context_thematic_chapters),
    contextMasked: row.masked === null ? null : row.masked === 1,
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

/** Creates a thread and, in the same transaction, its first `thread_anchors`
 * row (M35 §D1) — every thread this function creates carries full anchor
 * coverage from the start, so `deleteHighlight` never has to special-case
 * "a thread with no anchors of its own." */
export function createThread(db: Database.Database, highlightId: string): Thread {
  const thread: Thread = {
    id: crypto.randomUUID(),
    highlightId,
    createdAt: new Date().toISOString(),
  };
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO threads (id, highlight_id, created_at) VALUES (@id, @highlightId, @createdAt)`,
    ).run(thread);
    db.prepare(
      `INSERT INTO thread_anchors (thread_id, highlight_id, ordinal) VALUES (@id, @highlightId, 0)`,
    ).run(thread);
  });
  run();
  return thread;
}

/** All of a thread's anchors, oldest first — the primary
 * (`threads.highlight_id`) is always among them (ordinal 0, unless it's been
 * promoted by `deleteHighlight`, in which case it's whichever anchor that
 * left as the oldest survivor). */
export function listThreadAnchors(db: Database.Database, threadId: string): ThreadAnchor[] {
  const rows = db
    .prepare(`SELECT * FROM thread_anchors WHERE thread_id = ? ORDER BY ordinal`)
    .all(threadId) as ThreadAnchorRow[];
  return rows.map(rowToThreadAnchor);
}

/**
 * M35 §D1/§D6: adds one more target to an existing annotation — the vehicle
 * for §C5's "one theme -> one annotation -> N anchors." `ordinal` is the
 * next integer after this thread's current max, so a newly-added anchor
 * never collides with or reorders an existing one.
 */
export function addThreadAnchor(
  db: Database.Database,
  threadId: string,
  highlightId: string,
): ThreadAnchor {
  const { maxOrdinal } = db
    .prepare(`SELECT COALESCE(MAX(ordinal), -1) AS maxOrdinal FROM thread_anchors WHERE thread_id = ?`)
    .get(threadId) as { maxOrdinal: number };
  const ordinal = maxOrdinal + 1;
  db.prepare(
    `INSERT INTO thread_anchors (thread_id, highlight_id, ordinal) VALUES (@threadId, @highlightId, @ordinal)`,
  ).run({ threadId, highlightId, ordinal });
  return { threadId, highlightId, ordinal };
}

/**
 * Whether a highlight is already an anchor of *any* thread — the guard a
 * caller building anchors from possibly-reused highlights (§C5's
 * `persistThematicHighlights`, which can find the same pre-existing
 * highlight row a second run) must check before calling `addThreadAnchor`:
 * `(thread_id, highlight_id)` is the table's primary key, so re-adding an
 * already-anchored highlight to the same thread throws, and adding it to a
 * *different* thread would let one highlight belong to two annotations at
 * once, which nothing downstream (§D3's primary-resolution join included)
 * expects.
 */
export function isHighlightAnchored(db: Database.Database, highlightId: string): boolean {
  const row = db.prepare(`SELECT 1 FROM thread_anchors WHERE highlight_id = ?`).get(highlightId);
  return row !== undefined;
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
  contextThematicChapters?: number[];
  contextMasked?: boolean | null;
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
    contextThematicChapters: transparency.contextThematicChapters ?? [],
    contextMasked: transparency.contextMasked ?? null,
    createdAt: new Date().toISOString(),
    // The usage row (if any) is linked to this message's id only after
    // this call returns (see routes/threads.ts's linkUsageToMessage) — a
    // freshly-created message never has provenance yet by construction.
    provenance: null,
  };
  db.prepare(
    `INSERT INTO messages (id, thread_id, role, content, context_note, context_depth, context_chapters, context_thematic_chapters, masked, created_at)
     VALUES (@id, @threadId, @role, @content, @contextNote, @contextDepth, @contextChapters, @contextThematicChapters, @masked, @createdAt)`,
  ).run({
    ...message,
    contextChapters: JSON.stringify(message.contextChapters),
    contextThematicChapters: JSON.stringify(message.contextThematicChapters),
    masked: message.contextMasked === null ? null : message.contextMasked ? 1 : 0,
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
