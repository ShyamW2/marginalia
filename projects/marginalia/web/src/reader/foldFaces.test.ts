import { describe, expect, it } from "vitest";
import {
  computeFold,
  curlArcLength,
  drawPageFold,
  leafSourceRect,
  type LeafFace,
  type Point,
} from "./pageFold.js";

/**
 * M27, "the back of the sheet is the leaf's real other side".
 *
 * jsdom has no 2D context, so these drive `drawPageFold` through a fake that
 * records every `drawImage` along with the transform in force at the time.
 * That is the only way to state the thing this milestone actually changed —
 * *which bitmap is sampled, and where* — as a test rather than as a
 * screenshot. The fold's own geometry is untouched by M27 and is still
 * covered by `pageFold.test.ts`.
 */

/** Canvas transform convention: [a, b, c, d, e, f]. */
type Mat = [number, number, number, number, number, number];

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** `m` then `n` — i.e. what the canvas does when `n` is applied to a context
 * already carrying `m`. */
function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Mat, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

interface Blit {
  image: unknown;
  matrix: Mat;
}

interface Fill {
  style: string;
  alpha: number;
}

/** Records blits and their transforms; every other canvas call is a no-op,
 * because nothing else in `drawPageFold` decides which pixels come from
 * where. */
function fakeCtx() {
  let matrix: Mat = [...IDENTITY] as Mat;
  const stack: Mat[] = [];
  const blits: Blit[] = [];
  const fills: Fill[] = [];
  const ctx = {
    blits,
    fills,
    canvas: { width: 0, height: 0 },
    save: () => void stack.push([...matrix] as Mat),
    restore: () => void (matrix = stack.pop() ?? ([...IDENTITY] as Mat)),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) =>
      void (matrix = [a, b, c, d, e, f]),
    translate: (x: number, y: number) => void (matrix = mul(matrix, [1, 0, 0, 1, x, y])),
    scale: (x: number, y: number) => void (matrix = mul(matrix, [x, 0, 0, y, 0, 0])),
    rotate: (t: number) =>
      void (matrix = mul(matrix, [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0])),
    drawImage: (image: unknown) => void blits.push({ image, matrix: [...matrix] as Mat }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    clip: () => {},
    fill: () => {},
    fillRect: () => void fills.push({ style: ctx.fillStyle, alpha: ctx.globalAlpha }),
    clearRect: () => {},
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    fillStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  return ctx as unknown as CanvasRenderingContext2D & { blits: Blit[]; fills: Fill[] };
}

const WIDTH = 600;
const HEIGHT = 800;
const FRONT_BITMAP = { tag: "front" } as unknown as CanvasImageSource;
const BACK_BITMAP = { tag: "back" } as unknown as CanvasImageSource;

/** A fold held well out from the corner, so the tail — the flat back-facing
 * surface, and the only one that can carry readable text — genuinely exists.
 * Below ~0.582 x arc there are no tail pixels at all; see NOTES.md "M27 —
 * when the back is first visible". */
function heldFold() {
  const arc = curlArcLength(WIDTH, HEIGHT);
  const fold = computeFold("bottomRight", { x: WIDTH - 420, y: HEIGHT - 560 }, WIDTH, HEIGHT, arc);
  if (!fold) throw new Error("expected a fold");
  if (fold.tailPolygon.length < 3) throw new Error("expected a tail to exist at this drag depth");
  return fold;
}

function facePair(back: LeafFace | null) {
  const front: LeafFace = {
    image: FRONT_BITMAP,
    source: leafSourceRect(1200, 1600, WIDTH, WIDTH, WIDTH * 2),
    flipX: false,
  };
  return { front, back };
}

function draw(back: LeafFace | null) {
  const ctx = fakeCtx();
  const layerCtx = fakeCtx();
  drawPageFold(ctx, layerCtx, facePair(back), heldFold(), WIDTH, HEIGHT, 2, [250, 249, 245]);
  return { ctx, layerCtx };
}

const backFace: LeafFace = {
  image: BACK_BITMAP,
  source: leafSourceRect(1200, 1600, 0, WIDTH, WIDTH * 2),
  flipX: true,
};

describe("drawPageFold — the sheet's two faces (M27)", () => {
  it("paints the back-facing regions from the back's own bitmap", () => {
    // The whole point of the milestone: mid-fold the lifted right leaf
    // carries page N+1, not a mirrored copy of page N. The back-facing
    // regions are exactly the ones drawn on the scratch layer.
    const { ctx, layerCtx } = draw(backFace);
    expect(layerCtx.blits.length).toBeGreaterThan(0);
    expect(layerCtx.blits.every((b) => b.image === BACK_BITMAP)).toBe(true);
    // ...and the front-facing regions are untouched by any of it.
    const frontBlits = ctx.blits.filter((b) => b.image === FRONT_BITMAP);
    expect(frontBlits.length).toBeGreaterThan(0);
    expect(ctx.blits.some((b) => b.image === BACK_BITMAP)).toBe(false);
  });

  it("registers the back flipped about the spine, not merely mirrored by the fold", () => {
    // `alpha = -1` already mirrors the tail about the *crease*; that is the
    // fold and it is unchanged. What M27 adds is the *other* flip: the two
    // faces of one sheet do not share a coordinate frame, because turning a
    // leaf over swaps which side of the spread its spine is on. So leaf-local
    // x = 0 on the back must sample where x = WIDTH samples on the front.
    const withBack = draw(backFace).layerCtx.blits;
    const asMirror = draw(null).layerCtx.blits;
    expect(withBack.length).toBe(asMirror.length);

    for (let i = 0; i < withBack.length; i++) {
      const b = withBack[i]!.matrix;
      const f = asMirror[i]!.matrix;
      for (const y of [0, HEIGHT / 2, HEIGHT]) {
        expect(apply(b, { x: 0, y })).toMatchObject({
          x: expect.closeTo(apply(f, { x: WIDTH, y }).x, 6),
          y: expect.closeTo(apply(f, { x: WIDTH, y }).y, 6),
        });
        expect(apply(b, { x: WIDTH, y })).toMatchObject({
          x: expect.closeTo(apply(f, { x: 0, y }).x, 6),
          y: expect.closeTo(apply(f, { x: 0, y }).y, 6),
        });
      }
    }
  });

  it("leaves the front face's registration exactly as it was", () => {
    // The flip is the back's alone. A regression here would move the text
    // the reader is still reading, which is the one thing a page turn may
    // never do.
    const withBack = draw(backFace).ctx.blits.filter((b) => b.image === FRONT_BITMAP);
    const asMirror = draw(null).ctx.blits.filter((b) => b.image === FRONT_BITMAP);
    expect(withBack.length).toBe(asMirror.length);
    for (let i = 0; i < withBack.length; i++) {
      expect(withBack[i]!.matrix).toEqual(asMirror[i]!.matrix);
    }
  });

  it("falls back to the pre-M27 mirror when the back's capture has not landed", () => {
    // The transitional state is a designed one: the second capture is raced
    // against the fold rather than blocking the grab, so the first frames of
    // a turn can legitimately have no back bitmap yet.
    const { layerCtx } = draw(null);
    expect(layerCtx.blits.length).toBeGreaterThan(0);
    expect(layerCtx.blits.every((b) => b.image === FRONT_BITMAP)).toBe(true);
  });
});

describe("drawPageFold — the wash is the fake back's, the lift is every back's (M27)", () => {
  // Two different jobs sharing one fill, and a later session will be tempted
  // to collapse them. `SHOW_THROUGH`'s wash exists to turn the front's
  // mirrored print into something that reads as the sheet's other side — it
  // hides text that should not be legible. `BACK_LIFT` is the material: how
  // far a *real* back goes toward the sheet's lit paper colour, which in the
  // dark themes is most of what says "lifted object" rather than "hole".
  const backFills = (ctx: { fills: { alpha: number }[] }) =>
    ctx.fills.filter((f) => f.alpha > 0 && f.alpha < 1).map((f) => f.alpha);

  it("washes a stand-in back nearly all the way to paper, hiding the wrong page", () => {
    const alphas = backFills(draw(null).layerCtx);
    expect(alphas.length).toBeGreaterThan(0);
    // 1 - SHOW_THROUGH: the front's print survives only as a ghost.
    expect(Math.max(...alphas)).toBeGreaterThan(0.7);
  });

  it("only lifts a real back, leaving its own print legible", () => {
    const alphas = backFills(draw(backFace).layerCtx);
    expect(alphas.length).toBeGreaterThan(0);
    // BACK_LIFT: enough to read as paper, nowhere near enough to ghost the
    // text this milestone went and fetched.
    expect(Math.max(...alphas)).toBeLessThan(0.5);
  });

  it("keeps the real back markedly stronger than the stand-in it replaces", () => {
    // The relationship, rather than either constant, is the thing that must
    // not silently invert.
    expect(Math.max(...backFills(draw(backFace).layerCtx))).toBeLessThan(
      Math.max(...backFills(draw(null).layerCtx)),
    );
  });
});
