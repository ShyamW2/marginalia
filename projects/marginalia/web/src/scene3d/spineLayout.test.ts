import { describe, expect, it } from "vitest";
import { fitSpineTitle } from "./spineLayout.js";

/** A stand-in for `ctx.measureText`: every glyph is half an em wide. Crude,
 * monotonic in both arguments, and that is all the fitting rules depend on. */
const measure = (text: string, fontPx: number) => text.length * fontPx * 0.5;

describe("fitSpineTitle", () => {
  it("sizes the type from the spine's width, not its length", () => {
    const thin = fitSpineTitle("Ada", 400, 18, measure);
    const fat = fitSpineTitle("Ada", 400, 44, measure);
    expect(fat.fontPx).toBeGreaterThan(thin.fontPx);
    // A longer book does not get bigger lettering, only more room for it.
    expect(fitSpineTitle("Ada", 900, 18, measure).fontPx).toBe(thin.fontPx);
  });

  it("leaves a short title alone", () => {
    const set = fitSpineTitle("Metamorphosis", 400, 30, measure);
    expect(set.truncated).toBe(false);
    expect(set.text).toBe("Metamorphosis");
  });

  it("truncates a long title to something that actually fits", () => {
    const set = fitSpineTitle(
      "Alice's Adventures in Wonderland and Through the Looking-Glass",
      260,
      20,
      measure,
    );
    expect(set.truncated).toBe(true);
    expect(set.text.endsWith("…")).toBe(true);
    expect(measure(set.text, set.fontPx)).toBeLessThanOrEqual(set.end - set.start);
  });

  it("normalises the whitespace a title arrives with", () => {
    expect(fitSpineTitle("  Kafka   on the  Shore ", 600, 30, measure).text).toBe("Kafka on the Shore");
  });

  it("keeps the lettering inside the spine, head margin first", () => {
    const set = fitSpineTitle("Ada", 400, 20, measure);
    expect(set.start).toBeGreaterThan(0);
    expect(set.end).toBeLessThan(400);
    expect(set.start).toBeGreaterThan(400 - set.end);
  });

  it("survives a spine too small to letter at all", () => {
    const set = fitSpineTitle("Metamorphosis", 12, 4, measure);
    expect(measure(set.text, set.fontPx)).toBeLessThanOrEqual(Math.max(0, set.end - set.start));
  });
});
