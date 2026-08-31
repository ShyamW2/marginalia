/**
 * Small inline icons for the control kit's entry points (M19.7: "the Digest
 * and Scan entry points get their icons here"). Same shape as the reader's
 * existing `ChevronIcon` — plain inline SVG, `currentColor` stroke, no
 * icon-font dependency.
 */
interface IconProps {
  size?: number;
}

/** M24.7 A: the digest cluster's job state is a ring around this icon
 * rather than a width-changing button label — same 0–1 `progress` fraction
 * and arc technique as `TrayIcon` below, just sized to sit around the
 * brain's own silhouette instead of inside a circle glyph. */
export function BrainIcon({ size = 18, progress }: IconProps & { progress?: number | null }) {
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4.5a2.5 2.5 0 0 0-2.5 2.5v.2A2.75 2.75 0 0 0 4 9.75v1a2.75 2.75 0 0 0 1 2.12v.63A3.5 3.5 0 0 0 8.5 17H9m0-12.5V17m0-12.5A2.5 2.5 0 0 1 11.5 7v10a2.5 2.5 0 0 1-2.5 2.5M9 4.5a2.5 2.5 0 0 1 2.5-2 2.5 2.5 0 0 1 2.5 2m1 0a2.5 2.5 0 0 1 2.5 2.5v.2A2.75 2.75 0 0 1 20 9.75v1a2.75 2.75 0 0 1-1 2.12v.63A3.5 3.5 0 0 1 15.5 17H15m0-12.5a2.5 2.5 0 0 0-2.5-2M15 4.5V17m0 0a2.5 2.5 0 0 1-2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {progress != null && (
        <circle
          cx="12"
          cy="12"
          r={radius}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
          transform="rotate(-90 12 12)"
          opacity="0.85"
        />
      )}
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

/** The transport triangle — shared so "Listen" means the same glyph on the
 * desk card (BookObject) and the reader's transport (AudioTransportIcon's
 * "play", which delegates here rather than keeping a second copy). */
export function PlayIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 5l12 7-12 7V5z" fill="currentColor" />
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

// M22.5 (decisions.md 2026-08-04 "the gear does not look like a gear, and
// it is worse than that"): the previous GearIcon was a circle with eight
// radial ticks — the same drawing as SunIcon at a different radius, two
// slots away in the same cluster. A real cog: a toothed outer profile
// (eight stubby rectangles, not thin rays, so the silhouette reads
// differently from SunIcon's rays even at 18px) around a hollow centre.
const GEAR_TEETH_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

export function GearIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {GEAR_TEETH_DEG.map((deg) => (
        <rect
          key={deg}
          x="11.1"
          y="1.7"
          width="1.8"
          height="3.6"
          rx="0.5"
          fill="currentColor"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="6.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** M20.6 "the tasks tray", redrawn M22.5 (decisions.md 2026-08-04): the
 * original was an inbox with a down-arrow — a downloads icon, for
 * something that is not downloads, and (per the same pass) a shape the new
 * `PublishIcon` risked colliding with. An activity ring instead: its filled
 * arc is the running jobs' aggregate progress, so the icon carries the
 * state the badge next to it carries alone today. `progress` is a 0–1
 * fraction; omitted (nothing running, or nothing reports a total) draws
 * just the inactive ring. */
export function TrayIcon({ size = 18, progress }: IconProps & { progress?: number | null }) {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r={radius} stroke="currentColor" strokeWidth="1.6" opacity="0.3" />
      {progress != null && (
        <circle
          cx="12"
          cy="12"
          r={radius}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
          transform="rotate(-90 12 12)"
        />
      )}
    </svg>
  );
}

/** M22.5: the reader's floating actions cluster needs an icon for
 * "publish to the vault" that doesn't reuse the retired `TrayIcon`'s
 * inbox-with-an-arrow shape (a plain arrow into a container reads as the
 * same archive glyph). A cardboard carton — visible splayed flaps and a
 * three-quarter body, not a flat rectangle, so it reads as a parcel — with
 * an arrow entering from the left: packing what you've learned into it. */
export function PublishIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 11h12v7.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M6 11 3.4 7.3 10 6.3 12 11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 11 20.6 7.3 14 6.3 12 11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M0.8 14.6h5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="M3.9 12.4 7 14.6 3.9 16.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** M24.7 A: the nav pebble's Scan entry needs its own glyph, distinct from
 * the plain magnifier now that "search" and "scan" are separate icons in
 * the same pebble — bars inside a rounded frame, echoing the heat strip
 * Scan actually opens (READER_REDESIGN.md §5). Borrowed one step ahead of
 * §E's full magnifier split, which owns the rest of that work. */
export function ScanIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.5 15V9M12 16.5V7.5M16.5 13.5v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** M30 E2: the thread panel's own delete affordance. A trash can rather than
 * a second "×" in the same panel — the header already has one meaning
 * "collapse this thread", and a lookalike glyph a few rows below it, meaning
 * "destroy it", is exactly the ambiguity a delete control can't afford. */
export function TrashIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 7h14M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7M7.5 7l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4L16.5 7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10.3 10.5v6M13.7 10.5v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** M24.7 §F: the web-search control's narrow-width glyph — a globe, not a
 * new metaphor invented for this milestone (READER_REDESIGN.md §4 names it
 * directly). Circle plus one equator and two meridians reads as "globe" at
 * icon size without needing a graticule. Restyled only; the control stays
 * inert until M25 builds the seam (settled decision 10). */
/** M34 §B6: the lookahead/spoilers toggle's narrow-width glyph — a plain
 * open eye, same "currentColor" stroke convention as every other icon here. */
export function EyeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function GlobeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.5 12h17M12 3.5c2.6 2.3 4 5.3 4 8.5s-1.4 6.2-4 8.5c-2.6-2.3-4-5.3-4-8.5s1.4-6.2 4-8.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** M24.7 B: the foot's instruments pebble needs a fullscreen glyph —
 * `toggleFullscreen` (`f`) has existed since M14 but was never rendered
 * as a button anywhere until now. Four corner brackets opening outward. */
export function FullscreenIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9V4h5M20 15v5h-5M20 9V4h-5M4 15v5h5"
        stroke="currentColor"
        strokeWidth="1.8"
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
