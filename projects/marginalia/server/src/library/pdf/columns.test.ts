import { describe, expect, it } from "vitest";
import { detectColumns, orderPageItems } from "./columns.js";
import type { RawTextItem } from "./types.js";

const PAGE_WIDTH = 600;

function item(text: string, x: number, y: number, width = text.length * 6): RawTextItem {
  return { text, x, y, width, height: 10, fontName: "F1" };
}

describe("detectColumns", () => {
  it("declares two columns for a bimodal left-edge distribution with a wide gap", () => {
    const items: RawTextItem[] = [];
    for (let row = 0; row < 10; row++) {
      items.push(item(`left ${row}`, 40, 700 - row * 12));
      items.push(item(`right ${row}`, 320, 700 - row * 12));
    }

    const result = detectColumns(items, PAGE_WIDTH);

    expect(result.twoColumn).toBe(true);
    expect(result.column1Left).toBeCloseTo(40, 0);
    expect(result.column2Left).toBeCloseTo(320, 0);
  });

  it("stays single-column when there is no gap clearing 5% of the page width", () => {
    const items: RawTextItem[] = [];
    for (let row = 0; row < 10; row++) {
      items.push(item(`text ${row}`, 40 + (row % 2) * 10, 700 - row * 12));
    }

    const result = detectColumns(items, PAGE_WIDTH);

    expect(result.twoColumn).toBe(false);
  });

  it("does not declare two columns when one mode holds under 25% of items", () => {
    const items: RawTextItem[] = [];
    for (let row = 0; row < 19; row++) items.push(item(`left ${row}`, 40, 700 - row * 10));
    items.push(item("right", 320, 690)); // one item on the "second column" — 5%

    const result = detectColumns(items, PAGE_WIDTH);

    expect(result.twoColumn).toBe(false);
  });
});

describe("orderPageItems", () => {
  it("emits column 1 fully (top to bottom), then column 2", () => {
    const items: RawTextItem[] = [
      item("L1", 40, 700),
      item("L2", 40, 680),
      item("L3", 40, 660),
      item("R1", 320, 700),
      item("R2", 320, 680),
      item("R3", 320, 660),
    ];

    const order = orderPageItems(items, PAGE_WIDTH).map((i) => i.text);

    expect(order).toEqual(["L1", "L2", "L3", "R1", "R2", "R3"]);
  });

  it("threads a full-width title above two columns rather than sorting it into column 1", () => {
    const title = item("A Full Width Paper Title Spanning The Page", 40, 760, PAGE_WIDTH * 0.85);
    const items: RawTextItem[] = [
      title,
      item("L1", 40, 700),
      item("L2", 40, 680),
      item("R1", 320, 700),
      item("R2", 320, 680),
    ];

    const order = orderPageItems(items, PAGE_WIDTH).map((i) => i.text);

    expect(order[0]).toBe(title.text);
    expect(order.slice(1)).toEqual(["L1", "L2", "R1", "R2"]);
  });

  it("threads a full-width figure between two column bands rather than after both", () => {
    const figure = item("Figure 1. A wide diagram", 40, 500, PAGE_WIDTH * 0.9);
    const items: RawTextItem[] = [
      item("L1", 40, 700),
      item("R1", 320, 700),
      figure,
      item("L2", 40, 400),
      item("R2", 320, 400),
    ];

    const order = orderPageItems(items, PAGE_WIDTH).map((i) => i.text);

    expect(order).toEqual(["L1", "R1", figure.text, "L2", "R2"]);
  });

  it("keeps single-column pages in plain top-to-bottom order", () => {
    const items: RawTextItem[] = [item("First", 40, 700), item("Second", 40, 680), item("Third", 40, 660)];

    const order = orderPageItems(items, PAGE_WIDTH).map((i) => i.text);

    expect(order).toEqual(["First", "Second", "Third"]);
  });
});
