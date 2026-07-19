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
 * section. Returns null if the section is missing or the text can no longer
 * be found (same "unanchored" outcome the reader surfaces).
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

  const target = sections.find((s) => s.spineIndex === spineIndex);
  if (!target) return null;

  const match = findAnchorInText(target.text, anchor);
  if (!match) return null;

  const precedingLength = sections
    .filter((s) => s.spineIndex < spineIndex)
    .reduce((sum, s) => sum + s.text.length, 0);

  const globalOffset = precedingLength + match.start;
  return Math.min(1, Math.max(0, globalOffset / totalLength));
}
