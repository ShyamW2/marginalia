import { describe, expect, it } from "vitest";
import { cardCompositeRect, cardLayout } from "./cardSnapshot.js";

// The numbers below are the live ones from the misregistration this module
// exists to fix (2026-08-02): a 519x598 text column inside a 599x678 paper
// card at the "normal" 40px reader margin.
const CARD = { left: 670, top: 55, width: 599, height: 678 };
const CONTENT = { left: 710, top: 95, width: 519, height: 598 };

describe("cardLayout", () => {
  it("measures the content's inset from the card, rather than re-deriving the margin", () => {
    expect(cardLayout(CARD, CONTENT)).toEqual({
      cardWidth: 599,
      cardHeight: 678,
      contentWidth: 519,
      contentHeight: 598,
      offsetX: 40,
      offsetY: 40,
    });
  });

  it("reads an asymmetric layout off the rects as it finds it", () => {
    // Nothing here assumes the margin is equal on all four sides — a clamped
    // `min(var(--reader-margin), 18%)` at a narrow window is not.
    const layout = cardLayout(CARD, { left: 700, top: 120, width: 500, height: 500 });
    expect(layout.offsetX).toBe(30);
    expect(layout.offsetY).toBe(65);
  });
});

describe("cardCompositeRect", () => {
  it("puts the page bitmap at the same inset it has on screen, at the bitmap's own scale", () => {
    // The registration property, in one assertion: a dpr-2 capture of the
    // text column lands 2x the CSS offset into a card bitmap 2x the card.
    const rect = cardCompositeRect(cardLayout(CARD, CONTENT), 1038, 1196);
    expect(rect.scale).toBe(2);
    expect(rect).toMatchObject({ width: 1198, height: 1356, dx: 80, dy: 80 });
  });

  it("reads the scale back from the bitmap rather than assuming devicePixelRatio", () => {
    // pageSnapshot clamps its capture scale (MAX_CAPTURE_SCALE), so the two
    // disagree on a 3x display — and a wrong scale here is a fold registered
    // wrong all over again.
    const rect = cardCompositeRect(cardLayout(CARD, CONTENT), 519, 598);
    expect(rect.scale).toBe(1);
    expect(rect).toMatchObject({ width: 599, height: 678, dx: 40, dy: 40 });
  });

  it("survives a zero-width content rect rather than producing a NaN transform", () => {
    const layout = cardLayout(CARD, { left: 670, top: 55, width: 0, height: 0 });
    const rect = cardCompositeRect(layout, 0, 0);
    expect(rect.scale).toBe(1);
    expect(Number.isFinite(rect.width)).toBe(true);
    expect(Number.isFinite(rect.height)).toBe(true);
  });
});
