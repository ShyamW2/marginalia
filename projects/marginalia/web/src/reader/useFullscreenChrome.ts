import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// M24.7 §G: how long the pebble stays awake after the last pointer movement
// (or after the pointer leaves the pebble itself) before it sleeps again.
export const IMMERSIVE_SLEEP_MS = 2000;

/**
 * M24.7 §G rework of M14 fullscreen (decisions.md 2026-08-19): a *different*
 * axis from focus mode — focus mode hides your annotations, fullscreen hides
 * the app's chrome, which becomes one waking pebble (page, %, digest,
 * listening, exit) instead of M14's four independently proximity-revealed
 * panels (top row, footer, rail, actions cluster). Extracted verbatim from
 * ReaderView.tsx (M19.8 refactor), then reworked in place for §G.
 *
 * Wake is movement-triggered, not proximity-based: any pointer movement over
 * the fullscreen surface wakes the pebble and (re)arms a sleep timer: the
 * pebble sleeps `IMMERSIVE_SLEEP_MS` after the *last* movement, unless the
 * pointer is directly over the pebble (`onPebblePointerEnter`), in which case
 * it stays awake until the pointer actually leaves it. Scrolling alone does
 * not sleep or wake it — decisions.md 2026-08-21, "pointer idle only" — so
 * there is deliberately no scroll listener here.
 *
 * `wakePebble` is returned, not just the state: the reader's own
 * iframe-forwarded mousemove handler (still in ReaderView's book-loading
 * effect — see NOTES.md "M14" for why that effect isn't split) needs to
 * drive the same wake when the cursor is *inside* the rendered page rather
 * than over the parent document — the exact "two pointer paths" M14 lost a
 * session to getting wrong the first time.
 */
export function useFullscreenChrome(): {
  wrapperRef: RefObject<HTMLDivElement>;
  fullscreenMode: boolean;
  fullscreenModeRef: RefObject<boolean>;
  toggleFullscreen: () => void;
  pebbleAwake: boolean;
  wakePebble: () => void;
  onPebblePointerEnter: () => void;
  onPebblePointerLeave: () => void;
} {
  // The reader's own wrapper. It carries the in-page fullscreen layout
  // (`ReaderView.module.css`'s `.wrapperFullscreen`) and nothing else — see
  // `toggleFullscreen` for why the browser's Fullscreen API is deliberately
  // *not* pointed at it.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const fullscreenModeRef = useRef(fullscreenMode);
  useEffect(() => {
    fullscreenModeRef.current = fullscreenMode;
  }, [fullscreenMode]);

  const [pebbleAwake, setPebbleAwake] = useState(false);
  const sleepTimerRef = useRef<number | null>(null);
  // True while the pointer is directly over the pebble — the sleep timer is
  // suppressed for as long as this holds, so hovering it keeps it awake
  // indefinitely rather than sleeping out from under a reader mid-interaction.
  const pointerOverPebbleRef = useRef(false);

  const clearSleepTimer = useCallback(() => {
    if (sleepTimerRef.current !== null) {
      window.clearTimeout(sleepTimerRef.current);
      sleepTimerRef.current = null;
    }
  }, []);

  const scheduleSleep = useCallback(() => {
    clearSleepTimer();
    sleepTimerRef.current = window.setTimeout(() => {
      if (!pointerOverPebbleRef.current) setPebbleAwake(false);
    }, IMMERSIVE_SLEEP_MS);
  }, [clearSleepTimer]);

  const wakePebble = useCallback(() => {
    setPebbleAwake(true);
    scheduleSleep();
  }, [scheduleSleep]);

  const onPebblePointerEnter = useCallback(() => {
    pointerOverPebbleRef.current = true;
    clearSleepTimer();
    setPebbleAwake(true);
  }, [clearSleepTimer]);

  const onPebblePointerLeave = useCallback(() => {
    pointerOverPebbleRef.current = false;
    scheduleSleep();
  }, [scheduleSleep]);

  useEffect(() => {
    if (fullscreenMode) return;
    setPebbleAwake(false);
    pointerOverPebbleRef.current = false;
    clearSleepTimer();
  }, [fullscreenMode, clearSleepTimer]);

  // The dead-zone half of the "two pointer paths" fix: a plain window-level
  // listener, active only in fullscreen, covers the parent-document space
  // the iframe-forwarded path structurally cannot reach (NOTES.md "M14").
  useEffect(() => {
    if (!fullscreenMode) return;
    function handleWindowMouseMove() {
      wakePebble();
    }
    window.addEventListener("mousemove", handleWindowMouseMove);
    return () => window.removeEventListener("mousemove", handleWindowMouseMove);
  }, [fullscreenMode, wakePebble]);

  useEffect(() => clearSleepTimer, [clearSleepTimer]);

  const toggleFullscreen = useCallback(() => {
    setFullscreenMode((prev) => {
      const next = !prev;
      if (next) {
        // ⚠️ **The document element, not the reader's wrapper — and this is a
        // stacking rule, not a preference** (2026-08-26, found live driving a
        // page turn in immersive mode). A real `requestFullscreen()` promotes
        // its element into the browser's **top layer**, and nothing outside
        // that element renders at all — no z-index reaches out of it, because
        // the top layer is above the whole stacking order by construction.
        // Fullscreening `.wrapper` therefore hid every fixed layer the app
        // mounts at its root, the shared 3D canvas among them: the page curl
        // was completely invisible for the length of every immersive turn, and
        // raising the canvas over the reader's chrome (`useScene3DElevated`)
        // could not fix it, because the problem was never depth.
        //
        // `documentElement` contains the shell, the canvas layer and anything
        // else the app renders at the root, so fullscreen keeps the same
        // picture the windowed reader has and merely drops the browser's own
        // chrome — which was the only thing this call was ever for.
        //
        // Can still be refused (no user-gesture chain, or unsupported) — the
        // in-page fullscreen layout applies either way.
        void document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        void document.exitFullscreen?.();
      }
      return next;
    });
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      // The browser can exit real fullscreen on its own (native Escape
      // handling, or the user leaving via the browser's own UI) — resync so
      // our floating-chrome layout doesn't stay engaged with no real
      // fullscreen (or vice versa) behind it.
      if (!document.fullscreenElement) setFullscreenMode(false);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  return {
    wrapperRef,
    fullscreenMode,
    fullscreenModeRef,
    toggleFullscreen,
    pebbleAwake,
    wakePebble,
    onPebblePointerEnter,
    onPebblePointerLeave,
  };
}
