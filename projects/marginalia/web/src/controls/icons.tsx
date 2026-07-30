/**
 * Small inline icons for the control kit's entry points (M19.7: "the Digest
 * and Scan entry points get their icons here"). Same shape as the reader's
 * existing `ChevronIcon` — plain inline SVG, `currentColor` stroke, no
 * icon-font dependency.
 */
interface IconProps {
  size?: number;
}

export function BrainIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4.5a2.5 2.5 0 0 0-2.5 2.5v.2A2.75 2.75 0 0 0 4 9.75v1a2.75 2.75 0 0 0 1 2.12v.63A3.5 3.5 0 0 0 8.5 17H9m0-12.5V17m0-12.5A2.5 2.5 0 0 1 11.5 7v10a2.5 2.5 0 0 1-2.5 2.5M9 4.5a2.5 2.5 0 0 1 2.5-2 2.5 2.5 0 0 1 2.5 2m1 0a2.5 2.5 0 0 1 2.5 2.5v.2A2.75 2.75 0 0 1 20 9.75v1a2.75 2.75 0 0 1-1 2.12v.63A3.5 3.5 0 0 1 15.5 17H15m0-12.5a2.5 2.5 0 0 0-2.5-2M15 4.5V17m0 0a2.5 2.5 0 0 1-2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MagnifierIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-4.8-4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
