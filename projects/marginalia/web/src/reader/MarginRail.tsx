import type { Highlight } from "@marginalia/shared";
import styles from "./MarginRail.module.css";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

interface MarginRailProps {
  highlights: Highlight[];
  currentSpineIndex: number | null;
  unanchoredIds: Set<string>;
  onNavigate: (highlight: Highlight) => void;
  onDelete: (highlight: Highlight) => void;
}

export function MarginRail({
  highlights,
  currentSpineIndex,
  unanchoredIds,
  onNavigate,
  onDelete,
}: MarginRailProps) {
  if (highlights.length === 0) return <div className={styles.rail} />;

  return (
    <div className={styles.rail}>
      {highlights.map((highlight) => {
        const unanchored = unanchoredIds.has(highlight.id);
        const active = highlight.spineIndex === currentSpineIndex;
        const className = [
          styles.dotButton,
          active ? styles.active : "",
          unanchored ? styles.unanchored : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div key={highlight.id} className={styles.dotWrapper}>
            <button
              type="button"
              className={className}
              title={
                unanchored
                  ? `Couldn't relocate: "${truncate(highlight.exact, 80)}"`
                  : truncate(highlight.exact, 80)
              }
              aria-label={`Go to highlight: ${truncate(highlight.exact, 40)}`}
              onClick={() => onNavigate(highlight)}
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
