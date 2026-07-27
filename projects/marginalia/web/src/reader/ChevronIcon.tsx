interface ChevronIconProps {
  direction: "left" | "right";
  size?: number;
}

export function ChevronIcon({ direction, size = 18 }: ChevronIconProps) {
  const d = direction === "left" ? "M14 5l-6 7 6 7" : "M10 5l6 7-6 7";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
