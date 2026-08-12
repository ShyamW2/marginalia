import { useEffect, useRef, useState } from "react";

/**
 * Watching whether the API is actually there (M22.6 F).
 *
 * The server and Vite are separate processes. When the server dies — a native-module
 * failure, a crash, a terminal closed by accident — Vite carries on serving, the whole
 * UI renders, and only the API calls fail. The app looks like it is running. `/api/health`
 * has existed since M17.5 and nothing has ever called it; this is what calls it.
 *
 * ⚠️ The hard requirement is *not flapping*. `tsx watch` restarts the server on every
 * source edit, and a banner that blinks during normal development is worse than no
 * banner at all, because it trains you to ignore the one time it matters. Hence
 * consecutive failures before reporting down, and an immediate clear on the first
 * success.
 */

/** How often to ask, in ms. */
const POLL_INTERVAL_MS = 3000;
/** A single miss is a watch-restart; two in a row, 3s apart, is a dead server. */
const FAILURES_BEFORE_DOWN = 2;
/** A hung request must count as a failure rather than stalling the poll loop. */
const REQUEST_TIMEOUT_MS = 2500;

async function ping(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch("/api/health", {
      signal: controller.signal,
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns true once the server has missed `FAILURES_BEFORE_DOWN` consecutive checks.
 * Recovers on the first success, so a restarted server clears the banner without a
 * reload.
 */
export function useServerHealth(): boolean {
  const [down, setDown] = useState(false);
  // A ref rather than state: the streak is loop bookkeeping, and re-rendering on every
  // successful poll (once every 3s, forever) would be a pointless render.
  const failures = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Polling a backgrounded tab buys nothing — and returning to a tab whose server
      // died while hidden gets its answer on the next tick anyway.
      if (document.hidden) return;

      const ok = await ping();
      if (cancelled) return;

      if (ok) {
        failures.current = 0;
        setDown(false);
        return;
      }
      failures.current += 1;
      if (failures.current >= FAILURES_BEFORE_DOWN) setDown(true);
    }

    void check();
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return down;
}
