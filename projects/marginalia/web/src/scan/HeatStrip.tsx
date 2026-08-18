import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type {
  HighlightImportance,
  ScanBookChapter,
  ScanChapter,
  ScanHighlight,
  SearchHit,
} from "@marginalia/shared";
import { ImportanceStars } from "../highlights/ImportanceStars.js";
import { TagEditor } from "../highlights/TagEditor.js";
import { phosphorHue } from "./scanPalette.js";
import { drawHeatField, type HeatColorMode, type HeatPoint } from "./heatField.js";
import { chapterLabelText, thinLabels } from "./chapterAxis.js";
import { searchHitSourceLabel } from "../search/findCursor.js";
import { warpPoint, type WarpGeometry } from "./warp.js";
import {
  fractionToView,
  panByViewFraction,
  panToReveal,
  zoomAtViewPosition,
  zoomIn,
  zoomOut,
  type ZoomState,
} from "./zoom.js";
import styles from "./HeatStrip.module.css";

/** "hit 4 of 17, chapter 9" (TASKS.md M24 C) — the search cursor's own
 * screen-reader announcement, shared between the control's aria-valuetext
 * and its visible label so the two can never say different things. */
function searchCursorValueText(
  hit: SearchHit,
  cursorIndex: number,
  total: number,
  chapters: ScanChapter[],
): string {
  const chapter = [...chapters].reverse().find((c) => c.startPercent <= hit.percent);
  const chapterLabel = chapter ? `, chapter ${chapter.chapterNumber}` : "";
  return `Hit ${cursorIndex + 1} of ${total}${chapterLabel} — ${searchHitSourceLabel(hit.source)}`;
}

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
  /** M19.5: "filter to either or show both" — Mine's heat field/bands only
   * render while this is true; kind/tag/search filters and hit-testing are
   * otherwise unaffected (this hides, it doesn't clear, the filters). */
  showMineLayer: boolean;
  /** M19.5 "the semantic scan: two layers" (decisions.md 2026-07-29 later):
   * the Book layer's chapter-resolution data, and whether it's shown at
   * all — independent of `litIds` above, which only ever governs the Mine
   * layer ("digest/AI is a second signal, not a filter over the first"). */
  bookChapters: ScanBookChapter[];
  showBookLayer: boolean;
  /** null = no theme filter active, every book band is lit at its neutral
   * tone. Set = only bands (and, via litIds, highlights) carrying one of
   * these theme names light up. A specific-theme selection is one name; a
   * book-level selection (M24.5 §4) is every specific theme distilled
   * under it — themeFilter.ts's `activeThemeNames` builds this array so
   * ScanPage never has to know which case it is. */
  litThemes: string[] | null;
  /** M19.5: a book band with no highlight under it "clicks through to the
   * chapter start" (decisions.md) — the only honest target at chapter
   * resolution. */
  onOpenChapter: (spineIndex: number) => void;
  /** M18: the whole-face warp's geometry, in the shared wrapper's own px —
   * identity (no displacement) when the CRT effect is off, so callers don't
   * need a separate "is warp active" branch. */
  warpGeometry: WarpGeometry;
  warpWrapperRef: RefObject<HTMLDivElement>;
  onOpen: (highlight: ScanHighlight) => void;
  onImportanceChange: (highlightId: string, next: HighlightImportance) => void;
  onTagsChange: (highlightId: string, next: string[]) => void;
  /** M24 C: the search result layer and its cursor — "one result set, two
   * views" (decisions.md 2026-08-14), the same ordered hits the reader's
   * find bar steps through. `-1` = nothing stepped to yet. */
  searchHits: SearchHit[];
  searchCursorIndex: number;
  onStepSearchCursor: (direction: "next" | "prev") => void;
  /** Enter opens the reader at the cursor's hit through the existing
   * airlock — stepping itself never drives the reader live underneath
   * (decisions.md 2026-08-14 point 4: surveying and reading stay separate). */
  onOpenSearchHit: (hit: SearchHit) => void;
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
  showMineLayer,
  bookChapters,
  showBookLayer,
  litThemes,
  onOpenChapter,
  warpGeometry,
  warpWrapperRef,
  onOpen,
  onImportanceChange,
  onTagsChange,
  searchHits,
  searchCursorIndex,
  onStepSearchCursor,
  onOpenSearchHit,
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

  // M20.5 "scroll-to-zoom": a native, non-passive listener — React's onWheel
  // is registered passive (browser perf default for wheel/touch), so a
  // preventDefault() there is silently ignored and the popup's own
  // scrollable `.page` (ScanPage.module.css) scrolls underneath the zoom
  // gesture instead of the strip zooming in place. `factor` is continuous
  // (not a fixed step) so a trackpad's many small deltaY events feel like
  // one smooth zoom rather than a staircase.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = el!.getBoundingClientRect();
      const viewPosition = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      const factor = Math.exp(-event.deltaY * 0.0015);
      setZoomState((z) => zoomAtViewPosition(z, factor, viewPosition));
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
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

  // M20.5 "zoom becomes a domain transform": xFraction is the *view*
  // fraction (fractionToView, zoom.ts), not the raw book position — the
  // canvas is redrawn at the zoomed domain instead of being CSS-stretched,
  // so the field stays sharp at any zoom level rather than smearing into a
  // blurry bitmap (decisions.md 2026-07-30 "the scan's zoom becomes a
  // domain transform everywhere").
  const heatPoints = useMemo<HeatPoint[]>(
    () =>
      positioned.map((h) => {
        const lit = litIds === null || litIds.has(h.id);
        const base = 0.28 + threadDepth(h) * 0.72;
        return {
          xFraction: fractionToView(h.positionPercent, zoomState),
          weight: lit ? base : base * 0.22,
          kind: h.kind,
        };
      }),
    [positioned, litIds, zoomState],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || stripSize.width === 0 || stripSize.height === 0) return;
    const baselineY = stripSize.height - BASELINE_OFFSET;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // M19.5 "filter to either or show both": an empty point list clears the
    // canvas to nothing, the same effect turning the layer off should have.
    drawHeatField(canvas, showMineLayer ? heatPoints : [], stripSize.width, stripSize.height, baselineY, dpr, colorMode);
  }, [heatPoints, stripSize, colorMode, showMineLayer]);

  function handleHoverStart(id: string, rect: DOMRect) {
    setHoveredId(id);
    setHoveredRect(rect);
  }
  function handleHoverEnd(id: string) {
    setHoveredId((prev) => (prev === id ? null : prev));
  }

  const hoveredHighlight = hoveredId ? positioned.find((h) => h.id === hoveredId) ?? null : null;

  const viewWidthFraction = 1 / zoomState.zoom;

  const currentSearchHit = searchCursorIndex >= 0 ? (searchHits[searchCursorIndex] ?? null) : null;

  // TASKS.md M24 C: "the strip auto-pans to keep the cursor in view" — only
  // ever moves `pan`, and only when the cursor (or the strip's own size,
  // arriving after the first layout pass) actually changed.
  useEffect(() => {
    if (!currentSearchHit) return;
    setZoomState((z) => panToReveal(z, currentSearchHit.percent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSearchHit, stripSize.width]);

  function handleSearchCursorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onStepSearchCursor("next");
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onStepSearchCursor("prev");
    } else if (event.key === "Enter" && currentSearchHit) {
      event.preventDefault();
      onOpenSearchHit(currentSearchHit);
    }
  }

  const currentSearchHitPos =
    currentSearchHit && stripSize.width > 0
      ? warpLocal(fractionToView(currentSearchHit.percent, zoomState) * stripSize.width, 14)
      : null;
  const searchCursorValue =
    currentSearchHit && searchHits.length > 0
      ? searchCursorValueText(currentSearchHit, searchCursorIndex, searchHits.length, chapters)
      : searchHits.length > 0
        ? `${searchHits.length} result${searchHits.length === 1 ? "" : "s"}`
        : null;

  return (
    <div className={styles.strip} ref={stripRef}>
      {/* M20.5: no CSS transform here anymore — the old `scaleX`/`translateX`
          stretched the tick labels' glyphs along with the canvas bitmap
          (decisions.md 2026-07-30). Every child now positions itself in raw
          px through `fractionToView()`, exactly like the book/highlight
          bands below already did. */}
      <div className={styles.zoomContent}>
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
                style={{ left: fractionToView(chapter.startPercent, zoomState) * stripSize.width }}
              />
            ) : null,
          )}
        </div>

        {chapters.map((chapter) =>
          chapter.startPercent > 0 && shownLabelSpineIndices.has(chapter.spineIndex) ? (
            <div
              key={chapter.spineIndex}
              className={styles.tickLabel}
              style={{ left: fractionToView(chapter.startPercent, zoomState) * stripSize.width }}
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
        {/* M20.5 "wheel-over-the-strip zooms about the cursor... with the
            existing buttons kept and enlarged as the keyboard/pointer-free
            path": these four are the only way to zoom/pan without a wheel
            or a pointer drag, so they get a bigger hit target than the
            other toggles in this row. */}
        <div className={styles.zoomControls} role="group" aria-label="Zoom the strip">
          <button
            type="button"
            className={`${styles.chapterModeToggle} ${styles.zoomButton}`}
            aria-label="Pan left"
            disabled={zoomState.pan <= 0}
            onClick={() => setZoomState((z) => panByViewFraction(z, -0.5))}
          >
            ◀
          </button>
          <button
            type="button"
            className={`${styles.chapterModeToggle} ${styles.zoomButton}`}
            aria-label="Zoom out"
            disabled={zoomState.zoom <= 1}
            onClick={() => setZoomState((z) => zoomOut(z))}
          >
            −
          </button>
          <button
            type="button"
            className={`${styles.chapterModeToggle} ${styles.zoomButton}`}
            aria-label="Zoom in"
            onClick={() => setZoomState((z) => zoomIn(z))}
          >
            +
          </button>
          <button
            type="button"
            className={`${styles.chapterModeToggle} ${styles.zoomButton}`}
            aria-label="Pan right"
            disabled={zoomState.pan >= 1 - viewWidthFraction - 1e-9}
            onClick={() => setZoomState((z) => panByViewFraction(z, 0.5))}
          >
            ▶
          </button>
        </div>

        {searchCursorValue && (
          // TASKS.md M24 C: "the strip's first keyboard path" — a real
          // focusable, arrow-steppable control, not just a visual readout.
          // `role="group"` (not "slider": there's no single numeric value a
          // screen reader could usefully read back, only the label text
          // below, which already carries "hit N of M, chapter C").
          <div
            className={styles.searchCursorControl}
            role="group"
            tabIndex={0}
            aria-label={searchCursorValue}
            onKeyDown={handleSearchCursorKeyDown}
          >
            {searchCursorValue}
          </div>
        )}
      </div>

      {/* M19.5 "the semantic scan: two layers" (decisions.md 2026-07-29
          later): the Book layer — a flat, obviously-quantised band per
          chapter with a thematic reading, sitting right at the baseline
          (its own register, never borrowing Mine's radial-glow language).
          Rendered *before* the Mine highlight bands below so normal DOM
          stacking gives "Mine wins on overlap" for free: a highlight's
          hit-target button paints later and sits on top at the same point,
          so a click there opens the highlight, never falls through to this
          chapter-level target. */}
      {showBookLayer &&
        bookChapters.map((bc) => {
          if (!bc.hasThematic) return null;
          const chapter = chapters.find((c) => c.spineIndex === bc.spineIndex);
          if (!chapter) return null;
          const lit = litThemes === null || bc.themes.some((t) => litThemes.includes(t));
          const rawStartX = fractionToView(chapter.startPercent, zoomState) * stripSize.width;
          const rawEndX =
            fractionToView(chapter.startPercent + chapter.lengthPercent, zoomState) * stripSize.width;
          const rawY = stripSize.height - BASELINE_OFFSET;
          const warpedStart = stripSize.width > 0 ? warpLocal(rawStartX, rawY) : { x: rawStartX, y: rawY };
          const warpedEnd = stripSize.width > 0 ? warpLocal(rawEndX, rawY) : { x: rawEndX, y: rawY };
          const left = Math.min(warpedStart.x, warpedEnd.x);
          const width = Math.max(2, Math.abs(warpedEnd.x - warpedStart.x));
          return (
            <button
              key={`book-${bc.spineIndex}`}
              type="button"
              className={lit ? `${styles.bookBand} ${styles.bookBandLit}` : styles.bookBand}
              style={{ left, width }}
              aria-label={`Section S${chapter.chapterNumber} book themes: ${bc.themes.join(", ") || "none"} — open chapter`}
              onClick={() => onOpenChapter(bc.spineIndex)}
            />
          );
        })}

      {showMineLayer &&
        positioned.map((highlight) => {
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

      {/* M24 C: the search result layer — "a transient layer over the
          strip, distinct from the persistent heat bands" (TASKS.md), riding
          the same warpLocal every other hit-target on this face does (M18
          "one filter, one wrapper"). Purely visual (pointer-events: none in
          CSS) — the keyboard cursor control above and Enter are the way to
          act on a hit, matching "stepping is the primary way to reach a
          result" (decisions.md 2026-08-14 point 3). */}
      {searchHits.map((hit, index) => {
        const rawX = fractionToView(hit.percent, zoomState) * stripSize.width;
        const warped = stripSize.width > 0 ? warpLocal(rawX, 14) : { x: rawX, y: 14 };
        const current = index === searchCursorIndex;
        return (
          <div
            key={`search-${index}`}
            className={current ? `${styles.searchTick} ${styles.searchTickCurrent}` : styles.searchTick}
            style={{ left: warped.x }}
          />
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

      {/* M24 C: "the ghost readout follows [the cursor]" (TASKS.md) — the
          same portal-out-of-the-warp trick as the hover readout above,
          positioned from the current tick's own warped coordinates (already
          computed for painting it) converted to viewport space, rather than
          a second DOM measurement. */}
      {currentSearchHit &&
        currentSearchHitPos &&
        createPortal(
          <div
            className={styles.searchReadout}
            role="note"
            style={{
              left: stripRef.current
                ? stripRef.current.getBoundingClientRect().left + currentSearchHitPos.x
                : currentSearchHitPos.x,
              top: stripRef.current
                ? stripRef.current.getBoundingClientRect().top + currentSearchHitPos.y + 20
                : currentSearchHitPos.y + 20,
            }}
          >
            <div className={styles.searchReadoutSource}>
              {searchHitSourceLabel(currentSearchHit.source)}
            </div>
            <div className={styles.readoutQuote}>{currentSearchHit.snippet}</div>
          </div>,
          document.body,
        )}
    </div>
  );
}
