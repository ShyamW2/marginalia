import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** M33 §A2: one rule, not three — 1s of stillness reveals the card. */
export const TOUCH_DWELL_MS = 1000;

interface DwellRingState {
  key: number;
  x: number;
  y: number;
}

export interface TouchCardDwell {
  /** Non-null for the ring's countdown — render a `DwellRing` at it. */
  dwellRing: DwellRingState | null;
  /** True once the dwell has completed for the touch currently down. Toggles
   * back to false the instant the finger moves again (§A2's "any movement
   * dismisses it") and re-arms from there — a second dwell can reveal it
   * again under the same touch. */
  revealed: boolean;
  /** Sticky for the rest of the touch once `revealed` has been true even
   * once, so a book that settles into a long-press does not resume dragging
   * just because a later movement toggles `revealed` back off (§A4:
   * "disarmed for the rest of that touch"). Cleared on the next
   * `onPointerDown`. */
  settled: boolean;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
}

/**
 * M33 §A2/§A3: the touch half of the Desk's (and shelf's) action card. Mouse
 * and pen earn it from a plain hover — the caller's own `onPointerEnter`,
 * filtered to those two pointer types per §A1, exactly as `ExpandingCluster`
 * already filters its own hover-open. Touch has no hover, so it earns the
 * same card the way the reader's M19.6 dwell earns a page turn: **1s of
 * stillness at any point during a touch**, any movement dismisses it and
 * re-arms the timer. There is no separate "hold 0.3s then drag" case — that
 * would just be movement before the second is up.
 *
 * Shared by `BookObject.tsx` and `ShelfView.tsx` (§A6, settled decision 12 —
 * one control, not a per-surface reimplementation) even though only the Desk
 * has a drag to disarm with `settled`.
 */
export function useTouchCardDwell(): TouchCardDwell {
  const [dwellRing, setDwellRing] = useState<DwellRingState | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [settled, setSettled] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);
  const keyRef = useRef(0);

  const clearTimer = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  const arm = useCallback(
    (x: number, y: number) => {
      clearTimer();
      keyRef.current += 1;
      setDwellRing({ key: keyRef.current, x, y });
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        setDwellRing(null);
        setRevealed(true);
        setSettled(true);
      }, TOUCH_DWELL_MS);
    },
    [clearTimer],
  );

  const standDown = useCallback(() => {
    clearTimer();
    setDwellRing(null);
    setRevealed(false);
    setSettled(false);
  }, [clearTimer]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType !== "touch") return;
      arm(event.clientX, event.clientY);
    },
    [arm],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType !== "touch") return;
      // Any movement — mid-dwell or after the card is already out —
      // dismisses it and re-arms from here (§A2). `settled` is untouched:
      // once true it holds for the rest of this touch (§A4).
      setRevealed(false);
      arm(event.clientX, event.clientY);
    },
    [arm],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent) => {
      if (event.pointerType !== "touch") return;
      standDown();
    },
    [standDown],
  );

  useEffect(() => clearTimer, [clearTimer]);

  return { dwellRing, revealed, settled, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}
