import type { HighlightImportance } from "@marginalia/shared";
import styles from "./ImportanceStars.module.css";

interface ImportanceStarsProps {
  value: HighlightImportance;
  onChange: (value: HighlightImportance) => void;
  size?: "small" | "medium";
}

/** Click the currently-lit star again to unstar (reset to 0), same as most star-rating widgets. */
export function ImportanceStars({ value, onChange, size = "medium" }: ImportanceStarsProps) {
  return (
    <div
      className={size === "small" ? `${styles.row} ${styles.small}` : styles.row}
      role="group"
      aria-label="Importance"
    >
      {([1, 2, 3] as const).map((n) => (
        <button
          key={n}
          type="button"
          className={styles.star}
          aria-pressed={value >= n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onClick={() => onChange(value === n ? 0 : n)}
        >
          {value >= n ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}
