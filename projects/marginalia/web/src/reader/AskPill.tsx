import styles from "./AskPill.module.css";

interface AskPillProps {
  left: number;
  top: number;
  onClick: () => void;
}

export function AskPill({ left, top, onClick }: AskPillProps) {
  return (
    <button
      type="button"
      className={styles.pill}
      style={{ left, top }}
      // Selecting text again while the pill is visible shouldn't be
      // interrupted by the pill stealing focus/collapsing the selection.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <span className={styles.dot} />
      Ask
    </button>
  );
}
