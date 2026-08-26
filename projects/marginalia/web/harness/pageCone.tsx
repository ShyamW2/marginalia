import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { animate } from "motion/react";
import { Scene3DProvider } from "../src/scene3d/Scene3D.js";
import { PageFold3D } from "../src/reader/PageFold3D.js";
import {
  anchorForPinch,
  anchorPoint,
  computeConeFold,
  computeFold,
  curlArcLength,
  drawPageFold,
  hingeRelease,
  hingeSettlePointer,
  leafSourceRect,
  samplePaperColor,
  settleArc,
  syntheticHingePointer,
  type ArcRadiusMode,
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
 *
 * ## What it takes to judge a turn rather than a pose
 *
 * The first version of this page tracked *hover*: the sheet followed the
 * pointer anywhere over the stage and there was no press and no release, so
 * the only thing it could show was a fold held at a pose. Three of the
 * operator's four findings on 2026-08-26 were about things that only exist in
 * a gesture, so it now runs one: **press, drag, release, land.**
 *
 * - **The release is a swing, not a lerp** (`hingeRelease`): a drag cannot
 *   reach the end of a bound sheet's turn — `constrainToSpineHinge` runs out
 *   of paper first — so the sheet has to finish it on its own, rotating about
 *   the apex the release froze. The arc relaxes as it goes (`settleArc`) or it
 *   never lands.
 * - **The far leaf is not pre-flipped**: the page under the gutter stays the
 *   one that was there until the sheet lands *on* it. See `underlay` below,
 *   which is the whole of it.
 * - **The pinch is where the paper was grabbed** (`anchorForPinch`): press
 *   halfway down the edge and the sheet is held halfway down the edge, and it
 *   still fans conically as the pointer rises. The old edge-anchor pinned that
 *   case flat because a flat crease cannot converge; see `EdgePinch`.
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
 * the hinged sweep instead, which is the far field and shows no fan at all.
 * Both are only the *opening* pose now — a press takes the sheet over. */
const STATE = q.get("state") ?? "drag-50";
const T = q.get("t") === null ? null : Number(q.get("t"));
const STATES = foldStates(W, H) as Record<string, [FoldAnchor, Point]>;
const [STATE_ANCHOR, STATE_POINTER] = STATES[STATE] ?? STATES["drag-50"]!;
const ANCHOR: FoldAnchor = (q.get("anchor") as FoldAnchor) ?? STATE_ANCHOR;

/**
 * Past this fraction of the turn a release finishes it; below it the sheet
 * falls back. Read off `HingeRelease.progress`, which is an **angular**
 * fraction of the whole turn — the coordinate the sheet actually moves in.
 *
 * ⚠️ **It is the reader's threshold, and it is not the reader's number**, which
 * is worth spelling out because 0.35 is what `usePageTurnAnimation` says and
 * copying it here would be wrong. The reader measures progress as drag
 * distance over `0.9 * leafWidth`, so its 0.35 is ~120px of travel on a 380px
 * leaf. A hinge's turn spans the anchor to its own mirror across the spine,
 * which is **two** leaf widths of travel — so the same 120px is 0.157 of *this*
 * progress, and 0.35 here would be a page that refuses to turn until it has
 * been dragged more than half a leaf further than the shipped one asks for.
 * Same feel, restated in the coordinate that replaced the one it was tuned in.
 *
 * `?commit=` overrides it, because where exactly it should sit is a feel
 * question and this page exists to answer those by looking — and the control
 * panel below has a live slider on the same param, so it can be tuned without
 * a reload.
 */
const DEFAULT_COMMIT_AT = Number(q.get("commit") ?? 0.157);
/** The reader's settle timings, for the same reason — and `?settle=4` to run
 * the landing in slow motion, which is the only way to look at the last 40ms
 * of it (where the arc relaxes and the sheet meets the page) on a machine that
 * composites in software. */
const DEFAULT_SETTLE_SCALE = Number(q.get("settle") ?? 1);
/** `arcTarget`'s multiplier on `curlArcLength` — `1` is the flat model's own
 * tuning. A live slider on the roll's physical size, independent of *which*
 * leaf point realizes it (see `arcMode` below). */
const DEFAULT_ARC_SCALE = Number(q.get("arcScale") ?? 1);
/** `ArcRadiusMode` (`pageFold.ts`) — `"anchor"` is what shipped 2026-08-25,
 * `"farthest"` is the 2026-08-26 candidate that caps the roll at the leaf's
 * farthest point from the apex instead of at the grabbed point. Undecided;
 * this page is where it gets decided. */
const DEFAULT_ARC_MODE = q.get("arcMode") === "farthest" ? "farthest" : "anchor";
/**
 * A constant `arcScale` fights itself: a big enough roll eats into
 * `computeConeFold`'s `sweep / (1 - ROLL_END.o)` cap (the arc cannot claim
 * more angle than the drag has swept), which is exactly the operator's report
 * 2026-08-26 — the larger the arc, the less of the turn a drag can actually
 * reach before the cap bites. Not a bug in the cap: a bound sheet really
 * cannot roll more than it has swept. The fix is to stop holding the target
 * constant through the drag — big and dramatic early (there is plenty of
 * sweep to spend), easing down through the middle (where the cap is
 * tightest), then opening back up late (`hingeRelease`'s own `progress`,
 * computed live off the *current* pointer with no dependency on `arcTarget` —
 * see `arcMultiplierAt` in `Harness` — so this is exact, not a guess about
 * when the drag is "late").
 *
 * Three sliders, piecewise-linear between them, is deliberately the whole
 * curve model: this page exists to let the operator *feel* the shape, not to
 * ship a particular easing function. */
const DEFAULT_DYNAMIC_ARC = q.get("dynamicArc") === "1";
const DEFAULT_ARC_START = Number(q.get("arcStart") ?? 1.6);
const DEFAULT_ARC_MID = Number(q.get("arcMid") ?? 0.9);
const DEFAULT_ARC_END = Number(q.get("arcEnd") ?? 1.3);

const CARD_WIDTH = MODE === "spread" ? W * 2 : W;
/** A `next` turn peels the right leaf; in single-page mode the leaf is the card. */
const LEAF_X = MODE === "spread" ? W : 0;
/** The turning leaf's outer edge — the one a hand can get under. The gutter is
 * the other one, and it is the edge that cannot lift. */
const GRAB_EDGE = "right" as const;

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

/**
 * **What lies under the turning sheet, and the whole of "do not pre-flip the
 * far leaf".**
 *
 * The reader advances the rendition at grab time (M20 step 2, "the drag
 * reveals the next page") because the turn needs two things from the advance:
 * the page revealed *under* the leaf, and the leaf's own back to print on the
 * sheet. In spread mode that hands the stage the whole destination spread —
 * and page 66 is then lying flat on the left half from the first frame while
 * the sheet turning over it *also* carries 66 on its back. The same page,
 * twice, one of them in a place a book would never put it.
 *
 * The fix is not to stop advancing — both of those needs are real. It is that
 * only the **right** half of the advance is under the sheet. So: the departing
 * card's left half (the page that was already there, and stays there until
 * something lands on it) beside the arriving card's right half (the page the
 * lifted sheet reveals). 64 | 67, with 65 on the sheet and 66 on its back.
 *
 * ## Why it takes three of these and not two
 *
 * The turning sheet is drawn by the *fold*, and a fold at rest draws nothing —
 * `computeConeFold` answers a drag that has not moved with `null`, because a
 * zero-length grab has no fold direction. So there is no one underlay that is
 * right both while the sheet is up and while it is down: 64|67 is correct only
 * for as long as something is covering the near half, and the frame the sheet
 * comes back down it leaves page 67 showing where 65 should be. (Seen, in this
 * harness, as a spring-back that ended on the wrong page.)
 *
 * Hence a phase rather than a flag, and each phase is exactly the page the
 * *un-lifted* parts of the stage should be showing:
 *
 * - `before` — 64|65, the spread as it was. Nothing has been picked up.
 * - `turning` — 64|67. The sheet is in the air and covers the near half itself;
 *   what shows under it is the page the turn is revealing.
 * - `after` — 66|67, the destination. Reached only on a commit, and swapped in
 *   under a landed sheet that is already painting exactly that 66 on top of it
 *   (`settleArc` is what makes it *exactly*), so the swap cannot be seen.
 *
 * The transitions are gesture boundaries — a first drag, a settle finishing —
 * never per-frame, so none of this costs a re-render while the sheet moves.
 */
type Phase = "before" | "turning" | "after";

function composeSpread(left: HTMLCanvasElement, right: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W * 2 * DPR;
  c.height = H * DPR;
  const x = c.getContext("2d")!;
  x.drawImage(left, 0, 0, W * DPR, H * DPR, 0, 0, W * DPR, H * DPR);
  x.drawImage(right, W * DPR, 0, W * DPR, H * DPR, W * DPR, 0, W * DPR, H * DPR);
  return c;
}

const UNDERLAY: Record<Phase, string> = {
  before: departing.toDataURL(),
  turning: (MODE === "spread" ? composeSpread(departing, arriving) : arriving).toDataURL(),
  after: arriving.toDataURL(),
};

function Stage({
  label,
  children,
  under,
  onGrab,
  onDrag,
  onRelease,
  stageRef,
}: {
  label: string;
  children?: React.ReactNode;
  under: string;
  onGrab: (p: Point) => void;
  onDrag: (p: Point) => void;
  onRelease: () => void;
  stageRef?: (el: HTMLDivElement | null) => void;
}) {
  const local = (e: React.PointerEvent<HTMLDivElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left - LEAF_X, y: e.clientY - r.top };
  };
  return (
    <figure className="cell">
      <figcaption>{label}</figcaption>
      <div
        className="stage"
        ref={stageRef}
        style={{ width: CARD_WIDTH, height: H }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          onGrab(local(e));
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onDrag(local(e));
        }}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
      >
        {/* `draggable={false}` is load-bearing: an `<img>` is draggable by
            default, so pressing on this one starts a native image drag and
            Chromium answers a fresh `setPointerCapture` with `pointercancel`
            on the very next frame. The sheet then springs back the instant it
            is grabbed, which reads as "the fold is broken" and is not. */}
        <img className="under" src={under} alt="" draggable={false} />
        {children}
        {DEBUG && (
          <div
            className="spine"
            style={{ left: LEAF_X - 1 }}
            title="the spine — the edge opposite the grab"
          />
        )}
      </div>
    </figure>
  );
}

/** The shipped renderer, drawn exactly as `PageCurl` draws it: a 2D canvas
 * sized to the *leaf*, which is why nothing it paints can ever cross the
 * gutter — and therefore why its half of a completed turn ends with the sheet
 * sliding off the leaf rather than landing on the facing page. That is the
 * limitation the cone exists for (PAGE_CURL.md §2d), not a bug in the harness. */
function FlatStage({
  getPointer,
  getAnchor,
  getArc,
}: {
  getPointer: () => Point;
  getAnchor: () => FoldAnchor;
  getArc: () => number;
}) {
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
      const fold = computeFold(getAnchor(), getPointer(), W, H, getArc());
      if (fold) drawPageFold(ctx, layerCtx, { front, back }, fold, W, H, DPR, paper);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getPointer, getAnchor, getArc]);
  return <canvas ref={canvasRef} className="flat" style={{ left: LEAF_X, width: W, height: H }} />;
}

function Harness() {
  const start = useMemo(
    () => (T === null ? STATE_POINTER : syntheticHingePointer(ANCHOR, W, H, T)),
    [],
  );
  // The four tunables the control panel exposes. State (not refs) so the
  // panel's own numeric readout and the URL sync below re-render on change —
  // but each is mirrored into a ref right after, because `onGrab`/`onRelease`
  // are stable callbacks (empty deps, like `pointer`/`arc` below) and read the
  // *current* value through the ref rather than closing over a stale one.
  const [commitAt, setCommitAt] = useState(DEFAULT_COMMIT_AT);
  const commitAtRef = useRef(commitAt);
  commitAtRef.current = commitAt;
  const [settleScale, setSettleScale] = useState(DEFAULT_SETTLE_SCALE);
  const settleScaleRef = useRef(settleScale);
  settleScaleRef.current = settleScale;
  const [arcScale, setArcScale] = useState(DEFAULT_ARC_SCALE);
  const arcScaleRef = useRef(arcScale);
  arcScaleRef.current = arcScale;
  const [arcRadiusMode, setArcRadiusMode] = useState<ArcRadiusMode>(DEFAULT_ARC_MODE as ArcRadiusMode);
  // The dynamic-arc curve: off, `arcScale` above is a flat constant through
  // the whole drag, exactly as it always was. On, it is a piecewise-linear
  // curve over the turn's own progress — see `DEFAULT_DYNAMIC_ARC`'s comment
  // for why a constant fights the sweep cap.
  const [dynamicArc, setDynamicArc] = useState(DEFAULT_DYNAMIC_ARC);
  const dynamicArcRef = useRef(dynamicArc);
  dynamicArcRef.current = dynamicArc;
  const [arcStart, setArcStart] = useState(DEFAULT_ARC_START);
  const arcStartRef = useRef(arcStart);
  arcStartRef.current = arcStart;
  const [arcMid, setArcMid] = useState(DEFAULT_ARC_MID);
  const arcMidRef = useRef(arcMid);
  arcMidRef.current = arcMid;
  const [arcEnd, setArcEnd] = useState(DEFAULT_ARC_END);
  const arcEndRef = useRef(arcEnd);
  arcEndRef.current = arcEnd;

  /** The multiplier on `curlArcLength` at a given point in the turn —
   * `progress` is `HingeRelease.progress`'s own angular fraction (0 at rest,
   * 1 fully turned), read live off the current pointer with no dependency on
   * `arcTarget`, so this can drive the very arc that feeds back into it.
   * Piecewise-linear through (0, start), (0.5, mid), (1, end). */
  const arcMultiplierAt = useCallback((progress: number) => {
    if (!dynamicArcRef.current) return arcScaleRef.current;
    const t = Math.min(1, Math.max(0, progress));
    const start = arcStartRef.current;
    const mid = arcMidRef.current;
    const end = arcEndRef.current;
    return t <= 0.5 ? start + (mid - start) * (t / 0.5) : mid + (end - mid) * ((t - 0.5) / 0.5);
  }, []);
  /** The roll's physical target size at a point in the turn — `curlArcLength`'s
   * own tuning times `arcMultiplierAt`. Not a per-frame read itself (per-frame
   * reads go through `arc.current`/`getArc`, which this seeds); called at a
   * grab, a release, and once per frame from `getArc` during a live drag. */
  const arcTargetAt = useCallback((progress: number) => curlArcLength(W, H) * arcMultiplierAt(progress), [
    arcMultiplierAt,
  ]);

  // Keeps the address bar an exact recipe for the pose on screen — so a
  // tuning session ends with a link to paste back, not four numbers to
  // transcribe by hand.
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("commit", String(commitAt));
    url.searchParams.set("settle", String(settleScale));
    url.searchParams.set("arcScale", String(arcScale));
    url.searchParams.set("arcMode", arcRadiusMode);
    url.searchParams.set("dynamicArc", dynamicArc ? "1" : "0");
    url.searchParams.set("arcStart", String(arcStart));
    url.searchParams.set("arcMid", String(arcMid));
    url.searchParams.set("arcEnd", String(arcEnd));
    history.replaceState(null, "", url);
  }, [commitAt, settleScale, arcScale, arcRadiusMode, dynamicArc, arcStart, arcMid, arcEnd]);

  // Refs, not state: these move every frame and only the canvases may re-read
  // them. `anchor` is the exception — `PageFold3D` keys its layer on it, so it
  // has to be a value React can see change, and it only changes on a press.
  const pointer = useRef<Point>(start);
  const arc = useRef<number>(curlArcLength(W, H) * DEFAULT_ARC_SCALE);
  const [anchor, setAnchor] = useState<FoldAnchor>(ANCHOR);
  const anchorRef = useRef<FoldAnchor>(ANCHOR);
  anchorRef.current = anchor;
  /** Which of the three underlays is right, and therefore also whether a fold
   * is drawing at all — see `Phase`. Starts at whatever the `?state=`/`?t=`
   * opening pose actually is, so a page loaded straight into a mid-drag still
   * shows the page that drag is revealing. */
  const [phase, setPhase] = useState<Phase>(() =>
    computeConeFold(ANCHOR, start, W, H, curlArcLength(W, H) * DEFAULT_ARC_SCALE, DEFAULT_ARC_MODE as ArcRadiusMode)
      ? "turning"
      : "before",
  );
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const settling = useRef<{ stop: () => void } | null>(null);
  /** A press is in hand. Guards the release path against being run twice —
   * a `pointerup` is routinely followed by a `pointercancel`, and the second
   * one would find the sheet parked on the fully-turned pose and cheerfully
   * settle it a second time. */
  const dragging = useRef(false);

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

  const onGrab = useCallback((p: Point) => {
    settling.current?.stop();
    settling.current = null;
    // The pinch is where the paper was grabbed. Only the height matters: a
    // hand under the sheet is under its *edge* however far inboard the press
    // landed, which is also why the reader's grab band can be 30% of the page
    // wide without the anchor wandering off the paper.
    setAnchor(anchorForPinch(GRAB_EDGE, p.y, H));
    dragging.current = true;
    arc.current = arcTargetAt(0); // nothing swept yet
    pointer.current = p;
    // Deliberately *not* `turning` yet. A press that has not moved has lifted
    // nothing, so the near half is still the departing page — entering the
    // turn here would flash the page being revealed under a sheet that has not
    // left the paper. The first drag is what starts a turn.
    setPhase("before");
  }, [arcTargetAt]);

  const onDrag = useCallback((p: Point) => {
    if (settling.current) return; // the sheet is no longer in hand
    pointer.current = p;
    if (phaseRef.current !== "turning") setPhase("turning");
  }, []);

  const onRelease = useCallback(() => {
    if (!dragging.current || settling.current) return;
    dragging.current = false;
    const held = anchorRef.current;
    const release = hingeRelease(held, pointer.current, W, H);
    if (!release) return; // never lifted; nothing to land
    const commit = release.progress > commitAtRef.current;
    const sweep = commit ? release.toTurned : release.toRest;
    // Captured once at release, not read live from the slider for the rest of
    // the settle: a mid-settle arc change would otherwise jump the curl. Uses
    // the *release's own* progress, so a dynamic curve hands off the settle
    // exactly the arc the drag was carrying, not a jump back to some baseline.
    const arcAtRelease = arcTargetAt(release.progress);
    const controls = animate(0, 1, {
      duration: (commit ? 0.16 : 0.18) * settleScaleRef.current,
      ease: "easeOut",
      onUpdate: (t) => {
        pointer.current = hingeSettlePointer(release, sweep * t);
        // Only a landing relaxes the curl. A sheet falling back is being let
        // go, not laid down: it keeps its roll and simply un-peels, which is
        // also what stops the spring-back flattening into the far field on
        // its way home.
        arc.current = commit ? settleArc(arcAtRelease, t) : arcAtRelease;
      },
      onComplete: () => {
        settling.current = null;
        arc.current = arcAtRelease;
        if (commit) {
          setPhase("after");
        } else {
          // Back exactly on its own anchor, which is the fold at rest and
          // therefore no fold at all — so the near half has to be the
          // departing page again before the sheet stops being drawn.
          pointer.current = anchorPoint(held, W, H);
          setPhase("before");
        }
      },
    });
    settling.current = { stop: () => controls.stop() };
  }, [arcTargetAt]);

  // A read-only window onto the live gesture, for driving this page under
  // automation: a screenshot can say *what pose it caught*, and a headless run
  // can assert on the fold rather than on pixels. Nothing here reads it.
  useEffect(() => {
    (window as unknown as { __fold: unknown }).__fold = {
      get anchor() {
        return anchorRef.current;
      },
      get pointer() {
        return pointer.current;
      },
      get arc() {
        return arc.current;
      },
      get settling() {
        return settling.current !== null;
      },
    };
  }, []);

  const getPointer = useCallback(() => pointer.current, []);
  const getAnchor = useCallback(() => anchorRef.current, []);
  /** Live during a held drag: `hingeRelease`'s `progress` needs no `arcTarget`
   * to compute (it only reads the cone's apex), so it can be read every frame
   * off the *current* pointer and fed straight back into the arc it will end
   * up feeding — driving the curve without a frame of lag. Mutates `arc.current`
   * rather than only returning the value, so `window.__fold.arc` stays honest
   * mid-drag too. Settling has its own driver (`onRelease`'s `onUpdate`) and is
   * left alone here. */
  const getArc = useCallback(() => {
    if (dragging.current && !settling.current) {
      const release = hingeRelease(anchorRef.current, pointer.current, W, H);
      if (release) arc.current = arcTargetAt(release.progress);
    }
    return arc.current;
  }, [arcTargetAt]);
  const getOrigin = useCallback(() => origin.current, []);
  const getBack = useCallback(() => ({ image: arriving, leafX: 0 }), []);

  const under = UNDERLAY[phase];

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

  const stageProps = { under, onGrab, onDrag, onRelease };

  return (
    <>
      <Controls
        arcRadiusMode={arcRadiusMode}
        setArcRadiusMode={setArcRadiusMode}
        arcScale={arcScale}
        setArcScale={setArcScale}
        dynamicArc={dynamicArc}
        setDynamicArc={setDynamicArc}
        arcStart={arcStart}
        setArcStart={setArcStart}
        arcMid={arcMid}
        setArcMid={setArcMid}
        arcEnd={arcEnd}
        setArcEnd={setArcEnd}
        commitAt={commitAt}
        setCommitAt={setCommitAt}
        settleScale={settleScale}
        setSettleScale={setSettleScale}
      />
      {MODEL !== "cone" && (
        <Stage label="flat — the shipped painter" {...stageProps}>
          {phase !== "after" && (
            <FlatStage getPointer={getPointer} getAnchor={getAnchor} getArc={getArc} />
          )}
        </Stage>
      )}
      {MODEL !== "flat" && (
        <Stage
          label="hinged — the cone, as a mesh"
          {...stageProps}
          stageRef={(el) => {
            coneStage.current = el;
            readOrigin();
          }}
        >
          {phase !== "after" && (
            <PageFold3D
              image={departing}
              anchor={anchor}
              leafWidth={W}
              leafHeight={H}
              leafX={LEAF_X}
              stageWidth={CARD_WIDTH}
              getOrigin={getOrigin}
              getPointer={getPointer}
              getArc={getArc}
              arcRadiusMode={arcRadiusMode}
              getBack={getBack}
            />
          )}
        </Stage>
      )}
    </>
  );
}

/**
 * The M27 spine-splay tuning panel (2026-08-26). Live:
 *
 * - **arc radius mode** — `ArcRadiusMode` in `pageFold.ts`. `"anchor"` is
 *   shipped; `"farthest"` is the candidate that caps the roll at the leaf's
 *   farthest point from the apex instead of the grabbed point, so the sheet
 *   reads as hugging the spine rather than swinging away from it on a deep or
 *   corner-ish drag. Judge it with a real gesture, not the opening pose — the
 *   effect is on the *shape mid-drag*, not on where the sheet starts.
 * - **arc size** — a flat multiplier on `curlArcLength` through the whole
 *   drag. Independent of the mode above: it is "how big is the target roll",
 *   not "which point gets it". Disabled while dynamic arc (below) is on,
 *   since the two are the same knob at different fidelities.
 * - **dynamic arc** — 2026-08-26, from the operator's report that a large flat
 *   `arcScale` makes a drag stall short of the spine: the roll's angular
 *   extent is capped by how far the drag has swept
 *   (`computeConeFold`'s `sweep / (1 - ROLL_END.o)`), so a big constant target
 *   fights its own cap hardest exactly where the cap is tightest — mid-drag.
 *   Three sliders, piecewise-linear over the turn's progress (0 at rest, 1
 *   fully turned): big early, easing down through the middle, opening back up
 *   late. Read `arcMultiplierAt` in `Harness` for the exact curve; it is
 *   deliberately simple (two line segments) so the shape stays legible while
 *   tuning it by feel.
 * - **commit threshold** and **settle speed** are what they say; `settle`
 *   below 1 is not slow motion but *fast* motion, useful for feeling the
 *   commit snap rather than watching it.
 *
 * Every control's value round-trips through the URL (the `useEffect` in
 * `Harness`), so a tuning session ends in a link, not numbers copied by hand.
 */
function Controls({
  arcRadiusMode,
  setArcRadiusMode,
  arcScale,
  setArcScale,
  dynamicArc,
  setDynamicArc,
  arcStart,
  setArcStart,
  arcMid,
  setArcMid,
  arcEnd,
  setArcEnd,
  commitAt,
  setCommitAt,
  settleScale,
  setSettleScale,
}: {
  arcRadiusMode: ArcRadiusMode;
  setArcRadiusMode: (m: ArcRadiusMode) => void;
  arcScale: number;
  setArcScale: (n: number) => void;
  dynamicArc: boolean;
  setDynamicArc: (b: boolean) => void;
  arcStart: number;
  setArcStart: (n: number) => void;
  arcMid: number;
  setArcMid: (n: number) => void;
  arcEnd: number;
  setArcEnd: (n: number) => void;
  commitAt: number;
  setCommitAt: (n: number) => void;
  settleScale: number;
  setSettleScale: (n: number) => void;
}) {
  return (
    <div className="controls">
      <fieldset>
        <legend>arc radius mode</legend>
        <label>
          <input
            type="radio"
            name="arcMode"
            checked={arcRadiusMode === "anchor"}
            onChange={() => setArcRadiusMode("anchor")}
          />
          anchor (shipped)
        </label>
        <label>
          <input
            type="radio"
            name="arcMode"
            checked={arcRadiusMode === "farthest"}
            onChange={() => setArcRadiusMode("farthest")}
          />
          farthest corner (candidate)
        </label>
      </fieldset>
      <fieldset className={dynamicArc ? "" : "dim"}>
        <legend>
          <label>
            <input type="checkbox" checked={dynamicArc} onChange={(e) => setDynamicArc(e.currentTarget.checked)} />
            dynamic arc (start → middle → end)
          </label>
        </legend>
        <label className="slider">
          @ start <span className="value">{arcStart.toFixed(2)}×</span>
          <input
            type="range"
            min={0.3}
            max={2.2}
            step={0.02}
            value={arcStart}
            disabled={!dynamicArc}
            onChange={(e) => setArcStart(Number(e.currentTarget.value))}
          />
        </label>
        <label className="slider">
          @ middle <span className="value">{arcMid.toFixed(2)}×</span>
          <input
            type="range"
            min={0.3}
            max={2.2}
            step={0.02}
            value={arcMid}
            disabled={!dynamicArc}
            onChange={(e) => setArcMid(Number(e.currentTarget.value))}
          />
        </label>
        <label className="slider">
          @ end <span className="value">{arcEnd.toFixed(2)}×</span>
          <input
            type="range"
            min={0.3}
            max={2.2}
            step={0.02}
            value={arcEnd}
            disabled={!dynamicArc}
            onChange={(e) => setArcEnd(Number(e.currentTarget.value))}
          />
        </label>
      </fieldset>
      <label className={`slider${dynamicArc ? " dim" : ""}`}>
        arc size (flat) <span className="value">{arcScale.toFixed(2)}×</span>
        <input
          type="range"
          min={0.3}
          max={2.2}
          step={0.02}
          value={arcScale}
          disabled={dynamicArc}
          onChange={(e) => setArcScale(Number(e.currentTarget.value))}
        />
      </label>
      <label className="slider">
        commit threshold <span className="value">{commitAt.toFixed(3)}</span>
        <input
          type="range"
          min={0.02}
          max={0.6}
          step={0.001}
          value={commitAt}
          onChange={(e) => setCommitAt(Number(e.currentTarget.value))}
        />
      </label>
      <label className="slider">
        settle speed <span className="value">{settleScale.toFixed(2)}×</span>
        <input
          type="range"
          min={0.2}
          max={5}
          step={0.05}
          value={settleScale}
          onChange={(e) => setSettleScale(Number(e.currentTarget.value))}
        />
      </label>
    </div>
  );
}

createRoot(document.getElementById("grid")!).render(
  <Scene3DProvider>
    <Harness />
  </Scene3DProvider>,
);
