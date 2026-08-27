import type {
  HighlightKind,
  PageNumberMode,
  PageTransition,
  ReaderMargin,
  Settings,
  SpreadMode,
} from "@marginalia/shared";
import { Button } from "../../controls/Button.js";
import { Slider } from "../../controls/Slider.js";
import { DEFAULT_KIND_LABELS, HIGHLIGHT_KINDS } from "../../reader/highlightKinds.js";
import { useCoarsePointer } from "../useCoarsePointer.js";
import styles from "../SettingsPage.module.css";

interface ReadingTabProps {
  form: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

// M30 A (decisions.md 2026-08-24, settled decision 16): the label is a
// setting, the hue is not — this only maps a kind to its Settings field, it
// never touches `--kind-*` in theme.css.
const KIND_LABEL_FIELD: Record<HighlightKind, "kindLabelRose" | "kindLabelSage" | "kindLabelHoney" | "kindLabelSlate"> = {
  rose: "kindLabelRose",
  sage: "kindLabelSage",
  honey: "kindLabelHoney",
  slate: "kindLabelSlate",
};

// M22.5: "every 0.05" — today's step, i.e. the predetermined sizes the
// reader already supports — generated so the top of the range can't
// silently fall out of sync with the bottom, same reasoning as the two
// token-slider detent lists in ProviderPicker.tsx.
//
// Exported since M31 C6: the reader's own pinch-to-resize instrument
// (PinchResizeInstrument.tsx) renders the identical `Slider` config, so
// these three are the one source of truth for both rather than a value
// silently drifting between the two places it's typed.
export const TEXT_SIZE_MIN = 0.8;
export const TEXT_SIZE_MAX = 1.6;
export const TEXT_SIZE_DETENTS: number[] = [];
for (let d = TEXT_SIZE_MIN; d <= TEXT_SIZE_MAX + 1e-9; d += 0.05) {
  TEXT_SIZE_DETENTS.push(Math.round(d * 100) / 100);
}

export function ReadingTab({ form, update }: ReadingTabProps) {
  const coarsePointer = useCoarsePointer();
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
      {/* M20 step 3 (decisions.md 2026-08-03): a ceiling, not a mode switch —
          "Curl" means "curl if this machine and this capture can", and the
          reduced-motion/low-fps/failed-capture ladder still runs underneath
          both choices. */}
      <div className={styles.field}>
        <label className={styles.label}>Page turn</label>
        <div className={styles.providerToggle} role="group" aria-label="Page turn">
          {(
            [
              { value: "curl", label: "Curl" },
              { value: "slide", label: "Slide" },
            ] satisfies { value: PageTransition; label: string }[]
          ).map((option) => (
            <Button
              key={option.value}
              variant="outline"
              size="sm"
              className={styles.providerButton}
              pressed={form.pageTransition === option.value}
              onClick={() => update("pageTransition", option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <div className={styles.field}>
        <span className={styles.label} id="reader-font-scale-label">
          Text size
        </span>
        <Slider
          ariaLabel="Text size"
          value={form.readerFontScale}
          min={TEXT_SIZE_MIN}
          max={TEXT_SIZE_MAX}
          detents={TEXT_SIZE_DETENTS}
          capture={{ absolute: 0.012 }}
          step={0.01}
          dragPxPerUnit={200}
          keyboardStep={0.05}
          formatValue={(v) => `${Math.round(v * 100)}%`}
          onCommit={(value) => update("readerFontScale", value)}
        />
        {/* M31 C8: this replaces the on-page gesture hint the operator
            originally wanted (DESIGN.md) — there is no hint overlay in the
            reader itself, only this mention, and only where the gesture
            actually exists. */}
        {coarsePointer && (
          <p className={styles.hint}>Pinch the page in the reader to resize text live.</p>
        )}
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

      {/* M30 A: labels are a setting, the four hues are not (settled
          decision 16) — renaming here never migrates a stored highlight's
          `kind`. Four text fields, so this joins Reading rather than
          earning its own tab. */}
      <h2 className={styles.sectionTitle}>Highlights</h2>
      <p className={styles.hint}>
        Names for the four highlight colors — clear a field to go back to its default.
      </p>
      {HIGHLIGHT_KINDS.map((kind) => (
        <div className={styles.field} key={kind}>
          <label className={styles.label} htmlFor={`kind-label-${kind}`}>
            <span className={styles.kindLabelDot} style={{ background: `var(--kind-${kind})` }} aria-hidden="true" />
            {kind[0].toUpperCase()}{kind.slice(1)}
          </label>
          <input
            id={`kind-label-${kind}`}
            className={styles.input}
            type="text"
            value={form[KIND_LABEL_FIELD[kind]]}
            placeholder={DEFAULT_KIND_LABELS[kind]}
            onChange={(e) => update(KIND_LABEL_FIELD[kind], e.target.value)}
          />
        </div>
      ))}
    </>
  );
}
