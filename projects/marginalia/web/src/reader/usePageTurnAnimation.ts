import { useCallback, useRef, useState, type RefObject } from "react";
import type { Rendition } from "epubjs";
import {
  animate,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
} from "motion/react";
import { capturePageSnapshot } from "./pageSnapshot.js";

/**
 * The reader's page-turn animation: the M7 dip-and-recover slide, the M10
 * snapshot-based 3D curl it upgrades to, and the drag-to-peel gesture that
 * drives the same curl by hand. Extracted verbatim from ReaderView.tsx
 * (M19.8 refactor) — this is the seam M20's paper-fold work operates on.
 *
 * Owns its own animation state (curl progress, the current snapshot, the
 * turn lock, the low-fps downgrade) — callers only need a rendition and the
 * container epub.js renders into.
 */
export function usePageTurnAnimation(
  renditionRef: RefObject<Rendition | null>,
  containerRef: RefObject<HTMLDivElement | null>,
): {
  stageControls: ReturnType<typeof useAnimationControls>;
  stageReducedMotion: boolean | null;
  curl: { src: string; direction: "prev" | "next" } | null;
  curlProgress: MotionValue<number>;
  turnPage: (direction: "prev" | "next") => Promise<void>;
  handleEdgePointerDown: (
    direction: "prev" | "next",
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
} {
  const stageControls = useAnimationControls();
  const stageReducedMotion = useReducedMotion();
  // M10 page curl: guards against overlapping turns (rapid key/gesture
  // repeats), the live curl progress (0 = flat, 1 = fully turned) driven
  // either imperatively or by a pointer drag, and a device that's proven
  // too slow to keep the curl at a real frame rate.
  const turnLockRef = useRef(false);
  const lowFpsRef = useRef(false);
  const curlProgress = useMotionValue(0);
  const [curl, setCurl] = useState<{ src: string; direction: "prev" | "next" } | null>(
    null,
  );

  // M7's dip-and-recover slide — kept as the fallback under reduced motion,
  // when a curl's snapshot capture fails, and (via lowFpsRef below) once the
  // curl has proven itself too slow on this device.
  const turnPageSlide = useCallback(
    async (direction: "prev" | "next") => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      if (stageReducedMotion) {
        if (direction === "prev") rendition.prev();
        else rendition.next();
        return;
      }
      const dx = direction === "next" ? -6 : 6;
      await stageControls.start({
        opacity: 0.55,
        x: dx,
        transition: { duration: 0.09, ease: "easeOut" },
      });
      if (direction === "prev") rendition.prev();
      else rendition.next();
      await stageControls.start({
        opacity: 1,
        x: 0,
        transition: { duration: 0.13, ease: "easeOut" },
      });
    },
    [stageControls, stageReducedMotion],
  );

  // M10's snapshot-based 3D curl (DESIGN.md "the epub.js constraint"): the
  // departing page is rasterized to a bitmap (pageSnapshot.ts) that curls
  // away on its own 3D plane — the marks-pane SVG overlay rides along for
  // free because it's baked into the same texture (it's a DOM sibling of
  // the iframe inside the captured container, not inside the iframe — see
  // NOTES.md M2/M3 friction). The live DOM underneath is swapped to the new
  // page *before* the curl plays, hidden behind the snapshot, so "swap to
  // live DOM on settle" (TASKS.md) falls out of the overlay's own fade —
  // no separate snapshot of the incoming page is needed.
  const turnPageCurl = useCallback(
    async (direction: "prev" | "next") => {
      const rendition = renditionRef.current;
      const container = containerRef.current;
      if (!rendition || !container) return;

      const src = await capturePageSnapshot(container);
      if (!src) {
        await turnPageSlide(direction);
        return;
      }

      curlProgress.set(0);
      setCurl({ src, direction });

      if (direction === "prev") await rendition.prev();
      else await rendition.next();
      // Let epub.js actually paint the new section before revealing it —
      // the snapshot is still covering the stage at full opacity.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const frameTimestamps: number[] = [];
      await animate(curlProgress, 1, {
        duration: 0.42,
        ease: [0.4, 0, 0.2, 1],
        onUpdate: () => {
          frameTimestamps.push(performance.now());
        },
      });
      setCurl(null);

      if (frameTimestamps.length > 2) {
        const span =
          frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0];
        const avgFrameMs = span / (frameTimestamps.length - 1);
        // ~30fps or worse, sustained through a full turn — stop paying for
        // snapshot capture + a 3D transform and use the cheap slide instead.
        if (avgFrameMs > 33) lowFpsRef.current = true;
      }
    },
    [curlProgress, turnPageSlide],
  );

  const turnPage = useCallback(
    async (direction: "prev" | "next") => {
      if (turnLockRef.current) return;
      turnLockRef.current = true;
      try {
        if (stageReducedMotion || lowFpsRef.current) {
          await turnPageSlide(direction);
        } else {
          await turnPageCurl(direction);
        }
      } finally {
        turnLockRef.current = false;
      }
    },
    [stageReducedMotion, turnPageSlide, turnPageCurl],
  );

  // Stretch: drag-to-peel. Grabbing the page's edge (a thin strip, not the
  // wider 30% click-turn zones inside the iframe content) tracks the
  // pointer's horizontal movement into curlProgress directly, live; release
  // either commits the turn (animating the rest of the way) or springs back
  // to flat. Shares curlProgress/curl/turnLockRef with the click-triggered
  // curl above — same visual, driven a different way.
  const handleEdgePointerDown = useCallback(
    (direction: "prev" | "next", event: React.PointerEvent<HTMLDivElement>) => {
      if (turnLockRef.current || stageReducedMotion) return;
      const container = containerRef.current;
      const activeRendition = renditionRef.current;
      if (!container || !activeRendition) return;

      // Without this, the drag's pointermove/up events are only guaranteed
      // to reach this handler while the pointer stays over the 18px grab
      // strip — the moment the drag crosses into the epub.js iframe next to
      // it (the whole point of a page-edge drag gesture), the browser hands
      // raw pointer events to that iframe's own document instead. Found live
      // (NOTES.md M10): with a real Chromium pointer drag, that leaked into
      // epub.js's sandboxed (`allow-scripts` intentionally absent —
      // `allowScriptedContent: false`) content in a way that crashed the
      // tab outright, not just misbehaved. Capturing the pointer keeps every
      // event routed to this element regardless of where the cursor
      // physically travels, same as native drag/resize handles.
      event.currentTarget.setPointerCapture(event.pointerId);

      turnLockRef.current = true;
      const startX = event.clientX;
      const stageWidth = container.getBoundingClientRect().width || 1;
      const dragRange = Math.max(stageWidth * 0.6, 120);
      let src: string | null = null;

      capturePageSnapshot(container).then((snapshot) => {
        src = snapshot;
        if (snapshot) {
          curlProgress.set(0);
          setCurl({ src: snapshot, direction });
        }
      });

      const onMove = (moveEvent: PointerEvent) => {
        if (!src) return;
        const dx = moveEvent.clientX - startX;
        const raw = direction === "next" ? -dx : dx;
        curlProgress.set(Math.min(Math.max(raw / dragRange, 0), 1));
      };

      const onUp = async () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);

        const shouldCommit = src !== null && curlProgress.get() > 0.35;
        if (shouldCommit) {
          if (direction === "prev") await activeRendition.prev();
          else await activeRendition.next();
          await animate(curlProgress, 1, { duration: 0.16, ease: "easeOut" });
        } else if (src !== null) {
          await animate(curlProgress, 0, { duration: 0.18, ease: "easeOut" });
        }
        setCurl(null);
        turnLockRef.current = false;
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [curlProgress, stageReducedMotion],
  );

  return { stageControls, stageReducedMotion, curl, curlProgress, turnPage, handleEdgePointerDown };
}
