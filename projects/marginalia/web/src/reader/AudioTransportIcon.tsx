/** Same stroke-icon language as ChevronIcon — the reader's transport
 * controls (M21) get their own small icon set rather than borrowing emoji,
 * which render inconsistently across platforms/fonts. */
interface AudioTransportIconProps {
  kind: "play" | "pause" | "skip-prev" | "skip-next" | "cast";
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
