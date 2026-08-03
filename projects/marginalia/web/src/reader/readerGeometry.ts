/**
 * Pure stage-geometry math for the reader: the `gap` epub.js is told to
 * render with, and which edge zone a point falls in for click-to-turn.
 * Extracted verbatim from ReaderView.tsx (M19.8 refactor) — behaviour
 * unchanged, only the location moved, so this file's tests characterize
 * what the reader already did.
 */
import type { ReaderMargin, SpreadMode } from "@marginalia/shared";

// M12 two-page spread: epub.js's own layout.js falls back from "auto" to a
// single column below this stage width — mirrored here (not read back from
// epub.js) so the *gap* strategy (a measure cap for one page vs. a narrow
// book-spine gutter for two) can be chosen consistently with whatever
// epub.js is about to do at the same width.
export const SPREAD_MIN_WIDTH = 960;

// The same `gap` value becomes both leaves' native CSS column-gap — this is
// deliberately independent of readerMargin (decisions.md 2026-07-27: "the
// spine gutter in spread mode is independently visible and unchanged by the
// margin setting").
export const SPREAD_GUTTER = 64;

export const READER_TARGET_COLUMN_WIDTH = 520; // ~70ch at 16px body text (Bringhurst range)

// M14 (decisions.md 2026-07-27): the outer edge margin used to be gap's job
// too (M11), but epub.js derives *both* the outer edge padding and the
// inter-leaf column gap from that single number — so a spread's spine
// gutter and the single-page edge margin were forced to share one value.
// The outer margin now lives on a padded wrapper *around* the element
// epub.js renders into (containerRef itself stays padding-free, since
// epub.js sizes the stage from it — see ReaderView's marginWrapper div);
// gap's only remaining job is capping the single-page measure at a
// comfortable width and, in spread mode, being the book-spine gutter.
export const READER_MARGIN_PX: Record<ReaderMargin, number> = {
  narrow: 24, // 1.5rem
  normal: 40, // 2.5rem — matches the old fixed M11 edge padding
  wide: 64, // 4rem
  generous: 96, // 6rem
};

// Shared by click-to-turn and the M11 semicircular turn-zone hover/cursor —
// the outer 30% of the visible page on either side.
export const TURN_ZONE_FRACTION = 0.3;

// M16 "reading text size": READER_TARGET_COLUMN_WIDTH is "~70ch at 16px" —
// that stops being true the moment fontScale != 1, so the target column
// width must scale with it (decisions.md 2026-07-28) or the measure drifts
// out of the 60-75ch band as text grows/shrinks. fontScale doesn't affect
// the spread-mode gutter (SPREAD_GUTTER stays a fixed physical spine width).
export function computeReaderGap(
  containerWidth: number,
  spreadMode: SpreadMode,
  fontScale: number,
): number {
  if (spreadMode === "auto" && containerWidth >= SPREAD_MIN_WIDTH) {
    return SPREAD_GUTTER;
  }
  return Math.max(containerWidth - READER_TARGET_COLUMN_WIDTH * fontScale, 0);
}

/** Which edge zone (if any) a point translated into container-space falls
 * in — shared by the click handler and the hover/cursor handler. */
export function turnZoneForVisibleX(
  visibleX: number,
  containerWidth: number,
): "prev" | "next" | null {
  if (visibleX < containerWidth * TURN_ZONE_FRACTION) return "prev";
  if (visibleX > containerWidth * (1 - TURN_ZONE_FRACTION)) return "next";
  return null;
}

export interface LeafRect {
  x: number;
  width: number;
  height: number;
}

/**
 * M20 "spread-aware": in two-page mode the fold must peel the **near leaf
 * only**, not the whole stage (decisions.md 2026-07-20 — "leaf-relative").
 * Mirrors the same `spreadMode`/`SPREAD_MIN_WIDTH` decision epub.js's own
 * layout makes (see `computeReaderGap` above) so the leaf split agrees with
 * whatever epub.js actually rendered at this width, without reading it back
 * — hence `contentWidth`, which is the element epub.js renders into
 * (`.epubContainer`) and the only width that decision may be made on.
 *
 * **The leaf is the paper card, not the text column** (2026-08-02, step 2):
 * `cardWidth`/`cardHeight` are `.pageClip`'s box — the whole sheet, reader
 * margin included — so the margin folds with the page instead of the sheet
 * reading as a rectangle pasted inside it. In card space the spread splits
 * exactly down the middle: each leaf carries its own outer margin and half
 * the spine gutter, and `cardWidth / 2` lands on the gutter's centre line
 * because the two margins are equal (`.marginWrapper`'s padding).
 */
export function nearLeafRect(
  cardWidth: number,
  cardHeight: number,
  contentWidth: number,
  spreadMode: SpreadMode,
  direction: "prev" | "next",
): LeafRect {
  if (spreadMode === "auto" && contentWidth >= SPREAD_MIN_WIDTH) {
    const leafWidth = cardWidth / 2;
    return { x: direction === "next" ? leafWidth : 0, width: leafWidth, height: cardHeight };
  }
  return { x: 0, width: cardWidth, height: cardHeight };
}
