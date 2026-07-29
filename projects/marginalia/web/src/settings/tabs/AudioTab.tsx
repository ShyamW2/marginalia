import styles from "../SettingsPage.module.css";

/** No audio subsystem exists yet (AUDIO.md is binding from M21) — the tab
 * exists now because the binder shell is the M19 task, not a redesign of
 * every divider's contents. An honest empty state beats a blank panel. */
export function AudioTab() {
  return (
    <p className={styles.hint}>
      Audio isn't built yet — this divider is reserved for the TTS engine, casting, and
      voice settings once that arrives.
    </p>
  );
}
