import { useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ScanChapter } from "@marginalia/shared";
import { startDragGesture } from "../controls/dragGesture.js";
import { clampValue } from "../controls/sliderMath.js";
import styles from "./ChapterDial.module.css";

const ROW_HEIGHT = 26;
const VISIBLE_ROWS = 3;
const CENTER_ROW = Math.floor(VISIBLE_ROWS / 2);
const DRAG_PX_PER_CHAPTER = 32;

interface ChapterDialProps {
  label: string;
  chapters: ScanChapter[];
  /** Index into `chapters` — the digest's storage unit is a whole section,
   * so this is always an integer, never a fraction of one. */
  value: number;
  onCommit: (index: number) => void;
  disabled?: boolean;
}

/**
 * The digest's FROM/TO range picker, as an analog dial (M20.5, TASKS.md
 * "the digest range picker becomes analog dials" — replaces the M18 torch).
 * Built on the pointer-lock drag `Slider` established (`dragGesture.ts`),
 * vertically: click-drag hides the cursor and scrolls the chapter reel past
 * a fixed needle, the section label settling beneath once released. Always
 * an integer — a chapter dial has no meaningful in-between value the way a
 * token-count slider does, so this rounds every committed value rather than
 * treating detents as advisory.
 */
export function ChapterDial({ label, chapters, value, onCommit, disabled }: ChapterDialProps) {
  const [preview, setPreview] = useState<number | null>(null);
  const maxIndex = Math.max(0, chapters.length - 1);
  const displayValue = clampValue(preview ?? value, 0, maxIndex);
  const roundedDisplay = Math.round(displayValue);
  const current = chapters[roundedDisplay];

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || chapters.length === 0) return;
    startDragGesture(event, {
      startValue: value,
      min: 0,
      max: maxIndex,
      // Negative: dragging up (screen Y decreasing) moves to later chapters,
      // matching the picker-wheel convention ("drag up brings later items to
      // the center") rather than the raw sign of screen-space Y.
      dragPxPerUnit: -DRAG_PX_PER_CHAPTER,
      axis: "y",
      onPreview: setPreview,
      onCommit: (next) => {
        setPreview(null);
        onCommit(Math.round(clampValue(next, 0, maxIndex)));
      },
      onClick: () => {
        // A plain click (no drag) does nothing — the numeric FROM/TO boxes
        // and the chapter dropdown are the click/keyboard path already;
        // this dial is the charm on top, never the only way in.
      },
      onCancel: () => setPreview(null),
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onCommit(Math.round(clampValue(value + 1, 0, maxIndex)));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onCommit(Math.round(clampValue(value - 1, 0, maxIndex)));
    }
  }

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{label}</span>
      <div
        className={styles.dial}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} section`}
        aria-valuemin={0}
        aria-valuemax={maxIndex}
        aria-valuenow={roundedDisplay}
        aria-valuetext={current ? `Section S${current.chapterNumber}` : ""}
        aria-disabled={disabled || undefined}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        <div
          className={styles.reel}
          style={{ transform: `translateY(${(CENTER_ROW - displayValue) * ROW_HEIGHT}px)` }}
        >
          {chapters.map((c) => (
            <div key={c.spineIndex} className={styles.reelRow} style={{ height: ROW_HEIGHT }}>
              S{c.chapterNumber}
            </div>
          ))}
        </div>
        <div className={styles.needle} aria-hidden="true" />
      </div>
      <span className={styles.sectionLabel}>
        {current ? `S${current.chapterNumber}${current.title ? ` · ${current.title}` : ""}` : "—"}
      </span>
    </div>
  );
}
