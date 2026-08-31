import type { Highlight } from "@marginalia/shared";

/**
 * M35 §C6: "one exported predicate, used everywhere" — the server-side half
 * of it (the client has its own sibling, `web/src/highlights/highlightOrigin.ts`,
 * same name and shape). `origin: 'thematic'` rows (§C5) must never appear
 * in the reader's highlight count, the Annotations list, or the vault
 * publish, unconditionally — see each call site's own comment for why that
 * holds regardless of §C7's show/hide toggle, which governs a different
 * question (whether they're *painted* in the reading surfaces).
 */
export function isReaderOrigin(highlight: Pick<Highlight, "origin">): boolean {
  return highlight.origin === "reader";
}
