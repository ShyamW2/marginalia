import { app } from "electron";
import { isSoftwareRendering } from "./gpu.js";

/**
 * Live check: `getGPUFeatureStatus()`'s per-feature strings (`gpu.ts`),
 * corroborated by `getGPUInfo('basic')`'s `auxAttributes.softwareRendering`
 * boolean where available — the two can disagree on edge cases (a machine
 * with GPU compositing on but WebGL specifically blacklisted), and either
 * one saying "software" is enough to take the degraded path. Must run after
 * `app.whenReady()`.
 */
export async function detectSoftwareRendering(): Promise<boolean> {
  const featureStatus = app.getGPUFeatureStatus() as unknown as Record<string, string>;
  if (isSoftwareRendering(featureStatus)) return true;
  try {
    const info = (await app.getGPUInfo("basic")) as {
      auxAttributes?: { softwareRendering?: boolean };
    };
    return Boolean(info?.auxAttributes?.softwareRendering);
  } catch {
    return false;
  }
}
