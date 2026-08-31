import type { Highlight } from "@marginalia/shared";

/**
 * M35 §C6: "one exported predicate, used everywhere" — the client-side half
 * (the server has its own sibling, `server/src/annotations/highlightOrigin.ts`,
 * same name and shape). `origin: 'thematic'` rows (§C5) must never appear in
 * the reader's highlight count or the Annotations list, unconditionally —
 * regardless of §C7's show/hide toggle, which only governs whether they're
 * *painted* as marks in the reading surfaces (a separate question, already
 * answered server-side before `highlights` state is ever fetched).
 */
export function isReaderOrigin(highlight: Pick<Highlight, "origin">): boolean {
  return highlight.origin === "reader";
}
