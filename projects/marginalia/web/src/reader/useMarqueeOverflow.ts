import { useEffect, useRef, useState, type CSSProperties } from "react";

// A constant crawl speed rather than a fixed duration — a barely-clipped
// line (e.g. one extra character) shouldn't take as long to reveal as a
// badly-clipped one (a whole subtitle). Both first estimates, expect
// operator tuning live (2026-08-24, the reader-strip identity redesign).
const MARQUEE_PX_PER_SECOND = 34;
const MARQUEE_MIN_DURATION_S = 3;

interface MarqueeOverflow {
  /** Whether the text is genuinely clipped and the marquee should animate. */
  scrolling: boolean;
  /** `--marquee-distance`/`--marquee-duration` for ReaderView.module.css's `.scrolling`. */
  style: CSSProperties;
}

/**
 * Detects whether `innerRef`'s text overflows `outerRef`'s box and, if so,
 * how far and how long the ping-pong scroll (ReaderView.module.css
 * `.scrolling`/`@keyframes readerTitleMarquee`) needs to run to reveal all
 * of it. `outerRef` is the fixed-size clipping viewport (`.title`/
 * `.author`); `innerRef` is the text span inside it that actually
 * translates. Re-measures on either box's resize, not just on `deps`
 * changing — the identity block's own available width moves with the pane
 * even when the book (and so the text) doesn't.
 */
export function useMarqueeOverflow(
  outerRef: React.RefObject<HTMLElement | null>,
  innerRef: React.RefObject<HTMLElement | null>,
  deps: readonly unknown[],
): MarqueeOverflow {
  const [state, setState] = useState<{ scrolling: boolean; distance: number }>({
    scrolling: false,
    distance: 0,
  });

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    function measure() {
      const overflow = Math.round(inner!.scrollWidth - outer!.clientWidth);
      setState((prev) => {
        if (overflow > 1) {
          return prev.scrolling && prev.distance === overflow ? prev : { scrolling: true, distance: overflow };
        }
        return prev.scrolling ? { scrolling: false, distance: 0 } : prev;
      });
    }

    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measures on the caller's own deps (the text itself) in addition to the ResizeObserver
  }, [outerRef, innerRef, ...deps]);

  const duration = Math.max(MARQUEE_MIN_DURATION_S, state.distance / MARQUEE_PX_PER_SECOND);

  return {
    scrolling: state.scrolling,
    style: state.scrolling
      ? ({
          "--marquee-distance": `-${state.distance}px`,
          "--marquee-duration": `${duration.toFixed(2)}s`,
        } as CSSProperties)
      : {},
  };
}
