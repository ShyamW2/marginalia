import fs from "node:fs";

/**
 * Window-state persistence (M45's "window-state persistence" bullet). Kept
 * free of any Electron import so the geometry logic — the part with actual
 * bugs to have — is testable with plain fixtures; `main.ts` is the only
 * place that touches `BrowserWindow`, `screen`, or `app.getPath`.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends Rect {
  isMaximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = {
  x: 0,
  y: 0,
  width: 1280,
  height: 860,
  isMaximized: false,
};

/** Below this, the window is a sliver rather than a workspace — guards
 * against a corrupt or hand-edited state file, not just an off-screen one. */
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

function isFiniteRect(value: unknown): value is Rect {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.x === "number" &&
    typeof r.y === "number" &&
    typeof r.width === "number" &&
    typeof r.height === "number" &&
    [r.x, r.y, r.width, r.height].every(Number.isFinite)
  );
}

/** Reads a previously saved state, or the default if there is none, it's
 * unreadable, or it doesn't look like a rectangle — never throws. */
export function loadWindowState(filePath: string): WindowState {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isFiniteRect(raw)) return DEFAULT_WINDOW_STATE;
    return {
      x: raw.x,
      y: raw.y,
      width: Math.max(raw.width, MIN_WIDTH),
      height: Math.max(raw.height, MIN_HEIGHT),
      isMaximized: Boolean((raw as { isMaximized?: unknown }).isMaximized),
    };
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

export function saveWindowState(filePath: string, state: WindowState): void {
  fs.writeFileSync(filePath, JSON.stringify(state));
}

/** True when at least a corner of `rect` lands inside `bounds` — the
 * standard "is this window at all reachable" test, used per-display below. */
function overlaps(rect: Rect, bounds: Rect): boolean {
  return (
    rect.x < bounds.x + bounds.width &&
    rect.x + rect.width > bounds.x &&
    rect.y < bounds.y + bounds.height &&
    rect.y + rect.height > bounds.y
  );
}

/**
 * A saved position can point at a display that's no longer attached — a
 * laptop undocked from an external monitor, most commonly. Falls back to
 * the default position (top-left of the primary display) rather than
 * restoring a window nobody can see or click.
 */
export function clampToDisplays(state: WindowState, displayBounds: Rect[]): WindowState {
  const onScreen = displayBounds.some((bounds) => overlaps(state, bounds));
  if (onScreen) return state;
  return { ...DEFAULT_WINDOW_STATE, isMaximized: state.isMaximized };
}
