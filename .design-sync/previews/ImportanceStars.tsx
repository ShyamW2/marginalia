import { useState } from "react";
import { ImportanceStars } from "@marginalia/web";

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "4px 0",
  font: "400 13px var(--font-sans)",
  color: "var(--color-text-muted)",
};

/** The full 0–3 scale, so the filled/empty treatment is legible at a glance.
 *  Importance is what the Scan's heat field and the revisit queue rank on. */
export function Scale() {
  return (
    <div>
      {([0, 1, 2, 3] as const).map((v) => (
        <div key={v} style={row}>
          <ImportanceStars value={v} onChange={() => {}} />
          <span>{v === 0 ? "unrated" : `${v} of 3`}</span>
        </div>
      ))}
    </div>
  );
}

/** `size="small"` is the dense form used inline in the margin rail; `medium`
 *  is the annotations overview. */
export function Sizes() {
  return (
    <div>
      <div style={row}>
        <ImportanceStars value={2} onChange={() => {}} size="small" />
        <span>small</span>
      </div>
      <div style={row}>
        <ImportanceStars value={2} onChange={() => {}} size="medium" />
        <span>medium</span>
      </div>
    </div>
  );
}

/** Interactive: the rating is a controlled value. */
export function Interactive() {
  const [value, setValue] = useState<0 | 1 | 2 | 3>(2);
  return (
    <div style={row}>
      <ImportanceStars value={value} onChange={(v) => setValue(v as 0 | 1 | 2 | 3)} />
      <span>Rate this highlight</span>
    </div>
  );
}
