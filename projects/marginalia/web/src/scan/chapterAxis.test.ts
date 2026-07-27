import { describe, expect, it } from "vitest";
import type { ScanChapter } from "@marginalia/shared";
import { chapterLabelText, thinLabels } from "./chapterAxis.js";

function chapter(spineIndex: number, startPercent: number, title: string | null = null): ScanChapter {
  return { spineIndex, chapterNumber: spineIndex + 1, title, startPercent, lengthPercent: 0.01 };
}

describe("chapterLabelText", () => {
  it("shows the number when names are off, even if a title exists", () => {
    expect(chapterLabelText(chapter(2, 0.2, "The Awakening"), false)).toBe("3");
  });

  it("shows the title when names are on and one exists", () => {
    expect(chapterLabelText(chapter(2, 0.2, "The Awakening"), true)).toBe("The Awakening");
  });

  it("falls back to the number when names are on but this chapter has none", () => {
    expect(chapterLabelText(chapter(2, 0.2, null), true)).toBe("3");
  });
});

describe("thinLabels", () => {
  it("shows every chapter's label when they're spaced far apart", () => {
    const chapters = [chapter(0, 0), chapter(1, 0.3), chapter(2, 0.6), chapter(3, 0.9)];
    const shown = thinLabels(chapters, 1000, false);
    // spineIndex 0 is skipped regardless (startPercent 0 renders no tick at all)
    expect(shown).toEqual(new Set([1, 2, 3]));
  });

  it("drops labels that would collide, keeping the tick count implied elsewhere unchanged", () => {
    // 40 short "chapters" packed into a narrow strip — the crowded case.
    const chapters = Array.from({ length: 40 }, (_, i) => chapter(i, i / 40));
    const shown = thinLabels(chapters, 600, false);
    // 600px / 30px min gap allows at most 20 labels to fit; well under the 39 possible.
    expect(shown.size).toBeLessThanOrEqual(20);
    expect(shown.size).toBeGreaterThan(0);
    expect(shown.size).toBeLessThan(chapters.length - 1);
  });

  it("names need more room than numbers, so fewer labels survive in name mode at the same width", () => {
    const chapters = Array.from({ length: 20 }, (_, i) => chapter(i, i / 20, `Chapter ${i}`));
    const numbersShown = thinLabels(chapters, 800, false);
    const namesShown = thinLabels(chapters, 800, true);
    expect(namesShown.size).toBeLessThan(numbersShown.size);
  });

  it("never shows a label for the first chapter (startPercent 0 has no tick to attach to)", () => {
    const chapters = [chapter(0, 0), chapter(1, 0.5)];
    const shown = thinLabels(chapters, 2000, false);
    expect(shown.has(0)).toBe(false);
  });
});
