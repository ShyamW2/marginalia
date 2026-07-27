import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import type {
  HighlightImportance,
  HighlightKind,
  Message,
  ThreadSummary,
  ThreadWithMessages,
} from "@marginalia/shared";
import { ImportanceStars } from "../highlights/ImportanceStars.js";
import { TagEditor } from "../highlights/TagEditor.js";
import {
  fetchHighlightTags,
  updateHighlightImportance,
  updateHighlightNote,
  updateHighlightTags,
} from "../highlights/highlightMeta.js";
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

// M13: same debounce as the desk notepad (Notepad.tsx) — plain autosave,
// no LLM involvement.
const NOTE_AUTOSAVE_DELAY_MS = 800;

interface ThreadPanelProps {
  highlightId: string;
  highlightExact: string;
  highlightKind: HighlightKind;
  highlightImportance: HighlightImportance;
  highlightNote: string;
  thread: ThreadSummary | null;
  top: number;
  providerConfigured: boolean;
  onClose: () => void;
  onThreadChange: (highlightId: string, thread: ThreadSummary) => void;
  onImportanceChange: (highlightId: string, importance: HighlightImportance) => void;
  onNoteChange: (highlightId: string, note: string) => void;
}

export function ThreadPanel({
  highlightId,
  highlightExact,
  highlightKind,
  highlightImportance,
  highlightNote,
  thread,
  top,
  providerConfigured,
  onClose,
  onThreadChange,
  onImportanceChange,
  onNoteChange,
}: ThreadPanelProps) {
  const location = useLocation();
  const [tags, setTags] = useState<string[]>([]);

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
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [draft, setDraft] = useState("");
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
        createdAt: new Date().toISOString(),
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
        onDone: (messageId, threadId) => {
          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              threadId,
              role: "assistant",
              content: streamingTextRef.current,
              createdAt: new Date().toISOString(),
            },
          ]);
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
      className={`${styles.panel} ${styles[highlightKind]}`}
      style={{ top, transformPerspective: 900 }}
      role="dialog"
      aria-label="Ask about this passage"
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
      {!reducedMotion && <div className={styles.creases} aria-hidden="true" />}
      <div className={styles.header}>
        <span className={styles.quote}>&ldquo;{highlightExact}&rdquo;</span>
        <button type="button" className={styles.closeButton} aria-label="Collapse thread" onClick={onClose}>
          ×
        </button>
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
                <Link to="/settings" state={{ background: location }} onClick={onClose}>
                  Configure one in Settings
                </Link>
                .
              </>
            ) : (
              <>
                {error}{" "}
                <button type="button" className={styles.retryButton} onClick={handleRetry}>
                  Retry
                </button>
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
            rows={2}
          />
          {isStreaming ? (
            <button type="button" className={styles.stopButton} onClick={handleStop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendButton}
              disabled={!draft.trim()}
              onClick={() => submit(draft)}
            >
              {messages.length === 0 ? "Ask" : "Send"}
            </button>
          )}
        </div>
      ) : (
        <div className={styles.nudge}>
          Configure an LLM provider to ask questions.{" "}
          <Link to="/settings" state={{ background: location }} onClick={onClose}>
            Go to Settings
          </Link>
        </div>
      )}
    </motion.div>
  );
}
