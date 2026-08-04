/** Same stroke-icon language as ChevronIcon — the reader's transport
 * controls (M21) get their own small icon set rather than borrowing emoji,
 * which render inconsistently across platforms/fonts. */
interface AudioTransportIconProps {
  kind: "play" | "pause" | "skip-prev" | "skip-next";
  size?: number;
}

export function AudioTransportIcon({ kind, size = 16 }: AudioTransportIconProps) {
  if (kind === "play") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M7 5l12 7-12 7V5z" fill="currentColor" />
      </svg>
    );
  }
  if (kind === "pause") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
        <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
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
