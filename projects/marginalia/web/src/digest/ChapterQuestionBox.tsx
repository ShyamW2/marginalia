import { useEffect, useRef, useState } from "react";
import type { ChapterQuestion } from "@marginalia/shared";
import { Button } from "../controls/Button.js";
import { updateChapterQuestionNote, upsertChapterQuestion } from "./digestApi.js";
import styles from "./ChapterQuestionBox.module.css";

// M13's same debounce (ThreadPanel.tsx, Notepad.tsx) — plain autosave, no LLM
// involved.
const NOTE_AUTOSAVE_DELAY_MS = 800;

interface ChapterQuestionBoxProps {
  resourceId: string;
  spineIndex: number;
  /** Null until the reader writes one — independent of whether this chapter
   * has been digested at all (TASKS.md M32 B is not a generation feature). */
  question: ChapterQuestion | null;
  onCreated: (question: ChapterQuestion) => void;
}

/**
 * M32 B: a question about the chapter *as a whole*, with no passage to
 * anchor to — so it can't be a highlight (every highlight requires an
 * anchor). Written once; the answer-space below is a plain autosaved note,
 * reusing the highlight note's editing model rather than a new one. This is
 * also this feature's "re-findable" home — the reader's own chapter
 * questions live here, on the digest page, same as the AI-posed ones above.
 */
export function ChapterQuestionBox({ resourceId, spineIndex, question, onCreated }: ChapterQuestionBoxProps) {
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  const [noteDraft, setNoteDraft] = useState(question?.note ?? "");
  const [noteSaveState, setNoteSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const noteSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the local draft only when a *different* chapter's question arrives
  // (or this chapter's is created for the first time) — not on every parent
  // re-render, which would stomp on an in-flight edit before its debounce
  // fires.
  useEffect(() => {
    setNoteDraft(question?.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.spineIndex]);

  useEffect(() => {
    return () => {
      if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    };
  }, []);

  async function handleAsk() {
    const text = draft.trim();
    if (!text) return;
    setAsking(true);
    setAskError(null);
    const result = await upsertChapterQuestion(resourceId, spineIndex, text);
    setAsking(false);
    if (result.ok) {
      onCreated(result.question);
      setDraft("");
      return;
    }
    if (result.reason === "conflict") {
      // M36 C1: the server refused because this chapter already has a
      // *different* question — sync to what's actually stored (the reader's
      // own draft is left in the box, untouched, so nothing they typed
      // disappears) rather than silently dropping the write.
      onCreated(result.existing);
      setAskError("This chapter already has a question — your first one is still there. Clear it before asking a different one.");
      return;
    }
    setAskError("Couldn't save that question — try again.");
  }

  function handleNoteChange(next: string) {
    setNoteDraft(next);
    if (noteSaveTimerRef.current) clearTimeout(noteSaveTimerRef.current);
    setNoteSaveState("idle");
    noteSaveTimerRef.current = setTimeout(async () => {
      setNoteSaveState("saving");
      await updateChapterQuestionNote(resourceId, spineIndex, next);
      setNoteSaveState("saved");
    }, NOTE_AUTOSAVE_DELAY_MS);
  }

  if (!question) {
    return (
      <div className={styles.box}>
        <span className={styles.label}>Your own question</span>
        <div className={styles.askRow}>
          <input
            type="text"
            className={styles.input}
            placeholder="Ask something about this chapter as a whole…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAsk();
            }}
          />
          <Button variant="outline" size="sm" onClick={handleAsk} disabled={asking || !draft.trim()}>
            Ask
          </Button>
        </div>
        {askError && <p className={styles.askError}>{askError}</p>}
      </div>
    );
  }

  return (
    <div className={styles.box}>
      <div className={styles.header}>
        <span className={styles.label}>Your own question</span>
        <span className={styles.status}>
          {noteSaveState === "saving" ? "Saving…" : noteSaveState === "saved" ? "Saved" : ""}
        </span>
      </div>
      <p className={styles.question}>{question.question}</p>
      {askError && <p className={styles.askError}>{askError}</p>}
      <textarea
        className={styles.noteTextarea}
        placeholder="Your own answer, or just a thought…"
        value={noteDraft}
        onChange={(e) => handleNoteChange(e.target.value)}
        rows={2}
      />
    </div>
  );
}
