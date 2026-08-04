import type { Settings } from "@marginalia/shared";
import { Slider } from "../../controls/Slider.js";
import styles from "../SettingsPage.module.css";

interface ScanTabProps {
  form: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function ScanTab({ form, update }: ScanTabProps) {
  return (
    <div className={styles.field}>
      <span className={styles.label} id="scan-crt-intensity-label">
        CRT intensity
      </span>
      <Slider
        ariaLabel="CRT intensity"
        value={form.scanCrtIntensity}
        min={0}
        max={1}
        step={0.01}
        dragPxPerUnit={200}
        keyboardStep={0.05}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onCommit={(value) => update("scanCrtIntensity", value)}
      />
    </div>
  );
}
