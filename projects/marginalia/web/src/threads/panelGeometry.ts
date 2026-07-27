/** Small, deterministic string hash — good enough to seed a stable jitter,
 * not for security. Same pattern as the desk's shelfDefaults.ts. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * M14 sticky-note tilt (decisions.md 2026-07-27): "a deterministic 0.5-1.5°
 * tilt derived from the highlight id so it never jitters between renders" —
 * derived once per highlight, never randomized, so re-renders (and reopening
 * the same highlight later) always land on the same angle.
 */
export function panelTiltDeg(highlightId: string): number {
  const hash = hashString(highlightId);
  const magnitude = 0.5 + (hash % 100) / 100; // 0.5-1.5°
  const sign = hash & 1 ? 1 : -1;
  return magnitude * sign;
}

/**
 * Pulls a rect back inside a bounding rect by the smallest amount necessary,
 * expressed as an adjustment to the (dx, dy) offset that produced it — used
 * both to keep a live drag inside the stage and to clamp a persisted offset
 * that's gone stale (the stage resized, the margin setting changed, etc.)
 * back into view on reopen.
 */
export function clampPanelOffset(
  panelRect: { left: number; right: number; top: number; bottom: number },
  stageRect: { left: number; right: number; top: number; bottom: number },
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  let clampedDx = dx;
  let clampedDy = dy;
  if (panelRect.left < stageRect.left) clampedDx += stageRect.left - panelRect.left;
  if (panelRect.right > stageRect.right) clampedDx -= panelRect.right - stageRect.right;
  if (panelRect.top < stageRect.top) clampedDy += stageRect.top - panelRect.top;
  if (panelRect.bottom > stageRect.bottom) clampedDy -= panelRect.bottom - stageRect.bottom;
  return { dx: clampedDx, dy: clampedDy };
}
