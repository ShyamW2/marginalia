/**
 * M31 §0h: the iPad-only page-snapshot bug (curl/slide/opening rendering at
 * ~2x, cropped, with black bands — TASKS.md M31 §0f–0h) is a geometry
 * mismatch somewhere between `pageSnapshot.rasterize` and
 * `cardSnapshot.composeCardSnapshot`, confirmed absent on the Mac. Rather
 * than guess which stage diverges, both stages log their numbers here (DEV
 * only) and stash their intermediate PNG so a Mac console and an iPad
 * console (reached from the Mac via Safari's Develop menu, over the same
 * Tailscale tunnel the app itself uses) can be compared side by side.
 *
 * `window.__marginaliaSnapshotDebug.rasterizeDataUrl` /
 * `.composedDataUrl` — paste either into a new tab's address bar to view the
 * intermediate bitmap; a black or oversized result on one device and not the
 * other is the "which stage" answer the task is after.
 */
export interface SnapshotDebugDump {
  rasterizeDataUrl?: string;
  composedDataUrl?: string;
}

declare global {
  interface Window {
    __marginaliaSnapshotDebug?: SnapshotDebugDump;
  }
}

export function recordSnapshotDebug(patch: SnapshotDebugDump): void {
  window.__marginaliaSnapshotDebug = { ...window.__marginaliaSnapshotDebug, ...patch };
}
