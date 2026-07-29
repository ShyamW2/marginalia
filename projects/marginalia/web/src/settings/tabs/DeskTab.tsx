import type { CursorStyleChoice, Settings } from "@marginalia/shared";
import styles from "../SettingsPage.module.css";

interface DeskTabProps {
  form: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function DeskTab({ form, update }: DeskTabProps) {
  return (
    <>
      <div className={styles.field}>
        <label className={styles.label}>Cursor</label>
        <div className={styles.providerToggle} role="group" aria-label="Cursor style">
          {(
            [
              { value: "custom", label: "Custom (grab/grabbing)" },
              { value: "system", label: "System" },
            ] satisfies { value: CursorStyleChoice; label: string }[]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                form.cursorStyle === option.value
                  ? `${styles.providerButton} ${styles.providerButtonActive}`
                  : styles.providerButton
              }
              aria-pressed={form.cursorStyle === option.value}
              onClick={() => update("cursorStyle", option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <div className={styles.checkboxRow}>
          <input
            id="cursor-trail"
            type="checkbox"
            checked={form.cursorTrailEnabled}
            onChange={(e) => update("cursorTrailEnabled", e.target.checked)}
          />
          <label className={styles.checkboxLabel} htmlFor="cursor-trail">
            Ink trail on the desk
          </label>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="vault-path">
          Obsidian vault path
        </label>
        <input
          id="vault-path"
          className={styles.input}
          type="text"
          value={form.vaultPath}
          placeholder="/path/to/vault"
          onChange={(e) => update("vaultPath", e.target.value)}
        />
      </div>
    </>
  );
}
