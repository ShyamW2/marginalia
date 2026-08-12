import { useServerHealth } from "./useServerHealth.js";
import styles from "./ServerStatusBanner.module.css";

/**
 * Says out loud that the API is gone (M22.6 F).
 *
 * Deliberately not a `Toast`: a toast auto-dismisses after 4.5s, and this condition
 * does not go away on its own. It stays until the server answers again, at which point
 * it clears itself with no reload.
 *
 * `role="alert"` rather than `role="status"` — this interrupts, because every action
 * the user is about to take will fail.
 */
export function ServerStatusBanner() {
  const down = useServerHealth();
  if (!down) return null;

  return (
    <div className={styles.banner} role="alert">
      <span className={styles.dot} aria-hidden="true" />
      <div className={styles.text}>
        <strong className={styles.title}>The Marginalia server isn’t responding.</strong>
        <span className={styles.detail}>
          Nothing you do here will save. Check the terminal running <code>pnpm dev</code> —
          if it stopped with a native-module error, <code>pnpm sync</code> fixes it. This
          clears itself when the server comes back.
        </span>
      </div>
    </div>
  );
}
