import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Scene3DProvider } from "../src/scene3d/Scene3D.js";
import { PageFold3D } from "../src/reader/PageFold3D.js";
import {
  anchorPoint,
  computeFold,
  curlArcLength,
  drawPageFold,
  leafSourceRect,
  samplePaperColor,
  syntheticHingePointer,
  type FoldAnchor,
  type Point,
} from "../src/reader/pageFold.js";
// @ts-expect-error - plain JS fixture shared with pageFold.html
import { BODY, NEXT, THEMES, foldStates, makeMarkerPage, makePage, makeSpread } from "./samplePage.js";

/**
 * M27's harness: **the shipped flat painter and the hinged mesh, side by side,
 * driven by one drag.**
 *
 * `pageFold.html` is a grid of stills of one renderer. This is the other
 * question — whether the hinge is *right* — and that one is only answerable by
 * comparison, so both stages take the same pointer and the same page. The
 * difference to look for is at the **spine**, which is the edge opposite the
 * grab: the flat sheet slides away from it, the hinged one cannot.
 *
 * Only one stage can be the mesh. The 3D seam owns exactly one canvas for the
 * whole app (settled decision 14) and the fold registers one layer in it, so
 * the cone stage is wherever `PageFold3D`'s origin points and the flat stage
 * keeps its own 2D canvas, exactly as it does in the reader today.
 */

const q = new URLSearchParams(location.search);
const W = Number(q.get("w") ?? 380);
const H = Number(q.get("h") ?? 540);
const DPR = Number(q.get("dpr") ?? 2);
const MODE = q.get("mode") === "single" ? "single" : "spread";
const MODEL = q.get("model") ?? "both";
const THEME = (q.get("theme") ?? "paper") as keyof typeof THEMES;
const DEBUG = q.get("debug") === "1";
/** A named state from `foldStates`, so this page and `pageFold.html` can be put
 * beside each other showing the *same* drag. `?t=` overrides it with a point on
 * the hinged sweep instead, which is the far field and shows no fan at all. */
const STATE = q.get("state") ?? "drag-50";
const T = q.get("t") === null ? null : Number(q.get("t"));
const STATES = foldStates(W, H) as Record<string, [FoldAnchor, Point]>;
const [STATE_ANCHOR, STATE_POINTER] = STATES[STATE] ?? STATES["drag-50"]!;
const ANCHOR: FoldAnchor = (q.get("anchor") as FoldAnchor) ?? STATE_ANCHOR;

const CARD_WIDTH = MODE === "spread" ? W * 2 : W;
/** A `next` turn peels the right leaf; in single-page mode the leaf is the card. */
const LEAF_X = MODE === "spread" ? W : 0;

const theme = THEMES[THEME] ?? THEMES.paper;
const size = { width: W, height: H, dpr: DPR };
/** `?fixture=letters` swaps the prose for one huge glyph a side, which is the
 * only way to see at a glance whether a face is mirrored, upside down, or the
 * wrong side of the sheet entirely. */
const LETTERS = q.get("fixture") === "letters";

function spreadOf(left: string, right: string, texts: [string, string], folios: [string, string]) {
  if (!LETTERS) return makeSpread(texts[0], texts[1], theme, folios, size);
  const c = document.createElement("canvas");
  c.width = W * 2 * DPR;
  c.height = H * DPR;
  const x = c.getContext("2d")!;
  x.drawImage(makeMarkerPage(left, theme, folios[0], size), 0, 0);
  x.drawImage(makeMarkerPage(right, theme, folios[1], size), W * DPR, 0);
  return c;
}

/** The departing card, and the one the turn arrives at. The back of the sheet
 * is the arriving card's **left** half for a `next` turn — the post-advance
 * capture, exactly as the reader supplies it. */
const departing =
  MODE === "spread"
    ? spreadOf("L", "R", [BODY, NEXT], ["64", "65"])
    : LETTERS
      ? makeMarkerPage("R", theme, "64", size)
      : makePage(BODY, theme, "64", size);
const arriving =
  MODE === "spread"
    ? spreadOf("A", "B", [BODY, NEXT], ["66", "67"])
    : LETTERS
      ? makeMarkerPage("B", theme, "65", size)
      : makePage(NEXT, theme, "65", size);

function Stage({
  label,
  children,
  onPointer,
  stageRef,
}: {
  label: string;
  children?: React.ReactNode;
  onPointer: (p: Point) => void;
  stageRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <figure className="cell">
      <figcaption>{label}</figcaption>
      <div
        className="stage"
        ref={stageRef}
        style={{ width: CARD_WIDTH, height: H }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPointer({ x: e.clientX - r.left - LEAF_X, y: e.clientY - r.top });
        }}
      >
        <img className="under" src={arriving.toDataURL()} alt="" />
        {children}
        {DEBUG && (
          <div
            className="spine"
            style={{ left: LEAF_X + (spineIsLeft() ? 0 : W) - 1 }}
            title="the spine — the edge opposite the grab"
          />
        )}
      </div>
    </figure>
  );
}

function spineIsLeft() {
  return ANCHOR === "bottomRight" || ANCHOR === "topRight";
}

/** The shipped renderer, drawn exactly as `PageCurl` draws it: a 2D canvas
 * sized to the *leaf*, which is why nothing it paints can ever cross the
 * gutter. */
function FlatStage({ getPointer }: { getPointer: () => Point }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const layer = document.createElement("canvas");
    layer.width = canvas.width = W * DPR;
    layer.height = canvas.height = H * DPR;
    const layerCtx = layer.getContext("2d")!;
    const paper = samplePaperColor(departing);
    const front = {
      image: departing,
      source: leafSourceRect(departing.width, departing.height, LEAF_X, W, CARD_WIDTH),
      flipX: false,
    };
    const back = {
      image: arriving,
      source: leafSourceRect(arriving.width, arriving.height, 0, W, CARD_WIDTH),
      flipX: true,
    };
    let raf = 0;
    const tick = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      layerCtx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      layerCtx.clearRect(0, 0, layer.width, layer.height);
      const fold = computeFold(ANCHOR, getPointer(), W, H, curlArcLength(W, H));
      if (fold) drawPageFold(ctx, layerCtx, { front, back }, fold, W, H, DPR, paper);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getPointer]);
  return <canvas ref={canvasRef} className="flat" style={{ left: LEAF_X, width: W, height: H }} />;
}

function Harness() {
  const start = useMemo(
    () => (T === null ? STATE_POINTER : syntheticHingePointer(ANCHOR, W, H, T)),
    [],
  );
  const pointer = useRef<Point>(start);
  const [, force] = useState(0);
  const coneStage = useRef<HTMLDivElement | null>(null);
  const origin = useRef<Point>({ x: 0, y: 0 });

  const readOrigin = useCallback(() => {
    const rect = coneStage.current?.getBoundingClientRect();
    if (rect) origin.current = { x: rect.left + LEAF_X, y: rect.top };
  }, []);
  useLayoutEffect(() => {
    readOrigin();
    window.addEventListener("resize", readOrigin);
    window.addEventListener("scroll", readOrigin, true);
    return () => {
      window.removeEventListener("resize", readOrigin);
      window.removeEventListener("scroll", readOrigin, true);
    };
  }, [readOrigin]);

  const onPointer = useCallback((p: Point) => {
    pointer.current = p;
    force((n) => n + 1);
  }, []);
  const getPointer = useCallback(() => pointer.current, []);
  const getOrigin = useCallback(() => origin.current, []);
  const getBack = useCallback(() => ({ image: arriving, leafX: 0 }), []);

  useEffect(() => {
    // Three frames, so the seam's canvas has actually drawn before a
    // screenshot script is told the page is settled.
    let n = 0;
    const tick = () => {
      if (++n >= 3) {
        (window as unknown as { __foldHarnessReady: boolean }).__foldHarnessReady = true;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, []);

  return (
    <>
      {MODEL !== "cone" && (
        <Stage label="flat — the shipped painter" onPointer={onPointer}>
          <FlatStage getPointer={getPointer} />
        </Stage>
      )}
      {MODEL !== "flat" && (
        <Stage
          label="hinged — the cone, as a mesh"
          onPointer={onPointer}
          stageRef={(el) => {
            coneStage.current = el;
            readOrigin();
          }}
        >
          <PageFold3D
            image={departing}
            anchor={ANCHOR}
            leafWidth={W}
            leafHeight={H}
            leafX={LEAF_X}
            stageWidth={CARD_WIDTH}
            getOrigin={getOrigin}
            getPointer={getPointer}
            getBack={getBack}
          />
        </Stage>
      )}
    </>
  );
}

createRoot(document.getElementById("grid")!).render(
  <Scene3DProvider>
    <Harness />
  </Scene3DProvider>,
);
