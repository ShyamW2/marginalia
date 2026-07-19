import type { ShelfState } from "@marginalia/shared";

/** Small, deterministic string hash — good enough to seed a stable jitter, not for security. */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const COLUMN_WIDTH = 200;
const ROW_HEIGHT = 280;
const COLUMNS = 4;

/**
 * A book that's never been arranged has no `shelf` row yet — rather than
 * write one on every load (an unwanted PUT for a book nobody's touched),
 * compute a default position deterministically from its id, so the desk
 * looks the same across reloads until the reader actually drags it.
 */
export function defaultShelfState(resourceId: string, index: number): ShelfState {
  const hash = hashString(resourceId);
  const col = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  const jitterX = (hash % 41) - 20;
  const jitterY = ((hash >> 8) % 41) - 20;
  const rotation = ((hash >> 16) % 9) - 4;
  return {
    x: col * COLUMN_WIDTH + 32 + jitterX,
    y: row * ROW_HEIGHT + 32 + jitterY,
    rotation,
    zOrder: index,
  };
}
