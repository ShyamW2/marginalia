import { describe, expect, it } from "vitest";
import {
  computeReaderGap,
  nearLeafRect,
  READER_MARGIN_PX,
  READER_TARGET_COLUMN_WIDTH,
  SPREAD_GUTTER,
  SPREAD_MIN_WIDTH,
  turnZoneForVisibleX,
} from "./readerGeometry.js";

describe("computeReaderGap", () => {
  it("uses the book-spine gutter once a spread is wide enough", () => {
    expect(computeReaderGap(SPREAD_MIN_WIDTH, "auto", 1)).toBe(SPREAD_GUTTER);
    expect(computeReaderGap(2000, "auto", 1)).toBe(SPREAD_GUTTER);
  });

  it("falls back to a single-column measure cap below the spread threshold", () => {
    const width = SPREAD_MIN_WIDTH - 1;
    expect(computeReaderGap(width, "auto", 1)).toBe(
      width - READER_TARGET_COLUMN_WIDTH,
    );
  });

  it("never returns a negative gap when the container is narrower than the target column", () => {
    expect(computeReaderGap(200, "auto", 1)).toBe(0);
  });

  it("stays single-column even at spread width when spreadMode is forced off", () => {
    expect(computeReaderGap(2000, "single", 1)).toBe(
      2000 - READER_TARGET_COLUMN_WIDTH,
    );
  });

  it("scales the target column width by fontScale outside spread mode", () => {
    expect(computeReaderGap(1000, "single", 1.5)).toBe(
      1000 - READER_TARGET_COLUMN_WIDTH * 1.5,
    );
  });

  it("does not scale the spread gutter by fontScale", () => {
    expect(computeReaderGap(2000, "auto", 2)).toBe(SPREAD_GUTTER);
  });
});

describe("turnZoneForVisibleX", () => {
  it("is the previous-page zone in the left 30%", () => {
    expect(turnZoneForVisibleX(0, 1000)).toBe("prev");
    expect(turnZoneForVisibleX(299, 1000)).toBe("prev");
  });

  it("is the next-page zone in the right 30%", () => {
    expect(turnZoneForVisibleX(701, 1000)).toBe("next");
    expect(turnZoneForVisibleX(1000, 1000)).toBe("next");
  });

  it("is neutral in the middle 40%", () => {
    expect(turnZoneForVisibleX(300, 1000)).toBe(null);
    expect(turnZoneForVisibleX(500, 1000)).toBe(null);
    expect(turnZoneForVisibleX(700, 1000)).toBe(null);
  });
});

describe("READER_MARGIN_PX", () => {
  it("is monotonically increasing narrow -> generous", () => {
    expect(READER_MARGIN_PX.narrow).toBeLessThan(READER_MARGIN_PX.normal);
    expect(READER_MARGIN_PX.normal).toBeLessThan(READER_MARGIN_PX.wide);
    expect(READER_MARGIN_PX.wide).toBeLessThan(READER_MARGIN_PX.generous);
  });
});

describe("nearLeafRect", () => {
  // The card is the text column plus one reader margin on every side —
  // .pageClip's box, which is the frame the fold canvas is positioned in.
  const MARGIN = READER_MARGIN_PX.normal;
  const card = (contentWidth: number) => contentWidth + 2 * MARGIN;

  it("is the whole card in single-page mode", () => {
    expect(nearLeafRect(1200, 900, 1120, "single", "next")).toEqual({
      x: 0,
      width: 1200,
      height: 900,
    });
    expect(nearLeafRect(1200, 900, 1120, "single", "prev")).toEqual({
      x: 0,
      width: 1200,
      height: 900,
    });
  });

  it("is the whole card in spread mode below the spread width threshold", () => {
    const contentWidth = SPREAD_MIN_WIDTH - 1;
    const width = card(contentWidth);
    expect(nearLeafRect(width, 900, contentWidth, "auto", "next")).toEqual({
      x: 0,
      width,
      height: 900,
    });
  });

  // The spread decision is epub.js's, and epub.js only ever sees the element
  // it renders into — so it is made on the content width even though the
  // rect returned is the card's. At a generous margin the two straddle the
  // threshold, and following the card would split a stage epub.js laid out
  // as one column.
  it("decides spread on the content width, not the card's", () => {
    const contentWidth = SPREAD_MIN_WIDTH - 1;
    const width = card(contentWidth); // comfortably over the threshold itself
    expect(width).toBeGreaterThan(SPREAD_MIN_WIDTH);
    expect(nearLeafRect(width, 900, contentWidth, "auto", "next").width).toBe(width);
  });

  it("is the right half for 'next' and the left half for 'prev' once spread", () => {
    const contentWidth = 2000;
    const width = card(contentWidth);
    expect(nearLeafRect(width, 900, contentWidth, "auto", "next")).toEqual({
      x: width / 2,
      width: width / 2,
      height: 900,
    });
    expect(nearLeafRect(width, 900, contentWidth, "auto", "prev")).toEqual({
      x: 0,
      width: width / 2,
      height: 900,
    });
  });

  // Each leaf carries its own outer margin and half the spine gutter, so the
  // two halves tile the card exactly — and the split lands on the gutter's
  // centre line, which is where a real spine is.
  it("tiles the card, splitting on the gutter's centre line", () => {
    const contentWidth = 2000;
    const width = card(contentWidth);
    const next = nearLeafRect(width, 900, contentWidth, "auto", "next");
    const prev = nearLeafRect(width, 900, contentWidth, "auto", "prev");
    expect(prev.width + next.width).toBeCloseTo(width, 6);
    expect(next.x).toBeCloseTo(prev.width, 6);
    // The left text column ends half a gutter short of the split.
    const columnWidth = (contentWidth - SPREAD_GUTTER) / 2;
    expect(next.x - (MARGIN + columnWidth)).toBeCloseTo(SPREAD_GUTTER / 2, 6);
  });
});
