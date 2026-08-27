import { describe, expect, it } from "vitest";
import { pointIsOverInk } from "./pageTextEdge.js";

/**
 * M31 A2. A fake document standing in for one line of laid-out text, so the
 * ink/paper test can be characterized without a browser: one text node whose
 * characters are `CHAR_W` wide, sitting on a line box from `LINE_TOP` to
 * `LINE_BOTTOM`, with `caretRangeFromPoint` doing what a real engine does —
 * **snapping to the nearest caret from anywhere on the page**, including from
 * far out in the margin, which is the whole reason this test exists.
 */
const TEXT = "one two";
const CHAR_W = 10;
const TEXT_LEFT = 100;
const LINE_TOP = 50;
const LINE_BOTTOM = 70;

interface FakeRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

class FakeRange {
  startContainer: { nodeType: number; data: string; childNodes: unknown[] };
  startOffset: number;
  endOffset: number;

  constructor(node: FakeRange["startContainer"], start: number, end: number) {
    this.startContainer = node;
    this.startOffset = start;
    this.endOffset = end;
  }

  cloneRange(): FakeRange {
    return new FakeRange(this.startContainer, this.startOffset, this.endOffset);
  }

  setStart(_node: unknown, offset: number) {
    if (offset < 0 || offset > TEXT.length) throw new Error("bad offset");
    this.startOffset = offset;
  }

  setEnd(_node: unknown, offset: number) {
    if (offset < 0 || offset > TEXT.length) throw new Error("bad offset");
    this.endOffset = offset;
  }

  /** One rect covering the characters between start and end, on the line box.
   * A collapsed range has none, exactly as a real engine reports. */
  getClientRects(): FakeRect[] {
    if (this.endOffset <= this.startOffset) return [];
    return [
      {
        left: TEXT_LEFT + this.startOffset * CHAR_W,
        right: TEXT_LEFT + this.endOffset * CHAR_W,
        top: LINE_TOP,
        bottom: LINE_BOTTOM,
      },
    ];
  }
}

function fakeDoc(): Document {
  const node = { nodeType: 3, data: TEXT, childNodes: [] as unknown[] };
  return {
    caretRangeFromPoint(x: number, _y: number) {
      // The engine's own behaviour: clamp to the nearest caret position. It
      // never returns null for a point in the margin.
      const raw = Math.round((x - TEXT_LEFT) / CHAR_W);
      const offset = Math.min(TEXT.length, Math.max(0, raw));
      return new FakeRange(node, offset, offset);
    },
  } as unknown as Document;
}

describe("pointIsOverInk", () => {
  const doc = fakeDoc();
  const midLine = (LINE_TOP + LINE_BOTTOM) / 2;

  it("reports ink in the middle of a glyph", () => {
    expect(pointIsOverInk(doc, TEXT_LEFT + CHAR_W * 1.5, midLine)).toBe(true);
  });

  it("reports ink on the very first character of the line — the M31 report's case", () => {
    expect(pointIsOverInk(doc, TEXT_LEFT + 1, midLine)).toBe(true);
  });

  it("reports ink on the last character of the line", () => {
    expect(pointIsOverInk(doc, TEXT_LEFT + TEXT.length * CHAR_W - 1, midLine)).toBe(true);
  });

  it("reports ink in the space between two words", () => {
    // The gap is character index 3; its centre snaps to the caret *after* the
    // space, whose forward character is "t". Forward-only probing would call
    // this paper.
    expect(pointIsOverInk(doc, TEXT_LEFT + 3 * CHAR_W + CHAR_W / 2, midLine)).toBe(true);
  });

  it("reports paper out in the outer margin, where caretRangeAt still snaps to a caret", () => {
    expect(pointIsOverInk(doc, TEXT_LEFT - 60, midLine)).toBe(false);
    expect(pointIsOverInk(doc, TEXT_LEFT + TEXT.length * CHAR_W + 60, midLine)).toBe(false);
  });

  it("reports paper immediately outside either end of the line", () => {
    expect(pointIsOverInk(doc, TEXT_LEFT - 2, midLine)).toBe(false);
    expect(pointIsOverInk(doc, TEXT_LEFT + TEXT.length * CHAR_W + 2, midLine)).toBe(false);
  });

  it("reports paper below the last line", () => {
    expect(pointIsOverInk(doc, TEXT_LEFT + CHAR_W * 1.5, LINE_BOTTOM + 40)).toBe(false);
  });

  it("reports paper above the first line", () => {
    expect(pointIsOverInk(doc, TEXT_LEFT + CHAR_W * 1.5, LINE_TOP - 40)).toBe(false);
  });

  it("reports paper when the engine offers no caret at all", () => {
    const empty = { caretRangeFromPoint: () => null } as unknown as Document;
    expect(pointIsOverInk(empty, 10, 10)).toBe(false);
  });
});
