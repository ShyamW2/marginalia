import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
import {
  AnimatePresence,
  animate,
  motion,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import {
  UNRESOLVABLE_CHAPTER_ANCHOR_CFI,
  type CreateHighlightBody,
  type HighlightImportance,
  type HighlightKind,
  type HighlightWithThread,
  type PageNumberMode,
  type ProviderRoleAssignment,
  type ReaderFontScale,
  type ReaderMargin,
  type ReaderPaneWidth,
  type ReadingPosition,
  type Settings,
  type SpreadMode,
  type ThreadSummary,
} from "@marginalia/shared";
import { emitSettingsSaved, onSettingsSaved } from "../settings/settingsBus.js";
import { onProviderRolesSaved } from "../settings/providerBus.js";
import { ProviderPickerPopover } from "../settings/ProviderPickerPopover.js";
import { useOpenSettingsToLLM } from "../settings/useOpenSettingsToLLM.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { useEpubThemeVars, type EpubThemeVars } from "./useEpubThemeVars.js";
import { ChevronIcon } from "./ChevronIcon.js";
import { resolveAnchor, type RangeLike } from "./anchorResolution.js";
import { getSelectionContext, rangeFromTextOffsets } from "./selectionContext.js";
import { markStyleForKind } from "./highlightKinds.js";
import { capturePageSnapshot } from "./pageSnapshot.js";
import { PageCurl } from "./PageCurl.js";
import { DwellRing } from "./DwellRing.js";
import { AskPill } from "./AskPill.js";
import { MarginRail } from "./MarginRail.js";
import { ThreadPanel } from "../threads/ThreadPanel.js";
import { AnnotationsOverview } from "./AnnotationsOverview.js";
import { buildToc, chapterAtPercent, chapterStops as deriveChapterStops, currentChapter as deriveCurrentChapter, type TocEntry } from "./toc.js";
import { ChapterNav } from "./ChapterNav.js";
import { ProgressPopover } from "./ProgressPopover.js";
import { PageNumberDisplay } from "./PageNumberDisplay.js";
import { ScrubDial, DIAL_PX_PER_PERCENT } from "./ScrubDial.js";
import {
  computeBookPageInfo,
  getSpreadDivisor,
  toSpreadAdjustedPage,
  toSpreadAdjustedTotal,
} from "./bookPages.js";
import styles from "./ReaderView.module.css";

const DEFAULT_THREAD_PANEL_TOP = 20;

/** M19: provider config moved out of Settings into profiles/roles — whether
 * the reader can Ask now means "does the query role have a configured
 * profile" (docs/decisions.md 2026-07-29 later), not a flat settings field. */
async function fetchQueryRoleConfigured(): Promise<boolean> {
  try {
    const res = await fetch("/api/provider-roles");
    if (!res.ok) return false;
    const roles = (await res.json()) as ProviderRoleAssignment[];
    return roles.find((r) => r.role === "query")?.configured ?? false;
  } catch {
    return false;
  }
}

const POSITION_SAVE_DEBOUNCE_MS = 600;
const LOCATIONS_CHAR_STEP = 1600;
const SELECTION_CONTEXT_MAX_LEN = 64;
const HIGHLIGHT_MARK_CLASS = "marginalia-highlight";
// M19.6 "hover emphasises without obscuring" (decisions.md 2026-07-30): the
// bug was switching to mix-blend-mode: normal at a near-opaque fill, which
// turns the wash into paint. The fix stays in the kind's own blend mode
// (multiply on paper, screen on ink — markStyleForKind) and just scales its
// existing fill-opacity up — "the same wash, more of it".
// Raised again per operator feedback (2026-07-30 later): the first pass
// (1.8x, capped 0.6) was judged still noticeably duller than the vivid,
// fully-legible look of a live text selection (the native `::selection`
// moment right before a highlight is even created) — pushed further while
// staying in the same blend mode, verified against the same "text stays
// comfortably readable" bar the original fix used.
const HOVER_OPACITY_MULTIPLIER = 2.6;
const HOVER_OPACITY_MAX = 0.85;
// Shared by click-to-turn and the M11 semicircular turn-zone hover/cursor —
// the outer 30% of the visible page on either side.
const TURN_ZONE_FRACTION = 0.3;
// M19.6 "highlight across a page boundary": ~2s dwell per the task's own
// acceptance criteria; the refusal flash is a quick, legible "no", not a
// second dwell.
const DWELL_DURATION_MS = 2000;
const REFUSAL_FLASH_MS = 260;
// M19.6 "the reading pane is resizable": clamps for the drag-set override —
// wide enough to be pointless below, tall-screen-friendly above.
const READER_PANE_WIDTH_MIN = 480;
const READER_PANE_WIDTH_MAX = 1800;

/** Which edge zone (if any) a point translated into container-space falls
 * in — shared by the click handler and the hover/cursor handler below. */
function turnZoneForVisibleX(
  visibleX: number,
  containerWidth: number,
): "prev" | "next" | null {
  if (visibleX < containerWidth * TURN_ZONE_FRACTION) return "prev";
  if (visibleX > containerWidth * (1 - TURN_ZONE_FRACTION)) return "next";
  return null;
}

// M12 scrub dial: a pointer move past this many px (not just any move at
// all) commits to "this is a drag" rather than "this was a click" — same
// click-vs-drag pattern as the Desk's BookObject.
const SCRUB_DRAG_THRESHOLD_PX = 4;
const SCRUB_KEYBOARD_STEP_PERCENT = 1;

// M14 fullscreen: how close (in px) the pointer must be to the top/bottom
// edge to reveal the floating top row / footer, and how much of the width
// (from the right) counts as the "top-right corner region" the margin rail
// reveals from — deliberately not the whole right edge, so it never fights
// the M11 turn-zone vignette's own right-edge hover.
const FULLSCREEN_REVEAL_BAND_PX = 72;
const FULLSCREEN_RAIL_CORNER_FRACTION = 0.25;

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// epub.js's View typings don't expose the `contents` it renders, though it
// exists at runtime (see managers/views/iframe.js) — narrow just that.
interface ViewWithContents {
  contents: Contents;
}

// epub.js's bundled RenditionOptions typings omit `gap`, though the runtime
// supports it (layout.js reads `this.settings.gap`) — see the SPEC-GAP
// comment at the renderTo() call below for why it's needed at all.
interface RenditionOptionsWithGap {
  width: string;
  height: string;
  flow: string;
  manager: string;
  spread: string;
  minSpreadWidth: number;
  allowScriptedContent: boolean;
  gap: number;
}

// M14 (decisions.md 2026-07-27): the outer edge margin used to be gap's job
// too (M11), but epub.js derives *both* the outer edge padding and the
// inter-leaf column gap from that single number — so a spread's spine
// gutter and the single-page edge margin were forced to share one value.
// The outer margin now lives on a padded wrapper *around* the element
// epub.js renders into (containerRef itself stays padding-free, since
// epub.js sizes the stage from it — see the marginWrapper div below); gap's
// only remaining job is capping the single-page measure at a comfortable
// width and, in spread mode, being the book-spine gutter.
const READER_TARGET_COLUMN_WIDTH = 520; // ~70ch at 16px body text (Bringhurst range)

// M12 two-page spread: epub.js's own layout.js falls back from "auto" to a
// single column below this stage width — mirrored here (not read back from
// epub.js) so the *gap* strategy (a measure cap for one page vs. a narrow
// book-spine gutter for two) can be chosen consistently with whatever
// epub.js is about to do at the same width.
const SPREAD_MIN_WIDTH = 960;
// The same `gap` value becomes both leaves' native CSS column-gap — this is
// deliberately independent of readerMargin (decisions.md 2026-07-27: "the
// spine gutter in spread mode is independently visible and unchanged by the
// margin setting").
const SPREAD_GUTTER = 64;

// M16 "reading text size": READER_TARGET_COLUMN_WIDTH is "~70ch at 16px" —
// that stops being true the moment fontScale != 1, so the target column
// width must scale with it (decisions.md 2026-07-28) or the measure drifts
// out of the 60-75ch band as text grows/shrinks. fontScale doesn't affect
// the spread-mode gutter (SPREAD_GUTTER stays a fixed physical spine width).
function computeReaderGap(
  containerWidth: number,
  spreadMode: SpreadMode,
  fontScale: number,
): number {
  if (spreadMode === "auto" && containerWidth >= SPREAD_MIN_WIDTH) {
    return SPREAD_GUTTER;
  }
  return Math.max(containerWidth - READER_TARGET_COLUMN_WIDTH * fontScale, 0);
}

// M14 "customisable page margins": the outer padding on both axes around the
// rendered page, applied via a CSS wrapper rather than epub.js's own gap
// option (see computeReaderGap above). "wide" is the acceptance bar's named
// value (~4rem); the others scale from it.
const READER_MARGIN_PX: Record<ReaderMargin, number> = {
  narrow: 24, // 1.5rem
  normal: 40, // 2.5rem — matches the old fixed M11 edge padding
  wide: 64, // 4rem
  generous: 96, // 6rem
};

function applyTheme(rendition: Rendition, vars: EpubThemeVars): void {
  rendition.themes.register("app", {
    "html, body": {
      background: `${vars.bg} !important`,
      color: `${vars.text} !important`,
    },
    body: {
      "font-family": `${vars.fontSerif} !important`,
      "line-height": "1.65 !important",
      // Real page margin comes from the `gap` render option (see
      // computeReaderGap / the SPEC-GAP comment at renderTo below) —
      // epub.js overwrites body padding with its own inline `!important` on
      // every layout pass, so this rule only matters for the brief
      // pre-layout flash and any non-paginated fallback rendering.
      padding: "0 3rem !important",
    },
    a: { color: `${vars.accent} !important` },
    "::selection": { background: `${vars.highlightActive} !important` },
    [`.${HIGHLIGHT_MARK_CLASS}`]: {
      background: `${vars.highlight} !important`,
      cursor: "pointer",
    },
  });
  rendition.themes.select("app");
}

async function fetchPosition(
  resourceId: string,
): Promise<ReadingPosition | null> {
  const res = await fetch(`/api/resources/${resourceId}/position`);
  if (!res.ok) return null;
  return (await res.json()) as ReadingPosition | null;
}

function savePosition(
  resourceId: string,
  location: string,
  spineIndex: number | null,
  percent: number | null,
): void {
  fetch(`/api/resources/${resourceId}/position`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location, spineIndex, percent }),
  }).catch(() => {
    // best-effort — losing one position write isn't worth surfacing an error
  });
}

// M19.6 "page numbers, book-wide and stable": the cached `book.locations
// .save()` blob, opaque past this point — the server never parses it (SPEC:
// no EPUB renderer server-side). Null means "never generated for this
// resource", not an error; the caller falls back to generate().
async function fetchCachedLocations(resourceId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/locations`);
    if (!res.ok) return null;
    const data = (await res.json()) as { locations: string | null };
    return data.locations;
  } catch {
    return null;
  }
}

function saveCachedLocations(resourceId: string, locations: string): void {
  fetch(`/api/resources/${resourceId}/locations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations }),
  }).catch(() => {
    // best-effort — worst case this book regenerates locations next open
  });
}

// M19.6 "the reading pane is resizable" (decisions.md 2026-07-30 later):
// same direct-PUT-from-the-reader pattern ThreadPanel's own size/offset
// persistence uses, rather than routing through the Settings modal — the
// drag handle lives in the reading surface, not a form. Broadcasts via the
// settingsBus (settings/settingsBus.ts) on success so any other mounted
// consumer of readerPaneWidth (there is none today, but readerMargin/
// readerFontScale already establish "settings changes are always live") is
// never silently out of sync.
function saveReaderPaneWidth(width: number): void {
  fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ readerPaneWidth: width }),
  })
    .then((res) => (res.ok ? (res.json() as Promise<Settings>) : null))
    .then((settings) => {
      if (settings) emitSettingsSaved(settings);
    })
    .catch(() => {
      // best-effort — worst case this reverts to the spread-mode default
      // next open
    });
}

// M19.6 operator feedback (decisions.md 2026-07-30 later): bookPages.ts's
// estimate for not-yet-visited sections needs a cheap per-section "how much
// text does this hold" weight. The Scan (annotations/scan.ts) already
// computes exactly this from the same immutable, server-cached
// `resource_text` extraction — reused rather than duplicated, at the cost
// of fetching a payload that also carries highlights/themes this reader
// doesn't need.
async function fetchSectionWeights(resourceId: string): Promise<Map<number, number> | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/scan`);
    if (!res.ok) return null;
    const data = (await res.json()) as { chapters?: { spineIndex: number; lengthPercent: number }[] };
    if (!data.chapters || data.chapters.length === 0) return null;
    return new Map(data.chapters.map((c) => [c.spineIndex, c.lengthPercent]));
  } catch {
    return null;
  }
}

async function fetchHighlights(resourceId: string): Promise<HighlightWithThread[]> {
  const res = await fetch(`/api/resources/${resourceId}/highlights`);
  if (!res.ok) return [];
  return (await res.json()) as HighlightWithThread[];
}

async function postHighlight(
  body: CreateHighlightBody,
): Promise<HighlightWithThread | null> {
  const res = await fetch("/api/highlights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const created = await res.json();
  return { ...created, thread: null };
}

async function fetchSettings(): Promise<Settings | null> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return null;
    return (await res.json()) as Settings;
  } catch {
    return null;
  }
}

async function deleteHighlightRequest(id: string): Promise<boolean> {
  const res = await fetch(`/api/highlights/${id}`, { method: "DELETE" });
  return res.ok;
}

interface PendingSelection {
  cfi: string;
  exact: string;
  prefix: string;
  suffix: string;
  spineIndex: number;
  contents: Contents;
  left: number;
  top: number;
}

interface ReaderViewProps {
  resourceId: string;
  /** Arriving via the scan's airlock transition (DESIGN.md): land on this
   * highlight's position and open its thread, instead of the saved reading
   * position. */
  initialHighlightId?: string;
  /** M19.5 "clicking a posed question opens a thread on it, pre-filled":
   * seeds the opened thread's draft textarea. Only meaningful alongside
   * initialHighlightId. */
  initialQuestion?: string;
  /** M12 two-page spread: resolved by ReaderPage before this ever mounts
   * (see the comment there) so it can be handed straight to epub.js's
   * `renderTo()` at creation time — not re-fetched in here. */
  spreadMode: SpreadMode;
  /** M19.6 "annotations roam the app": the thread panel's dragConstraints —
   * ReaderPage's own root, wider than the reading stage. */
  appBoundsRef: RefObject<HTMLDivElement>;
  /** M19.6 "the reading pane is resizable" (decisions.md 2026-07-30 later):
   * same "resolved before mount" story as spreadMode above — 0 means unset
   * (use the spread-mode default). */
  initialReaderPaneWidth: ReaderPaneWidth;
}

export function ReaderView({
  resourceId,
  initialHighlightId,
  initialQuestion,
  spreadMode,
  initialReaderPaneWidth,
  appBoundsRef,
}: ReaderViewProps) {
  const openSettingsToLLM = useOpenSettingsToLLM();
  const containerRef = useRef<HTMLDivElement>(null);
  // M19.6 "the skipped last page of a chapter": the element epub.js measures
  // as `container` (containerRef itself) must be an *integer* pixel width —
  // see pinContainerWidth's own comment, in the book-loading effect below,
  // for why. Its own CSS is percentage-based (`width: 100%` of this wrapper's
  // padded content box), which is exactly the kind of layout that can land
  // on a fractional pixel; marginWrapperRef is what the pin measures *from*,
  // since its own box is never touched by the pin itself.
  const marginWrapperRef = useRef<HTMLDivElement>(null);
  // M14: the reader's stage — the thread panel's drag is constrained to it,
  // and a stale panel offset gets clamped back into its bounds on reopen.
  const stageRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  // M12 scrub dial / chapter nav need direct book access (locations,
  // navigation, spine) outside the load effect's own closure.
  const bookRef = useRef<Book | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  // M16 bug fix (margin/gap changes not reaching the page live): epub.js's
  // `manager.updateLayout()` recomputes column geometry but does not
  // reposition the iframe's own scroll offset for it — the old pixel offset
  // now lands mid-column under the new gap, rendering two column-halves at
  // once (confirmed live: a real margin change corrupted the visible page
  // into a split-column smear, even though the underlying CSS gap/padding
  // had already updated correctly). A remount fixes it by re-`display()`ing
  // the current CFI, which is exactly what handleContainerResize below does
  // manually. Kept current via handleRelocated rather than reading
  // `rendition.currentLocation()` synchronously, which can be mid-flight.
  const currentCfiRef = useRef<string | null>(null);
  const highlightsRef = useRef<HighlightWithThread[]>([]);
  const resolvedIdsRef = useRef<Set<string>>(new Set());
  // Tracks the CFI each highlight's mark was actually attached at, which can
  // differ from the stored anchor when it was resolved via the text-search
  // fallback (a re-anchored CFI) rather than the original CFI resolving
  // clean — deleting must remove the mark at whichever CFI is really there.
  const attachedCfiRef = useRef<Map<string, string>>(new Map());
  // Two different highlights can legitimately resolve to the identical CFI
  // (e.g. asking a second question on the exact same selection). epub.js's
  // View keys its internal highlight/mark tracking by the raw CFI string and
  // unconditionally creates a new SVG mark on every `annotations.highlight()`
  // call for that CFI without checking for an existing one — so attaching
  // twice at the same CFI leaves an orphaned, untracked, unremovable mark
  // that no future remove/re-tint call can ever reach. This map tracks which
  // highlightIds currently share a CFI (insertion order = ownership order);
  // only the first ("owner") ever gets a real epub.js-level mark, and
  // ownership transfers to the next co-owner if the owner is deleted.
  const cfiOwnersRef = useRef<Map<string, string[]>>(new Map());
  const themeVars = useEpubThemeVars();
  const stageControls = useAnimationControls();
  const stageReducedMotion = useReducedMotion();
  // M10 page curl (see turnPageCurl below): guards against overlapping
  // turns (rapid key/gesture repeats), the live curl progress (0 = flat,
  // 1 = fully turned) driven either imperatively or by a pointer drag, and
  // a device that's proven too slow to keep the curl at a real frame rate.
  const turnLockRef = useRef(false);
  const lowFpsRef = useRef(false);
  const curlProgress = useMotionValue(0);
  const [curl, setCurl] = useState<{ src: string; direction: "prev" | "next" } | null>(
    null,
  );
  // The book-loading effect's internal handlers (keydown, click-to-turn)
  // close over `rendition` directly and don't re-run per-render, so they
  // reach the current turnPage through this ref rather than a stale closure.
  const turnPageRef = useRef<(direction: "prev" | "next") => void>(() => {});
  // Same story, for M12's `[`/`]` chapter-jump shortcuts — jumpToChapter
  // depends on `toc`/`currentSpineIndex` render state, not stable across
  // the load effect's single run.
  const chapterJumpRef = useRef<(direction: "prev" | "next") => void>(() => {});
  // Same story again, for the M16 readerFontScale effect below — fontScale
  // changes the target column width without ever changing the container's
  // own box size, so nothing would otherwise tell the ResizeObserver-driven
  // gap recompute inside the book-loading effect to re-run.
  const applyGapForWidthRef = useRef<() => void>(() => {});
  // The book-loading effect below is set up once per resourceId and
  // deliberately excludes themeVars from its deps (see the comment near its
  // end) — attachHighlightMark, defined inside that effect, reads the
  // *current* theme through this ref rather than a stale closure value.
  const themeVarsRef = useRef(themeVars);
  useEffect(() => {
    themeVarsRef.current = themeVars;
  }, [themeVars]);

  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [displayedPage, setDisplayedPage] = useState<{ page: number; total: number } | null>(
    null,
  );
  // M19.6 "highlight across a page boundary": read inside a setTimeout
  // closure captured by the book-loading effect (which only runs once per
  // resourceId) — same "mirror state into a ref for a long-lived closure"
  // story as fontScaleRef/focusModeRef elsewhere in this file.
  const displayedPageRef = useRef(displayedPage);
  useEffect(() => {
    displayedPageRef.current = displayedPage;
  }, [displayedPage]);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [currentSpineIndex, setCurrentSpineIndex] = useState<number | null>(
    null,
  );
  // M17 "digest this chapter" (decisions.md 2026-07-28 later): the
  // spotlight's reader-side shortcut — same POST the scan's spotlight uses,
  // scoped to just the current chapter, without visiting the scan.
  const [digestingChapter, setDigestingChapter] = useState(false);
  const [digestChapterResult, setDigestChapterResult] = useState<string | null>(null);
  // M12: table of contents (flattened, spine+percent resolved once
  // book.locations has generated) and the scrub-dial/popover UI state for
  // the progress readout.
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [progressPopoverOpen, setProgressPopoverOpen] = useState(false);
  // Non-null while either a pointer drag or the keyboard-step interaction is
  // live — the previewed (not yet committed) whole-book percent.
  const [scrubPreviewPercent, setScrubPreviewPercent] = useState<number | null>(null);
  const [highlights, setHighlights] = useState<HighlightWithThread[]>([]);
  const [unanchoredIds, setUnanchoredIds] = useState<Set<string>>(new Set());
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  // Reopening a book always restores threads collapsed (SPEC) — this state
  // is local and resets to null on every mount, no persistence needed.
  const [expandedThread, setExpandedThread] = useState<{
    highlightId: string;
    top: number;
    /** M19.5 "clicking a posed question opens a thread on it, pre-filled":
     * set only on the initial jump-to-highlight open (see initialHighlightId
     * below), never on a plain highlight click — ThreadPanel seeds its
     * draft textarea from this once, on mount, via its own `key`-per-
     * highlight remount. */
    initialDraft?: string;
  } | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
  // M14: persisted, but must take effect live while this component stays
  // mounted underneath the settings modal (M11) — settingsBus is how a
  // save reaches this component without a reload or a remount.
  const [readerMargin, setReaderMargin] = useState<ReaderMargin>("normal");
  // M16 "reading text size": same live-via-settingsBus story as readerMargin
  // above, and the two are coupled (computeReaderGap derives the target
  // column width from fontScale) — fontScaleRef mirrors it for the
  // book-loading effect's closures, same pattern as themeVarsRef/focusModeRef.
  const [readerFontScale, setReaderFontScale] = useState<ReaderFontScale>(1);
  const fontScaleRef = useRef(readerFontScale);
  useEffect(() => {
    fontScaleRef.current = readerFontScale;
  }, [readerFontScale]);
  // M19.6 "page numbers, book-wide and stable": same live-via-settingsBus
  // story as readerMargin/readerFontScale above.
  const [pageNumberMode, setPageNumberMode] = useState<PageNumberMode>("off");
  // M19.6 "the reading pane is resizable" (decisions.md 2026-07-30 later):
  // a drag-set override for --reader-max-width, layered on top of the
  // spread-mode default the same way readerMargin sits *inside* it rather
  // than being a fourth independent knob. 0 = unset. Initialized from the
  // prop (resolved by ReaderPage before mount, same story as spreadMode) so
  // there's no flash back to the default on reload; same live-via-
  // settingsBus story as readerMargin/readerFontScale above thereafter.
  const [readerPaneWidth, setReaderPaneWidth] = useState<ReaderPaneWidth>(
    initialReaderPaneWidth,
  );
  const [paneWidthDragging, setPaneWidthDragging] = useState(false);
  // M19.6 operator feedback (decisions.md 2026-07-30 later): replaces the
  // character-location-based book-wide count with bookPages.ts's
  // click-accurate, spread-adjusted one. Null until the section-weight
  // fetch (below) resolves — "book" mode shows nothing until then, same as
  // displayedPage does before epub.js reports its first location.
  const [bookPage, setBookPage] = useState<{ page: number; total: number } | null>(null);
  // Section-weight (lengthPercent from the Scan's own text-length data) and
  // real, spread-adjusted page counts measured as sections are visited —
  // see bookPages.ts. Refs, not state: read inside handleRelocated without
  // needing to be a render dependency themselves.
  const sectionWeightRef = useRef<Map<number, number> | null>(null);
  const sectionRealPagesRef = useRef<Map<number, number>>(new Map());
  const [showAnnotations, setShowAnnotations] = useState(false);
  // Reading focus mode (DESIGN.md): hides marks + rail dots for a clean
  // page. Local, resets on remount — same "no persistence needed" call as
  // expandedThread above; "persists for the session" means it survives
  // page turns and theme toggles within this reading session, not browser
  // restarts.
  const [focusMode, setFocusMode] = useState(false);
  // Same story as themeVarsRef, for reading focus mode.
  const focusModeRef = useRef(focusMode);
  useEffect(() => {
    focusModeRef.current = focusMode;
  }, [focusMode]);

  // M14 fullscreen reading mode (decisions.md 2026-07-27): a *different* axis
  // from focus mode — focus mode hides your annotations, fullscreen hides
  // the app's chrome (top row, footer, rail), which become proximity-
  // revealed floating panels. `wrapperRef` is "the app root" the browser
  // Fullscreen API is requested on; degrades silently to an in-page-only
  // fullscreen layout (this component's own fixed-position CSS) if refused.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const fullscreenModeRef = useRef(fullscreenMode);
  useEffect(() => {
    fullscreenModeRef.current = fullscreenMode;
  }, [fullscreenMode]);
  // Which floating chrome panel is currently revealed — set true by the
  // iframe-forwarded mousemove below when the pointer nears its edge/corner,
  // and independently by the panel's own onPointerEnter/Leave once it's
  // visible enough to hover directly (see the JSX). CSS :focus-within
  // handles the keyboard-reveal case without any JS at all.
  const [revealTop, setRevealTop] = useState(false);
  const [revealBottom, setRevealBottom] = useState(false);
  const [revealRail, setRevealRail] = useState(false);

  useEffect(() => {
    if (fullscreenMode) return;
    setRevealTop(false);
    setRevealBottom(false);
    setRevealRail(false);
  }, [fullscreenMode]);

  // M14 fullscreen reveal, continued: the iframe-forwarded mousemove above
  // only fires while the cursor is actually over the rendered page — it
  // never fires for the parent-document dead zone above/below/beside the
  // iframe (where the floating chrome itself lives before it's revealed,
  // since `pointer-events: none` on an unrevealed panel means it can't be
  // the thing that reveals itself). Found live: without this, hovering the
  // literal top edge of the screen from a "cold" state did nothing, and a
  // reveal triggered from inside the iframe never cleared once the cursor
  // left the iframe entirely (no further events to update it) — see
  // NOTES.md "M14". A plain window-level listener, active only in
  // fullscreen, covers exactly that gap with the same viewport-relative
  // thresholds as the iframe-forwarded path above.
  useEffect(() => {
    if (!fullscreenMode) return;
    function handleWindowMouseMove(event: MouseEvent) {
      const nearTop = event.clientY < FULLSCREEN_REVEAL_BAND_PX;
      const nearBottom = event.clientY > window.innerHeight - FULLSCREEN_REVEAL_BAND_PX;
      const nearRailCorner =
        nearTop && event.clientX > window.innerWidth * (1 - FULLSCREEN_RAIL_CORNER_FRACTION);
      setRevealTop((prev) => (prev === nearTop ? prev : nearTop));
      setRevealBottom((prev) => (prev === nearBottom ? prev : nearBottom));
      setRevealRail((prev) => (prev === nearRailCorner ? prev : nearRailCorner));
    }
    window.addEventListener("mousemove", handleWindowMouseMove);
    return () => window.removeEventListener("mousemove", handleWindowMouseMove);
  }, [fullscreenMode]);

  const toggleFullscreen = useCallback(() => {
    setFullscreenMode((prev) => {
      const next = !prev;
      if (next) {
        // Can be refused (no user-gesture chain, or unsupported) — the
        // in-page fullscreen layout below still applies either way; only
        // the browser's own chrome removal is lost.
        void wrapperRef.current?.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        void document.exitFullscreen?.();
      }
      return next;
    });
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      // The browser can exit real fullscreen on its own (native Escape
      // handling, or the user leaving via the browser's own UI) — resync so
      // our floating-chrome layout doesn't stay engaged with no real
      // fullscreen (or vice versa) behind it.
      if (!document.fullscreenElement) setFullscreenMode(false);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // M19.7: the reader's shortcuts, as discrete handlers the shared registry
  // (useShortcuts) can dispatch by key — replacing the single monolithic
  // window keydown listener this used to be one of four ad-hoc copies of
  // (decisions.md 2026-07-30). Each handler only touches refs and stable
  // setters, so none of these need dependencies beyond what's shown.
  const handleArrowLeftShortcut = useCallback(() => turnPageRef.current("prev"), []);
  const handleArrowRightShortcut = useCallback(() => turnPageRef.current("next"), []);
  const handleChapterPrevShortcut = useCallback(() => chapterJumpRef.current("prev"), []);
  const handleChapterNextShortcut = useCallback(() => chapterJumpRef.current("next"), []);
  const handleEscapeShortcut = useCallback(() => {
    setPendingSelection(null);
    setExpandedThread(null);
    setProgressPopoverOpen(false);
    if (fullscreenModeRef.current) toggleFullscreen();
  }, [toggleFullscreen]);
  const handleFocusModeShortcut = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      // A clean page and an open annotations list are contradictory.
      if (next) setShowAnnotations(false);
      return next;
    });
  }, []);

  useShortcuts([
    { key: "ArrowLeft", handler: handleArrowLeftShortcut },
    { key: "ArrowRight", handler: handleArrowRightShortcut },
    { key: "[", handler: handleChapterPrevShortcut },
    { key: "]", handler: handleChapterNextShortcut },
    { key: "Escape", handler: handleEscapeShortcut },
    { key: "f", shift: false, handler: handleFocusModeShortcut },
    { key: "f", shift: true, handler: toggleFullscreen },
  ]);

  // M11 semicircular turn zones: which edge (if any) the pointer is
  // currently hovering, driving both the parent-document vignette and the
  // directional cursor written onto the iframe body — see
  // handleContentMouseMove in the book-loading effect below.
  const [turnZoneHover, setTurnZoneHover] = useState<"prev" | "next" | null>(null);
  // The content document the cursor was last set on, so it can be cleared
  // when the pointer leaves the stage entirely from the *parent* document's
  // side (a plain onPointerLeave on the container — mousemove inside the
  // iframe never fires for that).
  const lastContentsWithCursorRef = useRef<Contents | null>(null);
  // M16 "highlights pop on hover": the mark whose inline style is currently
  // boosted past its normal kind wash, so it can be un-boosted the moment
  // the cursor leaves it (or the stage entirely) without re-querying the DOM.
  const hoveredMarkElRef = useRef<SVGElement | null>(null);
  function clearMarkHover() {
    const el = hoveredMarkElRef.current;
    if (!el) return;
    // Clears the inline override, letting the kind's normal presentation
    // attribute (set by markStyleForKind via epub.js) show again — setting
    // properties on an element that's since been removed from the DOM
    // (e.g. a page turn recreated the mark) is a harmless no-op.
    el.style.fillOpacity = "";
    hoveredMarkElRef.current = null;
  }

  // M19.6 "highlight across a page boundary" (decisions.md 2026-07-30
  // later): holding a drag-selection at the page edge dwells ~2s, then
  // turns the page with the selection continuing — buildable *within* a
  // section (a Range there spans columns of one document, confirmed live:
  // it survives rendition.next() untouched) and impossible *across* one (a
  // fresh iframe document, confirmed live: the selection was destroyed
  // outright), per the diagnostic this task's own acceptance criteria
  // required before building. `isPointerDownInContentRef` is what lets
  // mousemove below tell an active drag-selection from a passive hover;
  // dwellZoneRef/dwellTimerRef are refs (not state) since mousemove fires
  // far more often than a render should reset them.
  const isPointerDownInContentRef = useRef(false);
  const dwellZoneRef = useRef<"prev" | "next" | null>(null);
  const dwellTimerRef = useRef<number | undefined>(undefined);
  const dwellKeyRef = useRef(0);
  const [dwellRing, setDwellRing] = useState<
    { dwellKey: number; x: number; y: number; refused: boolean } | null
  >(null);

  function cancelDwell() {
    window.clearTimeout(dwellTimerRef.current);
    dwellTimerRef.current = undefined;
    dwellZoneRef.current = null;
    setDwellRing(null);
  }

  useEffect(() => {
    // Zones "disappear in focus mode" (TASKS.md acceptance) — clear
    // immediately rather than waiting for the next pointer move. A dwell
    // in progress is exactly the same kind of turn-zone affordance, so it
    // cancels here too.
    if (!focusMode) return;
    setTurnZoneHover(null);
    cancelDwell();
    if (lastContentsWithCursorRef.current) {
      lastContentsWithCursorRef.current.document.body.style.cursor = "";
    }
    // A hidden mark must stay hidden on hover (TASKS.md M16 acceptance) —
    // clear any in-progress hover boost the instant focus mode engages.
    clearMarkHover();
  }, [focusMode]);

  // Attach a mark for `highlightId` at `cfi`, but only actually create an
  // epub.js-level mark for the first highlight to claim a given CFI (see
  // cfiOwnersRef above) — later co-owners are tracked but stay invisible,
  // since a second mark at an identical position would just orphan.
  function attachOwnedMark(highlightId: string, cfi: string, kind: HighlightKind) {
    attachedCfiRef.current.set(highlightId, cfi);
    const owners = cfiOwnersRef.current.get(cfi) ?? [];
    const alreadyOwned = owners.length > 0;
    if (!owners.includes(highlightId)) owners.push(highlightId);
    cfiOwnersRef.current.set(cfi, owners);
    if (alreadyOwned) return;
    renditionRef.current?.annotations.highlight(
      cfi,
      { highlightId },
      undefined,
      HIGHLIGHT_MARK_CLASS,
      markStyleForKind(kind, themeVarsRef.current, focusModeRef.current),
    );
  }

  function isMarkOwner(highlightId: string, cfi: string): boolean {
    return cfiOwnersRef.current.get(cfi)?.[0] === highlightId;
  }

  // Detach highlightId's claim on cfi. If it wasn't the visible owner, the
  // mark belongs to someone else and stays untouched. If it was the owner
  // and other highlights still share the CFI, ownership transfers to the
  // next one — remove and re-attach so the mark's data points at a highlight
  // that still exists rather than the one just deleted.
  function detachOwnedMark(
    highlightId: string,
    cfi: string,
    remainingHighlights: HighlightWithThread[],
  ) {
    const owners = cfiOwnersRef.current.get(cfi) ?? [];
    const wasOwner = owners[0] === highlightId;
    const nextOwners = owners.filter((id) => id !== highlightId);

    if (!wasOwner) {
      cfiOwnersRef.current.set(cfi, nextOwners);
      return;
    }

    renditionRef.current?.annotations.remove(cfi, "highlight");

    if (nextOwners.length === 0) {
      cfiOwnersRef.current.delete(cfi);
      return;
    }

    cfiOwnersRef.current.set(cfi, nextOwners);
    const newOwner = remainingHighlights.find((h) => h.id === nextOwners[0]);
    if (!newOwner) return;
    renditionRef.current?.annotations.highlight(
      cfi,
      { highlightId: newOwner.id },
      undefined,
      HIGHLIGHT_MARK_CLASS,
      markStyleForKind(newOwner.kind, themeVarsRef.current, focusModeRef.current),
    );
  }

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  useEffect(() => {
    fetchSettings().then((settings) => {
      if (!settings) return;
      setReaderMargin(settings.readerMargin);
      setReaderFontScale(settings.readerFontScale);
      setPageNumberMode(settings.pageNumberMode);
      setReaderPaneWidth(settings.readerPaneWidth);
    });
    fetchQueryRoleConfigured().then(setProviderConfigured);
  }, []);

  useEffect(() => {
    return onSettingsSaved((settings) => {
      setReaderMargin(settings.readerMargin);
      setReaderFontScale(settings.readerFontScale);
      setPageNumberMode(settings.pageNumberMode);
      setReaderPaneWidth(settings.readerPaneWidth);
    });
  }, []);

  useEffect(() => {
    return onProviderRolesSaved(() => {
      fetchQueryRoleConfigured().then(setProviderConfigured);
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current || !marginWrapperRef.current) return;
    let cancelled = false;

    setStatus("loading");
    setProgressPercent(null);
    setDisplayedPage(null);
    setBookPage(null);
    sectionWeightRef.current = null;
    sectionRealPagesRef.current = new Map();
    setToc([]);
    setProgressPopoverOpen(false);
    setScrubPreviewPercent(null);
    setHighlights([]);
    setUnanchoredIds(new Set());
    setPendingSelection(null);
    setExpandedThread(null);
    highlightsRef.current = [];
    resolvedIdsRef.current = new Set();
    attachedCfiRef.current = new Map();
    cfiOwnersRef.current = new Map();

    // M19.6 "the skipped last page of a chapter" (decisions.md 2026-07-30,
    // established cause — not re-derived here): epub.js's DefaultViewManager
    // decides "scroll one more page" vs. "advance to the next section" by
    // comparing `container.offsetWidth + layout.delta` against
    // `container.scrollWidth`. `offsetWidth` is integer-rounded; `delta` is a
    // float derived from the stage width epub.js measured — a fractional
    // measurement makes `offsetWidth` overshoot `delta` by up to a pixel, the
    // comparison fails one page early, and the section advances, skipping the
    // last page. Pinning `containerRef.current` — the exact element passed to
    // `renderTo` below, which is what epub.js measures as `container` — to an
    // explicit *integer* pixel width (not the CSS `width: 100%` its stylesheet
    // uses, which is exactly the kind of layout that lands on a fractional
    // value) closes the gap at the source instead of intercepting turns.
    // Measured from marginWrapperRef, never from containerRef's own box —
    // once pinned, containerRef's box no longer reflects the *available*
    // space, only whatever we last told it to be.
    // Bug found live-testing the page-number task below (not part of the
    // original last-page-skip fix's own acceptance criteria, which never
    // checked for overflow): `wrapper.clientWidth` is marginWrapper's own
    // *border-box* width, which — since marginWrapper is where the margin
    // padding lives — includes that padding rather than the content area
    // inside it. Pinning containerRef to that full width, while containerRef
    // still starts flush against the left padding edge as a normal-flow
    // child, pushed its right edge past marginWrapper's own right edge by
    // exactly the horizontal padding, i.e. by the margin itself — epub.js
    // then paginated to fill that too-wide box and the right margin's worth
    // of text ran off the page, clipped by .pageClip. Must subtract the
    // padding to get the actual content width available.
    function pinContainerWidth(): number {
      const wrapper = marginWrapperRef.current;
      const container = containerRef.current;
      if (!wrapper || !container) return 0;
      const computed = getComputedStyle(wrapper);
      const horizontalPadding =
        Number.parseFloat(computed.paddingLeft) + Number.parseFloat(computed.paddingRight);
      const integerWidth = Math.floor(wrapper.clientWidth - horizontalPadding);
      container.style.width = `${integerWidth}px`;
      return integerWidth;
    }
    const initialWidth = pinContainerWidth();

    // Our file route has no .epub extension for epub.js to sniff from the
    // URL, so it would otherwise be treated as an unpacked directory of
    // book files rather than a single archive to fetch and unzip.
    const book: Book = ePub(`/api/resources/${resourceId}/file`, {
      openAs: "epub",
    });
    bookRef.current = book;
    const rendition = book.renderTo(containerRef.current, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      manager: "default",
      // M12: "auto" lets epub.js show two facing pages once the stage is at
      // least minSpreadWidth wide, falling back to one page below it — its
      // own built-in behavior, not something this code re-implements.
      spread: spreadMode,
      minSpreadWidth: SPREAD_MIN_WIDTH,
      allowScriptedContent: false,
      // SPEC-GAP: M11 "page spacing" asked for margin via the theme's body
      // padding, but epub.js's own column layout (contents.columns() in
      // its default manager) recomputes and re-applies inline
      // `padding-left/right: <gap/2>px !important` on every render/resize —
      // an inline !important always wins over a stylesheet !important, so
      // theme-set body padding is silently discarded the moment epub.js
      // lays out a section. Passing `gap` here is what actually reaches the
      // page edge: with it set, epub.js skips its own auto-gap formula
      // (floor(width/12), see layout.js) and uses this value instead, split
      // evenly left/right — see computeReaderGap above. The same value also
      // becomes the native CSS column-gap between the two visible leaves in
      // spread mode, which is why computeReaderGap picks a much narrower
      // number once a spread is actually showing (SPREAD_GUTTER).
      gap: computeReaderGap(initialWidth, spreadMode, fontScaleRef.current),
    } as RenditionOptionsWithGap);
    renditionRef.current = rendition;
    applyTheme(rendition, themeVars);
    // M16 "reading text size": fontScaleRef is still 1 (default) here if the
    // settings fetch hasn't resolved yet — self-corrects moments later via
    // the dedicated readerFontScale effect below, same "brief flash to
    // default" timing already accepted for readerMargin's own mount race.
    rendition.themes.fontSize(`${Math.round(fontScaleRef.current * 100)}%`);

    // computeReaderGap's result only fits the container's width at mount —
    // re-derive it whenever that width actually changes, whether from a
    // window resize or (M14) a margin-setting change repainting the
    // marginWrapper's padding — a ResizeObserver on containerRef itself
    // catches both for free, unlike the window "resize" event this replaced
    // (which only ever fired for the former). Two epub.js internals quirks
    // make this more than "set gap, call resize()": (1) the manager's own
    // `settings` is a one-time shallow *copy* of `rendition.settings`
    // (`extend()` in epubjs/utils/core.js copies property values at
    // construction, not a live reference) — mutating `rendition.settings.gap`
    // later never reaches the manager, so the manager's own settings object
    // must be mutated directly; (2) the public `Rendition.resize()` no-ops
    // when the outer stage size hasn't changed since its last layout, which
    // would swallow this update on anything other than a genuine size
    // change — calling the manager's `updateLayout()` directly re-lays-out
    // unconditionally instead.
    let lastGapWidth = initialWidth;
    let redisplayTimer: number | undefined;
    // Shared by real container resizes (below) and, since fontScale changes
    // the target column width without changing the container's own box size
    // at all, the dedicated readerFontScale effect further down — exposed
    // via applyGapRef, same "reach into this effect from outside" pattern as
    // turnPageRef/chapterJumpRef.
    function applyGapForWidth(width: number) {
      const manager = (
        rendition as unknown as { manager?: { settings: { gap?: number }; updateLayout?: () => void } }
      ).manager;
      if (!manager) return;
      manager.settings.gap = computeReaderGap(width, spreadMode, fontScaleRef.current);
      manager.updateLayout?.();

      // M19.6 operator feedback: every already-visited section's real page
      // count (bookPages.ts) was measured under the layout that's about to
      // change (font size or margin) — stale the moment the gap changes.
      // Cleared, not migrated: the debounced re-display below re-measures
      // the current section within ~120ms, and every other section's real
      // count gets replaced by a fresh estimate until it's revisited.
      sectionRealPagesRef.current.clear();

      // M16 bug fix: `updateLayout()` recomputes column geometry (confirmed
      // live via computed styles — gap/padding update correctly, instantly)
      // but leaves the iframe's own scroll offset untouched, so anywhere
      // past the first page the old pixel offset now lands mid-column under
      // the new width — the reader visibly renders two column-halves at
      // once. Re-`display()`ing the current CFI is the documented
      // known-good fix (it's what a remount does). Debounced briefly so a
      // continuous window drag-resize settles once instead of re-displaying
      // on every intermediate tick.
      window.clearTimeout(redisplayTimer);
      redisplayTimer = window.setTimeout(() => {
        if (currentCfiRef.current) void rendition.display(currentCfiRef.current);
      }, 120);
    }
    // Observes marginWrapperRef, not containerRef — containerRef's own box
    // is now the thing this pins, so observing it directly would mean
    // reacting to our own writes rather than to real available-space
    // changes (a window resize, or a margin-setting repaint of
    // marginWrapper's padding).
    function handleContainerResize() {
      const width = pinContainerWidth();
      if (Math.abs(width - lastGapWidth) < 1) return;
      lastGapWidth = width;
      applyGapForWidth(width);
    }
    applyGapForWidthRef.current = () => {
      applyGapForWidth(pinContainerWidth());
    };
    const resizeObserver = new ResizeObserver(handleContainerResize);
    resizeObserver.observe(marginWrapperRef.current);

    function markUnanchored(highlightId: string) {
      setUnanchoredIds((prev) => {
        if (prev.has(highlightId)) return prev;
        const next = new Set(prev);
        next.add(highlightId);
        return next;
      });
    }

    // Resolves this section's highlights against its now-rendered document:
    // CFI first, falling back to a prefix/exact/suffix text search, per the
    // SPEC anchoring rule. Each highlight is resolved once — epub.js's
    // Annotations store re-attaches marks to every future render of the same
    // section on its own, no need to redo the search.
    function resolveHighlightsForSection(contents: Contents) {
      const sectionText = contents.document.body.textContent ?? "";
      const candidates = highlightsRef.current.filter(
        (h) =>
          h.spineIndex === contents.sectionIndex &&
          !resolvedIdsRef.current.has(h.id),
      );

      for (const highlight of candidates) {
        resolvedIdsRef.current.add(highlight.id);

        const result = resolveAnchor<RangeLike>({
          tryCfi: () => contents.range(highlight.cfi) as unknown as RangeLike,
          sectionText,
          anchor: highlight,
        });

        if (result.status === "cfi") {
          attachOwnedMark(highlight.id, highlight.cfi, highlight.kind);
        } else if (result.status === "fallback") {
          const range = rangeFromTextOffsets(
            contents.document,
            result.match.start,
            result.match.end,
          );
          if (range) {
            attachOwnedMark(highlight.id, contents.cfiFromRange(range), highlight.kind);
          } else {
            markUnanchored(highlight.id);
          }
        } else {
          markUnanchored(highlight.id);
        }
      }
    }

    function handleRelocated(location: Location) {
      currentCfiRef.current = location.start.cfi;
      setAtStart(Boolean(location.atStart));
      setAtEnd(Boolean(location.atEnd));
      setCurrentSpineIndex(location.start.index);
      const pct = location.start.percentage;

      // M19.6 operator feedback (decisions.md 2026-07-30 later): epub.js's
      // own displayed.page/total are single-column indices — divide out the
      // manager's real spread divisor so "one spread = one page" (see
      // bookPages.ts). This is also what fixes the display reaching e.g.
      // "page 7 of 8" one turn before the chapter actually ends — that was
      // never a skipped page, just an un-adjusted odd column index against
      // an always-even raw total.
      const divisor = getSpreadDivisor(rendition);
      const displayed = location.start.displayed;
      let chapterPage: number | null = null;
      let chapterTotal: number | null = null;
      if (displayed && typeof displayed.page === "number" && typeof displayed.total === "number") {
        chapterPage = toSpreadAdjustedPage(displayed.page, divisor);
        chapterTotal = toSpreadAdjustedTotal(displayed.total, divisor);
        setDisplayedPage({ page: chapterPage, total: chapterTotal });
      }

      // Book-wide page count + percentage, click-accurate (bookPages.ts) —
      // replaces the character-location index the operator found jumped
      // unevenly per turn. Falls back to the character-based percent below
      // until the section-weight fetch resolves.
      let usedPageBasedPercent = false;
      if (chapterPage !== null && chapterTotal !== null) {
        sectionRealPagesRef.current.set(location.start.index, chapterTotal);
        const weights = sectionWeightRef.current;
        if (weights) {
          const info = computeBookPageInfo(
            weights,
            sectionRealPagesRef.current,
            location.start.index,
            chapterPage,
          );
          if (info) {
            setBookPage(info);
            setProgressPercent(Math.round((info.page / info.total) * 100));
            usedPageBasedPercent = true;
          }
        }
      }
      if (!usedPageBasedPercent && typeof pct === "number") {
        setProgressPercent(Math.round(pct * 100));
      }

      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        savePosition(
          resourceId,
          location.start.cfi,
          location.start.index,
          typeof pct === "number" ? pct * 100 : null,
        );
      }, POSITION_SAVE_DEBOUNCE_MS);
    }
    rendition.on("relocated", handleRelocated);

    function handleRendered(_section: unknown, view: unknown) {
      const contents = (view as ViewWithContents).contents;
      if (contents) resolveHighlightsForSection(contents);
    }
    rendition.on("rendered", handleRendered);

    function handleSelected(cfiRange: string, contents: Contents) {
      const selection = contents.window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (range.collapsed) return;
      const exact = range.toString();
      if (!exact.trim()) return;

      const { prefix, suffix } = getSelectionContext(
        contents.document,
        range,
        SELECTION_CONTEXT_MAX_LEN,
      );

      const iframeEl = contents.document.defaultView?.frameElement as
        | HTMLElement
        | null
        | undefined;
      const container = containerRef.current;
      if (!iframeEl || !container) return;

      const iframeRect = iframeEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const rangeRect = range.getBoundingClientRect();

      const rawLeft =
        iframeRect.left + rangeRect.left + rangeRect.width / 2 - containerRect.left;
      const rawTop = iframeRect.top + rangeRect.top - containerRect.top;

      setPendingSelection({
        cfi: cfiRange,
        exact,
        prefix,
        suffix,
        spineIndex: contents.sectionIndex,
        contents,
        // Clamp so a selection right at the edge of the visible page can't
        // push the pill (which renders above the selection) off-screen.
        left: Math.min(Math.max(rawLeft, 40), containerRect.width - 40),
        top: Math.max(rawTop, 40),
      });
    }
    rendition.on("selected", handleSelected);

    function handleMarkClicked(_cfiRange: string, data: { highlightId?: string }) {
      // A click on a highlight mark also fires as a content 'click' below —
      // handleContentClick's own mark hit-test (M19.6) is what keeps that
      // from also turning the page. Clicking a highlight expands its thread.
      if (data.highlightId) {
        setExpandedThread({ highlightId: data.highlightId, top: DEFAULT_THREAD_PANEL_TOP });
      }
    }
    rendition.on("markClicked", handleMarkClicked);

    // M19.6 "clicking a highlight never turns the page": shared by the
    // click handler below and the hover boost further down — marks-pane
    // draws every mark `pointer-events: none` (its own library default, not
    // ours; see NOTES.md M16), so native hit-testing of a click's `target`
    // can never see a mark either. Both need the exact same geometric
    // rect-vs-viewport-point test, so it lives once here.
    function findMarkAtViewportPoint(viewportX: number, viewportY: number): SVGElement | null {
      const container = containerRef.current;
      if (!container) return null;
      const rects = container.querySelectorAll<SVGRectElement>(
        `.${HIGHLIGHT_MARK_CLASS} rect`,
      );
      for (const rect of rects) {
        const r = rect.getBoundingClientRect();
        if (viewportX >= r.left && viewportX <= r.right && viewportY >= r.top && viewportY <= r.bottom) {
          return rect.closest<SVGElement>(`.${HIGHLIGHT_MARK_CLASS}`);
        }
      }
      return null;
    }

    function handleContentClick(event: MouseEvent, contents: Contents) {
      const target = event.target as HTMLElement | null;
      // Old Gutenberg-style markup often has unclosed `<a id="...">` bookmark
      // anchors (no href) that end up wrapping whole chapters per lenient
      // HTML parsing — only treat *navigable* links as click-through targets.
      if (target?.closest("a[href]")) return;
      if (contents.window.getSelection()?.toString()) return;
      setPendingSelection(null);

      // epub.js's paginated flow renders the whole section into one wide
      // multi-column iframe and reveals the current page via scroll offset,
      // so event.clientX is relative to that wide canvas, not the visible
      // viewport. Translate through the iframe's own screen position to get
      // a coordinate relative to our (viewport-sized) container instead.
      const iframeEl = contents.document.defaultView?.frameElement as
        | HTMLElement
        | null
        | undefined;
      const container = containerRef.current;
      if (!iframeEl || !container) return;

      const iframeRect = iframeEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // A click that lands on a highlight mark is that mark's own action
      // (handleMarkClicked, above) — never a page turn, even inside a turn
      // zone. Viewport-relative coordinates (not container-relative
      // visibleX below), since that's what the marks' own
      // getBoundingClientRect() is in.
      if (findMarkAtViewportPoint(iframeRect.left + event.clientX, iframeRect.top + event.clientY)) {
        return;
      }

      const visibleX = iframeRect.left + event.clientX - containerRect.left;
      const zone = turnZoneForVisibleX(visibleX, containerRect.width);

      if (zone === "prev") turnPageRef.current("prev");
      else if (zone === "next") turnPageRef.current("next");
    }
    rendition.on("click", handleContentClick);

    // M11 semicircular turn zones (DESIGN.md 2026-07-20 entry): a directional
    // cursor and a soft vignette announce the click-turn zones above without
    // adding an interactive overlay over the iframe — that would kill text
    // selection. The cursor is written straight onto the iframe's own body
    // (the one thing we're allowed to touch from in here); the vignette is a
    // pointer-events:none sibling in the parent document, driven by this
    // same hover state.
    function handleContentMouseMove(event: MouseEvent, contents: Contents) {
      const iframeEl = contents.document.defaultView?.frameElement as
        | HTMLElement
        | null
        | undefined;
      const container = containerRef.current;
      if (!iframeEl || !container) return;

      const iframeRect = iframeEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const viewportX = iframeRect.left + event.clientX;
      const viewportY = iframeRect.top + event.clientY;
      const visibleX = viewportX - containerRect.left;
      const zone = focusModeRef.current
        ? null
        : turnZoneForVisibleX(visibleX, containerRect.width);

      lastContentsWithCursorRef.current = contents;
      contents.document.body.style.cursor =
        zone === "prev" ? "w-resize" : zone === "next" ? "e-resize" : "";
      setTurnZoneHover((prev) => (prev === zone ? prev : zone));

      // M16 "highlights pop on hover": marks-pane's SVG overlay is
      // pointer-events:none (its own library default), so real CSS :hover
      // can never reach it; native hit-testing skips straight through to
      // the iframe underneath. Detected here instead, via the same
      // forwarded-mousemove coordinates already used for the turn-zone
      // cursor above and the same geometric test handleContentClick uses
      // (findMarkAtViewportPoint, defined alongside it above) — a plain
      // inline-style boost on the matched element, cleared on the next
      // non-matching move.
      if (!focusModeRef.current) {
        const hit = findMarkAtViewportPoint(viewportX, viewportY);
        if (hit !== hoveredMarkElRef.current) {
          clearMarkHover();
          if (hit) {
            // Scale the mark's own base wash up rather than replacing it —
            // reads the group's real fill-opacity presentation attribute
            // (markStyleForKind sets fill/fill-opacity/mix-blend-mode on the
            // `.marginalia-highlight` group itself, not the child `<rect>`;
            // 0.22 on paper, 0.34 on ink) rather than assuming a fixed
            // starting point.
            const baseOpacity = Number.parseFloat(hit.getAttribute("fill-opacity") ?? "0.22") || 0.22;
            const boosted = Math.min(baseOpacity * HOVER_OPACITY_MULTIPLIER, HOVER_OPACITY_MAX);
            hit.style.fillOpacity = String(boosted);
            hoveredMarkElRef.current = hit;
          }
        }
      }

      // M19.6 "highlight across a page boundary": armed only while a real
      // drag-selection is in progress (button down + a non-empty window
      // selection) *and* the cursor sits in a turn zone. Re-arms itself on
      // whatever zone the cursor is in this tick — dwellZoneRef !== zone
      // covers both "just entered a zone" and "completeDwell just cleared
      // it after a turn, still holding at the edge" the same way.
      if (isPointerDownInContentRef.current && zone && !focusModeRef.current) {
        const hasActiveSelection = Boolean(contents.window.getSelection()?.toString());
        if (hasActiveSelection) {
          if (dwellZoneRef.current !== zone) {
            startDwell(zone, viewportX, viewportY);
          } else {
            setDwellRing((prev) => (prev && !prev.refused ? { ...prev, x: viewportX, y: viewportY } : prev));
          }
        } else if (dwellZoneRef.current) {
          cancelDwell();
        }
      } else if (dwellZoneRef.current) {
        cancelDwell();
      }

      // M14 fullscreen: the same forwarded mousemove reveals the floating
      // top row / footer / margin rail on proximity — the reveal bands are
      // top/bottom only (never the left/right turn-zone strips above). Must
      // use true *viewport* coordinates, not container-relative ones: the
      // container element is taller than the iframe's own rendered content
      // (extra vertical space for pagination), so a container-relative
      // "near bottom" threshold is never reachable from inside the iframe —
      // found live, see NOTES.md "M14". The window-level listener below
      // covers the dead zone where the cursor is over the parent document
      // (above/below/beside the iframe) instead of inside it.
      if (fullscreenModeRef.current) {
        const nearTop = viewportY < FULLSCREEN_REVEAL_BAND_PX;
        const nearBottom = viewportY > window.innerHeight - FULLSCREEN_REVEAL_BAND_PX;
        const nearRailCorner =
          nearTop && viewportX > window.innerWidth * (1 - FULLSCREEN_RAIL_CORNER_FRACTION);
        setRevealTop((prev) => (prev === nearTop ? prev : nearTop));
        setRevealBottom((prev) => (prev === nearBottom ? prev : nearBottom));
        setRevealRail((prev) => (prev === nearRailCorner ? prev : nearRailCorner));
      }
    }
    rendition.on("mousemove", handleContentMouseMove);

    // M19.6 "highlight across a page boundary": DWELL_DURATION_MS matches
    // the task's own "~2s" acceptance; REFUSAL_FLASH_MS is a quick,
    // legible "no" — long enough to register, short enough not to feel
    // like a second dwell.
    function startDwell(zone: "prev" | "next", x: number, y: number) {
      dwellZoneRef.current = zone;
      dwellKeyRef.current += 1;
      setDwellRing({ dwellKey: dwellKeyRef.current, x, y, refused: false });
      dwellTimerRef.current = window.setTimeout(() => {
        completeDwell(zone);
      }, DWELL_DURATION_MS);
    }

    function completeDwell(zone: "prev" | "next") {
      dwellTimerRef.current = undefined;
      const displayed = displayedPageRef.current;
      if (!displayed) {
        cancelDwell();
        return;
      }

      // ⚠️ Not re-derived here — decisions.md 2026-07-30 later's own
      // diagnostic (this task's required precondition) confirmed live that
      // rendition.next()/prev() across a section boundary destroys the
      // selection outright (a fresh iframe document). Refuse *before*
      // calling it, rather than calling it and discovering the selection
      // is gone — the existing selection must stay intact.
      const atSectionEnd = zone === "next" && displayed.page >= displayed.total;
      const atSectionStart = zone === "prev" && displayed.page <= 1;
      if (atSectionEnd || atSectionStart) {
        dwellZoneRef.current = null;
        setDwellRing((prev) => (prev ? { ...prev, refused: true } : prev));
        window.setTimeout(() => setDwellRing(null), REFUSAL_FLASH_MS);
        return;
      }

      // No curl/slide animation on purpose: those swap in a rasterized
      // snapshot mid-turn, which would visually cover the very selection
      // this gesture exists to keep continuing under the reader's cursor.
      // A plain, immediate rendition call keeps the live DOM (and the
      // native selection anchored to it) visible throughout.
      const turn = zone === "next" ? renditionRef.current?.next() : renditionRef.current?.prev();
      void turn?.then(() => {
        // Still holding at the edge with a live selection — the very next
        // mousemove re-arms a fresh dwell for the next page on its own
        // (dwellZoneRef is cleared here, so that arming logic doesn't see
        // a stale zone and skip it); no self-rescheduling timer needed.
        dwellZoneRef.current = null;
        setDwellRing(null);
      });
    }

    function handleContentMouseDown() {
      isPointerDownInContentRef.current = true;
    }
    rendition.on("mousedown", handleContentMouseDown);

    function handleContentMouseUp() {
      isPointerDownInContentRef.current = false;
      cancelDwell();
    }
    rendition.on("mouseup", handleContentMouseUp);
    // A drag started inside the iframe can end with the pointer released
    // over the parent document's own chrome (margin, footer, rail) — the
    // forwarded "mouseup" above only ever fires for a release *inside* the
    // iframe content, so this is the same belt-and-braces window-level
    // fallback M10's drag-to-peel and M12's scrub dial already rely on.
    window.addEventListener("mouseup", handleContentMouseUp);

    // The shared shortcut registry (useShortcuts, above) only ever sees
    // window-level keydowns — epub.js's own iframe is a separate document,
    // so a keypress inside it never bubbles to window at all. This forwards
    // exactly the same set of keys, via the exact same handlers, from
    // epub.js's own "keydown" event (which it re-emits from inside the
    // iframe for precisely this reason) — the one bit of unavoidable
    // duplication between the two paths.
    function handleIframeKeydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT" ||
        target?.isContentEditable;

      if (isTyping) return;

      if (event.key === "ArrowLeft") handleArrowLeftShortcut();
      else if (event.key === "ArrowRight") handleArrowRightShortcut();
      else if (event.key === "[") handleChapterPrevShortcut();
      else if (event.key === "]") handleChapterNextShortcut();
      else if (event.key === "Escape") handleEscapeShortcut();
      else if (
        event.key.toLowerCase() === "f" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        // M14: fullscreen (shift+F) is a different axis from focus mode
        // (f) — they hide different things and compose independently.
        if (event.shiftKey) toggleFullscreen();
        else handleFocusModeShortcut();
      }
    }
    rendition.on("keydown", handleIframeKeydown);

    book.ready
      .then(async () => {
        if (cancelled) return;
        const [position, resourceHighlights, cachedLocations, sectionWeights] = await Promise.all([
          fetchPosition(resourceId),
          fetchHighlights(resourceId),
          fetchCachedLocations(resourceId),
          fetchSectionWeights(resourceId),
        ]);
        if (sectionWeights) sectionWeightRef.current = sectionWeights;
        if (cancelled) return;
        highlightsRef.current = resourceHighlights;
        setHighlights(resourceHighlights);

        const jumpTarget = initialHighlightId
          ? resourceHighlights.find((h) => h.id === initialHighlightId)
          : undefined;
        // M19.5 posed-question anchors carry a deliberately-unparseable CFI
        // (see UNRESOLVABLE_CHAPTER_ANCHOR_CFI's own comment) — safe for the
        // mark-rendering fallback, but rendition.display() parses a CFI
        // directly rather than catching a failure, so handing it one here
        // would risk crashing epub.js's navigation. Fall back to the saved
        // position instead; the thread panel below still opens regardless.
        const displayTarget =
          jumpTarget && jumpTarget.cfi !== UNRESOLVABLE_CHAPTER_ANCHOR_CFI ? jumpTarget.cfi : undefined;

        await rendition.display(displayTarget ?? position?.location ?? undefined);
        if (cancelled) return;
        setStatus("ready");
        if (jumpTarget) {
          setExpandedThread({
            highlightId: jumpTarget.id,
            top: DEFAULT_THREAD_PANEL_TOP,
            initialDraft: initialQuestion,
          });
        }

        // Locations let epub.js compute a whole-book percentage from a CFI
        // (and, per M19.6, a stable book-wide page number); generating them
        // is async, so the initial relocated event may fire before
        // percentages are available — recompute once ready via
        // reportLocation(). M12's table of contents also needs locations
        // (chapter-start percents are derived from them, see toc.ts), so
        // build it here too.
        // M19.6 "page numbers, book-wide and stable": resources are
        // immutable-on-import (settled decision 5), so a cached blob from a
        // prior open can never rot — `load()` is synchronous and cheap
        // (unlike `generate()`, which walks every section) and skips
        // regenerating this book's locations ever again. Cache miss falls
        // back to the original generate()-then-save() path.
        if (cachedLocations) {
          book.locations.load(cachedLocations);
          rendition.reportLocation();
          setToc(buildToc(book));
        } else {
          book.locations.generate(LOCATIONS_CHAR_STEP).then(() => {
            if (cancelled) return;
            rendition.reportLocation();
            setToc(buildToc(book));
            saveCachedLocations(resourceId, book.locations.save());
          });
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(saveTimerRef.current);
      window.clearTimeout(redisplayTimer);
      window.clearTimeout(dwellTimerRef.current);
      window.removeEventListener("mouseup", handleContentMouseUp);
      resizeObserver.disconnect();
      renditionRef.current = null;
      bookRef.current = null;
      rendition.destroy();
      book.destroy();
    };
    // themeVars intentionally excluded — handled by the effect below so
    // toggling the theme doesn't tear down and reload the whole book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  useEffect(() => {
    if (!renditionRef.current) return;
    applyTheme(renditionRef.current, themeVars);

    // Re-tint every already-attached mark: fill-opacity/blend-mode differ
    // between paper and ink (see highlightKinds.ts), so a highlight created
    // under one theme must repaint when the user toggles to the other —
    // and reading focus mode needs the same repaint to hide/reveal marks.
    // annotations.highlight() doesn't update an existing mark in place —
    // it stacks a new one — so each mark is removed and re-added. Only the
    // mark's owner (see cfiOwnersRef) is touched — a co-owner sharing the
    // same CFI has no epub.js-level mark of its own to re-tint.
    for (const highlight of highlightsRef.current) {
      const cfi = attachedCfiRef.current.get(highlight.id);
      if (!cfi || !isMarkOwner(highlight.id, cfi)) continue;
      renditionRef.current.annotations.remove(cfi, "highlight");
      renditionRef.current.annotations.highlight(
        cfi,
        { highlightId: highlight.id },
        undefined,
        HIGHLIGHT_MARK_CLASS,
        markStyleForKind(highlight.kind, themeVars, focusMode),
      );
    }
  }, [themeVars, focusMode]);

  // M16 "reading text size": applied through the epub theme
  // (`themes.fontSize`, which patches already-rendered content immediately —
  // see the epub.js Themes#override source), plus the same gap-recompute +
  // debounced re-display the margin-change bug fix above uses, since
  // fontScale moves the target column width without the container's own box
  // size ever changing (so the ResizeObserver in the book-loading effect has
  // nothing to fire on). Skipped on the very first mount before a rendition
  // exists — the mount-time gap/fontSize calls already used whatever
  // fontScaleRef held at that point.
  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes.fontSize(`${Math.round(readerFontScale * 100)}%`);
    applyGapForWidthRef.current();
  }, [readerFontScale]);

  // M7's dip-and-recover slide — kept as the fallback under reduced motion,
  // when a curl's snapshot capture fails, and (via lowFpsRef below) once the
  // curl has proven itself too slow on this device.
  const turnPageSlide = useCallback(
    async (direction: "prev" | "next") => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      if (stageReducedMotion) {
        if (direction === "prev") rendition.prev();
        else rendition.next();
        return;
      }
      const dx = direction === "next" ? -6 : 6;
      await stageControls.start({
        opacity: 0.55,
        x: dx,
        transition: { duration: 0.09, ease: "easeOut" },
      });
      if (direction === "prev") rendition.prev();
      else rendition.next();
      await stageControls.start({
        opacity: 1,
        x: 0,
        transition: { duration: 0.13, ease: "easeOut" },
      });
    },
    [stageControls, stageReducedMotion],
  );

  // M10's snapshot-based 3D curl (DESIGN.md "the epub.js constraint"): the
  // departing page is rasterized to a bitmap (pageSnapshot.ts) that curls
  // away on its own 3D plane — the marks-pane SVG overlay rides along for
  // free because it's baked into the same texture (it's a DOM sibling of
  // the iframe inside the captured container, not inside the iframe — see
  // NOTES.md M2/M3 friction). The live DOM underneath is swapped to the new
  // page *before* the curl plays, hidden behind the snapshot, so "swap to
  // live DOM on settle" (TASKS.md) falls out of the overlay's own fade —
  // no separate snapshot of the incoming page is needed.
  const turnPageCurl = useCallback(
    async (direction: "prev" | "next") => {
      const rendition = renditionRef.current;
      const container = containerRef.current;
      if (!rendition || !container) return;

      const src = await capturePageSnapshot(container);
      if (!src) {
        await turnPageSlide(direction);
        return;
      }

      curlProgress.set(0);
      setCurl({ src, direction });

      if (direction === "prev") await rendition.prev();
      else await rendition.next();
      // Let epub.js actually paint the new section before revealing it —
      // the snapshot is still covering the stage at full opacity.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const frameTimestamps: number[] = [];
      await animate(curlProgress, 1, {
        duration: 0.42,
        ease: [0.4, 0, 0.2, 1],
        onUpdate: () => {
          frameTimestamps.push(performance.now());
        },
      });
      setCurl(null);

      if (frameTimestamps.length > 2) {
        const span =
          frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0];
        const avgFrameMs = span / (frameTimestamps.length - 1);
        // ~30fps or worse, sustained through a full turn — stop paying for
        // snapshot capture + a 3D transform and use the cheap slide instead.
        if (avgFrameMs > 33) lowFpsRef.current = true;
      }
    },
    [curlProgress, turnPageSlide],
  );

  const turnPage = useCallback(
    async (direction: "prev" | "next") => {
      if (turnLockRef.current) return;
      turnLockRef.current = true;
      try {
        if (stageReducedMotion || lowFpsRef.current) {
          await turnPageSlide(direction);
        } else {
          await turnPageCurl(direction);
        }
      } finally {
        turnLockRef.current = false;
      }
    },
    [stageReducedMotion, turnPageSlide, turnPageCurl],
  );

  useEffect(() => {
    turnPageRef.current = (direction) => {
      void turnPage(direction);
    };
  }, [turnPage]);

  // M12: chapter stepping sequence (one per spine index, deduped) and which
  // of them governs the current position — the single source both the
  // ChapterNav cluster and the `[`/`]` shortcuts step through.
  const chapterStopsList = deriveChapterStops(toc);
  const activeChapter = deriveCurrentChapter(chapterStopsList, currentSpineIndex);
  const activeChapterStopIndex = activeChapter
    ? chapterStopsList.findIndex((s) => s.href === activeChapter.href)
    : -1;
  const hasPrevChapter = activeChapterStopIndex > 0;
  const hasNextChapter =
    activeChapterStopIndex >= 0 && activeChapterStopIndex < chapterStopsList.length - 1;

  function jumpToChapter(direction: "prev" | "next") {
    const targetIndex = activeChapterStopIndex + (direction === "next" ? 1 : -1);
    const target = chapterStopsList[targetIndex];
    if (target) void renditionRef.current?.display(target.href);
  }

  useEffect(() => {
    chapterJumpRef.current = jumpToChapter;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapterStopIndex, chapterStopsList.length]);

  function handleTocSelect(entry: TocEntry) {
    void renditionRef.current?.display(entry.href);
  }

  async function handleDigestChapter() {
    if (currentSpineIndex === null || digestingChapter) return;
    setDigestingChapter(true);
    setDigestChapterResult(null);
    try {
      const res = await fetch(`/api/resources/${resourceId}/digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spineStart: currentSpineIndex, spineEnd: currentSpineIndex }),
      });
      setDigestChapterResult(res.ok ? "Digested ✓" : "Digest failed");
    } catch {
      setDigestChapterResult("Digest failed");
    } finally {
      setDigestingChapter(false);
      window.setTimeout(() => setDigestChapterResult(null), 4000);
    }
  }

  /** Resolve a previewed percent to a CFI and actually move the book —
   * shared commit path for pointer-drag release, keyboard Enter, and (were
   * it ever wired up) any future entry point. Only ever called on commit,
   * never per-frame while dragging (SPEC acceptance). */
  function commitScrub(percent: number) {
    const book = bookRef.current;
    const rendition = renditionRef.current;
    setScrubPreviewPercent(null);
    if (!book || !rendition) return;
    const cfi = book.locations.cfiFromPercentage(percent / 100);
    void rendition.display(cfi);
  }

  function handleProgressPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (progressPercent === null) return;
    const targetEl = event.currentTarget;
    targetEl.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startPercent = progressPercent;
    // Captured once, not re-read at pointerup — the popover may already
    // have closed itself (e.g. Escape) mid-gesture, and toggling off a
    // *stale* "was open" read would just flip it back open.
    const wasOpenAtStart = progressPopoverOpen;
    let dragging = false;
    let livePercent = startPercent;
    // M14 (decisions.md 2026-07-27): at DIAL_PX_PER_PERCENT px/%, a full
    // 0-100% sweep needs more travel than any screen position can provide in
    // both directions — pointer lock makes travel unbounded by reporting
    // relative `movementX` instead of an absolute `clientX`. `dx` is the
    // single running total driven by whichever source is currently active;
    // `lockEngaged` gates *which* source, and skips folding in movementX on
    // the very first locked frame so the switchover has no visible jump.
    let dx = 0;
    let lockEngaged = false;

    function onMove(moveEvent: PointerEvent) {
      if (!dragging) {
        if (Math.abs(moveEvent.clientX - startX) <= SCRUB_DRAG_THRESHOLD_PX) return;
        dragging = true;
        // A real drag always supersedes the click-popover, whether or not
        // it happened to be open already.
        setProgressPopoverOpen(false);
        dx = moveEvent.clientX - startX;
        // Can be refused (some browsers gate it behind a user gesture
        // chain) — the absolute clientX math below stays correct either
        // way, since it's what already ran before lock ever engages.
        targetEl.requestPointerLock?.();
      } else if (document.pointerLockElement === targetEl) {
        if (lockEngaged) dx += moveEvent.movementX;
        lockEngaged = true;
      } else {
        dx = moveEvent.clientX - startX;
      }
      livePercent = clampPercent(startPercent + dx / DIAL_PX_PER_PERCENT);
      setScrubPreviewPercent(livePercent);
    }

    function releasePointerLock() {
      if (document.pointerLockElement === targetEl) document.exitPointerLock?.();
    }

    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDuringDrag, true);
      releasePointerLock();
      // M16 bug fix: a gesture that *began* with a pointer (this handler is
      // only ever bound to onPointerDown) must release DOM focus on both
      // commit and cancel, or the button keeps focus and its onKeyDown below
      // keeps stealing ←/→ for dial-stepping instead of page turns. A
      // control focused by an actual Tab keypress never runs this pointer
      // handler at all, so its arrow-stepping path is untouched.
      targetEl.blur();
    }

    function onUp() {
      cleanup();
      if (dragging) commitScrub(livePercent);
      // A plain click toggles the popover from whatever it was when this
      // gesture started.
      else setProgressPopoverOpen(!wasOpenAtStart);
    }

    function onKeyDuringDrag(keyEvent: KeyboardEvent) {
      if (keyEvent.key !== "Escape") return;
      keyEvent.stopPropagation();
      dragging = false;
      setScrubPreviewPercent(null);
      cleanup();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Capture phase: must win over the reader's window-level Escape handler
    // (clears selection/thread) — cancelling the drag is what Escape means
    // here, not that.
    window.addEventListener("keydown", onKeyDuringDrag, true);
  }

  function handleProgressKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      const base = scrubPreviewPercent ?? progressPercent ?? 0;
      const step = event.key === "ArrowRight" ? SCRUB_KEYBOARD_STEP_PERCENT : -SCRUB_KEYBOARD_STEP_PERCENT;
      setProgressPopoverOpen(false);
      setScrubPreviewPercent(clampPercent(base + step));
    } else if (event.key === "Enter" && scrubPreviewPercent !== null) {
      event.preventDefault();
      event.stopPropagation();
      commitScrub(scrubPreviewPercent);
    } else if (event.key === "Escape" && scrubPreviewPercent !== null) {
      event.preventDefault();
      event.stopPropagation();
      setScrubPreviewPercent(null);
    }
  }

  // Stretch: drag-to-peel. Grabbing the page's edge (a thin strip, not the
  // wider 30% click-turn zones inside the iframe content) tracks the
  // pointer's horizontal movement into curlProgress directly, live; release
  // either commits the turn (animating the rest of the way) or springs back
  // to flat. Shares curlProgress/curl/turnLockRef with the click-triggered
  // curl above — same visual, driven a different way.
  const handleEdgePointerDown = useCallback(
    (direction: "prev" | "next", event: React.PointerEvent<HTMLDivElement>) => {
      if (turnLockRef.current || stageReducedMotion) return;
      const container = containerRef.current;
      const activeRendition = renditionRef.current;
      if (!container || !activeRendition) return;

      // Without this, the drag's pointermove/up events are only guaranteed
      // to reach this handler while the pointer stays over the 18px grab
      // strip — the moment the drag crosses into the epub.js iframe next to
      // it (the whole point of a page-edge drag gesture), the browser hands
      // raw pointer events to that iframe's own document instead. Found live
      // (NOTES.md M10): with a real Chromium pointer drag, that leaked into
      // epub.js's sandboxed (`allow-scripts` intentionally absent —
      // `allowScriptedContent: false`) content in a way that crashed the
      // tab outright, not just misbehaved. Capturing the pointer keeps every
      // event routed to this element regardless of where the cursor
      // physically travels, same as native drag/resize handles.
      event.currentTarget.setPointerCapture(event.pointerId);

      turnLockRef.current = true;
      const startX = event.clientX;
      const stageWidth = container.getBoundingClientRect().width || 1;
      const dragRange = Math.max(stageWidth * 0.6, 120);
      let src: string | null = null;

      capturePageSnapshot(container).then((snapshot) => {
        src = snapshot;
        if (snapshot) {
          curlProgress.set(0);
          setCurl({ src: snapshot, direction });
        }
      });

      const onMove = (moveEvent: PointerEvent) => {
        if (!src) return;
        const dx = moveEvent.clientX - startX;
        const raw = direction === "next" ? -dx : dx;
        curlProgress.set(Math.min(Math.max(raw / dragRange, 0), 1));
      };

      const onUp = async () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);

        const shouldCommit = src !== null && curlProgress.get() > 0.35;
        if (shouldCommit) {
          if (direction === "prev") await activeRendition.prev();
          else await activeRendition.next();
          await animate(curlProgress, 1, { duration: 0.16, ease: "easeOut" });
        } else if (src !== null) {
          await animate(curlProgress, 0, { duration: 0.18, ease: "easeOut" });
        }
        setCurl(null);
        turnLockRef.current = false;
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [curlProgress, stageReducedMotion],
  );

  /** Creates a highlight from the pending selection and attaches its mark;
   * shared by the pill's per-kind dots (no thread) and Ask (slate, opens
   * the thread panel). */
  async function createHighlightFromSelection(
    kind: HighlightKind,
    openThread: boolean,
  ) {
    if (!pendingSelection) return;
    const created = await postHighlight({
      resourceId,
      exact: pendingSelection.exact,
      prefix: pendingSelection.prefix,
      suffix: pendingSelection.suffix,
      cfi: pendingSelection.cfi,
      spineIndex: pendingSelection.spineIndex,
      kind,
    });
    if (created) {
      setHighlights((prev) => [...prev, created]);
      resolvedIdsRef.current.add(created.id);
      // This CFI was just derived from the live, currently-rendered
      // document, so it's trusted without going through resolveAnchor again.
      attachOwnedMark(created.id, created.cfi, created.kind);
      pendingSelection.contents.window.getSelection()?.removeAllRanges();
      if (openThread) {
        // Anchor the panel near the selection itself — the nicest, most
        // literal "visually anchored to the highlight" case (a fresh Ask).
        setExpandedThread({ highlightId: created.id, top: pendingSelection.top });
      }
    }
    setPendingSelection(null);
  }

  function handlePickKind(kind: HighlightKind) {
    void createHighlightFromSelection(kind, false);
  }

  function handleAsk() {
    void createHighlightFromSelection("slate", true);
  }

  async function handleDeleteHighlight(highlight: HighlightWithThread) {
    const ok = await deleteHighlightRequest(highlight.id);
    if (!ok) return;
    setHighlights((prev) => prev.filter((h) => h.id !== highlight.id));
    resolvedIdsRef.current.delete(highlight.id);
    setUnanchoredIds((prev) => {
      if (!prev.has(highlight.id)) return prev;
      const next = new Set(prev);
      next.delete(highlight.id);
      return next;
    });
    const attachedCfi = attachedCfiRef.current.get(highlight.id) ?? highlight.cfi;
    attachedCfiRef.current.delete(highlight.id);
    const remaining = highlightsRef.current.filter((h) => h.id !== highlight.id);
    detachOwnedMark(highlight.id, attachedCfi, remaining);
    setExpandedThread((prev) => (prev?.highlightId === highlight.id ? null : prev));
  }

  function handleNavigateToHighlight(highlight: HighlightWithThread) {
    renditionRef.current?.display(highlight.cfi);
  }

  function handleOpenThread(highlight: HighlightWithThread) {
    setExpandedThread({ highlightId: highlight.id, top: DEFAULT_THREAD_PANEL_TOP });
  }

  /** Annotations overview "jump-to": same as clicking a margin-rail dot,
   * plus closing the overview so the destination isn't obscured. */
  function handleJumpToHighlight(highlight: HighlightWithThread) {
    handleNavigateToHighlight(highlight);
    handleOpenThread(highlight);
    setShowAnnotations(false);
  }

  function handleThreadChange(highlightId: string, thread: ThreadSummary) {
    setHighlights((prev) =>
      prev.map((h) => (h.id === highlightId ? { ...h, thread } : h)),
    );
  }

  function handleImportanceChange(highlightId: string, importance: HighlightImportance) {
    setHighlights((prev) =>
      prev.map((h) => (h.id === highlightId ? { ...h, importance } : h)),
    );
  }

  function handleNoteChange(highlightId: string, note: string) {
    setHighlights((prev) =>
      prev.map((h) => (h.id === highlightId ? { ...h, note } : h)),
    );
  }

  function handlePanelOffsetChange(highlightId: string, panelDx: number, panelDy: number) {
    setHighlights((prev) =>
      prev.map((h) => (h.id === highlightId ? { ...h, panelDx, panelDy } : h)),
    );
  }

  function handlePanelSizeChange(highlightId: string, panelWidth: number, panelHeight: number) {
    setHighlights((prev) =>
      prev.map((h) => (h.id === highlightId ? { ...h, panelWidth, panelHeight } : h)),
    );
  }

  /** The iframe's own mousemove never fires once the pointer leaves it
   * entirely (into the parent document, or out of the window) — this
   * catches that case so the vignette/cursor don't get stuck lit. */
  function handleStagePointerLeave() {
    setTurnZoneHover(null);
    if (lastContentsWithCursorRef.current) {
      lastContentsWithCursorRef.current.document.body.style.cursor = "";
    }
    clearMarkHover();
  }

  const expandedHighlight = expandedThread
    ? highlights.find((h) => h.id === expandedThread.highlightId)
    : undefined;

  // M19.6 "the reading pane is resizable" (decisions.md 2026-07-30 later):
  // the drag-set override (if any) replaces the spread-mode default outright
  // rather than adding to it — one clear number, not a fourth knob stacked
  // on the other three (readerMargin/READER_TARGET_COLUMN_WIDTH/
  // SPREAD_GUTTER already own their own jobs, per decisions.md 2026-07-27).
  const spreadDefaultPaneWidth = fullscreenMode ? 1600 : spreadMode === "auto" ? 1400 : 800;
  const effectivePaneWidth = readerPaneWidth > 0 ? readerPaneWidth : spreadDefaultPaneWidth;

  // Dragging the right edge of a *centered* pane: the row grows/shrinks
  // symmetrically, so the edge under the pointer only moves by half of any
  // width change — doubling the pointer's own delta is what keeps the
  // handle tracking the cursor 1:1 instead of lagging at half speed.
  function handlePaneResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = effectivePaneWidth;
    const startX = event.clientX;
    setPaneWidthDragging(true);

    function onMove(moveEvent: PointerEvent) {
      const delta = (moveEvent.clientX - startX) * 2;
      const next = Math.min(
        Math.max(Math.round(startWidth + delta), READER_PANE_WIDTH_MIN),
        READER_PANE_WIDTH_MAX,
      );
      setReaderPaneWidth(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPaneWidthDragging(false);
      setReaderPaneWidth((current) => {
        saveReaderPaneWidth(current);
        return current;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={wrapperRef}
      className={`${styles.wrapper} ${fullscreenMode ? styles.wrapperFullscreen : ""}`}
      // M12: the single-page reading column is deliberately capped at 800px
      // (M11's comfortable-measure work) — widened here only when the user
      // has opted into spread mode, so there's actually room for epub.js to
      // put two leaves side by side once the window is wide enough (below
      // SPREAD_MIN_WIDTH it still shows one page, just inside a wider box —
      // computeReaderGap's own width check keeps that single page's measure
      // just as comfortable as it would be at the narrower cap). M14
      // fullscreen relaxes the cap further still ("the page grows into the
      // freed space") — this only widens the *stage*, not the actual text
      // measure, since computeReaderGap independently caps the rendered
      // column at READER_TARGET_COLUMN_WIDTH regardless of how wide the
      // stage around it is; a wider stage just means more comfortable
      // whitespace, not wider lines. M19.6 "the reading pane is resizable":
      // effectivePaneWidth (above) overrides this outright once the reader
      // has dragged a size — see the drag handle further down.
      style={
        {
          "--reader-max-width": `${effectivePaneWidth}px`,
        } as CSSProperties
      }
    >
      <div
        className={
          fullscreenMode
            ? `${styles.topRow} ${styles.fullscreenFloating} ${styles.topRowFloating} ${
                revealTop ? styles.revealed : ""
              }`
            : styles.topRow
        }
        onPointerEnter={fullscreenMode ? () => setRevealTop(true) : undefined}
        onPointerLeave={fullscreenMode ? () => setRevealTop(false) : undefined}
      >
        <div className={styles.topRowLeft}>
          {focusMode ? (
            <span className={styles.focusIndicator}>Notes hidden — press F to show</span>
          ) : (
            <button
              type="button"
              className={styles.annotationsButton}
              onClick={() => setShowAnnotations((prev) => !prev)}
            >
              Annotations{highlights.length > 0 ? ` (${highlights.length})` : ""}
              {unanchoredIds.size > 0 && (
                <span className={styles.unanchoredBadge} title="Some highlights couldn't be relocated">
                  {unanchoredIds.size}
                </span>
              )}
            </button>
          )}
        </div>
        <div className={styles.progressWrap}>
          <button
            type="button"
            className={styles.progress}
            disabled={progressPercent === null}
            aria-haspopup="true"
            aria-expanded={progressPopoverOpen}
            onPointerDown={handleProgressPointerDown}
            onKeyDown={handleProgressKeyDown}
          >
            {progressPercent !== null ? `${progressPercent}%` : ""}
          </button>
          <AnimatePresence>
            {scrubPreviewPercent !== null ? (
              <ScrubDial
                key="scrub-dial"
                previewPercent={scrubPreviewPercent}
                chapterLabel={chapterAtPercent(chapterStopsList, scrubPreviewPercent)?.label ?? null}
                chapterStops={chapterStopsList}
              />
            ) : (
              progressPopoverOpen && (
                <ProgressPopover
                  key="progress-popover"
                  percent={progressPercent}
                  page={displayedPage?.page ?? null}
                  totalPages={displayedPage?.total ?? null}
                  chapterLabel={activeChapter?.label ?? null}
                />
              )
            )}
          </AnimatePresence>
        </div>
        <div className={styles.topRowRight}>
          {!focusMode && (
            <>
              <ChapterNav
                toc={toc}
                chapterStops={chapterStopsList}
                currentChapter={activeChapter}
                onSelect={handleTocSelect}
                onPrev={() => jumpToChapter("prev")}
                onNext={() => jumpToChapter("next")}
                hasPrev={hasPrevChapter}
                hasNext={hasNextChapter}
              />
              {currentSpineIndex !== null && (
                <button
                  type="button"
                  className={styles.digestChapterButton}
                  disabled={digestingChapter}
                  onClick={handleDigestChapter}
                  title="Digest just this chapter (M17 spotlight shortcut)"
                >
                  {digestingChapter ? "Digesting…" : digestChapterResult ?? "Digest chapter"}
                </button>
              )}
              <ProviderPickerPopover
                role="query"
                label="Query provider"
                onNavigateToSettings={openSettingsToLLM}
              />
            </>
          )}
        </div>
      </div>

      <div className={styles.readerRow}>
        <div className={styles.stage} ref={stageRef} onPointerLeave={handleStagePointerLeave}>
          <div className={styles.pageClip}>
            <div
              ref={marginWrapperRef}
              className={styles.marginWrapper}
              style={{ "--reader-margin": `${READER_MARGIN_PX[readerMargin]}px` } as CSSProperties}
            >
              <motion.div
                ref={containerRef}
                className={styles.epubContainer}
                animate={stageControls}
              />
            </div>
            {curl && (
              <PageCurl src={curl.src} direction={curl.direction} progress={curlProgress} />
            )}
            {dwellRing && (
              <DwellRing
                key={dwellRing.dwellKey}
                x={dwellRing.x}
                y={dwellRing.y}
                durationMs={DWELL_DURATION_MS}
                refused={dwellRing.refused}
              />
            )}
            {!focusMode && (
              <>
                <div
                  aria-hidden="true"
                  className={`${styles.turnZoneVignette} ${styles.turnZoneVignetteLeft} ${
                    turnZoneHover === "prev" ? styles.turnZoneVignetteVisible : ""
                  }`}
                />
                <div
                  aria-hidden="true"
                  className={`${styles.turnZoneVignette} ${styles.turnZoneVignetteRight} ${
                    turnZoneHover === "next" ? styles.turnZoneVignetteVisible : ""
                  }`}
                />
              </>
            )}
            {status === "ready" && !stageReducedMotion && (
              <>
                <div
                  className={`${styles.edgeGrab} ${styles.edgeGrabLeft}`}
                  aria-hidden="true"
                  onPointerDown={(event) => handleEdgePointerDown("prev", event)}
                />
                <div
                  className={`${styles.edgeGrab} ${styles.edgeGrabRight}`}
                  aria-hidden="true"
                  onPointerDown={(event) => handleEdgePointerDown("next", event)}
                />
              </>
            )}
            {status === "loading" && (
              <div className={styles.overlay}>Loading book…</div>
            )}
            {status === "error" && (
              <div className={styles.overlay}>Couldn't load this book.</div>
            )}
          </div>
          <AnimatePresence>
            {pendingSelection && (
              <AskPill
                key="ask-pill"
                left={pendingSelection.left}
                top={pendingSelection.top}
                onPickKind={handlePickKind}
                onAsk={handleAsk}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {expandedThread && expandedHighlight && (
              <ThreadPanel
                // Remount per highlight — simpler and more robust than
                // threading highlight-identity changes through internal
                // effect dependency arrays for "reset state on switch".
                key={expandedHighlight.id}
                resourceId={resourceId}
                highlightId={expandedHighlight.id}
                highlightExact={expandedHighlight.exact}
                highlightKind={expandedHighlight.kind}
                highlightImportance={expandedHighlight.importance}
                highlightNote={expandedHighlight.note}
                panelDx={expandedHighlight.panelDx}
                panelDy={expandedHighlight.panelDy}
                panelWidth={expandedHighlight.panelWidth}
                panelHeight={expandedHighlight.panelHeight}
                thread={expandedHighlight.thread}
                top={expandedThread.top}
                initialDraft={expandedThread.initialDraft}
                providerConfigured={providerConfigured}
                appBoundsRef={appBoundsRef}
                onClose={() => setExpandedThread(null)}
                onThreadChange={handleThreadChange}
                onImportanceChange={handleImportanceChange}
                onNoteChange={handleNoteChange}
                onPanelOffsetChange={handlePanelOffsetChange}
                onPanelSizeChange={handlePanelSizeChange}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {showAnnotations && (
              <AnnotationsOverview
                key="annotations-overview"
                highlights={highlights}
                unanchoredIds={unanchoredIds}
                onJumpTo={handleJumpToHighlight}
                onDelete={handleDeleteHighlight}
                onClose={() => setShowAnnotations(false)}
              />
            )}
          </AnimatePresence>
          {/* M19.6 "the reading pane is resizable": a single edge handle
              (the task names one, not one per side) — dragging it resizes
              the pane's *outer* measure symmetrically (see
              handlePaneResizePointerDown above), with readerMargin staying
              a proportion inside it, unchanged. Sits outside .pageClip (a
              sibling, not a child) so it's never clipped by that element's
              own overflow:hidden. */}
          <div
            className={`${styles.paneResizeHandle} ${paneWidthDragging ? styles.paneResizeHandleActive : ""}`}
            aria-hidden="true"
            onPointerDown={handlePaneResizePointerDown}
          />
        </div>
        {!focusMode && (
          <div
            className={
              fullscreenMode
                ? `${styles.fullscreenFloating} ${styles.marginRailFloating} ${
                    revealRail ? styles.revealed : ""
                  }`
                : undefined
            }
            onPointerEnter={fullscreenMode ? () => setRevealRail(true) : undefined}
            onPointerLeave={fullscreenMode ? () => setRevealRail(false) : undefined}
          >
            <MarginRail
              highlights={highlights}
              currentSpineIndex={currentSpineIndex}
              unanchoredIds={unanchoredIds}
              onNavigate={handleNavigateToHighlight}
              onDelete={handleDeleteHighlight}
              onOpenThread={handleOpenThread}
            />
          </div>
        )}
      </div>

      <div
        className={
          fullscreenMode
            ? `${styles.footer} ${styles.fullscreenFloating} ${styles.footerFloating} ${
                revealBottom ? styles.revealed : ""
              }`
            : styles.footer
        }
        onPointerEnter={fullscreenMode ? () => setRevealBottom(true) : undefined}
        onPointerLeave={fullscreenMode ? () => setRevealBottom(false) : undefined}
      >
        <button
          type="button"
          className={styles.navButton}
          disabled={atStart}
          aria-label="Previous page"
          onClick={() => turnPage("prev")}
        >
          <ChevronIcon direction="left" />
        </button>
        <PageNumberDisplay
          mode={pageNumberMode}
          bookPage={bookPage?.page ?? null}
          bookTotal={bookPage?.total ?? null}
          chapterPage={displayedPage?.page ?? null}
          chapterTotal={displayedPage?.total ?? null}
        />
        <button
          type="button"
          className={styles.navButton}
          disabled={atEnd}
          aria-label="Next page"
          onClick={() => turnPage("next")}
        >
          <ChevronIcon direction="right" />
        </button>
      </div>
    </div>
  );
}
