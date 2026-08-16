import type Database from "better-sqlite3";
import type { AnchorText } from "@marginalia/shared";
import { getResourceTextSections } from "../library/store.js";
import { buildSectionOffsetIndex, locateAnchor } from "./sectionOffsets.js";

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
 *
 * A single-lookup convenience over `locateAnchor` (M24 TASKS.md B): fetches
 * and indexes the book's sections itself, which is fine for one call but
 * wasteful for many — the Scan and search build the index once and call
 * `locateAnchor` directly instead of this.
 */
export function computeHighlightPositionPercent(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
  anchor: AnchorText,
): number | null {
  const sections = getResourceTextSections(db, resourceId);
  if (sections.length === 0) return null;

  const index = buildSectionOffsetIndex(sections);
  if (index.totalLength === 0) return null;

  return locateAnchor(index, spineIndex, anchor)?.percent ?? null;
}
