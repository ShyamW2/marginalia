import type { ScanHighlight } from "@marginalia/shared";
import styles from "./RevisitQueue.module.css";

interface RevisitQueueProps {
  highlights: ScanHighlight[];
  onOpen: (highlight: ScanHighlight) => void;
}

/** Starred passages (DESIGN.md M9), sorted by importance desc then book position asc. */
export function RevisitQueue({ highlights, onOpen }: RevisitQueueProps) {
  const starred = highlights
    .filter((h) => h.importance > 0)
    .sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance;
      return (a.positionPercent ?? 1) - (b.positionPercent ?? 1);
    });

  return (
    <div className={styles.queue}>
      <h2 className={styles.heading}>Revisit queue</h2>
      {starred.length === 0 ? (
        <p className={styles.empty}>Star a passage to add it here.</p>
      ) : (
        starred.map((highlight) => (
          <button
            key={highlight.id}
            type="button"
            className={styles.item}
            onClick={() => onOpen(highlight)}
          >
            <span className={styles.stars}>{"★".repeat(highlight.importance)}</span>
            <span className={styles.quote}>{highlight.exact}</span>
            {highlight.positionPercent !== null && (
              <span className={styles.percent}>{Math.round(highlight.positionPercent * 100)}%</span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
