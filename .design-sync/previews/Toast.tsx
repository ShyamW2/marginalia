import { Toast } from "@marginalia/web";

/*
 * Toast is `position: fixed`. Cards render it inside a transformed wrapper,
 * which becomes the containing block for fixed descendants — so it lands in
 * the card rather than escaping to the page viewport. Each story gets a
 * stage tall enough for the toast to sit in its real resting place.
 */
const stage: React.CSSProperties = {
  position: "relative",
  height: 150,
  borderRadius: 10,
  background: "var(--color-bg)",
  border: "1px dashed var(--color-border)",
  overflow: "hidden",
};

/** The default: bottom-anchored, success tone — what a publish or import
 *  confirmation looks like. */
export function Success() {
  return (
    <div style={stage}>
      <Toast message="Published 14 notes to your vault" onDismiss={() => {}} />
    </div>
  );
}

/** The error tone. Same shape, `--color-danger` treatment. */
export function Error() {
  return (
    <div style={stage}>
      <Toast message="Couldn't reach the server — retrying" tone="error" onDismiss={() => {}} />
    </div>
  );
}

/** `position="top"` exists for the reader, where the default bottom placement
 *  would collide with the footer pagination bar. */
export function TopPosition() {
  return (
    <div style={stage}>
      <Toast message="Highlight saved" tone="success" position="top" onDismiss={() => {}} />
    </div>
  );
}
