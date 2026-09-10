/**
 * M45 (DESKTOP.md §7.1b): whether the window is rendering WebGL in software
 * (Chromium's SwiftShader fallback on a machine with no usable GPU driver).
 * `app.getGPUFeatureStatus()` only exists in Electron's main process, so the
 * flag crosses into the server the same way `resolveResourceDir()` crosses
 * `resourcesPath` (DESKTOP.md §3.2/§7): an env var set on the forked
 * `utilityProcess`, read once at server startup, and returned from
 * `GET /api/health` — no preload bridge, no new networking, the same
 * same-origin fetch every other API call already makes.
 *
 * A plain browser tab never sets that env var, so `/api/health` always
 * answers `false` there and this flag changes nothing about the browser
 * product — it is Electron's missing trigger for `Scene3D.tsx`'s existing
 * `canRender` gate, not a new path (settled decision 14).
 *
 * Fetched once, like `appearanceSync.ts`'s settings fetch, so mounting
 * `Scene3DProvider` costs one request, not one per consumer.
 */
let inFlight: Promise<boolean> | null = null;

export function fetchSoftwareRendering(): Promise<boolean> {
  if (!inFlight) {
    inFlight = fetch("/api/health")
      .then((res) => (res.ok ? (res.json() as Promise<{ softwareRendering?: boolean }>) : null))
      .then((body) => Boolean(body?.softwareRendering))
      .catch(() => false);
  }
  return inFlight;
}

/** Testing seam, same convention as `resetAppearanceSettingsCache`. */
export function resetSoftwareRenderingCache(): void {
  inFlight = null;
}
