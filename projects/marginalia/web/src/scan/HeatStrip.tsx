import { useState } from "react";
import type { HighlightImportance, ScanChapter, ScanHighlight } from "@marginalia/shared";
import { ImportanceStars } from "../highlights/ImportanceStars.js";
import { TagEditor } from "../highlights/TagEditor.js";
import { phosphorHue } from "./scanPalette.js";
import styles from "./HeatStrip.module.css";

const MIN_BAND_HEIGHT = 16;
const MAX_BAND_HEIGHT = 160;
// Two bands closer than this (in percent-of-strip-width) visually and
// functionally overlap — confirmed live: a book with two highlights near
// its opening made the second band's hit-area block the first's hover/click
// entirely (same z-index, later in DOM). ~1.2% keeps ~9px-wide bands apart
// on the strip's typical rendered width.
const MIN_GAP_PERCENT = 0.012;

function bandHeight(highlight: ScanHighlight): number {
  const depth = Math.min(1, highlight.threadMessageCount / 8);
  return MIN_BAND_HEIGHT + depth * (MAX_BAND_HEIGHT - MIN_BAND_HEIGHT);
}

/**
 * Spreads out bands that would otherwise sit on top of each other, without
 * touching the *true* `positionPercent` (still shown in the readout) —
 * this only decides where the band and its slot are drawn.
 */
function declutter(
  positioned: (ScanHighlight & { positionPercent: number })[],
): Map<string, number> {
  const sorted = [...positioned].sort((a, b) => a.positionPercent - b.positionPercent);
  const layout = new Map<string, number>();
  let previous = -Infinity;
  for (const highlight of sorted) {
    const x = Math.max(highlight.positionPercent, previous + MIN_GAP_PERCENT);
    layout.set(highlight.id, Math.min(1, x));
    previous = x;
  }
  return layout;
}

interface HeatStripProps {
  chapters: ScanChapter[];
  highlights: ScanHighlight[];
  /** null = no filter active, every band is lit. */
  litIds: Set<string> | null;
  onOpen: (highlight: ScanHighlight) => void;
  onImportanceChange: (highlightId: string, next: HighlightImportance) => void;
  onTagsChange: (highlightId: string, next: string[]) => void;
}

/**
 * The scan's full-width 0-100% strip (DESIGN.md Room 3): chapter ticks from
 * spine boundaries, highlights as heat bands positioned by their
 * server-computed percent (position.ts) — unanchored highlights
 * (`positionPercent: null`) are simply omitted, same "don't guess" rule the
 * reader's own anchoring uses.
 */
export function HeatStrip({
  chapters,
  highlights,
  litIds,
  onOpen,
  onImportanceChange,
  onTagsChange,
}: HeatStripProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const positioned = highlights.filter(
    (h): h is ScanHighlight & { positionPercent: number } => h.positionPercent !== null,
  );
  const layoutPercent = declutter(positioned);

  return (
    <div className={styles.strip}>
      <div className={styles.baseline} />
      {chapters.map((chapter) =>
        chapter.startPercent > 0 ? (
          <div key={chapter.spineIndex}>
            <div className={styles.tick} style={{ left: `${chapter.startPercent * 100}%` }} />
            <div className={styles.tickLabel} style={{ left: `${chapter.startPercent * 100}%` }}>
              {chapter.label}
            </div>
          </div>
        ) : null,
      )}

      {positioned.map((highlight) => {
        const lit = litIds === null || litIds.has(highlight.id);
        const hue = phosphorHue(highlight.kind);
        const isHovered = hoveredId === highlight.id;
        const height = bandHeight(highlight);
        return (
          // Plain positioning wrapper (not interactive) — the band button and
          // the hover readout are siblings inside it, not nested, since the
          // readout hosts its own interactive controls (tag input, star
          // buttons) and a <button> can't validly contain other controls.
          <div
            key={highlight.id}
            className={styles.slot}
            style={{ left: `${(layoutPercent.get(highlight.id) ?? highlight.positionPercent) * 100}%` }}
            onMouseEnter={() => setHoveredId(highlight.id)}
            onMouseLeave={() => setHoveredId((prev) => (prev === highlight.id ? null : prev))}
          >
            <button
              type="button"
              className={lit ? styles.band : `${styles.band} ${styles.dimmed}`}
              style={{
                height,
                background: hue,
                boxShadow: lit ? `0 0 10px ${hue}, 0 0 3px ${hue}` : "none",
                color: hue,
              }}
              aria-label={`${highlight.kind} highlight: ${highlight.exact.slice(0, 60)}`}
              onFocus={() => setHoveredId(highlight.id)}
              onBlur={() => setHoveredId((prev) => (prev === highlight.id ? null : prev))}
              onClick={() => onOpen(highlight)}
            >
              {highlight.importance > 0 && <span className={styles.dogEar} />}
            </button>
            {isHovered && (
              <div
                className={styles.readout}
                role="note"
                style={{ bottom: 48 + height + 10 }}
              >
                <div className={styles.readoutQuote}>&ldquo;{highlight.exact}&rdquo;</div>
                {highlight.threadFirstLine && (
                  <div className={styles.readoutLine}>{highlight.threadFirstLine}</div>
                )}
                <TagEditor
                  tags={highlight.tags}
                  onChange={(next) => onTagsChange(highlight.id, next)}
                />
                <div className={styles.readoutMeta}>
                  <ImportanceStars
                    value={highlight.importance}
                    onChange={(next) => onImportanceChange(highlight.id, next)}
                    size="small"
                  />
                  <span>{Math.round(highlight.positionPercent * 100)}%</span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
