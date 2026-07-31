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

/**
 * M19.7 "the nav bar becomes a floating cluster": the three icons that
 * replace the old text header (library/settings/theme).
 */
export function LibraryIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 9 21H5.5A1.5 1.5 0 0 1 4 19.5v-14Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 4h3A1.5 1.5 0 0 1 18 5.5v14a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 12 19.5v-14A1.5 1.5 0 0 1 13.5 4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m20.2 6.1 1.6 13.4a1.5 1.5 0 0 1-1.31 1.67l-1.24.15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GearIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 3.5v2.1m0 12.8v2.1m8.5-8.5h-2.1M5.6 12H3.5m13.06-6.56-1.49 1.49M8.93 15.07l-1.49 1.49m0-9.12 1.49 1.49m6.63 6.63 1.49 1.49"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SunIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2.5v2.3m0 14.4v2.3M4.2 12H1.9m20.2 0h-2.3M5.6 5.6l1.6 1.6m9.6 9.6 1.6 1.6m0-12.8-1.6 1.6M7.2 16.8l-1.6 1.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoonIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.2A8.5 8.5 0 1 1 9.8 4a6.8 6.8 0 0 0 10.2 10.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CircleHalfIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
    </svg>
  );
}
