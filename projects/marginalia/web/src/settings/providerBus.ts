const EVENT = "marginalia:provider-roles-saved";

/**
 * M19: the provider picker is mounted in three places at once (a settings
 * binder tab per role, the scan's digest slider, the reader's query icon) —
 * "switching a role from any surface is reflected immediately in the
 * others" (TASKS.md acceptance). Same plain DOM CustomEvent pattern as
 * settingsBus.ts, so a change made in one mounted instance tells every other
 * instance to refetch, without prop-drilling through three unrelated route
 * trees.
 */
export function emitProviderRolesSaved(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onProviderRolesSaved(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
