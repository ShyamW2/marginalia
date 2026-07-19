import { z } from "zod";

/**
 * Shared zod schemas + inferred types for the HTTP boundary between
 * server and web. Mirrors the SQLite data model in docs/marginalia/SPEC.md —
 * keep both in sync when either changes.
 */

// ---------------------------------------------------------------------------
// Resource (an imported book)
// ---------------------------------------------------------------------------

export const ResourceFormatSchema = z.enum(["epub"]);
export type ResourceFormat = z.infer<typeof ResourceFormatSchema>;

export const ResourceMetadataSchema = z
  .object({
    language: z.string().optional(),
    publisher: z.string().optional(),
    coverHref: z.string().optional(),
  })
  .catchall(z.unknown());
export type ResourceMetadata = z.infer<typeof ResourceMetadataSchema>;

export const ResourceSchema = z.object({
  id: z.string(), // sha256 of file bytes — content-addressed
  title: z.string(),
  author: z.string().nullable(),
  format: ResourceFormatSchema,
  metadata: ResourceMetadataSchema,
  importedAt: z.string(), // ISO 8601
});
export type Resource = z.infer<typeof ResourceSchema>;

/** Library list view: a Resource plus counts for the grid. */
export const ResourceSummarySchema = ResourceSchema.extend({
  highlightCount: z.number().int().nonnegative(),
  threadCount: z.number().int().nonnegative(),
  // Null if the book has never been opened (no reading_state row yet).
  lastReadAt: z.string().nullable(),
});
export type ResourceSummary = z.infer<typeof ResourceSummarySchema>;

// ---------------------------------------------------------------------------
// Reading position
// ---------------------------------------------------------------------------

export const ReadingPositionSchema = z.object({
  resourceId: z.string(),
  location: z.string(), // epub.js CFI
  updatedAt: z.string(),
});
export type ReadingPosition = z.infer<typeof ReadingPositionSchema>;

export const UpdateReadingPositionBodySchema = z.object({
  location: z.string().min(1),
});
export type UpdateReadingPositionBody = z.infer<
  typeof UpdateReadingPositionBodySchema
>;

// ---------------------------------------------------------------------------
// Anchor — W3C Web Annotation style: exact quote + prefix/suffix + position.
// Embedded (flattened) into Highlight, matching the `highlights` table columns.
// ---------------------------------------------------------------------------

export const AnchorSchema = z.object({
  exact: z.string().min(1),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
  cfi: z.string().min(1), // epub.js CFI range — primary anchor
  spineIndex: z.number().int().nonnegative(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

// ---------------------------------------------------------------------------
// Highlight
// ---------------------------------------------------------------------------

/**
 * Four semantic kinds chosen at capture time (docs/decisions.md 2026-07-19):
 * rose = passage to revisit / general annotation; sage = definition of a new
 * word or phrase; honey = important quote; slate = a question about the
 * text (the kind Ask defaults to). Labels, not behavior — any kind can host
 * a thread.
 */
export const HighlightKindSchema = z.enum(["rose", "sage", "honey", "slate"]);
export type HighlightKind = z.infer<typeof HighlightKindSchema>;

export const HighlightSchema = AnchorSchema.extend({
  id: z.string(), // uuid v4
  resourceId: z.string(),
  kind: HighlightKindSchema,
  createdAt: z.string(),
});
export type Highlight = z.infer<typeof HighlightSchema>;

export const CreateHighlightBodySchema = AnchorSchema.extend({
  resourceId: z.string().min(1),
  kind: HighlightKindSchema,
});
export type CreateHighlightBody = z.infer<typeof CreateHighlightBodySchema>;

// ---------------------------------------------------------------------------
// Thread + Message
// ---------------------------------------------------------------------------

/** Minimal thread state attached to a highlight for margin-rail rendering. */
export const ThreadSummarySchema = z.object({
  id: z.string(),
  hasAnswer: z.boolean(), // at least one assistant message has been persisted
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

/** GET /api/resources/:id/highlights response shape (SPEC: "+ their thread summaries"). */
export const HighlightWithThreadSchema = HighlightSchema.extend({
  thread: ThreadSummarySchema.nullable(),
});
export type HighlightWithThread = z.infer<typeof HighlightWithThreadSchema>;

export const ThreadSchema = z.object({
  id: z.string(), // uuid v4
  highlightId: z.string(),
  createdAt: z.string(),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const MessageRoleSchema = z.enum(["user", "assistant"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

/** Body for POST /api/threads — starts a thread from a highlight + question. */
export const CreateThreadBodySchema = z.object({
  highlightId: z.string().min(1),
  question: z.string().min(1),
});
export type CreateThreadBody = z.infer<typeof CreateThreadBodySchema>;

/** Body for POST /api/threads/:id/messages — a follow-up question. */
export const CreateThreadMessageBodySchema = z.object({
  question: z.string().min(1),
});
export type CreateThreadMessageBody = z.infer<
  typeof CreateThreadMessageBodySchema
>;

/** A thread with its full message history, for GET /api/threads/:id. */
export const ThreadWithMessagesSchema = ThreadSchema.extend({
  messages: z.array(MessageSchema),
});
export type ThreadWithMessages = z.infer<typeof ThreadWithMessagesSchema>;

// ---------------------------------------------------------------------------
// SSE event contract for thread streaming (POST /api/threads, .../messages)
// ---------------------------------------------------------------------------

export const ThreadStreamEventSchema = z.union([
  z.object({ text: z.string() }),
  // SPEC-GAP: SPEC's done event is `{done: true, messageId}` only. The
  // client needs the thread's id after the *first* message (when it had
  // none) to target follow-ups at `/api/threads/:id/messages` and to update
  // the margin rail's thread-summary state — added `threadId` here rather
  // than an extra round-trip fetch after every first message.
  z.object({ done: z.literal(true), messageId: z.string(), threadId: z.string() }),
  z.object({ error: z.string() }),
]);
export type ThreadStreamEvent = z.infer<typeof ThreadStreamEventSchema>;

// ---------------------------------------------------------------------------
// Publish (vault compiler) result
// ---------------------------------------------------------------------------

export const PublishResultSchema = z.object({
  notes: z.number().int().nonnegative(),
  conceptsCreated: z.number().int().nonnegative(),
  conceptsLinked: z.number().int().nonnegative(),
});
export type PublishResult = z.infer<typeof PublishResultSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const LLMProviderIdSchema = z.enum(["anthropic", "openai-compatible"]);
export type LLMProviderId = z.infer<typeof LLMProviderIdSchema>;

/** GET /api/settings response — secrets are masked ("***") if set, "" if unset. */
export const SettingsSchema = z.object({
  provider: LLMProviderIdSchema,
  anthropicModel: z.string(),
  anthropicApiKey: z.string(), // masked
  openaiBaseUrl: z.string(),
  openaiModel: z.string(),
  openaiApiKey: z.string(), // masked
  openaiContextTokens: z.number().int().positive(),
  vaultPath: z.string(),
});
export type Settings = z.infer<typeof SettingsSchema>;

/**
 * PUT /api/settings body — every field optional (partial update). A secret
 * field of exactly "***" means "leave unchanged" (echo of the masked GET
 * value); an empty string clears it.
 */
export const SettingsUpdateSchema = SettingsSchema.partial();
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

// ---------------------------------------------------------------------------
// Generic error envelope
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
