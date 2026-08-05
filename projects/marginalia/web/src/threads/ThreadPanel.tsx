import { useEffect, useRef, useState, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, useDragControls, useMotionValue, useReducedMotion } from "motion/react";
import type {
  ContextLadderDepth,
  ContextUsage,
  HighlightImportance,
  HighlightKind,
  Message,
  MessageProvenance,
  ThreadSummary,
  ThreadWithMessages,
} from "@marginalia/shared";
import { formatContextUsage } from "./contextUsage.js";
import { ContextLadderToggle } from "./ContextLadderToggle.js";
import { ImportanceStars } from "../highlights/ImportanceStars.js";
import { TagEditor } from "../highlights/TagEditor.js";
import { Button } from "../controls/Button.js";
import { IconButton } from "../controls/IconButton.js";
import { captureOverlayOrigin, setPendingOverlayOrigin } from "../controls/overlayOrigin.js";
import {
  fetchHighlightTags,
  updateHighlightImportance,
  updateHighlightNote,
  updateHighlightPanelOffset,
  updateHighlightPanelSize,
  updateHighlightTags,
} from "../highlights/highlightMeta.js";
import { clampPanelOffset, panelTiltDeg } from "./panelGeometry.js";
import { renderMarkdown } from "./markdown.js";
import { streamThread } from "./streamThread.js";
import styles from "./ThreadPanel.module.css";

// The first message in a thread is stored with the SPEC-templated framing
// ("The reader highlighted this passage: ... Their question: ..."); showing
// that verbatim in the chat UI would be noisy, so history reloads display
// just the question part, matching how a freshly-asked question renders.
function displayableQuestion(content: string): string {
  const match = /Their question: ([\s\S]*)$/.exec(content);
  return match ? match[1] : content;
}

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  "claude-agent": "Claude Code",
  "openai-compatible": "local",
};

/** M22.5 H2: "profile name · provider · served model · endpoint host" —
 * built from the answer's own ledger row (Message.provenance), never from
 * whatever Settings currently holds, so it stays true after a rename or a
 * mid-thread provider switch. Falls back gracefully piece by piece rather
 * than hiding the whole byline when one field is unknown (pre-M22.5
 * messages have none at all — `provenance` is null and nothing renders). */
function formatProvenance(p: MessageProvenance): string {
  const parts = [
    p.profileName,
    p.provider ? (PROVIDER_LABEL[p.provider] ?? p.provider) : null,
    p.model,
    p.endpointHost,
  ].filter((part): part is string => Boolean(part));
  return parts.join(" · ");
}

// M13: same debounce as the desk notepad (Notepad.tsx) — plain autosave,
// no LLM involvement.
const NOTE_AUTOSAVE_DELAY_MS = 800;

interface ThreadPanelProps {
  resourceId: string;
  highlightId: string;
  highlightExact: string;
  highlightKind: HighlightKind;
  highlightImportance: HighlightImportance;
  highlightNote: string;
  // M14 "movable sticky notes": the panel's dragged position, as an offset
  // from its anchor (never an absolute stage coordinate — see
  // panelGeometry.ts and decisions.md 2026-07-27).
  panelDx: number;
  panelDy: number;
  /** M19.6 "annotations are resizable": null means "use the default size"
   * (the CSS cap below) — never a magic 0. */
  panelWidth: number | null;
  panelHeight: number | null;
  thread: ThreadSummary | null;
  top: number;
  /** M19.5: seeds the draft textarea once, on this panel's mount (it
   * remounts per-highlight via ReaderView's `key` prop) — a posed
   * question's text, arriving pre-filled rather than requiring retyping. */
  initialDraft?: string;
  providerConfigured: boolean;
  /** M19.6 "annotations roam the app": widened from the reading stage to
   * this — the reader page's own root. Drag (and now resize) are
   * constrained to it, and it's the bounding box a stale offset gets
   * clamped back into on reopen. */
  appBoundsRef: RefObject<HTMLDivElement>;
  onClose: () => void;
  onThreadChange: (highlightId: string, thread: ThreadSummary) => void;
  onImportanceChange: (highlightId: string, importance: HighlightImportance) => void;
  onNoteChange: (highlightId: string, note: string) => void;
  onPanelOffsetChange: (highlightId: string, panelDx: number, panelDy: number) => void;
  onPanelSizeChange: (highlightId: string, panelWidth: number, panelHeight: number) => void;
}

// M19.6: the panel's default rendered size (CSS `min(340px, calc(100% - 2rem))`
// wide, content-driven tall) as a starting point for a resize drag — read live
// off the DOM rather than duplicated as a second source of truth for "340".
const DEFAULT_PANEL_MIN_WIDTH_PX = 220;
const DEFAULT_PANEL_MIN_HEIGHT_PX = 160;

export function ThreadPanel({
  resourceId,
  highlightId,
  highlightExact,
  highlightKind,
  highlightImportance,
  highlightNote,
  panelDx,
  panelDy,
  panelWidth,
  panelHeight,
  thread,
  top,
  initialDraft,
  providerConfigured,
  appBoundsRef,
  onClose,
  onThreadChange,
  onImportanceChange,
  onNoteChange,
  onPanelOffsetChange,
  onPanelSizeChange,
}: ThreadPanelProps) {
  const location = useLocation();
  const [tags, setTags] = useState<string[]>([]);

  // M14 "movable sticky notes" (decisions.md 2026-07-27): draggable by the
  // header only (dragListener={false} + dragControls.start from the header's
  // own pointerdown), a hard dragConstraints clamp (dragElastic 0) so the
  // panel can never overflow its bounds mid-drag, and a persisted offset —
  // *from the anchor*, not an absolute coordinate, since the anchor moves on
  // every page turn/resize/margin change (the same reasoning M8 applied to
  // shelf state).
  const panelRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const dragX = useMotionValue(panelDx);
  const dragY = useMotionValue(panelDy);
  const [isDragging, setIsDragging] = useState(false);
  // See handleQuotePointerDown/handleQuoteClick below.
  const quoteDraggedRef = useRef(false);
  const tiltDeg = panelTiltDeg(highlightId);
  // M19.6 "annotations are resizable": explicit pixel size once the reader
  // (or a prior session) has resized this panel; null defers to the CSS cap,
  // same "null means default" story as panelWidth/panelHeight themselves.
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    panelWidth !== null && panelHeight !== null ? { width: panelWidth, height: panelHeight } : null,
  );
  // M19.6 "the quote expands": collapsed by default (the existing 3-line
  // clamp); clicking toggles it. Local, resets on remount — same
  // "no persistence needed" call as ReaderView's own expandedThread/
  // focusMode state.
  const [quoteExpanded, setQuoteExpanded] = useState(false);

  // Shared by mount (below) and the quote-expand toggle further down: a
  // dx/dy that fit the panel's *previous* box can overflow its bounds once
  // the box changes size, so re-clamp back into view rather than trusting
  // whatever was last persisted.
  function reclampPanelOffset() {
    const panelEl = panelRef.current;
    const boundsEl = appBoundsRef.current;
    if (!panelEl || !boundsEl) return;
    const clamped = clampPanelOffset(
      panelEl.getBoundingClientRect(),
      boundsEl.getBoundingClientRect(),
      dragX.get(),
      dragY.get(),
    );
    if (clamped.dx !== dragX.get() || clamped.dy !== dragY.get()) {
      dragX.set(clamped.dx);
      dragY.set(clamped.dy);
      onPanelOffsetChange(highlightId, clamped.dx, clamped.dy);
      void updateHighlightPanelOffset(highlightId, clamped.dx, clamped.dy);
    }
  }

  useEffect(() => {
    // Mount-only (this component remounts per-highlight via ReaderView's
    // `key` prop): a dx/dy saved against an earlier stage size — a
    // different margin setting, a narrower window — can overflow the
    // *current* stage, so clamp back into view once, on open.
    reclampPanelOffset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Expanding the quote can grow the panel enough to push its
    // (fixed-`top`, dragged) box past the stage's bottom edge — re-run the
    // same clamp so the drag offset never goes stale the way a stage resize
    // already had to be defended against above. Skipped on the initial
    // mount (quoteExpanded starts false, so this would just re-run the
    // identical mount clamp) and on collapsing back down (shrinking can
    // only ever move a box further *inside* bounds, never out of them).
    //
    // Deliberately not useLayoutEffect: -webkit-line-clamp's removal is its
    // own special multi-pass layout in Chromium, and measuring synchronously
    // in the same tick (confirmed live) reads a height a few pixels short of
    // the fully-resolved one — enough to leave a several-pixel overflow
    // uncorrected. One rAF is enough to observe the settled layout.
    if (!quoteExpanded) return;
    const frame = requestAnimationFrame(reclampPanelOffset);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteExpanded]);

  function handleHeaderPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // The close button lives in the same header strip — a pointerdown there
    // is a click, not a drag start. The quote arms the drag itself (see
    // handleQuotePointerDown) rather than being excluded here.
    if ((event.target as HTMLElement).closest("button")) return;
    dragControls.start(event);
  }

  // M19.6 operator feedback (decisions.md 2026-07-30 later): the quote used
  // to be excluded from dragging like the close button, but it also filled
  // almost the entire header, leaving barely any bare strip to grab — this
  // arms the same drag gesture from the quote's own pointerdown instead.
  // ⚠️ `dragControls.start` does *not* suppress the native click that
  // follows on pointerup — confirmed live: a real drag gesture (via
  // dragControls) still left a synthetic click event that toggled
  // quoteExpanded afterward, growing the panel unexpectedly. So this tracks
  // real pointer movement itself, in a plain ref (not React state — it must
  // be readable synchronously inside the click handler that fires right
  // after the matching pointerup, with no re-render in between) and the
  // click handler below skips the toggle whenever this pointerdown's own
  // gesture actually moved.
  function handleQuotePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    const startX = event.clientX;
    const startY = event.clientY;
    const DRAG_THRESHOLD_PX = 4;

    function onMove(moveEvent: PointerEvent) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > DRAG_THRESHOLD_PX) {
        quoteDraggedRef.current = true;
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    dragControls.start(event);
  }

  function handleQuoteClick() {
    if (quoteDraggedRef.current) {
      quoteDraggedRef.current = false;
      return;
    }
    setQuoteExpanded((prev) => !prev);
  }

  function handleDragEnd() {
    setIsDragging(false);
    const dx = dragX.get();
    const dy = dragY.get();
    onPanelOffsetChange(highlightId, dx, dy);
    void updateHighlightPanelOffset(highlightId, dx, dy);
  }

  // M19.6 "annotations are resizable", widened per operator feedback
  // (decisions.md 2026-07-30 later) from one bottom-right corner to every
  // edge/corner except the top — the top strip is the drag handle and the
  // quote, and reserved for those. Same pointer-capture pattern as M10's
  // page-edge drag-to-peel and M12's scrub dial (so the gesture survives
  // leaving the handle's own small hit target), clamped to a sensible
  // minimum and to the bounds rect's own size.
  //
  // The panel is positioned right-anchored + top-anchored (`.panel`'s CSS
  // `right`, plus the `top` inline style) with `dragX`/`dragY` layered on
  // as a transform. Growing `width` alone always extends the box's *left*
  // edge (the right edge is anchor-fixed) — correct, unprompted, for a
  // left-edge/bottom-left-corner drag, but wrong for a right-edge/
  // bottom-right-corner one, where the cursor is on the right and the left
  // edge should stay put. A right-side handle therefore also shifts `dragX`
  // by the same delta the width grew by, keeping the left edge fixed and
  // letting the anchored right edge follow the cursor. The bottom edge
  // needs no equivalent compensation — `top` is fixed and growth is a
  // simple downward extension.
  function handleResizePointerDown(horizontal: "left" | "right" | null, vertical: "bottom" | null) {
    return function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
      event.stopPropagation();
      const panelEl = panelRef.current;
      const boundsEl = appBoundsRef.current;
      if (!panelEl || !boundsEl) return;
      event.currentTarget.setPointerCapture(event.pointerId);

      const startRect = panelEl.getBoundingClientRect();
      const startWidth = size?.width ?? startRect.width;
      const startHeight = size?.height ?? startRect.height;
      const startDragX = dragX.get();
      const startX = event.clientX;
      const startY = event.clientY;
      const boundsRect = boundsEl.getBoundingClientRect();

      function onMove(moveEvent: PointerEvent) {
        let nextWidth = startWidth;
        let appliedWidthDelta = 0;
        if (horizontal) {
          const rawDelta = moveEvent.clientX - startX;
          const widthDelta = horizontal === "left" ? -rawDelta : rawDelta;
          nextWidth = Math.min(
            Math.max(startWidth + widthDelta, DEFAULT_PANEL_MIN_WIDTH_PX),
            boundsRect.width,
          );
          appliedWidthDelta = nextWidth - startWidth;
        }
        let nextHeight = startHeight;
        if (vertical) {
          nextHeight = Math.min(
            Math.max(startHeight + (moveEvent.clientY - startY), DEFAULT_PANEL_MIN_HEIGHT_PX),
            boundsRect.height,
          );
        }
        setSize({ width: nextWidth, height: nextHeight });
        if (horizontal === "right") {
          dragX.set(startDragX + appliedWidthDelta);
        }
      }

      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setSize((current) => {
          if (current) {
            onPanelSizeChange(highlightId, current.width, current.height);
            void updateHighlightPanelSize(highlightId, current.width, current.height);
          }
          return current;
        });
        if (horizontal === "right") {
          const dx = dragX.get();
          const dy = dragY.get();
          onPanelOffsetChange(highlightId, dx, dy);
          void updateHighlightPanelOffset(highlightId, dx, dy);
        }
        // Growing the panel can push it past the bounds edge exactly like
        // expanding the quote can — same rAF-timed re-clamp, same reason.
        requestAnimationFrame(reclampPanelOffset);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  useEffect(() => {
    let cancelled = false;
    fetchHighlightTags(highlightId).then((fetched) => {
      if (!cancelled) setTags(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [highlightId]);

  function handleTagsChange(next: string[]) {
    setTags(next);
    void updateHighlightTags(highlightId, next);
  }

  function handleImportanceChange(next: HighlightImportance) {
    onImportanceChange(highlightId, next);
    void updateHighlightImportance(highlightId, next);
  }

  // M13: a plain free-text note, separate from the LLM composer below —
  // autosaved on the same debounce as the desk notepad, no LLM involved.
  const [noteDraft, setNoteDraft] = useState(highlightNote);
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    };
  }, []);

  function handleNoteChange(next: string) {
    setNoteDraft(next);
    // Updates the parent's highlight list immediately, so the margin rail /
    // annotations overview reflect "has a note" without waiting on the
    // network round trip below.
    onNoteChange(highlightId, next);
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    setNoteSaveState("idle");
    noteSaveTimerRef.current = setTimeout(async () => {
      setNoteSaveState("saving");
      await updateHighlightNote(highlightId, next);
      setNoteSaveState("saved");
    }, NOTE_AUTOSAVE_DELAY_MS);
  }

  const [messages, setMessages] = useState<Message[]>([]);
  // M17 "context-window readout": live/session-only, keyed by message id —
  // never fetched on reload (the llm_usage ledger, not this, is the durable
  // record; see contextUsage.ts's ContextUsage doc comment).
  const [contextUsageByMessageId, setContextUsageByMessageId] = useState<
    Record<string, ContextUsage>
  >({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef("");
  // Id of the optimistic user bubble for the most recent (possibly failed)
  // submission — Retry reuses it instead of pushing a second copy.
  const pendingMessageIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Captured once at mount (the component remounts per-highlight via a
  // `key` prop in ReaderView): whether *this panel open* started from an
  // existing thread. Deliberately not reactive to the `thread` prop — once
  // the first message completes, `onThreadChange` gives this same highlight
  // a freshly-created thread id, and re-fetching history at that point
  // would just redundantly re-request messages we already have locally.
  const [initialThread] = useState(thread);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setStreamingText(null);

    if (!initialThread) {
      setMessages([]);
      return;
    }
    setLoadingHistory(true);
    fetch(`/api/threads/${initialThread.id}`)
      .then((res) => (res.ok ? (res.json() as Promise<ThreadWithMessages>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setMessages(data.messages);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialThread]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [highlightId]);

  // Stick-to-bottom autoscroll: only follow new content if already near the
  // bottom, so scrolling up to read history isn't yanked back mid-stream.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  useEffect(() => {
    // Abort any in-flight stream when the panel unmounts or switches highlight.
    return () => {
      abortRef.current?.abort();
    };
  }, [highlightId]);

  async function submit(question: string, retryMessageId?: string) {
    const trimmed = question.trim();
    if (!trimmed || streamingText !== null) return;

    setError(null);
    setLastQuestion(trimmed);
    setDraft("");
    setStreamingText("");
    streamingTextRef.current = "";

    // Retry reuses the existing optimistic bubble from the failed attempt
    // instead of appending a new one for the same question.
    if (retryMessageId) {
      pendingMessageIdRef.current = retryMessageId;
    } else {
      const optimisticId = `pending-${Date.now()}`;
      pendingMessageIdRef.current = optimisticId;
      const optimisticUser: Message = {
        id: optimisticId,
        threadId: thread?.id ?? "",
        role: "user",
        content: trimmed,
        contextNote: null,
        contextDepth: null,
        contextChapters: [],
        createdAt: new Date().toISOString(),
        provenance: null,
      };
      setMessages((prev) => [...prev, optimisticUser]);
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const url = thread ? `/api/threads/${thread.id}/messages` : "/api/threads";
    const body = thread ? { question: trimmed } : { highlightId, question: trimmed };

    await streamThread(
      url,
      body,
      {
        onText: (text) => {
          streamingTextRef.current += text;
          setStreamingText(streamingTextRef.current);
        },
        onDone: (messageId, threadId, contextNote, contextUsage, contextDepth, contextChapters, provenance) => {
          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              threadId,
              role: "assistant",
              content: streamingTextRef.current,
              contextNote,
              contextDepth,
              contextChapters,
              createdAt: new Date().toISOString(),
              provenance,
            },
          ]);
          if (contextUsage) {
            setContextUsageByMessageId((prev) => ({ ...prev, [messageId]: contextUsage }));
          }
          setStreamingText(null);
          abortRef.current = null;
          onThreadChange(highlightId, { id: threadId, hasAnswer: true });
        },
        onError: (message) => {
          setError(message);
          setStreamingText(null);
          abortRef.current = null;
        },
      },
      controller.signal,
    );
  }

  function handleStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreamingText(null);
  }

  function handleRetry() {
    if (lastQuestion) submit(lastQuestion, pendingMessageIdRef.current ?? undefined);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(draft);
    } else if (event.key === "Escape") {
      onClose();
    }
  }

  const isStreaming = streamingText !== null;
  const reducedMotion = useReducedMotion();

  // M10 origami skin (DESIGN.md Room 2): unfolding from the collapsed
  // margin-rail tab (MarginRail.module.css) in two visible creases rather
  // than one smooth reveal — scaleY/rotateX pass through an intermediate
  // "half open" keyframe before settling flat. Collapse (exit) reverses it.
  // Reduced motion: no fold at all, an instant fade — same budget as every
  // other transition in the app.
  const unfoldTransition = reducedMotion
    ? { duration: 0.12 }
    : { duration: 0.34, ease: [0.4, 0, 0.2, 1] as const, times: [0, 0.55, 1] };
  const refoldTransition = reducedMotion
    ? { duration: 0.12 }
    : { duration: 0.26, ease: [0.4, 0, 0.2, 1] as const, times: [0, 0.45, 1] };

  return (
    <motion.div
      ref={panelRef}
      className={`${styles.panel} ${styles[highlightKind]}`}
      style={{
        top,
        x: dragX,
        y: dragY,
        rotate: tiltDeg,
        transformPerspective: 900,
        // M19.6 "annotations are resizable": explicit pixel dimensions once
        // resized, overriding the default `min(340px, ...)` width and
        // `max-height: calc(100% - 2rem)` cap (relative to the *stage*,
        // narrower than the roam bounds this can now resize into) —
        // undefined/"none" let those CSS defaults show through until then.
        width: size?.width,
        height: size?.height,
        maxHeight: size ? "none" : undefined,
      }}
      role="dialog"
      aria-label="Ask about this passage"
      drag
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={appBoundsRef}
      dragElastic={0}
      dragMomentum={false}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={handleDragEnd}
      initial={
        reducedMotion
          ? { opacity: 0 }
          : { opacity: 0, scaleY: 0.06, rotateX: -55, originY: 0 }
      }
      animate={
        reducedMotion
          ? { opacity: 1, transition: unfoldTransition }
          : {
              opacity: 1,
              scaleY: [0.06, 0.55, 1],
              rotateX: [-55, -8, 0],
              originY: 0,
              transition: unfoldTransition,
            }
      }
      exit={
        reducedMotion
          ? { opacity: 0, transition: refoldTransition }
          : {
              opacity: 0,
              scaleY: [1, 0.5, 0.05],
              rotateX: [0, -10, -58],
              originY: 0,
              transition: refoldTransition,
            }
      }
    >
      {!reducedMotion && <div className={styles.grain} aria-hidden="true" />}
      <div
        className={`${styles.header} ${isDragging ? styles.headerDragging : ""}`}
        onPointerDown={handleHeaderPointerDown}
      >
        <button
          type="button"
          className={`${styles.quote} ${quoteExpanded ? styles.quoteExpanded : ""}`}
          aria-expanded={quoteExpanded}
          onPointerDown={handleQuotePointerDown}
          onClick={handleQuoteClick}
        >
          &ldquo;{highlightExact}&rdquo;
        </button>
        <IconButton icon="×" label="Collapse thread" size="sm" className={styles.closeButton} onClick={onClose} />
      </div>

      <div className={styles.metaRow}>
        <ImportanceStars value={highlightImportance} onChange={handleImportanceChange} size="small" />
        <TagEditor tags={tags} onChange={handleTagsChange} />
      </div>

      <div className={styles.noteSection}>
        <div className={styles.noteHeader}>
          <span className={styles.noteLabel}>Note</span>
          <span className={styles.noteStatus}>
            {noteSaveState === "saving" ? "Saving…" : noteSaveState === "saved" ? "Saved" : ""}
          </span>
        </div>
        <textarea
          className={styles.noteTextarea}
          placeholder="Your own note on this passage…"
          value={noteDraft}
          onChange={(e) => handleNoteChange(e.target.value)}
          rows={2}
        />
      </div>

      <div className={styles.messages} ref={scrollRef}>
        {loadingHistory && <div className={styles.hint}>Loading…</div>}
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? styles.userMessage : styles.assistantMessage}
          >
            {message.role === "user"
              ? displayableQuestion(message.content)
              : renderMarkdown(message.content)}
            {message.role === "assistant" && message.contextNote && (
              <div className={styles.contextNote}>{message.contextNote}</div>
            )}
            {message.role === "assistant" && contextUsageByMessageId[message.id] && (
              <div className={styles.contextUsage}>
                {formatContextUsage(contextUsageByMessageId[message.id])}
              </div>
            )}
            {message.role === "assistant" && message.contextDepth && (
              <div className={styles.contextUsage}>
                {message.contextDepth === "digest"
                  ? `context: digest${
                      message.contextChapters.length > 0
                        ? ` (chapters ${message.contextChapters.join(", ")})`
                        : " (no chapters digested yet)"
                    }`
                  : `context: ${message.contextDepth}`}
              </div>
            )}
            {message.role === "assistant" && message.provenance && (
              <div className={styles.provenance}>{formatProvenance(message.provenance)}</div>
            )}
          </div>
        ))}
        {isStreaming && (
          <div className={styles.assistantMessage}>
            {streamingText.length > 0 ? renderMarkdown(streamingText) : (
              <span className={styles.thinking}>Thinking…</span>
            )}
          </div>
        )}
        {error && (
          <div className={styles.errorBox}>
            {error === "provider_unconfigured" ? (
              <>
                No LLM provider configured.{" "}
                <Link
                  to="/settings"
                  state={{ background: location }}
                  onClick={(event) => {
                    setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
                    onClose();
                  }}
                >
                  Configure one in Settings
                </Link>
                .
              </>
            ) : (
              <>
                {error}{" "}
                <Button variant="danger" size="sm" className={styles.retryButton} onClick={handleRetry}>
                  Retry
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {providerConfigured ? (
        <div className={styles.composer}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder={messages.length === 0 ? "Ask about this passage…" : "Ask a follow-up…"}
            value={draft}
            disabled={isStreaming}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
          />
          <div className={styles.composerControls}>
            <ContextLadderToggle resourceId={resourceId} />
            {isStreaming ? (
              <Button variant="danger" size="sm" className={styles.stopButton} onClick={handleStop}>
                Stop
              </Button>
            ) : (
              <Button
                variant="solid"
                size="sm"
                className={styles.sendButton}
                disabled={!draft.trim()}
                onClick={() => submit(draft)}
              >
                {messages.length === 0 ? "Ask" : "Send"}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.nudge}>
          Configure an LLM provider to ask questions.{" "}
          <Link
            to="/settings"
            state={{ background: location }}
            onClick={(event) => {
              setPendingOverlayOrigin(captureOverlayOrigin(event.currentTarget));
              onClose();
            }}
          >
            Go to Settings
          </Link>
        </div>
      )}
      {/* M19.6 operator feedback: every edge/corner except the top (the
          drag handle + quote's own strip) gets a resize handle. */}
      <div
        className={`${styles.resizeEdge} ${styles.resizeEdgeLeft}`}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown("left", null)}
      />
      <div
        className={`${styles.resizeEdge} ${styles.resizeEdgeRight}`}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown("right", null)}
      />
      <div
        className={`${styles.resizeEdge} ${styles.resizeEdgeBottom}`}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown(null, "bottom")}
      />
      <div
        className={styles.resizeHandle}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown("right", "bottom")}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeHandleLeft}`}
        aria-hidden="true"
        onPointerDown={handleResizePointerDown("left", "bottom")}
      />
    </motion.div>
  );
}
