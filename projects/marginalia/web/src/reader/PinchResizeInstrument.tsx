import { Slider } from "../controls/Slider.js";
import { TEXT_SIZE_DETENTS, TEXT_SIZE_MAX, TEXT_SIZE_MIN } from "../settings/tabs/ReadingTab.js";
import styles from "./PinchResizeInstrument.module.css";

interface PinchResizeInstrumentProps {
  /** Live font scale, driven by the pinch — not by this control's own drag
   * (DESIGN.md: "the pinch drives its value; it is not a second slider that
   * happens to look like one"). */
  scale: number;
  /** Viewport coordinates, already clamped into view by the caller (M31 C6:
   * "clamp, do not reject" — see the touch handler's own comment). */
  x: number;
  y: number;
  onCommit: (value: number) => void;
}

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog.";

/**
 * M31 C6: "Pinch to resize is an instrument, not a setting" (DESIGN.md). A
 * live readout — the same `Slider` Settings' own text-size control uses
 * (settled decision 12: a control means the same thing everywhere) — plus a
 * sample string at the live size, so the size can be judged without reading
 * the page itself. Mounted only while a pinch is in progress; the caller
 * (ReaderView's touch handlers) owns `scale` and unmounts this on release.
 */
export function PinchResizeInstrument({ scale, x, y, onCommit }: PinchResizeInstrumentProps) {
  return (
    <div className={styles.instrument} style={{ left: x, top: y }}>
      <Slider
        ariaLabel="Text size"
        value={scale}
        min={TEXT_SIZE_MIN}
        max={TEXT_SIZE_MAX}
        detents={TEXT_SIZE_DETENTS}
        capture={{ absolute: 0.012 }}
        step={0.01}
        dragPxPerUnit={200}
        keyboardStep={0.05}
        formatValue={(v) => `${Math.round(v * 100)}%`}
        onCommit={onCommit}
      />
      <p className={styles.sample} style={{ fontSize: `${scale}em` }}>
        {SAMPLE_TEXT}
      </p>
    </div>
  );
}
