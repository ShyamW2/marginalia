/**
 * M18 "the digest instrument: bigger timeline, and the torch" (decisions.md
 * 2026-07-29 later). Pure helpers so the torch's drag math is testable
 * without a browser — the DOM-heavy parts (DigestSpotlight.tsx) just call
 * these.
 */

export interface ChapterExtent {
  startPercent: number;
  lengthPercent: number;
}

/** Which chapter a fraction (0-1) along the timeline falls in. Clamped —
 * a fraction outside [0, 1] (the torch can be dragged past either end)
 * resolves to the first/last chapter rather than -1/length. */
export function chapterIndexAtFraction(chapters: ChapterExtent[], fraction: number): number {
  if (chapters.length === 0) return 0;
  if (fraction <= 0) return 0;
  for (let i = 0; i < chapters.length; i++) {
    if (fraction < chapters[i]!.startPercent + chapters[i]!.lengthPercent) return i;
  }
  return chapters.length - 1;
}

const MIN_HALF_WIDTH = 0.03;
const MAX_HALF_WIDTH = 0.5;
/** px of vertical drag per unit of half-width fraction — dragging up
 * (negative dy) widens the beam, per the task's "beam width set by
 * dragging up/down". */
const WIDTH_DRAG_SENSITIVITY = 400;

export function beamHalfWidthFromDrag(baseHalfWidth: number, dragStartY: number, currentY: number): number {
  const delta = (dragStartY - currentY) / WIDTH_DRAG_SENSITIVITY;
  return Math.min(MAX_HALF_WIDTH, Math.max(MIN_HALF_WIDTH, baseHalfWidth + delta));
}

export interface BeamRange {
  startFraction: number;
  endFraction: number;
}

export function beamRange(center: number, halfWidth: number): BeamRange {
  const start = Math.max(0, center - halfWidth);
  const end = Math.min(1, center + halfWidth);
  return { startFraction: start, endFraction: end };
}

/** The beam's center/half-width implied by an already-chosen chapter range
 * — the inverse of committing a drag, used to keep the torch in sync when
 * FROM/TO change via the selects instead. */
export function beamFromChapterRange(chapters: ChapterExtent[], startIdx: number, endIdx: number): BeamRange {
  if (chapters.length === 0) return { startFraction: 0, endFraction: 1 };
  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);
  const start = chapters[lo]!.startPercent;
  const end = chapters[hi]!.startPercent + chapters[hi]!.lengthPercent;
  return { startFraction: start, endFraction: end };
}
