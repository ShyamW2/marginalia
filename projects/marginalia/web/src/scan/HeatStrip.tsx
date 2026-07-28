import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { HighlightImportance, ScanChapter, ScanHighlight } from "@marginalia/shared";
import { ImportanceStars } from "../highlights/ImportanceStars.js";
import { TagEditor } from "../highlights/TagEditor.js";
import { phosphorHue } from "./scanPalette.js";
import { drawHeatField, type HeatColorMode, type HeatPoint } from "./heatField.js";
import { chapterLabelText, thinLabels } from "./chapterAxis.js";
import { warpPoint, type WarpGeometry } from "./warp.js";
import { fractionToView, panByViewFraction, zoomIn, zoomOut, type ZoomState } from "./zoom.js";
import styles from "./HeatStrip.module.css";

const MIN_BAND_HEIGHT = 16;
const MAX_BAND_HEIGHT = 160;
const BASELINE_OFFSET = 48;
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
 * decides where the invisible hit-target is drawn, in *raw* (unwarped)
 * strip-fraction space. M18 layers the barrel warp on top of this result
 * (see `warpedLeft` below), it doesn't change what this function does.
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
  /** M18: the whole-face warp's geometry, in the shared wrapper's own px —
   * identity (no displacement) when the CRT effect is off, so callers don't
   * need a separate "is warp active" branch. */
  warpGeometry: WarpGeometry;
  warpWrapperRef: RefObject<HTMLDivElement>;
  onOpen: (highlight: ScanHighlight) => void;
  onImportanceChange: (highlightId: string, next: HighlightImportance) => void;
  onTagsChange: (highlightId: string, next: string[]) => void;
}

/**
 * The scan's full-width 0-100% strip (DESIGN.md Room 3): a real chapter
 * axis (M15) plus a continuous heat field (M15, two-channel colour as of
 * M18) — the pre-M15 discrete bands survive underneath as invisible
 * hit-targets, so hover/click/filter/dim keep behaving exactly as they did
 * in M9. The CRT/VHS warp filter itself now lives one level up
 * (ScanPage.tsx), applied to the whole base scan screen at once — this
 * component only has to keep its hit-targets aligned with it, via
 * `warpGeometry` (warp.ts).
 */
export function HeatStrip({
  chapters,
  highlights,
  litIds,
  warpGeometry,
  warpWrapperRef,
  onOpen,
  onImportanceChange,
  onTagsChange,
}: HeatStripProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
  const [showChapterNames, setShowChapterNames] = useState(false);
  // M18 "two scan modes, one strip" (decisions.md 2026-07-28): "by kind" is
  // the default read ("what's what"); "density" keeps M15's cool→hot ramp
  // for "where did I annotate most". A palette swap over the same field and
  // the same hit targets, not a second component — see heatField.ts.
  const [colorMode, setColorMode] = useState<HeatColorMode>("kind");
  // M18 "tighter bleed and a zoom" (decisions.md 2026-07-28): a viewport
  // transform over the same 0-100% domain, composed with the warp below
  // (zoom/pan first, then the barrel mapping — the filter operates on
  // final rendered pixels, after any CSS transform already ran).
  const [zoomState, setZoomState] = useState<ZoomState>({ zoom: 1, pan: 0 });
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stripSize, setStripSize] = useState({ width: 0, height: 0 });
  // The strip's own offset within the warped wrapper — recomputed whenever
  // the strip resizes (which also covers the common cases that would move
  // it: window resize, chapter/name toggle changing nothing above it).
  // Boring, not exhaustive: a change in sibling content's height *without*
  // the strip itself resizing (rare — readouts/filters are static height)
  // wouldn't re-trigger this, see NOTES.md "M18".
  const [wrapperOffset, setWrapperOffset] = useState({ left: 0, top: 0 });

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setStripSize({ width: box.width, height: box.height });
      const wrapperEl = warpWrapperRef.current;
      if (wrapperEl) {
        const stripRect = el.getBoundingClientRect();
        const wrapperRect = wrapperEl.getBoundingClientRect();
        setWrapperOffset({ left: stripRect.left - wrapperRect.left, top: stripRect.top - wrapperRect.top });
      }
    });
    observer.observe(el);
    setStripSize({ width: el.clientWidth, height: el.clientHeight });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Raw (unwarped) local point -> warped local point, in strip-relative px. */
  function warpLocal(xLocal: number, yLocal: number): { x: number; y: number } {
    if (warpGeometry.maxPull === 0) return { x: xLocal, y: yLocal };
    const warped = warpPoint(wrapperOffset.left + xLocal, wrapperOffset.top + yLocal, warpGeometry);
    return { x: warped.x - wrapperOffset.left, y: warped.y - wrapperOffset.top };
  }

  const positioned = highlights.filter(
    (h): h is ScanHighlight & { positionPercent: number } => h.positionPercent !== null,
  );
  const layoutPercent = declutter(positioned);
  const hasChapterNames = chapters.some((c) => c.title !== null);
  const shownLabelSpineIndices = useMemo(
    () => thinLabels(chapters, stripSize.width, showChapterNames),
    [chapters, stripSize.width, showChapterNames],
  );

  const heatPoints = useMemo<HeatPoint[]>(
    () =>
      positioned.map((h) => {
        const lit = litIds === null || litIds.has(h.id);
        const base = 0.28 + threadDepth(h) * 0.72;
        return { xFraction: h.positionPercent, weight: lit ? base : base * 0.22, kind: h.kind };
      }),
    [positioned, litIds],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stripSize.width === 0 || stripSize.height === 0) return;
    const baselineY = stripSize.height - BASELINE_OFFSET;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    drawHeatField(canvas, heatPoints, stripSize.width, stripSize.height, baselineY, dpr, colorMode);
  }, [heatPoints, stripSize, colorMode]);

  function handleHoverStart(id: string, rect: DOMRect) {
    setHoveredId(id);
    setHoveredRect(rect);
  }
  function handleHoverEnd(id: string) {
    setHoveredId((prev) => (prev === id ? null : prev));
  }

  const hoveredHighlight = hoveredId ? positioned.find((h) => h.id === hoveredId) ?? null : null;

  const viewWidthFraction = 1 / zoomState.zoom;

  return (
    <div className={styles.strip} ref={stripRef}>
      <div
        className={styles.zoomContent}
        style={{
          transform: `scaleX(${zoomState.zoom}) translateX(${-zoomState.pan * stripSize.width}px)`,
        }}
      >
        <div className={styles.graphicsLayer}>
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

        {chapters.map((chapter) =>
          chapter.startPercent > 0 && shownLabelSpineIndices.has(chapter.spineIndex) ? (
            <div
              key={chapter.spineIndex}
              className={styles.tickLabel}
              style={{ left: `${chapter.startPercent * 100}%` }}
              title={chapter.title ? `${chapter.title} · ${Math.round(chapter.startPercent * 100)}%` : undefined}
            >
              {chapterLabelText(chapter, showChapterNames)}
            </div>
          ) : null,
        )}
      </div>

      <div className={styles.stripToggles}>
        <button
          type="button"
          className={styles.chapterModeToggle}
          aria-pressed={colorMode === "density"}
          aria-label={colorMode === "kind" ? "Showing colour by kind — switch to density" : "Showing density — switch to colour by kind"}
          onClick={() => setColorMode((m) => (m === "kind" ? "density" : "kind"))}
        >
          {colorMode === "kind" ? "By kind" : "Density"}
        </button>
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
        <div className={styles.zoomControls} role="group" aria-label="Zoom the strip">
          <button
            type="button"
            className={styles.chapterModeToggle}
            aria-label="Pan left"
            disabled={zoomState.pan <= 0}
            onClick={() => setZoomState((z) => panByViewFraction(z, -0.5))}
          >
            ◀
          </button>
          <button
            type="button"
            className={styles.chapterModeToggle}
            aria-label="Zoom out"
            disabled={zoomState.zoom <= 1}
            onClick={() => setZoomState((z) => zoomOut(z))}
          >
            −
          </button>
          <button
            type="button"
            className={styles.chapterModeToggle}
            aria-label="Zoom in"
            onClick={() => setZoomState((z) => zoomIn(z))}
          >
            +
          </button>
          <button
            type="button"
            className={styles.chapterModeToggle}
            aria-label="Pan right"
            disabled={zoomState.pan >= 1 - viewWidthFraction - 1e-9}
            onClick={() => setZoomState((z) => panByViewFraction(z, 0.5))}
          >
            ▶
          </button>
        </div>
      </div>

      {positioned.map((highlight) => {
        const lit = litIds === null || litIds.has(highlight.id);
        const hue = phosphorHue(highlight.kind);
        const height = bandHeight(highlight);
        // M18 "position the invisible hit-target bands through the same
        // barrel function that displaces the graphics" (decisions.md
        // 2026-07-28): declutter() above works in raw strip-fraction
        // space; fractionToView() composes the zoom/pan viewport transform
        // (zoom.ts); warpLocal() is the final step, making the click land
        // where the glowing blob visually is at every CRT intensity. Bands
        // scrolled outside the current view land outside the strip's own
        // box, where `.strip`'s `overflow: hidden` clips them from both
        // paint and hit-testing — no separate visibility check needed.
        const rawFraction = layoutPercent.get(highlight.id) ?? highlight.positionPercent;
        const rawX = fractionToView(rawFraction, zoomState) * stripSize.width;
        const rawY = stripSize.height - BASELINE_OFFSET - height / 2;
        const warped = stripSize.width > 0 ? warpLocal(rawX, rawY) : { x: rawX, y: rawY };
        return (
          <div
            key={highlight.id}
            className={styles.slot}
            style={{ left: warped.x }}
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
              onMouseEnter={(e) => handleHoverStart(highlight.id, e.currentTarget.getBoundingClientRect())}
              onMouseLeave={() => handleHoverEnd(highlight.id)}
              onFocus={(e) => handleHoverStart(highlight.id, e.currentTarget.getBoundingClientRect())}
              onBlur={() => handleHoverEnd(highlight.id)}
              onClick={() => onOpen(highlight)}
            >
              {highlight.importance > 0 && <span className={styles.dogEar} />}
            </button>
          </div>
        );
      })}

      {/* M18 "floating layers must be portalled out of the warped
          container" (decisions.md 2026-07-28): a `filter` on an ancestor
          both distorts descendants' paint and creates a containing block
          for `position: fixed`, so this can't live inside the strip
          anymore — it's positioned from the hovered band's own measured
          rect instead of CSS placement relative to a warped parent. */}
      {hoveredHighlight &&
        hoveredRect &&
        createPortal(
          <div
            className={styles.readout}
            role="note"
            style={{
              position: "fixed",
              left: hoveredRect.left + hoveredRect.width / 2,
              bottom: window.innerHeight - hoveredRect.top + 10,
              transform: "translateX(-50%)",
            }}
          >
            <div className={styles.readoutQuote}>&ldquo;{hoveredHighlight.exact}&rdquo;</div>
            {hoveredHighlight.threadFirstLine && (
              <div className={styles.readoutLine}>{hoveredHighlight.threadFirstLine}</div>
            )}
            <TagEditor
              tags={hoveredHighlight.tags}
              onChange={(next) => onTagsChange(hoveredHighlight.id, next)}
            />
            <div className={styles.readoutMeta}>
              <ImportanceStars
                value={hoveredHighlight.importance}
                onChange={(next) => onImportanceChange(hoveredHighlight.id, next)}
                size="small"
              />
              <span>{Math.round(hoveredHighlight.positionPercent * 100)}%</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
