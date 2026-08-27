import { useEffect } from "react";

/**
 * M31 §0d: WebKit's proprietary `gesturestart`/`gesturechange` fire on iOS
 * Safari for the two-finger pinch even with the standards `touch-action:
 * none`/`user-scalable=no` in place — the latter has been ignored since
 * iOS 10 (decisions.md 2026-08-27) — so page zoom is only actually blocked
 * by `preventDefault()` on WebKit's own events. Blocking it here is what
 * frees pinch for text size (M31 C6): shipping one without the other loses
 * zoom and gains nothing. No-op on every non-WebKit browser, which never
 * fires these events.
 */
export function useBlockPageZoom(): void {
  useEffect(() => {
    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", prevent);
    document.addEventListener("gesturechange", prevent);
    return () => {
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
    };
  }, []);
}
