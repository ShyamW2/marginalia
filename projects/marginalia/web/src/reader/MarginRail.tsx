import type { HighlightWithThread } from "@marginalia/shared";
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
      {highlights.map((highlight) => {
        const unanchored = unanchoredIds.has(highlight.id);
        const active = highlight.spineIndex === currentSpineIndex;
        const hasThread = highlight.thread !== null;
        const hasAnswer = highlight.thread?.hasAnswer ?? false;
        const hasNote = highlight.note.trim().length > 0;
        const className = [
          styles.dotButton,
          styles[highlight.kind],
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
        ].filter((part): part is string => part !== null);
        const title = unanchored
          ? `Couldn't relocate: "${truncate(highlight.exact, 80)}"`
          : suffixParts.length > 0
            ? `${truncate(highlight.exact, 80)} (${suffixParts.join(", ")})`
            : truncate(highlight.exact, 80);

        return (
          <div key={highlight.id} className={styles.dotWrapper}>
            <button
              type="button"
              className={className}
              title={title}
              aria-label={`Go to highlight: ${truncate(highlight.exact, 40)}`}
              onClick={() => {
                onNavigate(highlight);
                onOpenThread(highlight);
              }}
            />
            <button
              type="button"
              className={styles.removeButton}
              aria-label="Delete highlight"
              title="Delete highlight"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(highlight);
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
