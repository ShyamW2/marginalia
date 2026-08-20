import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence } from "motion/react";
import { startDragGesture } from "./dragGesture.js";
import { clampValue, quantize, type DetentCapture, type SliderScale } from "./sliderMath.js";
import { SliderDial, type SliderDialTick } from "./SliderDial.js";
import styles from "./Slider.module.css";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** "linear": px is a fixed value-per-pixel rate. "log2": px is a fixed
   * *octave*-per-pixel rate, so the drag feels the same at the bottom and
   * the top of the range. Default "linear". */
  scale?: SliderScale;
  /** Advisory snap points — see sliderMath's nearestDetent. Also what
   * Shift+Arrow steps between, when non-empty. Doubles as the drag dial's
   * ruler marks. */
  detents?: readonly number[];
  /** Detent capture window: a fraction of the detent's own value (right for
   * a log2 range) or a fixed absolute amount (right for a linear range —
   * "±25 either side of every 500" can't be expressed as one fraction).
   * Default `{ fraction: 0.03 }`. */
  capture?: DetentCapture;
  /** Rounds every preview and commit — drag, arrow-step and typed alike —
   * to the nearest multiple of `step`. A control may not emit a value its
   * own consumer will reject (e.g. a `.int()`-validated field fed a drag's
   * raw float). */
  step?: number;
  /** Pixels of drag per value-unit (linear) or per octave (log2). Also the
   * drag dial's ruler rate — the ticks track the pointer 1:1 only if this
   * matches the dial's own `dragPxPerUnit`, which it always does since the
   * dial reads it straight from this prop. */
  dragPxPerUnit: number;
  /** Plain-Arrow keyboard step. Linear: added/subtracted directly.
   * Log2: value is multiplied/divided by this (must be > 1). */
  keyboardStep: number;
  onCommit: (value: number) => void;
  /** Live value while dragging or arrow-stepping-before-commit; `null` once
   * the gesture ends. For a caller that wants to know a drag is live (e.g.
   * to suppress a popover) without rendering anything itself — the dial
   * itself is now always this component's own. */
  onPreviewChange?: (value: number | null) => void;
  /** aria-valuetext, e.g. "16,384 tokens" — not the raw number. Also what
   * the drag dial's own readout shows. */
  formatValue: (value: number) => string;
  /** Parses a typed value back out of click-to-type; default `Number`.
   * Returns null to reject (out-of-range or unparseable) rather than
   * silently clamping to something the user didn't type. */
  parseValue?: (text: string) => number | null;
  ariaLabel: string;
  /** Labelled marks the drag dial should show beside its own `detents`
   * ruler (the reader's chapter stops) — in the same value units as
   * `value`. */
  dialTicks?: readonly SliderDialTick[];
  /** Drag dial hint line. Default "Release to set · Esc to cancel". */
  dialHint?: string;
  /** Which side of the trigger the drag dial grows from. Default "below" —
   * see `SliderDial`'s own doc. */
  dialPlacement?: "below" | "above";
  /** "readout": the formatted value flanked by dim chevrons, no track, fill
   * or thumb — the default, and the only resting form (DESIGN.md "the
   * control system", amended 2026-08-04). "trigger": a plain button showing
   * `children` — for a control with its own rich visual, i.e. none left;
   * kept for a caller that wants a bare click target with custom content. */
  variant?: "readout" | "trigger";
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
  /** Trigger-mode label content. Ignored in readout mode, which renders
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
 *
 * At rest it is a readout, not a track (M22.5, decisions.md 2026-08-04):
 * while dragging, `SliderDial` — generalised from that same `%` scrub —
 * appears centred beneath the control.
 */
export function Slider({
  value,
  min,
  max,
  scale = "linear",
  detents = [],
  capture = { fraction: 0.03 },
  step,
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
  dialTicks,
  dialHint,
  dialPlacement = "below",
  variant = "readout",
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
      onCommit(quantize(parsed, step));
    }
    setEditing(false);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (disabled || editing) return;
    startDragGesture(event, {
      startValue: value,
      min,
      max,
      scale,
      detents,
      capture,
      step,
      dragPxPerUnit,
      axis: "x",
      onPreview: setPreviewAndClampToCommit,
      onCommit: (next) => {
        setPreview(null);
        onCommit(next);
      },
      onClick: () => {
        if (clickToType) startEditing();
        else onPlainClick?.();
      },
      onCancel: () => setPreview(null),
    });
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
        const arrowStep = event.shiftKey ? keyboardStep ** 2 : keyboardStep;
        next = scale === "log2" ? base * (direction > 0 ? arrowStep : 1 / arrowStep) : base + direction * arrowStep;
      }
      const clamped = quantize(clampValue(next, min, max), step);
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

  const dial = preview !== null && (
    <SliderDial
      key="slider-dial"
      value={preview}
      min={min}
      max={max}
      scale={scale}
      dragPxPerUnit={dragPxPerUnit}
      formatValue={formatValue}
      ariaLabel={ariaLabel}
      ticks={detents}
      extraTicks={dialTicks}
      hint={dialHint}
      placement={dialPlacement}
    />
  );

  if (variant === "trigger") {
    return (
      <div className={styles.wrapper}>
        <button
          type="button"
          disabled={disabled}
          className={[styles.trigger, className].filter(Boolean).join(" ")}
          {...commonProps}
        >
          {children}
        </button>
        <AnimatePresence>{dial}</AnimatePresence>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        disabled={disabled}
        className={[styles.readout, disabled ? styles.disabled : "", className].filter(Boolean).join(" ")}
        {...commonProps}
      >
        <span className={styles.chevron} aria-hidden="true">
          ‹
        </span>
        <span className={styles.readoutValue}>{formatValue(displayValue)}</span>
        <span className={styles.chevron} aria-hidden="true">
          ›
        </span>
      </button>
      <AnimatePresence>{dial}</AnimatePresence>
    </div>
  );
}
