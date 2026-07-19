import type { HighlightKind } from "@marginalia/shared";
import { HIGHLIGHT_KINDS, KIND_LABELS } from "./highlightKinds.js";
import styles from "./AskPill.module.css";

interface AskPillProps {
  left: number;
  top: number;
  onPickKind: (kind: HighlightKind) => void;
  onAsk: () => void;
}

/**
 * The selection pill: four kind dots (mark the passage as rose/sage/
 * honey/slate, no thread opened) plus "Ask" (always creates a slate
 * highlight and opens the thread panel — docs/decisions.md 2026-07-19).
 */
export function AskPill({ left, top, onPickKind, onAsk }: AskPillProps) {
  return (
    <div
      className={styles.pill}
      style={{ left, top }}
      role="group"
      aria-label="Mark this passage"
      // Selecting text again while the pill is visible shouldn't be
      // interrupted by the pill stealing focus/collapsing the selection.
      onMouseDown={(event) => event.preventDefault()}
    >
      {HIGHLIGHT_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className={`${styles.dot} ${styles[kind]}`}
          title={KIND_LABELS[kind]}
          aria-label={`Mark as ${KIND_LABELS[kind].toLowerCase()}`}
          onClick={() => onPickKind(kind)}
        />
      ))}
      <button type="button" className={styles.askButton} onClick={onAsk}>
        Ask
      </button>
    </div>
  );
}
