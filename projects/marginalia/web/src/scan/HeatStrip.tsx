import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { HighlightImportance, ScanChapter, ScanHighlight } from "@marginalia/shared";
import { ImportanceStars } from "../highlights/ImportanceStars.js";
import { TagEditor } from "../highlights/TagEditor.js";
import { phosphorHue } from "./scanPalette.js";
import { ScanCrtFilter } from "./ScanCrtFilter.js";
import { drawHeatField, type HeatPoint } from "./heatField.js";
import { chapterLabelText, thinLabels } from "./chapterAxis.js";
import styles from "./HeatStrip.module.css";

const MIN_BAND_HEIGHT = 16;
const MAX_BAND_HEIGHT = 160;
// Two bands closer than this (in percent-of-strip-width) visually and
// functionally overlap — confirmed live: a book with two highlights near
// its opening made the second band's hit-area block the first's hover/click
// entirely (same z-index, later in DOM). ~1.2% keeps ~9px-wide bands apart
// on the strip's typical rendered width.
const MIN_GAP_PERCENT = 0.012;

function threadDepth(highlight: ScanHighlight): number {
  return Math.min(1, highlight.threadMessageCount / 8);
}

function bandHeight(highlight: ScanHighlight): number {
  return MIN_BAND_HEIGHT + threadDepth(highlight) * (MAX_BAND_HEIGHT - MIN_BAND_HEIGHT);
}

/**
 * Spreads out bands that would otherwise sit on top of each other, without
 * touching the *true* `positionPercent` (still shown in the readout, and
 * still what the heat field itself plots — see HeatStrip below) — this only
 * decides where the invisible hit-target is drawn.
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
  /** M15 CRT treatment strength, 0-1; caller resolves the persisted setting. */
  crtIntensity: number;
  reducedMotion: boolean;
  onOpen: (highlight: ScanHighlight) => void;
  onImportanceChange: (highlightId: string, next: HighlightImportance) => void;
  onTagsChange: (highlightId: string, next: string[]) => void;
}

/**
 * The scan's full-width 0-100% strip (DESIGN.md Room 3): a real chapter
 * axis (M15) plus a continuous heat field (M15) under a CRT graphics
 * filter (M15) — with the pre-M15 discrete bands surviving underneath as
 * invisible hit-targets, so hover/click/filter/dim keep behaving exactly as
 * they did in M9.
 */
export function HeatStrip({
  chapters,
  highlights,
  litIds,
  crtIntensity,
  reducedMotion,
  onOpen,
  onImportanceChange,
  onTagsChange,
}: HeatStripProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showChapterNames, setShowChapterNames] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stripSize, setStripSize] = useState({ width: 0, height: 0 });
  const filterId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setStripSize({ width: box.width, height: box.height });
    });
    observer.observe(el);
    setStripSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const positioned = highlights.filter(
    (h): h is ScanHighlight & { positionPercent: number } => h.positionPercent !== null,
  );
  const layoutPercent = declutter(positioned);
  const hasChapterNames = chapters.some((c) => c.title !== null);
  const shownLabelSpineIndices = useMemo(
    () => thinLabels(chapters, stripSize.width, showChapterNames),
    [chapters, stripSize.width, showChapterNames],
  );

  const crtActive = !reducedMotion && crtIntensity > 0;

  const heatPoints = useMemo<HeatPoint[]>(
    () =>
      positioned.map((h) => {
        const lit = litIds === null || litIds.has(h.id);
        const base = 0.28 + threadDepth(h) * 0.72;
        return { xFraction: h.positionPercent, weight: lit ? base : base * 0.22 };
      }),
    [positioned, litIds],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stripSize.width === 0 || stripSize.height === 0) return;
    const baselineY = stripSize.height - 48;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    drawHeatField(canvas, heatPoints, stripSize.width, stripSize.height, baselineY, dpr);
  }, [heatPoints, stripSize]);

  return (
    <div className={styles.strip} ref={stripRef}>
      {/* Graphics layer: the CRT filter — barrel warp, bloom, chromatic
          fringe — applies here only. Ticks and the baseline are strokes
          ("fuzz the strokes"); the heat field is graphics. Never the text
          below, and never the interactive hit-targets/readouts. */}
      <div
        className={styles.graphicsLayer}
        style={crtActive ? { filter: `url(#${filterId})` } : undefined}
      >
        <canvas
          ref={canvasRef}
          className={styles.heatCanvas}
          style={{ width: stripSize.width, height: stripSize.height }}
        />
        <div className={styles.baseline} />
        {chapters.map((chapter) =>
          chapter.startPercent > 0 ? (
            <div
              key={chapter.spineIndex}
              className={styles.tick}
              style={{ left: `${chapter.startPercent * 100}%` }}
            />
          ) : null,
        )}
      </div>

      {crtActive && (
        <>
          <ScanCrtFilter id={filterId} intensity={crtIntensity} />
          <div className={styles.vignette} style={{ opacity: 0.15 + crtIntensity * 0.35 }} />
        </>
      )}

      {/* Chapter number/name labels — deliberately outside the filtered
          graphics layer so they stay crisp and legible under any CRT
          intensity. */}
      {chapters.map((chapter) =>
        chapter.startPercent > 0 && shownLabelSpineIndices.has(chapter.spineIndex) ? (
          <div
            key={chapter.spineIndex}
            className={styles.tickLabel}
            style={{ left: `${chapter.startPercent * 100}%` }}
          >
            {chapterLabelText(chapter, showChapterNames)}
          </div>
        ) : null,
      )}

      {hasChapterNames && (
        <button
          type="button"
          className={styles.chapterModeToggle}
          aria-pressed={showChapterNames}
          onClick={() => setShowChapterNames((v) => !v)}
        >
          {showChapterNames ? "Names" : "№"}
        </button>
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
              // M15: the visible glow now comes from the heat field canvas
              // above — this stays a real, precisely-positioned hit-target
              // for hover/focus/click, just invisible (color: hue is kept
              // so the dog-ear, which draws in currentColor, still shows).
              className={lit ? styles.band : `${styles.band} ${styles.dimmed}`}
              style={{ height, color: hue }}
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
