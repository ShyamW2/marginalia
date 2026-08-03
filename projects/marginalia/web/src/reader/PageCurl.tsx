import { useEffect, useRef } from "react";
import {
  computeFold,
  curlArcLength,
  drawPageFold,
  leafSourceRect,
  samplePaperColor,
  type FoldAnchor,
  type Point,
} from "./pageFold.js";
import styles from "./PageCurl.module.css";

interface PageCurlProps {
  /** The departing **card**'s bitmap: the page snapshot composited over the
   * reader margin (cardSnapshot.ts). A canvas rather than a data URL — it is
   * drawn, never transported. */
  image: HTMLCanvasElement;
  /** What the sheet is held by — a corner, or the middle of an edge. */
  anchor: FoldAnchor;
  /** The turning leaf's own size in CSS px — the whole card in single-page
   * mode, one half of it in spread mode (M20 "spread-aware"). */
  leafWidth: number;
  leafHeight: number;
  /** The turning leaf's x-offset within the card, for spread mode. */
  leafX: number;
  /** The whole card's width in CSS px. The bitmap covers the card, which in
   * spread mode is two pages, so this is what tells the fold which slice of
   * it is the leaf actually turning. */
  stageWidth: number;
  /** Read once per animation frame — the live fold pointer in leaf-local
   * coordinates. A function rather than a prop so a real drag can update it
   * every pointermove without forcing a React re-render per frame; the
   * programmatic (click/keyboard) turn updates the same ref from a Motion
   * `animate()` callback instead. */
  getPointer: () => Point;
  /**
   * Reported once, on unmount, with the **median cost of one `drawPageFold`
   * call** over this mount — how `usePageTurnAnimation` decides to trip the
   * M10 low-fps downgrade.
   *
   * Was the mean *frame interval* over the whole mount until 2026-08-03, and
   * that measured the wrong thing twice over (operator bug: "Curl curls the
   * first page, then slides forever"). The canvas mounts *before*
   * `turnPageCurl` awaits its rendition step, so the window included however
   * long epub.js took to lay out a new section — with the fold drawing
   * nothing for all of it — and a mean let that one stall decide a latch
   * that never clears. Median draw cost is the number PAGE_CURL.md §7 is
   * written in, and it is a property of the fold rather than of whatever
   * else the main thread was doing.
   */
  onDrawCost?: (medianDrawMs: number, samples: number) => void;
}

/**
 * M20 "the paper fold" (decisions.md 2026-07-20, amended 2026-08-01): canvas
 * 2D replacement for the old `rotateY` hinge — the departing page peels and
 * *rolls* away from the grabbed corner (pageFold.ts) instead of swinging
 * rigidly on the spine. Redrawn via its own rAF loop only while mounted —
 * `usePageTurnAnimation` mounts this exactly while a fold is live, so
 * "redraw only while a fold is live" (decisions.md budget) falls out of the
 * mount lifecycle rather than a separate flag.
 *
 * Two canvases, not one: the visible one, and an offscreen scratch layer the
 * back of the sheet is composited on before being stamped down. See
 * `drawPageFold` for why that layer is not optional. The scratch canvas is
 * never attached to the document.
 */
export function PageCurl({
  image,
  anchor,
  leafWidth,
  leafHeight,
  leafX,
  stageWidth,
  getPointer,
  onDrawCost,
}: PageCurlProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Refs, not state: these change up to 60x/sec and must never trigger a
  // React re-render — the canvas is the only thing that moves.
  const getPointerRef = useRef(getPointer);
  getPointerRef.current = getPointer;
  const onDrawCostRef = useRef(onDrawCost);
  onDrawCostRef.current = onDrawCost;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let raf = 0;
    let cancelled = false;
    // Cost of each frame that actually drew something. Frames where
    // `computeFold` returns null (the fold at rest, waiting on a rendition
    // step) are not the fold being slow and are not counted.
    const drawCosts: number[] = [];

    const layer = document.createElement("canvas");
    const layerCtx = layer.getContext("2d");
    if (!layerCtx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxWidth = Math.max(1, Math.round(leafWidth * dpr));
    const pxHeight = Math.max(1, Math.round(leafHeight * dpr));
    canvas.width = pxWidth;
    canvas.height = pxHeight;
    layer.width = pxWidth;
    layer.height = pxHeight;

    // Read once per turn, not once per frame: the card bitmap never changes
    // while a fold is live, and this is the only `getImageData` in the path.
    const paper = samplePaperColor(image);
    const arc = curlArcLength(leafWidth, leafHeight);
    // The bitmap is of the whole card; in spread mode only half of it is the
    // leaf that turns.
    const source = leafSourceRect(image.width, image.height, leafX, leafWidth, stageWidth);

    function tick() {
      if (cancelled || !ctx || !layerCtx || !canvas) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      layerCtx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      layerCtx.clearRect(0, 0, layer.width, layer.height);
      const pointer = getPointerRef.current();
      const fold = computeFold(anchor, pointer, leafWidth, leafHeight, arc);
      if (fold) {
        const startedAt = performance.now();
        drawPageFold(ctx, layerCtx, image, source, fold, leafWidth, leafHeight, dpr, paper);
        drawCosts.push(performance.now() - startedAt);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (drawCosts.length === 0) return;
      const sorted = [...drawCosts].sort((a, b) => a - b);
      // Median, not mean: a downgrade that never clears must not be decided
      // by one frame that the garbage collector or a section relayout landed
      // on. See the `onDrawCost` doc above.
      onDrawCostRef.current?.(sorted[sorted.length >> 1]!, sorted.length);
    };
    // Every dep here is fixed for the lifetime of one turn —
    // usePageTurnAnimation always mounts a fresh PageCurl (`curl` goes
    // through null) rather than changing them on a live instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, anchor, leafWidth, leafHeight, leafX, stageWidth]);

  return (
    <div
      className={styles.wrap}
      aria-hidden="true"
      style={{ left: leafX, width: leafWidth, height: leafHeight }}
    >
      <canvas ref={canvasRef} className={styles.canvas} />
    </div>
  );
}
