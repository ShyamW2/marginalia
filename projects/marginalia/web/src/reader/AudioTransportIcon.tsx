import { PlayIcon } from "../controls/icons.js";

/** Same stroke-icon language as ChevronIcon — the reader's transport
 * controls (M21) get their own small icon set rather than borrowing emoji,
 * which render inconsistently across platforms/fonts. */
interface AudioTransportIconProps {
  kind: "play" | "pause" | "skip-prev" | "skip-next" | "cast" | "stop" | "locate" | "play-from";
  size?: number;
}

export function AudioTransportIcon({ kind, size = 16 }: AudioTransportIconProps) {
  // M22 "Casting UI" trigger: two overlapping speaker silhouettes — distinct
  // from the transport triangle/bars at a glance, still one stroke language.
  if (kind === "cast") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="3.5" fill="currentColor" />
        <path d="M3.5 19c0-3.6 2.5-6 5.5-6s5.5 2.4 5.5 6" fill="currentColor" />
        <circle cx="17" cy="8" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12.8 19c0-2.9 1.9-5 4.2-5s4.2 2.1 4.2 5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (kind === "play") {
    return <PlayIcon size={size} />;
  }
  if (kind === "pause") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
        <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
      </svg>
    );
  }
  // M22.6 C "leave playback without leaving the book": a real stop, distinct
  // from pause — the square is the universal-enough signal that this ends
  // the session rather than just holding it.
  if (kind === "stop") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
      </svg>
    );
  }
  // M22.6 C "back to the voice": a locate/target glyph — re-centring on
  // where the sounding sentence actually is, the same language a map's
  // "find me" control uses.
  if (kind === "locate") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="3" fill="currentColor" />
        <path
          d="M12 3v3.5M12 17.5V21M3 12h3.5M17.5 12H21"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  // M22.6 C "play from here": an arrow feeding into the transport's own
  // play triangle, distinguishing "start at this sentence" from the plain
  // play/pause toggle it sits beside in the pill.
  if (kind === "play-from") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M2.5 12h5.5M5 8.5l4 3.5-4 3.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M13 6l9 6-9 6V6z" fill="currentColor" />
      </svg>
    );
  }
  const flip = kind === "skip-prev";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d="M5 5l9 7-9 7V5z" fill="currentColor" />
      <rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}
