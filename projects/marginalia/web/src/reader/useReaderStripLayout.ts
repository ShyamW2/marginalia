import { useEffect, useRef, useState } from "react";

// M24.7 §C, redone 2026-08-24: how much room the identity block (cover +
// title/author) needs before the strip drops to two rows. Below this, even
// a scrolling title/author is too cramped to be legible. First estimate —
// expect operator tuning live, same as the two static breakpoints (600px,
// then 720px) this replaced.
const MIN_IDENTITY_WIDTH_PX = 140;

/** Pure decision logic used by `measure()` below, pulled out so it's
 * unit-testable without a real `ResizeObserver` (jsdom has none — same
 * reasoning `pdfLayout.ts`'s `shouldShowSpread` and `readerGeometry.ts`
 * already follow for their own layout math).
 *
 * M42 §E: `containerRef` (below) is sized to the reading *pane*, so it
 * shrinks both when the tab/window shrinks (should restack — the case this
 * hook was built for) and when a sibling panel opens (`ThreadPanel`, the
 * margin rail) with the tab/window untouched (should **not** restack — found
 * live, decisions.md 2026-09-07). Both produce an identical `ResizeObserver`
 * signal on `container`, so telling them apart needs a second, independent
 * width: `window.innerWidth` only moves on an actual tab/window resize, never
 * on a sibling panel toggling. A transition is applied only when the window
 * width itself moved in the same direction as the transition — shrank for
 * stacking, grew for unstacking — so a panel open/close (window width
 * unchanged) leaves `stacked` exactly where it was, while a real tab/window
 * resize keeps restacking exactly as before this landed.
 * `priorWindowWidth === null` means "no prior measurement to compare
 * against" (first mount), in which case the pane measurement (`next`) wins
 * outright — what makes an already-narrow initial mount stack correctly. */
export function shouldRestack(params: {
  next: boolean;
  currentStacked: boolean;
  currentWindowWidth: number;
  priorWindowWidth: number | null;
}): boolean {
  const { next, currentStacked, currentWindowWidth, priorWindowWidth } = params;
  if (next === currentStacked) return currentStacked;
  const causedByWindow =
    priorWindowWidth === null ||
    (next ? currentWindowWidth < priorWindowWidth : currentWindowWidth > priorWindowWidth);
  return causedByWindow ? next : currentStacked;
}

/**
 * Decides when the reader's top strip (and the foot, kept in lockstep —
 * ReaderView.tsx applies the same result to both) no longer has room for one
 * line. Replaces a static `@container` pane-width breakpoint
 * (ReaderView.module.css `.stripGrid`'s comment has the full history): a
 * fixed threshold can't know how much of the pane a long title needs, so it
 * either stayed single-row too late (overlapping controls) or, tuned wider,
 * still overlapped whenever the title was long enough regardless of the
 * number chosen. `.topRowLeft`/`.topRowRight` hold functional controls and
 * are bare `auto` grid tracks (never compressed), so their measured width is
 * always their real, stable content need; what's left for the identity
 * block is simply `container - left - right`.
 *
 * Left/right are only re-measured while currently wide: once stacked,
 * `.topRowLeft` takes its own full-width row (ReaderView.module.css), and
 * its rendered width in that layout means something different (the whole
 * row) — re-measuring it there would feed a stale number back into the very
 * decision that produced the stacked layout in the first place.
 *
 * M42 §E: see `shouldRestack`'s own comment for why a window-width reading is
 * threaded through here (`windowWidthRef`) alongside the existing pane
 * measurement.
 */
export function useReaderStripLayout(
  containerRef: React.RefObject<HTMLElement | null>,
  leftRef: React.RefObject<HTMLElement | null>,
  rightRef: React.RefObject<HTMLElement | null>,
): boolean {
  const [stacked, setStacked] = useState(false);
  const stackedRef = useRef(stacked);
  const leftWidthRef = useRef(0);
  const rightWidthRef = useRef(0);
  const windowWidthRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!container || !left || !right) return;

    function measure() {
      const containerWidth = container!.getBoundingClientRect().width;
      if (!stackedRef.current) {
        leftWidthRef.current = left!.getBoundingClientRect().width;
        rightWidthRef.current = right!.getBoundingClientRect().width;
      }
      const available = containerWidth - leftWidthRef.current - rightWidthRef.current;
      const next = available < MIN_IDENTITY_WIDTH_PX;

      const currentWindowWidth = window.innerWidth;
      const priorWindowWidth = windowWidthRef.current;
      windowWidthRef.current = currentWindowWidth;

      const resolved = shouldRestack({ next, currentStacked: stackedRef.current, currentWindowWidth, priorWindowWidth });
      if (resolved !== stackedRef.current) {
        stackedRef.current = resolved;
        setStacked(resolved);
      }
    }

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(left);
    observer.observe(right);
    measure();
    return () => observer.disconnect();
  }, [containerRef, leftRef, rightRef]);

  return stacked;
}
