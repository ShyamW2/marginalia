import { motion, useReducedMotion } from "motion/react";
import type { ThematicQuestion } from "@marginalia/shared";
import styles from "./ChapterEndPrompt.module.css";

interface ChapterEndPromptProps {
  questions: ThematicQuestion[];
  onAskQuestion: (question: ThematicQuestion) => void;
  onDismiss: () => void;
}

/**
 * M32 A "the chapter-end affordance": pops up (never a modal — CLAUDE.md's
 * "reading comes first", decisions.md 2026-08-24) once the reader crosses
 * into a new chapter, offering the just-finished chapter's already-posed
 * questions (digest/thematicBuild.ts). Nothing kicks off from here — an
 * undigested chapter simply never produces one of these (see ReaderView's
 * own check). `position: fixed`, outside `.stage`'s layer scale entirely —
 * same tier as JobToastStack, which this is modeled on: a dismissible notice
 * that never blocks or moves the reading column. Dismissing it loses
 * nothing — the Digest page is the durable, "re-findable" home for the same
 * questions.
 */
export function ChapterEndPrompt({ questions, onAskQuestion, onDismiss }: ChapterEndPromptProps) {
  const reducedMotion = useReducedMotion();

  if (questions.length === 0) return null;

  return (
    <motion.div
      className={styles.wrap}
      role="status"
      aria-label="This chapter posed some questions"
      initial={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reducedMotion ? 0 : 12 }}
      transition={{ duration: reducedMotion ? 0.001 : 0.16, ease: "easeOut" }}
    >
      <div className={styles.row}>
        <span className={styles.label}>This chapter posed some questions</span>
        <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={onDismiss}>
          ×
        </button>
      </div>
      <div className={styles.questionRow}>
        {questions.map((q, i) => (
          <button
            key={i}
            type="button"
            className={styles.questionChip}
            onClick={() => onAskQuestion(q)}
          >
            {q.text}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
