/**
 * DESKTOP.md §7.1b: Chromium falls back to SwiftShader — software WebGL —
 * on a machine with a missing or blacklisted GPU driver, and says nothing.
 * The shelf and the fold then run at a few frames per second with no error
 * anywhere. `app.getGPUFeatureStatus()` (called from `gpuDetect.ts`, which
 * needs the real Electron runtime) is the answer; this is the pure
 * classification over it, kept in its own module with no Electron import so
 * it's testable with plain fixture objects rather than a real GPU process.
 *
 * Chromium's status strings for the 3D-relevant features consistently
 * contain "software" when they've fallen back (`"disabled_software"`,
 * `"unavailable_software"`, `"software_only_for_hardware_protected_content"`)
 * and do not otherwise — so a substring match across the keys that matter to
 * a WebGL canvas is a direct read of the thing this exists to detect, not a
 * guess.
 */
export function isSoftwareRendering(featureStatus: Record<string, string>): boolean {
  const relevant = [
    featureStatus.gpu_compositing,
    featureStatus.webgl,
    featureStatus.webgl2,
    featureStatus.opengl,
    featureStatus.rasterization,
  ];
  return relevant.some((value) => typeof value === "string" && /software/i.test(value));
}
