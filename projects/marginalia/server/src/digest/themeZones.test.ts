import { describe, expect, it } from "vitest";
import { computeThemeZone } from "./themeZones.js";

describe("computeThemeZone", () => {
  const text =
    "The morning was quiet. Then the argument began in earnest. Voices rose across the kitchen. " +
    "By evening everyone had gone silent again.";

  it("locates a genuine, contiguous stretch and returns the located start quote", () => {
    const zone = computeThemeZone(text, {
      zoneStart: "Then the argument began in earnest.",
      zoneEnd: "Voices rose across the kitchen.",
    });
    expect(zone).not.toBeNull();
    expect(zone?.startQuote).toBe("Then the argument began in earnest.");
    expect(zone?.startOffset).toBe(text.indexOf("Then the argument began in earnest."));
    expect(zone?.endOffset).toBe(text.indexOf("Voices rose across the kitchen.") + "Voices rose across the kitchen.".length);
  });

  it("returns null when zoneStart/zoneEnd are absent — the 'no zone' case, not an error", () => {
    expect(computeThemeZone(text, { zoneStart: null, zoneEnd: null })).toBeNull();
    expect(computeThemeZone(text, {})).toBeNull();
    expect(computeThemeZone(text, { zoneStart: "Then the argument began in earnest." })).toBeNull();
  });

  it("check 1: drops the zone if either endpoint doesn't locate", () => {
    expect(
      computeThemeZone(text, {
        zoneStart: "a sentence never in the text",
        zoneEnd: "Voices rose across the kitchen.",
      }),
    ).toBeNull();
    expect(
      computeThemeZone(text, {
        zoneStart: "Then the argument began in earnest.",
        zoneEnd: "a sentence never in the text",
      }),
    ).toBeNull();
  });

  it("check 2: drops the zone if the start doesn't precede the end", () => {
    expect(
      computeThemeZone(text, {
        zoneStart: "Voices rose across the kitchen.",
        zoneEnd: "Then the argument began in earnest.",
      }),
    ).toBeNull();
  });

  it("keeps a genuine single-sentence zone — the same sentence for both endpoints is a real, if tiny, span", () => {
    const zone = computeThemeZone(text, {
      zoneStart: "Voices rose across the kitchen.",
      zoneEnd: "Voices rose across the kitchen.",
    });
    expect(zone).not.toBeNull();
    expect(zone?.endOffset).toBe((zone?.startOffset ?? 0) + "Voices rose across the kitchen.".length);
  });

  it("check 4: drops a zone spanning more than the fraction cutoff of the chapter", () => {
    // Start at the very beginning, end at the very end — effectively the
    // whole chapter, exactly the "model shrugging" case the check exists for.
    expect(
      computeThemeZone(text, {
        zoneStart: "The morning was quiet.",
        zoneEnd: "By evening everyone had gone silent again.",
      }),
    ).toBeNull();
  });

  it("keeps a zone that covers most, but not nearly all, of a short chapter", () => {
    const short = "One. Two. Three.";
    const zone = computeThemeZone(short, { zoneStart: "One.", zoneEnd: "Two." });
    expect(zone).not.toBeNull();
  });
});
