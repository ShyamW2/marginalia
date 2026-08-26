import { useEffect, useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

// The same stand-in `Scene3D.test.tsx` uses: jsdom has no WebGL context, and
// none of what this file tests depends on anything three.js draws. `useThree`
// is here too because the fold brings the Desk's camera rig with it.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    children,
    onCreated,
    frameloop,
  }: {
    children?: ReactNode;
    onCreated?: (state: unknown) => void;
    frameloop?: string;
  }) => {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
      if (ref.current) onCreated?.({ gl: { domElement: ref.current } });
    }, [onCreated]);
    return (
      <canvas ref={ref} data-testid="scene-canvas" data-frameloop={frameloop}>
        {children}
      </canvas>
    );
  },
  useFrame: () => {},
  useThree: () => ({ size: { width: 1200, height: 900 }, set: () => {}, camera: null }),
}));
vi.mock("../scene3d/SceneLights.js", () => ({ SceneLights: () => null }));
// The rig reaches into a real three.js camera through a ref; under the
// stand-in Canvas that ref is a DOM node. Which camera the fold borrows is
// settled in `deskDepthMath.ts` and tested there.
vi.mock("../scene3d/CameraRig.js", () => ({ CameraRig: () => null }));
vi.mock("motion/react", () => ({ useReducedMotion: () => false }));

const { PageFold3D, uvMap } = await import("./PageFold3D.js");
const { Scene3DProvider } = await import("../scene3d/Scene3D.js");
const { leafSourceRect } = await import("./pageFold.js");

afterEach(cleanup);

/**
 * M27: the hinged fold on the one 3D seam. What is worth pinning here is not
 * what it draws — that is `foldMesh.test.ts` and a real compositor — but the
 * two things that fail *silently*: which texels the sheet samples, and whether
 * the fold takes over the shared canvas and gives it back.
 */

const CARD = { width: 1840, height: 1520 };
const LEAF = { width: 460, height: 760 };

function mapFor(leafX: number, stageWidth: number, mirrored: boolean) {
  return uvMap(
    leafSourceRect(CARD.width, CARD.height, leafX, LEAF.width, stageWidth),
    CARD.width,
    CARD.height,
    LEAF.width,
    LEAF.height,
    mirrored,
  );
}

const at = (m: ReturnType<typeof mapFor>, x: number, y: number) => [
  m.ox + (x - m.mirrorAt) * m.kx,
  m.oy + y * m.ky,
];

describe("uvMap — which texels the sheet samples", () => {
  it("maps a single-page leaf across the whole bitmap", () => {
    // Single-page mode: the card *is* the leaf, so the leaf's corners are the
    // bitmap's corners and nothing in between is scaled oddly.
    const m = mapFor(0, LEAF.width, false);
    expect(at(m, 0, 0)).toEqual([0, 0]);
    expect(at(m, LEAF.width, LEAF.height)).toEqual([1, 1]);
    expect(at(m, LEAF.width / 2, LEAF.height / 2)).toEqual([0.5, 0.5]);
  });

  it("maps a spread's right leaf to the right half, and its left to the left", () => {
    // The bitmap covers the *card*, which in spread mode is two pages; getting
    // this backwards paints the page you are not turning.
    const right = mapFor(LEAF.width, LEAF.width * 2, false);
    expect(at(right, 0, 0)[0]).toBeCloseTo(0.5, 9);
    expect(at(right, LEAF.width, 0)[0]).toBeCloseTo(1, 9);
    const left = mapFor(0, LEAF.width * 2, false);
    expect(at(left, 0, 0)[0]).toBeCloseTo(0, 9);
    expect(at(left, LEAF.width, 0)[0]).toBeCloseTo(0.5, 9);
  });

  it("reads the back of the sheet reversed", () => {
    // A sheet folded toward you shows its other side mirrored — true of the
    // real back page and of the front standing in for it, for two different
    // reasons (PAGE_CURL.md §2e). The mapping is the same either way.
    const front = mapFor(LEAF.width, LEAF.width * 2, false);
    const back = mapFor(LEAF.width, LEAF.width * 2, true);
    expect(at(back, 0, 0)[0]).toBeCloseTo(at(front, LEAF.width, 0)[0], 9);
    expect(at(back, LEAF.width, 0)[0]).toBeCloseTo(at(front, 0, 0)[0], 9);
    // ...and only in `u`. A mirrored sheet is not an upside-down one.
    expect(at(back, 0, LEAF.height)[1]).toBeCloseTo(at(front, 0, LEAF.height)[1], 9);
  });

  it("never samples outside the leaf's own slice", () => {
    for (const mirrored of [false, true]) {
      const m = mapFor(LEAF.width, LEAF.width * 2, mirrored);
      for (const x of [0, 1, LEAF.width / 3, LEAF.width]) {
        for (const y of [0, LEAF.height / 3, LEAF.height]) {
          const [u, v] = at(m, x, y);
          expect(u).toBeGreaterThanOrEqual(0.5 - 1e-9);
          expect(u).toBeLessThanOrEqual(1 + 1e-9);
          expect(v).toBeGreaterThanOrEqual(-1e-9);
          expect(v).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe("PageFold3D — taking the shared canvas and giving it back", () => {
  function card() {
    const canvas = document.createElement("canvas");
    canvas.width = CARD.width;
    canvas.height = CARD.height;
    return canvas;
  }

  function Fold() {
    return (
      <PageFold3D
        image={card()}
        anchor="bottomRight"
        leafWidth={LEAF.width}
        leafHeight={LEAF.height}
        leafX={LEAF.width}
        stageWidth={LEAF.width * 2}
        getOrigin={() => ({ x: 100, y: 40 })}
        getPointer={() => ({ x: 200, y: 600 })}
      />
    );
  }

  it("runs the shared canvas's frame loop only while a fold is live", async () => {
    // The fold renders no DOM of its own, so what it *does* is register a layer
    // — and the seam answers by starting its loop. A layer left behind would
    // leave the canvas rendering, and (worse, per Scene3D's own warning) leave
    // the fold's last frame painted over the room the reader goes to next.
    const view = render(
      <Scene3DProvider>
        <Fold />
      </Scene3DProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("scene-canvas").dataset.frameloop).toBe("always"),
    );

    view.rerender(
      <Scene3DProvider>
        <div />
      </Scene3DProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("scene-canvas").dataset.frameloop).toBe("never"),
    );
  });

  // The operator's two asks, 2026-08-26: the sheet has to pass *over* the far
  // leaf's cover and over the reader's chrome, which at the seam's ordinary
  // `z-index: 0` it did not — in immersive mode it was invisible for the whole
  // turn. Where the depth itself is decided is `Scene3D.module.css`; what this
  // pins is that the fold asks, and that it stops asking when the turn ends.
  it("elevates the shared canvas over the reader's chrome, and only while turning", async () => {
    const layer = () => screen.getByTestId("scene-canvas").parentElement;
    const view = render(
      <Scene3DProvider>
        <Fold />
      </Scene3DProvider>,
    );
    await waitFor(() => expect(layer()?.getAttribute("data-elevated")).toBe("true"));

    view.rerender(
      <Scene3DProvider>
        <div />
      </Scene3DProvider>,
    );
    await waitFor(() => expect(layer()?.hasAttribute("data-elevated")).toBe(false));
  });
});
