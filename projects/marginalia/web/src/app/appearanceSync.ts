import type { Settings, SettingsUpdate } from "@marginalia/shared";

/**
 * M44 (DESKTOP.md §3.4): theme, accent, paper tint and desk view mode used
 * to live only in `localStorage`, which Chromium keys by origin — a
 * desktop launch that fell back off its preferred port got a new origin and
 * forgot its own appearance every time. The sidecar `settings` table is now
 * the durable copy; `localStorage` stays as each hook's instant-paint cache
 * for the common case where the port didn't move, reconciled against the
 * server once per page load.
 *
 * `fetchAppearanceSettings` is shared (not one call per hook) so mounting
 * `useTheme`, `useAccent` and `usePaperTint` together — as `App.tsx` does —
 * costs one `GET /api/settings`, not three.
 */
let inFlight: Promise<Settings | null> | null = null;

export function fetchAppearanceSettings(): Promise<Settings | null> {
  if (!inFlight) {
    inFlight = fetch("/api/settings")
      .then((res) => (res.ok ? (res.json() as Promise<Settings>) : null))
      .catch(() => null);
  }
  return inFlight;
}

/** Testing seam: each hook's own module-level cache should start clean per
 * test, and a real settings change should be reflected on the next fetch
 * rather than serving a page-load-old response forever. */
export function resetAppearanceSettingsCache(): void {
  inFlight = null;
}

/** Best-effort write-through: a failed PUT leaves the change live in this
 * tab (already applied from local state) and in `localStorage`, just not
 * yet durable server-side — it will be retried in effect by the next
 * successful write, and reconciliation never regresses a tab's own change
 * because it only adopts the server's value on mount, not continuously. */
export function pushAppearanceSetting(update: SettingsUpdate): void {
  fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  }).catch(() => {
    // See doc comment above — silently best-effort.
  });
}
