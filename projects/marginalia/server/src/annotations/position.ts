import type Database from "better-sqlite3";
import { findAnchorInText, type AnchorText } from "@marginalia/shared";
import { getResourceTextSections } from "../library/store.js";

/**
 * The Scan's heat bands need a highlight's position as a 0-1 fraction of the
 * whole book, computed server-side so the scan loads without ever touching
 * epub.js (DESIGN.md: "no epub.js needed"). Locates the highlight's
 * prefix+exact+suffix within its own spine section (reusing the same
 * disambiguation rule as the reader's CFI-fallback anchoring — see
 * shared/src/anchorText.ts), then adds the char length of every earlier
 * section. Returns null if the text can no longer be found anywhere in the
 * book (same "unanchored" outcome the reader surfaces).
 *
 * The recorded `spineIndex` is trusted first (fast path), but isn't assumed
 * correct — a real, pre-M9 database was found with a handful of highlights
 * whose stored spineIndex doesn't match where their text actually lives
 * (off by one, likely a client-side timing artifact from the M3-era capture
 * code, not reproduced deterministically enough to chase down there). Rather
 * than silently dropping those highlights from the scan, fall back to
 * searching every section in spine order.
 */
export function computeHighlightPositionPercent(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
  anchor: AnchorText,
): number | null {
  const sections = getResourceTextSections(db, resourceId);
  if (sections.length === 0) return null;

  const totalLength = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (totalLength === 0) return null;

  function offsetWithin(target: (typeof sections)[number]): number | null {
    const match = findAnchorInText(target.text, anchor);
    if (!match) return null;
    const precedingLength = sections
      .filter((s) => s.spineIndex < target.spineIndex)
      .reduce((sum, s) => sum + s.text.length, 0);
    return precedingLength + match.start;
  }

  const claimed = sections.find((s) => s.spineIndex === spineIndex);
  const claimedOffset = claimed ? offsetWithin(claimed) : null;
  const globalOffset =
    claimedOffset ??
    sections
      .map((s) => offsetWithin(s))
      .find((offset): offset is number => offset !== null) ??
    null;

  if (globalOffset === null) return null;
  return Math.min(1, Math.max(0, globalOffset / totalLength));
}
