import { ContextLadderToggle } from "@marginalia/web";

/*
 * The context ladder (settled decision 8, amended M17): how much of the book
 * goes with a question. "full" ships the whole resource, "digest" ships the
 * digest of the covering chapters plus surrounding pages — the same grounding
 * at a fraction of the tokens, and the default once a book has a digest.
 *
 * The toggle reads its current rung from
 * `GET /api/resources/:id/context-ladder`, stubbed per-resource by the
 * preview provider so each story shows a different rung.
 */
const frame: React.CSSProperties = {
  maxWidth: 420,
  padding: 12,
  borderRadius: 10,
  background: "var(--color-bg-raised)",
  border: "1px solid var(--color-border)",
};

const caption: React.CSSProperties = {
  margin: "0 0 8px",
  font: "500 12px var(--font-sans)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
};

/** A digested book: the ladder rests on "digest", the post-M17 default. */
export function DigestRung() {
  return (
    <div style={frame}>
      <p style={caption}>Context</p>
      <ContextLadderToggle resourceId="res-digest" />
    </div>
  );
}

/** The whole book — still one click away, and still the default for a book
 *  that has no digest yet. */
export function FullRung() {
  return (
    <div style={frame}>
      <p style={caption}>Context</p>
      <ContextLadderToggle resourceId="res-full" />
    </div>
  );
}

/** Grounding off: the passage alone goes with the question. */
export function OffRung() {
  return (
    <div style={frame}>
      <p style={caption}>Context</p>
      <ContextLadderToggle resourceId="res-off" />
    </div>
  );
}
