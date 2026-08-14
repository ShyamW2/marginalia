import { useSyncExternalStore } from "react";

/**
 * Which book has left its surface and is currently being drawn by the opening
 * instead (M23 §E).
 *
 * ## Why a store and not a prop
 *
 * The Desk and the shelf keep rendering *after their room has unmounted* while
 * the opening holds their layer on the canvas (`Scene3D.tsx`'s
 * `useScene3DHold`) — that is what keeps the room underneath the travelling
 * book. Nothing above those components can re-render them any more: their
 * props were fixed at the moment their room went away. So the one thing that
 * still has to change about them — *the clicked book is no longer here, the
 * opening has it* — has to arrive from the side, through a subscription they
 * own themselves.
 *
 * Without it the book is drawn twice: once flying out of the desk, once still
 * lying on it.
 *
 * ⚠️ **The opening declares this, not the click.** It is set when the 3D
 * opening actually starts drawing the book and cleared when it stops, so the
 * object is never in neither place — a click-time set would blank the book for
 * however many frames the route change takes, which is exactly the blink the
 * pose handoff exists to avoid.
 */
let departed: string | null = null;
const listeners = new Set<() => void>();

export function setDepartedBook(resourceId: string | null): void {
  if (departed === resourceId) return;
  departed = resourceId;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string | null {
  return departed;
}

/** The resource id the surface must not draw right now, if any. */
export function useDepartedBook(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
