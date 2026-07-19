import { useCallback, useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from "motion/react";
import type {
  CreateHighlightBody,
  HighlightKind,
  HighlightWithThread,
  ReadingPosition,
  Settings,
  ThreadSummary,
} from "@marginalia/shared";
import { useEpubThemeVars, type EpubThemeVars } from "./useEpubThemeVars.js";
import { resolveAnchor, type RangeLike } from "./anchorResolution.js";
import { getSelectionContext, rangeFromTextOffsets } from "./selectionContext.js";
import { markStyleForKind } from "./highlightKinds.js";
import { AskPill } from "./AskPill.js";
import { MarginRail } from "./MarginRail.js";
import { ThreadPanel } from "../threads/ThreadPanel.js";
import { AnnotationsOverview } from "./AnnotationsOverview.js";
import styles from "./ReaderView.module.css";

const DEFAULT_THREAD_PANEL_TOP = 20;

function isProviderConfigured(settings: Settings): boolean {
  return settings.provider === "anthropic"
    ? Boolean(settings.anthropicApiKey)
    : Boolean(settings.openaiBaseUrl && settings.openaiModel);
}

const POSITION_SAVE_DEBOUNCE_MS = 600;
const LOCATIONS_CHAR_STEP = 1600;
const SELECTION_CONTEXT_MAX_LEN = 64;
const HIGHLIGHT_MARK_CLASS = "marginalia-highlight";

// epub.js's View typings don't expose the `contents` it renders, though it
// exists at runtime (see managers/views/iframe.js) — narrow just that.
interface ViewWithContents {
  contents: Contents;
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
      padding: "0 2rem !important",
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

function savePosition(resourceId: string, location: string): void {
  fetch(`/api/resources/${resourceId}/position`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location }),
  }).catch(() => {
    // best-effort — losing one position write isn't worth surfacing an error
  });
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
}

export function ReaderView({ resourceId }: ReaderViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
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
  // The book-loading effect's internal handlers (keydown, click-to-turn)
  // close over `rendition` directly and don't re-run per-render, so they
  // reach the current turnPage through this ref rather than a stale closure.
  const turnPageRef = useRef<(direction: "prev" | "next") => void>(() => {});
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
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [currentSpineIndex, setCurrentSpineIndex] = useState<number | null>(
    null,
  );
  const [highlights, setHighlights] = useState<HighlightWithThread[]>([]);
  const [unanchoredIds, setUnanchoredIds] = useState<Set<string>>(new Set());
  const [pendingSelection, setPendingSelection] =
    useState<PendingSelection | null>(null);
  // Reopening a book always restores threads collapsed (SPEC) — this state
  // is local and resets to null on every mount, no persistence needed.
  const [expandedThread, setExpandedThread] = useState<{
    highlightId: string;
    top: number;
  } | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
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
      if (settings) setProviderConfigured(isProviderConfigured(settings));
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    setStatus("loading");
    setProgressPercent(null);
    setHighlights([]);
    setUnanchoredIds(new Set());
    setPendingSelection(null);
    setExpandedThread(null);
    highlightsRef.current = [];
    resolvedIdsRef.current = new Set();
    attachedCfiRef.current = new Map();
    cfiOwnersRef.current = new Map();

    // Our file route has no .epub extension for epub.js to sniff from the
    // URL, so it would otherwise be treated as an unpacked directory of
    // book files rather than a single archive to fetch and unzip.
    const book: Book = ePub(`/api/resources/${resourceId}/file`, {
      openAs: "epub",
    });
    const rendition = book.renderTo(containerRef.current, {
      width: "100%",
      height: "100%",
      flow: "paginated",
      manager: "default",
      spread: "none",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;
    applyTheme(rendition, themeVars);

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
      setAtStart(Boolean(location.atStart));
      setAtEnd(Boolean(location.atEnd));
      setCurrentSpineIndex(location.start.index);
      const pct = location.start.percentage;
      if (typeof pct === "number") {
        setProgressPercent(Math.round(pct * 100));
      }

      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        savePosition(resourceId, location.start.cfi);
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
      // A click on a highlight mark still bubbles as a content 'click', but
      // clicking within the highlighted text is exactly what should NOT
      // page-turn — markClicked fires first, so nothing more to do here
      // beyond the browser's own default (no page turn, since the click
      // handler below sees a real link/selection-free click through text
      // that happens to be marked). Clicking a highlight expands its thread.
      if (data.highlightId) {
        setExpandedThread({ highlightId: data.highlightId, top: DEFAULT_THREAD_PANEL_TOP });
      }
    }
    rendition.on("markClicked", handleMarkClicked);

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
      const visibleX = iframeRect.left + event.clientX - containerRect.left;

      if (visibleX < containerRect.width * 0.3) {
        turnPageRef.current("prev");
      } else if (visibleX > containerRect.width * 0.7) {
        turnPageRef.current("next");
      }
    }
    rendition.on("click", handleContentClick);

    function handleKeydown(event: KeyboardEvent) {
      // This same handler is also bound to window (below) to catch keydowns
      // outside the epub iframe — e.g. the thread panel's textarea, where
      // ArrowLeft/Right/F are ordinary typing/editing keys, not page-turn or
      // focus-mode shortcuts.
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "INPUT" ||
        target?.isContentEditable;

      if (isTyping) return;

      if (event.key === "ArrowLeft") turnPageRef.current("prev");
      else if (event.key === "ArrowRight") turnPageRef.current("next");
      else if (event.key === "Escape") {
        setPendingSelection(null);
        setExpandedThread(null);
      } else if (
        (event.key === "f" || event.key === "F") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        setFocusMode((prev) => {
          const next = !prev;
          // A clean page and an open annotations list are contradictory.
          if (next) setShowAnnotations(false);
          return next;
        });
      }
    }
    rendition.on("keydown", handleKeydown);
    window.addEventListener("keydown", handleKeydown);

    book.ready
      .then(async () => {
        if (cancelled) return;
        const [position, resourceHighlights] = await Promise.all([
          fetchPosition(resourceId),
          fetchHighlights(resourceId),
        ]);
        if (cancelled) return;
        highlightsRef.current = resourceHighlights;
        setHighlights(resourceHighlights);

        await rendition.display(position?.location ?? undefined);
        if (cancelled) return;
        setStatus("ready");

        // Locations let epub.js compute a whole-book percentage from a CFI;
        // generating them is async, so the initial relocated event may fire
        // before percentages are available — recompute once ready.
        book.locations.generate(LOCATIONS_CHAR_STEP).then(() => {
          if (!cancelled) rendition.reportLocation();
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      window.clearTimeout(saveTimerRef.current);
      window.removeEventListener("keydown", handleKeydown);
      renditionRef.current = null;
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

  // Page-turn feel (DESIGN.md, interim for M7): a fast dip-and-recover on
  // the page surface itself around the moment epub.js swaps content, so
  // turning feels physical without faking real paper (that's M10). Plain
  // instant turn under reduced motion.
  const turnPage = useCallback(
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

  useEffect(() => {
    turnPageRef.current = (direction) => {
      void turnPage(direction);
    };
  }, [turnPage]);

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

  const expandedHighlight = expandedThread
    ? highlights.find((h) => h.id === expandedThread.highlightId)
    : undefined;

  return (
    <div className={styles.wrapper}>
      <div className={styles.topRow}>
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
        <div className={styles.progress}>
          {progressPercent !== null ? `${progressPercent}%` : ""}
        </div>
      </div>

      <div className={styles.readerRow}>
        <div className={styles.stage}>
          <motion.div
            ref={containerRef}
            className={styles.epubContainer}
            animate={stageControls}
          />
          {status === "loading" && (
            <div className={styles.overlay}>Loading book…</div>
          )}
          {status === "error" && (
            <div className={styles.overlay}>Couldn't load this book.</div>
          )}
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
                highlightId={expandedHighlight.id}
                highlightExact={expandedHighlight.exact}
                highlightKind={expandedHighlight.kind}
                thread={expandedHighlight.thread}
                top={expandedThread.top}
                providerConfigured={providerConfigured}
                onClose={() => setExpandedThread(null)}
                onThreadChange={handleThreadChange}
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
        </div>
        {!focusMode && (
          <MarginRail
            highlights={highlights}
            currentSpineIndex={currentSpineIndex}
            unanchoredIds={unanchoredIds}
            onNavigate={handleNavigateToHighlight}
            onDelete={handleDeleteHighlight}
            onOpenThread={handleOpenThread}
          />
        )}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.navButton}
          disabled={atStart}
          onClick={() => turnPage("prev")}
        >
          ← Previous
        </button>
        <button
          type="button"
          className={styles.navButton}
          disabled={atEnd}
          onClick={() => turnPage("next")}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
