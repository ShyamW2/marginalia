import { describe, expect, it } from "vitest";
import { isSoftwareRendering } from "./gpu.js";

describe("isSoftwareRendering", () => {
  it("is false when every relevant feature is hardware-accelerated", () => {
    expect(
      isSoftwareRendering({
        gpu_compositing: "enabled",
        webgl: "enabled",
        webgl2: "enabled",
        opengl: "enabled_on",
        rasterization: "enabled",
      }),
    ).toBe(false);
  });

  it("is true when gpu_compositing has fallen back to software", () => {
    expect(isSoftwareRendering({ gpu_compositing: "disabled_software", webgl: "enabled" })).toBe(
      true,
    );
  });

  it("is true when webgl specifically is software-only", () => {
    expect(isSoftwareRendering({ gpu_compositing: "enabled", webgl: "unavailable_software" })).toBe(
      true,
    );
  });

  it("is true under --disable-gpu, where the driver is unavailable outright", () => {
    // Chromium's real strings under --disable-gpu.
    expect(
      isSoftwareRendering({
        gpu_compositing: "disabled_software",
        webgl: "unavailable_software",
        webgl2: "unavailable_software",
      }),
    ).toBe(true);
  });

  it("ignores features it doesn't care about", () => {
    // video_decode/video_encode falling back to software is not this app's
    // concern — only the features a WebGL canvas actually depends on are.
    expect(
      isSoftwareRendering({
        gpu_compositing: "enabled",
        webgl: "enabled",
        video_decode: "unavailable_software",
      }),
    ).toBe(false);
  });

  // Found live on a real MacBook Air: the first version of this function
  // also checked `opengl` and `rasterization`, and both false-positived on
  // fully accelerated hardware — degrading a real GPU to the 2D fallback.
  it("ignores opengl and rasterization — both legitimately report 'software'-ish on real, accelerated hardware", () => {
    expect(
      isSoftwareRendering({
        gpu_compositing: "enabled",
        webgl: "enabled",
        webgl2: "enabled",
        // macOS: Chromium runs WebGL through ANGLE-on-Metal, not native GL,
        // so opengl itself is legitimately off regardless of GPU health.
        opengl: "unavailable_off",
        // A compositor-tile detail, independent of whether WebGL itself is
        // accelerated.
        rasterization: "software",
      }),
    ).toBe(false);
  });

  it("is false against an empty status object", () => {
    expect(isSoftwareRendering({})).toBe(false);
  });
});
