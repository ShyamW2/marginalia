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
  // M17: client-resolved spine index + whole-book percent at `location`,
  // null on rows saved before M17 or when epub.js couldn't resolve them yet
  // (e.g. locations not generated). Lets the LLM context builder warn
  // itself off spoiling past where the reader actually is.
  spineIndex: z.number().int().nonnegative().nullable(),
  percent: z.number().min(0).max(100).nullable(),
  updatedAt: z.string(),
});
export type ReadingPosition = z.infer<typeof ReadingPositionSchema>;

export const UpdateReadingPositionBodySchema = z.object({
  location: z.string().min(1),
  spineIndex: z.number().int().nonnegative().nullable().optional(),
  percent: z.number().min(0).max(100).nullable().optional(),
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

/** M17 "the context ladder" (the brain button): Off = passage + surrounding
 * pages; Digest = digest of covering chapters + surrounding pages; Full =
 * whole book (pre-M17 behavior). Remembered per book — default becomes
 * Digest once a book has one, Full otherwise. Declared here, ahead of
 * Message below, since Message.contextDepth references it. */
export const ContextLadderDepthSchema = z.enum(["off", "digest", "full"]);
export type ContextLadderDepth = z.infer<typeof ContextLadderDepthSchema>;

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
  // M17 "surface silent windowing": a short, human-readable note attached to
  // an assistant answer when it was grounded in a window of the book rather
  // than the whole text (or, later, a digest) — never set on user messages.
  // Null on every answer that used the full book, so it never appears when
  // it shouldn't (SPEC-GAP-adjacent transparency requirement, decisions.md
  // 2026-07-28 later).
  contextNote: z.string().nullable(),
  // M17 "answer transparency" (decisions.md 2026-07-28 later, non-
  // negotiable): which context-ladder depth produced this answer, and —
  // for "digest" — which chapters' digests fed it. Null depth means a
  // pre-M17 message with no recorded depth.
  contextDepth: ContextLadderDepthSchema.nullable(),
  contextChapters: z.array(z.number().int().nonnegative()),
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

/** M17 "context-window readout": tokens spent on a single call over the
 * provider's context window, labeled with provenance so an estimate is
 * never shown as a measurement. Live/SSE-only — not persisted with the
 * message; the llm_usage ledger (server-side) is the durable source of
 * truth for historical totals. */
export const ContextUsageSchema = z.object({
  tokensUsed: z.number().int().nonnegative(),
  windowTokens: z.number().int().positive(),
  percent: z.number().nonnegative(),
  provenance: z.enum(["reported", "measured", "estimated"]),
});
export type ContextUsage = z.infer<typeof ContextUsageSchema>;

export const ThreadStreamEventSchema = z.union([
  z.object({ text: z.string() }),
  // SPEC-GAP: SPEC's done event is `{done: true, messageId}` only. The
  // client needs the thread's id after the *first* message (when it had
  // none) to target follow-ups at `/api/threads/:id/messages` and to update
  // the margin rail's thread-summary state — added `threadId` here rather
  // than an extra round-trip fetch after every first message.
  z.object({
    done: z.literal(true),
    messageId: z.string(),
    threadId: z.string(),
    contextNote: z.string().nullable(),
    contextUsage: ContextUsageSchema.nullable(),
    contextDepth: ContextLadderDepthSchema,
    contextChapters: z.array(z.number().int().nonnegative()),
  }),
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

/** GET /api/settings response — secrets are masked ("***") if set, "" if unset.
 * M19 (decisions.md 2026-07-29 later): provider configuration moved out of
 * this flat bag into provider *profiles* + *roles* (below) — this schema now
 * covers only the settings that aren't about "which LLM answers what". */
export const SettingsSchema = z.object({
  vaultPath: z.string(),
  cursorStyle: CursorStyleSchema,
  cursorTrailEnabled: z.boolean(),
  spreadMode: SpreadModeSchema,
  readerMargin: ReaderMarginSchema,
  readerFontScale: ReaderFontScaleSchema,
  scanCrtIntensity: ScanCrtIntensitySchema,
  // Global request ceiling, applied regardless of which profile/role serves
  // the call — not part of a profile (SPEC: a profile is "provider id,
  // model, key, base URL, context tokens").
  maxResponseTokens: z.number().int().positive(),
  // M17 "pre-flight before committing": 0 = no ceiling (default) — a digest
  // run whose pre-flight estimate exceeds this many input tokens is
  // refused rather than started.
  digestTokenBudget: z.number().int().nonnegative(),
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
// Provider profiles & roles (M19 — docs/decisions.md 2026-07-29 later)
// ---------------------------------------------------------------------------

/** The two named roles: "query" answers questions while reading; "digest"
 * covers batch analysis (the digest, and later the thematic scan / cast).
 * Roles point at profiles, not the other way around. */
export const ProviderRoleSchema = z.enum(["query", "digest"]);
export type ProviderRole = z.infer<typeof ProviderRoleSchema>;

/** A complete, named provider config. Secrets masked on the wire, same
 * "***"-means-unchanged convention as Settings. */
export const ProviderProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: LLMProviderIdSchema,
  anthropicModel: z.string(),
  anthropicApiKey: z.string(), // masked
  claudeAgentModel: z.string(),
  openaiBaseUrl: z.string(),
  openaiModel: z.string(),
  openaiApiKey: z.string(), // masked
  openaiContextTokens: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

export const CreateProviderProfileBodySchema = z.object({
  name: z.string().min(1),
  provider: LLMProviderIdSchema,
  anthropicModel: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  claudeAgentModel: z.string().optional(),
  openaiBaseUrl: z.string().optional(),
  openaiModel: z.string().optional(),
  openaiApiKey: z.string().optional(),
  openaiContextTokens: z.number().int().positive().optional(),
});
export type CreateProviderProfileBody = z.infer<typeof CreateProviderProfileBodySchema>;

export const UpdateProviderProfileBodySchema = CreateProviderProfileBodySchema.partial();
export type UpdateProviderProfileBody = z.infer<typeof UpdateProviderProfileBodySchema>;

/** GET /api/provider-roles response: one entry per role, resolved to its
 * profile (or null — "a role with no configured profile degrades to the
 * same 'configure a provider' nudge the reader already shows"). */
export const ProviderRoleAssignmentSchema = z.object({
  role: ProviderRoleSchema,
  profileId: z.string().nullable(),
  profile: ProviderProfileSchema.nullable(),
  configured: z.boolean(),
});
export type ProviderRoleAssignment = z.infer<typeof ProviderRoleAssignmentSchema>;

export const ProviderRolesResponseSchema = z.array(ProviderRoleAssignmentSchema);
export type ProviderRolesResponse = z.infer<typeof ProviderRolesResponseSchema>;

export const SetProviderRoleBodySchema = z.object({
  profileId: z.string().nullable(),
});
export type SetProviderRoleBody = z.infer<typeof SetProviderRoleBodySchema>;

// ---------------------------------------------------------------------------
// Usage ledger summary (M19 Usage divider — reads M17's ledger, decisions.md
// 2026-07-28 later / 2026-07-29 later)
// ---------------------------------------------------------------------------

export const UsageOperationSchema = z.enum(["thread", "extract", "digest", "cast", "thematic"]);
export type UsageOperation = z.infer<typeof UsageOperationSchema>;

export const UsageProvenanceSchema = z.enum(["reported", "measured", "estimated", "mixed"]);
export type UsageProvenanceValue = z.infer<typeof UsageProvenanceSchema>;

export const UsageBreakdownRowSchema = z.object({
  resourceId: z.string().nullable(),
  resourceTitle: z.string().nullable(),
  operation: UsageOperationSchema,
  role: ProviderRoleSchema.nullable(), // null for pre-M19 ledger rows
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number().nullable(),
  provenance: UsageProvenanceSchema,
  callCount: z.number(),
});
export type UsageBreakdownRow = z.infer<typeof UsageBreakdownRowSchema>;

export const UsagePeriodSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number().nullable(),
  callCount: z.number(),
  provenance: UsageProvenanceSchema,
  byBookAndOperation: z.array(UsageBreakdownRowSchema),
});
export type UsagePeriod = z.infer<typeof UsagePeriodSchema>;

export const RolePlanLimitsSchema = z.object({
  role: ProviderRoleSchema,
  profileName: z.string().nullable(),
  provider: LLMProviderIdSchema.nullable(),
  /** null = provider doesn't report plan limits (e.g. every local model) —
   * the UI renders "plan limits unavailable", never a blank or an error. */
  windows: z
    .array(
      z.object({
        label: z.string(),
        utilization: z.number().nullable(),
        resetsAt: z.string().nullable(),
      }),
    )
    .nullable(),
  /** Local (openai-compatible) models show tokens/context%/speed instead of
   * quota UI — this flag is what the Usage divider branches on. */
  isLocal: z.boolean(),
  contextTokens: z.number().nullable(),
  /** From the most recent ledger row logged under this role — local models
   * have no quota API, so this is what "tokens, context percentage, and
   * speed" (TASKS.md M19) is built from. Null until this role has made a
   * call, or for a non-local role (the windows above cover it instead). */
  lastCall: z
    .object({
      tokensUsed: z.number(),
      contextPercent: z.number().nullable(),
      tokensPerSecond: z.number().nullable(),
      provenance: UsageProvenanceSchema,
    })
    .nullable(),
});
export type RolePlanLimits = z.infer<typeof RolePlanLimitsSchema>;

export const LastDigestUsageSchema = z.object({
  resourceId: z.string(),
  resourceTitle: z.string().nullable(),
  costUsd: z.number().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  provenance: UsageProvenanceSchema,
  createdAt: z.string(),
});
export type LastDigestUsage = z.infer<typeof LastDigestUsageSchema>;

export const UsageSummarySchema = z.object({
  today: UsagePeriodSchema,
  last7Days: UsagePeriodSchema,
  lastDigest: LastDigestUsageSchema.nullable(),
  planLimits: z.array(RolePlanLimitsSchema),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

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
// The book digest (M17 — docs/decisions.md 2026-07-28 later)
// ---------------------------------------------------------------------------

export const DigestChapterStatusSchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  /** Section label for LLM context purposes (`llm/context.ts` sectionLabel) —
   * not what the coverage tiles show; see `chapterNumber`/`startPercent`/
   * `lengthPercent` below for that. */
  label: z.string(),
  // M18 "chapter labels on the coverage tiles" (decisions.md 2026-07-29
  // later): "percent and chapter, never pages" — reflowable EPUBs have no
  // stable pages, and M16's text-size setting moves epub.js's page-ish
  // counts anyway. Same shape as ScanChapter (annotations/scan.ts) so the
  // frontend renders both with one formatting helper.
  chapterNumber: z.number().int().positive(),
  startPercent: z.number().min(0).max(1),
  lengthPercent: z.number().min(0).max(1),
  digested: z.boolean(),
  // M19.5 "chapter entries gate exactly" (decisions.md 2026-07-29 later):
  // summary/themes/characters/title are all null whenever `pastBookmark &&
  // !revealed` — redaction happens server-side (the content is never sent),
  // not just hidden client-side. `pastBookmark` and `revealed` are exposed
  // separately so the client can render a reveal control precisely when
  // there's something to reveal (digested && pastBookmark && !revealed).
  summary: z.string().nullable(),
  themes: z.array(z.string()),
  characters: z.array(z.string()),
  generatedAt: z.string().nullable(),
  // A short descriptive title from the digest's own map step — null when
  // never digested, or when digested but redacted (a descriptive title is a
  // spoiler too; the route redacts it the same way it would redact the
  // summary it came from). The positional fallback ("Chapter 7 · 34-39%")
  // is always derivable from the fields above, never gated.
  title: z.string().nullable(),
  pastBookmark: z.boolean(),
  /** True when this chapter's spoiler content is currently being shown
   * despite being past the bookmark — i.e. the reader explicitly revealed
   * it. Always true when `!pastBookmark` (nothing to reveal). */
  revealed: z.boolean(),
});
export type DigestChapterStatus = z.infer<typeof DigestChapterStatusSchema>;

export const BookDigestSchema = z.object({
  synopsis: z.string(),
  cast: z.array(z.object({ name: z.string(), description: z.string() })),
  themes: z.array(z.string()),
  generatedAt: z.string(),
});
export type BookDigestPayload = z.infer<typeof BookDigestSchema>;

export const DigestRunStatusSchema = z.enum([
  "running",
  "paused_rate_limit",
  "completed",
  "failed",
]);
export type DigestRunStatusValue = z.infer<typeof DigestRunStatusSchema>;

export const DigestRunPayloadSchema = z.object({
  spineStart: z.number().int().nonnegative(),
  spineEnd: z.number().int().nonnegative(),
  status: DigestRunStatusSchema,
  failedSpineIndices: z.array(z.number().int().nonnegative()),
  resumesAt: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.string(),
});
export type DigestRunPayload = z.infer<typeof DigestRunPayloadSchema>;

// M19.5 "book-level synopsis/cast/themes are reduces over everything
// digested, so they inherently spoil" (decisions.md 2026-07-29 later): the
// safe variant is a *second* reduce, built only from chapters up to the
// bookmark. `full` is only present once the reader has explicitly revealed
// it — same "never silently serve the spoiling version" rule as chapters.
export const BookDigestStatusSchema = z.object({
  /** Bookmark-bounded reduce — null only when the reader hasn't dug into
   * the book far enough yet for one to exist (decisions.md: generated
   * lazily, "only once the bookmark has moved far enough to matter"). */
  safe: BookDigestSchema.nullable(),
  /** The unrestricted reduce over every digested chapter — present only
   * once explicitly revealed (see the `reveal=book` query param). */
  full: BookDigestSchema.nullable(),
  /** True once `full` would differ from `safe` (the book has undigested-
   * past-bookmark chapters) — the client shows a reveal control exactly
   * when this is true and `full` hasn't been fetched yet. */
  hasMoreToReveal: z.boolean(),
});
export type BookDigestStatus = z.infer<typeof BookDigestStatusSchema>;

/** GET /api/resources/:id/digest response. */
export const DigestStatusSchema = z.object({
  totalChapters: z.number().int().nonnegative(),
  chapters: z.array(DigestChapterStatusSchema),
  book: BookDigestStatusSchema.nullable(),
  run: DigestRunPayloadSchema.nullable(),
});
export type DigestStatus = z.infer<typeof DigestStatusSchema>;

/** POST /api/resources/:id/digest body — the spotlight's chapter range. */
export const StartDigestBodySchema = z.object({
  spineStart: z.number().int().nonnegative(),
  spineEnd: z.number().int().nonnegative(),
});
export type StartDigestBody = z.infer<typeof StartDigestBodySchema>;

/** GET /api/resources/:id/digest/preflight response. */
export const DigestPreflightSchema = z.object({
  chapterCount: z.number().int().nonnegative(),
  estimatedInputTokens: z.number().int().nonnegative(),
  estimatedCalls: z.number().int().nonnegative(),
  tokenBudgetExceeded: z.boolean(),
  planLimits: z
    .object({
      windows: z.array(
        z.object({
          label: z.string(),
          utilization: z.number().nullable(),
          resetsAt: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
});
export type DigestPreflightPayload = z.infer<typeof DigestPreflightSchema>;

// ---------------------------------------------------------------------------
// M19.5 — the thematic layer & reader briefs (decisions.md 2026-07-29 later:
// "plot is fixed; thematic reading is personal and evolves as you read")
// ---------------------------------------------------------------------------

/** GET /api/resources/:id/brief response, and the shape embedded in
 * ThematicStatusSchema below so a chapter's analysis carries the brief it
 * was actually produced under, not just the resource's current one. */
export const BriefSchema = z.object({
  text: z.string(),
  updatedAt: z.string(),
});
export type Brief = z.infer<typeof BriefSchema>;

/** PUT /api/resources/:id/brief body. */
export const UpdateBriefBodySchema = z.object({
  text: z.string().max(4000),
});
export type UpdateBriefBody = z.infer<typeof UpdateBriefBodySchema>;

export const ThematicQuestionSchema = z.object({
  text: z.string(),
  /** Verbatim excerpt from the chapter — the client sends this straight
   * back to POST /api/resources/:id/chapter-anchor to open a real,
   * text-anchored thread on it. */
  quote: z.string(),
});
export type ThematicQuestion = z.infer<typeof ThematicQuestionSchema>;

export const ThematicChapterStatusSchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  analyzed: z.boolean(),
  analysis: z.string().nullable(),
  themes: z.array(z.string()),
  questions: z.array(ThematicQuestionSchema),
  /** The brief text this chapter's analysis was generated under — null
   * when never analyzed. Shown alongside the analysis per decisions.md:
   * "the brief in force is shown alongside the analysis it produced". */
  briefText: z.string().nullable(),
  /** True when the resource's *current* brief no longer matches the one
   * this analysis was generated under — never silently served as fresh. */
  stale: z.boolean(),
  generatedAt: z.string().nullable(),
  // Same spoiler-gating shape as DigestChapterStatusSchema — a thematic
  // reading and the questions it poses are just as spoiler-bearing as the
  // plot summary they sit next to.
  pastBookmark: z.boolean(),
  revealed: z.boolean(),
});
export type ThematicChapterStatus = z.infer<typeof ThematicChapterStatusSchema>;

/** GET /api/resources/:id/thematic response. Reuses DigestRunPayloadSchema's
 * shape for `run` — a thematic run has the same lifecycle fields as a plot
 * run; only the brief it ran under (server-internal) differs. */
export const ThematicStatusSchema = z.object({
  brief: BriefSchema,
  chapters: z.array(ThematicChapterStatusSchema),
  run: DigestRunPayloadSchema.nullable(),
});
export type ThematicStatus = z.infer<typeof ThematicStatusSchema>;

/** POST /api/resources/:id/thematic body — same shape as starting a plot
 * digest run, reused rather than duplicated. */
export const StartThematicDigestBodySchema = StartDigestBodySchema;
export type StartThematicDigestBody = StartDigestBody;

/** POST /api/resources/:id/chapter-anchor body — turns a posed question's
 * verbatim quote into a real highlight (decision 11: the model returns
 * text, code locates it). Response is a plain Highlight. */
export const CreateChapterAnchorBodySchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  quote: z.string(),
});
export type CreateChapterAnchorBody = z.infer<typeof CreateChapterAnchorBodySchema>;

// ---------------------------------------------------------------------------
// The context ladder (M17 — "the brain button")
// ---------------------------------------------------------------------------

export const UpdateContextLadderBodySchema = z.object({
  depth: ContextLadderDepthSchema,
});
export type UpdateContextLadderBody = z.infer<typeof UpdateContextLadderBodySchema>;

// ---------------------------------------------------------------------------
// Generic error envelope
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
