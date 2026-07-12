import styles from "./SettingsPage.module.css";

// Provider config, vault path, and "Test connection" arrive in M4.
export function SettingsPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <p className={styles.hint}>
        LLM provider and vault configuration will live here — coming in M4.
      </p>
    </div>
  );
}
