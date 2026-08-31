import { findAnchorInText, type AnchorText } from "@marginalia/shared";
import type { ResourceTextSection } from "../library/store.js";

/**
 * Section text plus each section's running length total, computed once from
 * a `getResourceTextSections` call the caller already made. `computeHighlight-
 * PositionPercent` used to call `getResourceTextSections` itself on every
 * invocation, so building the Scan re-read the whole book once per highlight
 * (M24 TASKS.md B); building this once and passing it to `locateAnchor` is
 * the fix, and search (which needs the same table for hundreds of hits) is
 * the other consumer.
 */
export interface SectionOffsetIndex {
  sections: ResourceTextSection[]; // sorted by spineIndex
  totalLength: number;
  precedingLength: Map<number, number>; // spineIndex -> char length of every earlier section
}

export function buildSectionOffsetIndex(sections: ResourceTextSection[]): SectionOffsetIndex {
  const sorted = [...sections].sort((a, b) => a.spineIndex - b.spineIndex);
  const precedingLength = new Map<number, number>();
  let cursor = 0;
  for (const section of sorted) {
    precedingLength.set(section.spineIndex, cursor);
    cursor += section.text.length;
  }
  return { sections: sorted, totalLength: cursor, precedingLength };
}

export interface LocatedAnchor {
  spineIndex: number;
  /** Char offset local to its section's own text — the domain `resource_text` stores. */
  offset: number;
  /** M35 §A3: length of the located match, so a caller storing `offset` can
   * store the matching `length` (`highlights.length`) without a second pass. */
  length: number;
  globalOffset: number;
  percent: number;
}

/**
 * Locates `anchor` in the book, trusting `spineIndex` first and falling back
 * to every section in spine order — same rule as the highlight fallback path
 * this shares its logic with (see position.ts's history for why the fallback
 * exists: a pre-M9 database was found with a handful of stale spineIndexes).
 */
export function locateAnchor(
  index: SectionOffsetIndex,
  spineIndex: number,
  anchor: AnchorText,
): LocatedAnchor | null {
  function tryIn(section: ResourceTextSection): LocatedAnchor | null {
    const match = findAnchorInText(section.text, anchor);
    if (!match) return null;
    const preceding = index.precedingLength.get(section.spineIndex) ?? 0;
    const globalOffset = preceding + match.start;
    return {
      spineIndex: section.spineIndex,
      offset: match.start,
      length: match.end - match.start,
      globalOffset,
      percent: index.totalLength > 0 ? Math.min(1, Math.max(0, globalOffset / index.totalLength)) : 0,
    };
  }

  const claimed = index.sections.find((s) => s.spineIndex === spineIndex);
  const claimedHit = claimed ? tryIn(claimed) : null;
  if (claimedHit) return claimedHit;

  for (const section of index.sections) {
    const hit = tryIn(section);
    if (hit) return hit;
  }
  return null;
}
