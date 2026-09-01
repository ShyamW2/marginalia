import { motion, useReducedMotion } from "motion/react";
import type { HighlightKind, HighlightWithThread } from "@marginalia/shared";
import { IconButton } from "../controls/IconButton.js";
import { groupHighlightsByThread } from "../threads/resolvePrimaryAnchor.js";
import { isGlossaryEntry } from "./Glossary.js";
import styles from "./AnnotationsOverview.module.css";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

interface AnnotationsOverviewProps {
  highlights: HighlightWithThread[];
  unanchoredIds: Set<string>;
  onJumpTo: (highlight: HighlightWithThread) => void;
  onDelete: (highlight: HighlightWithThread) => void;
  onClose: () => void;
  /** M30 A: the reader's own names for the four kind slots — see
   * highlightKinds.ts's `kindLabelsFromSettings`. */
  labels: Record<HighlightKind, string>;
}

/**
 * Reader revisit affordance (M7, DESIGN.md): every thread in the book in
 * one scrollable list, jump-to on click — the answer to "wait, where were
 * all my questions again?" without hunting margin-rail dots one page at a
 * time. Unanchored highlights (CFI + text-search both failed to relocate
 * them) surface here too, clearly marked, since they can't be jumped to but
 * still need to be findable — typically to just delete them.
 *
 * M36 A2: excludes glossary entries via the same `isGlossaryEntry` predicate
 * `Glossary.tsx` includes them by — a looked-up word lives in exactly one
 * list, and importing the one predicate (rather than each view growing its
 * own kind check) is what keeps the two from drifting apart.
 */
export function AnnotationsOverview({
  highlights,
  unanchoredIds,
  onJumpTo,
  onDelete,
  onClose,
  labels,
}: AnnotationsOverviewProps) {
  const reducedMotion = useReducedMotion();
  const visibleHighlights = highlights.filter((h) => !isGlossaryEntry(h));
  const unanchoredCount = visibleHighlights.filter((h) => unanchoredIds.has(h.id)).length;

  // M35 §D-follow-up, found live 2026-09-01: unlike the margin rail (which
  // collapses a multi-anchor thread to one dot — there's no room there for
  // more than a count), this list has room to keep every passage visible.
  // "I don't mind it being broken out, provided [they're] bounded together"
  // (the operator's own framing) — so each thread's anchors stay individual
  // rows, just wrapped in one bounded group instead of interleaved loose
  // among unrelated highlights.
  function renderEntry(highlight: HighlightWithThread) {
    const unanchored = unanchoredIds.has(highlight.id);
    const hasThread = highlight.thread !== null;
    const hasAnswer = highlight.thread?.hasAnswer ?? false;
    const hasNote = highlight.note.trim().length > 0;
    const baseStatus = unanchored
      ? "Unanchored"
      : hasAnswer
        ? "Answered"
        : hasThread
          ? "Awaiting answer"
          : labels[highlight.kind];
    // M13: a note reads as annotated here too, distinguishable from
    // (and stackable with) the thread status.
    const status = hasNote && !unanchored ? `${baseStatus} · Note` : baseStatus;

    return (
      <li key={highlight.id} className={styles.item}>
        <button
          type="button"
          className={`${styles.entry} ${styles[highlight.kind]} ${unanchored ? styles.unanchored : ""}`}
          disabled={unanchored}
          onClick={() => onJumpTo(highlight)}
        >
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.entryBody}>
            <span className={styles.quote}>&ldquo;{truncate(highlight.exact, 90)}&rdquo;</span>
            <span className={styles.status}>{status}</span>
          </span>
        </button>
        <IconButton
          icon="×"
          label="Delete highlight"
          size="sm"
          className={styles.deleteButton}
          onClick={() => onDelete(highlight)}
        />
      </li>
    );
  }

  return (
    <motion.div
      className={styles.panel}
      role="dialog"
      aria-label="Annotations in this book"
      initial={{ opacity: 0, x: reducedMotion ? 0 : -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: reducedMotion ? 0 : -12 }}
      transition={
        reducedMotion
          ? { duration: 0.12 }
          : { type: "spring", stiffness: 420, damping: 34 }
      }
    >
      <div className={styles.header}>
        <span className={styles.title}>
          Annotations{visibleHighlights.length > 0 ? ` (${visibleHighlights.length})` : ""}
        </span>
        <IconButton icon="×" label="Close" size="sm" className={styles.closeButton} onClick={onClose} />
      </div>

      {unanchoredCount > 0 && (
        <div className={styles.unanchoredNotice}>
          {unanchoredCount} highlight{unanchoredCount === 1 ? "" : "s"} couldn't be
          relocated in this text and can't be jumped to — delete or leave them.
        </div>
      )}

      {visibleHighlights.length === 0 ? (
        <div className={styles.empty}>No highlights yet in this book.</div>
      ) : (
        <ul className={styles.list}>
          {groupHighlightsByThread(visibleHighlights).map((group) =>
            group.length > 1 ? (
              <li key={group[0].primaryHighlightId ?? group[0].id} className={styles.group}>
                <span className={styles.groupLabel}>{group.length} passages, one annotation</span>
                <ul className={styles.groupList}>{group.map(renderEntry)}</ul>
              </li>
            ) : (
              renderEntry(group[0])
            ),
          )}
        </ul>
      )}
    </motion.div>
  );
}
