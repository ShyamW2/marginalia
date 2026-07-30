import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { clampValue, dragToValue, type SliderScale } from "./sliderMath.js";
import styles from "./Slider.module.css";

const DRAG_THRESHOLD_PX = 4;

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** "linear": px is a fixed value-per-pixel rate. "log2": px is a fixed
   * *octave*-per-pixel rate, so the drag feels the same at the bottom and
   * the top of the range. Default "linear". */
  scale?: SliderScale;
  /** Advisory snap points — see sliderMath's nearestDetent. Also what
   * Shift+Arrow steps between, when non-empty. */
  detents?: readonly number[];
  /** Detent capture window, as a fraction of the detent's own value.
   * Default 0.03 (the 2–3% TASKS.md names for log2 token sliders). */
  captureFraction?: number;
  /** Pixels of drag per value-unit (linear) or per octave (log2). */
  dragPxPerUnit: number;
  /** Plain-Arrow keyboard step. Linear: added/subtracted directly.
   * Log2: value is multiplied/divided by this (must be > 1). */
  keyboardStep: number;
  onCommit: (value: number) => void;
  /** Live value while dragging or arrow-stepping-before-commit; `null` once
   * the gesture ends. Lets a caller (e.g. ReaderView's ScrubDial) render its
   * own floating preview instead of this component's default one. */
  onPreviewChange?: (value: number | null) => void;
  /** aria-valuetext, e.g. "16,384 tokens" — not the raw number. */
  formatValue: (value: number) => string;
  /** Parses a typed value back out of click-to-type; default `Number`.
   * Returns null to reject (out-of-range or unparseable) rather than
   * silently clamping to something the user didn't type. */
  parseValue?: (text: string) => number | null;
  ariaLabel: string;
  /** "track": a real track/fill/thumb (the settings token sliders).
   * "trigger": a plain button showing `children`, no track — for a control
   * that already has its own rich visual (the reader's `%` dial keeps
   * ScrubDial). Default "track". */
  variant?: "track" | "trigger";
  /** Click-to-type is the default second input mode (DESIGN.md). Set false
   * to keep a click meaning something else entirely (the reader's existing
   * click-opens-a-popover behavior) — `onPlainClick` fires instead. */
  clickToType?: boolean;
  onPlainClick?: () => void;
  /** Arrow keys commit immediately (default — the settings token sliders,
   * where each step is a value you want applied). Set false to preview on
   * Arrow and require Enter to commit, Escape to cancel — the reader's `%`
   * dial's pre-existing, already-verified behavior (M12), preserved rather
   * than reinvented. */
  commitOnArrow?: boolean;
  disabled?: boolean;
  className?: string;
  /** Trigger-mode label content. Ignored in track mode, which renders
   * `formatValue(value)` itself. */
  children?: React.ReactNode;
  /** For a trigger that also opens a popover on plain click (the reader's
   * `%` dial) — forwarded straight onto the rendered element. */
  "aria-haspopup"?: boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog";
  "aria-expanded"?: boolean;
}

/**
 * The one slider (M19.7 — DESIGN.md "The control system"): drag with
 * pointer lock for unbounded travel, click-to-type, advisory detents, a
 * real keyboard path. The gesture is lifted from the reader's pre-existing
 * `%` scrub (decisions.md 2026-07-30: "move them, don't reinvent them") —
 * pointer lock for travel no screen position could provide in both
 * directions, Escape-cancels via a capture-phase listener so it wins over a
 * room's own Escape handler, and `blur()` on release so the control stops
 * eating arrow keys afterward.
 */
export function Slider({
  value,
  min,
  max,
  scale = "linear",
  detents = [],
  captureFraction = 0.03,
  dragPxPerUnit,
  keyboardStep,
  onCommit,
  onPreviewChange,
  formatValue,
  parseValue = (text) => {
    const n = Number.parseFloat(text);
    return Number.isFinite(n) ? n : null;
  },
  ariaLabel,
  variant = "track",
  clickToType = true,
  onPlainClick,
  commitOnArrow = true,
  disabled,
  className,
  children,
  "aria-haspopup": ariaHaspopup,
  "aria-expanded": ariaExpanded,
}: SliderProps) {
  const [preview, setPreview] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onPreviewChange?.(preview);
  }, [preview, onPreviewChange]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function setPreviewAndClampToCommit(next: number) {
    setPreview(clampValue(next, min, max));
  }

  function startEditing() {
    if (!clickToType) return;
    setDraft(String(value));
    setEditing(true);
  }

  function commitDraft() {
    const parsed = parseValue(draft);
    if (parsed !== null && parsed >= min && parsed <= max) {
      onCommit(parsed);
    }
    setEditing(false);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (disabled || editing) return;
    const targetEl = event.currentTarget;
    targetEl.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startValue = value;
    let dragging = false;
    let dx = 0;
    let lockEngaged = false;
    // React state (`preview`) updates asynchronously, so `onUp` below —
    // defined once, in this same closure, before any of those updates have
    // landed — cannot read it for the final commit value without seeing a
    // stale one from before the drag started. A plain local, mirroring the
    // original ReaderView gesture's `livePercent`, is what `onUp` actually
    // reads.
    let liveValue = startValue;

    function onMove(moveEvent: globalThis.PointerEvent) {
      if (!dragging) {
        if (Math.abs(moveEvent.clientX - startX) <= DRAG_THRESHOLD_PX) return;
        dragging = true;
        dx = moveEvent.clientX - startX;
        // Optional-chained: pointer lock can be refused by the browser —
        // the absolute-clientX math below stays correct either way, since
        // it's what already ran before lock ever has a chance to engage.
        targetEl.requestPointerLock?.();
      } else if (document.pointerLockElement === targetEl) {
        if (lockEngaged) dx += moveEvent.movementX;
        lockEngaged = true;
      } else {
        dx = moveEvent.clientX - startX;
      }
      liveValue = dragToValue(startValue, dx, dragPxPerUnit, scale, min, max, detents, captureFraction);
      setPreviewAndClampToCommit(liveValue);
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
      if (wasDragging) {
        setPreview(null);
        onCommit(liveValue);
      } else if (clickToType) {
        startEditing();
      } else {
        onPlainClick?.();
      }
    }

    function onKeyDuringDrag(keyEvent: globalThis.KeyboardEvent) {
      if (keyEvent.key !== "Escape") return;
      keyEvent.stopPropagation();
      dragging = false;
      setPreview(null);
      cleanup();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Capture phase: must win over a room's own window-level Escape handler
    // (e.g. the reader clears a selection/thread on Escape) — cancelling
    // the drag is what Escape means while one is in flight.
    window.addEventListener("keydown", onKeyDuringDrag, true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (disabled || editing) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const base = preview ?? value;
      let next: number;
      if (event.shiftKey && detents.length > 0) {
        const sorted = [...detents].sort((a, b) => a - b);
        next =
          direction > 0
            ? (sorted.find((d) => d > base) ?? sorted[sorted.length - 1])
            : ([...sorted].reverse().find((d) => d < base) ?? sorted[0]);
      } else {
        const step = event.shiftKey ? keyboardStep ** 2 : keyboardStep;
        next = scale === "log2" ? base * (direction > 0 ? step : 1 / step) : base + direction * step;
      }
      const clamped = clampValue(next, min, max);
      if (commitOnArrow) onCommit(clamped);
      else setPreview(clamped);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!commitOnArrow && preview !== null) {
        const toCommit = preview;
        setPreview(null);
        onCommit(toCommit);
      } else if (clickToType) {
        startEditing();
      }
    } else if (event.key === "Escape" && !commitOnArrow && preview !== null) {
      event.preventDefault();
      setPreview(null);
    }
  }

  const displayValue = preview ?? value;
  const trackFraction =
    scale === "log2"
      ? (Math.log2(displayValue) - Math.log2(min)) / (Math.log2(max) - Math.log2(min))
      : (displayValue - min) / (max - min);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className={[styles.editInput, className].filter(Boolean).join(" ")}
        value={draft}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
          }
        }}
      />
    );
  }

  const commonProps = {
    role: "slider" as const,
    tabIndex: disabled ? -1 : 0,
    "aria-label": ariaLabel,
    "aria-valuemin": min,
    "aria-valuemax": max,
    "aria-valuenow": displayValue,
    "aria-valuetext": formatValue(displayValue),
    "aria-disabled": disabled || undefined,
    "aria-haspopup": ariaHaspopup,
    "aria-expanded": ariaExpanded,
    onPointerDown: handlePointerDown,
    onKeyDown: handleKeyDown,
  };

  if (variant === "trigger") {
    return (
      <button
        type="button"
        disabled={disabled}
        className={[styles.trigger, className].filter(Boolean).join(" ")}
        {...commonProps}
      >
        {children}
      </button>
    );
  }

  return (
    <div className={[styles.track, disabled ? styles.disabled : "", className].filter(Boolean).join(" ")} {...commonProps}>
      <div className={styles.trackFill} style={{ width: `${clampValue(trackFraction, 0, 1) * 100}%` }} />
      <div className={styles.thumb} style={{ left: `${clampValue(trackFraction, 0, 1) * 100}%` }} />
      {preview !== null && (
        <div className={styles.floatingReadout} style={{ left: `${clampValue(trackFraction, 0, 1) * 100}%` }}>
          {formatValue(preview)}
        </div>
      )}
      <span className={styles.trackValue}>{formatValue(displayValue)}</span>
    </div>
  );
}
