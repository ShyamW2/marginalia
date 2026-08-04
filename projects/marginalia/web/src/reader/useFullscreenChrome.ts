import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

// M14 fullscreen: how close (in px) the pointer must be to the top/bottom
// edge to reveal the floating top row / footer, and how much of the width
// (from the right) counts as the "top-right corner region" the margin rail
// reveals from — deliberately not the whole right edge, so it never fights
// the M11 turn-zone vignette's own right-edge hover.
export const FULLSCREEN_REVEAL_BAND_PX = 72;
export const FULLSCREEN_RAIL_CORNER_FRACTION = 0.25;

/**
 * M14 fullscreen reading mode (decisions.md 2026-07-27): a *different* axis
 * from focus mode — focus mode hides your annotations, fullscreen hides the
 * app's chrome (top row, footer, rail), which become proximity-revealed
 * floating panels. Extracted verbatim from ReaderView.tsx (M19.8 refactor).
 *
 * The reveal setters are returned, not just the values: the reader's own
 * iframe-forwarded mousemove handler (still in ReaderView's book-loading
 * effect — see NOTES.md on why that effect isn't split this pass) computes
 * the same near-edge thresholds from iframe-relative coordinates and needs
 * to drive the same three flags when the cursor is *inside* the rendered
 * page rather than over the parent document.
 */
export function useFullscreenChrome(): {
  wrapperRef: RefObject<HTMLDivElement>;
  fullscreenMode: boolean;
  fullscreenModeRef: RefObject<boolean>;
  toggleFullscreen: () => void;
  revealTop: boolean;
  revealBottom: boolean;
  revealRail: boolean;
  revealActions: boolean;
  setRevealTop: Dispatch<SetStateAction<boolean>>;
  setRevealBottom: Dispatch<SetStateAction<boolean>>;
  setRevealRail: Dispatch<SetStateAction<boolean>>;
  setRevealActions: Dispatch<SetStateAction<boolean>>;
} {
  // `wrapperRef` is "the app root" the browser Fullscreen API is requested
  // on; degrades silently to an in-page-only fullscreen layout (ReaderView's
  // own fixed-position CSS) if refused.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [fullscreenMode, setFullscreenMode] = useState(false);
  const fullscreenModeRef = useRef(fullscreenMode);
  useEffect(() => {
    fullscreenModeRef.current = fullscreenMode;
  }, [fullscreenMode]);
  // Which floating chrome panel is currently revealed — set true by the
  // iframe-forwarded mousemove when the pointer nears its edge/corner, and
  // independently by the panel's own onPointerEnter/Leave once it's visible
  // enough to hover directly (see ReaderView's JSX). CSS :focus-within
  // handles the keyboard-reveal case without any JS at all.
  const [revealTop, setRevealTop] = useState(false);
  const [revealBottom, setRevealBottom] = useState(false);
  const [revealRail, setRevealRail] = useState(false);
  // M22.5: the reader's floating actions cluster (Digest/Scan/Publish),
  // revealed from the bottom-right corner — the mirror of the rail's
  // top-right corner reveal below.
  const [revealActions, setRevealActions] = useState(false);

  useEffect(() => {
    if (fullscreenMode) return;
    setRevealTop(false);
    setRevealBottom(false);
    setRevealRail(false);
    setRevealActions(false);
  }, [fullscreenMode]);

  // M14 fullscreen reveal, continued: the iframe-forwarded mousemove only
  // fires while the cursor is actually over the rendered page — it never
  // fires for the parent-document dead zone above/below/beside the iframe
  // (where the floating chrome itself lives before it's revealed, since
  // `pointer-events: none` on an unrevealed panel means it can't be the
  // thing that reveals itself). Found live: without this, hovering the
  // literal top edge of the screen from a "cold" state did nothing, and a
  // reveal triggered from inside the iframe never cleared once the cursor
  // left the iframe entirely (no further events to update it) — see
  // NOTES.md "M14". A plain window-level listener, active only in
  // fullscreen, covers exactly that gap with the same viewport-relative
  // thresholds as the iframe-forwarded path.
  useEffect(() => {
    if (!fullscreenMode) return;
    function handleWindowMouseMove(event: MouseEvent) {
      const nearTop = event.clientY < FULLSCREEN_REVEAL_BAND_PX;
      const nearBottom = event.clientY > window.innerHeight - FULLSCREEN_REVEAL_BAND_PX;
      const nearRailCorner =
        nearTop && event.clientX > window.innerWidth * (1 - FULLSCREEN_RAIL_CORNER_FRACTION);
      const nearActionsCorner =
        nearBottom && event.clientX > window.innerWidth * (1 - FULLSCREEN_RAIL_CORNER_FRACTION);
      setRevealTop((prev) => (prev === nearTop ? prev : nearTop));
      setRevealBottom((prev) => (prev === nearBottom ? prev : nearBottom));
      setRevealRail((prev) => (prev === nearRailCorner ? prev : nearRailCorner));
      setRevealActions((prev) => (prev === nearActionsCorner ? prev : nearActionsCorner));
    }
    window.addEventListener("mousemove", handleWindowMouseMove);
    return () => window.removeEventListener("mousemove", handleWindowMouseMove);
  }, [fullscreenMode]);

  const toggleFullscreen = useCallback(() => {
    setFullscreenMode((prev) => {
      const next = !prev;
      if (next) {
        // Can be refused (no user-gesture chain, or unsupported) — the
        // in-page fullscreen layout still applies either way; only the
        // browser's own chrome removal is lost.
        void wrapperRef.current?.requestFullscreen?.().catch(() => {});
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
    revealTop,
    revealBottom,
    revealRail,
    revealActions,
    setRevealTop,
    setRevealBottom,
    setRevealRail,
    setRevealActions,
  };
}
