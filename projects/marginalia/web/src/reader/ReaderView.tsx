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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";
import {
  UNRESOLVABLE_CHAPTER_ANCHOR_CFI,
  findAnchorInText,
  isDefinableTerm,
  normalizeDefineTerm,
  type CreateHighlightBody,
  type CursorStyleChoice,
  type Definition,
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
  type ThematicQuestion,
  type ThreadSummary,
} from "@marginalia/shared";
import { useJobs } from "../jobs/JobsContext.js";
import { startJobRequest } from "../jobs/jobsApi.js";
import { onSettingsSaved } from "../settings/settingsBus.js";
import { onProviderRolesSaved } from "../settings/providerBus.js";
import { ProviderPicker } from "../settings/ProviderPicker.js";
import { useOpenSettings } from "../settings/useOpenSettings.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { KeyCapAnchor } from "../shortcuts/KeyCap.js";
import { useReaderThemeVars } from "./useReaderThemeVars.js";
import { ChevronIcon } from "./ChevronIcon.js";
import { AudioTransportIcon } from "./AudioTransportIcon.js";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { Slider } from "../controls/Slider.js";
import { ExpandingCluster } from "../controls/ExpandingCluster.js";
import { BrainIcon, FullscreenIcon, MagnifierIcon, PublishIcon, ScanIcon, TrayIcon } from "../controls/icons.js";
import { BookCover } from "../library/BookCover.js";
import { coverLayoutId } from "../library/coverLayoutId.js";
import { ChromeSlotPortal } from "../app/chromeSlot.js";
import { DEFAULT_KIND_LABELS, hoverFillOpacity, kindLabelsFromSettings } from "./highlightKinds.js";
import { EpubRenderer, HIGHLIGHT_MARK_CLASS } from "./renderer/epub/EpubRenderer.js";
import { parseSerializedLocator, serializeLocator, type Locator } from "./renderer/types.js";
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
import { cursorPastPageText, pointIsOverInk } from "./pageTextEdge.js";
import { capturePageSnapshot, snapshotInset } from "./pageSnapshot.js";
import { requestPutDown, reportPutDownSnapshotImage } from "../scene3d/putDown.js";
import { emitDeskViewMode, loadDeskViewMode, type DeskViewMode } from "../desk/deskViewBus.js";
import { PageFold3D } from "./PageFold3D.js";
import { FarLeafCover } from "./FarLeafCover.js";
import { PageSlide } from "./PageSlide.js";
import { DwellRing } from "./DwellRing.js";
import { AskPill } from "./AskPill.js";
import { LinkQuoteBanner } from "./LinkQuoteBanner.js";
import { MarginRail } from "./MarginRail.js";
import { ThreadPanel } from "../threads/ThreadPanel.js";
import { resolveOpenHighlightId } from "../threads/resolvePrimaryAnchor.js";
import { addThreadAnchor } from "../threads/threadAnchorsApi.js";
import { isReaderOrigin } from "../highlights/highlightOrigin.js";
import { AnnotationsOverview } from "./AnnotationsOverview.js";
import { DefinitionCard, type DefinitionCardState } from "./DefinitionCard.js";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog.js";
import { Glossary, glossaryEntries, isGlossaryEntry, type GlossarySortMode } from "./Glossary.js";
import { chapterAtPercent, chapterStops as deriveChapterStops, currentChapter as deriveCurrentChapter, type TocEntry } from "./renderer/epub/toc.js";
import { ChapterNav } from "./ChapterNav.js";
import { ProgressPopover } from "./ProgressPopover.js";
import { PageNumberDisplay } from "./PageNumberDisplay.js";
import { NavCluster } from "../app/NavCluster.js";
import {
  buildBookPageMap,
  lookupBookPage,
  recordMeasuredPages,
  type BookPageMap,
} from "./bookPages.js";
import {
  DECLARE_SWIPE_PX,
  declaredTurnDirection,
  isDepartureSwipe,
  pinchFontScale,
  READER_MARGIN_PX,
  turnZoneForVisibleX,
} from "./readerGeometry.js";
import { HINGE_ARC_RADIUS_MODE, usePageTurnAnimation } from "./usePageTurnAnimation.js";
import { useFullscreenChrome } from "./useFullscreenChrome.js";
import { useReaderPaneWidth } from "./useReaderPaneWidth.js";
import { useReaderStripLayout } from "./useReaderStripLayout.js";
import { useMarqueeOverflow } from "./useMarqueeOverflow.js";
import { PinchResizeInstrument } from "./PinchResizeInstrument.js";
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN } from "../settings/tabs/ReadingTab.js";
import { ChapterEndPrompt } from "./ChapterEndPrompt.js";
import { createChapterAnchor, fetchBrief, fetchThematicStatus } from "../digest/digestApi.js";
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

/** Pixels of ruler movement per whole percentage point — passed once into
 * `Slider` and read from there by both its own drag math and its dial's
 * ruler, so the two can no longer drift apart (M22.5: they were previously
 * a hand-shared constant, and that's exactly how the duplication that hid
 * the response-length slider's bug happened elsewhere). */
const PROGRESS_DRAG_PX_PER_PERCENT = 6;

// epub.js-specific rendering (mount/theme/marks/navigation) lives entirely in
// `EpubRenderer` (M40 §A, PDF.md §7) — see ./renderer/epub/EpubRenderer.ts.

/**
 * M31 C: one touch state machine, wired up at two independent attachment
 * points — a plain `React.TouchEvent` listener on `.stage` for the parent
 * document's own paper (the outer margins, the spine gutter: genuinely
 * outside the sandboxed epub.js iframe), and a raw, non-passive
 * `addEventListener` straight on each rendered section's `contents.document`
 * for the ink inside it (C2: epub.js's own forwarded touch events are
 * `{ passive: true }`, so `preventDefault()` on them is always a no-op).
 *
 * ⚠️ The two are independent, not one continuous stream. A touch's
 * `touchmove`/`touchend` are dispatched to wherever its `touchstart` first
 * landed (the platform's own "implicit touch capture"), and `TouchEvent
 * .touches` only ever lists touches whose target lives in *that* document —
 * exactly the "events inside the sandboxed iframe never bubble out" fact
 * `handleStagePointerMove`/`handleContentMouseMove` already live with for
 * the mouse. A swipe or pinch that starts and stays within one region (ink
 * only, or paper only) works correctly; one that straddles the ink/paper
 * boundary — a finger planted in the outer margin, the other on the text —
 * is a known gap, recorded in NOTES.md rather than silently unhandled.
 *
 * Per DESIGN.md's touch table, the ink/paper test itself is *not* needed
 * here — "does a selection exist?" is the whole discriminator, because the
 * platform only ever selects over ink via its own hold-then-drag. That is
 * what lets one state machine serve both attachment points identically.
 */
interface TouchGestureState {
  /** The single finger being watched for a horizontal turn or a vertical
   * departure — its own `Touch.identifier`, or null between gestures. */
  singleId: number | null;
  startX: number;
  startY: number;
  /** A turn or a departure already fired for this touch — ignore the rest
   * of its travel rather than re-firing (C1 is a discrete commit, not a
   * finger-tracked peel; DESIGN.md, "Commit through turnPageRef"). */
  committed: boolean;
  /** C5: a selection appeared, or a second finger arrived — stops tracking
   * `singleId` as a turn/departure candidate for the rest of this touch. */
  disarmed: boolean;
  /** The two fingers of a live pinch (C6), by identifier — null when not
   * pinching. Set the instant a second finger arrives, which also disarms
   * whatever `singleId` was doing (C5: "a second finger cancels an
   * uncommitted swipe"). */
  pinchIds: [number, number] | null;
  pinchStartDist: number;
  pinchStartScale: number;
  /** The last scale `handleTouchMove` computed — what a lifted finger
   * commits, since the touchend that ends a pinch carries no distance of
   * its own to recompute one from. */
  pinchLastScale: number;
}

function freshTouchGestureState(): TouchGestureState {
  return {
    singleId: null,
    startX: 0,
    startY: 0,
    committed: false,
    disarmed: false,
    pinchIds: null,
    pinchStartDist: 0,
    pinchStartScale: 1,
    pinchLastScale: 1,
  };
}

interface TouchGestureCallbacks {
  hasLiveSelection: () => boolean;
  /** C9's "disarmed while... being edited" — the AskPill/ThreadPanel/
   * DefinitionCard/Settings text fields all live in the parent document. */
  isEditingSomewhere: () => boolean;
  /** C9's "disarmed while... mid-turn". */
  isMidTurn: () => boolean;
  /** The card's own height, in viewport px — `pageClipRef`'s box, "the whole
   * sheet" (readerGeometry.ts's own framing), for `isDepartureSwipe`'s
   * page-fraction test. */
  getPageHeight: () => number;
  /** Viewport px for a touch's own `clientX`/`clientY` — identity for the
   * parent-document attachment, `+ iframeRect.left/top` for the one inside
   * the sandboxed iframe (the exact conversion `handleContentMouseMove`
   * already does for the mouse). */
  toViewport: (clientX: number, clientY: number) => { x: number; y: number };
  fontScale: () => number;
  onCommitTurn: (direction: "prev" | "next") => void;
  onCommitDeparture: () => void;
  /** C7: "in immersive mode, a tap anywhere reveals the pebble" — fired for
   * a touch that ends without ever declaring a turn, a departure or a
   * pinch, i.e. a plain tap. Additive (DESIGN.md): whatever else a tap does
   * at that spot — dismiss a pending pill, open a mark's thread, both via
   * the native `click` epub.js still synthesizes — still happens too. */
  onTap: () => void;
  onPinchPreview: (scale: number, viewportX: number, viewportY: number) => void;
  onPinchCommit: (scale: number) => void;
  onPinchEnd: () => void;
}

/** Distance between two touches' viewport points — the pinch's own ruler. */
function touchPairDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function handleTouchStart(
  state: TouchGestureState,
  touches: TouchList,
  callbacks: TouchGestureCallbacks,
): void {
  if (touches.length >= 2) {
    state.singleId = null;
    state.disarmed = true;
    const a = touches[0];
    const b = touches[1];
    state.pinchIds = [a.identifier, b.identifier];
    const va = callbacks.toViewport(a.clientX, a.clientY);
    const vb = callbacks.toViewport(b.clientX, b.clientY);
    state.pinchStartDist = touchPairDistance(va.x, va.y, vb.x, vb.y);
    state.pinchStartScale = callbacks.fontScale();
    state.pinchLastScale = state.pinchStartScale;
    return;
  }
  if (callbacks.hasLiveSelection() || callbacks.isEditingSomewhere()) return;
  const t = touches[0];
  if (!t) return;
  state.singleId = t.identifier;
  state.startX = t.clientX;
  state.startY = t.clientY;
  state.committed = false;
  state.disarmed = false;
}

function findTouch(touches: TouchList, id: number): Touch | null {
  for (let i = 0; i < touches.length; i += 1) {
    if (touches[i].identifier === id) return touches[i];
  }
  return null;
}

/** Returns whether the caller should `preventDefault()` the move — true for
 * exactly the cases C2 wants native panning suppressed on: a live pinch, or
 * an un-disarmed single-finger candidate. Never true once a selection exists
 * or a second finger has disarmed the touch — the platform needs the event
 * untouched to keep extending a native selection. */
function handleTouchMove(
  state: TouchGestureState,
  touches: TouchList,
  callbacks: TouchGestureCallbacks,
): boolean {
  if (state.pinchIds) {
    const a = findTouch(touches, state.pinchIds[0]);
    const b = findTouch(touches, state.pinchIds[1]);
    if (!a || !b) return false;
    const va = callbacks.toViewport(a.clientX, a.clientY);
    const vb = callbacks.toViewport(b.clientX, b.clientY);
    const dist = touchPairDistance(va.x, va.y, vb.x, vb.y);
    const scale = pinchFontScale(
      state.pinchStartDist,
      dist,
      state.pinchStartScale,
      TEXT_SIZE_MIN,
      TEXT_SIZE_MAX,
    );
    state.pinchLastScale = scale;
    const centreX = (va.x + vb.x) / 2;
    const centreY = (va.y + vb.y) / 2;
    callbacks.onPinchPreview(scale, centreX, centreY);
    return true;
  }
  if (state.singleId === null || state.disarmed || state.committed) return false;
  if (callbacks.hasLiveSelection()) {
    // C5: "a selection disarms the swipe for the rest of that touch" — the
    // platform's own long-press just won; stand down and let it extend
    // natively, untouched by us from here on.
    state.disarmed = true;
    return false;
  }
  const t = findTouch(touches, state.singleId);
  if (!t) return false;
  const dx = t.clientX - state.startX;
  const dy = t.clientY - state.startY;

  const direction = declaredTurnDirection(dx, dy, DECLARE_SWIPE_PX);
  if (direction) {
    state.committed = true;
    callbacks.onCommitTurn(direction);
    return true;
  }

  if (
    !callbacks.isEditingSomewhere() &&
    !callbacks.isMidTurn() &&
    isDepartureSwipe(dx, dy, callbacks.getPageHeight())
  ) {
    state.committed = true;
    callbacks.onCommitDeparture();
    return true;
  }

  // Still undeclared — suppress native panning/back-swipe regardless (C2),
  // since no selection exists yet and this single finger is still a live
  // swipe/departure candidate.
  return true;
}

function handleTouchEnd(state: TouchGestureState, callbacks: TouchGestureCallbacks): void {
  if (state.pinchIds) {
    callbacks.onPinchCommit(state.pinchLastScale);
    callbacks.onPinchEnd();
    state.pinchIds = null;
    return;
  }
  if (state.singleId !== null && !state.committed && !state.disarmed) {
    // No turn, no departure, no selection — a plain tap.
    callbacks.onTap();
  }
  state.singleId = null;
  state.committed = false;
  state.disarmed = false;
}

/** A system interruption (an incoming call, the OS taking the gesture for
 * itself) — reset tracking without committing. An already-committed turn or
 * departure already ran synchronously inside `handleTouchMove` and cannot be
 * undone; an in-flight, uncommitted pinch is discarded rather than applied. */
function handleTouchCancel(
  state: TouchGestureState,
  callbacks: Pick<TouchGestureCallbacks, "onPinchEnd">,
): void {
  if (state.pinchIds) callbacks.onPinchEnd();
  Object.assign(state, freshTouchGestureState());
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

/** M35 §G4: ensures `highlightId` has a real `threads` row before any
 * message exists, so "Link a quote" has a `threadId` to call
 * `addThreadAnchor` against right away rather than waiting for the reader to
 * actually ask something. */
async function postHighlightThread(highlightId: string): Promise<ThreadSummary | null> {
  const res = await fetch(`/api/highlights/${highlightId}/thread`, { method: "POST" });
  if (!res.ok) return null;
  return (await res.json()) as ThreadSummary;
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

/**
 * M30 C: resolves the Define lookup for a highlight the client just created.
 * Never rejects — the route answers 200 for every miss (see its comment), and
 * a network failure is folded into the same designed empty state, because
 * "no definition found" is the honest thing to show either way.
 */
async function requestDefinition(highlightId: string): Promise<Definition> {
  const miss: Definition = {
    headword: "",
    definition: "",
    source: "",
    attribution: "",
    reason: "not_found",
  };
  try {
    const res = await fetch(`/api/highlights/${highlightId}/definition`, { method: "POST" });
    if (!res.ok) return miss;
    return (await res.json()) as Definition;
  } catch {
    return miss;
  }
}

interface PendingSelection {
  cfi: string;
  exact: string;
  prefix: string;
  suffix: string;
  spineIndex: number;
  left: number;
  top: number;
}

interface ReaderViewProps {
  resourceId: string;
  /** M24.7 A: the strip's centre zone (cover + title + author), moved down
   * from `ReaderPage`'s own `.titleBar` row — `resource` itself stays owned
   * by `ReaderPage` (it also needs it for `BookOpening`), just these two
   * fields are threaded down alongside the id. */
  resourceTitle: string;
  resourceAuthor: string | null;
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
   * Scan and Publish moved out of `ReaderPage`'s title bar into controls
   * this component owns and positions itself (M24.7 §A/§D's digest cluster,
   * the strip's Scan/Publish icons; M24.7 §G drops Scan/Publish from the
   * immersive pebble entirely — see grounding note in TASKS.md) — but the
   * click handlers stay owned by `ReaderPage`, alongside the publish toast
   * and the scan shortcut's own focus target. */
  onOpenDigest: (event: ReactMouseEvent<HTMLElement>) => void;
  onOpenScan: (event: ReactMouseEvent<HTMLElement>) => void;
  /** App.tsx's own real "/settings" open-state and its `closeSettings` —
   * threaded down for the embedded `NavCluster`'s toggle check, which
   * cannot trust its own `useLocation()` in here (see `NavCluster`'s
   * `settingsOpen` prop comment for why). Mirrors the existing
   * `scanOpen`/`digestOpen` threading in `ReaderPage`. */
  settingsOpen?: boolean;
  onCloseSettings?: () => void;
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
  /** A value that changes on every distinct find-jump request, even when
   * `initialFindQuery` repeats the same string or the reader room was
   * already mounted (the Digest overlay sits on top of it rather than
   * replacing it) — react-router's `location.key` is what `ReaderPage`
   * passes. Without this, a second request while already mounted either
   * never re-triggers the effect below (identical query) or silently no-ops
   * (the hit-index consumed-ref, found live 2026-09-01: only the first
   * digest-quote click in a reader session ever jumped). */
  findRequestKey?: string;
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
  resourceTitle,
  resourceAuthor,
  initialHighlightId,
  initialQuestion,
  spreadMode,
  initialReaderPaneWidth,
  appBoundsRef,
  onReady,
  initialAutoplay,
  onOpenDigest,
  onOpenScan,
  settingsOpen,
  onCloseSettings,
  onPublish,
  publishing,
  scanButtonRef,
  digestButtonRef,
  stageRef: externalStageRef,
  initialFindQuery,
  initialFindHitIndex,
  initialFindMatchMode,
  findRequestKey,
  onFindHandoffToScan,
}: ReaderViewProps) {
  const openSettingsToLLM = useOpenSettings("llm");
  const reducedMotion = useReducedMotion();
  // M24.7 §C, redone 2026-08-24: the strip's own row-count switch, and the
  // identity block's title/author marquee — see useReaderStripLayout.ts and
  // useMarqueeOverflow.ts, and ReaderView.module.css `.stripGrid`'s comment
  // for why this moved from a `@container` query to a measured one.
  const stripTopRowRef = useRef<HTMLDivElement>(null);
  const stripFooterRef = useRef<HTMLDivElement>(null);
  const stripLeftRef = useRef<HTMLDivElement>(null);
  const stripRightRef = useRef<HTMLDivElement>(null);
  const stripStacked = useReaderStripLayout(stripTopRowRef, stripLeftRef, stripRightRef);
  const titleOuterRef = useRef<HTMLSpanElement>(null);
  const titleInnerRef = useRef<HTMLSpanElement>(null);
  const authorOuterRef = useRef<HTMLSpanElement>(null);
  const authorInnerRef = useRef<HTMLSpanElement>(null);
  const titleMarquee = useMarqueeOverflow(titleOuterRef, titleInnerRef, [resourceTitle]);
  const authorMarquee = useMarqueeOverflow(authorOuterRef, authorInnerRef, [resourceAuthor]);
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
  // M24.7 A: the resize-observer "is there room beside the card" measurement
  // that used to live here (`actionsBesideCard`) is retired — nesting via
  // `ExpandingCluster` replaces it rather than stacking alongside it
  // (TASKS.md M24.7 "do not ship both"). `readerRowRef` stays; the page
  // fold's own geometry still measures from it.
  const readerRowRef = useRef<HTMLDivElement>(null);
  // M20 (2026-08-02): the paper card — .pageClip's own box, which is what
  // the fold canvas is positioned inside and therefore the only rect its
  // geometry may be measured from. containerRef is the text column, one
  // reader margin further in; measuring the fold from *that* is what drew
  // the canvas a margin off its own content.
  const pageClipRef = useRef<HTMLDivElement>(null);
  // M40 §A: the epub.js-specific renderer (mount/theme/marks/navigation) —
  // everything that used to be `renditionRef`/`bookRef`/`currentCfiRef`/
  // `currentSpineIndexRef`/`currentContentsRef`/`tintCfiRef`/
  // `searchMarkCfisRef`/`attachedCfiRef`/`cfiOwnersRef` is now this one
  // object's own internal bookkeeping — see EpubRenderer.ts.
  const rendererRef = useRef<EpubRenderer | null>(null);
  // M32 A: the spine index the reader was on just before the current
  // relocation — comparing the two is how "just crossed a chapter boundary
  // forward" is told apart from every other kind of relocation. Was
  // currentSpineIndexRef's own read-before-overwrite; now its own ref since
  // that one no longer exists (folded into EpubRenderer).
  const previousSpineIndexRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const highlightsRef = useRef<HighlightWithThread[]>([]);
  const themeVars = useReaderThemeVars();
  // M20 step 3 (decisions.md 2026-08-03): unlike spreadMode, which is a prop
  // because epub.js needs it at `renderTo` time, the transition is read at
  // *turn* time — so it is local state seeded from the settings fetch and
  // kept current through settingsBus, exactly like readerMargin. Flipping it
  // takes effect on the next page turn, with no reload and no remount.
  const [pageTransition, setPageTransition] = useState<PageTransition>("slide");
  const {
    stageControls,
    curl,
    slide,
    gestureActive,
    getFoldPointer,
    getFoldArc,
    getFoldOrigin,
    getFoldBack,
    handleDrawCost,
    turnPage,
    turnPageSlideGuarded,
    turnPageSlideToSectionGuarded,
    handleGrabPointerDown,
  } = usePageTurnAnimation({
    rendererRef,
    containerRef,
    cardRef: pageClipRef,
    stageRef: marginWrapperRef,
    spreadMode,
    pageTransition,
  });
  // The book-loading effect's internal handlers (keydown, and the audio
  // auto-turn) close over `rendition` directly and don't re-run per-render, so
  // they reach the current turnPage through this ref rather than a stale
  // closure. (It used to be named for click-to-turn, retired at M31 A1.)
  const turnPageRef = useRef<(direction: "prev" | "next") => void>(() => {});
  // M31 C9: "disarmed... mid-turn" (DESIGN.md) needs a synchronous read of
  // `gestureActive` from inside the once-per-resourceId book-loading effect's
  // touch handlers, where the state value itself would be frozen at whatever
  // it was on mount — same "mirror it into a ref" story as fontScaleRef/
  // focusModeRef elsewhere in this file.
  const gestureActiveRef = useRef(gestureActive);
  useEffect(() => {
    gestureActiveRef.current = gestureActive;
  }, [gestureActive]);
  // Same story, for M12's `[`/`]` chapter-jump shortcuts — jumpToChapter
  // depends on `toc`/`currentSpineIndex` render state, not stable across
  // the load effect's single run.
  const chapterJumpRef = useRef<(direction: "prev" | "next") => void>(() => {});
  // The hover-boost code in `handleContentMouseMove` is defined once at
  // component scope (not inside the book-loading effect, unlike before M40
  // §A) but still shouldn't need `themeVars` as a dependency of anything —
  // this ref is the same "read the current theme without churn" pattern as
  // `focusModeRef`/`cursorStyleRef` elsewhere in this file.
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
  // M24.7 A: the digest cluster's job state is a ring around the brain icon
  // now, not the inline button-label swap this used to drive — same
  // current/total -> 0..1 fraction TasksTray's own aggregate ring uses.
  const digestChapterJob = digestChapterJobId ? jobs.find((j) => j.id === digestChapterJobId) : undefined;
  const digestChapterProgress =
    digestChapterJob && digestChapterJob.progress.total > 0
      ? digestChapterJob.progress.current / digestChapterJob.progress.total
      : null;

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

  // M38 §C1: "Digest this chapter" splits into two explicit choices —
  // plot (`digestChapterJobId` above, unchanged) and themes, tracked the
  // same way (a transient result label; the tray owns real progress/cancel).
  const [themeChapterJobId, setThemeChapterJobId] = useState<string | null>(null);
  const [themeChapterResult, setThemeChapterResult] = useState<string | null>(null);

  useEffect(() => {
    if (!themeChapterJobId) return;
    const job = jobs.find((j) => j.id === themeChapterJobId);
    if (!job || job.status === "running") return;
    setThemeChapterResult(
      job.status === "completed" ? "Analysed ✓" : job.status === "cancelled" ? "Cancelled" : "Analysis failed",
    );
    setThemeChapterJobId(null);
    window.setTimeout(() => setThemeChapterResult(null), 4000);
  }, [jobs, themeChapterJobId]);

  // M38 §C2: "hovering shows a small notice ... the reading brief's own
  // text if one is set" — a plain GET, not the full `ThematicStatus` (which
  // would pull every chapter's analysis just to reach one field). Refetched
  // whenever the book changes; the Digest page's own save button is the only
  // writer, and this reader doesn't need to notice a save made in another
  // tab mid-session any more than the rest of this page's book-level state
  // does.
  const [readingBriefText, setReadingBriefText] = useState("");
  useEffect(() => {
    fetchBrief(resourceId).then(setReadingBriefText);
  }, [resourceId]);
  // M12: table of contents (flattened, spine+percent resolved once
  // book.locations has generated) and the scrub-dial/popover UI state for
  // the progress readout.
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [progressPopoverOpen, setProgressPopoverOpen] = useState(false);
  // Non-null while either a pointer drag or the keyboard-step interaction is
  // live — the previewed (not yet committed) whole-book percent.
  const [scrubPreviewPercent, setScrubPreviewPercent] = useState<number | null>(null);
  const [highlights, setHighlights] = useState<HighlightWithThread[]>([]);
  // M35 §C6: the count badge and the Annotations list are "the reader's own
  // marks" unconditionally — never inflated by a thematic-origin highlight
  // (§C5) even when §C7's toggle has let one into `highlights` above so it
  // can render inline. Every other consumer of `highlights` (marks, margin
  // rail) is deliberately left unfiltered — that's where the toggle's own
  // effect is supposed to show.
  // M36 A2: also excludes glossary entries (`isGlossaryEntry`), so the strip
  // button's count and AnnotationsOverview's own list can't disagree —
  // AnnotationsOverview re-applies the same predicate itself, so this isn't
  // load-bearing for correctness there, only for this button's count.
  const readerHighlights = useMemo(
    () => highlights.filter((h) => isReaderOrigin(h) && !isGlossaryEntry(h)),
    [highlights],
  );
  const [unanchoredIds, setUnanchoredIds] = useState<Set<string>>(new Set());
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  // Read from `hasLiveSelection` (M31 A7), which runs inside a pointerdown
  // handler and must see the current value rather than the one this render
  // closed over — the same ref-mirror pattern as focusModeRef/themeVarsRef.
  const pendingSelectionRef = useRef<PendingSelection | null>(null);
  pendingSelectionRef.current = pendingSelection;

  // M35 §G4 "select/add highlight" mode — entered from either AskPill's
  // "Link a quote" (a brand-new thread, `allowExistingHighlightClick: true`)
  // or ThreadPanel's "Add additional quotes" on an already-open thread
  // (`false` — the ground rule, decisions.md 2026-09-01 evening, is that a
  // highlight may join a thread but a thread may never join a thread, and
  // restricting this entry to fresh text only is what keeps the two entries
  // from reading as the same tool). Mirrored into a ref for the same reason
  // `pendingSelectionRef` is — `handleMarkClicked` below is registered once
  // per rendition mount and must see the live value, not the one it closed
  // over.
  const [linkQuoteMode, setLinkQuoteMode] = useState<{
    threadId: string;
    primaryHighlightId: string;
    allowExistingHighlightClick: boolean;
  } | null>(null);
  const linkQuoteModeRef = useRef(linkQuoteMode);
  linkQuoteModeRef.current = linkQuoteMode;
  // An eligible existing-highlight click waiting on the reader's
  // confirmation before it actually becomes an anchor — the "there should be
  // a confirm step" the operator asked for. A fresh *selection*'s own
  // confirm needs no separate state: while the mode is active, `pendingSelection`
  // itself already means "confirm this selection?" (see the banner's
  // `pendingExact` below), so confirming/cancelling that case reads straight
  // off `pendingSelection` instead of a second, redundant flag that could
  // drift from it.
  const [linkQuoteConfirm, setLinkQuoteConfirm] = useState<{
    kind: "highlight";
    highlightId: string;
    exact: string;
  } | null>(null);
  const [linkQuoteError, setLinkQuoteError] = useState<string | null>(null);
  // Bumped on every successful link so ThreadPanel's anchors effect (keyed on
  // `threadId`, which never changes for an already-existing thread) knows to
  // refetch rather than only fetching once per panel mount.
  const [anchorsVersion, setAnchorsVersion] = useState(0);

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
    /** M35 §D3/§D4, found live 2026-09-01: `highlightId` above is always
     * resolved to the thread's *primary* anchor (that's the panel's
     * identity, per D3), which lost track of which anchor the reader
     * actually clicked — every open-by-click landed the `‹ N of M ›`
     * stepper on the primary's own position regardless of which of a
     * multi-anchor thread's marks was clicked. This carries the
     * originally-clicked anchor's id through, so `ThreadPanel` can seed the
     * stepper there instead of always at the primary. Omitted (falls back
     * to `highlightId`) wherever there's only ever one candidate anchor. */
    initialAnchorHighlightId?: string;
  } | null>(null);
  // M35 §G4: a margin-rail/annotations-overview/glossary click opens a
  // *different* thread's panel through `handleOpenThread`, which — unlike
  // `handleMarkClicked` — has no reason to know about "select/add highlight"
  // mode and doesn't check it. Rather than teach every one of those call
  // sites about a mode most of them will never interact with, this catches
  // the result: once the open panel no longer belongs to the thread the mode
  // is building, the mode (and any pending confirm) is stale and exits.
  useEffect(() => {
    if (linkQuoteMode && expandedThread && expandedThread.highlightId !== linkQuoteMode.primaryHighlightId) {
      setLinkQuoteMode(null);
      setLinkQuoteConfirm(null);
      setLinkQuoteError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedThread]);
  // M32 A "the chapter-end affordance": the just-finished chapter's posed
  // questions, shown quietly once `handleRelocated` sees the reader cross
  // forward into the next chapter — never set for an undigested chapter
  // (ReaderView never kicks off a thematic run from the reading path; see
  // `checkChapterEndQuestions`). Local, resets to null on every mount, same
  // as `expandedThread` above.
  const [chapterEndPrompt, setChapterEndPrompt] = useState<{
    spineIndex: number;
    questions: ThematicQuestion[];
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
  // M30 A: same live-via-settingsBus story as readerMargin above — the
  // labels can be renamed from Settings without a reload.
  const [kindLabels, setKindLabels] = useState<Record<HighlightKind, string>>(DEFAULT_KIND_LABELS);
  // M16 "reading text size": same live-via-settingsBus story as readerMargin
  // above, and the two are coupled (computeReaderGap derives the target
  // column width from fontScale) — fontScaleRef mirrors it for the
  // book-loading effect's closures, same pattern as themeVarsRef/focusModeRef.
  const [readerFontScale, setReaderFontScale] = useState<ReaderFontScale>(1);
  const fontScaleRef = useRef(readerFontScale);
  useEffect(() => {
    fontScaleRef.current = readerFontScale;
  }, [readerFontScale]);
  // M31 C6: the pinch-to-resize instrument's live state, while a two-finger
  // pinch is in progress — null the rest of the time, which is also what
  // unmounts PinchResizeInstrument and lifts the page blur. `scale` drives
  // both the popup's Slider and (via inline style) the live sample text;
  // committed to `readerFontScale` only on release, never per frame (DESIGN.md:
  // "the page does not reflow during the pinch"). A ref, not read from this
  // state, is what the commit itself reads — see `pinchLiveScaleRef` below.
  const [pinchInstrument, setPinchInstrument] = useState<
    { scale: number; x: number; y: number } | null
  >(null);
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
  // M30 D: the glossary instrument. Mutually exclusive with the annotations
  // overview below — they occupy the same corner of the stage, and two
  // stacked lists over the page is exactly the clutter DESIGN.md's
  // "instruments, not rooms" rule exists to avoid.
  const [showGlossary, setShowGlossary] = useState(false);
  // M36 B: lifted above the panel (which unmounts via AnimatePresence when
  // closed) so the choice "persists for the session" rather than resetting
  // to reading order every time the glossary is reopened.
  const [glossarySort, setGlossarySort] = useState<GlossarySortMode>("reading");
  // M30 C: the Define result, anchored where the selection was. Null when no
  // lookup is showing; `result: null` inside it means one is in flight.
  const [definitionCard, setDefinitionCard] = useState<DefinitionCardState | null>(null);
  // M30 E1: non-null while a threaded delete is awaiting confirmation — see
  // handleDeleteHighlight/performDeleteHighlight.
  const [pendingDelete, setPendingDelete] = useState<{
    highlight: HighlightWithThread;
    messageCount: number;
  } | null>(null);
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
  // M24.7 §E: the results window's order control. `findHits` stays index-
  // stable regardless (decisions.md 2026-08-14 "occurrence order is what
  // identifies a hit" — every other consumer of a hit's index, goToFindHit
  // included, depends on that never moving), so "reverse the order" is a
  // traversal-direction flag rather than a re-sort: the window renders its
  // rows back-to-front and `‹ ›`/Enter swap which physical direction is
  // "next" (see handleFindStep below) — one flag, so the pebble and the
  // window can never disagree about which hit is current.
  const [findOrderReversed, setFindOrderReversed] = useState(false);

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
      const renderer = rendererRef.current;
      if (!renderer) return;
      let loc = renderer.currentLocation();
      if (!loc || loc.sectionIndex !== hit.spineIndex) {
        await turnPageSlideToSectionGuarded(hit.spineIndex);
        loc = renderer.currentLocation();
      }
      if (!loc) return;
      const sectionText = renderer.getRenderedSectionText(hit.spineIndex);
      if (sectionText === null) return;
      const match = locateSectionHits(sectionText, hit.spineIndex).find((entry) => entry.index === index)?.match;
      if (!match) return; // no longer resolvable live — skip silently, same philosophy as the audio tint
      await renderer.goTo({ sectionIndex: hit.spineIndex, offset: match.start, length: match.end - match.start });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turnPageSlideToSectionGuarded],
  );

  // M24: arriving from the Scan's own search cursor (the reverse handoff —
  // see `initialFindHitIndex` on ReaderViewProps) opens the bar pre-filled
  // and, once its own search request resolves, jumps straight to that hit.
  // Keyed on `findRequestKey` (not just `initialFindQuery`) and re-arms the
  // consumed-ref below on every fire — found live 2026-09-01: a digest quote
  // click navigates to this same route while the reader room is already
  // mounted underneath the Digest overlay, so neither "the query string
  // changed" nor "consumed once, ever" actually identify a fresh request;
  // only a new navigation (a new `location.key`) does.
  const initialFindHitConsumedRef = useRef(false);
  useEffect(() => {
    if (initialFindQuery === undefined) return;
    setFindOpen(true);
    setFindQuery(initialFindQuery);
    if (initialFindMatchMode !== undefined) setFindMatchMode(initialFindMatchMode);
    initialFindHitConsumedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFindQuery, findRequestKey]);
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
    // Reversed order flips which physical direction "next"/"prev" walk in —
    // see findOrderReversed's own comment above.
    const effectiveDirection = findOrderReversed
      ? direction === "next"
        ? "prev"
        : "next"
      : direction;
    goToFindHitIndex(stepFindCursor(findCursorIndex, findHits.length, effectiveDirection));
  }

  function handleSeeInScan(index: number = findCursorIndex) {
    onFindHandoffToScan?.(findQuery.trim(), index, findMatchMode);
  }

  const {
    wrapperRef,
    fullscreenMode,
    fullscreenModeRef,
    toggleFullscreen,
    pebbleAwake,
    wakePebble,
    onPebblePointerEnter,
    onPebblePointerLeave,
  } = useFullscreenChrome();
  const { effectivePaneWidth, paneWidthDragging, handlePaneResizePointerDown } =
    useReaderPaneWidth(readerPaneWidth, setReaderPaneWidth, spreadMode, fullscreenMode);
  const navigate = useNavigate();

  // M33 §C: one shared trigger for every way to leave the reader for the
  // Desk — the embedded NavCluster's Library link and its `d`/`l`/`b`
  // (via `onDepart` below), Esc-while-reading (`handleEscapeShortcut`), and
  // the M31 §C9 touch departure (`onCommitDeparture`, both callback sets) —
  // so "leaving a book by the Desk button and by Esc produce the same
  // sequence" (TASKS.md M33 C acceptance) is one function, not three
  // policies that can drift apart. `forcedMode` is set only by `d`/`l`/`b`,
  // which choose a view mode outright; every other trigger passes none,
  // landing on whichever of desk/list/shelf was last used
  // (`loadDeskViewMode`) — the same "no mode emit" reasoning the old plain
  // `navigate("/")` relied on directly, kept exactly, just resolved a beat
  // earlier so the put-down's destination request can carry it.
  //
  // The snapshot capture is fire-and-forget: `navigate("/")` runs
  // immediately rather than waiting on it, because a departure that stalled
  // for capturePageSnapshot's own budget (up to 700ms) would read as an
  // unresponsive Escape/button press. `BookClosing.tsx`'s bridge tolerates
  // the picture arriving a beat late — the same "a null result just means
  // blank paper" fallback `BookOpening.tsx`'s own capture already leans on.
  const startPutDown = useCallback(
    (forcedMode?: DeskViewMode) => {
      if (forcedMode) emitDeskViewMode(forcedMode);
      const mode = forcedMode ?? loadDeskViewMode();
      const stageEl = stageRef.current;
      if (!stageEl) {
        navigate("/");
        return;
      }
      const rect = stageEl.getBoundingClientRect();
      requestPutDown(resourceId, resourceTitle, mode, {
        stage: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        paneAspect: rect.height > 0 ? rect.width / rect.height : null,
        spreadInset: snapshotInset(stageEl),
      });
      void capturePageSnapshot(stageEl).then((image) => reportPutDownSnapshotImage(resourceId, image));
      navigate("/");
    },
    [resourceId, resourceTitle, navigate],
  );

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
    // M35 §G4: "select/add highlight" mode is the next-innermost layer —
    // Esc always exits the whole mode (never just its pending confirm, per
    // the operator's own instruction), same early-return shape as the find
    // bar above it.
    if (linkQuoteModeRef.current) {
      setLinkQuoteMode(null);
      setLinkQuoteConfirm(null);
      setLinkQuoteError(null);
      return;
    }
    // M33 §C4: "Esc while reading" is the put-down — but only once nothing
    // shallower has claimed it. Read before any of it is cleared below, so a
    // reader with a pending selection, an open thread, an open definition,
    // an open progress popover, or fullscreen still gets today's dismissal;
    // Escape only falls through to leaving the room when there was truly
    // nothing left to close (TASKS.md M33 C's own "closest layer first").
    const hadSomethingToClose =
      pendingSelection !== null ||
      expandedThread !== null ||
      definitionCard !== null ||
      progressPopoverOpen ||
      fullscreenModeRef.current;
    setPendingSelection(null);
    setExpandedThread(null);
    setDefinitionCard(null);
    setProgressPopoverOpen(false);
    if (fullscreenModeRef.current) toggleFullscreen();
    if (!hadSomethingToClose) startPutDown();
  }, [
    closeFindBar,
    toggleFullscreen,
    startPutDown,
    pendingSelection,
    expandedThread,
    definitionCard,
    progressPopoverOpen,
  ]);
  const handleFocusModeShortcut = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      // A clean page and an open annotations list are contradictory.
      if (next) {
        setShowAnnotations(false);
        setShowGlossary(false);
      }
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
    { key: SHORTCUT_KEYS.fullscreen, shift: false, handler: toggleFullscreen },
    { key: SHORTCUT_KEYS.find, meta: true, handler: handleFindShortcut, allowWhileTyping: true },
  ]);

  // M11's semicircular turn zones announced *click*-to-turn, and M31 A6
  // retired that: an affordance may not outlive its gesture (the pointer
  // contract's invariant 5). What is left is one boolean — is the pointer on
  // grabbable paper? — driving the same two edge vignettes together, because
  // paper is now the whole page outside the ink and the direction is no longer
  // a property of *where* you press. The directional `w-resize`/`e-resize`
  // cursor is gone with it; over paper the grab surface's own `cursor: grab`
  // says the true thing, and over ink the iframe keeps its own cursor.
  const [paperHover, setPaperHover] = useState(false);
  // M31 A3/A4: `.turnGrabSurface` — one element over the whole page, whose
  // `pointer-events` follow the live ink/paper answer. Written as an inline
  // style rather than through React state on purpose: this changes on
  // mousemove, and a render per pointer move is exactly what the rest of this
  // file's hover handling already refuses to pay.
  const grabSurfaceRef = useRef<HTMLDivElement | null>(null);
  // ⚠️ Frozen for the life of a press. The ink/paper decision belongs to the
  // moment the paper was taken; letting it change under a live gesture would
  // move `pointer-events` on the element currently holding pointer capture.
  const pointerHeldRef = useRef(false);
  // The content document the cursor was last set on, so it can be cleared
  // when the pointer leaves the stage entirely from the *parent* document's
  // side (a plain onPointerLeave on the container — mousemove inside the
  // iframe never fires for that).
  const lastContentsWithCursorRef = useRef<Document | null>(null);
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

  // ── M31 A3/A4/A6/A7: the grab surface steps aside ─────────────────────────
  //
  // The pointer contract's invariant 1: *nothing in the parent document may
  // hold pointer events over ink.* An overlay above the epub iframe does not
  // merely make selection awkward there — the iframe never hears the press at
  // all, which is why you could not start a highlight on the first character
  // of a line at the page edge. Invariant 2 says the fix is not to delete the
  // surface: it needs `setPointerCapture`, capture needs a real
  // parent-document `pointerdown`, and an uncaptured drag crossing the
  // sandboxed iframe is a reproduced tab crash (NOTES.md M10). So it steps
  // aside instead, live, on every pointer move.

  /** Whether `.turnGrabSurface` currently holds pointer events. Mirrors the
   * inline style rather than owning it, so the two cannot disagree. */
  const grabArmedRef = useRef(false);
  /** ⚠️ The surface is armed for a **mouse or pen only**, permanently — not
   * a placeholder until M31 C, which is built and deliberately does not use
   * this element at all (see `TouchGestureState` above `fetchPosition`).
   * Arming this surface for a finger would mean every touch anywhere on the
   * page landed on a parent-document overlay instead of the text, which is
   * invariant 1 broken for touch exactly as it was for the mouse — so a
   * finger simply never meets this element, ever. iOS synthesises a
   * mousemove after a tap, so this is tracked rather than assumed. */
  const pointerTypeRef = useRef<string>("mouse");

  function setGrabSurfaceArmed(armed: boolean) {
    if (grabArmedRef.current === armed) return;
    grabArmedRef.current = armed;
    const surface = grabSurfaceRef.current;
    if (surface) surface.style.pointerEvents = armed ? "auto" : "none";
    setPaperHover(armed);
  }

  /** Every rendered section's document — EPUB-only (`EpubRenderer.renderedFrames`,
   * up to two in spread mode), never an epubjs `Contents` past this boundary. */
  function renderedFrames(): { document: Document; frameElement: HTMLElement | null }[] {
    return rendererRef.current?.renderedFrames() ?? [];
  }

  /** The ink test for a point in the *parent* document's coordinates.
   *
   * ⚠️ The `containerRef` bound is not a nicety. epub.js lays each section out
   * in one enormously wide multi-column iframe and reveals the current page by
   * shifting the iframe element itself inside an overflow-clipped container —
   * so the iframe's own `getBoundingClientRect()` spans far off both sides of
   * the visible page, and a point out in the reader's margin maps cleanly onto
   * a glyph in a column nobody can see. Without this bound the outer margin —
   * the single most important piece of paper on the page — reports ink. */
  function pointerOverInkAt(viewportX: number, viewportY: number): boolean {
    const container = containerRef.current;
    if (!container) return false;
    const bounds = container.getBoundingClientRect();
    if (
      viewportX < bounds.left ||
      viewportX > bounds.right ||
      viewportY < bounds.top ||
      viewportY > bounds.bottom
    ) {
      return false;
    }
    for (const frame of renderedFrames()) {
      if (!frame.frameElement) continue;
      const rect = frame.frameElement.getBoundingClientRect();
      if (pointIsOverInk(frame.document, viewportX - rect.left, viewportY - rect.top)) {
        return true;
      }
    }
    return false;
  }

  /** ⚠️ Frozen while a press is down (`pointerHeldRef`): the ink/paper
   * decision belongs to the moment the paper was taken, and moving
   * `pointer-events` on the element that is currently holding pointer capture
   * is not something to find out about live. */
  function updatePointerOverPaper(
    doc: Document | null,
    local: { x: number; y: number } | null,
    viewport: { x: number; y: number },
  ) {
    // ⚠️ `isPointerDownInContentRef` is the M19.6 dwell's own guard, and it is
    // load-bearing here for a second reason: a drag-selection held out past
    // the last word on the page is *over paper*, and re-arming the surface
    // under it would put a parent-document element in the middle of a live
    // native selection drag. The answer taken at mousedown is the answer for
    // the whole press, from either side.
    if (pointerHeldRef.current || isPointerDownInContentRef.current) return;
    if (pointerTypeRef.current !== "mouse" && pointerTypeRef.current !== "pen") {
      setGrabSurfaceArmed(false);
      return;
    }
    const overInk =
      doc && local
        ? pointIsOverInk(doc, local.x, local.y)
        : pointerOverInkAt(viewport.x, viewport.y);
    setGrabSurfaceArmed(!overInk);
  }

  /** The parent document's half of the ink/paper stream. Fires for the outer
   * margin, the gutter beside the iframe, and for the grab surface itself
   * while it is armed — everything except the inside of the iframe, whose
   * events never bubble out here and which `handleContentMouseMove` covers. */
  function handleStagePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    pointerTypeRef.current = event.pointerType;
    const target = event.target as HTMLElement | null;
    // Panels, the pill, the definition card and the pane-resize handle are
    // siblings of `.pageClip`, not children — a hover over one of them is not
    // a hover over paper, and must neither arm the grab nor light the glow.
    if (!target?.closest(`[data-page-surface]`)) {
      setGrabSurfaceArmed(false);
      return;
    }
    updatePointerOverPaper(null, null, { x: event.clientX, y: event.clientY });
  }

  /** Invariant 3: *a live selection disarms every turn gesture.* Today a press
   * on the grab surface mid-selection starts a curl, which destroys the
   * selection and costs an advance and a step back for nothing. The surface
   * stays armed so the press is swallowed rather than falling through to the
   * iframe, where the native mousedown would collapse the selection — the
   * acceptance criterion is that holding a selection and pressing the outer
   * margin leaves it *intact*. The M19.6 dwell is the one exception and runs
   * on a different path entirely. */
  function hasLiveSelection(): boolean {
    if (pendingSelectionRef.current) return true;
    return renderedFrames().some((frame) =>
      Boolean(frame.document.defaultView?.getSelection()?.toString()),
    );
  }

  /** Clears the native browser selection in whichever rendered section holds
   * it — replaces the direct `pendingSelection.contents.window.getSelection()
   * ?.removeAllRanges()` calls a raw epubjs `Contents` handle used to make
   * possible; `PendingSelection` no longer carries one (M40 §A). Only one
   * section can have a live selection at a time, so clearing every rendered
   * one is equivalent to clearing "the" one that has it. */
  function clearNativeSelection() {
    for (const frame of renderedFrames()) {
      frame.document.defaultView?.getSelection()?.removeAllRanges();
    }
  }

  function handleGrabSurfacePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    pointerTypeRef.current = event.pointerType;
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") {
      // A finger that reached this element at all means the arming above got
      // it wrong (an iOS-synthesised mousemove, most likely). Stand down so
      // the *next* touch reaches the text, and swallow this one — this
      // surface is never the right handler for a touch gesture; that is
      // `TouchGestureState`'s job, on a wholly different pair of listeners.
      setGrabSurfaceArmed(false);
      return;
    }
    if (hasLiveSelection()) return;
    pointerHeldRef.current = true;
    handleGrabPointerDown(event);
  }

  // The other end of `pointerHeldRef`. Window-level rather than on the surface
  // because a press that took pointer capture can end anywhere — including
  // after the surface itself has unmounted mid-gesture, which is the case
  // `gestureActive` exists to make survivable (PAGE_CURL.md §9).
  useEffect(() => {
    function release() {
      pointerHeldRef.current = false;
    }
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  // M31 C9: "disarmed while... being edited" — a real check of the parent
  // document's own focus, the same `isTyping` shape `handleIframeKeydown`
  // already uses for the same job (its own comment explains why: a typed
  // keypress must not double as a shortcut). AskPill/ThreadPanel/
  // DefinitionCard/Settings inputs are all parent-document elements, so this
  // one check covers every one of them.
  function isEditingSomewhere(): boolean {
    const active = document.activeElement as HTMLElement | null;
    return (
      active?.tagName === "TEXTAREA" || active?.tagName === "INPUT" || Boolean(active?.isContentEditable)
    );
  }

  // ── M31 C: touch, the parent-document half ─────────────────────────────
  //
  // `.stage`'s own `onTouch*` — the outer margins and the spine gutter,
  // genuinely outside the sandboxed epub.js iframe. See the big comment
  // above `TouchGestureState` for why this is a wholly independent state
  // machine from the iframe-content one below, not one continuous stream.
  const stageTouchRef = useRef<TouchGestureState>(freshTouchGestureState());

  function stageTouchCallbacks(): TouchGestureCallbacks {
    return {
      hasLiveSelection,
      isEditingSomewhere,
      isMidTurn: () => gestureActiveRef.current,
      getPageHeight: () => pageClipRef.current?.getBoundingClientRect().height ?? 0,
      toViewport: (clientX, clientY) => ({ x: clientX, y: clientY }),
      fontScale: () => fontScaleRef.current,
      onCommitTurn: (direction) => turnPageRef.current(direction),
      onCommitDeparture: () => {
        if (hasLiveSelection() || isEditingSomewhere() || gestureActiveRef.current) return;
        navigate("/");
      },
      onTap: () => {
        if (fullscreenModeRef.current) wakePebble();
      },
      onPinchPreview: (scale, viewportX, viewportY) => {
        setPinchInstrument({
          scale,
          // M31 C6: "100px above the pinch's centre point", clamped into
          // view the same way `handleSelected` clamps the pill (M31 B2) —
          // clamp, never refuse (DESIGN.md).
          x: Math.min(Math.max(viewportX, 60), window.innerWidth - 60),
          y: Math.max(viewportY - 100, 40),
        });
      },
      onPinchCommit: (scale) => setReaderFontScale(scale),
      onPinchEnd: () => setPinchInstrument(null),
    };
  }

  // ⚠️ A raw `addEventListener`, not JSX `onTouch*` props — React has bound
  // its own root-level touchstart/touchmove listeners `{ passive: true }`
  // since v17 (matching the browser's own default), so `preventDefault()`
  // inside a synthetic `onTouchMove` handler is silently a no-op (a console
  // warning, not a thrown error) exactly like C2's epub.js-forwarded case.
  // This is the parent-document mirror of that same fact, not a special case
  // of it.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onStart(event: TouchEvent) {
      // Same guard as `handleStagePointerMove`'s own: the pill, a panel and
      // the pane-resize handle are `.stage`'s children too, not just
      // `.pageClip`'s — a touch that starts on one of them is not a touch on
      // the page, and "implicit touch capture" (the platform's own rule)
      // means checking only here is enough; this touch's own move/end stay
      // targeted at whatever this resolved to for its whole lifetime.
      const target = event.target as HTMLElement | null;
      if (!target?.closest("[data-page-surface]")) return;
      handleTouchStart(stageTouchRef.current, event.touches, stageTouchCallbacks());
    }
    function onMove(event: TouchEvent) {
      if (handleTouchMove(stageTouchRef.current, event.touches, stageTouchCallbacks())) {
        event.preventDefault();
      }
    }
    function onEnd() {
      handleTouchEnd(stageTouchRef.current, stageTouchCallbacks());
    }
    function onCancel() {
      handleTouchCancel(stageTouchRef.current, stageTouchCallbacks());
    }
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    setPaperHover(false);
    cancelDwell();
    if (lastContentsWithCursorRef.current) {
      lastContentsWithCursorRef.current.body.style.cursor = "";
    }
    // A hidden mark must stay hidden on hover (TASKS.md M16 acceptance) —
    // clear any in-progress hover boost the instant focus mode engages.
    clearMarkHover();
  }, [focusMode]);

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
   *
   * M40 §A: takes the section's own text and spine index directly — the
   * live epubjs `Contents` this used to read them off lives only inside
   * `EpubRenderer` now (`getRenderedSectionText`).
   */
  function locateSectionHits(sectionText: string, sectionIndex: number) {
    const inSection = hitsForSection(findHitsRef.current, sectionIndex);
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

  // M24 A: repaints the find bar's marks for `sectionIndex` —
  // `EpubRenderer.paintSearchMarks` does the actual CFI resolution and
  // painting (and the "don't steal a CFI a real highlight owns" rule); this
  // only locates the hits against the live text. `sectionIndex` is passed
  // explicitly rather than read off `renderer.currentLocation()`, since the
  // section-rendered call site (below) fires before a same-tick relocation
  // is guaranteed to have updated it.
  function repaintSearchMarks(sectionIndex: number | null) {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!findOpenRef.current || sectionIndex === null) {
      renderer.clearSearchMarks();
      return;
    }
    const sectionText = renderer.getRenderedSectionText(sectionIndex);
    if (sectionText === null) {
      renderer.clearSearchMarks();
      return;
    }
    const located = locateSectionHits(sectionText, sectionIndex).map(({ index, match }) => ({
      index,
      start: match.start,
      end: match.end,
    }));
    renderer.paintSearchMarks(located, findCursorIndexRef.current);
  }

  // M21: resolves the playing sentence to a DOM range and tints it, and
  // drives auto-page-turn (the slide, never the curl — AUDIO.md) when it
  // falls outside the visible page or a different section entirely.
  // Deliberately its own effect, outside the book-loading effect above, so
  // it can freely depend on player.currentSegment/turnTick without
  // re-running the whole book setup on every sentence.
  useEffect(() => {
    const renderer = rendererRef.current;
    const segment = player.currentSegment;
    if (!renderer || !segment) {
      renderer?.setTint(null);
      return;
    }

    const loc = renderer.currentLocation();
    if (!loc || loc.sectionIndex !== segment.spineIndex) {
      // The visible page hasn't caught up to this section yet — jump
      // straight there rather than leaving the tint on stale, wrong-section
      // text. A direct jump (turnPageSlideToSectionGuarded), not a chain of
      // single-page turns: the target can be many pages from wherever the
      // reader is currently sitting in the old section (a deliberate
      // chapter skip in particular), and walking there one `turnPageSlide`
      // step per `relocated` event is what produced the reported "keeps
      // jumping forward and back constantly" — each step re-triggered this
      // effect, racing a concurrent manual turn (see that helper's own
      // comment).
      //
      // M22.6 C: `detached` gates this specific jump, and only this one —
      // the reader asked to look elsewhere while the voice keeps going. The
      // tint still clears above regardless (never lie about where the voice
      // actually is), and the epubRelocated handler is what flips `detached`
      // back off once the view and the voice agree again.
      renderer.setTint(null);
      if (audioAutoTurnPagesRef.current && !detached) {
        followJumpActiveRef.current = true;
        void turnPageSlideToSectionGuarded(segment.spineIndex).finally(() => {
          followJumpActiveRef.current = false;
        });
      }
      return;
    }

    const sectionText = renderer.getRenderedSectionText(segment.spineIndex);
    if (sectionText === null) {
      renderer.setTint(null);
      return;
    }
    // AUDIO.md: "the manifest's char range -> text search in the section
    // contents" — an exact-text search against the *live* rendered text, not
    // a recomputed offset, since epub.js's rendered text can differ
    // slightly from resource_text's raw extraction (collapsed whitespace
    // etc.). No prefix/suffix: the sentence itself is almost always unique
    // enough within one section, and findAnchorInText already degrades
    // gracefully (see below) rather than throwing on a false match.
    const match = findAnchorInText(sectionText, { exact: segment.text, prefix: "", suffix: "" });
    if (!match) {
      // AUDIO.md: "a sentence that can't be resolved is skipped silently —
      // audio keeps playing; a missing tint is a blemish, a stall is a
      // broken product." Nothing else to do here.
      renderer.setTint(null);
      return;
    }
    const tintLoc: Locator = { sectionIndex: segment.spineIndex, offset: match.start, length: match.end - match.start };
    renderer.setTint(tintLoc);

    if (audioAutoTurnPagesRef.current) {
      // M40 §A: `isLocatorVisible` does the iframe/container rect math
      // (epub.js lays the whole section out in one very wide iframe and
      // reveals the current page by shifting the iframe element itself —
      // see EpubRenderer's own comment) that used to live inline here.
      if (!renderer.isLocatorVisible(tintLoc)) void turnPageSlideGuarded("next");
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
    repaintSearchMarks(rendererRef.current?.currentLocation()?.sectionIndex ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findHits, findCursorIndex, findOpen]);

  // AUDIO.md: "making a selection, opening a thread, or opening the
  // annotations overview pauses [playback]; it does not stop. You cannot
  // read an answer while being talked at." One effect covers all three
  // rather than touching every place that sets these three pieces of state.
  useEffect(() => {
    // M30 adds the two Define/glossary surfaces to the same rule: you cannot
    // read a definition while being talked at either.
    if (pendingSelection || expandedThread || showAnnotations || showGlossary || definitionCard) {
      playerRef.current.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSelection, expandedThread, showAnnotations, showGlossary, definitionCard]);

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
    // M40 §A: EpubRenderer resolves a section's highlights against its own
    // rendered document (CFI/text-search ladder) using this list — it needs
    // to stay current for the exact same reason highlightsRef itself does.
    rendererRef.current?.setHighlights(highlights);
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
      setKindLabels(kindLabelsFromSettings(settings));
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
      setKindLabels(kindLabelsFromSettings(settings));
    });
  }, []);

  useEffect(() => {
    return onProviderRolesSaved(() => {
      fetchQueryRoleConfigured().then(setProviderConfigured);
    });
  }, []);

  // M19.6 "clicking a highlight never turns the page": shared by the click
  // handler below and the hover boost further down — marks-pane draws every
  // mark `pointer-events: none` (its own library default, not ours; see
  // NOTES.md M16), so native hit-testing of a click's `target` can never see
  // a mark either. Both need the exact same geometric rect-vs-viewport-point
  // test, so it lives once here.
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

  /**
   * ⚠️ **M31 A1: a click never turns a page.** Left in place, not trimmed
   * for tidiness (DESIGN.md, "The pointer contract"; decisions.md
   * 2026-08-27). What is left is the two jobs that were never about
   * turning: don't swallow a real link, and dismiss a pending pill.
   *
   * M40 §A: `doc` is the rendered section's own plain `Document` — the
   * epub.js `Contents` this used to receive lives only inside `EpubRenderer`
   * now (`onSectionRendered`).
   */
  function handleContentClick(event: MouseEvent, doc: Document) {
    const target = event.target as HTMLElement | null;
    // Old Gutenberg-style markup often has unclosed `<a id="...">` bookmark
    // anchors (no href) that end up wrapping whole chapters per lenient
    // HTML parsing — only treat *navigable* links as click-through targets.
    if (target?.closest("a[href]")) return;
    if (doc.defaultView?.getSelection()?.toString()) return;
    // M35 §G4: while the mode is active, `pendingSelection` alone *is* the
    // pending "add this selection?" confirm (see the banner's `pendingExact`)
    // — clearing it here already dismisses that confirm, nothing extra
    // needed. A pending "link this existing highlight?" confirm isn't tied
    // to `pendingSelection` at all, so it's untouched by this click.
    setPendingSelection(null);
  }

  // The forwarded mousemove does three jobs at once: the iframe's own
  // cursor, the mark hover boost, and M19.6's dwell. Since M31 A3 it also
  // feeds the ink/paper answer that drives the grab surface — this is the
  // half of that stream that fires while the surface is standing aside
  // (`pointer-events: none` over ink); `handleStagePointerMove` in the
  // parent document is the other half. Between them they cover the page,
  // and neither can cover it alone: events inside the sandboxed iframe
  // never bubble out, and the outer margin is not inside the iframe.
  function handleContentMouseMove(event: MouseEvent, doc: Document) {
    const iframeEl = doc.defaultView?.frameElement as HTMLElement | null | undefined;
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

    // M31 A3: the surface steps aside over ink and takes the page back over
    // paper. Fed the *iframe's* own coordinates here — this handler only
    // ever fires for a point inside it — rather than re-deriving them.
    updatePointerOverPaper(
      doc,
      { x: event.clientX, y: event.clientY },
      { x: viewportX, y: viewportY },
    );

    // M20.7 "per-room cursors" — precedence, written down per the
    // TASKS.md warning. ⚠️ **M31 A6 removed the first rung**: the
    // directional `w-resize`/`e-resize` a turn zone used to force is gone,
    // because clicking a turn zone no longer turns and an affordance may not
    // outlive its gesture (invariant 5). Over paper the reader now gets the
    // grab surface's own `cursor: grab`, which is a parent-document element
    // and needs nothing written in here. What remains: (1) cursorStyle
    // "custom" shows the reader's own accent — a fine nib, i.e. an explicit
    // `text` cursor — but only while a selection actually exists in this
    // section, per DESIGN.md ("Cursor may switch to a fine I-beam/nib
    // during selection, nothing more"); (2) otherwise the inline style is
    // cleared so the iframe's native default applies untouched, which is
    // also exactly what "system" gets everywhere in this room.
    const hasSelection = Boolean(doc.defaultView?.getSelection()?.toString());
    lastContentsWithCursorRef.current = doc;
    doc.body.style.cursor = cursorStyleRef.current === "custom" && hasSelection ? "text" : "";

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
      const hasActiveSelection = Boolean(doc.defaultView?.getSelection()?.toString());
      const pastEdge = cursorPastPageText(
        zone,
        doc,
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

    // M24.7 §G: the same forwarded mousemove wakes the immersive pebble.
    // The M14 retrospective (NOTES.md "M14") is why this still needs its
    // own branch rather than relying on the window-level listener alone:
    // that listener only ever fires for the parent-document dead zone
    // (above/below/beside the iframe) — it never sees pointer movement
    // that stays inside the sandboxed epub.js iframe, which is most of a
    // fullscreen reader's pointer activity.
    if (fullscreenModeRef.current) wakePebble();
  }

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
    // A plain, immediate renderer call keeps the live DOM (and the
    // native selection anchored to it) visible throughout.
    const turn = zone === "next" ? rendererRef.current?.next() : rendererRef.current?.prev();
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

  function handleContentMouseUp() {
    isPointerDownInContentRef.current = false;
    cancelDwell();
  }

  // The shared shortcut registry (useShortcuts, above) only ever sees
  // window-level keydowns — the reading pane's own iframe is a separate
  // document, so a keypress inside it never bubbles to window at all. This
  // forwards exactly the same set of keys, via the exact same handlers, from
  // the section's own "keydown" — the one bit of unavoidable duplication
  // between the two paths.
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
      // M24.7 §G: fullscreen is plain "f" now (decisions.md 2026-08-22) —
      // a different axis from focus mode ("n"), hiding different things
      // and composing independently.
      toggleFullscreen();
    } else if (
      event.key.toLowerCase() === "n" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      handleFocusModeShortcut();
    }
  }

  // M31 C: the iframe-content half of the touch state machine — see the big
  // comment above `TouchGestureState` (module scope) for why this cannot be
  // epub.js's own forwarded touch events: those are `{ passive: true }`
  // (epubjs/src/contents.js), so `preventDefault()` on them is always a
  // no-op; C2's own fix is a raw, non-passive listener straight on the
  // section's own document, which is what this is. Fresh per rendered
  // section, deliberately: a new section is a genuinely new iframe/document
  // (epub.js destroys the old one), so there is nothing to detach and no
  // stale state to carry over — the old listeners and their
  // `TouchGestureState` simply go with it.
  function attachTouchHandlers(doc: Document) {
    const state = freshTouchGestureState();

    function toViewport(clientX: number, clientY: number) {
      const frame = doc.defaultView?.frameElement as HTMLElement | null | undefined;
      if (!frame) return { x: clientX, y: clientY };
      const rect = frame.getBoundingClientRect();
      return { x: rect.left + clientX, y: rect.top + clientY };
    }

    function callbacks(): TouchGestureCallbacks {
      return {
        hasLiveSelection,
        isEditingSomewhere,
        isMidTurn: () => gestureActiveRef.current,
        getPageHeight: () => pageClipRef.current?.getBoundingClientRect().height ?? 0,
        toViewport,
        fontScale: () => fontScaleRef.current,
        onCommitTurn: (direction) => turnPageRef.current(direction),
        onCommitDeparture: () => {
          if (hasLiveSelection() || isEditingSomewhere() || gestureActiveRef.current) return;
          startPutDown();
        },
        onTap: () => {
          if (fullscreenModeRef.current) wakePebble();
        },
        onPinchPreview: (scale, viewportX, viewportY) => {
          setPinchInstrument({
            scale,
            x: Math.min(Math.max(viewportX, 60), window.innerWidth - 60),
            y: Math.max(viewportY - 100, 40),
          });
        },
        onPinchCommit: (scale) => setReaderFontScale(scale),
        onPinchEnd: () => setPinchInstrument(null),
      };
    }

    doc.addEventListener(
      "touchstart",
      (event) => handleTouchStart(state, event.touches, callbacks()),
      { passive: true },
    );
    doc.addEventListener(
      "touchmove",
      (event) => {
        if (handleTouchMove(state, event.touches, callbacks())) event.preventDefault();
      },
      { passive: false },
    );
    doc.addEventListener("touchend", () => handleTouchEnd(state, callbacks()), {
      passive: true,
    });
    doc.addEventListener(
      "touchcancel",
      () => handleTouchCancel(state, callbacks()),
      { passive: true },
    );
  }

  /**
   * M40 §A (PDF.md §7): constructs and mounts the `EpubRenderer`, subscribes
   * to every event `ReaderView`'s chrome needs, and once `mount()` resolves
   * (the book has opened), fetches the resource-level data (position,
   * highlights, chapter meta) that used to live inside epub.js's own
   * `book.ready.then(...)`. Replaces the ~950-line book-loading effect this
   * milestone extracted `EpubRenderer` out of.
   */
  useEffect(() => {
    if (!containerRef.current || !marginWrapperRef.current) return;
    let cancelled = false;

    setStatus("loading");
    setProgressPercent(null);
    setDisplayedPage(null);
    setBookPage(null);
    sectionWeightRef.current = null;
    bookPageMapRef.current = null;
    previousSpineIndexRef.current = null;
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

    const renderer = new EpubRenderer();
    rendererRef.current = renderer;

    const unsubscribers: (() => void)[] = [];
    unsubscribers.push(
      renderer.onUnanchored((highlightId) => {
        setUnanchoredIds((prev) => {
          if (prev.has(highlightId)) return prev;
          const next = new Set(prev);
          next.add(highlightId);
          return next;
        });
      }),
    );
    unsubscribers.push(
      renderer.on("selected", ({ text, prefix, suffix, locator }) => {
        const rect = renderer.getViewportRectForSelection();
        const stage = stageRef.current;
        if (!rect || !stage) return;
        // ⚠️ M31 B2, confirmed by reading the stack rather than by
        // guessing: `AskPill` is `position: absolute` and renders as a
        // **direct child of `.stage`** (outside `.pageClip`, so a panel can
        // roam past the page's own edge), so `.stage` is its containing
        // block and the only box these numbers may be measured against.
        const stageRect = stage.getBoundingClientRect();
        const rawLeft = rect.left + rect.width / 2 - stageRect.left;
        const rawTop = rect.top - stageRect.top;
        setPendingSelection({
          cfi: locator.cfi ?? "",
          exact: text,
          prefix,
          suffix,
          spineIndex: locator.sectionIndex,
          // Clamp so a selection right at the edge of the visible page
          // can't push the pill (which renders above the selection)
          // off-screen.
          left: Math.min(Math.max(rawLeft, 40), stageRect.width - 40),
          top: Math.max(rawTop, 40),
        });
      }),
    );
    unsubscribers.push(
      renderer.on("markClicked", (highlightId) => {
        // M35 §G4: "select/add highlight" mode intercepts a mark click
        // before it ever opens a panel — `linkQuoteModeRef` (not the
        // `linkQuoteMode` state) because this handler is registered once
        // per mount and would otherwise see the value from that render
        // forever.
        const mode = linkQuoteModeRef.current;
        if (mode) {
          if (!mode.allowExistingHighlightClick) {
            setLinkQuoteError("Existing highlights can't be added from here — select new text instead.");
            return;
          }
          const clicked = highlightsRef.current.find((h) => h.id === highlightId);
          if (!clicked || clicked.id === mode.primaryHighlightId) return;
          const clickedThreadId = clicked.thread?.id ?? null;
          if (clickedThreadId !== null || clicked.primaryHighlightId !== null) {
            setLinkQuoteError(
              clickedThreadId === mode.threadId
                ? "This quote is already part of this annotation."
                : "This quote already belongs to a different annotation.",
            );
            return;
          }
          setLinkQuoteError(null);
          setLinkQuoteConfirm({ kind: "highlight", highlightId: clicked.id, exact: clicked.exact });
          return;
        }

        // A click on a highlight mark also fires as a content 'click' too —
        // handleContentClick's own mark hit-test (M19.6) is what keeps that
        // from also turning the page. Clicking a highlight expands its
        // thread. M35 §D3: a click on a non-primary anchor resolves to the
        // thread's primary — the one annotation, not a second one on this
        // passage.
        const resolvedId = resolveOpenHighlightId(highlightsRef.current, highlightId);
        setExpandedThread({ highlightId: resolvedId, top: DEFAULT_THREAD_PANEL_TOP, initialAnchorHighlightId: highlightId });
      }),
    );
    unsubscribers.push(
      renderer.onSectionRendered(({ document: doc, sectionIndex }) => {
        attachTouchHandlers(doc);
        doc.addEventListener("click", (event) => handleContentClick(event, doc));
        doc.addEventListener("mousemove", (event) => handleContentMouseMove(event, doc));
        doc.addEventListener("mousedown", handleContentMouseDown);
        doc.addEventListener("mouseup", handleContentMouseUp);
        doc.addEventListener("keydown", (event) => handleIframeKeydown(event as KeyboardEvent));
        repaintSearchMarks(sectionIndex);
      }),
    );
    unsubscribers.push(
      renderer.onEpubRelocated((info) => {
        // Shared by a real relocation and a repagination-only update — see
        // publishPageNumbers' old comment (now EpubRenderer.computeChapterPage):
        // idempotent, called on both.
        if (info.chapterPage) {
          setDisplayedPage(info.chapterPage);
          const weights = sectionWeightRef.current;
          if (weights) {
            const existing = bookPageMapRef.current;
            bookPageMapRef.current = existing
              ? recordMeasuredPages(existing, info.spineIndex, info.chapterPage.total)
              : buildBookPageMap(weights, info.spineIndex, info.chapterPage.total);
            const map = bookPageMapRef.current;
            const pageInfo = map ? lookupBookPage(map, info.spineIndex, info.chapterPage.page) : null;
            if (pageInfo) {
              setBookPage(pageInfo);
              setProgressPercent(Math.round((pageInfo.page / pageInfo.total) * 100));
            } else if (info.kind === "relocated" && typeof info.percent === "number") {
              setProgressPercent(Math.round(info.percent * 100));
            }
          } else if (info.kind === "relocated" && typeof info.percent === "number") {
            setProgressPercent(Math.round(info.percent * 100));
          }
        } else if (info.kind === "relocated" && typeof info.percent === "number") {
          setProgressPercent(Math.round(info.percent * 100));
        }

        if (info.kind !== "relocated") return;

        // M32 A: captured before it's overwritten below — the signal for
        // "the reader just crossed a chapter boundary" is comparing this
        // relocation's index against the one *before* it, forward only (a
        // backward jump, e.g. re-reading, never counts as "finishing" a
        // chapter). See checkChapterEndQuestions.
        const previousSpineIndex = previousSpineIndexRef.current;
        previousSpineIndexRef.current = info.spineIndex;
        if (previousSpineIndex !== null && info.spineIndex > previousSpineIndex) {
          void checkChapterEndQuestions(previousSpineIndex);
        }
        setAtStart(info.atStart);
        setAtEnd(info.atEnd);
        setCurrentSpineIndex(info.spineIndex);
        // M21: the audio tint/auto-turn effect needs to know "a page just
        // turned" even *within* the same spine section (currentSpineIndex
        // alone wouldn't change) — a plain counter is the cheapest signal.
        setTurnTick((t) => t + 1);

        // M22.6 C: every relocation — a manual turn, a chapter-nav/TOC jump,
        // or the follow-the-voice effect's own corrective jump — comes
        // through here, so this is the one place that can tell them apart.
        // Landing exactly on the sounding section re-engages (however it
        // happened); landing anywhere else *without* the follow jump being
        // the one doing it means the reader just navigated away on purpose.
        const sounding = playerRef.current.currentSegment;
        if (sounding) {
          if (info.spineIndex === sounding.spineIndex) setDetached(false);
          else if (!followJumpActiveRef.current) setDetached(true);
        }

        if (info.cfi) {
          window.clearTimeout(saveTimerRef.current);
          saveTimerRef.current = window.setTimeout(() => {
            // M40 §B4: writes the new SerializedLocator form — a legacy bare
            // CFI is still valid on *read* (parseSerializedLocator), but
            // every write from here on emits the wrapped form.
            savePosition(
              resourceId,
              serializeLocator({ sectionIndex: info.spineIndex, offset: 0, length: 0, cfi: info.cfi! }),
              info.spineIndex,
              typeof info.percent === "number" ? info.percent * 100 : null,
            );
          }, POSITION_SAVE_DEBOUNCE_MS);
        }
      }),
    );

    void renderer
      .mount(containerRef.current, { id: resourceId }, {
        flow: "paginated",
        spread: spreadMode,
        fontScale: fontScaleRef.current,
        marginPx: READER_MARGIN_PX[readerMargin],
      })
      .then(async () => {
        if (cancelled) return;
        renderer.applyTheme(themeVars);
        renderer.setFocusMode(focusModeRef.current);

        const [position, resourceHighlights, chapterMeta] = await Promise.all([
          fetchPosition(resourceId),
          fetchHighlights(resourceId),
          fetchChapterMeta(resourceId),
        ]);
        if (cancelled) return;
        if (chapterMeta) {
          sectionWeightRef.current = chapterMeta.weights;
          setChapterNumbers(chapterMeta.chapterNumbers);
          setSectionSpans(buildSectionSpans(chapterMeta.weights));
        }
        highlightsRef.current = resourceHighlights;
        renderer.setHighlights(resourceHighlights);
        setHighlights(resourceHighlights);

        // M35 §D3: navigate to the *clicked* passage (a secondary anchor's
        // own location, if that's what was clicked — the whole point of
        // clicking a specific dot in the Scan), but open the panel on the
        // thread's primary, so it's the one real annotation that appears.
        const jumpTarget = initialHighlightId
          ? resourceHighlights.find((h) => h.id === initialHighlightId)
          : undefined;
        // M19.5 posed-question anchors carry a deliberately-unparseable CFI
        // (see UNRESOLVABLE_CHAPTER_ANCHOR_CFI's own comment) — safe for the
        // mark-rendering fallback, but `goTo` parses a CFI directly rather
        // than catching a failure, so handing it one here would risk
        // crashing epub.js's navigation. Fall back to the saved position
        // instead; the thread panel below still opens regardless.
        // M40 §B4: `position.location` is a SerializedLocator — a bare CFI
        // on any row saved before this milestone, the wrapped form on every
        // row saved after it; `parseSerializedLocator` accepts both.
        const displayLocator: Locator | undefined =
          jumpTarget && jumpTarget.cfi !== UNRESOLVABLE_CHAPTER_ANCHOR_CFI
            ? { sectionIndex: 0, offset: 0, length: 0, cfi: jumpTarget.cfi ?? undefined }
            : position?.location
              ? parseSerializedLocator(position.location)
              : undefined;

        if (displayLocator) {
          await renderer.goTo(displayLocator);
        }
        if (cancelled) return;
        setStatus("ready");
        onReady?.();
        if (jumpTarget) {
          setExpandedThread({
            highlightId: resolveOpenHighlightId(resourceHighlights, jumpTarget.id),
            top: DEFAULT_THREAD_PANEL_TOP,
            initialDraft: initialQuestion,
            initialAnchorHighlightId: jumpTarget.id,
          });
        }

        // Locations let the renderer compute a whole-book percentage from a
        // CFI (and, per M19.6, a stable book-wide page number); M12's table
        // of contents also needs them (chapter-start percents are derived
        // from them, see toc.ts).
        renderer.ensureLocations().then(() => {
          if (cancelled) return;
          setToc(renderer.getToc());
        });
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
      window.clearTimeout(dwellTimerRef.current);
      for (const off of unsubscribers) off();
      rendererRef.current = null;
      renderer.destroy();
    };
    // themeVars intentionally excluded — handled by the effect below so
    // toggling the theme doesn't tear down and reload the whole book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceId]);

  // M40 §A: `EpubRenderer.applyTheme`/`setFocusMode` do their own full
  // re-tint internally (every owned mark + the audio tint) — this effect
  // used to do that work by hand against `renditionRef`.
  useEffect(() => {
    rendererRef.current?.applyTheme(themeVars);
  }, [themeVars]);
  useEffect(() => {
    rendererRef.current?.setFocusMode(focusMode);
  }, [focusMode]);

  // M16 "reading text size": applied through the renderer, which patches
  // already-rendered content immediately, plus the same gap-recompute +
  // debounced re-display the margin-change bug fix above uses, since
  // fontScale moves the target column width without the container's own box
  // size ever changing. Skipped on the very first mount before a renderer
  // exists — the mount-time gap/fontSize calls already used whatever
  // fontScaleRef held at that point.
  useEffect(() => {
    rendererRef.current?.setFontScale(readerFontScale);
  }, [readerFontScale]);

  // M19.6 operator feedback round 4: `setFontScale()` above patches
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
      rendererRef.current?.refreshOverlays();
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
    if (target) void rendererRef.current?.goToHref(target.href);
  }

  useEffect(() => {
    chapterJumpRef.current = jumpToChapter;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapterStopIndex, chapterStopsList.length]);

  function handleTocSelect(entry: TocEntry) {
    void rendererRef.current?.goToHref(entry.href);
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

  /** M38 §C1: the reading pane's theme half of the split — a single-chapter
   * thematic run via the existing `/thematic` route (`spineStart ===
   * spineEnd`), not a new endpoint. Mode is left at its server default
   * ("notes" — the chapter's own saved substrate), matching this button's
   * quick, from-the-reading-pane framing rather than offering the Digest
   * page's fast-vs-full choice here too. */
  async function handleAnalyzeChapterThemes() {
    if (currentSpineIndex === null || themeChapterJobId) return;
    setThemeChapterResult(null);
    const result = await startJobRequest(`/api/resources/${resourceId}/thematic`, {
      spineStart: currentSpineIndex,
      spineEnd: currentSpineIndex,
    });
    if ("jobId" in result) {
      setThemeChapterJobId(result.jobId);
      registerStarted({ id: result.jobId, kind: "thematic", resourceId, resourceTitle: null });
    } else {
      setThemeChapterResult("Analysis failed");
      window.setTimeout(() => setThemeChapterResult(null), 4000);
    }
  }

  // M38 §C2: shown on hover, before committing to the job — the same text
  // either way a run would actually use, since "notes" mode reads whatever
  // brief is current at run time.
  const themeChapterNotice = readingBriefText.trim()
    ? `Analysing themes as set in your reading brief: "${readingBriefText.trim()}"`
    : "Analysing themes automatically";

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
    void rendererRef.current?.goToPercent(percent);
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
      // This CFI was just derived from the live, currently-rendered
      // document, so it's trusted without going through resolveAnchor again.
      rendererRef.current?.paintMark(
        created.id,
        { sectionIndex: created.spineIndex, offset: 0, length: 0, cfi: created.cfi ?? undefined },
        created.kind,
      );
      clearNativeSelection();
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

  /**
   * M35 §G4, entry point A: "Link a quote" on the selection pill. Creates the
   * seed highlight exactly like Ask does (same `slate` kind — this becomes a
   * conversation-shaped annotation, not a plain mark), but instead of just
   * opening an empty panel it also ensures the highlight has a real
   * `threads` row *now* (`postHighlightThread`, since the normal
   * `POST /api/threads` path needs a non-empty question and this shouldn't
   * have to wait for one) and enters "select/add highlight" mode targeting
   * it — further selections or existing-highlight clicks keep adding anchors
   * to this same thread until the reader exits the mode.
   */
  async function handleLinkQuote() {
    if (!pendingSelection) return;
    const created = await postHighlight({
      resourceId,
      exact: pendingSelection.exact,
      prefix: pendingSelection.prefix,
      suffix: pendingSelection.suffix,
      cfi: pendingSelection.cfi,
      spineIndex: pendingSelection.spineIndex,
      kind: "slate",
    });
    if (!created) {
      setPendingSelection(null);
      return;
    }
    setHighlights((prev) => [...prev, created]);
    rendererRef.current?.paintMark(
      created.id,
      { sectionIndex: created.spineIndex, offset: 0, length: 0, cfi: created.cfi ?? undefined },
      created.kind,
    );
    clearNativeSelection();
    const top = pendingSelection.top;
    setPendingSelection(null);

    const summary = await postHighlightThread(created.id);
    if (!summary) return;
    handleThreadChange(created.id, summary);
    setExpandedThread({ highlightId: created.id, top });
    setLinkQuoteMode({ threadId: summary.id, primaryHighlightId: created.id, allowExistingHighlightClick: true });
  }

  /** M35 §G4, entry point B: "Add additional quotes" on an already-open
   * annotation's panel — enters the same mode, targeting the thread that's
   * already there, restricted to fresh selections only (decisions.md
   * 2026-09-01 evening explains why this entry doesn't also accept a click
   * on an existing highlight).
   *
   * Widened 2026-09-01: reachable now from a note-only annotation too (no
   * thread yet), since ThreadPanel's button is gated on thread-or-note, not
   * thread alone. Lazily creates the bare `threads` row the same way
   * `handleLinkQuote` above already does via `postHighlightThread` — no LLM
   * call — rather than requiring a question to have been asked first. */
  async function handleStartAddQuotes() {
    if (!expandedHighlight) return;
    let thread = expandedHighlight.thread;
    if (!thread) {
      const summary = await postHighlightThread(expandedHighlight.id);
      if (!summary) return;
      thread = summary;
      handleThreadChange(expandedHighlight.id, thread);
    }
    setLinkQuoteMode({
      threadId: thread.id,
      primaryHighlightId: expandedHighlight.id,
      allowExistingHighlightClick: false,
    });
  }

  function handleExitLinkQuoteMode() {
    setLinkQuoteMode(null);
    setLinkQuoteConfirm(null);
    setLinkQuoteError(null);
  }

  /** The reader confirmed either "add this selection" (implicit — mode
   * active plus a live `pendingSelection` is the confirm, per the state
   * comment above) or "link this existing highlight" (`linkQuoteConfirm`).
   * Both funnel into the same `addThreadAnchor` call (§G3), and both leave
   * the mode active afterward so several quotes can be attached in one pass
   * (decisions.md: "the mode never closes itself after one addition"). */
  async function handleConfirmLinkQuote() {
    const mode = linkQuoteMode;
    if (!mode) return;
    setLinkQuoteError(null);

    if (linkQuoteConfirm) {
      const { highlightId } = linkQuoteConfirm;
      const result = await addThreadAnchor(mode.threadId, highlightId);
      if (result.ok) {
        setHighlights((prev) =>
          prev.map((h) => (h.id === highlightId ? { ...h, primaryHighlightId: mode.primaryHighlightId } : h)),
        );
        setAnchorsVersion((v) => v + 1);
      } else {
        setLinkQuoteError("This quote already belongs to a different annotation.");
      }
      setLinkQuoteConfirm(null);
      return;
    }

    if (!pendingSelection) return;
    const created = await postHighlight({
      resourceId,
      exact: pendingSelection.exact,
      prefix: pendingSelection.prefix,
      suffix: pendingSelection.suffix,
      cfi: pendingSelection.cfi,
      spineIndex: pendingSelection.spineIndex,
      kind: "slate",
    });
    clearNativeSelection();
    setPendingSelection(null);
    if (!created) {
      setLinkQuoteError("Couldn't create that highlight — try again.");
      return;
    }
    setHighlights((prev) => [...prev, created]);
    rendererRef.current?.paintMark(
      created.id,
      { sectionIndex: created.spineIndex, offset: 0, length: 0, cfi: created.cfi ?? undefined },
      created.kind,
    );

    const result = await addThreadAnchor(mode.threadId, created.id);
    if (result.ok) {
      setHighlights((prev) =>
        prev.map((h) => (h.id === created.id ? { ...h, primaryHighlightId: mode.primaryHighlightId } : h)),
      );
      setAnchorsVersion((v) => v + 1);
    } else {
      setLinkQuoteError("Couldn't link that quote — try again.");
    }
  }

  function handleCancelLinkQuoteConfirm() {
    if (linkQuoteConfirm) {
      setLinkQuoteConfirm(null);
      return;
    }
    clearNativeSelection();
    setPendingSelection(null);
  }

  /**
   * M30 C "the Define button". Three things this deliberately does *not* do:
   *
   *  - It never invents a fifth kind. A definition is a **sage** highlight —
   *    the slot whose default name is literally "Define" — so the scan, the
   *    filters and the vault all keep working on it with no new enum value
   *    (settled decision 16: a kind's identity is its slot).
   *  - It never opens the thread panel. This is a lookup; the card it opens
   *    instead carries the one escalation ("Ask about this") for a reader who
   *    wanted a conversation after all.
   *  - It never leaves a spinner over the text. The card mounts immediately
   *    in its own looking-up state and resolves in place.
   */
  async function handleDefine() {
    if (!pendingSelection) return;
    const { exact, left, top } = pendingSelection;
    const term = normalizeDefineTerm(exact);

    const created = await postHighlight({
      resourceId,
      exact,
      prefix: pendingSelection.prefix,
      suffix: pendingSelection.suffix,
      cfi: pendingSelection.cfi,
      spineIndex: pendingSelection.spineIndex,
      kind: "sage",
    });
    clearNativeSelection();
    setPendingSelection(null);
    if (!created) return;

    setHighlights((prev) => [...prev, created]);
    rendererRef.current?.paintMark(
      created.id,
      { sectionIndex: created.spineIndex, offset: 0, length: 0, cfi: created.cfi ?? undefined },
      created.kind,
    );
    setDefinitionCard({ left, top, term, highlightId: created.id, result: null });

    const result = await requestDefinition(created.id);
    applyDefinitionResult(created.id, result);
  }

  /** Shared by the initial dictionary lookup (handleDefine) and M30 E
   * feedback's "look deeper" (onDeepened, passed to DefinitionCard): the
   * definition lives on the highlight server-side; mirroring it into local
   * state is what puts the entry in the glossary without a refetch. */
  function applyDefinitionResult(highlightId: string, result: Definition) {
    if (result.definition) {
      setHighlights((prev) =>
        prev.map((h) =>
          h.id === highlightId
            ? { ...h, definition: result.definition, definitionSource: result.source }
            : h,
        ),
      );
    }
    // Guard against a second Define having replaced this card while the
    // lookup was in flight — the reader is faster than the digest rung.
    setDefinitionCard((prev) =>
      prev && prev.highlightId === highlightId ? { ...prev, result } : prev,
    );
  }

  /** The definition card's "Ask about this": the same sage highlight becomes
   * a conversation, rather than Define having quietly opened one nobody
   * asked for. */
  function handleAskFromDefinition() {
    if (!definitionCard?.highlightId) return;
    setExpandedThread({ highlightId: definitionCard.highlightId, top: definitionCard.top });
    setDefinitionCard(null);
  }

  // M22.6 C "'Play from here' joins the selection pill": starts listening
  // at the selected sentence instead of the section's first. Doesn't create
  // a highlight — this is a playback action, not a marking one — so it
  // clears the pill itself rather than routing through
  // createHighlightFromSelection.
  async function handlePlayFromSelection() {
    if (!pendingSelection) return;
    const { spineIndex, exact, prefix, suffix } = pendingSelection;
    const sectionText = rendererRef.current?.getRenderedSectionText(spineIndex) ?? "";
    const match = findAnchorInText(sectionText, { exact, prefix, suffix });
    let sentenceIndex = 0;
    if (match) {
      const manifest = await fetchSectionManifest(resourceId, spineIndex);
      if (manifest) sentenceIndex = resolveSegmentIndexForOffset(sectionText, match.start, manifest.segments);
    }
    player.playFrom(spineIndex, sentenceIndex);
    clearNativeSelection();
    setPendingSelection(null);
  }

  /**
   * M30 E1: the actual, irreversible delete — unchanged from before this
   * milestone. `handleDeleteHighlight` below is what call sites use; it
   * gates this behind a confirmation whenever there's a thread with
   * messages to lose.
   */
  async function performDeleteHighlight(highlight: HighlightWithThread) {
    const ok = await deleteHighlightRequest(highlight.id);
    if (!ok) return;
    setHighlights((prev) => prev.filter((h) => h.id !== highlight.id));
    setUnanchoredIds((prev) => {
      if (!prev.has(highlight.id)) return prev;
      const next = new Set(prev);
      next.delete(highlight.id);
      return next;
    });
    rendererRef.current?.removeMark(highlight.id);
    setExpandedThread((prev) => (prev?.highlightId === highlight.id ? null : prev));
    // M30 C: a card left open over a highlight that no longer exists would
    // offer an "Ask about this" that can't work.
    setDefinitionCard((prev) => (prev?.highlightId === highlight.id ? null : prev));
  }

  /**
   * M30 E1: "the hazard is more urgent than the feature" — `deleteHighlight`
   * cascades to the whole thread with no undo, so a highlight carrying a
   * conversation gets a confirm step naming how many messages are about to
   * go; a bare (un-threaded) highlight — cheap and reversible by
   * re-highlighting — deletes immediately, same as before this milestone.
   * The single entry point every call site (margin rail, annotations
   * overview, and M30 E2's thread panel) already goes through, so the guard
   * lives in exactly one place.
   */
  function handleDeleteHighlight(highlight: HighlightWithThread) {
    const messageCount = highlight.thread?.messageCount ?? 0;
    if (messageCount > 0) {
      setPendingDelete({ highlight, messageCount });
      return;
    }
    void performDeleteHighlight(highlight);
  }

  function handleNavigateToHighlight(highlight: HighlightWithThread) {
    void rendererRef.current?.goTo({ sectionIndex: 0, offset: 0, length: 0, cfi: highlight.cfi ?? undefined });
  }

  /** M35 §D4: `< >` traversal inside an open ThreadPanel — moves the reader
   * to another of the *same* thread's anchors without touching
   * `expandedThread` (which would remount the panel by its `key` and lose
   * the traversal position and any in-progress editing). */
  function handleJumpToAnchor(highlightId: string) {
    const anchor = highlightsRef.current.find((h) => h.id === highlightId);
    if (anchor) handleNavigateToHighlight(anchor);
  }

  /** M35 §D3: resolves to the thread's primary when `highlight` is itself a
   * non-primary anchor — the caller (margin rail dot, annotations overview
   * row, glossary entry) navigates to `highlight`'s own passage separately,
   * so only the panel's identity needs resolving here. */
  function handleOpenThread(highlight: HighlightWithThread) {
    setExpandedThread({
      highlightId: highlight.primaryHighlightId ?? highlight.id,
      top: DEFAULT_THREAD_PANEL_TOP,
      initialAnchorHighlightId: highlight.id,
    });
  }

  /**
   * M32 A: a plain read of the thematic layer's already-generated data for
   * the chapter the reader just finished — never starts a job (that stays a
   * digest-page action the reader takes deliberately). `reveal` names this
   * one chapter explicitly rather than waiting on the saved bookmark, which
   * lags this relocation by up to POSITION_SAVE_DEBOUNCE_MS.
   */
  async function checkChapterEndQuestions(spineIndex: number) {
    // Crossing another boundary always clears whatever chapter the prompt
    // was showing before — never leaves a stale one up once its own chapter
    // is several pages behind.
    setChapterEndPrompt(null);
    const status = await fetchThematicStatus(resourceId, new Set([spineIndex]));
    const chapter = status?.chapters.find((c) => c.spineIndex === spineIndex);
    if (chapter?.analyzed && chapter.questions.length > 0) {
      setChapterEndPrompt({ spineIndex, questions: chapter.questions });
    }
  }

  /** Clicking a chapter-end question turns its verbatim quote into a real,
   * anchored highlight (the same seam the digest page's own question chips
   * use — decision 11: the model returns text, code locates it) and opens a
   * thread on it, pre-filled, without navigating away from wherever the
   * reader currently is.
   *
   * M35 §B2: a quote that can't be located no longer produces a
   * mis-anchored highlight here — it's seeded as a chapter-level question
   * instead (visible on the Digest page's own box for that chapter). There's
   * no highlight to open a thread on in that case, so this deliberately
   * degrades to no-op rather than opening a thread on the wrong passage.
   */
  async function handleChapterEndAsk(spineIndex: number, question: ThematicQuestion) {
    setChapterEndPrompt(null);
    const result = await createChapterAnchor(resourceId, spineIndex, question.quote, question.text);
    if (!result?.highlight) return;
    const created = result.highlight;
    setHighlights(await fetchHighlights(resourceId));
    setExpandedThread({
      highlightId: created.id,
      top: DEFAULT_THREAD_PANEL_TOP,
      initialDraft: question.text,
    });
  }

  /** Annotations overview "jump-to": same as clicking a margin-rail dot,
   * plus closing the overview so the destination isn't obscured. */
  function handleJumpToHighlight(highlight: HighlightWithThread) {
    handleNavigateToHighlight(highlight);
    handleOpenThread(highlight);
    setShowAnnotations(false);
  }

  /** M30 D glossary jump-to-passage. Unlike the annotations overview's jump
   * (which opens the thread, because every entry there is one), this only
   * navigates: a glossary entry is a word you looked up, and landing on it
   * with a conversation panel open would be answering a question the reader
   * didn't ask. */
  function handleJumpToGlossaryEntry(highlight: HighlightWithThread) {
    handleNavigateToHighlight(highlight);
    setShowGlossary(false);
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
    // M31 A3: the surface stands down on the way out, so the page is never
    // left with a parent-document overlay armed over text nobody is pointing
    // at — and so re-entry starts from a known state.
    setGrabSurfaceArmed(false);
    if (lastContentsWithCursorRef.current) {
      lastContentsWithCursorRef.current.body.style.cursor = "";
    }
    clearMarkHover();
  }

  const expandedHighlight = expandedThread
    ? highlights.find((h) => h.id === expandedThread.highlightId)
    : undefined;

  // M30 D: the same filter the Glossary panel applies, so the strip's count
  // and the panel's list can never disagree. `glossaryEntries` is the one
  // definition of "what is in the glossary" — there is no table to consult.
  const glossaryCount = useMemo(() => glossaryEntries(highlights).length, [highlights]);

  // M24.7 A: the listening cluster's icon (trigger and panel both) reads the
  // same play/pause state the old inline transport row did — computed once
  // here so the two renders of it can't drift.
  const audioActive = player.status === "playing" || player.status === "loading";
  const audioPlayPauseLabel = audioActive
    ? "Pause listening"
    : player.status === "paused"
      ? "Resume listening"
      : "Listen";

  // M24.7 §D/§G: the digest and listening clusters are identical whether
  // they're sitting in the normal strip or the immersive pebble — built once
  // here so the two mount points can't drift, rather than kept as two
  // hand-copied JSX blocks. Exactly one of the two mount points renders at a
  // time (fullscreenMode is exclusive), so this never double-mounts either
  // cluster; `digestButtonRef` simply reattaches to whichever one is live.
  // M24.7 §B/§G: the page/percent readout — shared verbatim between the
  // normal foot and the immersive pebble (same dial, same "release to jump"
  // commit path, M12's instrument either way).
  const progressGroup = (
    <div className={styles.footerCenter}>
      <PageNumberDisplay
        mode={pageNumberMode}
        bookPage={bookPage?.page ?? null}
        bookTotal={bookPage?.total ?? null}
        chapterPage={displayedPage?.page ?? null}
        chapterTotal={displayedPage?.total ?? null}
      />
      <span className={styles.footerDivider} aria-hidden="true">
        |
      </span>
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
          dialPlacement="above"
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
    </div>
  );

  const digestCluster = (
    <ExpandingCluster
      icon={<BrainIcon progress={digestChapterProgress} />}
      label="Digest"
      triggerRef={digestButtonRef}
    >
      <div className={styles.clusterPanel}>
        {/* M38 §C1: "Digest this chapter" splits into two explicit,
            separately-labeled choices — plot and themes — rather than one
            button that conflated the two with no way to pick just one. */}
        <Button
          variant="ghost"
          size="sm"
          disabled={currentSpineIndex === null || digestChapterJobId !== null}
          onClick={handleDigestChapter}
        >
          {digestChapterJobId ? "Summarising…" : digestChapterResult ?? "Summarise"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={currentSpineIndex === null || themeChapterJobId !== null}
          onClick={handleAnalyzeChapterThemes}
          title={themeChapterNotice}
        >
          {themeChapterJobId ? "Analysing…" : themeChapterResult ?? "Analyse Themes for this Chapter"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onOpenDigest}>
          Open digest
        </Button>
        <div className={styles.clusterDivider} />
        <ProviderPicker role="digest" variant="compact" onNavigateToSettings={openSettingsToLLM} />
      </div>
    </ExpandingCluster>
  );

  const listeningCluster = (
    <ExpandingCluster
      icon={<AudioTransportIcon kind={audioActive ? "pause" : "play"} />}
      label={audioPlayPauseLabel}
      pressed={audioActive}
    >
      <div className={styles.clusterPanel}>
        <div className={styles.transportRow}>
          <IconButton
            icon={<AudioTransportIcon kind="skip-prev" />}
            label="Previous sentence"
            disabled={player.status === "idle"}
            onClick={() => player.skipSentence(-1)}
          />
          <IconButton
            icon={<AudioTransportIcon kind={audioActive ? "pause" : "play"} />}
            label={audioPlayPauseLabel}
            pressed={audioActive}
            onClick={handleTransportPlayClick}
          />
          <IconButton
            icon={<AudioTransportIcon kind="skip-next" />}
            label="Next sentence"
            disabled={player.status === "idle"}
            onClick={() => player.skipSentence(1)}
          />
          <IconButton
            icon={<AudioTransportIcon kind="cast" />}
            label="Cast — voices for this book"
            pressed={castOpen}
            onClick={(event) => {
              setCastOrigin(captureOverlayOrigin(event.currentTarget));
              setCastOpen(true);
            }}
          />
          {player.status !== "idle" && (
            <IconButton icon={<AudioTransportIcon kind="stop" />} label="Stop listening" onClick={handleStopListening} />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<AudioTransportIcon kind="play-from" size={14} />}
          disabled={currentSpineIndex === null}
          onClick={() => {
            if (currentSpineIndex !== null) player.startListening(currentSpineIndex);
          }}
        >
          Read from here
        </Button>
        {/* M22.6 C: only ever shown while the view has actually wandered
            from the sounding section — pressing it is the other half of
            what put it there. */}
        {player.status !== "idle" && detached && (
          <Button
            variant="ghost"
            size="sm"
            icon={<AudioTransportIcon kind="locate" size={14} />}
            onClick={handleReturnToVoice}
          >
            Back to the voice
          </Button>
        )}
        {player.status !== "idle" && (
          <Button
            variant="ghost"
            size="sm"
            className={styles.speedButton}
            onClick={handleCycleSpeed}
            title="Playback speed"
          >
            {player.speed}× speed
          </Button>
        )}
        {player.status === "error" && (
          <span className={styles.audioError} role="status">
            {player.errorCode === "model_unavailable" || player.errorCode === "model_download_failed"
              ? "Audio engine unavailable"
              : "Couldn't play audio"}
          </span>
        )}
      </div>
    </ExpandingCluster>
  );

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
      {/* M24.7 §G: "no card, no strips, no rail" — the whole strip stops
          existing in immersive mode rather than becoming a fifth floating
          panel; the pebble further down replaces the functions it carries
          that immersive mode still offers (digest, listening). */}
      {!fullscreenMode && (
        <div
          className={`${styles.topRow} ${stripStacked ? "readerStripStacked" : ""}`}
          ref={stripTopRowRef}
        >
          {/* M24.7 A: one line, three zones — reader functions left, the
              book's identity centre, chrome right. Replaces the four places
              this chrome used to live in (ReaderPage's .titleBar,
              ReaderActionsCluster beside/below the card, and the
              audio/digest/provider controls that used to crowd this row).
              M24.7 §C, redone 2026-08-24: the row-count switch is now
              `stripStacked` (useReaderStripLayout), not a `@container` query
              — see ReaderView.module.css `.stripGrid`'s comment for why. */}
          <div className={styles.stripGrid}>
          <div className={styles.topRowLeft} ref={stripLeftRef}>
            <Button
              variant="ghost"
              size="sm"
              className={styles.annotationsButton}
              pressed={focusMode}
              onClick={() => {
                setShowGlossary(false);
                setShowAnnotations((prev) => !prev);
              }}
              aria-label={focusMode ? "Notes hidden — press N to show" : undefined}
              title={focusMode ? "Notes hidden — press N to show" : undefined}
            >
              Annotations{readerHighlights.length > 0 ? ` (${readerHighlights.length})` : ""}
              {unanchoredIds.size > 0 && (
                <span className={styles.unanchoredBadge} title="Some highlights couldn't be relocated">
                  {unanchoredIds.size}
                </span>
              )}
            </Button>
            {/* M30 D: the glossary is an instrument over the Book (settled
                decision 13), so it sits beside Annotations rather than
                becoming a room. Hidden until the book has one — an empty
                control in the strip advertising a feature the reader hasn't
                used yet is chrome, not an affordance. */}
            {glossaryCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className={styles.annotationsButton}
                onClick={() => {
                  setShowAnnotations(false);
                  setShowGlossary((prev) => !prev);
                }}
              >
                Glossary ({glossaryCount})
              </Button>
            )}
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
            />
            {digestCluster}
            {listeningCluster}
          </div>
          <div className={styles.topRowCenter}>
            {/* Doorway transition (DESIGN.md): shares a layoutId with the
                library card's cover — the same element the user just clicked,
                landing here (M7's proof of the shared-element motion system).
                Moved down from ReaderPage's own .titleBar row (M24.7 A). */}
            <motion.div className={styles.coverThumb} layoutId={reducedMotion ? undefined : coverLayoutId(resourceId)}>
              <BookCover resourceId={resourceId} title={resourceTitle} />
            </motion.div>
            {/* Title above author (2026-08-24, operator's design) — a column
                needs the *wider* of the two lines, not their combined width.
                Each line is independently a fixed-size clipping viewport
                (`.title`/`.author`) around a scrollable inner span; when the
                inner span's natural width exceeds the viewport,
                useMarqueeOverflow measures the overflow and the `.scrolling`
                class ping-pongs it into view instead of just eliding it. */}
            <div className={styles.identityText}>
              <span className={styles.title} ref={titleOuterRef}>
                <span
                  className={`${styles.titleInner} ${titleMarquee.scrolling ? styles.scrolling : ""}`}
                  style={titleMarquee.style}
                  ref={titleInnerRef}
                >
                  {resourceTitle}
                </span>
              </span>
              {resourceAuthor && (
                <span className={styles.author} ref={authorOuterRef}>
                  <span
                    className={`${styles.authorInner} ${authorMarquee.scrolling ? styles.scrolling : ""}`}
                    style={authorMarquee.style}
                    ref={authorInnerRef}
                  >
                    {resourceAuthor}
                  </span>
                </span>
              )}
            </div>
          </div>
          <div className={styles.topRowRight} ref={stripRightRef}>
            {/* M24.7 A: the reader's own embedded, un-floated NavCluster — the
                app-shell's floating instance is suppressed for the reader
                route (App.tsx), since the pill must track the pane's edge,
                not the viewport's, once the reader can be docked narrow
                beside another pane. Registers the chrome-row's leading slot
                so the reader's own Search/Scan/Publish can portal into it,
                exactly like DeskPage's Import button does. */}
            <NavCluster
              settingsTab="reading"
              floating={false}
              registersSlot
              settingsOpen={settingsOpen}
              onCloseSettings={onCloseSettings}
              onDepart={startPutDown}
            />
            <ChromeSlotPortal>
              <IconButton icon={<MagnifierIcon />} label="Search" onClick={() => handleFindShortcut()} />
              <IconButton ref={scanButtonRef} icon={<ScanIcon />} label="Scan" onClick={onOpenScan} />
              <IconButton
                icon={<PublishIcon />}
                label={publishing ? "Publishing…" : "Publish"}
                disabled={publishing}
                onClick={onPublish}
              />
            </ChromeSlotPortal>
          </div>
          </div>
        </div>
      )}

      <div className={styles.readerRow} ref={readerRowRef}>
        <div
          className={styles.stage}
          ref={(node) => {
            stageRef.current = node;
            if (externalStageRef) externalStageRef.current = node;
          }}
          onPointerMove={handleStagePointerMove}
          onPointerLeave={handleStagePointerLeave}
        >
          {/* `data-page-surface`: everything inside this box is the page
              itself — paper, ink, and the turn gesture's own decorations.
              `handleStagePointerMove` (M31 A3) uses it to tell a hover over
              the page from a hover over the pill, a thread panel or the
              pane-resize handle, which are siblings of this element rather
              than children and are emphatically not paper. */}
          <div
            className={`${styles.pageClip} ${pinchInstrument ? styles.pageBlurred : ""}`}
            ref={pageClipRef}
            data-page-surface
          >
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
              <>
                {/* M27 far-leaf-pre-flip fix: only in spread mode, where the
                    far leaf is a real, distinct rect from the turning one —
                    single-page mode's `farX` coincides with `curl.leafX`
                    (readerGeometry.ts's `farLeafRect` collapses to the same
                    whole-card rect `nearLeafRect` does there), and there is
                    nothing to cover. */}
                {curl.farX !== curl.leafX && (
                  <FarLeafCover
                    image={curl.image}
                    farX={curl.farX}
                    leafWidth={curl.leafWidth}
                    leafHeight={curl.leafHeight}
                    stageWidth={curl.stageWidth}
                  />
                )}
                <PageFold3D
                  image={curl.image}
                  anchor={curl.anchor}
                  leafWidth={curl.leafWidth}
                  leafHeight={curl.leafHeight}
                  leafX={curl.leafX}
                  stageWidth={curl.stageWidth}
                  getOrigin={getFoldOrigin}
                  getPointer={getFoldPointer}
                  getArc={getFoldArc}
                  arcRadiusMode={HINGE_ARC_RADIUS_MODE}
                  getBack={getFoldBack}
                  onDrawCost={handleDrawCost}
                />
              </>
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
            {/* M31 A6, invariant 5 — "an affordance may not outlive its
                gesture". These two ellipses used to light one at a time, by
                which click-turn zone the cursor was in; clicking no longer
                turns, and the direction is no longer a property of where you
                press, so a one-sided glow would be advertising a direction the
                page does not have. They light *together*, and only while the
                pointer is on grabbable paper — the honest statement being "the
                sheet can be taken here", not "this side goes forward". Which
                way it goes is the drag's to say. */}
            {!focusMode && (
              <>
                <div
                  aria-hidden="true"
                  className={`${styles.turnZoneVignette} ${styles.turnZoneVignetteLeft} ${
                    paperHover ? styles.turnZoneVignetteVisible : ""
                  }`}
                />
                <div
                  aria-hidden="true"
                  className={`${styles.turnZoneVignette} ${styles.turnZoneVignetteRight} ${
                    paperHover ? styles.turnZoneVignetteVisible : ""
                  }`}
                />
              </>
            )}
            {/* M31 A4: **one surface, over all the paper** — outer margins,
                spine gutter, below the last line, a blank verso. M20's two
                edge-hugging ellipses were a compromise with the ink they sat
                on top of ("the rest of the band is still free for text
                selection"), and that compromise is what made the very edge of
                a line unselectable. There is no compromise left to make: the
                surface's `pointer-events` follow the live ink/paper answer
                (`setGrabSurfaceArmed`), so it only ever exists where there is
                no text to steal a press from. It is still a parent-document
                element and still takes pointer capture — invariant 2, and
                NOTES.md M10's tab crash is why.

                `|| gestureActive`: the element holding the pointer capture may
                not unmount while a drag is live. If it does — which a
                re-pagination mid-drag would do by flipping `status` to
                loading — capture is released to the sandboxed epub.js iframe,
                the page stops receiving pointer input, and the gesture never
                hears that it ended (PAGE_CURL.md §9). */}
            {/* ⚠️ Not gated on `stageReducedMotion` since M31 A5. It used to be —
                there is no peel to drag under reduced motion — but with
                click-to-turn retired that left a reduced-motion reader with no
                way to turn a page *on the page*. The gesture is the same; the
                drag just commits an instant turn (see `handleGrabPointerDown`). */}
            {(status === "ready" || gestureActive) && (
              <div
                // A callback ref, not a plain one: this element unmounts and
                // remounts across a re-pagination, and the armed state lives
                // in an inline style (a render per pointer move is not
                // affordable) — which a remount would silently drop back to
                // the CSS default while `grabArmedRef` still said "armed".
                ref={(node) => {
                  grabSurfaceRef.current = node;
                  if (node) node.style.pointerEvents = grabArmedRef.current ? "auto" : "none";
                }}
                className={styles.turnGrabSurface}
                aria-hidden="true"
                onPointerDown={handleGrabSurfacePointerDown}
              />
            )}
            {status === "loading" && (
              <div className={styles.overlay}>Loading book…</div>
            )}
            {status === "error" && (
              <div className={styles.overlay}>Couldn't load this book.</div>
            )}
          </div>
          <AnimatePresence>
            {findOpen && (
              <FindBar
                key="find-bar"
                query={findQuery}
                onQueryChange={setFindQuery}
                hits={findHits}
                currentIndex={findCursorIndex}
                loading={findLoading}
                onStep={handleFindStep}
                onClose={closeFindBar}
                onSeeInScan={() => handleSeeInScan()}
                resultsOpen={findCardOpen}
                onToggleResults={() => setFindCardOpen((open) => !open)}
                matchMode={findMatchMode}
                onMatchModeChange={setFindMatchMode}
                focusToken={findFocusToken}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {/* M35 §G4: the pill only makes sense outside the mode it can
                itself start — while "select/add highlight" is active, a new
                selection goes through LinkQuoteBanner's own confirm instead
                (below), never both at once. */}
            {pendingSelection && !linkQuoteMode && (
              <AskPill
                key="ask-pill"
                left={pendingSelection.left}
                top={pendingSelection.top}
                onPickKind={handlePickKind}
                onAsk={handleAsk}
                onDefine={() => void handleDefine()}
                definable={isDefinableTerm(pendingSelection.exact)}
                onPlayFromHere={() => void handlePlayFromSelection()}
                labels={kindLabels}
                onLinkQuote={() => void handleLinkQuote()}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {linkQuoteMode && (
              <LinkQuoteBanner
                key="link-quote-banner"
                allowExistingHighlightClick={linkQuoteMode.allowExistingHighlightClick}
                pendingExact={linkQuoteConfirm ? linkQuoteConfirm.exact : (pendingSelection?.exact ?? null)}
                error={linkQuoteError}
                onConfirm={() => void handleConfirmLinkQuote()}
                onCancelConfirm={handleCancelLinkQuoteConfirm}
                onExit={handleExitLinkQuoteMode}
              />
            )}
          </AnimatePresence>
          {/* M31 C6: no AnimatePresence — same directness as DwellRing, and
              for the same reason: the instrument's whole life is the pinch's
              own, which ends abruptly (a lifted finger), not on a timer an
              exit animation would have something to outlast. */}
          {pinchInstrument && (
            <PinchResizeInstrument
              scale={pinchInstrument.scale}
              x={pinchInstrument.x}
              y={pinchInstrument.y}
              onCommit={(value) => setReaderFontScale(value)}
            />
          )}
          <AnimatePresence>
            {definitionCard && (
              <DefinitionCard
                key="definition-card"
                state={definitionCard}
                onClose={() => setDefinitionCard(null)}
                onAsk={handleAskFromDefinition}
                onDeepened={applyDefinitionResult}
                appBoundsRef={appBoundsRef}
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
                initialAnchorHighlightId={expandedThread.initialAnchorHighlightId}
                providerConfigured={providerConfigured}
                appBoundsRef={appBoundsRef}
                onClose={() => setExpandedThread(null)}
                onDelete={() => handleDeleteHighlight(expandedHighlight)}
                onJumpToAnchor={handleJumpToAnchor}
                anchorsVersion={anchorsVersion}
                onAddQuotes={linkQuoteMode ? undefined : handleStartAddQuotes}
                onThreadChange={handleThreadChange}
                onImportanceChange={handleImportanceChange}
                onNoteChange={handleNoteChange}
                onPanelOffsetChange={handlePanelOffsetChange}
                onPanelSizeChange={handlePanelSizeChange}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {chapterEndPrompt && (
              <ChapterEndPrompt
                key={`chapter-end-${chapterEndPrompt.spineIndex}`}
                questions={chapterEndPrompt.questions}
                onAskQuestion={(question) => void handleChapterEndAsk(chapterEndPrompt.spineIndex, question)}
                onDismiss={() => setChapterEndPrompt(null)}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {pendingDelete && (
              <DeleteConfirmDialog
                key="delete-confirm"
                messageCount={pendingDelete.messageCount}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => {
                  void performDeleteHighlight(pendingDelete.highlight);
                  setPendingDelete(null);
                }}
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
                reversed={findOrderReversed}
                onToggleReversed={() => setFindOrderReversed((r) => !r)}
                onOpenInScan={handleSeeInScan}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {showAnnotations && (
              <AnnotationsOverview
                key="annotations-overview"
                highlights={readerHighlights}
                unanchoredIds={unanchoredIds}
                onJumpTo={handleJumpToHighlight}
                onDelete={handleDeleteHighlight}
                onClose={() => setShowAnnotations(false)}
                labels={kindLabels}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {showGlossary && (
              <Glossary
                key="glossary"
                highlights={highlights}
                unanchoredIds={unanchoredIds}
                sort={glossarySort}
                onSortChange={setGlossarySort}
                onJumpTo={handleJumpToGlossaryEntry}
                onClose={() => setShowGlossary(false)}
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
          <div className={fullscreenMode ? styles.marginRailFaint : undefined}>
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
        {/* M24.7 §G: the vignette that "holds the eye on the column" —
            aria-hidden, pointer-events: none, purely a framing wash. Lives
            over the stage rather than the whole viewport so it frames the
            page, not the pebble or the hairline below. */}
        {fullscreenMode && <div aria-hidden="true" className={styles.immersiveVignette} />}
      </div>

      {fullscreenMode ? (
        <>
          {/* M24.7 §G: "position survives as a 2px hairline along the bottom
              edge" — always visible, unlike the pebble, since it's the one
              piece of the old footer that's meant to survive being minimal
              rather than being woken. */}
          <div className={styles.immersiveHairline} aria-hidden="true">
            <div
              className={styles.immersiveHairlineFill}
              style={{ width: `${progressPercent ?? 0}%` }}
            />
          </div>
          <div
            className={`${styles.fullscreenFloating} ${styles.immersivePebble} ${
              pebbleAwake ? styles.revealed : ""
            }`}
            onPointerEnter={onPebblePointerEnter}
            onPointerLeave={onPebblePointerLeave}
          >
            {progressGroup}
            {digestCluster}
            {listeningCluster}
            <KeyCapAnchor shortcutKey={SHORTCUT_KEYS.fullscreen}>
              <IconButton
                icon={<FullscreenIcon />}
                label="Exit fullscreen"
                pressed
                onClick={toggleFullscreen}
              />
            </KeyCapAnchor>
          </div>
        </>
      ) : (
        <div
          className={`${styles.footer} ${stripStacked ? "readerStripStacked" : ""}`}
          ref={stripFooterRef}
        >
          {/* M24.7 B: the foot mirrors the strip — ‹ · page/percent · ›, with
              an instruments pebble at the right. The percent Slider + its
              SliderDial popover move here unchanged from the old .topRow —
              same dialTicks/"release to jump" commit path (M12's instrument,
              not reimplemented). */}
          <div className={styles.footerNav}>
            <IconButton
              icon={<ChevronIcon direction="left" />}
              label="Previous page"
              disabled={atStart}
              onClick={() => turnPage("prev")}
            />
            {progressGroup}
            <IconButton
              icon={<ChevronIcon direction="right" />}
              label="Next page"
              disabled={atEnd}
              onClick={() => turnPage("next")}
            />
          </div>
          <div className={styles.instrumentsPebble}>
            <IconButton icon={<TrayIcon />} label="Heat strip" onClick={onOpenScan} />
            <IconButton icon={<MagnifierIcon />} label="Search" onClick={() => handleFindShortcut()} />
            <IconButton
              icon={<FullscreenIcon />}
              label="Fullscreen"
              pressed={false}
              onClick={toggleFullscreen}
            />
          </div>
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
