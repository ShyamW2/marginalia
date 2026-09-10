import { app } from "electron";
import { isSoftwareRendering } from "./gpu.js";

/**
 * Live check: `getGPUFeatureStatus()`'s per-feature strings (`gpu.ts`),
 * corroborated by `getGPUInfo('basic')`'s `auxAttributes.softwareRendering`
 * boolean where available — the two can disagree on edge cases (a machine
 * with GPU compositing on but WebGL specifically blacklisted), and either
 * one saying "software" is enough to take the degraded path. Must run after
 * `app.whenReady()`.
 *
 * ⚠️ Logs its raw inputs and which signal (if either) fired. `gpu.ts`'s
 * `isSoftwareRendering()` already over-included two features once and
 * degraded real, accelerated hardware — found live, on a Mac, not in a
 * test. This is the single startup line that would have made that a
 * one-round-trip fix instead of several: the next false positive, on
 * whatever machine, is diagnosable from the terminal `pnpm electron` was
 * run in, without another guess.
 */
export async function detectSoftwareRendering(): Promise<boolean> {
  const featureStatus = app.getGPUFeatureStatus() as unknown as Record<string, string>;
  const fromFeatureStatus = isSoftwareRendering(featureStatus);

  let auxSoftwareRendering = false;
  let gpuInfo: unknown;
  try {
    const info = (await app.getGPUInfo("basic")) as {
      auxAttributes?: { softwareRendering?: boolean };
    };
    auxSoftwareRendering = Boolean(info?.auxAttributes?.softwareRendering);
  } catch {
    // Left false — see the doc comment on the boolean-only path this mirrors.
  }
  // A second, deliberately separate call: 'complete' carries the actual GPU
  // device/driver/vendor Chromium found (what chrome://gpu shows), which
  // 'basic' doesn't. Logged raw and unfiltered — this is a debugging aid for
  // a real, live false-positive (gpu_compositing/webgl disabled on hardware
  // that should have neither disabled), not something to parse in code.
  try {
    gpuInfo = await app.getGPUInfo("complete");
  } catch (error) {
    gpuInfo = { error: error instanceof Error ? error.message : String(error) };
  }

  const result = fromFeatureStatus || auxSoftwareRendering;
  // eslint-disable-next-line no-console
  console.log(
    "[gpu] verdict",
    JSON.stringify({ softwareRendering: result, fromFeatureStatus, auxSoftwareRendering }),
  );
  // eslint-disable-next-line no-console
  console.log("[gpu] featureStatus", JSON.stringify(featureStatus));
  // eslint-disable-next-line no-console
  console.log("[gpu] info(complete)", JSON.stringify(gpuInfo));
  return result;
}
