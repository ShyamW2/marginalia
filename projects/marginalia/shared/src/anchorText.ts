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

/**
 * Collapses every run of whitespace (including newlines) to a single space,
 * recording each normalized character's index in the original string so a
 * match found in the normalized text can be mapped back.
 */
function collapseWhitespaceWithMap(text: string): { normalized: string; indexMap: number[] } {
  let normalized = "";
  const indexMap: number[] = [];
  let previousWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!previousWasSpace) {
        normalized += " ";
        indexMap.push(i);
      }
      previousWasSpace = true;
    } else {
      normalized += ch;
      indexMap.push(i);
      previousWasSpace = false;
    }
  }
  return { normalized, indexMap };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
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

  // Whitespace-insensitive fallback: a block-level tag (e.g. `<br>`) can be
  // extracted server-side as a literal "\n" where the same passage's live
  // DOM selection captured only a space (or vice versa) — found live
  // against a real book where this exact mismatch made the M9 scan drop
  // otherwise-perfectly-findable highlights. Collapsing whitespace on both
  // sides before searching recovers those without weakening the exact-match
  // fast path above (byte-for-byte still wins when it works).
  const { normalized, indexMap } = collapseWhitespaceWithMap(text);
  const normalizedPrefix = collapseWhitespace(anchor.prefix);
  const normalizedExact = collapseWhitespace(anchor.exact);
  if (normalizedExact.length === 0) return null;
  const normalizedSuffix = collapseWhitespace(anchor.suffix);

  function mapMatch(normStart: number, normEnd: number): TextMatch {
    const start = indexMap[normStart];
    const end = normEnd < indexMap.length ? indexMap[normEnd] : text.length;
    return { start, end };
  }

  const normalizedCombined = normalizedPrefix + normalizedExact + normalizedSuffix;
  const normCombinedIndex = normalized.indexOf(normalizedCombined);
  if (normCombinedIndex !== -1) {
    const exactStart = normCombinedIndex + normalizedPrefix.length;
    return mapMatch(exactStart, exactStart + normalizedExact.length);
  }

  const normExactIndex = normalized.indexOf(normalizedExact);
  if (normExactIndex !== -1) {
    return mapMatch(normExactIndex, normExactIndex + normalizedExact.length);
  }

  return null;
}
