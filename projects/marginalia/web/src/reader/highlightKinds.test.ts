import { describe, expect, it } from "vitest";
import { DEFAULT_KIND_LABELS, kindLabelsFromSettings } from "./highlightKinds.js";

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
