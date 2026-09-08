import { describe, expect, it } from "vitest";
import { DEFAULT_KIND_LABELS, hoverFillOpacity, kindLabelsFromSettings, markStyleForKind } from "./highlightKinds.js";

describe("kindLabelsFromSettings", () => {
  it("passes through a fully-set bag unchanged", () => {
    expect(
      kindLabelsFromSettings({
        kindLabelRose: "Banger",
        kindLabelSage: "Define",
        kindLabelHoney: "Key quote",
        kindLabelSlate: "Thematic Question",
      }),
    ).toEqual({ rose: "Banger", sage: "Define", honey: "Key quote", slate: "Thematic Question" });
  });

  it("falls back to the default name for any cleared ('') slot, never a blank", () => {
    expect(
      kindLabelsFromSettings({
        kindLabelRose: "",
        kindLabelSage: "Define",
        kindLabelHoney: "",
        kindLabelSlate: "Thematic Question",
      }),
    ).toEqual({
      rose: DEFAULT_KIND_LABELS.rose,
      sage: "Define",
      honey: DEFAULT_KIND_LABELS.honey,
      slate: "Thematic Question",
    });
  });
});

describe("markStyleForKind's `active` flag (M43 §A corrective)", () => {
  const vars = { kindColors: { rose: "#ff0000", sage: "#00ff00", honey: "#ffff00", slate: "#0000ff" }, colorScheme: "light" as const };

  it("lifts fill-opacity to hoverFillOpacity strength, same kind colour, still blended", () => {
    const resting = markStyleForKind("honey", vars);
    const active = markStyleForKind("honey", vars, false, true);
    expect(active.fill).toBe(resting.fill);
    expect(active.style).toBe(resting.style);
    expect(Number(active["fill-opacity"])).toBeGreaterThan(Number(resting["fill-opacity"]));
    expect(active["fill-opacity"]).toBe(String(hoverFillOpacity("light")));
  });

  it("defaults to inactive when the parameter is omitted, and hidden still wins over active", () => {
    expect(markStyleForKind("rose", vars)).toEqual(markStyleForKind("rose", vars, false, false));
    expect(markStyleForKind("rose", vars, true, true)).toEqual({ fill: "transparent", "fill-opacity": "0" });
  });

  it("uses the dark-mode hover strength and screen blend on ink, same as an active mark's resting style would", () => {
    const darkVars = { ...vars, colorScheme: "dark" as const };
    const active = markStyleForKind("slate", darkVars, false, true);
    expect(active["fill-opacity"]).toBe(String(hoverFillOpacity("dark")));
    expect(active.style).toContain("screen");
  });
});
