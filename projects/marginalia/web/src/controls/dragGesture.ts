import { clampValue, dragToValue, type DetentCapture, type SliderScale } from "./sliderMath.js";

const DRAG_THRESHOLD_PX = 4;

export interface DragGestureConfig {
  /** The value at the moment the pointer went down. */
  startValue: number;
  min: number;
  max: number;
  scale?: SliderScale;
  detents?: readonly number[];
  /** Default `{ fraction: 0.03 }` — see sliderMath's `DetentCapture`. */
  capture?: DetentCapture;
  /** Rounds every preview and commit to the nearest multiple — a control
   * may not emit a value its own consumer will reject. */
  step?: number;
  /** Pixels of drag per value-unit (linear) or per octave (log2). */
  dragPxPerUnit: number;
  /** Which movement axis drives the value — "x" for a horizontal track
   * (Slider), "y" for a vertical one (the digest's chapter reels). Pass a
   * negative `dragPxPerUnit` to invert which direction increases the value. */
  axis: "x" | "y";
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  /** Fires instead of onCommit when the pointer released without ever
   * exceeding the drag threshold — a plain click, not a drag. */
  onClick: () => void;
  /** Fires when Escape cancels an in-progress drag — the preview should be
   * cleared, but neither onCommit nor onClick should fire. */
  onCancel: () => void;
}

interface PointerDownLike {
  currentTarget: HTMLElement;
  pointerId: number;
  clientX: number;
  clientY: number;
}

/**
 * The pointer-lock drag gesture `Slider` established (M19.7, decisions.md
 * 2026-07-30 "the slider is a gesture that already exists" — itself lifted
 * from the reader's pre-existing `%` scrub): pointer lock for unbounded
 * travel, a live preview distinct from the committed value, Escape-cancels
 * via a capture-phase listener so it wins over a room's own Escape handler,
 * and `blur()` on release so the control stops eating arrow keys afterward.
 * Extracted out of `Slider.tsx` (M20.5) so the digest's FROM/TO reels — a
 * second dial-shaped control — are a second *consumer* of this mechanic,
 * never a second copy of it (decisions.md 2026-07-30 "a new control belongs
 * to a register... nothing gets a bespoke one again").
 */
export function startDragGesture(event: PointerDownLike, config: DragGestureConfig): void {
  const {
    startValue,
    min,
    max,
    scale = "linear",
    detents = [],
    capture = { fraction: 0.03 },
    step,
    dragPxPerUnit,
    axis,
    onPreview,
    onCommit,
    onClick,
    onCancel,
  } = config;

  const targetEl = event.currentTarget;
  targetEl.setPointerCapture(event.pointerId);
  const startPos = axis === "x" ? event.clientX : event.clientY;
  let dragging = false;
  let dx = 0;
  let lockEngaged = false;
  // React state updates asynchronously, so `onUp` (defined once, in this
  // same closure, before any preview state lands) can't read it for the
  // final commit value without seeing a stale one — a plain local mirrors
  // Slider's original `liveValue`.
  let liveValue = startValue;

  function pos(e: PointerEvent): number {
    return axis === "x" ? e.clientX : e.clientY;
  }
  function movement(e: PointerEvent): number {
    return axis === "x" ? e.movementX : e.movementY;
  }

  function onMove(moveEvent: PointerEvent) {
    if (!dragging) {
      if (Math.abs(pos(moveEvent) - startPos) <= DRAG_THRESHOLD_PX) return;
      dragging = true;
      dx = pos(moveEvent) - startPos;
      // Optional-chained: pointer lock can be refused by the browser — the
      // absolute-position math below stays correct either way, since it's
      // what already ran before lock ever has a chance to engage.
      targetEl.requestPointerLock?.();
    } else if (document.pointerLockElement === targetEl) {
      if (lockEngaged) dx += movement(moveEvent);
      lockEngaged = true;
    } else {
      dx = pos(moveEvent) - startPos;
    }
    liveValue = dragToValue(startValue, dx, dragPxPerUnit, scale, min, max, detents, capture, step);
    onPreview(clampValue(liveValue, min, max));
  }

  function releasePointerLock() {
    if (document.pointerLockElement === targetEl) document.exitPointerLock?.();
  }

  function cleanup() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKeyDuringDrag, true);
    releasePointerLock();
    // A gesture that began with a pointer must release DOM focus on both
    // commit and cancel, or the element keeps focus and its own onKeyDown
    // keeps eating arrow keys meant for something else (M16, moved here
    // verbatim with the rest of this gesture per decisions.md 2026-07-30).
    targetEl.blur();
  }

  function onUp() {
    const wasDragging = dragging;
    cleanup();
    if (wasDragging) onCommit(liveValue);
    else onClick();
  }

  function onKeyDuringDrag(keyEvent: KeyboardEvent) {
    if (keyEvent.key !== "Escape") return;
    keyEvent.stopPropagation();
    dragging = false;
    cleanup();
    onCancel();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  // Capture phase: must win over a room's own window-level Escape handler —
  // cancelling the drag is what Escape means while one is in flight.
  window.addEventListener("keydown", onKeyDuringDrag, true);
}
