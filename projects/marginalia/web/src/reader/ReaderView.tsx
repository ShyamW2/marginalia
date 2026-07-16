import { useEffect, useRef, useState } from "react";
import ePub from "epubjs";
import type { Book, Contents, Location, Rendition } from "epubjs";
import type {
  CreateHighlightBody,
  HighlightWithThread,
  ReadingPosition,
  Settings,
  ThreadSummary,
} from "@marginalia/shared";
import { useEpubThemeVars, type EpubThemeVars } from "./useEpubThemeVars.js";
import { resolveAnchor, type RangeLike } from "./anchorResolution.js";
import { getSelectionContext, rangeFromTextOffsets } from "./selectionContext.js";
import { AskPill } from "./AskPill.js";
import { MarginRail } from "./MarginRail.js";
import { ThreadPanel } from "../threads/ThreadPanel.js";
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
  const themeVars = useEpubThemeVars();

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

    function attachHighlightMark(highlightId: string, cfi: string) {
      attachedCfiRef.current.set(highlightId, cfi);
      rendition.annotations.highlight(
        cfi,
        { highlightId },
        undefined,
        HIGHLIGHT_MARK_CLASS,
      );
    }

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
          attachHighlightMark(highlight.id, highlight.cfi);
        } else if (result.status === "fallback") {
          const range = rangeFromTextOffsets(
            contents.document,
            result.match.start,
            result.match.end,
          );
          if (range) {
            attachHighlightMark(highlight.id, contents.cfiFromRange(range));
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
        rendition.prev();
      } else if (visibleX > containerRect.width * 0.7) {
        rendition.next();
      }
    }
    rendition.on("click", handleContentClick);

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") rendition.prev();
      else if (event.key === "ArrowRight") rendition.next();
      else if (event.key === "Escape") {
        setPendingSelection(null);
        setExpandedThread(null);
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
    if (renditionRef.current) applyTheme(renditionRef.current, themeVars);
  }, [themeVars]);

  async function handleAsk() {
    if (!pendingSelection) return;
    const created = await postHighlight({
      resourceId,
      exact: pendingSelection.exact,
      prefix: pendingSelection.prefix,
      suffix: pendingSelection.suffix,
      cfi: pendingSelection.cfi,
      spineIndex: pendingSelection.spineIndex,
    });
    if (created) {
      setHighlights((prev) => [...prev, created]);
      resolvedIdsRef.current.add(created.id);
      // This CFI was just derived from the live, currently-rendered
      // document, so it's trusted without going through resolveAnchor again.
      attachedCfiRef.current.set(created.id, created.cfi);
      renditionRef.current?.annotations.highlight(
        created.cfi,
        { highlightId: created.id },
        undefined,
        HIGHLIGHT_MARK_CLASS,
      );
      pendingSelection.contents.window.getSelection()?.removeAllRanges();
      // Anchor the panel near the selection itself — the nicest, most
      // literal "visually anchored to the highlight" case (a fresh Ask).
      setExpandedThread({ highlightId: created.id, top: pendingSelection.top });
    }
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
    renditionRef.current?.annotations.remove(attachedCfi, "highlight");
    setExpandedThread((prev) => (prev?.highlightId === highlight.id ? null : prev));
  }

  function handleNavigateToHighlight(highlight: HighlightWithThread) {
    renditionRef.current?.display(highlight.cfi);
  }

  function handleOpenThread(highlight: HighlightWithThread) {
    setExpandedThread({ highlightId: highlight.id, top: DEFAULT_THREAD_PANEL_TOP });
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
      <div className={styles.progress}>
        {progressPercent !== null ? `${progressPercent}%` : ""}
      </div>

      <div className={styles.readerRow}>
        <div className={styles.stage}>
          <div ref={containerRef} className={styles.epubContainer} />
          {status === "loading" && (
            <div className={styles.overlay}>Loading book…</div>
          )}
          {status === "error" && (
            <div className={styles.overlay}>Couldn't load this book.</div>
          )}
          {pendingSelection && (
            <AskPill
              left={pendingSelection.left}
              top={pendingSelection.top}
              onClick={handleAsk}
            />
          )}
          {expandedThread && expandedHighlight && (
            <ThreadPanel
              // Remount per highlight — simpler and more robust than
              // threading highlight-identity changes through internal
              // effect dependency arrays for "reset state on switch".
              key={expandedHighlight.id}
              highlightId={expandedHighlight.id}
              highlightExact={expandedHighlight.exact}
              thread={expandedHighlight.thread}
              top={expandedThread.top}
              providerConfigured={providerConfigured}
              onClose={() => setExpandedThread(null)}
              onThreadChange={handleThreadChange}
            />
          )}
        </div>
        <MarginRail
          highlights={highlights}
          currentSpineIndex={currentSpineIndex}
          unanchoredIds={unanchoredIds}
          onNavigate={handleNavigateToHighlight}
          onDelete={handleDeleteHighlight}
          onOpenThread={handleOpenThread}
        />
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.navButton}
          disabled={atStart}
          onClick={() => renditionRef.current?.prev()}
        >
          ← Previous
        </button>
        <button
          type="button"
          className={styles.navButton}
          disabled={atEnd}
          onClick={() => renditionRef.current?.next()}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
