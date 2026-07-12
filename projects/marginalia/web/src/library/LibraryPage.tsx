import styles from "./LibraryPage.module.css";

// Import/library grid arrives in M1 (see docs/marginalia/TASKS.md). This is
// the M0 placeholder — a designed empty state, not a bare stub.
export function LibraryPage() {
  return (
    <div className={styles.page}>
      <div className={styles.empty}>
        <div className={styles.emptyTitle}>Your library is empty</div>
        <p>Drag an .epub here, or use the file picker, to start reading.</p>
      </div>
    </div>
  );
}
