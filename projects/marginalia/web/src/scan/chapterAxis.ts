import type { ScanChapter } from "@marginalia/shared";

// M15 "handle the crowded case by thinning labels, not overlapping them":
// the tick mark for every chapter always renders, but a label only renders
// if it lands at least this many px from the last *shown* label. Names need
// more room than plain numbers.
export const MIN_LABEL_GAP_NUMBERS_PX = 30;
export const MIN_LABEL_GAP_NAMES_PX = 90;

export function chapterLabelText(chapter: ScanChapter, showNames: boolean): string {
  if (showNames && chapter.title) return chapter.title;
  return String(chapter.chapterNumber);
}

/** Which chapters get a *visible label* at a given strip width — every
 * chapter still gets a tick mark regardless. Greedy left-to-right: keep a
 * chapter's label if it's far enough from the last one that was kept. Pure
 * function of (chapters, width, mode) — no DOM/ResizeObserver needed to test it. */
export function thinLabels(
  chapters: ScanChapter[],
  stripWidthPx: number,
  showNames: boolean,
): Set<number> {
  const minGap = showNames ? MIN_LABEL_GAP_NAMES_PX : MIN_LABEL_GAP_NUMBERS_PX;
  const shown = new Set<number>();
  let lastPx = Number.NEGATIVE_INFINITY;
  for (const chapter of chapters) {
    if (chapter.startPercent <= 0) continue;
    const px = chapter.startPercent * stripWidthPx;
    if (px - lastPx >= minGap) {
      shown.add(chapter.spineIndex);
      lastPx = px;
    }
  }
  return shown;
}
