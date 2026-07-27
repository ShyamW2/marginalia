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
    // M15 "real chapter axis": spineIndex (as a string — JSON object keys
    // are always strings) -> chapter title, from the EPUB's own NCX. Absent
    // or missing entries just mean the scan's chapter toggle has nothing to
    // show for that chapter and falls back to its number.
    chapterTitles: z.record(z.string(), z.string()).optional(),
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

// ---------------------------------------------------------------------------
// Shelf state (M8 — the Desk's freeform workspace)
// ---------------------------------------------------------------------------

export const ShelfStateSchema = z.object({
  x: z.number(),
  y: z.number(),
  rotation: z.number(),
  zOrder: z.number().int(),
});
export type ShelfState = z.infer<typeof ShelfStateSchema>;

export const UpdateShelfStateBodySchema = ShelfStateSchema;
export type UpdateShelfStateBody = z.infer<typeof UpdateShelfStateBodySchema>;

/** Library list view: a Resource plus counts for the grid. */
export const ResourceSummarySchema = ResourceSchema.extend({
  highlightCount: z.number().int().nonnegative(),
  threadCount: z.number().int().nonnegative(),
  // Null if the book has never been opened (no reading_state row yet).
  lastReadAt: z.string().nullable(),
  // Null until the book is first arranged on the desk (DeskPage assigns a
  // default position on first render and persists it via PUT .../shelf).
  shelf: ShelfStateSchema.nullable(),
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

/** 0 = unstarred; 1-3 stars (M9 "revisit queue" — DESIGN.md Room 3). */
export const HighlightImportanceSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type HighlightImportance = z.infer<typeof HighlightImportanceSchema>;

export const HighlightSchema = AnchorSchema.extend({
  id: z.string(), // uuid v4
  resourceId: z.string(),
  kind: HighlightKindSchema,
  importance: HighlightImportanceSchema,
  // M13: the reader's own plain-text note, separate from the LLM thread —
  // never sent to a provider, never distilled into the vault (settled
  // decision 7). Empty string, not null, matching the column's default.
  note: z.string(),
  // M14 "movable sticky notes" (decisions.md 2026-07-27): the thread panel's
  // dragged position, stored as an offset from its *anchor* — never an
  // absolute stage coordinate, since the anchor moves on every page turn,
  // resize, or margin change (the same reasoning M8 applied to shelf state).
  panelDx: z.number(),
  panelDy: z.number(),
  createdAt: z.string(),
});
export type Highlight = z.infer<typeof HighlightSchema>;

export const UpdateHighlightImportanceBodySchema = z.object({
  importance: HighlightImportanceSchema,
});
export type UpdateHighlightImportanceBody = z.infer<
  typeof UpdateHighlightImportanceBodySchema
>;

export const UpdateHighlightNoteBodySchema = z.object({
  note: z.string(),
});
export type UpdateHighlightNoteBody = z.infer<typeof UpdateHighlightNoteBodySchema>;

export const UpdateHighlightPanelOffsetBodySchema = z.object({
  panelDx: z.number(),
  panelDy: z.number(),
});
export type UpdateHighlightPanelOffsetBody = z.infer<
  typeof UpdateHighlightPanelOffsetBodySchema
>;

const TagSchema = z.string().trim().min(1).max(40);

export const HighlightTagsSchema = z.object({
  tags: z.array(TagSchema),
});
export type HighlightTags = z.infer<typeof HighlightTagsSchema>;

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
// Notepad (M8 — the Desk's scratch pad)
// ---------------------------------------------------------------------------

export const NotepadSchema = z.object({
  content: z.string(),
  updatedAt: z.string(),
  // Whether `content` differs from what's currently published — drives the
  // notepad's "publish" button state.
  dirty: z.boolean(),
});
export type Notepad = z.infer<typeof NotepadSchema>;

export const UpdateNotepadBodySchema = z.object({
  content: z.string(),
});
export type UpdateNotepadBody = z.infer<typeof UpdateNotepadBodySchema>;

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

export const LLMProviderIdSchema = z.enum([
  "anthropic",
  "openai-compatible",
  "claude-agent",
]);
export type LLMProviderId = z.infer<typeof LLMProviderIdSchema>;

/**
 * Desk cursor prefs (DESIGN.md "Cursor system"): a custom cursor per room
 * and the ink/phosphor trail overlay are each independently disableable,
 * on top of the app-wide reduced-motion gate.
 */
export const CursorStyleSchema = z.enum(["system", "custom"]);
export type CursorStyleChoice = z.infer<typeof CursorStyleSchema>;

/** M12 "two-page spread": "auto" lets epub.js show facing pages on a wide
 * enough window (falls back to one page below its own minSpreadWidth);
 * "single" pins it to one page always — today's behavior. */
export const SpreadModeSchema = z.enum(["single", "auto"]);
export type SpreadMode = z.infer<typeof SpreadModeSchema>;

/** M14 "customisable page margins" (decisions.md 2026-07-27): the outer
 * padding around the rendered page, independent of the spread gutter. */
export const ReaderMarginSchema = z.enum(["narrow", "normal", "wide", "generous"]);
export type ReaderMargin = z.infer<typeof ReaderMarginSchema>;

/** M16 "reading text size": a multiplier on the epub body's base font-size,
 * applied through the epub theme (`rendition.themes.fontSize()`) — it is not
 * independent of margins, since `READER_TARGET_COLUMN_WIDTH` is "~70ch at
 * 16px" and must scale with it to keep the measure in range. */
export const ReaderFontScaleSchema = z.number().min(0.8).max(1.6);
export type ReaderFontScale = z.infer<typeof ReaderFontScaleSchema>;

/** M15 "CRT treatment" (decisions.md 2026-07-20): strength of the scan's
 * barrel-warp/bloom/chromatic-fringing filter, 0 (off) to 1 (full). Reduced
 * motion disables the effect outright regardless of this value. */
export const ScanCrtIntensitySchema = z.number().min(0).max(1);

/** GET /api/settings response — secrets are masked ("***") if set, "" if unset. */
export const SettingsSchema = z.object({
  provider: LLMProviderIdSchema,
  anthropicModel: z.string(),
  anthropicApiKey: z.string(), // masked
  claudeAgentModel: z.string(), // claude-agent provider: model id or alias (no key — uses local Claude Code login)
  openaiBaseUrl: z.string(),
  openaiModel: z.string(),
  openaiApiKey: z.string(), // masked
  openaiContextTokens: z.number().int().positive(),
  vaultPath: z.string(),
  cursorStyle: CursorStyleSchema,
  cursorTrailEnabled: z.boolean(),
  spreadMode: SpreadModeSchema,
  readerMargin: ReaderMarginSchema,
  readerFontScale: ReaderFontScaleSchema,
  scanCrtIntensity: ScanCrtIntensitySchema,
  maxResponseTokens: z.number().int().positive(),
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
// Scan (M9 — the timeline/heat-map room, DESIGN.md "Room 3")
// ---------------------------------------------------------------------------

export const ScanChapterSchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  // M15 "real chapter axis" (TASKS.md): a plain 1-based sequence number
  // (always present) plus the EPUB's own chapter title where its NCX
  // provides one for this spine item (often not, for front/back matter) —
  // the scan defaults to numbers and a toggle reveals names.
  chapterNumber: z.number().int().positive(),
  title: z.string().nullable(),
  startPercent: z.number().min(0).max(1),
  lengthPercent: z.number().min(0).max(1),
});
export type ScanChapter = z.infer<typeof ScanChapterSchema>;

/**
 * One highlight rendered as a heat band. `positionPercent` is null when the
 * server-side prefix+exact+suffix search can't locate the passage anymore
 * (SPEC anchoring rule's "unanchored" outcome, computed without epub.js —
 * see server/src/annotations/position.ts) — the scan simply omits that band
 * rather than guessing a position.
 */
export const ScanHighlightSchema = z.object({
  id: z.string(),
  kind: HighlightKindSchema,
  exact: z.string(),
  importance: HighlightImportanceSchema,
  tags: z.array(z.string()),
  note: z.string(),
  positionPercent: z.number().min(0).max(1).nullable(),
  threadId: z.string().nullable(),
  hasAnswer: z.boolean(),
  threadMessageCount: z.number().int().nonnegative(),
  threadFirstLine: z.string().nullable(),
});
export type ScanHighlight = z.infer<typeof ScanHighlightSchema>;

export const ScanDataSchema = z.object({
  resource: ResourceSchema,
  totalHighlights: z.number().int().nonnegative(),
  lastReadAt: z.string().nullable(),
  chapters: z.array(ScanChapterSchema),
  highlights: z.array(ScanHighlightSchema),
});
export type ScanData = z.infer<typeof ScanDataSchema>;

// ---------------------------------------------------------------------------
// Generic error envelope
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
