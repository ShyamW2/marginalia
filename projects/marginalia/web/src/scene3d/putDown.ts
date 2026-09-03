import { useSyncExternalStore } from "react";
import type { OverlayOrigin } from "../controls/overlayOrigin.js";
import type { DeskViewMode } from "../desk/deskViewBus.js";
import type { OpeningPose } from "./openingPose.js";

/**
 * M33 §C "the put-down": the reverse of this module's own sibling
 * `openingPose.ts`. There, a click knows everything up front and hands it to
 * a route that hasn't mounted yet — a one-shot pending value is enough. Here
 * the opposite is true: the *trigger* (the Desk button, Esc-while-reading,
 * the M31 §C touch departure) knows the book but not where it's going, and
 * the destination only exists once the Desk — or the shelf — has actually
 * mounted, in whichever view mode was last used, and laid its books out. So
 * this is a live, subscribable store (`departedBook.ts`'s own
 * `useSyncExternalStore` pattern), not a value read once at mount.
 */

export interface PutDownSnapshot {
  /** The reading pane's own rect, in viewport px, captured the instant the
   * departure began — what the closing spread starts pinned to, and stays
   * pinned to on a surface with nowhere further to send it. */
  stage: { x: number; y: number; width: number; height: number };
  paneAspect: number | null;
  spreadInset: { x: number; y: number } | null;
  /** Arrives asynchronously after the request (`pageSnapshot.ts`'s own
   * capture budget) — null until then, and null forever on a failed
   * capture, in which case the spread simply shows blank paper, exactly as
   * the opening's does. */
  spreadImage: string | null;
}

export interface PutDownDestination {
  origin: OverlayOrigin;
  /** Null from the list view, which has no 3D presentation to continue —
   * the put-down falls back to a crossfade, the same split the opening's
   * own `pose` makes (`BookOpening.tsx`'s `use3D`). */
  pose: OpeningPose | null;
}

interface PutDownState {
  resourceId: string | null;
  title: string;
  mode: DeskViewMode | null;
  snapshot: PutDownSnapshot | null;
  destination: PutDownDestination | null;
}

const EMPTY_STATE: PutDownState = {
  resourceId: null,
  title: "",
  mode: null,
  snapshot: null,
  destination: null,
};

let state: PutDownState = EMPTY_STATE;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Called by the departure trigger right before navigating home — names the
 * book and where the reader last left its own reading pane. `mode` is
 * whichever of desk/list/shelf the Desk is about to mount in (already
 * decided — `deskViewBus.ts` — by the time this is called), so the put-down
 * knows without waiting whether a 3D destination is even possible. */
export function requestPutDown(
  resourceId: string,
  title: string,
  mode: DeskViewMode,
  snapshot: Omit<PutDownSnapshot, "spreadImage">,
): void {
  state = { resourceId, title, mode, snapshot: { ...snapshot, spreadImage: null }, destination: null };
  notify();
}

/** The snapshot capture (`pageSnapshot.ts`) resolves after the request — a
 * no-op if a newer request has already superseded this one. */
export function reportPutDownSnapshotImage(resourceId: string, image: string | null): void {
  if (state.resourceId !== resourceId || !state.snapshot) return;
  state = { ...state, snapshot: { ...state.snapshot, spreadImage: image } };
  notify();
}

/** Called by whichever surface is currently rendering `resourceId` on the
 * Desk (`BookObject`, `ShelfView`) once it has a real pose to offer — a
 * no-op unless this resource is the one being asked for, and unless nothing
 * has answered yet (first report wins; only one surface is ever mounted for
 * a given resource at a time, so this is a safety net, not a real race). */
export function reportPutDownDestination(resourceId: string, destination: PutDownDestination): void {
  if (state.resourceId !== resourceId || state.destination) return;
  state = { ...state, destination };
  notify();
}

/** The put-down landed, or was abandoned. */
export function clearPutDown(): void {
  if (state.resourceId === null) return;
  state = EMPTY_STATE;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PutDownState {
  return state;
}

export function usePutDownRequest(): PutDownState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
