import type { RawTextItem } from "./types.js";

const FULL_WIDTH_FRACTION = 0.7;
const MIN_GAP_FRACTION = 0.05;
const MIN_MODE_FRACTION = 0.25;
/** Left edges within this many points are treated as the same column edge —
 *  paragraph indents and kerning noise, not a second column. */
const EDGE_CLUSTER_TOLERANCE = 3;

export interface ColumnDetection {
  twoColumn: boolean;
  column1Left: number;
  column2Left: number;
}

function isFullWidth(item: RawTextItem, pageWidth: number): boolean {
  return item.width > pageWidth * FULL_WIDTH_FRACTION;
}

/** PDF.md §3.2 steps 1–2: bimodal left-edge histogram, ≥5% page-width gap,
 *  each mode holding ≥25% of the page's (non-full-width) items. */
export function detectColumns(items: RawTextItem[], pageWidth: number): ColumnDetection {
  const candidates = items.filter((item) => !isFullWidth(item, pageWidth));
  const single: ColumnDetection = { twoColumn: false, column1Left: 0, column2Left: 0 };
  if (candidates.length === 0) return single;

  // Cluster left edges within EDGE_CLUSTER_TOLERANCE into edge groups.
  const sorted = [...candidates].sort((a, b) => a.x - b.x);
  const groups: { edge: number; count: number }[] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && item.x - last.edge <= EDGE_CLUSTER_TOLERANCE) {
      last.count += 1;
    } else {
      groups.push({ edge: item.x, count: 1 });
    }
  }
  if (groups.length < 2) return single;

  // Largest gap between consecutive edge groups that clears the page-width
  // threshold — the candidate column boundary.
  let bestGapIndex = -1;
  let bestGap = 0;
  for (let i = 0; i < groups.length - 1; i++) {
    const gap = groups[i + 1].edge - groups[i].edge;
    if (gap > bestGap) {
      bestGap = gap;
      bestGapIndex = i;
    }
  }
  if (bestGapIndex === -1 || bestGap < pageWidth * MIN_GAP_FRACTION) return single;

  const leftGroups = groups.slice(0, bestGapIndex + 1);
  const rightGroups = groups.slice(bestGapIndex + 1);
  const leftCount = leftGroups.reduce((sum, g) => sum + g.count, 0);
  const rightCount = rightGroups.reduce((sum, g) => sum + g.count, 0);
  const total = leftCount + rightCount;
  if (leftCount / total < MIN_MODE_FRACTION || rightCount / total < MIN_MODE_FRACTION) {
    return single;
  }

  return {
    twoColumn: true,
    column1Left: Math.min(...leftGroups.map((g) => g.edge)),
    column2Left: Math.min(...rightGroups.map((g) => g.edge)),
  };
}

function nearestColumn(item: RawTextItem, detection: ColumnDetection): 1 | 2 {
  const d1 = Math.abs(item.x - detection.column1Left);
  const d2 = Math.abs(item.x - detection.column2Left);
  return d2 < d1 ? 2 : 1;
}

/** Sort within a column: descending y (top to bottom), then ascending x
 *  (left to right) — PDF.md §3.2 step 3. */
function readingOrder(a: RawTextItem, b: RawTextItem): number {
  if (a.y !== b.y) return b.y - a.y;
  return a.x - b.x;
}

/**
 * Orders a page's items into reading order. Single column: everything in
 * y-then-x order. Two columns: full-width items (title blocks, abstracts,
 * spanning figures) break the column model (§3.2 ⚠️) and are threaded
 * through in y-order at their own position — banding the page into
 * above/between/below regions around each full-width item, column-sorting
 * the non-full-width items within each band.
 */
export function orderPageItems(items: RawTextItem[], pageWidth: number): RawTextItem[] {
  if (items.length === 0) return [];

  const fullWidth = items
    .filter((item) => isFullWidth(item, pageWidth))
    .sort((a, b) => b.y - a.y);
  const rest = items.filter((item) => !isFullWidth(item, pageWidth));

  if (fullWidth.length === 0) {
    const detection = detectColumns(rest, pageWidth);
    return orderNonFullWidth(rest, detection);
  }

  // Band the page at each full-width item's y: [above] fw [between] fw [below].
  const detection = detectColumns(rest, pageWidth);
  const boundaries = fullWidth.map((f) => f.y);
  const ordered: RawTextItem[] = [];
  let previousY = Infinity;
  for (let i = 0; i <= fullWidth.length; i++) {
    const bandFloor = i < boundaries.length ? boundaries[i] : -Infinity;
    const band = rest.filter((item) => item.y < previousY && item.y >= bandFloor);
    ordered.push(...orderNonFullWidth(band, detection));
    if (i < fullWidth.length) {
      ordered.push(fullWidth[i]);
      previousY = fullWidth[i].y;
    }
  }
  return ordered;
}

function orderNonFullWidth(items: RawTextItem[], detection: ColumnDetection): RawTextItem[] {
  if (!detection.twoColumn) return [...items].sort(readingOrder);
  const col1 = items.filter((item) => nearestColumn(item, detection) === 1).sort(readingOrder);
  const col2 = items.filter((item) => nearestColumn(item, detection) === 2).sort(readingOrder);
  return [...col1, ...col2];
}
