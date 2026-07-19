export type AirlockDirection = "in" | "out";

const EVENT = "marginalia:airlock";

interface AirlockDetail {
  direction: AirlockDirection;
  durationMs: number;
  resolve: () => void;
}

/**
 * The Book <-> Scan "airlock" transition (DESIGN.md: "the lights change").
 * A single overlay is mounted once at the app shell (`AirlockOverlay`);
 * callers anywhere (ReaderPage's "Scan" button, a heat band's click) just
 * await `playAirlock("out")` before navigating and `playAirlock("in")` isn't
 * needed by the caller — the destination page's own mount is the "in" half,
 * driven by `AirlockOverlay` reacting to route changes isn't necessary since
 * each side plays its own half explicitly (see ScanPage/ReaderPage).
 * A plain DOM CustomEvent instead of React context/state so any component
 * can trigger it without prop-drilling through the route tree.
 */
export function playAirlock(direction: AirlockDirection, durationMs = 360): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve();
      return;
    }
    window.dispatchEvent(
      new CustomEvent<AirlockDetail>(EVENT, { detail: { direction, durationMs, resolve } }),
    );
  });
}

export function onAirlock(
  handler: (direction: AirlockDirection, durationMs: number) => void,
): () => void {
  function listener(event: Event) {
    const { direction, durationMs, resolve } = (event as CustomEvent<AirlockDetail>).detail;
    handler(direction, durationMs);
    window.setTimeout(resolve, durationMs);
  }
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
