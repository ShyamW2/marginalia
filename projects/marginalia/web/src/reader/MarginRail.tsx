import type { HighlightWithThread } from "@marginalia/shared";
import { groupHighlightsByThread, groupPrimary } from "../threads/resolvePrimaryAnchor.js";
import styles from "./MarginRail.module.css";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

interface MarginRailProps {
  highlights: HighlightWithThread[];
  currentSpineIndex: number | null;
  unanchoredIds: Set<string>;
  onNavigate: (highlight: HighlightWithThread) => void;
  onDelete: (highlight: HighlightWithThread) => void;
  onOpenThread: (highlight: HighlightWithThread) => void;
}

export function MarginRail({
  highlights,
  currentSpineIndex,
  unanchoredIds,
  onNavigate,
  onDelete,
  onOpenThread,
}: MarginRailProps) {
  if (highlights.length === 0) return <div className={styles.rail} />;

  return (
    <div className={styles.rail}>
      {groupHighlightsByThread(highlights).map((group) => {
        const primary = groupPrimary(group);
        const unanchored = unanchoredIds.has(primary.id);
        const active = group.some((h) => h.spineIndex === currentSpineIndex);
        const hasThread = primary.thread !== null;
        const hasAnswer = primary.thread?.hasAnswer ?? false;
        const hasNote = group.some((h) => h.note.trim().length > 0);
        const className = [
          styles.dotButton,
          styles[primary.kind],
          active ? styles.active : "",
          unanchored ? styles.unanchored : "",
          // M13: a note reads with the same folded-corner treatment as a
          // thread (DESIGN.md's dog-ear motif) — "annotated," not a plain dot.
          hasThread || hasNote ? styles.hasThread : "",
          hasAnswer ? styles.hasAnswer : "",
        ]
          .filter(Boolean)
          .join(" ");

        const threadState = hasAnswer ? "answered" : hasThread ? "awaiting an answer" : null;
        const suffixParts = [
          threadState ? `thread ${threadState}` : null,
          hasNote ? "note" : null,
          group.length > 1 ? `${group.length} passages` : null,
        ].filter((part): part is string => part !== null);
        const title = unanchored
          ? `Couldn't relocate: "${truncate(primary.exact, 80)}"`
          : suffixParts.length > 0
            ? `${truncate(primary.exact, 80)} (${suffixParts.join(", ")})`
            : truncate(primary.exact, 80);

        return (
          <div key={primary.id} className={styles.dotWrapper}>
            <button
              type="button"
              className={className}
              title={title}
              aria-label={
                group.length > 1
                  ? `Go to annotation, ${group.length} passages: ${truncate(primary.exact, 40)}`
                  : `Go to highlight: ${truncate(primary.exact, 40)}`
              }
              onClick={() => {
                onNavigate(primary);
                onOpenThread(primary);
              }}
            >
              {group.length > 1 && (
                <span className={styles.countBadge} aria-hidden="true">
                  {group.length}
                </span>
              )}
            </button>
            <button
              type="button"
              className={styles.removeButton}
              aria-label="Delete highlight"
              title="Delete highlight"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(primary);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
