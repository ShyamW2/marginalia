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

  it("is false against an empty status object", () => {
    expect(isSoftwareRendering({})).toBe(false);
  });
});
