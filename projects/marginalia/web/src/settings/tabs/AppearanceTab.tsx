import { useState } from "react";
import { useAccent } from "../../app/useAccent.js";
import { usePaperTint } from "../../app/usePaperTint.js";
import { ColorField } from "../../controls/ColorField.js";
import { Slider } from "../../controls/Slider.js";
import { Button } from "../../controls/Button.js";
import { hexToHsl } from "../../controls/colorMath.js";
import styles from "../SettingsPage.module.css";

/** The shipped accent, read live off theme.css rather than duplicated here
 * — whichever theme is active supplies its own `--color-accent`, so the
 * picker opens already showing what's actually on screen instead of a
 * value that could drift out of sync with theme.css. */
function currentAccentHsl() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  return hexToHsl(value || "#8a5a3b");
}

function currentPaperHue() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
  return hexToHsl(value || "#faf7f0").h;
}

/**
 * M22.6 §E (decisions.md 2026-08-12 ruling 4): accent first, paper tint
 * second, in that order and visually separated — paper tint governs the
 * `paper` register only (Desk, Book, Digest, Settings) and never the Scan's
 * `glass` register (settled decision 12), which is called out here rather
 * than left implicit.
 */
export function AppearanceTab() {
  const { accent, setAccent, resetAccent } = useAccent();
  const { hue: paperHue, setHue: setPaperHue, resetHue: resetPaperHue } = usePaperTint();

  // Falls back to the live theme value until the user actually picks a
  // custom accent/tint — the field and sliders always need *some* position
  // to render at, even before there's an override.
  const [fallbackAccent] = useState(currentAccentHsl);
  const [fallbackPaperHue] = useState(currentPaperHue);
  const displayedAccent = accent ?? fallbackAccent;
  const displayedPaperHue = paperHue ?? fallbackPaperHue;

  return (
    <>
      <h2 className={styles.sectionTitle}>Accent</h2>
      <p className={styles.hint}>
        Colors the highlight rail, the thread panel's spine and the scan's heat bands, on top of
        every button that uses it. The text on top of it is computed automatically, so no choice
        here can make that text unreadable.
      </p>
      <div className={styles.field}>
        <ColorField
          ariaLabel="Accent hue and lightness"
          hue={displayedAccent.h}
          lightness={displayedAccent.l}
          saturation={displayedAccent.s}
          onChange={({ hue, lightness }) => setAccent({ h: hue, s: displayedAccent.s, l: lightness })}
        />
      </div>
      <div className={styles.field}>
        <span className={styles.label} id="accent-saturation-label">
          Saturation
        </span>
        <Slider
          ariaLabel="Accent saturation"
          value={displayedAccent.s}
          min={0}
          max={100}
          step={1}
          dragPxPerUnit={2}
          keyboardStep={5}
          formatValue={(v) => `${Math.round(v)}%`}
          onCommit={(s) => setAccent({ h: displayedAccent.h, s, l: displayedAccent.l })}
        />
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={resetAccent} disabled={!accent}>
          Reset accent to default
        </Button>
      </div>

      <h2 className={styles.sectionTitle}>Paper tint</h2>
      <p className={styles.hint}>
        Background hue for the Desk, Book, Digest and Settings — the Scan keeps its own fixed
        phosphor palette regardless of this.
      </p>
      <div className={styles.field}>
        <span className={styles.label} id="paper-hue-label">
          Hue
        </span>
        <Slider
          ariaLabel="Paper hue"
          value={displayedPaperHue}
          min={0}
          max={360}
          step={1}
          dragPxPerUnit={2}
          keyboardStep={10}
          formatValue={(v) => `${Math.round(v)}°`}
          onCommit={(hue) => setPaperHue(hue)}
        />
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={resetPaperHue} disabled={paperHue === null}>
          Reset paper to default
        </Button>
      </div>
    </>
  );
}
