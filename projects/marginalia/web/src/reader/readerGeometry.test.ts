import { describe, expect, it } from "vitest";
import {
  computeReaderGap,
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
