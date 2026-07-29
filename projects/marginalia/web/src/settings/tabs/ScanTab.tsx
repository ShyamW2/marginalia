import type { Settings } from "@marginalia/shared";
import styles from "../SettingsPage.module.css";

interface ScanTabProps {
  form: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function ScanTab({ form, update }: ScanTabProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor="scan-crt-intensity">
        CRT intensity — {Math.round(form.scanCrtIntensity * 100)}%
      </label>
      <input
        id="scan-crt-intensity"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={form.scanCrtIntensity}
        onChange={(e) => update("scanCrtIntensity", Number.parseFloat(e.target.value))}
      />
    </div>
  );
}
