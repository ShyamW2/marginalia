import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { TOUCH_DWELL_MS, useTouchCardDwell } from "./useTouchCardDwell.js";

function pointerEvent(
  pointerType: string,
  point: { x?: number; y?: number } = {},
): ReactPointerEvent {
  return { pointerType, clientX: point.x ?? 0, clientY: point.y ?? 0 } as unknown as ReactPointerEvent;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useTouchCardDwell", () => {
  it("ignores mouse and pen — no dwell, no reveal", () => {
    const { result } = renderHook(() => useTouchCardDwell());
    act(() => result.current.onPointerDown(pointerEvent("mouse")));
    expect(result.current.dwellRing).toBeNull();
    act(() => vi.advanceTimersByTime(TOUCH_DWELL_MS));
    expect(result.current.revealed).toBe(false);
  });

  it("reveals the card after 1s of touch stillness, ring showing meanwhile", () => {
    const { result } = renderHook(() => useTouchCardDwell());
    act(() => result.current.onPointerDown(pointerEvent("touch", { x: 10, y: 20 })));
    expect(result.current.dwellRing).toEqual({ key: 1, x: 10, y: 20 });
    expect(result.current.revealed).toBe(false);

    act(() => vi.advanceTimersByTime(TOUCH_DWELL_MS - 1));
    expect(result.current.revealed).toBe(false);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.revealed).toBe(true);
    expect(result.current.settled).toBe(true);
    expect(result.current.dwellRing).toBeNull();
  });

  it("any movement dismisses the card and re-arms the timer from there (§A2)", () => {
    const { result } = renderHook(() => useTouchCardDwell());
    act(() => result.current.onPointerDown(pointerEvent("touch")));
    act(() => vi.advanceTimersByTime(TOUCH_DWELL_MS));
    expect(result.current.revealed).toBe(true);

    act(() => result.current.onPointerMove(pointerEvent("touch", { x: 5, y: 5 })));
    expect(result.current.revealed).toBe(false);
    // `settled` is sticky — a later movement dismissing the card does not
    // un-disarm the drag it already disarmed (§A4).
    expect(result.current.settled).toBe(true);

    // A fresh 1s from the move, not from the original pointerdown.
    act(() => vi.advanceTimersByTime(TOUCH_DWELL_MS - 1));
    expect(result.current.revealed).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.revealed).toBe(true);
  });

  it("stands down on pointerup, clearing revealed and settled for the next touch", () => {
    const { result } = renderHook(() => useTouchCardDwell());
    act(() => result.current.onPointerDown(pointerEvent("touch")));
    act(() => vi.advanceTimersByTime(TOUCH_DWELL_MS));
    expect(result.current.settled).toBe(true);

    act(() => result.current.onPointerUp(pointerEvent("touch")));
    expect(result.current.revealed).toBe(false);
    expect(result.current.settled).toBe(false);
    expect(result.current.dwellRing).toBeNull();

    // A stale timer from the ended touch must not fire late and revive it.
    act(() => vi.advanceTimersByTime(TOUCH_DWELL_MS));
    expect(result.current.revealed).toBe(false);
  });

  it("movement before the second is up never reveals — no separate hold-then-drag case (§A2)", () => {
    const { result } = renderHook(() => useTouchCardDwell());
    act(() => result.current.onPointerDown(pointerEvent("touch")));
    act(() => vi.advanceTimersByTime(TOUCH_DWELL_MS - 100));
    act(() => result.current.onPointerMove(pointerEvent("touch", { x: 1, y: 1 })));
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.revealed).toBe(false);
  });
});
