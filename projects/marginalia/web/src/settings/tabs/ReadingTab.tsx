import type { PageNumberMode, ReaderMargin, Settings, SpreadMode } from "@marginalia/shared";
import { Button } from "../../controls/Button.js";
import styles from "../SettingsPage.module.css";

interface ReadingTabProps {
  form: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function ReadingTab({ form, update }: ReadingTabProps) {
  return (
    <>
      <div className={styles.field}>
        <label className={styles.label}>Page margins</label>
        <div className={styles.providerToggle} role="group" aria-label="Page margins">
          {(
            [
              { value: "narrow", label: "Narrow" },
              { value: "normal", label: "Normal" },
              { value: "wide", label: "Wide" },
              { value: "generous", label: "Generous" },
            ] satisfies { value: ReaderMargin; label: string }[]
          ).map((option) => (
            <Button
              key={option.value}
              variant="outline"
              size="sm"
              className={styles.providerButton}
              pressed={form.readerMargin === option.value}
              onClick={() => update("readerMargin", option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Page layout</label>
        <div className={styles.providerToggle} role="group" aria-label="Page layout">
          {(
            [
              { value: "single", label: "Single page" },
              { value: "auto", label: "Two-page spread (wide windows)" },
            ] satisfies { value: SpreadMode; label: string }[]
          ).map((option) => (
            <Button
              key={option.value}
              variant="outline"
              size="sm"
              className={styles.providerButton}
              pressed={form.spreadMode === option.value}
              onClick={() => update("spreadMode", option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="reader-font-scale">
          Text size — {Math.round(form.readerFontScale * 100)}%
        </label>
        <input
          id="reader-font-scale"
          type="range"
          min={0.8}
          max={1.6}
          step={0.05}
          value={form.readerFontScale}
          onChange={(e) => update("readerFontScale", Number.parseFloat(e.target.value))}
        />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Page numbers</label>
        <div className={styles.providerToggle} role="group" aria-label="Page numbers">
          {(
            [
              { value: "off", label: "Off" },
              { value: "chapter", label: "Chapter" },
              { value: "book", label: "Book-wide" },
            ] satisfies { value: PageNumberMode; label: string }[]
          ).map((option) => (
            <Button
              key={option.value}
              variant="outline"
              size="sm"
              className={styles.providerButton}
              pressed={form.pageNumberMode === option.value}
              onClick={() => update("pageNumberMode", option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    </>
  );
}
