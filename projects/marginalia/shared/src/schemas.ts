import { z } from "zod";

/**
 * Shared zod schemas + inferred types for the HTTP boundary between
 * server and web. Mirrors the SQLite data model in docs/marginalia/SPEC.md —
 * keep both in sync when either changes.
 */

// ---------------------------------------------------------------------------
// LLM provider identity — hoisted above every schema that references it
// (Message's provenance byline, provider profiles, the usage ledger).
// ---------------------------------------------------------------------------

export const LLMProviderIdSchema = z.enum([
  "anthropic",
  "openai-compatible",
  "claude-agent",
  "codex-cli",
]);
export type LLMProviderId = z.infer<typeof LLMProviderIdSchema>;

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
// Cached epub.js locations blob (M19.6 "page numbers, book-wide and stable")
// ---------------------------------------------------------------------------

/** GET /api/resources/:id/locations response. The server never parses this —
 * epub.js is a web/-only dependency (SPEC: the server has no EPUB renderer)
 * — so `locations` stays whatever `book.locations.save()` produced. */
export const ResourceLocationsSchema = z.object({
  locations: z.string().nullable(),
});
export type ResourceLocationsResponse = z.infer<typeof ResourceLocationsSchema>;

export const UpdateResourceLocationsBodySchema = z.object({
  locations: z.string().min(1),
});
export type UpdateResourceLocationsBody = z.infer<
  typeof UpdateResourceLocationsBodySchema
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

/**
 * Which of Define's two paths answered (M30 C, decisions.md 2026-08-24).
 * Rendered to the reader, not merely logged: "what the dictionary says" and
 * "what this book seems to mean by it" are different claims and must never
 * look alike. `""` is the fourth state — no definition on this highlight,
 * which is every highlight that wasn't created by Define.
 */
export const DefinitionSourceSchema = z.enum(["", "dictionary", "digest"]);
export type DefinitionSource = z.infer<typeof DefinitionSourceSchema>;

/**
 * M35 §C5: who proposed this highlight — the reader themself (clicking to
 * select text, or a posed question they clicked through), or the thematic
 * pass proposing evidence for a theme with no reader action at all. Never
 * inferred from `kind` (settled decision 16: a kind's slot is its identity,
 * not a proxy for authorship) — this is a second, orthogonal axis, the same
 * shape `anchor_source` and `definition_source` already are on this row.
 */
export const HighlightOriginSchema = z.enum(["reader", "thematic"]);
export type HighlightOrigin = z.infer<typeof HighlightOriginSchema>;

export const HighlightSchema = AnchorSchema.extend({
  id: z.string(), // uuid v4
  resourceId: z.string(),
  kind: HighlightKindSchema,
  origin: HighlightOriginSchema,
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
  // M19.6 "annotations are resizable": null means "use the panel's default
  // size" (the CSS `min(340px, ...)` cap) — never a magic 0, which would
  // mean an invisible panel.
  panelWidth: z.number().nullable(),
  panelHeight: z.number().nullable(),
  // M30 C: the Define lookup's answer, living on the highlight it was looked
  // up for. Empty string (never null) means "no definition" — which is what
  // makes M30 D's glossary a one-predicate filter over this table rather
  // than a table of its own. See migration 26.
  definition: z.string(),
  definitionSource: DefinitionSourceSchema,
  createdAt: z.string(),
});
export type Highlight = z.infer<typeof HighlightSchema>;

/**
 * The answer to one Define (M30 C). `source: ""` with an empty `definition`
 * is the **designed empty state**, not an error: the dictionary missed and
 * either no provider is configured or its answer came back empty. The route
 * returns 200 for it, so the reader gets "no definition found" rather than a
 * failure toast — and `reason` says which of those two happened, because
 * "this word isn't in the dictionary" and "you have no provider configured"
 * ask the reader for different things.
 */
export const DefinitionSchema = z.object({
  /** The headword actually defined — differs from the selection when
   * morphology resolved it ("running" -> "run"), and is shown for exactly
   * that reason. Empty on a miss. */
  headword: z.string(),
  definition: z.string(),
  source: DefinitionSourceSchema,
  /** Human-facing provenance line: "WordNet 3.1", or the book's own title
   * for a digest-grounded answer. */
  attribution: z.string(),
  /** Only meaningful when `source` is "" — why nothing came back.
   * M30 E feedback: `dictionary_miss` is a fourth, non-final state — the
   * dictionary came back empty but a provider is configured, so the reader
   * gets asked before a call is made, rather than the digest fallback
   * running automatically. `not_found` is what a *deepen* attempt returns
   * when even that comes back empty. */
  reason: z.enum(["", "not_a_term", "no_provider", "not_found", "dictionary_miss"]),
});
export type Definition = z.infer<typeof DefinitionSchema>;

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

export const UpdateHighlightPanelSizeBodySchema = z.object({
  panelWidth: z.number(),
  panelHeight: z.number(),
});
export type UpdateHighlightPanelSizeBody = z.infer<
  typeof UpdateHighlightPanelSizeBodySchema
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
  /** M30 E1: how many messages a delete is about to take with it — the
   * acceptance criterion is naming the count, not just "this has a
   * thread". */
  messageCount: z.number().int().nonnegative(),
});
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;

/** GET /api/resources/:id/highlights response shape (SPEC: "+ their thread summaries"). */
export const HighlightWithThreadSchema = HighlightSchema.extend({
  thread: ThreadSummarySchema.nullable(),
  /** M35 §D3: set only when this highlight is a *non-primary* anchor of
   * someone else's thread (`thread_anchors`, migration 34) — names that
   * thread's primary highlight, the one `thread` above would be populated
   * on. Null for an ordinary highlight and for a primary highlight itself
   * (which already has `thread` for that). The client resolves through this
   * before opening a panel, so clicking any anchor opens the one real
   * annotation rather than starting a second, unrelated thread. */
  primaryHighlightId: z.string().nullable(),
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

/** M22.5 H: "which model actually answered, and what it really cost" — a
 * quiet byline under each assistant message, derived from that message's
 * own `llm_usage` row (never from whatever the settings UI currently
 * holds — a profile can be renamed or reconfigured after the fact). Null
 * for user messages and for messages predating the M22.5 migration that
 * added `llm_usage.message_id` (no row to join). */
export const MessageProvenanceSchema = z.object({
  profileName: z.string().nullable(),
  provider: LLMProviderIdSchema.nullable(),
  /** What the endpoint actually served, when known — never the model a
   * message merely *claims* to be (decisions.md 2026-08-04: "the model is
   * not a source of truth about itself"). */
  model: z.string().nullable(),
  endpointHost: z.string().nullable(),
});
export type MessageProvenance = z.infer<typeof MessageProvenanceSchema>;

export const MessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  provenance: MessageProvenanceSchema.nullable(),
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
  // M34 §D "transparency keeps up": which chapters' *thematic* essays (§C's
  // narrower, ranked selection) fed this answer — distinct from
  // contextChapters' plot-digest chapters, since §C made that grounding
  // narrower and variable. Always [] outside the digest rung.
  contextThematicChapters: z.array(z.number().int().nonnegative()),
  // M34 §D: whether the lookahead/spoilers mask (§B5) was on when this
  // answer was produced. Null means a pre-M34 message with no recorded
  // state, matching contextDepth's own null-means-unrecorded shape.
  contextMasked: z.boolean().nullable(),
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

/** M35 §D1/§D4: one of a thread's (possibly several) anchors, resolved
 * enough for the reader to see and jump to it — the quote and the chapter
 * it's in — without a second highlight fetch. Reading order (spine index,
 * then in-chapter offset), not creation order. */
export const ThreadAnchorSchema = z.object({
  highlightId: z.string(),
  exact: z.string(),
  spineIndex: z.number().int().nonnegative(),
});
export type ThreadAnchor = z.infer<typeof ThreadAnchorSchema>;

/** GET /api/threads/:id/anchors response. Always at least one entry for a
 * thread that exists — every thread has a primary anchor. */
export const ThreadAnchorsResponseSchema = z.object({
  anchors: z.array(ThreadAnchorSchema),
});
export type ThreadAnchorsResponse = z.infer<typeof ThreadAnchorsResponseSchema>;

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
    // M34 §D: paired with contextChapters above — see MessageSchema.
    contextThematicChapters: z.array(z.number().int().nonnegative()),
    contextMasked: z.boolean(),
    // M22.5 H: computed server-side from the same usage-ledger row
    // `contextUsage` reads, so the reader's byline needs no extra round
    // trip — a client-constructed message from `onDone` alone can show it
    // immediately, matching what a page reload would later show.
    provenance: MessageProvenanceSchema.nullable(),
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

/** M20 step 3 "the reader picks the transition" (decisions.md 2026-08-03):
 * how a page turn animates. **A ceiling, not a mode switch** — the existing
 * fallback ladder (reduced motion → instant, low fps → slide, failed capture
 * → slide) still runs underneath, so "curl" means "curl if this machine and
 * this capture can" and "slide" means "never curl". Nothing may promote a
 * turn *up* to the curl. Defaults to "slide": the curl is the strong,
 * expensive effect, and reading comes first. */
export const PageTransitionSchema = z.enum(["curl", "slide"]);
export type PageTransition = z.infer<typeof PageTransitionSchema>;

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

/** M19.6 "page numbers, book-wide and stable" (decisions.md 2026-07-30):
 * "book" numbers off `book.locations` (stable across font size, margin,
 * spread — see PageNumberDisplay/useBookLocations); "chapter" uses
 * `location.start.displayed`, already received; "off" is today's default
 * (unchanged until a reader opts in, same convention as readerMargin etc). */
export const PageNumberModeSchema = z.enum(["book", "chapter", "off"]);
export type PageNumberMode = z.infer<typeof PageNumberModeSchema>;

/** M19.6 "the reading pane is resizable" (decisions.md 2026-07-30 later):
 * the pane's *outer* measure (`--reader-max-width` in ReaderView.module.css)
 * as a drag-set pixel width, layered on top of — not replacing — the
 * spread-mode default (single/auto/fullscreen), the same way readerMargin
 * is a proportion *inside* it rather than a fourth independent knob. `0` is
 * the "unset, use the spread-mode default" sentinel (same convention as
 * digestTokenBudget's "0 = no ceiling"), not a real width — the client
 * clamps any real drag to a sane [480, 1800] range. */
export const ReaderPaneWidthSchema = z.number().int().min(0).max(1800);
export type ReaderPaneWidth = z.infer<typeof ReaderPaneWidthSchema>;

/** M21 (AUDIO.md "Settings additions"): only "kokoro" exists today — the
 * type still names it rather than inlining `z.string()`, the same reason
 * `TTSEngine.id` is a literal in the seam itself, so a second engine later
 * is a widened enum, not a shape change. */
export const TTSEngineIdSchema = z.enum(["kokoro"]);
export type TTSEngineId = z.infer<typeof TTSEngineIdSchema>;

export const AudioSettingsSchema = z.object({
  ttsEngine: TTSEngineIdSchema,
  ttsModelPath: z.string(),
  audioDefaultVoice: z.string(),
  audioAutoTurnPages: z.boolean(),
});
export type AudioSettings = z.infer<typeof AudioSettingsSchema>;

/** GET /api/settings response — secrets are masked ("***") if set, "" if unset.
 * M19 (decisions.md 2026-07-29 later): provider configuration moved out of
 * this flat bag into provider *profiles* + *roles* (below) — this schema now
 * covers only the settings that aren't about "which LLM answers what". */
export const SettingsSchema = z.object({
  vaultPath: z.string(),
  cursorStyle: CursorStyleSchema,
  cursorTrailEnabled: z.boolean(),
  spreadMode: SpreadModeSchema,
  pageTransition: PageTransitionSchema,
  readerMargin: ReaderMarginSchema,
  readerFontScale: ReaderFontScaleSchema,
  scanCrtIntensity: ScanCrtIntensitySchema,
  pageNumberMode: PageNumberModeSchema,
  readerPaneWidth: ReaderPaneWidthSchema,
  // M17 "pre-flight before committing": 0 = no ceiling (default) — a digest
  // run whose pre-flight estimate exceeds this many input tokens is
  // refused rather than started.
  digestTokenBudget: z.number().int().nonnegative(),
  // M30 A (decisions.md 2026-08-24, settled decision 16): the label is a
  // setting, the hue is not — rose|sage|honey|slate stay the permanent
  // stored slots. An empty string means "unset"; store.ts deletes the row
  // rather than persisting "" so the DEFAULTS merge falls back to the
  // default name instead of a blank label.
  kindLabelRose: z.string(),
  kindLabelSage: z.string(),
  kindLabelHoney: z.string(),
  kindLabelSlate: z.string(),
}).merge(AudioSettingsSchema);
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

/**
 * POST /api/highlights/:id/definition/deepen body — M30 E feedback. The
 * reader picked "look deeper" and, optionally, which configured role's
 * model should answer (same two roles Settings already exposes; there is no
 * per-call model catalog beyond that). Defaults to "query" — today's
 * automatic-fallback role — when omitted.
 */
export const DefineDeepenBodySchema = z.object({
  role: ProviderRoleSchema.optional(),
});
export type DefineDeepenBody = z.infer<typeof DefineDeepenBodySchema>;

/**
 * SSE contract for the deepen stream: a `step` event per real stage of work
 * (dictionary/define.ts narrates what it is actually doing — searching the
 * text, reading occurrences, asking the model — never a fabricated
 * chain-of-thought), then `text` chunks as the answer composes, then one
 * `done` with the final `Definition`, or `error`. Mirrors
 * `ThreadStreamEventSchema`'s shape on purpose — same client-side dispatch
 * pattern (streamThread.ts / streamDefine.ts).
 */
export const DefineStreamEventSchema = z.union([
  z.object({ step: z.string() }),
  z.object({ text: z.string() }),
  z.object({ done: z.literal(true), definition: DefinitionSchema }),
  z.object({ error: z.string() }),
]);
export type DefineStreamEvent = z.infer<typeof DefineStreamEventSchema>;

/** A complete, named provider config. Secrets masked on the wire, same
 * "***"-means-unchanged convention as Settings. */
export const ProviderProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: LLMProviderIdSchema,
  anthropicModel: z.string(),
  anthropicApiKey: z.string(), // masked
  claudeAgentModel: z.string(),
  codexModel: z.string(),
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
  codexModel: z.string().optional(),
  openaiBaseUrl: z.string().optional(),
  openaiModel: z.string().optional(),
  openaiApiKey: z.string().optional(),
  openaiContextTokens: z.number().int().positive().optional(),
});
export type CreateProviderProfileBody = z.infer<typeof CreateProviderProfileBodySchema>;

export const UpdateProviderProfileBodySchema = CreateProviderProfileBodySchema.partial();
export type UpdateProviderProfileBody = z.infer<typeof UpdateProviderProfileBodySchema>;

// M19.7 "response length is per role" (decisions.md 2026-07-30 "the global
// overhaul"): a role's max response length used to live on the flat
// Settings bag (one value for both roles); one profile can serve both
// roles, so a per-profile length couldn't express "same model, longer
// digests" — it belongs to the role, not the profile.
export const MAX_RESPONSE_TOKENS_MIN = 250;
export const MAX_RESPONSE_TOKENS_MAX = 10_000;
export const MaxResponseTokensSchema = z
  .number()
  .int()
  .min(MAX_RESPONSE_TOKENS_MIN)
  .max(MAX_RESPONSE_TOKENS_MAX);

/** GET /api/provider-roles response: one entry per role, resolved to its
 * profile (or null — "a role with no configured profile degrades to the
 * same 'configure a provider' nudge the reader already shows"). */
export const ProviderRoleAssignmentSchema = z.object({
  role: ProviderRoleSchema,
  profileId: z.string().nullable(),
  profile: ProviderProfileSchema.nullable(),
  configured: z.boolean(),
  maxResponseTokens: MaxResponseTokensSchema,
});
export type ProviderRoleAssignment = z.infer<typeof ProviderRoleAssignmentSchema>;

export const ProviderRolesResponseSchema = z.array(ProviderRoleAssignmentSchema);
export type ProviderRolesResponse = z.infer<typeof ProviderRolesResponseSchema>;

export const SetProviderRoleBodySchema = z.object({
  profileId: z.string().nullable(),
});
export type SetProviderRoleBody = z.infer<typeof SetProviderRoleBodySchema>;

/** PUT /api/provider-roles/:role/max-response-tokens. Both `claude-agent`
 * and `codex-cli` can't enforce this as a hard ceiling — it's a request in
 * the system prompt (decisions.md 2026-07-28 later) — the settings UI keeps
 * saying so next to the field regardless of which provider the role
 * currently points at. */
export const SetMaxResponseTokensBodySchema = z.object({
  maxResponseTokens: MaxResponseTokensSchema,
});
export type SetMaxResponseTokensBody = z.infer<typeof SetMaxResponseTokensBodySchema>;

// ---------------------------------------------------------------------------
// Provider sign-in (M26 lead-in, 2026-08-25 decisions.md): an in-app "Sign
// in" flow that spawns the same CLI login command an operator would run in a
// terminal (`codex login --device-auth`, `claude auth login`) rather than
// reimplementing OAuth — credentials still land wherever that CLI already
// keeps them (`~/.codex/`, `~/.claude/`), outside the repo. Separate from
// ProviderProfile: signing in is a machine-level action, not tied to one
// named profile/model.
// ---------------------------------------------------------------------------

export const ProviderAuthProviderSchema = z.enum(["codex", "claude"]);
export type ProviderAuthProvider = z.infer<typeof ProviderAuthProviderSchema>;

export const ProviderAuthStatusSchema = z.object({
  provider: ProviderAuthProviderSchema,
  loggedIn: z.boolean(),
  /** A human-readable detail line when known (e.g. an account email) — never
   * required for `loggedIn` to be trustworthy. */
  detail: z.string().nullable(),
});
export type ProviderAuthStatus = z.infer<typeof ProviderAuthStatusSchema>;

export const ProviderAuthFlowStatusSchema = z.enum([
  "starting",
  "waiting",
  "success",
  "error",
  "cancelled",
]);
export type ProviderAuthFlowStatus = z.infer<typeof ProviderAuthFlowStatusSchema>;

export const ProviderAuthFlowStateSchema = z.object({
  flowId: z.string(),
  status: ProviderAuthFlowStatusSchema,
  /** Parsed best-effort from the CLI's own stdout — null until (if ever)
   * the flow's shape yields one. `lines` is the raw, ANSI-stripped output as
   * a fallback the UI can always fall back to showing verbatim. */
  verificationUrl: z.string().nullable(),
  code: z.string().nullable(),
  lines: z.array(z.string()),
  message: z.string().nullable(),
});
export type ProviderAuthFlowState = z.infer<typeof ProviderAuthFlowStateSchema>;

/**
 * What the Settings setup guide knows about one CLI on *this* machine
 * (decisions.md 2026-08-26). Read-only diagnostics: never credentials, only
 * whether the executable was found, where, and what to do when it wasn't.
 * Exists because "it's installed though" and "the server can see it" are two
 * different facts, and only the second one makes the app work.
 */
export const ProviderCliDiagnosticsSchema = z.object({
  provider: ProviderAuthProviderSchema,
  /** The command name, e.g. "codex". */
  bin: z.string(),
  /** Absolute path we will actually spawn, or null when nothing was found. */
  path: z.string().nullable(),
  /** First line of `--version`, when the binary was found and answered. */
  version: z.string().nullable(),
  /** Where we looked — populated only when `path` is null, so a "not found"
   * is inspectable rather than a shrug. */
  searchedDirs: z.array(z.string()),
  /** The env var that overrides the search outright. */
  overrideEnvVar: z.string(),
  overrideActive: z.boolean(),
  installCommand: z.string(),
  installUrl: z.string(),
  /** The subscription/plan this provider needs — the requirement that isn't
   * an API key and therefore isn't obvious. */
  requires: z.string(),
});
export type ProviderCliDiagnostics = z.infer<typeof ProviderCliDiagnosticsSchema>;

// ---------------------------------------------------------------------------
// Usage ledger summary (M19 Usage divider — reads M17's ledger, decisions.md
// 2026-07-28 later / 2026-07-29 later)
// ---------------------------------------------------------------------------

export const UsageOperationSchema = z.enum([
  "thread",
  "extract",
  "digest",
  "cast",
  "thematic",
  "theme-distillation",
  // M30 C: Define's digest-rung fallback. Its own tag rather than "thread" —
  // it is the one operation with a hard product cap on output length, and
  // folding it into threads would hide both that it is cheap and that a book
  // is being defined at rather than discussed.
  "define",
]);
export type UsageOperation = z.infer<typeof UsageOperationSchema>;

export const UsageProvenanceSchema = z.enum(["reported", "measured", "estimated", "mixed"]);
export type UsageProvenanceValue = z.infer<typeof UsageProvenanceSchema>;

/** M22.5 H: "the one cost the ledger reports is the one you are not billed
 * for" — `costUsd` alone can't say whether it's real spend. `billed` is the
 * keyed Anthropic API (genuinely charged); `notional` is the Claude Agent
 * SDK subscription's own "what this would have cost on the API" figure
 * (never charged); `none` is a local model (openai-compatible), which is
 * actually free; `unpriced` is a keyed call whose model isn't in the
 * pricing table — real money, deliberately not guessed at. `mixed` appears
 * only on a rolled-up group spanning more than one basis. */
export const UsageCostBasisSchema = z.enum(["billed", "notional", "none", "unpriced", "mixed"]);
export type UsageCostBasis = z.infer<typeof UsageCostBasisSchema>;

/** M22.5 H1: which of the two strings a ledger row's `model` is — the
 * endpoint's own echoed value, or (when it didn't echo one, or the
 * provider is Anthropic-first-party/subscription, which don't substitute)
 * the profile's configured string. */
export const UsageModelSourceSchema = z.enum(["endpoint", "configured"]);
export type UsageModelSource = z.infer<typeof UsageModelSourceSchema>;

export const UsageBreakdownRowSchema = z.object({
  resourceId: z.string().nullable(),
  resourceTitle: z.string().nullable(),
  operation: UsageOperationSchema,
  role: ProviderRoleSchema.nullable(), // null for pre-M19 ledger rows
  // M22.5 H5: "is this local?" needs the profile, not just the provider id
  // (`openai-compatible` covers both a local Ollama and a hosted
  // OpenRouter) — null for pre-M22.5 rows and rows whose profile was since
  // deleted, both grouped as "unknown profile" rather than guessed at.
  provider: LLMProviderIdSchema.nullable(),
  model: z.string().nullable(),
  profileId: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  /** M34 §A7: tokens spent writing this group's cache entries, when the
   * provider reported them. */
  cacheCreationTokens: z.number(),
  /** Sum of `duration_ms` across the group — with `outputTokens`, this is
   * what a local model's tokens/sec is computed from (M22.5 H5). */
  durationMs: z.number(),
  costUsd: z.number().nullable(),
  costBasis: UsageCostBasisSchema,
  provenance: UsageProvenanceSchema,
  callCount: z.number(),
});
export type UsageBreakdownRow = z.infer<typeof UsageBreakdownRowSchema>;

export const UsagePeriodSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  /** M22.5 H4: the total sums *billed* spend only — notional (subscription)
   * and unpriced/free amounts never get added into it, so a subscription-
   * only week reads as $0.00 rather than a phantom charge. */
  billedCostUsd: z.number(),
  notionalCostUsd: z.number(),
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
  // M19.5 "the semantic scan: two layers" (decisions.md 2026-07-29 later):
  // the Mine layer's theme signal, from the extract pass in
  // server/src/digest/themeTagging.ts — a *model proposal* filtered to the
  // book's fixed theme vocabulary, kept in its own table/field from the
  // reader-authored `tags` above, never merged with them.
  themes: z.array(z.string()),
  note: z.string(),
  positionPercent: z.number().min(0).max(1).nullable(),
  threadId: z.string().nullable(),
  hasAnswer: z.boolean(),
  threadMessageCount: z.number().int().nonnegative(),
  threadFirstLine: z.string().nullable(),
});
export type ScanHighlight = z.infer<typeof ScanHighlightSchema>;

/**
 * One chapter's contribution to the scan's **Book** layer (decisions.md
 * 2026-07-29 later: "themes from chapter digests", chapter resolution,
 * "where does this book talk about X"). `themes` is empty and `hasThematic`
 * is false both when the chapter has no thematic analysis yet *and* when it
 * does but sits past the reader's bookmark — spoiler-gated the same way
 * DigestChapterStatusSchema's chapter entries are, extended to this surface
 * since a chapter-level theme label ("betrayal") is exactly the kind of
 * spoiler M19.5 exists to gate.
 */
/**
 * M35 §E: a theme's sub-chapter span, once its two endpoint sentences have
 * both located, keep their order, sit inside the chapter and don't cover so
 * much of it that "zone" would be a stretch (see `themeZones.ts`'s four
 * checks) — a chapter-relative `startPercent`/`lengthPercent` pair (same
 * book-wide-percent units as `ScanChapter`'s own fields, not chapter-local
 * ones, so it composes with the strip's existing fraction math for free).
 * `startQuote` is the *located* exact substring (never the model's raw
 * text — typographic drift already survived `locateQuoteAnchor`'s own
 * folding, and this is what a click hands the reader's find bar for a
 * literal-substring jump, reusing that path rather than a second one).
 */
export const ScanThemeZoneSchema = z.object({
  name: z.string(),
  startPercent: z.number().min(0).max(1),
  lengthPercent: z.number().min(0).max(1),
  startQuote: z.string(),
});
export type ScanThemeZone = z.infer<typeof ScanThemeZoneSchema>;

export const ScanBookChapterSchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  hasThematic: z.boolean(),
  themes: z.array(z.string()),
  /** M35 §E3: themes whose zone survived all four checks — a subset of
   * `themes` by name. A theme absent here still renders as today's
   * chapter-wide band; one present here renders *only* at its own precise
   * span (§E3's "both at once, in the same view" is across themes in a
   * chapter, not a theme drawn twice). */
  themeZones: z.array(ScanThemeZoneSchema),
});
export type ScanBookChapter = z.infer<typeof ScanBookChapterSchema>;

/**
 * One book-level theme (M24.5, "themes worth colouring") as this book sees
 * it: a canonical identity shared library-wide (`id`, `name`, `colorIndex`
 * — an index into `--theme-ramp-*`, theme.css) plus which of *this* book's
 * chapter-level theme strings distil under it. Empty `children` is legal —
 * a book-level theme with no chapters currently assigned to it just isn't
 * shown expanded.
 */
export const ScanBookThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  colorIndex: z.number().int().nonnegative(),
  children: z.array(z.string()),
});
export type ScanBookTheme = z.infer<typeof ScanBookThemeSchema>;

/**
 * ⚠️ Never merge with the Mine layer's data — the Book layer is chapter-
 * resolution, quantized, and must read as visually distinct from Mine's
 * exact-position bands (decisions.md 2026-07-29 later). `hasDigest` false
 * means "fall back to kind mode with an explanation, not an empty strip".
 */
export const ScanBookLayerSchema = z.object({
  hasDigest: z.boolean(),
  /** The one theme vocabulary shared with the Mine layer's `themes` field —
   * union of every (unredacted) chapter's thematic themes, for the scan's
   * theme filter UI. */
  themeVocabulary: z.array(z.string()),
  /** M24.5's distilled ~6-8 book-level themes, colour-keyed. Empty when no
   * distillation pass has run yet — the Scan's filter falls back to the flat
   * `themeVocabulary` dropdown above in that case, same as it does when
   * `hasDigest` is false. */
  bookThemes: z.array(ScanBookThemeSchema),
  chapters: z.array(ScanBookChapterSchema),
});
export type ScanBookLayer = z.infer<typeof ScanBookLayerSchema>;

export const ScanDataSchema = z.object({
  resource: ResourceSchema,
  totalHighlights: z.number().int().nonnegative(),
  lastReadAt: z.string().nullable(),
  chapters: z.array(ScanChapterSchema),
  highlights: z.array(ScanHighlightSchema),
  book: ScanBookLayerSchema,
});
export type ScanData = z.infer<typeof ScanDataSchema>;

// ---------------------------------------------------------------------------
// Search (M24 — "one result set, two views", docs/decisions.md 2026-08-14)
// ---------------------------------------------------------------------------

/**
 * Where a hit was found. `"text"` is a literal occurrence in the book's own
 * prose; `"highlight" | "note" | "thread"` are annotation hits, anchored not
 * to the query's own position (a note/thread body isn't book text) but to
 * the highlight they belong to — the same anchor the highlight already
 * carries, arriving by a different route (SPEC.md "Search notes (M24)").
 */
export const SearchHitSourceSchema = z.enum(["text", "highlight", "note", "thread"]);
export type SearchHitSource = z.infer<typeof SearchHitSourceSchema>;

/**
 * How a query matches (TASKS.md M24.1 C): `"word"` — whole words only, the
 * default — or `"substring"`, the raw scan this started as, kept as an
 * explicit choice rather than as the silent behaviour. The rule itself is
 * `textSearch.ts`; this is only its name on the wire.
 */
export const SearchMatchModeSchema = z.enum(["word", "substring"]);
export type SearchMatchMode = z.infer<typeof SearchMatchModeSchema>;

export const SearchHitSchema = z.object({
  source: SearchHitSourceSchema,
  spineIndex: z.number().int().nonnegative(),
  // Char offset local to its section's own text (the domain `resource_text`
  // stores), not a global book offset — matches what `rangeFromTextOffsets`
  // expects when re-resolving the anchor against a live rendered section.
  offset: z.number().int().nonnegative(),
  percent: z.number().min(0).max(1),
  snippet: z.string(),
  anchor: z.object({ prefix: z.string(), exact: z.string(), suffix: z.string() }),
  highlightId: z.string().nullable(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

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
  // The EPUB's own NCX chapter title, same field ScanChapterSchema already
  // carries — unlike `title` above, never gated on `digested`/`revealed`:
  // it's the book's own published table of contents, not digest output, so
  // it isn't a spoiler in the sense that gate exists for. Lets an
  // undigested (or not-yet-revealed) chapter still show its real name
  // instead of a bare "Chapter 7" placeholder (found live 2026-08-23: a
  // section the digest hadn't reached yet had no name at all, even though
  // the book's own TOC already names it and the Scan's chapter dial shows
  // that exact name for the same section).
  tocTitle: z.string().nullable(),
  pastBookmark: z.boolean(),
  /** True when this chapter's spoiler content is currently being shown
   * despite being past the bookmark — i.e. the reader explicitly revealed
   * it. Always true when `!pastBookmark` (nothing to reveal). */
  revealed: z.boolean(),
});
export type DigestChapterStatus = z.infer<typeof DigestChapterStatusSchema>;

// M22 (AUDIO.md "Casting"): the digest's book-level reduce step is pass 1 of
// the audio cast scan — decisions.md 2026-07-28 ("it *is* pass 1 of the
// audio cast scan. Do not build a second scanner for casting"). These are
// the character fields the reduce step must produce; distinct from
// `CastCharacterGenderSchema`'s neighbour `VoiceGenderSchema` above because
// a character's gender (as written) and a voice's gender (as synthesized)
// are different axes that happen to share three of four values.
export const CastCharacterGenderSchema = z.enum(["female", "male", "unknown"]);
export type CastCharacterGender = z.infer<typeof CastCharacterGenderSchema>;

export const CastAgeHintSchema = z.enum(["child", "young", "adult", "old", "unknown"]);
export type CastAgeHint = z.infer<typeof CastAgeHintSchema>;

export const CastLineCountHintSchema = z.enum(["many", "few"]);
export type CastLineCountHint = z.infer<typeof CastLineCountHintSchema>;

/** One character as the digest reduce step (and only the reduce step)
 * produces it — no voice assignment yet, that's code's job (AUDIO.md
 * "Voice assignment is code, not the model"). */
export const DigestCastCharacterSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  gender: CastCharacterGenderSchema,
  ageHint: CastAgeHintSchema,
  description: z.string(),
  lineCountHint: CastLineCountHintSchema,
});
export type DigestCastCharacter = z.infer<typeof DigestCastCharacterSchema>;

export const BookDigestSchema = z.object({
  synopsis: z.string(),
  cast: z.array(DigestCastCharacterSchema),
  /** Informational only — voice assignment matches gender against real
   * `Voice`s but has no age signal to match `ageHint` against (kokoro's
   * voice metadata carries no age dimension), so this and `ageHint` above
   * are surfaced for the casting UI, not consumed by `assignVoices`. */
  narratorGender: CastCharacterGenderSchema,
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
  /** M35 §C2: names the theme (by `ThematicTheme.name`) this question is
   * evidence for, or null/absent when it isn't about a listed theme. */
  theme: z.string().nullable().optional(),
});
export type ThematicQuestion = z.infer<typeof ThematicQuestionSchema>;

/** M35 §C1: a theme carries its own verbatim evidence rather than being a
 * bare name — 1-3 quotes located in the chapter text server-side. */
export const ThematicThemeSchema = z.object({
  name: z.string(),
  quotes: z.array(z.string()),
});
export type ThematicTheme = z.infer<typeof ThematicThemeSchema>;

export const ThematicChapterStatusSchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  analyzed: z.boolean(),
  analysis: z.string().nullable(),
  themes: z.array(ThematicThemeSchema),
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
 * text, code locates it). `text` is the posed question's own text (not the
 * quote) — M35 §B2 needs it to seed a chapter-level question when the quote
 * can't be located, so it always travels with the quote now rather than
 * being dropped at the client. */
export const CreateChapterAnchorBodySchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  quote: z.string(),
  text: z.string(),
});
export type CreateChapterAnchorBody = z.infer<typeof CreateChapterAnchorBodySchema>;

// ---------------------------------------------------------------------------
// M32 B — a chapter-level question of your own (no passage to anchor to, so
// this isn't a highlight — see chapter_questions in migrations.ts). One row
// per chapter: `question` is the reader's own prompt, `note` is the
// answer-space, autosaved the same way a highlight's note is.
// ---------------------------------------------------------------------------

export const ChapterQuestionSchema = z.object({
  resourceId: z.string(),
  spineIndex: z.number().int().nonnegative(),
  question: z.string(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChapterQuestion = z.infer<typeof ChapterQuestionSchema>;

/** PUT /api/resources/:id/chapter-questions/:spineIndex body — creates the
 * question on first write, updates its text on any later one. */
export const UpsertChapterQuestionBodySchema = z.object({
  question: z.string().min(1).max(2000),
});
export type UpsertChapterQuestionBody = z.infer<typeof UpsertChapterQuestionBodySchema>;

/**
 * POST /api/resources/:id/chapter-anchor response (M35 §B2). A located
 * quote produces a real highlight, exactly as before; an unlocatable one no
 * longer produces a mis-anchored highlight at the chapter's opening — it
 * produces a chapter-level question instead ("the two features resolve each
 * other"). Exactly one of the two is ever non-null, so the client branches
 * on which arrived rather than guessing from a status code.
 */
export const ChapterAnchorResultSchema = z.object({
  highlight: HighlightSchema.nullable(),
  chapterQuestion: ChapterQuestionSchema.nullable(),
});
export type ChapterAnchorResult = z.infer<typeof ChapterAnchorResultSchema>;

/** PUT /api/resources/:id/chapter-questions/:spineIndex/note body — same
 * uncapped plain-text shape as UpdateHighlightNoteBodySchema. */
export const UpdateChapterQuestionNoteBodySchema = z.object({
  note: z.string(),
});
export type UpdateChapterQuestionNoteBody = z.infer<typeof UpdateChapterQuestionNoteBodySchema>;

// ---------------------------------------------------------------------------
// The context ladder (M17 — "the brain button")
// ---------------------------------------------------------------------------

export const UpdateContextLadderBodySchema = z.object({
  depth: ContextLadderDepthSchema,
});
export type UpdateContextLadderBody = z.infer<typeof UpdateContextLadderBodySchema>;

/** M34 §B5: the lookahead/spoilers toggle — independent of the depth above. */
export const UpdateLookaheadBodySchema = z.object({
  enabled: z.boolean(),
});
export type UpdateLookaheadBody = z.infer<typeof UpdateLookaheadBodySchema>;

/** M35 §C7: the thematic-quotes show/hide toggle — same shape and same
 * independence from every other per-book setting on `resource_ai_settings`. */
export const UpdateShowThematicQuotesBodySchema = z.object({
  enabled: z.boolean(),
});
export type UpdateShowThematicQuotesBody = z.infer<typeof UpdateShowThematicQuotesBodySchema>;

// ---------------------------------------------------------------------------
// M20.6 — the job registry (decisions.md 2026-07-30 "Background work is a
// job model, not a popup"). One shape for every long-running server
// operation (chapter/range digest, thematic re-run, theme tagging), so the
// tasks tray, the SSE progress stream, and the cancel endpoint are all built
// once rather than per-feature.
// ---------------------------------------------------------------------------

// M21 adds "audio-render" (rendering one spine section's sentence audio);
// M22 adds "cast-scan" (pass 1: ensure/resume the digest, then assign voices).
export const JobKindSchema = z.enum([
  "digest",
  "thematic",
  "theme-tagging",
  "theme-distillation",
  "audio-render",
  "cast-scan",
]);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobProgressSchema = z.object({
  current: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** A short human label for the current step ("S5 · The Storm"), null
   * before the first step of work has started. */
  message: z.string().nullable(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

/** GET /api/jobs, GET /api/jobs/:id, and the /events SSE stream all send
 * this same shape — a reconnecting client and a first-load client see
 * identical data. */
export const JobSchema = z.object({
  id: z.string(),
  kind: JobKindSchema,
  resourceId: z.string().nullable(),
  /** Denormalized at job-start time so the tray can show "Digest — Middlemarch"
   * without a join back to a resource that (in principle) could be deleted
   * while the job is still finishing up. */
  resourceTitle: z.string().nullable(),
  /** Stable for the job's whole life, unlike `progress.message` (live,
   * changes per item): a range digest's endpoints, an audio render's or
   * cast scan's section — "S<n> · <title>", never a raw spineIndex (M20.5).
   * Null for jobs with no single natural range/section. */
  detail: z.string().nullable(),
  status: JobStatusSchema,
  progress: JobProgressSchema,
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

/** POST /api/resources/:id/digest, /thematic, /theme-tagging all respond
 * 202 with just this — the run itself now happens in the background, and
 * the caller finds out how it's going through the job registry endpoints. */
export const StartJobResponseSchema = z.object({ jobId: z.string() });
export type StartJobResponse = z.infer<typeof StartJobResponseSchema>;

// ---------------------------------------------------------------------------
// M21 — Audio I (AUDIO.md is binding for M21/M22). Section rendering reuses
// the M20.6 job registry above (kind "audio-render") instead of a bespoke
// SSE endpoint — AUDIO.md's HTTP table was written before the job registry
// existed; TASKS.md's M20.6 entry says as much ("placed before M21 on
// purpose ... AUDIO.md already specs an SSE progress endpoint").
// ---------------------------------------------------------------------------

export const VoiceGenderSchema = z.enum(["female", "male", "neutral"]);
export type VoiceGender = z.infer<typeof VoiceGenderSchema>;

export const VoiceSchema = z.object({
  id: z.string(),
  label: z.string(),
  gender: VoiceGenderSchema,
  accent: z.string().optional(),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const VoiceModeSchema = z.enum(["single", "multi"]);
export type VoiceMode = z.infer<typeof VoiceModeSchema>;

/** One `book_cast` row — a character plus its code-assigned (or
 * user-overridden) voice. `voiceLocked` means a user override (AUDIO.md
 * "Casting UI"): it must survive a re-scan. */
export const BookCastMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  gender: CastCharacterGenderSchema,
  ageHint: CastAgeHintSchema,
  description: z.string(),
  voiceId: z.string(),
  voiceLocked: z.boolean(),
  sortOrder: z.number().int(),
});
export type BookCastMember = z.infer<typeof BookCastMemberSchema>;

/** GET /api/resources/:id/cast */
export const BookCastResponseSchema = z.object({
  scannedAt: z.string().nullable(),
  members: z.array(BookCastMemberSchema),
});
export type BookCastResponse = z.infer<typeof BookCastResponseSchema>;

/** PUT /api/cast/:castId — a user's voice override (AUDIO.md: "the user can
 * override any assignment in the casting UI; overrides persist and win over
 * re-scans"). Always sets `voiceLocked`; there is no unlock endpoint —
 * AUDIO.md's HTTP table names only the override. */
export const UpdateCastVoiceBodySchema = z.object({
  voiceId: z.string().min(1),
});
export type UpdateCastVoiceBody = z.infer<typeof UpdateCastVoiceBodySchema>;

/** GET /api/resources/:id/audio */
export const AudioStateSchema = z.object({
  narratorVoice: z.string(),
  voiceMode: VoiceModeSchema,
  speed: z.number().min(0.5).max(2),
  castScannedAt: z.string().nullable(),
  /** Which spine sections already have a fully rendered, non-stale cache
   * for the *current* cast hash — the player uses this to skip the
   * render-then-play round trip on a re-open. */
  cachedSpineIndices: z.array(z.number().int().nonnegative()),
});
export type AudioState = z.infer<typeof AudioStateSchema>;

/** PUT /api/resources/:id/audio — partial update. */
export const UpdateAudioStateBodySchema = z.object({
  narratorVoice: z.string().optional(),
  voiceMode: VoiceModeSchema.optional(),
  speed: z.number().min(0.5).max(2).optional(),
});
export type UpdateAudioStateBody = z.infer<typeof UpdateAudioStateBodySchema>;

/** One row of a rendered section's manifest — GET .../audio/sections/:n/manifest. */
export const AudioSegmentSchema = z.object({
  n: z.number().int().nonnegative(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  voiceId: z.string(),
  speakerId: z.string().nullable(),
  text: z.string(),
});
export type AudioSegment = z.infer<typeof AudioSegmentSchema>;

export const AudioSectionManifestSchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  castHash: z.string(),
  /** How many sentences this section segments into in total — known (and
   * sent) before synthesis of any of them finishes, so a client can tell
   * "3 of 40 rendered so far" from "this section only has 3 sentences" and
   * keep waiting for more instead of treating a still-rendering section as
   * finished. */
  totalSegments: z.number().int().nonnegative(),
  segments: z.array(AudioSegmentSchema),
});
export type AudioSectionManifest = z.infer<typeof AudioSectionManifestSchema>;

/** POST /api/resources/:id/audio/sections/:spineIndex response when the
 * section is already cached under the current cast hash — an immediate,
 * job-free no-op (AUDIO.md: "No-op if cached"). Otherwise the route starts
 * an "audio-render" job and responds 202 with StartJobResponseSchema. */
export const AudioSectionCachedResponseSchema = z.object({ cached: z.literal(true) });
export type AudioSectionCachedResponse = z.infer<typeof AudioSectionCachedResponseSchema>;

/** GET /api/resources/:id/audio/sections — M22.5 G's "what is rendered"
 * column: per-section byte size for the *current* cast hash, plus a book
 * total. Distinct from `AudioState.cachedSpineIndices`, which only says
 * which sections are cached, not how large they are on disk. */
export const AudioSectionInfoSchema = z.object({
  spineIndex: z.number().int().nonnegative(),
  rendered: z.boolean(),
  bytes: z.number().int().nonnegative(),
});
export type AudioSectionInfo = z.infer<typeof AudioSectionInfoSchema>;

export const AudioSectionsResponseSchema = z.object({
  castHash: z.string(),
  sections: z.array(AudioSectionInfoSchema),
  totalBytes: z.number().int().nonnegative(),
});
export type AudioSectionsResponse = z.infer<typeof AudioSectionsResponseSchema>;

/** POST /api/audio/test-voice — the audio equivalent of a provider's "Test
 * connection". `text` is optional; the server has its own default sentence. */
export const TestVoiceBodySchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().min(1).optional(),
});
export type TestVoiceBody = z.infer<typeof TestVoiceBodySchema>;

// ---------------------------------------------------------------------------
// Generic error envelope
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
