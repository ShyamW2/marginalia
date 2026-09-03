import { describe, expect, it } from "vitest";
import { stripRunningHeadersFooters, type PageItems } from "./headerFooter.js";
import type { RawTextItem } from "./types.js";

const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

function item(text: string, x: number, y: number, width = text.length * 6): RawTextItem {
  return { text, x, y, width, height: 10, fontName: "F1" };
}

function page(index: number, items: RawTextItem[]): PageItems {
  return { pageIndex: index, width: PAGE_WIDTH, height: PAGE_HEIGHT, items };
}

describe("stripRunningHeadersFooters", () => {
  it("removes a running header repeated on 3+ pages, digit-stripped", () => {
    const pages: PageItems[] = [1, 2, 3, 4].map((n) =>
      page(n - 1, [
        item(`Chapter Title — Page ${n}`, 40, 780),
        item("Body text starts here.", 40, 700),
      ]),
    );

    const result = stripRunningHeadersFooters(pages);

    for (const p of result) {
      expect(p.items.some((i) => i.text.startsWith("Chapter Title"))).toBe(false);
      expect(p.items.some((i) => i.text === "Body text starts here.")).toBe(true);
    }
  });

    it("keeps a page-1 title and heading that only appear once", () => {
    const pages: PageItems[] = [
      page(0, [item("A Study of Something", 40, 780), item("Introduction", 40, 760)]),
      page(1, [item("Body of page two.", 40, 700)]),
      page(2, [item("Body of page three.", 40, 700)]),
    ];

    const result = stripRunningHeadersFooters(pages);

    expect(result[0].items.map((i) => i.text)).toEqual(["A Study of Something", "Introduction"]);
  });

  it("does not remove band text that repeats fewer than 3 times", () => {
    const pages: PageItems[] = [
      page(0, [item("Draft v1", 40, 780)]),
      page(1, [item("Draft v1", 40, 780)]),
      page(2, [item("Different text", 40, 780)]),
    ];

    const result = stripRunningHeadersFooters(pages);

    expect(result[0].items.some((i) => i.text === "Draft v1")).toBe(true);
    expect(result[1].items.some((i) => i.text === "Draft v1")).toBe(true);
  });

  it("leaves body-band text (outside the top/bottom ~7%) untouched even if repeated", () => {
    const pages: PageItems[] = [1, 2, 3].map((n) =>
      page(n - 1, [item("The same recurring phrase", 40, PAGE_HEIGHT / 2)]),
    );

    const result = stripRunningHeadersFooters(pages);

    for (const p of result) {
      expect(p.items.some((i) => i.text === "The same recurring phrase")).toBe(true);
    }
  });
});
