import { useEffect, useState } from "react";
import { onAirlock } from "./airlockBus.js";
import styles from "./AirlockOverlay.module.css";

/**
 * Mounted once at the app shell (App.tsx), outside <Routes> so it survives
 * navigation. The Book <-> Scan "airlock" (DESIGN.md): "out" dims/desaturates
 * and brings scanlines in; "in" (called by the destination page on mount)
 * fades them back out to reveal the newly landed room. Callers pass
 * `durationMs: 0` under reduced motion (each page reads its own
 * `useReducedMotion()`) — the module's `prefers-reduced-motion` media query
 * is a second, independent guard in case a caller ever forgets.
 */
export function AirlockOverlay() {
  const [covering, setCovering] = useState(false);
  const [durationMs, setDurationMs] = useState(360);

  useEffect(() => {
    return onAirlock((direction, duration) => {
      setDurationMs(duration);
      setCovering(direction === "out");
    });
  }, []);

  return (
    <div
      aria-hidden="true"
      className={covering ? `${styles.overlay} ${styles.covering}` : styles.overlay}
      style={{ ["--airlock-duration" as string]: `${durationMs}ms` }}
    />
  );
}
