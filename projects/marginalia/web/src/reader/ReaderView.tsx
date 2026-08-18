import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type RefObject,
} from "react";
import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
import { AnimatePresence, motion } from "motion/react";
import {
  UNRESOLVABLE_CHAPTER_ANCHOR_CFI,
  findAnchorInText,
  type CreateHighlightBody,
  type CursorStyleChoice,
  type HighlightImportance,
  type HighlightKind,
  type HighlightWithThread,
  type PageNumberMode,
  type PageTransition,
  type ProviderRoleAssignment,
  type ReaderFontScale,
  type ReaderMargin,
  type ReaderPaneWidth,
  type ReadingPosition,
  type SearchHit,
  type SearchMatchMode,
  type Settings,
  type SpreadMode,
  type ThreadSummary,
} from "@marginalia/shared";
import { useJobs } from "../jobs/JobsContext.js";
import { startJobRequest } from "../jobs/jobsApi.js";
import { onSettingsSaved } from "../settings/settingsBus.js";
import { onProviderRolesSaved } from "../settings/providerBus.js";
import { ProviderPickerPopover } from "../settings/ProviderPickerPopover.js";
import { useOpenSettings } from "../settings/useOpenSettings.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useEpubThemeVars, type EpubThemeVars } from "./useEpubThemeVars.js";
import { ChevronIcon } from "./ChevronIcon.js";
import { AudioTransportIcon } from "./AudioTransportIcon.js";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { Slider } from "../controls/Slider.js";
import { resolveAnchor, type RangeLike } from "./anchorResolution.js";
import { getSelectionContext, rangeFromTextOffsets } from "./selectionContext.js";
import { audioTintStyle, hoverFillOpacity, markStyleForKind, searchMarkStyle } from "./highlightKinds.js";
import { FindBar } from "./FindBar.js";
import { useSearchHits } from "../search/useSearchHits.js";
import { hitsForSection, stepFindCursor } from "../search/findCursor.js";
import { locateTextHits } from "../search/hitLocation.js";
import { SearchResultsCard } from "../search/SearchResultsCard.js";
import { buildSearchResultRows, buildSectionSpans, type SectionSpan } from "../search/searchRows.js";
import { usePlayer, type AudioPlayer } from "../audio/usePlayer.js";
import { fetchSectionManifest, updateAudioState } from "../audio/audioApi.js";
import { resolveSegmentIndexForOffset } from "../audio/segmentLookup.js";
import { CastingModal } from "../audio/CastingModal.js";
import { captureOverlayOrigin, type OverlayOrigin } from "../controls/overlayOrigin.js";
import { cursorPastPageText } from "./pageTextEdge.js";
import { PageCurl } from "./PageCurl.js";
import { PageSlide } from "./PageSlide.js";
import { DwellRing } from "./DwellRing.js";
import { AskPill } from "./AskPill.js";
import { MarginRail } from "./MarginRail.js";
import { ThreadPanel } from "../threads/ThreadPanel.js";
import { AnnotationsOverview } from "./AnnotationsOverview.js";
import { buildToc, chapterAtPercent, chapterStops as deriveChapterStops, currentChapter as deriveCurrentChapter, type TocEntry } from "./toc.js";
import { ChapterNav } from "./ChapterNav.js";
import { ProgressPopover } from "./ProgressPopover.js";
import { PageNumberDisplay } from "./PageNumberDisplay.js";
import { ReaderActionsCluster } from "./ReaderActionsCluster.js";
import { NavCluster } from "../app/NavCluster.js";
import {
  buildBookPageMap,
  lookupBookPage,
  recordMeasuredPages,
  type BookPageMap,
} from "./bookPages.js";
import {
  chapterPageFromGeometry,
  installTurnFix,
  readTurnGeometry,
  shownSectionIndex,
  type PaginatedManager,
} from "./pageTurn.js";
import {
  computeReaderGap,
  READER_MARGIN_PX,
  READER_TARGET_COLUMN_WIDTH,
  SPREAD_GUTTER,
  SPREAD_MIN_WIDTH,
  turnZoneForVisibleX,
} from "./readerGeometry.js";
import { usePageTurnAnimation } from "./usePageTurnAnimation.js";
import {
  FULLSCREEN_RAIL_CORNER_FRACTION,
  FULLSCREEN_REVEAL_BAND_PX,
  useFullscreenChrome,
} from "./useFullscreenChrome.js";
import { useReaderPaneWidth } from "./useReaderPaneWidth.js";
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
// M24: the find bar's own mark class — never shares cfiOwnersRef's highlight
// ownership bookkeeping (a search mark and a highlight mark can legitimately
// coexist at the same CFI, same precedent as AUDIO_TINT_MARK_CLASS below)
// and is cleared as a whole rather than diffed, so a repaint is always
// "remove everything this class owns, then draw the current set".
const SEARCH_MARK_CLASS = "marginalia-search-mark";
// M19.6 "hover emphasises without obscuring" (decisions.md 2026-07-30): the
// original bug was switching to mix-blend-mode: normal at a near-opaque fill,
// which turns the wash into paint. Every pass since has stayed in the kind's
// own blend mode (multiply on paper, screen on ink — markStyleForKind) and
// only moved the fill-opacity: "the same wash, more of it". Two rounds of
// scaling the base wash (1.8x, then 2.6x) were both still judged duller than
// the live `::selection` moment right before a highlight is created, so the
// target is now stated outright instead of derived from a multiplier — see
// hoverFillOpacity in highlightKinds.ts.
// M19.6 "highlight across a page boundary": ~2s dwell per the task's own
// acceptance criteria; the refusal flash is a quick, legible "no", not a
// second dwell.
const DWELL_DURATION_MS = 2000;
const REFUSAL_FLASH_MS = 260;

const SCRUB_KEYBOARD_STEP_PERCENT = 1;

// M22.5: the actions cluster's own rendered width (icon-only row: four
// ~32px targets + gaps) plus a margin — below this much room to the right
// of the reading column, it drops below the footer instead of floating
// beside the card.
const READER_ACTIONS_MIN_ROOM_PX = 170;

/** Pixels of ruler movement per whole percentage point — passed once into
 * `Slider` and read from there by both its own drag math and its dial's
 * ruler, so the two can no longer drift apart (M22.5: they were previously
 * a hand-shared constant, and that's exactly how the duplication that hid
 * the response-length slider's bug happened elsewhere). */
const PROGRESS_DRAG_PX_PER_PERCENT = 6;

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

/** epub.js ships no types for its view manager — see pageTurn.ts's own note. */
function managerOf(rendition: Rendition | null): PaginatedManager | undefined {
  return (rendition as unknown as { manager?: PaginatedManager } | null)?.manager;
}

/**
 * Re-measures every highlight overlay against the text it is anchored to.
 *
 * M19.6 operator feedback round 4: the highlight rects are SVG in the *parent*
 * document (marks-pane; NOTES.md M2/M3), positioned from
 * `range.getClientRects()` at the moment the mark is drawn. marks-pane only
 * ever redraws them from its own `Pane.render()`, and epub.js only calls that
 * from `reframe()` — i.e. only when the view's expanded pixel size changes. So
 * any reflow that re-breaks lines *without* changing the total expanded width
 * leaves every overlay frozen at coordinates that no longer describe any text.
 *
 * Measured live, 2026-07-30 (Kafka on the Shore): nudging the iframe's body
 * font-size, with the view's width unchanged at 2050px throughout, moved the
 * " weigh" text from (370.55, 701.72) to (882.75, 0) while its rect stayed at
 * (370.55, 701.72) — an overlay sitting on unrelated text one line below the
 * passage, which is exactly what the operator photographed. A subsequent
 * window resize did *not* repair it, because the expanded width still hadn't
 * changed.
 *
 * Real triggers in this app, all of which now call this: the deferred
 * `themes.fontSize()` once the settings fetch resolves, the gap/column-width
 * recompute behind a margin or text-size change, and web fonts finishing
 * loading after first paint.
 */
function refreshHighlightOverlays(rendition: Rendition | null): void {
  const manager = managerOf(rendition);
  if (!manager) return;
  const views = manager.views as unknown as {
    forEach?: (fn: (view: { pane?: { render(): void } }) => void) => void;
  };
  views.forEach?.((view) => {
    view.pane?.render();
  });
}

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

interface ChapterMeta {
  /** Per-section "how much text does this hold" weight — see below. */
  weights: Map<number, number>;
  /** spineIndex -> the scan/digest's section ordinal ("S<n>", TASKS.md
   * M20.5 "S<n> is the only number that appears in any UI") — the reader's
   * own chapter nav needs this so the same section shows the same number
   * there as it does in the digest, the scan axis, and the range dials. */
  chapterNumbers: Map<number, number>;
}

// M19.6 operator feedback (decisions.md 2026-07-30 later): bookPages.ts's
// estimate for not-yet-visited sections needs a cheap per-section "how much
// text does this hold" weight. The Scan (annotations/scan.ts) already
// computes exactly this — and the section-ordinal numbering M20.5 needs —
// from the same immutable, server-cached `resource_text` extraction, reused
// rather than duplicated (twice over, now) at the cost of fetching a
// payload that also carries highlights/themes this reader doesn't need.
async function fetchChapterMeta(resourceId: string): Promise<ChapterMeta | null> {
  try {
    const res = await fetch(`/api/resources/${resourceId}/scan`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chapters?: { spineIndex: number; lengthPercent: number; chapterNumber: number }[];
    };
    if (!data.chapters || data.chapters.length === 0) return null;
    return {
      weights: new Map(data.chapters.map((c) => [c.spineIndex, c.lengthPercent])),
      chapterNumbers: new Map(data.chapters.map((c) => [c.spineIndex, c.chapterNumber])),
    };
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
  /** M20.7 "the opening": fires once `rendition.display()` has resolved on
   * the saved (or jumped-to) position — the exact moment there's no longer
   * a risk of the book-opening overlay revealing a flash of the wrong page
   * or the plain "Loading book…" text underneath it. */
  onReady?: () => void;
  /** M21 "Listen" entry point (desk hover strip / list view): start
   * listening from wherever the book opens, once it's actually open. */
  initialAutoplay?: boolean;
  /** M22.5 "the reader's action cluster never overlaps the card": Digest,
   * Scan and Publish moved out of `ReaderPage`'s title bar into
   * `ReaderActionsCluster`, rendered from in here (so it can be positioned
   * against `.stage`/fullscreen state this component already owns) — but
   * the click handlers stay owned by `ReaderPage`, alongside the publish
   * toast and the scan shortcut's own focus target. */
  onOpenDigest: (event: ReactMouseEvent<HTMLElement>) => void;
  onOpenScan: (event: ReactMouseEvent<HTMLElement>) => void;
  onPublish: () => void;
  publishing: boolean;
  scanButtonRef: RefObject<HTMLButtonElement>;
  /** M22.6 "each of the four keycaps is advertised where its control is":
   * `q`'s focus-before-open target already existed as `scanButtonRef`; `g`
   * gets the same treatment now that the Digest has a binding too. */
  digestButtonRef: RefObject<HTMLButtonElement>;
  /** M22.5 "the opening actually opens": exposes the `.stage` node —
   * the reading pane's own rect — so `BookOpening` can measure it once the
   * reader has landed and animate the revealed spread onto it. Optional:
   * only `ReaderPage` (the real book-opening flow) passes one.
   * `MutableRefObject`, not `RefObject`: this component writes to it. */
  stageRef?: MutableRefObject<HTMLDivElement | null>;
  /** M24 "the reader never hands off to the Scan on its own" — the other
   * direction does exist: the Scan's own search cursor opens the reader
   * through this, the same `jumpToHighlightId` airlock's sibling for a hit
   * that may not be a highlight at all. Opens the find bar pre-filled and
   * jumps straight to that hit once its own search request resolves. */
  initialFindQuery?: string;
  initialFindHitIndex?: number;
  /** M24.1 C: the matching rule arrives with the query, so a handoff from
   * the Scan lands on the same result set it was looking at rather than
   * silently re-searching under a different rule. */
  initialFindMatchMode?: SearchMatchMode;
  /** Carries the find bar's live query, matching rule and cursor to the Scan
   * when the reader's "see in Scan" affordance fires — never called any
   * other way (TASKS.md M24 A: "not the default and not automatic"). */
  onFindHandoffToScan?: (
    query: string,
    cursorHitIndex: number,
    matchMode: SearchMatchMode,
  ) => void;
}

export function ReaderView({
  resourceId,
  initialHighlightId,
  initialQuestion,
  spreadMode,
  initialReaderPaneWidth,
  appBoundsRef,
  onReady,
  initialAutoplay,
  onOpenDigest,
  onOpenScan,
  onPublish,
  publishing,
  scanButtonRef,
  digestButtonRef,
  stageRef: externalStageRef,
  initialFindQuery,
  initialFindHitIndex,
  initialFindMatchMode,
  onFindHandoffToScan,
}: ReaderViewProps) {
  const openSettingsToLLM = useOpenSettings("llm");
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
  // Typed `HTMLDivElement | null` (not just `HTMLDivElement`) so `useRef`
  // resolves to a `MutableRefObject`: the ref below is written by hand in a
  // callback ref, not just handed to JSX, to merge in `externalStageRef`.
  const stageRef = useRef<HTMLDivElement | null>(null);
  // M22.5 "the reader's action cluster never overlaps the card": measures
  // whether there's room beside the reading column (stage + rail) to float
  // the actions cluster there, or whether it must drop below the footer
  // instead. Measured from the row itself, not read from
  // `--reader-max-width`, because what matters is the rendered width after
  // the viewport has already clamped it, not the cap alone.
  const readerRowRef = useRef<HTMLDivElement>(null);
  const [actionsBesideCard, setActionsBesideCard] = useState(true);
  useEffect(() => {
    const el = readerRowRef.current;
    if (!el) return;
    function updatePlacement() {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const roomRight = window.innerWidth - rect.right;
      setActionsBesideCard((prev) => {
        const next = roomRight >= READER_ACTIONS_MIN_ROOM_PX;
        return prev === next ? prev : next;
      });
    }
    updatePlacement();
    const observer = new ResizeObserver(updatePlacement);
    observer.observe(el);
    window.addEventListener("resize", updatePlacement);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePlacement);
    };
  }, []);
  // M20 (2026-08-02): the paper card — .pageClip's own box, which is what
  // the fold canvas is positioned inside and therefore the only rect its
  // geometry may be measured from. containerRef is the text column, one
  // reader margin further in; measuring the fold from *that* is what drew
  // the canvas a margin off its own content.
  const pageClipRef = useRef<HTMLDivElement>(null);
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
  // Same story, for the spine index — handleSectionRepaginated needs to know
  // which section the reader is in without being a render dependency.
  const currentSpineIndexRef = useRef<number | null>(null);
  // M21: the live epub.js Contents for whatever section is currently
  // rendered — the audio tint effect needs its DOM text to resolve a
  // playing sentence's char range, and it fires from a separate effect
  // outside the book-loading effect below, so it can't just close over the
  // `contents` handleRendered receives.
  const currentContentsRef = useRef<Contents | null>(null);
  // The CFI the audio tint mark currently sits at, if any — tracked
  // separately from cfiOwnersRef (real highlights) since exactly one tint
  // is ever live and it is never co-owned.
  const tintCfiRef = useRef<string | null>(null);
  // M24 A: the distinct CFIs the find bar currently has marks painted at —
  // a Set, not one entry per hit index, since two hits can legitimately
  // collapse onto the same CFI (see paintSearchMarksForSection's own
  // comment) and each CFI must only ever be cleared once.
  const searchMarkCfisRef = useRef<Set<string>>(new Set());
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
  // M20 step 3 (decisions.md 2026-08-03): unlike spreadMode, which is a prop
  // because epub.js needs it at `renderTo` time, the transition is read at
  // *turn* time — so it is local state seeded from the settings fetch and
  // kept current through settingsBus, exactly like readerMargin. Flipping it
  // takes effect on the next page turn, with no reload and no remount.
  const [pageTransition, setPageTransition] = useState<PageTransition>("slide");
  const {
    stageControls,
    stageReducedMotion,
    curl,
    slide,
    gestureActive,
    getFoldPointer,
    handleDrawCost,
    turnPage,
    turnPageSlideGuarded,
    turnPageSlideToSectionGuarded,
    handleGrabPointerDown,
  } = usePageTurnAnimation({
    renditionRef,
    containerRef,
    cardRef: pageClipRef,
    stageRef: marginWrapperRef,
    spreadMode,
    pageTransition,
  });
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
  // M21: bumped on every "relocated" — see handleRelocated's own comment.
  const [turnTick, setTurnTick] = useState(0);
  // M17 "digest this chapter" (decisions.md 2026-07-28 later): the
  // spotlight's reader-side shortcut — same POST the scan's spotlight uses,
  // scoped to just the current chapter, without visiting the scan.
  // M20.6: this now starts a job (the tray/toast own the actual progress
  // and cancel UI) — the id tracked here is only for this button's own
  // transient "Digesting…"/"Digested ✓" label.
  const [digestChapterJobId, setDigestChapterJobId] = useState<string | null>(null);
  const [digestChapterResult, setDigestChapterResult] = useState<string | null>(null);
  const { registerStarted, jobs } = useJobs();

  // M22 "Casting UI": local dialog state, not routed (see CastingModal.tsx's
  // own comment on why) — the origin is captured straight from the trigger
  // click, no overlayOrigin.ts bridge needed since there's a direct prop path.
  const [castOpen, setCastOpen] = useState(false);
  const [castOrigin, setCastOrigin] = useState<OverlayOrigin | null>(null);

  useEffect(() => {
    if (!digestChapterJobId) return;
    const job = jobs.find((j) => j.id === digestChapterJobId);
    if (!job || job.status === "running") return;
    setDigestChapterResult(
      job.status === "completed" ? "Digested ✓" : job.status === "cancelled" ? "Cancelled" : "Digest failed",
    );
    setDigestChapterJobId(null);
    window.setTimeout(() => setDigestChapterResult(null), 4000);
  }, [jobs, digestChapterJobId]);
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
  // M21: whether an audio-driven page turn should happen automatically —
  // live-via-settingsBus like readerMargin below. Read inside the tint
  // effect through the ref, not the state itself, so a setting change
  // doesn't need to re-run that effect.
  const [audioAutoTurnPages, setAudioAutoTurnPages] = useState(true);
  const audioAutoTurnPagesRef = useRef(audioAutoTurnPages);
  useEffect(() => {
    audioAutoTurnPagesRef.current = audioAutoTurnPages;
  }, [audioAutoTurnPages]);
  // M22.6 C "the voice you can walk away from": true once the reader has
  // traversed away from the sounding section on purpose (chapter nav, TOC,
  // or a manual page turn across a section boundary — see handleRelocated's
  // own comment on how those are told apart from the follow-the-voice jump
  // correcting itself). While true, the tint effect's cross-section jump
  // stays put; audio keeps playing regardless. Landing back on the sounding
  // section — by the "back to the voice" control or by paging there again —
  // clears it.
  const [detached, setDetached] = useState(false);
  // True only for the span of the tint effect's own corrective
  // `turnPageSlideToSectionGuarded` call — lets `handleRelocated` tell "the
  // follow jump just landed here" apart from "the reader just navigated
  // here", which is what it's actually watching for (see below).
  const followJumpActiveRef = useRef(false);
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
  // M19.6 operator feedback (decisions.md 2026-07-30 later): replaces the
  // character-location-based book-wide count with bookPages.ts's
  // click-accurate, spread-adjusted one. Null until the section-weight
  // fetch (below) resolves — "book" mode shows nothing until then, same as
  // displayedPage does before epub.js reports its first location.
  const [bookPage, setBookPage] = useState<{ page: number; total: number } | null>(null);
  // Section-weight (lengthPercent from the Scan's own text-length data) and
  // the page map built from it — see bookPages.ts. Refs, not state: read
  // inside handleRelocated without needing to be a render dependency
  // themselves. bookPageMapRef is null until the first relocate that has both
  // weights and a measurable section; it is thrown away and rebuilt whenever
  // the layout changes, since every page count in it is layout-specific.
  const sectionWeightRef = useRef<Map<number, number> | null>(null);
  const bookPageMapRef = useRef<BookPageMap | null>(null);
  // M24.1 D: the same weights as a start-and-length span per section. Real
  // state rather than a second ref, because unlike handleRelocated the result
  // card's rows are built during render — they need "where does this section
  // start" to place a hit's page number (searchRows.ts).
  const [sectionSpans, setSectionSpans] = useState<Map<number, SectionSpan> | null>(null);
  // M20.5 "S<n> is the only number that appears in any UI": real state, not
  // a ref like sectionWeightRef above — ChapterNav needs to re-render once
  // this resolves, not just read it inside an event-handler closure.
  const [chapterNumbers, setChapterNumbers] = useState<Map<number, number> | null>(null);
  // M21: every spine index in reading order, derived from the same
  // chapter-meta fetch chapterNumbers already comes from — usePlayer needs
  // it to find "the next/previous section" for chapter-ahead prefetch and
  // cross-section advance. Memoized so its identity is stable across
  // renders that don't actually change the book's section list.
  const orderedSpineIndices = useMemo(
    () => (chapterNumbers ? Array.from(chapterNumbers.keys()).sort((a, b) => a - b) : []),
    [chapterNumbers],
  );
  const player = usePlayer({ resourceId, spineIndices: orderedSpineIndices, initialSpeed: 1 });
  // Stable handle for the book-loading effect's closures (handleIframeKeydown,
  // the shortcut handlers below) — same reason turnPageRef/chapterJumpRef
  // exist: those are set up once and must reach *current* player behavior,
  // not whatever it was on the render that ran the effect.
  const playerRef = useRef<AudioPlayer>(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);
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
  // M20.7 "per-room cursors": same live-via-settingsBus/ref story as
  // focusMode above — read inside handleContentMouseMove, which is defined
  // once per book-loading effect run and would otherwise close over a
  // stale value.
  const [cursorStyle, setCursorStyle] = useState<CursorStyleChoice>("custom");
  const cursorStyleRef = useRef(cursorStyle);
  useEffect(() => {
    cursorStyleRef.current = cursorStyle;
  }, [cursorStyle]);

  // M24 A: the find bar's own state — "one result set" (decisions.md
  // 2026-08-14), fetched through the same hook the Scan's search field uses.
  // findHits/findCursorIndex/findOpen are mirrored into refs (same story as
  // themeVarsRef/focusModeRef above) so the book-loading effect's
  // `handleRendered`, which closes over this render only once per book load,
  // can still read the live values.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCursorIndex, setFindCursorIndex] = useState(-1);
  const [findFocusToken, setFindFocusToken] = useState(0);
  // M24.1 C: whole words by default — a substring scan is why "the" used to
  // blanket a paragraph with dozens of three-character marks. The rule is
  // named in the bar rather than inferred from the results, and it travels
  // with the query to the Scan so the two surfaces keep counting the same
  // set.
  const [findMatchMode, setFindMatchMode] = useState<SearchMatchMode>(initialFindMatchMode ?? "word");
  const { hits: findHits, loading: findLoading } = useSearchHits(
    findOpen ? resourceId : null,
    findQuery,
    findMatchMode,
  );
  const findHitsRef = useRef<SearchHit[]>(findHits);
  useEffect(() => {
    findHitsRef.current = findHits;
  }, [findHits]);
  const findCursorIndexRef = useRef(findCursorIndex);
  useEffect(() => {
    findCursorIndexRef.current = findCursorIndex;
  }, [findCursorIndex]);
  const findOpenRef = useRef(findOpen);
  useEffect(() => {
    findOpenRef.current = findOpen;
  }, [findOpen]);
  const findMatchModeRef = useRef(findMatchMode);
  useEffect(() => {
    findMatchModeRef.current = findMatchMode;
  }, [findMatchMode]);
  // A fresh set of results starts unstepped — cursor movement is always an
  // explicit ‹ ›/Enter action (TASKS.md), never an auto-jump while typing.
  useEffect(() => {
    setFindCursorIndex(-1);
  }, [findHits]);

  // M24.1 D: the result card is a view of the find bar's own result set, so
  // it lives and dies with the bar — closing the bar takes the card with it
  // rather than leaving a list of hits for a search that is no longer on.
  const [findCardOpen, setFindCardOpen] = useState(false);

  const closeFindBar = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    setFindCursorIndex(-1);
    setFindCardOpen(false);
  }, []);
  const handleFindShortcut = useCallback((event?: KeyboardEvent) => {
    event?.preventDefault();
    setFindOpen(true);
    setFindFocusToken((t) => t + 1);
  }, []);

  // M24: resolves a hit's anchor against a live section and jumps there via
  // `rendition.display(cfi)` — the same CFI-navigation primitive the book-
  // open effect already uses for a stored jumpTarget. A hit in a different
  // section is reached by loading that section first (reusing the audio
  // tint's own turnPageSlideToSectionGuarded rather than inventing a second
  // way to jump sections), then resolving against *its* live DOM once
  // rendered — display() a second time lands on the exact page, not just
  // the section's start.
  // M24.1 C: takes the hit's index in the result set as well as the hit,
  // because that index is what identifies *which* occurrence this is —
  // `locateSectionHits` locates the whole section's hits at once and this
  // picks its own out by index. Travelling by content instead is what landed
  // steps 2, 7, 8 and 9 all on occurrence #1.
  const goToFindHit = useCallback(
    async (hit: SearchHit, index: number) => {
      let contents = currentContentsRef.current;
      if (!contents || contents.sectionIndex !== hit.spineIndex) {
        await turnPageSlideToSectionGuarded(hit.spineIndex);
        contents = currentContentsRef.current;
      }
      if (!contents) return;
      const match = locateSectionHits(contents).find((entry) => entry.index === index)?.match;
      if (!match) return; // no longer resolvable live — skip silently, same philosophy as the audio tint
      const range = rangeFromTextOffsets(contents.document, match.start, match.end);
      if (!range) return;
      await renditionRef.current?.display(contents.cfiFromRange(range));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turnPageSlideToSectionGuarded],
  );

  // M24: arriving from the Scan's own search cursor (the reverse handoff —
  // see `initialFindHitIndex` on ReaderViewProps) opens the bar pre-filled
  // and, once its own search request resolves, jumps straight to that hit —
  // consumed once via the ref guard, not re-run on every later refetch.
  useEffect(() => {
    if (initialFindQuery === undefined) return;
    setFindOpen(true);
    setFindQuery(initialFindQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFindQuery]);
  const initialFindHitConsumedRef = useRef(false);
  useEffect(() => {
    if (initialFindHitIndex === undefined || initialFindHitConsumedRef.current) return;
    if (findHits.length === 0) return;
    initialFindHitConsumedRef.current = true;
    const index = Math.min(initialFindHitIndex, findHits.length - 1);
    setFindCursorIndex(index);
    const hit = findHits[index];
    if (hit) void goToFindHit(hit, index);
  }, [findHits, initialFindHitIndex, goToFindHit]);

  // M24.1 D acceptance: "a row click lands on exactly the hit that stepping
  // to that index does". Structurally, not by coincidence — the card's row
  // click and `‹ ›` both come through here, so there is one way to move the
  // cursor and one way to travel to where it now points.
  function goToFindHitIndex(index: number) {
    setFindCursorIndex(index);
    const hit = findHits[index];
    if (hit) void goToFindHit(hit, index);
  }

  function handleFindStep(direction: "next" | "prev") {
    goToFindHitIndex(stepFindCursor(findCursorIndex, findHits.length, direction));
  }

  function handleSeeInScan() {
    onFindHandoffToScan?.(findQuery.trim(), findCursorIndex, findMatchMode);
  }

  const {
    wrapperRef,
    fullscreenMode,
    fullscreenModeRef,
    toggleFullscreen,
    revealTop,
    revealBottom,
    revealRail,
    revealActions,
    setRevealTop,
    setRevealBottom,
    setRevealRail,
    setRevealActions,
  } = useFullscreenChrome();
  const { effectivePaneWidth, paneWidthDragging, handlePaneResizePointerDown } =
    useReaderPaneWidth(readerPaneWidth, setReaderPaneWidth, spreadMode, fullscreenMode);

  // M19.7: the reader's shortcuts, as discrete handlers the shared registry
  // (useShortcuts) can dispatch by key — replacing the single monolithic
  // window keydown listener this used to be one of four ad-hoc copies of
  // (decisions.md 2026-07-30). Each handler only touches refs and stable
  // setters, so none of these need dependencies beyond what's shown.
  const handleArrowLeftShortcut = useCallback(() => turnPageRef.current("prev"), []);
  const handleArrowRightShortcut = useCallback(() => turnPageRef.current("next"), []);
  // M21 "skip chapter reusing [/]": while a listening session is active,
  // the same keys skip to the previous/next section's audio instead of the
  // ordinary TOC-based chapter jump — the tint effect below (watching
  // player.currentSegment) is what actually turns the visible page to
  // follow it, exactly as an audio-driven cross-section advance already does.
  const handleChapterPrevShortcut = useCallback(() => {
    if (playerRef.current.status === "idle") chapterJumpRef.current("prev");
    else playerRef.current.skipChapter(-1);
  }, []);
  const handleChapterNextShortcut = useCallback(() => {
    if (playerRef.current.status === "idle") chapterJumpRef.current("next");
    else playerRef.current.skipChapter(1);
  }, []);
  const handleEscapeShortcut = useCallback(() => {
    // M24: the find bar is the innermost thing Escape can close — same
    // "closest layer first" order every other nested dismissal in this app
    // follows (a Settings-over-Scan closes Settings first, not both).
    if (findOpenRef.current) {
      closeFindBar();
      return;
    }
    setPendingSelection(null);
    setExpandedThread(null);
    setProgressPopoverOpen(false);
    if (fullscreenModeRef.current) toggleFullscreen();
  }, [closeFindBar, toggleFullscreen]);
  const handleFocusModeShortcut = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      // A clean page and an open annotations list are contradictory.
      if (next) setShowAnnotations(false);
      return next;
    });
  }, []);
  // M21 "play/pause on space with the existing isTyping guard": useShortcuts
  // (window path) and handleIframeKeydown (iframe path, below) both already
  // give every binding that guard for free — this only needs to stop the
  // browser's own "space scrolls/activates the focused control" default.
  const handleSpaceShortcut = useCallback((event?: KeyboardEvent) => {
    event?.preventDefault();
    playerRef.current.toggle();
  }, []);
  // M21 "skip sentence shift+←/→": placed *before* the plain prevPage/
  // nextPage bindings below — useShortcuts dispatches to the first binding
  // whose key matches, and a binding with `shift` left undefined matches
  // either shift state, so the shifted variant must be checked first. When
  // nothing is loaded, these fall back to the ordinary page turn — the same
  // thing the unshifted key already does — rather than silently doing
  // nothing.
  const handleSkipSentencePrevShortcut = useCallback(() => {
    if (playerRef.current.status === "idle") turnPageRef.current("prev");
    else playerRef.current.skipSentence(-1);
  }, []);
  const handleSkipSentenceNextShortcut = useCallback(() => {
    if (playerRef.current.status === "idle") turnPageRef.current("next");
    else playerRef.current.skipSentence(1);
  }, []);

  useShortcuts([
    { key: SHORTCUT_KEYS.skipSentencePrev, shift: true, handler: handleSkipSentencePrevShortcut },
    { key: SHORTCUT_KEYS.skipSentenceNext, shift: true, handler: handleSkipSentenceNextShortcut },
    { key: SHORTCUT_KEYS.playPause, handler: handleSpaceShortcut },
    { key: SHORTCUT_KEYS.prevPage, handler: handleArrowLeftShortcut },
    { key: SHORTCUT_KEYS.nextPage, handler: handleArrowRightShortcut },
    { key: SHORTCUT_KEYS.prevChapter, handler: handleChapterPrevShortcut },
    { key: SHORTCUT_KEYS.nextChapter, handler: handleChapterNextShortcut },
    { key: SHORTCUT_KEYS.escape, handler: handleEscapeShortcut },
    { key: SHORTCUT_KEYS.focusMode, shift: false, handler: handleFocusModeShortcut },
    { key: SHORTCUT_KEYS.fullscreen, shift: true, handler: toggleFullscreen },
    { key: SHORTCUT_KEYS.find, meta: true, handler: handleFindShortcut, allowWhileTyping: true },
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
    // M24.1 C, the other half of the rule stated in paintSearchMarksForSection:
    // epub.js's annotation store is keyed by `cfiRange + type`, and a search
    // mark is type "highlight" too — so adding this one on top of a search
    // mark at the identical CFI would evict *it* from the store and strand
    // its rect in the pane, unremovable. Take the CFI back first; the search
    // mark is repainted from the result set whenever the bar next changes,
    // and declines this CFI while a highlight owns it.
    if (searchMarkCfisRef.current.has(cfi)) {
      renditionRef.current?.annotations.remove(cfi, "highlight");
      searchMarkCfisRef.current.delete(cfi);
    }
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

  // M21: the playing sentence's mark — a distinct class from
  // HIGHLIGHT_MARK_CLASS (never shares cfiOwnersRef's ownership bookkeeping;
  // exactly one tint is ever live, and it's ephemeral, not a real highlight
  // a click should open a thread on).
  const AUDIO_TINT_MARK_CLASS = "marginalia-audio-tint";
  function setAudioTint(cfi: string | null) {
    if (tintCfiRef.current === cfi) return;
    if (tintCfiRef.current) {
      renditionRef.current?.annotations.remove(tintCfiRef.current, "highlight");
    }
    tintCfiRef.current = cfi;
    if (cfi) {
      renditionRef.current?.annotations.highlight(
        cfi,
        {},
        undefined,
        AUDIO_TINT_MARK_CLASS,
        audioTintStyle(themeVarsRef.current, focusModeRef.current),
      );
    }
  }

  // M24 A: the find bar's marks. Cleared and repainted as a whole rather
  // than diffed — cheap enough at find-bar scale, and much simpler than
  // reconciling which marks moved when the cursor steps or the section
  // changes. A search mark stacking with a real highlight's own mark at the
  // identical CFI is correct, not a collision (same precedent as the audio
  // tint above): the passage genuinely is both.
  function clearSearchMarks() {
    for (const cfi of searchMarkCfisRef.current) {
      renditionRef.current?.annotations.remove(cfi, "highlight");
    }
    searchMarkCfisRef.current.clear();
  }

  /**
   * M24.1 C: where this section's hits actually are, in the live DOM's own
   * flattened text — the one place the reader answers that question, so a
   * painted mark and a step to the same hit cannot disagree.
   *
   * The split is the whole fix. A **text** hit is located by *occurrence*
   * (hitLocation.ts): its content is the query, every occurrence of it looks
   * identical, so content can never say which one it is — while
   * `findAnchorInText`'s last resort is `indexOf(exact)`, the first one,
   * which is how "every hit in a section collapsed onto one mark" happened.
   * An **annotation** hit keeps `findAnchorInText`: it anchors to a
   * highlight, there is exactly one of that highlight, and the forgiving
   * fallback is precisely what it exists for.
   */
  function locateSectionHits(contents: Contents) {
    const sectionText = contents.document.body.textContent ?? "";
    const inSection = hitsForSection(findHitsRef.current, contents.sectionIndex);
    const locatedText = locateTextHits(
      sectionText,
      inSection.filter(({ hit }) => hit.source === "text"),
      findMatchModeRef.current,
    );
    const located: { index: number; hit: SearchHit; match: { start: number; end: number } }[] = [];
    for (const { hit, index } of inSection) {
      const match =
        hit.source === "text" ? locatedText.get(index) : findAnchorInText(sectionText, hit.anchor);
      if (match) located.push({ index, hit, match });
    }
    return located;
  }

  function paintSearchMarksForSection(contents: Contents | null) {
    clearSearchMarks();
    if (!contents || !findOpenRef.current) return;
    // ⚠️ Two different hits can resolve to the identical CFI (adjacent or
    // overlapping occurrences) — epub.js creates a second, unreachable
    // orphan mark if `.highlight()` is called twice for one CFI, the exact
    // bug cfiOwnersRef exists to prevent for real highlights (found live,
    // 2026-08-16: closing the bar left orphaned marks behind — TASKS.md's
    // "zero residual marks" acceptance failed until this deduped). At most
    // one mark per distinct CFI; the current hit wins the style if it
    // collides with a non-current one.
    //
    // ⚠️ The same collision, across mark *kinds*, is why a mark could
    // survive with no hit behind it (TASKS.md M24.1 C, "no mark without a
    // hit"). epub.js keys its annotation store by `cfiRange + type`
    // (epubjs/lib/annotations.js `add`: `hash = encodeURI(cfiRange + type)`)
    // and both kinds are type "highlight", so a search mark painted at a
    // CFI a *highlight* already occupies evicts that highlight from the
    // store while leaving its rect in the pane — where no later `remove()`
    // can reach it, because the hash it would look up now belongs to the
    // search mark. Clearing the search marks then leaves the highlight's
    // orphaned rect behind for good: a mark on text that is not a hit and
    // that stepping never visits.
    //
    // It is not a rare coincidence either: an annotation hit (a note or a
    // thread message matching) anchors to its highlight, so its CFI *is*
    // that highlight's CFI, every time. The highlight is the durable mark
    // and keeps the CFI; the search mark stands down there. Nothing is lost
    // visually — that passage is already marked, which is what a highlight
    // is — and `attachOwnedMark` enforces the same rule in the other
    // direction, for a highlight made while the find bar is open.
    const currentByCfi = new Map<string, boolean>();
    for (const { index, match } of locateSectionHits(contents)) {
      const range = rangeFromTextOffsets(contents.document, match.start, match.end);
      if (!range) continue;
      const cfi = contents.cfiFromRange(range);
      if (cfiOwnersRef.current.has(cfi)) continue;
      const isCurrent = index === findCursorIndexRef.current;
      currentByCfi.set(cfi, isCurrent || (currentByCfi.get(cfi) ?? false));
    }
    for (const [cfi, isCurrent] of currentByCfi) {
      searchMarkCfisRef.current.add(cfi);
      renditionRef.current?.annotations.highlight(
        cfi,
        {},
        undefined,
        SEARCH_MARK_CLASS,
        searchMarkStyle(themeVarsRef.current, isCurrent, focusModeRef.current),
      );
    }
  }

  // M21: resolves the playing sentence to a DOM range and tints it, and
  // drives auto-page-turn (the slide, never the curl — AUDIO.md) when it
  // falls outside the visible page or a different section entirely.
  // Deliberately its own effect, outside the book-loading effect above, so
  // it can freely depend on player.currentSegment/turnTick without
  // re-running the whole book setup on every sentence.
  useEffect(() => {
    const segment = player.currentSegment;
    if (!segment) {
      setAudioTint(null);
      return;
    }

    const contents = currentContentsRef.current;
    if (!contents || contents.sectionIndex !== segment.spineIndex) {
      // The visible page hasn't caught up to this section yet — jump
      // straight there rather than leaving the tint on stale, wrong-section
      // text. A direct `display()` jump (turnPageSlideToSectionGuarded), not
      // a chain of single-page turns: the target can be many pages from
      // wherever the reader is currently sitting in the old section (a
      // deliberate chapter skip in particular), and walking there one
      // `turnPageSlide` step per `relocated` event is what produced the
      // reported "keeps jumping forward and back constantly" — each step
      // re-triggered this effect, racing a concurrent manual turn (see that
      // helper's own comment).
      //
      // M22.6 C: `detached` gates this specific jump, and only this one —
      // the reader asked to look elsewhere while the voice keeps going. The
      // tint still clears above regardless (never lie about where the voice
      // actually is), and `handleRelocated` is what flips `detached` back
      // off once the view and the voice agree again.
      setAudioTint(null);
      if (audioAutoTurnPagesRef.current && !detached) {
        followJumpActiveRef.current = true;
        void turnPageSlideToSectionGuarded(segment.spineIndex).finally(() => {
          followJumpActiveRef.current = false;
        });
      }
      return;
    }

    const sectionText = contents.document.body.textContent ?? "";
    // AUDIO.md: "the manifest's char range -> text search in the section
    // contents" — an exact-text search against the *live* DOM, not a
    // recomputed offset, since epub.js's rendered text can differ slightly
    // from resource_text's raw extraction (collapsed whitespace etc.). No
    // prefix/suffix: the sentence itself is almost always unique enough
    // within one section, and findAnchorInText already degrades gracefully
    // (see below) rather than throwing on a false match.
    const match = findAnchorInText(sectionText, { exact: segment.text, prefix: "", suffix: "" });
    if (!match) {
      // AUDIO.md: "a sentence that can't be resolved is skipped silently —
      // audio keeps playing; a missing tint is a blemish, a stall is a
      // broken product." Nothing else to do here.
      setAudioTint(null);
      return;
    }
    const range = rangeFromTextOffsets(contents.document, match.start, match.end);
    if (!range) {
      setAudioTint(null);
      return;
    }
    setAudioTint(contents.cfiFromRange(range));

    if (audioAutoTurnPagesRef.current) {
      // epub.js's paginated flow lays the whole section out in one very
      // wide iframe and reveals the current page by shifting *the iframe
      // element itself* within a viewport-sized, overflow-clipped
      // container (see handleContentClick's own comment on this same
      // trick) — confirmed live: the iframe's own `innerWidth` was 26708px
      // for a normal-looking single page, so checking a range's rect
      // against the iframe's viewport is meaningless (nearly everything in
      // the section reads as "visible"). The real visible window is
      // `containerRef`; translate through the iframe element's own
      // position first, exactly like handleContentClick/MouseMove do.
      const iframeEl = contents.document.defaultView?.frameElement as HTMLElement | null;
      const container = containerRef.current;
      if (iframeEl && container) {
        const iframeRect = iframeEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const rangeRect = range.getBoundingClientRect();
        const left = iframeRect.left + rangeRect.left - containerRect.left;
        const right = iframeRect.left + rangeRect.right - containerRect.left;
        const top = iframeRect.top + rangeRect.top - containerRect.top;
        const bottom = iframeRect.top + rangeRect.bottom - containerRect.top;
        const visible = right > 0 && left < containerRect.width && bottom > 0 && top < containerRect.height;
        if (!visible) void turnPageSlideGuarded("next");
      }
    }
    // `detached` is a real dependency (not just read through a ref, unlike
    // audioAutoTurnPagesRef): re-engaging must re-run this effect so the
    // corrective jump above actually fires the moment it flips back to
    // false, rather than waiting on the next unrelated segment/turnTick
    // change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.currentSegment, turnTick, detached]);

  // M24 A: repaints the find bar's marks whenever the result set, the
  // stepped cursor, or the bar's open/closed state changes, for whichever
  // section is currently on screen — `handleRendered` (above, in the
  // book-loading effect) is the other caller, for when the *section*
  // changes instead. Closing the bar clears query too, which alone would
  // make this a no-op via findOpen/findHits both changing — the explicit
  // findOpen check is what actually guarantees zero residual marks the
  // instant Escape/× fires, not incidentally.
  useEffect(() => {
    paintSearchMarksForSection(currentContentsRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findHits, findCursorIndex, findOpen]);

  // AUDIO.md: "making a selection, opening a thread, or opening the
  // annotations overview pauses [playback]; it does not stop. You cannot
  // read an answer while being talked at." One effect covers all three
  // rather than touching every place that sets these three pieces of state.
  useEffect(() => {
    if (pendingSelection || expandedThread || showAnnotations) {
      playerRef.current.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelection, expandedThread, showAnnotations]);

  // M22.6 C: a stopped session has no voice left to be detached from —
  // clears the leash so the next "Listen" starts fresh and following.
  useEffect(() => {
    if (player.status === "idle") setDetached(false);
  }, [player.status]);

  // M21 "Listen" entry point: once the book has actually opened (a real
  // spine index is known), start listening from wherever it opened — the
  // saved position for a plain reopen, or the jumped-to highlight's section
  // when arriving from the scan. Fires once per mount, never re-fires on
  // every ordinary page turn.
  const hasAutoplayedRef = useRef(false);
  useEffect(() => {
    if (!initialAutoplay || hasAutoplayedRef.current) return;
    if (currentSpineIndex === null) return;
    hasAutoplayedRef.current = true;
    player.startListening(currentSpineIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAutoplay, currentSpineIndex]);

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
      setPageTransition(settings.pageTransition);
      setCursorStyle(settings.cursorStyle);
      setAudioAutoTurnPages(settings.audioAutoTurnPages);
    });
    fetchQueryRoleConfigured().then(setProviderConfigured);
  }, []);

  useEffect(() => {
    return onSettingsSaved((settings) => {
      setReaderMargin(settings.readerMargin);
      setReaderFontScale(settings.readerFontScale);
      setPageNumberMode(settings.pageNumberMode);
      setReaderPaneWidth(settings.readerPaneWidth);
      setPageTransition(settings.pageTransition);
      setCursorStyle(settings.cursorStyle);
      setAudioAutoTurnPages(settings.audioAutoTurnPages);
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
    bookPageMapRef.current = null;
    currentSpineIndexRef.current = null;
    setToc([]);
    setChapterNumbers(null);
    setSectionSpans(null);
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

    // M19.6 operator feedback round 4 (decisions.md 2026-07-30 later still):
    // take over the "scroll one more page vs. advance the section" decision
    // from epub.js, whose own comparison is an exact equality on the
    // second-to-last page of every section and loses it to sub-pixel scroll
    // rounding at any fractional browser zoom — the skipped last page.
    // pageTurn.ts carries the measurements. Installed on the manager, so
    // every caller (footer buttons, arrow keys, turn zones, the
    // highlight-across-a-boundary dwell) is covered at once.
    //
    // Awaits `started`, not `renderTo`: epub.js builds the manager inside
    // `Rendition#init`, which only runs once the book has finished opening, so
    // `rendition.manager` is still undefined when renderTo returns (found the
    // hard way — installing there is a silent no-op and the skip survives).
    void rendition.started.then(() => {
      if (cancelled) return;
      installTurnFix(managerOf(rendition));
      managerOf(rendition)?.on?.("resize", handleSectionRepaginated);
    });

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

      // M19.6 operator feedback: every page count in the map (bookPages.ts)
      // was measured under the layout that's about to change (font size or
      // margin) — stale the moment the gap changes. Dropped, not migrated:
      // the debounced re-display below re-measures the current section within
      // ~120ms and rebuilds the map from it. The book total legitimately
      // changes here; the operator changed the text size, and holding the old
      // total would be the lie.
      bookPageMapRef.current = null;

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
        // The new column width re-breaks lines; if the section still expands
        // to the same pixel width, epub.js never re-renders the marks pane and
        // every highlight overlay is left describing text that has moved. See
        // refreshHighlightOverlays. After the re-display settles, not before.
        const settled = currentCfiRef.current
          ? rendition.display(currentCfiRef.current)
          : Promise.resolve();
        void settled.then(() => refreshHighlightOverlays(rendition));
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

    // M19.6 operator feedback round 4: the chapter page comes from the
    // container's own geometry, rounded (pageTurn.ts), not from epub.js's
    // `location.start.displayed`. epub.js derives that with
    // `Math.floor(start / pageWidth)` where `start` is a difference of two
    // getBoundingClientRect floats — zero tolerance at exactly the page
    // boundaries it is asked about, so a negative sub-pixel error reports one
    // page too few. Reading the geometry directly also drops the spread-divisor
    // conversion entirely: `layout.delta` is already the width of one whole
    // page view, spread or not.
    //
    // Returns whether it managed to publish a page-derived percentage, so the
    // caller knows whether to fall back to the character-based one.
    // Idempotent: called on every relocate, and again whenever a section
    // re-paginates under us (see handleSectionRepaginated).
    function publishPageNumbers(spineIndex: number): boolean {
      const manager = managerOf(rendition);
      if (!manager?.container) return false;
      const chapter = chapterPageFromGeometry(readTurnGeometry(manager));
      setDisplayedPage(chapter);

      // Book-wide page count + percentage (bookPages.ts): built once from the
      // section weights and then only refined in place, so neither the total
      // nor a page number already shown moves as chapters are crossed.
      const weights = sectionWeightRef.current;
      if (!weights) return false;
      const existing = bookPageMapRef.current;
      bookPageMapRef.current = existing
        ? recordMeasuredPages(existing, spineIndex, chapter.total)
        : buildBookPageMap(weights, spineIndex, chapter.total);
      const map = bookPageMapRef.current;
      const info = map ? lookupBookPage(map, spineIndex, chapter.page) : null;
      if (!info) return false;
      setBookPage(info);
      setProgressPercent(Math.round((info.page / info.total) * 100));
      return true;
    }

    // A section can re-paginate a beat *after* it first renders — see
    // reassertLanding in pageTurn.ts, which repairs the reader's *position*
    // when that happens. This repairs the *numbers*: epub.js never re-reports
    // the location for a re-pagination, so the footer was left describing a
    // pagination that no longer existed ("page 7 of 7" of a section that had
    // just become 6 pages long).
    //
    // Deliberately not keyed off currentSpineIndexRef: the resize fires
    // *before* the relocate that would update it, so that guard rejected every
    // real case (measured — the handler never once ran). The manager's own
    // "which section am I showing" is the authoritative answer. On the next
    // frame rather than inline, so it reads the geometry after every other
    // listener on this event — reassertLanding's among them — has had its say.
    function handleSectionRepaginated(section: unknown) {
      const manager = managerOf(rendition);
      const index = (section as { index?: number } | null | undefined)?.index;
      if (!manager || typeof index !== "number") return;
      if (index !== shownSectionIndex(manager)) return;
      requestAnimationFrame(() => {
        if (cancelled) return;
        publishPageNumbers(index);
        // A re-pagination re-breaks every line in the section, which is exactly
        // when the highlight overlays go stale — and epub.js only re-renders
        // the marks pane when the view's *pixel size* changes, which a
        // re-pagination to the same expanded width does not do.
        refreshHighlightOverlays(rendition);
      });
    }

    function handleRelocated(location: Location) {
      currentCfiRef.current = location.start.cfi;
      currentSpineIndexRef.current = location.start.index;
      setAtStart(Boolean(location.atStart));
      setAtEnd(Boolean(location.atEnd));
      setCurrentSpineIndex(location.start.index);
      // M21: the audio tint/auto-turn effect needs to know "a page just
      // turned" even *within* the same spine section (currentSpineIndex
      // alone wouldn't change) — a plain counter is the cheapest signal.
      setTurnTick((t) => t + 1);

      // M22.6 C: every relocation — a manual turn, a chapter-nav/TOC jump,
      // or the follow-the-voice effect's own corrective jump — comes through
      // here, so this is the one place that can tell them apart. Landing
      // exactly on the sounding section re-engages (however it happened);
      // landing anywhere else *without* the follow jump being the one doing
      // it means the reader just navigated away on purpose.
      const sounding = playerRef.current.currentSegment;
      if (sounding) {
        if (location.start.index === sounding.spineIndex) setDetached(false);
        else if (!followJumpActiveRef.current) setDetached(true);
      }
      const pct = location.start.percentage;

      const usedPageBasedPercent = publishPageNumbers(location.start.index);
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
      if (!contents) return;
      currentContentsRef.current = contents;
      resolveHighlightsForSection(contents);
      paintSearchMarksForSection(contents);

      // The section's fonts may still be loading at this point; when they
      // land, the text re-breaks at the same expanded width and every overlay
      // in it is silently left behind (see refreshHighlightOverlays). Awaiting
      // the iframe document's own FontFaceSet is the one signal for that.
      void contents.document.fonts?.ready.then(() => {
        refreshHighlightOverlays(rendition);
      });
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

      // M20.7 "per-room cursors" — precedence, written down per the
      // TASKS.md warning: (1) a turn zone always wins, regardless of the
      // cursorStyle setting — it's a functional gesture affordance, not
      // room decor, and DESIGN.md's Room 2 notes are explicit that this
      // room otherwise stays still; (2) failing that, cursorStyle "custom"
      // shows the reader's own accent — a fine nib, i.e. an explicit
      // `text` cursor — but only while a selection actually exists in this
      // section, per DESIGN.md ("Cursor may switch to a fine I-beam/nib
      // during selection, nothing more"); (3) otherwise the inline style is
      // cleared so the iframe's native default applies untouched, which is
      // also exactly what "system" gets everywhere in this room.
      const hasSelection = Boolean(contents.window.getSelection()?.toString());
      lastContentsWithCursorRef.current = contents;
      contents.document.body.style.cursor =
        zone === "prev"
          ? "w-resize"
          : zone === "next"
            ? "e-resize"
            : cursorStyleRef.current === "custom" && hasSelection
              ? "text"
              : "";
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
            // Lift the mark to its kind colour at full strength — matching the
            // presence of the `::selection` wash you see while a passage is
            // still freshly selected, which is what the operator asked hover
            // to look like. See hoverFillOpacity for why ink stops short.
            // markStyleForKind puts fill/fill-opacity/mix-blend-mode on the
            // `.marginalia-highlight` group itself, not the child `<rect>`, so
            // this inline override on the group is what wins.
            hit.style.fillOpacity = String(
              hoverFillOpacity(themeVarsRef.current.colorScheme),
            );
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
      // Operator feedback round 4: being *in* the turn zone is not enough. A
      // selection dragged down the middle of a paragraph passes through the
      // zone long before it has taken everything on the page, and the turn
      // that followed read as a stray swipe. The gesture now also requires the
      // cursor to be past the end of the page's text — further right than its
      // last word, or below its last line (see cursorPastPageText).
      if (isPointerDownInContentRef.current && zone && !focusModeRef.current) {
        const hasActiveSelection = Boolean(contents.window.getSelection()?.toString());
        const pastEdge = cursorPastPageText(
          zone,
          contents.document,
          { x: event.clientX, y: event.clientY },
          {
            left: containerRect.left - iframeRect.left,
            right: containerRect.right - iframeRect.left,
            top: Math.max(0, containerRect.top - iframeRect.top),
            bottom: Math.min(iframeRect.height, containerRect.bottom - iframeRect.top),
          },
        );
        if (hasActiveSelection && pastEdge) {
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
        const nearActionsCorner =
          nearBottom && viewportX > window.innerWidth * (1 - FULLSCREEN_RAIL_CORNER_FRACTION);
        setRevealTop((prev) => (prev === nearTop ? prev : nearTop));
        setRevealBottom((prev) => (prev === nearBottom ? prev : nearBottom));
        setRevealRail((prev) => (prev === nearRailCorner ? prev : nearRailCorner));
        setRevealActions((prev) => (prev === nearActionsCorner ? prev : nearActionsCorner));
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

      if (event.key === "ArrowLeft") {
        if (event.shiftKey) handleSkipSentencePrevShortcut();
        else handleArrowLeftShortcut();
      } else if (event.key === "ArrowRight") {
        if (event.shiftKey) handleSkipSentenceNextShortcut();
        else handleArrowRightShortcut();
      } else if (event.key === " ") handleSpaceShortcut(event);
      else if (event.key === "[") handleChapterPrevShortcut();
      else if (event.key === "]") handleChapterNextShortcut();
      else if (event.key === "Escape") handleEscapeShortcut();
      else if (event.key.toLowerCase() === "f" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        // M24: Cmd/Ctrl+F, forwarded the same way every other reader
        // shortcut crosses the iframe boundary — see useShortcuts above for
        // why this needs its own branch rather than the shared registry.
        event.preventDefault();
        handleFindShortcut();
      } else if (
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
        const [position, resourceHighlights, cachedLocations, chapterMeta] = await Promise.all([
          fetchPosition(resourceId),
          fetchHighlights(resourceId),
          fetchCachedLocations(resourceId),
          fetchChapterMeta(resourceId),
        ]);
        if (chapterMeta) {
          sectionWeightRef.current = chapterMeta.weights;
          setChapterNumbers(chapterMeta.chapterNumbers);
          setSectionSpans(buildSectionSpans(chapterMeta.weights));
        }
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
        onReady?.();
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
        if (cancelled) return;
        setStatus("error");
        // A failed load is still "done" as far as the opening overlay is
        // concerned — it must reveal the error state rather than hold its
        // masking animation forever waiting for a `ready` that never comes.
        onReady?.();
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

    // M21: the audio tint gets the same re-tint-in-place treatment as a
    // real highlight above — `f` must hide it exactly like any other
    // annotation-layer effect (AUDIO.md).
    if (tintCfiRef.current) {
      renditionRef.current.annotations.remove(tintCfiRef.current, "highlight");
      renditionRef.current.annotations.highlight(
        tintCfiRef.current,
        {},
        undefined,
        AUDIO_TINT_MARK_CLASS,
        audioTintStyle(themeVars, focusMode),
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

  // M19.6 operator feedback round 4: `themes.fontSize()` above patches
  // already-rendered content in place, which re-breaks its lines. When that
  // leaves the section's expanded width unchanged — which is most of the time,
  // since a page either fits or it doesn't — epub.js never re-renders the
  // marks pane, so the highlight overlays keep the coordinates they were drawn
  // at. This includes the very first fontSize call, applied a moment after
  // mount once the settings fetch resolves (see the mount-race note above),
  // which is why the operator could see displaced overlays on a book they had
  // not touched the text size of at all. rAF: after the reflow, not during it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      refreshHighlightOverlays(renditionRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [readerFontScale, readerMargin, readerPaneWidth, spreadMode]);

  useEffect(() => {
    turnPageRef.current = (direction) => {
      void turnPage(direction);
    };
  }, [turnPage]);

  // M12: chapter stepping sequence (one per spine index, deduped) and which
  // of them governs the current position — the single source both the
  // ChapterNav cluster and the `[`/`]` shortcuts step through.
  const chapterStopsList = deriveChapterStops(toc);
  // The progress dial's own chapter ticks (M22.5) — Slider's generic
  // `dialTicks`, fed the reader's book-specific chapter boundaries.
  const chapterDialTicks = chapterStopsList
    .filter((stop): stop is TocEntry & { percent: number } => stop.percent !== null)
    .map((stop) => ({ value: stop.percent, label: stop.label }));
  // M24.1 D: the result card's rows, built here rather than inside the card
  // because everything a row carries beyond the hit itself belongs to the
  // reader — the TOC, the footer's page map, and the page-number setting the
  // footer is already reading. The card renders them; it never searches,
  // orders or counts anything of its own.
  //
  // `bookPage` is a dependency for a reason worth stating: the page map is a
  // ref (bookPages.ts writes it during relocate), so this memo cannot see it
  // calibrate. `bookPage` moves on the same relocate, which makes it the
  // signal that the map did. Until the first one lands, rows simply carry no
  // page — the same "nothing rather than a provisional number" the footer
  // itself takes.
  const findRows = useMemo(() => {
    if (!findCardOpen) return [];
    // Both of these are per-section answers asked once per *hit*, and a
    // common word's result set runs to thousands of hits — so the chapter
    // stops are derived once for the whole build rather than per row, and
    // each section's label is remembered the first time it is looked up.
    const stops = deriveChapterStops(toc);
    const labelCache = new Map<number, string | null>();
    return buildSearchResultRows(findHits, {
      query: findQuery.trim(),
      pageNumberMode,
      chapterLabelFor: (spineIndex) => {
        const cached = labelCache.get(spineIndex);
        if (cached !== undefined) return cached;
        const label = deriveCurrentChapter(stops, spineIndex)?.label ?? null;
        labelCache.set(spineIndex, label);
        return label;
      },
      pagesInSection: (spineIndex) => bookPageMapRef.current?.pages.get(spineIndex) ?? null,
      bookPageFor: (spineIndex, chapterPage) => {
        const map = bookPageMapRef.current;
        return map ? (lookupBookPage(map, spineIndex, chapterPage)?.page ?? null) : null;
      },
      sectionSpan: (spineIndex) => sectionSpans?.get(spineIndex) ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findCardOpen, findHits, findQuery, pageNumberMode, toc, sectionSpans, bookPage]);

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
    if (currentSpineIndex === null || digestChapterJobId) return;
    setDigestChapterResult(null);
    const result = await startJobRequest(`/api/resources/${resourceId}/digest`, {
      spineStart: currentSpineIndex,
      spineEnd: currentSpineIndex,
    });
    if ("jobId" in result) {
      setDigestChapterJobId(result.jobId);
      registerStarted({ id: result.jobId, kind: "digest", resourceId, resourceTitle: null });
    } else {
      setDigestChapterResult("Digest failed");
      window.setTimeout(() => setDigestChapterResult(null), 4000);
    }
  }

  // M21 transport controls. The footer's play/pause button is the one place
  // a reader can start listening without ever visiting the desk/list — it
  // starts from wherever the book is currently open to.
  function handleTransportPlayClick() {
    if (player.status === "idle" || player.status === "error") {
      if (currentSpineIndex !== null) player.startListening(currentSpineIndex);
    } else {
      player.toggle();
    }
  }

  // M22.6 C "a back to the voice control sits with the transport": clearing
  // `detached` alone re-runs the tint effect (it's a real dependency there),
  // which is what actually performs the jump — this just asks for it.
  function handleReturnToVoice() {
    setDetached(false);
  }

  // M22.6 C "leaving playback returns to the reader, not the Desk": today's
  // only way to end a listening session is to leave the book entirely and
  // come back — a round trip through `/` whose debounced position-save can
  // lose whatever page was on screen. A real stop, wired to the transport,
  // ends the session without navigating anywhere.
  function handleStopListening() {
    player.stop();
  }

  const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 2];
  function handleCycleSpeed() {
    const i = SPEED_STEPS.indexOf(player.speed);
    const next = SPEED_STEPS[(i + 1) % SPEED_STEPS.length] ?? 1;
    player.setSpeed(next);
    void updateAudioState(resourceId, { speed: next });
  }

  /** Resolve a previewed percent to a CFI and actually move the book —
   * `Slider`'s `onCommit`, fired on pointer-drag release and keyboard Enter,
   * never per-frame while dragging (SPEC acceptance). The drag/keyboard
   * gesture itself now lives in the shared `Slider` component
   * (controls/Slider.tsx, M19.7) — this is what's left that's specific to
   * *this* control: turning a committed percent into an actual page turn. */
  function commitScrub(percent: number) {
    const book = bookRef.current;
    const rendition = renditionRef.current;
    if (!book || !rendition) return;
    const cfi = book.locations.cfiFromPercentage(percent / 100);
    void rendition.display(cfi);
  }

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

  // M22.6 C "'Play from here' joins the selection pill": starts listening
  // at the selected sentence instead of the section's first. Doesn't create
  // a highlight — this is a playback action, not a marking one — so it
  // clears the pill itself rather than routing through
  // createHighlightFromSelection.
  async function handlePlayFromSelection() {
    if (!pendingSelection) return;
    const { spineIndex, contents, exact, prefix, suffix } = pendingSelection;
    const sectionText = contents.document.body.textContent ?? "";
    const match = findAnchorInText(sectionText, { exact, prefix, suffix });
    let sentenceIndex = 0;
    if (match) {
      const manifest = await fetchSectionManifest(resourceId, spineIndex);
      if (manifest) sentenceIndex = resolveSegmentIndexForOffset(sectionText, match.start, manifest.segments);
    }
    player.playFrom(spineIndex, sentenceIndex);
    contents.window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
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
            : `${styles.topRow} ${actionsBesideCard ? "" : styles.topRowReserve}`
        }
        onPointerEnter={fullscreenMode ? () => setRevealTop(true) : undefined}
        onPointerLeave={fullscreenMode ? () => setRevealTop(false) : undefined}
      >
        <div className={styles.topRowLeft}>
          {focusMode ? (
            <span className={styles.focusIndicator}>Notes hidden — press F to show</span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className={styles.annotationsButton}
              onClick={() => setShowAnnotations((prev) => !prev)}
            >
              Annotations{highlights.length > 0 ? ` (${highlights.length})` : ""}
              {unanchoredIds.size > 0 && (
                <span className={styles.unanchoredBadge} title="Some highlights couldn't be relocated">
                  {unanchoredIds.size}
                </span>
              )}
            </Button>
          )}
        </div>
        <div className={styles.progressWrap}>
          <Slider
            variant="trigger"
            className={styles.progress}
            value={progressPercent ?? 0}
            min={0}
            max={100}
            dragPxPerUnit={PROGRESS_DRAG_PX_PER_PERCENT}
            keyboardStep={SCRUB_KEYBOARD_STEP_PERCENT}
            commitOnArrow={false}
            clickToType={false}
            disabled={progressPercent === null}
            ariaLabel="Reading progress"
            formatValue={(v) => {
              const chapter = chapterAtPercent(chapterStopsList, v);
              return `${Math.round(v)}%${chapter ? ` · ${chapter.label}` : ""}`;
            }}
            dialTicks={chapterDialTicks}
            dialHint="Release to jump · Esc to cancel"
            aria-haspopup="true"
            aria-expanded={progressPopoverOpen}
            onPreviewChange={setScrubPreviewPercent}
            onPlainClick={() => setProgressPopoverOpen((prev) => !prev)}
            onCommit={commitScrub}
          >
            {progressPercent !== null ? `${progressPercent}%` : ""}
          </Slider>
          <AnimatePresence>
            {scrubPreviewPercent === null && progressPopoverOpen && (
              <ProgressPopover
                key="progress-popover"
                percent={progressPercent}
                page={displayedPage?.page ?? null}
                totalPages={displayedPage?.total ?? null}
                chapterLabel={activeChapter?.label ?? null}
              />
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
                chapterNumbers={chapterNumbers}
                onSelect={handleTocSelect}
                onPrev={() => jumpToChapter("prev")}
                onNext={() => jumpToChapter("next")}
                hasPrev={hasPrevChapter}
                hasNext={hasNextChapter}
                compact={!actionsBesideCard}
              />
              {/* M22.5: steps aside once there's no room beside the card —
                  the same signal `.topRowReserve` reacts to. The whole-book
                  Digest action is always reachable from the actions
                  cluster below; this is a convenience shortcut, not the
                  only path to it. */}
              {currentSpineIndex !== null && actionsBesideCard && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.digestChapterButton}
                  disabled={digestChapterJobId !== null}
                  onClick={handleDigestChapter}
                  title="Digest just this chapter (M17 spotlight shortcut)"
                >
                  {digestChapterJobId ? "Digesting…" : digestChapterResult ?? "Digest chapter"}
                </Button>
              )}
              <ProviderPickerPopover
                role="query"
                label="Query provider"
                onNavigateToSettings={openSettingsToLLM}
              />
            </>
          )}
          {/* M21 transport controls: not gated by focusMode — a reader who
              hid annotations to listen still needs to pause. */}
          <div className={styles.audioTransport}>
            <IconButton
              icon={<AudioTransportIcon kind="cast" />}
              label="Cast — voices for this book"
              pressed={castOpen}
              onClick={(event) => {
                setCastOrigin(captureOverlayOrigin(event.currentTarget));
                setCastOpen(true);
              }}
            />
            <IconButton
              icon={<AudioTransportIcon kind="skip-prev" />}
              label="Previous sentence"
              disabled={player.status === "idle"}
              onClick={() => player.skipSentence(-1)}
            />
            <IconButton
              icon={
                <AudioTransportIcon
                  kind={player.status === "playing" || player.status === "loading" ? "pause" : "play"}
                />
              }
              label={
                player.status === "playing" || player.status === "loading"
                  ? "Pause listening"
                  : player.status === "paused"
                    ? "Resume listening"
                    : "Listen"
              }
              pressed={player.status === "playing" || player.status === "loading"}
              onClick={handleTransportPlayClick}
            />
            <IconButton
              icon={<AudioTransportIcon kind="skip-next" />}
              label="Next sentence"
              disabled={player.status === "idle"}
              onClick={() => player.skipSentence(1)}
            />
            {/* M22.6 C: only ever shown while the view has actually
                wandered from the sounding section — pressing it is the
                other half of what put it there. */}
            {player.status !== "idle" && detached && (
              <IconButton
                icon={<AudioTransportIcon kind="locate" />}
                label="Back to the voice"
                onClick={handleReturnToVoice}
              />
            )}
            {player.status !== "idle" && (
              <Button
                variant="ghost"
                size="sm"
                className={styles.speedButton}
                onClick={handleCycleSpeed}
                title="Playback speed"
              >
                {player.speed}×
              </Button>
            )}
            {player.status !== "idle" && (
              <IconButton
                icon={<AudioTransportIcon kind="stop" />}
                label="Stop listening"
                onClick={handleStopListening}
              />
            )}
            {player.status === "error" && (
              <span className={styles.audioError} role="status">
                {player.errorCode === "model_unavailable" || player.errorCode === "model_download_failed"
                  ? "Audio engine unavailable"
                  : "Couldn't play audio"}
              </span>
            )}
          </div>
          {/* M19.7 "the nav bar becomes a floating cluster": outside
              fullscreen, App.tsx's own top-right instance already covers the
              reader. In real Fullscreen API fullscreen, anything outside
              `wrapperRef`'s subtree is not rendered at all, so that instance
              becomes invisible — this un-floated copy lives inside the
              reader's own chrome instead, joining the same proximity-reveal
              (topRow/revealTop) as everything else in this row. */}
          {fullscreenMode && <NavCluster settingsTab="reading" floating={false} />}
        </div>
        {findOpen && (
          <div className={styles.findBarRow}>
            <FindBar
              query={findQuery}
              onQueryChange={setFindQuery}
              hits={findHits}
              currentIndex={findCursorIndex}
              loading={findLoading}
              onStep={handleFindStep}
              onClose={closeFindBar}
              onSeeInScan={handleSeeInScan}
              resultsOpen={findCardOpen}
              onToggleResults={() => setFindCardOpen((open) => !open)}
              matchMode={findMatchMode}
              onMatchModeChange={setFindMatchMode}
              focusToken={findFocusToken}
            />
          </div>
        )}
      </div>

      <div className={styles.readerRow} ref={readerRowRef}>
        <div
          className={styles.stage}
          ref={(node) => {
            stageRef.current = node;
            if (externalStageRef) externalStageRef.current = node;
          }}
          onPointerLeave={handleStagePointerLeave}
        >
          <div className={styles.pageClip} ref={pageClipRef}>
            {/* M20 step 3 "the next page slides over": while a slide is
                live this is the *incoming* page — it gets a stacking context
                above the departing card below it and its own opaque paper, so
                translating it covers the still snapshot instead of blending
                with it. The transform itself is written straight to this node
                by usePageTurnAnimation; a transform per pointermove must not
                cost a React render. */}
            <div
              ref={marginWrapperRef}
              className={`${styles.marginWrapper} ${slide ? styles.marginWrapperSliding : ""}`}
              style={{ "--reader-margin": `${READER_MARGIN_PX[readerMargin]}px` } as CSSProperties}
            >
              <motion.div
                ref={containerRef}
                className={styles.epubContainer}
                animate={stageControls}
              />
            </div>
            {slide && (
              <PageSlide image={slide.image} layout={slide.layout} paper={slide.paper} />
            )}
            {curl && (
              <PageCurl
                image={curl.image}
                anchor={curl.anchor}
                leafX={curl.leafX}
                stageWidth={curl.stageWidth}
                leafWidth={curl.leafWidth}
                leafHeight={curl.leafHeight}
                getPointer={getFoldPointer}
                onDrawCost={handleDrawCost}
              />
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
            {/* M20 "grab anywhere in the outer band": the old 18px edgeGrab
                strips are retired — the M11 semicircular zone shape
                (turnZoneVignette above) becomes the grab surface itself,
                just with pointer-events enabled and a real onPointerDown,
                so the fold anchors to whichever corner is nearest the grab
                point instead of always the same edge-centred hinge. It
                stays an ellipse hugging the very edge (not the full 30%
                click-turn zone) so the rest of the band is still free for
                text selection. */}
            {/* `|| gestureActive`: the element holding the pointer capture
                may not unmount while a drag is live. If it does — which a
                re-pagination mid-drag would do by flipping `status` to
                loading — capture is released to the sandboxed epub.js
                iframe, the page stops receiving pointer input, and the
                gesture never hears that it ended (PAGE_CURL.md §9). */}
            {(status === "ready" || gestureActive) && !stageReducedMotion && (
              <>
                <div
                  className={`${styles.turnGrabSurface} ${styles.turnGrabSurfaceLeft}`}
                  aria-hidden="true"
                  onPointerDown={(event) => handleGrabPointerDown("prev", event)}
                />
                <div
                  className={`${styles.turnGrabSurface} ${styles.turnGrabSurfaceRight}`}
                  aria-hidden="true"
                  onPointerDown={(event) => handleGrabPointerDown("next", event)}
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
                onPlayFromHere={() => void handlePlayFromSelection()}
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
            {findOpen && findCardOpen && (
              <SearchResultsCard
                key="search-results-card"
                rows={findRows}
                currentIndex={findCursorIndex}
                query={findQuery}
                loading={findLoading}
                onSelect={goToFindHitIndex}
                onClose={() => setFindCardOpen(false)}
                appBoundsRef={appBoundsRef}
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
        {/* M22.5 "the reader's action cluster never overlaps the card":
            floats in the room beside the reading column when there's
            enough of it — never inside .stage's own rect, since that's the
            page fold's grab surface. Absent in fullscreen (joins the
            proximity-revealed set below instead, since there's no longer
            room outside the page to float in). */}
        {!fullscreenMode && actionsBesideCard && (
          <div className={styles.actionsBeside}>
            <ReaderActionsCluster
              onOpenDigest={onOpenDigest}
              onOpenScan={onOpenScan}
              onNavigateToSettings={openSettingsToLLM}
              onPublish={onPublish}
              publishing={publishing}
              scanButtonRef={scanButtonRef}
              digestButtonRef={digestButtonRef}
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
        <div className={styles.footerNav}>
          <IconButton
            icon={<ChevronIcon direction="left" />}
            label="Previous page"
            disabled={atStart}
            onClick={() => turnPage("prev")}
          />
          <PageNumberDisplay
            mode={pageNumberMode}
            bookPage={bookPage?.page ?? null}
            bookTotal={bookPage?.total ?? null}
            chapterPage={displayedPage?.page ?? null}
            chapterTotal={displayedPage?.total ?? null}
          />
          <IconButton
            icon={<ChevronIcon direction="right" />}
            label="Next page"
            disabled={atEnd}
            onClick={() => turnPage("next")}
          />
        </div>
        {/* The "no room beside the card" fallback — same row as the page
            turn controls, right-aligned past them, still outside .stage. */}
        {!fullscreenMode && !actionsBesideCard && (
          <ReaderActionsCluster
            onOpenDigest={onOpenDigest}
            onOpenScan={onOpenScan}
            onNavigateToSettings={openSettingsToLLM}
            onPublish={onPublish}
            publishing={publishing}
            scanButtonRef={scanButtonRef}
            digestButtonRef={digestButtonRef}
          />
        )}
      </div>
      {fullscreenMode && (
        <div
          className={`${styles.fullscreenFloating} ${styles.actionsFullscreenFloating} ${
            revealActions ? styles.revealed : ""
          }`}
          onPointerEnter={() => setRevealActions(true)}
          onPointerLeave={() => setRevealActions(false)}
        >
          <ReaderActionsCluster
            onOpenDigest={onOpenDigest}
            onOpenScan={onOpenScan}
            onNavigateToSettings={openSettingsToLLM}
            onPublish={onPublish}
            publishing={publishing}
            scanButtonRef={scanButtonRef}
            digestButtonRef={digestButtonRef}
          />
        </div>
      )}
      <AnimatePresence>
        {castOpen && (
          <CastingModal
            key="casting-modal"
            resourceId={resourceId}
            origin={castOrigin}
            onClose={() => setCastOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
