/**
 * Pure text search for the SPEC anchoring rule's fallback step
 * (prefix+exact+suffix, then exact alone). No DOM involved, so it's shared
 * between the reader's client-side CFI-fallback anchoring
 * (web/src/reader/anchorResolution.ts) and the server's position-percent
 * resolver (server/src/annotations/position.ts) — one algorithm, not two
 * that could drift apart.
 */

export interface AnchorText {
  exact: string;
  prefix: string;
  suffix: string;
}

export interface TextMatch {
  start: number;
  end: number;
}

export function findAnchorInText(text: string, anchor: AnchorText): TextMatch | null {
  const combined = anchor.prefix + anchor.exact + anchor.suffix;
  const combinedIndex = text.indexOf(combined);
  if (combinedIndex !== -1) {
    const start = combinedIndex + anchor.prefix.length;
    return { start, end: start + anchor.exact.length };
  }

  const exactIndex = text.indexOf(anchor.exact);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + anchor.exact.length };
  }

  return null;
}
