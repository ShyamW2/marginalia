import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { EpubRenderer } from "./renderer/epub/EpubRenderer.js";
import {
  animate,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import type { PageTransition, SpreadMode } from "@marginalia/shared";
import { capturePageSnapshot } from "./pageSnapshot.js";
import {
  cardLayout,
  composeCardSnapshot,
  loadSnapshotImage,
  resolveCardPaper,
  type CardLayout,
} from "./cardSnapshot.js";
import {
  anchorForPinch,
  anchorPoint,
  curlArcLength,
  defaultPinchForDirection,
  hingeRelease,
  hingeSettlePointer,
  settleArc,
  syntheticHingePointer,
  type ArcRadiusMode,
  type FoldAnchor,
  type Point,
} from "./pageFold.js";
import { declaredTurnDirection, farLeafRect, nearLeafRect } from "./readerGeometry.js";
import { useScene3DAvailable } from "../scene3d/Scene3D.js";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Deadline on compositing the card bitmap, mirroring the capture's own
 * (pageSnapshot.ts). Generous: it is a single decode of a bitmap the browser
 * has already rasterized once. */
const COMPOSE_TIMEOUT_MS = 400;

/**
 * Deadlines on the release path (decisions.md 2026-08-03: "a turn gesture
 * gets exactly one exit, it runs in a `finally`, and it is reachable without
 * the release event").
 *
 * A `finally` alone is not enough, because the failures that stranded a
 * gesture were *hangs* rather than throws — a promise that never settles
 * never reaches a `finally` either. So every await on the way out is raced
 * against a deadline: a step that misses it is abandoned, not waited on.
 * `RENDITION_STEP_MS` is generous because a spine-boundary step loads and
 * lays out a whole new section.
 */
const RENDITION_STEP_MS = 2500;
const SETTLE_ANIM_MS = 1200;
/** How often a live gesture checks that it still holds the pointer. Reproduced
 * 2026-08-03: if the grab surface unmounts mid-drag (a re-pagination flips
 * `status` to loading), capture is released to the sandboxed epub.js iframe,
 * the page stops receiving pointer input, and the release event never
 * arrives — so a gesture cannot rely on being told when it ends. */
const CAPTURE_POLL_MS = 700;
/** The M10 low-fps downgrade, in `drawPageFold` milliseconds. 33ms is one
 * whole frame at 30fps spent drawing the fold and nothing else — applied to
 * the p90 of drawn frames (M27), so it means "one frame in ten costs that",
 * not "the typical frame does". */
const MAX_DRAW_MS = 33;
/** …and never on fewer than this many drawn frames. A click turn draws ~25;
 * a two-frame flick must not be able to latch a downgrade for the session. */
const MIN_DRAW_SAMPLES = 12;
/** Absolute ceiling on the turn lock. Nothing legitimate holds it this long;
 * a lock older than this is a bug, not a state, and the reader must not have
 * to reload to turn a page again. */
const MAX_GESTURE_MS = 60_000;

/**
 * M27's shipped hinge tuning — the operator's own numbers off
 * `harness/pageCone.html`'s control panel (2026-08-26), not a guess carried
 * over from the flat model's. Four things, and none of them is the flat
 * model's corresponding constant:
 *
 * - `ARC_RADIUS_MODE` is `"anchor"` (`ArcRadiusMode` in `pageFold.ts`) — the
 *   `"farthest corner"` candidate was tried and not what shipped.
 * - `ARC_CURVE` is a multiplier on `curlArcLength`, piecewise-linear over the
 *   turn's own angular progress (`HingeRelease.progress`, 0 at rest, 1 fully
 *   turned) rather than the flat model's single constant — a constant fights
 *   `computeConeFold`'s own sweep cap (the roll cannot claim more angle than
 *   the drag has swept), which is tightest mid-turn, so a big-enough constant
 *   made a drag stall short of the spine. Big early, easing down through the
 *   middle, easing further down late — the operator's own curve, found by
 *   feel rather than derived.
 * - `COMMIT_AT` is read in the hinge's own coordinate (`HingeRelease.progress`,
 *   angular) and **is not `0.35`**: a hinge's turn spans the anchor to its own
 *   mirror across the spine, two leaf widths of travel where the flat model's
 *   threshold was tuned in one, so the same felt commit point is a smaller
 *   fraction here. See `harness/pageCone.html`'s own `COMMIT_AT` comment for
 *   the derivation; `0.271` is the operator's tuned value, not that derivation's.
 * - `SETTLE_SCALE` scales both the commit-swing and the spring-back durations,
 *   same as the harness's `?settle=`.
 */
export const HINGE_ARC_RADIUS_MODE: ArcRadiusMode = "anchor";
const HINGE_ARC_CURVE = { start: 2.2, mid: 1.44, end: 0.4 };
const HINGE_COMMIT_AT = 0.271;
const HINGE_SETTLE_SCALE = 1.7;
const HINGE_COMMIT_SECONDS = 0.16 * HINGE_SETTLE_SCALE;
const HINGE_SPRING_BACK_SECONDS = 0.18 * HINGE_SETTLE_SCALE;

/** `HINGE_ARC_CURVE` evaluated at a point in the turn — see the constant's own
 * comment for why this varies at all. Piecewise-linear through (0, start),
 * (0.5, mid), (1, end), same shape the harness's `arcMultiplierAt` tunes. */
function hingeArcTarget(progress: number, leafWidth: number, leafHeight: number): number {
  const t = Math.min(1, Math.max(0, progress));
  const { start, mid, end } = HINGE_ARC_CURVE;
  const multiplier = t <= 0.5 ? start + (mid - start) * (t / 0.5) : mid + (end - mid) * ((t - 0.5) / 0.5);
  return curlArcLength(leafWidth, leafHeight) * multiplier;
}

/** Awaits `work`, but never for longer than `ms`, and never throws. Returns
 * false when the step was abandoned — the caller carries on regardless,
 * which is the entire point. */
async function withDeadline(work: unknown, ms: number): Promise<boolean> {
  let timer = 0;
  const settled = await Promise.race([
    Promise.resolve(work).then(
      () => true,
      () => false,
    ),
    new Promise<false>((resolve) => {
      timer = window.setTimeout(() => resolve(false), ms);
    }),
  ]);
  window.clearTimeout(timer);
  return settled;
}

export interface PageCurlState {
  /** The departing card's bitmap — the page snapshot composited over the
   * reader margin (cardSnapshot.ts). */
  image: HTMLCanvasElement;
  anchor: FoldAnchor;
  leafX: number;
  stageWidth: number;
  leafWidth: number;
  leafHeight: number;
  /** Where the **other**, non-turning leaf sits on this same departing
   * bitmap — M27's far-leaf-pre-flip fix. In spread mode the drag advances
   * the rendition at grab time, so the far leaf's live DOM shows the *next*
   * spread's content from the first frame while this bitmap still has its
   * old one; a consumer covers the far leaf with this slice of `image` for
   * as long as `PageCurlState` is non-null, and drops it exactly when this
   * does. Equal to `leafX` in single-page mode, where there is no far leaf —
   * a consumer renders the cover only when the two differ. */
  farX: number;
}

/** M20 step 3: the departing card of a *slide* turn — the same capture, one
 * step short of the curl's (no canvas composite; see PageSlide.tsx). */
export interface PageSlideState {
  image: HTMLImageElement;
  layout: CardLayout;
  paper: string | null;
}

/**
 * Which renderer a turn gets. Resolved per turn, never cached, because every
 * input to it can change between turns (the reader flips the setting, the
 * fold trips the low-fps guard, a capture fails).
 *
 * The ladder, in order, and it only ever descends (decisions.md 2026-08-03,
 * "the setting is a ceiling, not a mode switch"):
 *
 * | condition | renderer |
 * |---|---|
 * | reduced motion | `instant` — no animation at all |
 * | `pageTransition: "slide"` | `slide` |
 * | the low-fps guard has tripped | `slide` |
 * | otherwise | `curl` |
 *
 * and below all four, a capture that fails degrades to M7's dip-and-recover
 * (`turnPageSlide`), which needs no bitmap. Nothing anywhere promotes a turn
 * *up* to the curl: `"slide"` is checked before the guard, so no machine, no
 * capture and no code path can put a canvas on screen while it is on.
 */
type TurnRenderer = "instant" | "slide" | "curl";

/**
 * The reader's page-turn animation: the M7 dip-and-recover slide, the M10
 * snapshot-based curl it upgrades to (M20: a perpendicular-bisector paper
 * fold on canvas, decisions.md 2026-07-20 — see pageFold.ts), and the
 * drag-to-peel gesture that drives the same fold by hand. Extracted
 * verbatim from ReaderView.tsx (M19.8 refactor), then reworked for M20's
 * fold geometry.
 *
 * Owns its own animation state (the live fold pointer, the current
 * snapshot, the turn lock, the low-fps downgrade) — callers only need a
 * rendition, the container epub.js renders into, and the current spread
 * mode (M20 "spread-aware": the fold peels the near leaf only).
 */
export interface PageTurnAnimationOptions {
  rendererRef: RefObject<EpubRenderer | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  /** The paper card — `.pageClip`, the box the fold canvas is positioned
   * inside and the sheet the reader actually sees. Every rect the fold works
   * in is measured from this, not from `containerRef`, which is the text
   * column one reader margin inside it. */
  cardRef: RefObject<HTMLDivElement | null>;
  /** The live stage — `.marginWrapper`, the card's whole content including
   * the reader margin. The slide translates *this*, so the incoming page
   * arrives as the real DOM rather than as a second snapshot: one capture
   * per turn, and one failure path (decisions.md 2026-08-03). Written to
   * imperatively, per pointermove, for the same reason the fold pointer is a
   * ref — a transform per frame must not cost a React render. */
  stageRef: RefObject<HTMLDivElement | null>;
  spreadMode: SpreadMode;
  /** The reader's choice, and a ceiling on the ladder below — see
   * `TurnRenderer`. Read at turn time, so flipping it takes effect on the
   * next turn with no reload and no remount. */
  pageTransition: PageTransition;
}

export function usePageTurnAnimation({
  rendererRef,
  containerRef,
  cardRef,
  stageRef,
  spreadMode,
  pageTransition,
}: PageTurnAnimationOptions): {
  stageControls: ReturnType<typeof useAnimationControls>;
  stageReducedMotion: boolean | null;
  curl: PageCurlState | null;
  slide: PageSlideState | null;
  /** A drag is in flight — keep the grab surface mounted (see below). */
  gestureActive: boolean;
  getFoldPointer: () => Point;
  /** The roll's live physical target, in px — `HINGE_ARC_CURVE` evaluated at
   * wherever the gesture currently is. Sampled per frame by `PageFold3D`
   * (its `getArc`), for the same reason `getFoldPointer` is a function. */
  getFoldArc: () => number;
  /** The turning leaf's top-left in viewport CSS px — `PageFold3D`'s
   * `getOrigin`. See `originRef`'s own comment for why it is cached. */
  getFoldOrigin: () => Point;
  /** The back of the turning sheet, or null while its capture is in flight
   * (M27). Sampled per frame by `PageCurl`; see `backCardRef`. */
  getFoldBack: () => { image: HTMLCanvasElement; leafX: number } | null;
  handleDrawCost: (p90DrawMs: number, samples: number) => void;
  turnPage: (direction: "prev" | "next") => Promise<void>;
  /** M21 (AUDIO.md: "the slide, not M10's curl" for auto-turn-while-listening
   * — a turn every ~30s must never cost a snapshot capture that could stall
   * audio). The M7 dip-and-recover fallback, called directly rather than
   * through `turnPage`'s `resolveRenderer()` ladder so a reader's curl
   * preference can never leak into an audio-driven turn. Shares
   * `turnLockRef` with `turnPage` (see `turnPageSlideGuarded`'s comment) —
   * use that, not this, from the audio auto-turn effect. */
  turnPageSlide: (direction: "prev" | "next") => Promise<void>;
  /** The audio auto-turn effect's entry point for "next/prev page, same
   * section" — `turnPageSlide` guarded by `turnLockRef` so it can never run
   * concurrently with a manual `turnPage` or with another auto-turn call. */
  turnPageSlideGuarded: (direction: "prev" | "next") => Promise<void>;
  /** The audio auto-turn effect's entry point for "the audio moved to a
   * different section" (a chapter skip, or advancing past the last sentence
   * of one) — jumps straight there in one `rendition.display()` call instead
   * of walking single pages toward it, and is likewise `turnLockRef`-guarded. */
  turnPageSlideToSectionGuarded: (spineIndex: number) => Promise<void>;
  /** ⚠️ M31 A5: takes no direction. The press arms; the drag decides. */
  handleGrabPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const stageControls = useAnimationControls();
  const stageReducedMotion = useReducedMotion();
  // M27: the cone is a consumer of the app's one 3D seam (settled decision
  // 14), not a second canvas — which is where the lost-context degrade comes
  // from free. See `resolveRenderer`.
  const scene3DAvailable = useScene3DAvailable();
  // M10 page curl: guards against overlapping turns (rapid key/gesture
  // repeats), and a device that's proven too slow to keep the fold at a
  // real frame rate. M20: turnProgress stays the 0-1 scalar the commit/
  // spring-back threshold and settle animations are driven by, but the
  // canvas itself reads the live fold pointer (pointerRef) — a function
  // ref rather than a MotionValue so PageCurl's own rAF loop can sample it
  // without forcing a React re-render every frame.
  const turnLockRef = useRef(false);
  const lowFpsRef = useRef(false);
  // M20 step 3: shared by both renderers, which is the point — "the two
  // transitions are the same gesture with a different renderer", so the
  // commit threshold, the spring-back and the settle animations are written
  // once against this scalar and read by whichever renderer is mounted.
  const turnProgress = useMotionValue(0);
  const pointerRef = useRef<Point>({ x: 0, y: 0 });
  /** The hinge's own live arc target — `HINGE_ARC_CURVE` evaluated at the
   * gesture's current progress. A ref for the same reason `pointerRef` is:
   * written from a live pointermove and from a settle animation's `onUpdate`,
   * neither of which may cost a React render. */
  const foldArcRef = useRef<number>(0);
  /**
   * The back of the turning sheet — the post-advance card and which half of
   * it the back page is (M27). Sampled per frame by `PageCurl` for the same
   * reason `pointerRef` is: it lands *during* a fold, and a prop would
   * remount the canvas mid-gesture.
   *
   * Cleared by `beginBackCapture` at the top of every turn, so a capture
   * that lands after its own fold has ended can never print the wrong page
   * on the next one.
   */
  const backCardRef = useRef<{ image: HTMLCanvasElement; leafX: number } | null>(null);
  const [curl, setCurl] = useState<PageCurlState | null>(null);
  const [slide, setSlide] = useState<PageSlideState | null>(null);
  // True from pointer-down to the gesture's one exit. The caller keeps the
  // grab surface mounted while it is true: unmounting the element that holds
  // the pointer capture hands the rest of the drag to the sandboxed epub.js
  // iframe, after which no release event ever arrives (PAGE_CURL.md §9).
  const [gestureActive, setGestureActive] = useState(false);

  /**
   * The turning leaf's top-left in viewport CSS px — `PageFold3D`'s own
   * `getOrigin`, the hinge's counterpart to `PageCurl`'s `left`/`top` inline
   * style (the shared 3D canvas is viewport-fixed, so its consumers place
   * themselves in viewport coordinates rather than a CSS-positioned parent).
   * Cached rather than a fresh `getBoundingClientRect` every frame — refreshed
   * at the start of every turn (where `cardRect` is already being measured
   * for other reasons) and on a window resize, same as the harness's own
   * `readOrigin`.
   */
  const originRef = useRef<Point>({ x: 0, y: 0 });
  const activeLeafXRef = useRef(0);
  const readOrigin = useCallback(() => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect) originRef.current = { x: rect.left + activeLeafXRef.current, y: rect.top };
  }, [cardRef]);
  useEffect(() => {
    window.addEventListener("resize", readOrigin);
    return () => window.removeEventListener("resize", readOrigin);
  }, [readOrigin]);

  const getFoldPointer = useCallback(() => pointerRef.current, []);
  const getFoldArc = useCallback(() => foldArcRef.current, []);
  const getFoldOrigin = useCallback(() => originRef.current, []);
  const getFoldBack = useCallback(() => backCardRef.current, []);

  /**
   * The one capture, shared by both renderers: `pageSnapshot`'s bitmap of the
   * text column, where it sits inside the card, and the card's own paper
   * colour. `null` means "no snapshot-based turn is possible" — a failed
   * capture, a card that isn't laid out yet — and every caller degrades to
   * M7's dip.
   */
  const captureCardParts = useCallback(async () => {
    const container = containerRef.current;
    const card = cardRef.current;
    if (!container || !card) return null;
    const cardRect = card.getBoundingClientRect();
    const contentRect = container.getBoundingClientRect();
    const src = await capturePageSnapshot(container);
    if (!src) return null;
    return {
      src,
      layout: cardLayout(cardRect, contentRect),
      paper: resolveCardPaper(card),
      cardRect,
      contentWidth: contentRect.width,
    };
  }, [containerRef, cardRef]);

  /**
   * The curl's departing card: the capture composited over the reader margin
   * into one canvas, plus the rects the fold's geometry is expressed in.
   *
   * The compose step gets its own deadline for the same reason the capture
   * does (M10, PAGE_CURL.md §3): a stalled decode must never freeze reading.
   */
  const captureCard = useCallback(async () => {
    const parts = await captureCardParts();
    if (!parts) return null;
    const image = await Promise.race([
      composeCardSnapshot(parts.src, parts.layout, parts.paper),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), COMPOSE_TIMEOUT_MS);
      }),
    ]);
    if (!image) return null;
    return { image, cardRect: parts.cardRect, contentWidth: parts.contentWidth };
  }, [captureCardParts]);

  /**
   * Every turn takes a fresh token, and taking one clears the back of the
   * sheet. A second capture that resolves after its own fold has ended is
   * then dropped instead of printing the previous turn's page onto whatever
   * fold is live now — the one way this could show visibly wrong content.
   */
  const backTurnRef = useRef(0);
  const beginTurn = useCallback(() => {
    backCardRef.current = null;
    return ++backTurnRef.current;
  }, []);

  /**
   * The **second** capture: the post-advance card, which is the back of the
   * sheet currently lifting (M27, decisions.md 2026-08-03 "sign-off"). Only
   * meaningful once the rendition has stepped, because that is what puts the
   * back page on screen — there is no hidden rendition and no second epub.js
   * instance.
   *
   * **Deliberately not awaited, and that call was measured rather than
   * guessed** (NOTES.md "M27 — when the back is first visible"). The capture
   * costs ~22ms; the first back-facing *tail* pixel — the flat surface where
   * readable back-page text can land — does not exist until the fold pointer
   * has travelled `0.582 x arc` from the anchor, which is frame 4 (~67ms)
   * into a 420ms click/keyboard sweep and ~98 CSS px of travel in a drag. So
   * the capture wins the race with room to spare, and blocking the grab on
   * it would cost every reader 22ms of latency to avoid a state they cannot
   * see. Until it lands the fold paints the pre-M27 mirror.
   */
  const captureBackOfSheet = useCallback(
    (token: number, direction: "prev" | "next", cardRect: DOMRect, contentWidth: number) => {
      void captureCard().then((back) => {
        if (!back || backTurnRef.current !== token) return;
        const far = farLeafRect(
          cardRect.width,
          cardRect.height,
          contentWidth,
          spreadMode,
          direction,
        );
        backCardRef.current = { image: back.image, leafX: far.x };
      });
    },
    [captureCard, spreadMode],
  );

  /**
   * The slide's departing card: the same capture, decoded but *not*
   * composited. The margin band is PageSlide's own background instead of a
   * canvas fill, which saves a canvas, a full-card blit and a second decode
   * per turn — and is what keeps "no canvas mounts while Slide is on" true as
   * a literal count rather than as a figure of speech.
   *
   * Decoded here rather than in the component so the image cannot paint blank
   * for a frame at the moment the reader grabs the page; same deadline as the
   * curl's composite, for the same reason.
   */
  const captureCardImage = useCallback(async (): Promise<
    (PageSlideState & { cardRect: DOMRect }) | null
  > => {
    const parts = await captureCardParts();
    if (!parts) return null;
    const image = await Promise.race([
      loadSnapshotImage(parts.src),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), COMPOSE_TIMEOUT_MS);
      }),
    ]);
    if (!image?.naturalWidth) return null;
    return { image, layout: parts.layout, paper: parts.paper, cardRect: parts.cardRect };
  }, [captureCardParts]);

  /**
   * Where the incoming page sits at a given turn progress, in CSS px along
   * the card. 0 = entirely off the card, on the side it comes from; 1 =
   * exactly over it. A `next` turn arrives from the right, a `prev` from the
   * left — the book's own direction, not the reading direction, which is
   * deliberately out of scope until an RTL book is in the library
   * (decisions.md 2026-08-03).
   */
  const slideOffsetPx = (
    direction: "prev" | "next",
    cardWidth: number,
    progress: number,
  ): number => (direction === "next" ? 1 : -1) * cardWidth * (1 - clamp01(progress));

  /** The live stage's transform, written straight to the DOM. `null` clears
   * it — the gesture's exit does this unconditionally, so no failure can
   * leave the reading pane parked off its own card. */
  const applyStageOffset = useCallback(
    (dx: number | null) => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.style.transform = dx === null ? "" : `translate3d(${dx}px, 0, 0)`;
    },
    [stageRef],
  );

  const nextFrame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  /** The ladder, in one place. See `TurnRenderer`.
   *
   * M27: `scene3DAvailable` folds in `webglcontextlost` (and no-WebGL) as a
   * designed state rather than a crash — settled decision 14's "a lost
   * context stays a designed state, but is recoverable". It also repeats
   * `!stageReducedMotion`, already checked above; that overlap is harmless
   * and keeps this ladder correct even if the two checks are ever reordered. */
  const resolveRenderer = useCallback((): TurnRenderer => {
    if (stageReducedMotion) return "instant";
    if (pageTransition === "slide") return "slide";
    if (lowFpsRef.current) return "slide";
    if (!scene3DAvailable) return "slide";
    return "curl";
  }, [stageReducedMotion, pageTransition, scene3DAvailable]);

  const handleDrawCost = useCallback((p90DrawMs: number, samples: number) => {
    // One frame in ten eating a whole 30fps frame drawing the fold and
    // nothing else — this machine cannot keep the fold at a real frame rate,
    // so stop paying for it and use the slide.
    //
    // The threshold has not moved; what it is applied to has, twice.
    // Originally the mean *frame interval* over the canvas's whole mount,
    // which was reading vsync and latched a downgrade on almost every
    // reader's first turn (operator bug, 2026-08-03: "Curl curls the first
    // page, then slides forever"). Then the median draw cost, which measures
    // the fold but reads its dead tail: `SWEEP_OVERSHOOT` puts about half a
    // programmatic turn's frames after the sheet has left the leaf, so the
    // median reported 0.9ms on a turn whose worst frame was 27.8ms and the
    // guard could not notice a stutter the operator could see (M27).
    //
    // p90 keeps what the median was chosen for — a one-way switch must not be
    // decided by the one frame a GC landed on — while reading the frames the
    // reader is actually looking at. See `drawCostP90`.
    if (samples < MIN_DRAW_SAMPLES) return;
    if (import.meta.env.DEV) {
      console.debug(
        `[marginalia] fold draw cost: p90 ${p90DrawMs.toFixed(1)}ms over ${samples} frames` +
          `${p90DrawMs > MAX_DRAW_MS ? " — downgrading to the slide from here on" : ""}`,
      );
    }
    if (p90DrawMs > MAX_DRAW_MS) lowFpsRef.current = true;
  }, []);

  // M7's dip-and-recover slide — kept as the fallback under reduced motion,
  // when a snapshot capture fails, and (via lowFpsRef below) once the fold
  // has proven itself too slow on this device.
  const turnPageSlide = useCallback(
    async (direction: "prev" | "next") => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      if (stageReducedMotion) {
        if (direction === "prev") void renderer.prev();
        else void renderer.next();
        return;
      }
      const dx = direction === "next" ? -6 : 6;
      await stageControls.start({
        opacity: 0.55,
        x: dx,
        transition: { duration: 0.09, ease: "easeOut" },
      });
      if (direction === "prev") void renderer.prev();
      else void renderer.next();
      await stageControls.start({
        opacity: 1,
        x: 0,
        transition: { duration: 0.13, ease: "easeOut" },
      });
    },
    [stageControls, stageReducedMotion],
  );

  // M21 fix (operator-reported: "jumping chapters keeps jumping forward and
  // back constantly"). Root cause was two-fold: (1) `turnPageSlide` above is
  // called directly by the audio auto-turn effect, bypassing `turnPage`'s own
  // `turnLockRef` entirely — so a manual turn (drag, arrow key, click) and an
  // audio-driven catch-up turn could run concurrently, each stepping
  // `rendition` from underneath the other; and (2) the auto-turn effect used
  // to reach a *different section* (a skip-chapter jump, or skip-sentence
  // across a boundary) by repeatedly calling `turnPageSlide("next"/"prev")`
  // one page at a time — each step re-triggers `relocated`, which re-runs the
  // effect, which computed a fresh direction from refs that could disagree
  // with a concurrent manual turn, producing exactly the observed forward/
  // back thrash. `turnPageSlideToSection` below jumps straight to the target
  // section in one `rendition.display()` call — the same mechanism the plain
  // (non-audio) chapter-jump already uses — so a distant chapter skip is one
  // atomic move, never a chain of single-page corrections. Both this and
  // `turnPageSlide` are wrapped in `withTurnLock` so every auto-turn call now
  // shares `turnLockRef` with `turnPage`: whichever fires second while the
  // other is mid-animation just no-ops, and the next `relocated`'s `turnTick`
  // bump gives the effect another chance once the lock clears.
  const turnPageSlideToSection = useCallback(
    async (spineIndex: number) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      if (stageReducedMotion) {
        await renderer.goToSpineIndex(spineIndex);
        return;
      }
      await stageControls.start({
        opacity: 0.55,
        transition: { duration: 0.09, ease: "easeOut" },
      });
      await renderer.goToSpineIndex(spineIndex);
      await stageControls.start({
        opacity: 1,
        transition: { duration: 0.13, ease: "easeOut" },
      });
    },
    [stageControls, stageReducedMotion, rendererRef],
  );

  const withTurnLock = useCallback(async (work: () => Promise<void>) => {
    if (turnLockRef.current) return;
    turnLockRef.current = true;
    try {
      await work();
    } finally {
      turnLockRef.current = false;
    }
  }, []);

  const turnPageSlideGuarded = useCallback(
    (direction: "prev" | "next") => withTurnLock(() => turnPageSlide(direction)),
    [withTurnLock, turnPageSlide],
  );

  const turnPageSlideToSectionGuarded = useCallback(
    (spineIndex: number) => withTurnLock(() => turnPageSlideToSection(spineIndex)),
    [withTurnLock, turnPageSlideToSection],
  );

  // M20's paper fold (decisions.md 2026-07-20), M27'd (decisions.md
  // 2026-08-26) into the hinge: the departing page is rasterized to a bitmap
  // (pageSnapshot.ts, which includes the marks-pane SVG overlay for free — a
  // DOM sibling of the iframe inside the captured container, not inside the
  // iframe — see NOTES.md M2/M3 friction) that turns on a cone anchored at
  // the spine, its (synthetic, for a programmatic turn) pointer sweeping
  // anchor-to-mirror. The live DOM underneath is swapped to the new page
  // *before* the fold plays, hidden behind the snapshot, so "swap to live DOM
  // on settle" falls out of the canvas unmounting when the fold completes.
  const turnPageCurl = useCallback(
    async (direction: "prev" | "next") => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      const token = beginTurn();
      const card = await captureCard();
      if (!card) {
        await turnPageSlide(direction);
        return;
      }

      const { cardRect } = card;
      const leaf = nearLeafRect(
        cardRect.width,
        cardRect.height,
        card.contentWidth,
        spreadMode,
        direction,
      );
      const far = farLeafRect(
        cardRect.width,
        cardRect.height,
        card.contentWidth,
        spreadMode,
        direction,
      );
      const anchor = defaultPinchForDirection(direction);

      turnProgress.set(0);
      pointerRef.current = anchorPoint(anchor, leaf.width, leaf.height);
      foldArcRef.current = hingeArcTarget(0, leaf.width, leaf.height);
      activeLeafXRef.current = leaf.x;
      readOrigin();
      setCurl({
        image: card.image,
        anchor,
        leafX: leaf.x,
        stageWidth: cardRect.width,
        leafWidth: leaf.width,
        leafHeight: leaf.height,
        farX: far.x,
      });

      // Same one-exit rule as the drag gesture (decisions.md 2026-08-03): a
      // rendition step that rejects or an animation that never settles must
      // not leave the snapshot mounted over a page the reader can no longer
      // turn.
      try {
        await withDeadline(
          direction === "prev" ? renderer.prev() : renderer.next(),
          RENDITION_STEP_MS,
        );
        // Let epub.js actually paint the new section before revealing it —
        // the snapshot is still covering the stage at full opacity.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        // The stage is now showing the destination spread, so the back of
        // the sheet is capturable. Fired here, unawaited, so it races the
        // sweep rather than delaying it.
        captureBackOfSheet(token, direction, cardRect, card.contentWidth);

        await withDeadline(
          animate(turnProgress, 1, {
            duration: 0.42,
            ease: [0.4, 0, 0.2, 1],
            onUpdate: (v) => {
              // `v` is the pixel-linear anchor-to-mirror path
              // `syntheticHingePointer` describes, which is reachable and
              // monotonic 0→1 by construction (no `hingeRelease` needed to
              // find "how far along" — unlike a real drag, this path was
              // never going to be clamped). Used directly as the arc curve's
              // own progress input for the same reason: a close-enough proxy
              // for `HingeRelease.progress` on the one path guaranteed to
              // reach 1.
              pointerRef.current = syntheticHingePointer(anchor, leaf.width, leaf.height, v);
              foldArcRef.current = hingeArcTarget(v, leaf.width, leaf.height);
            },
          }),
          SETTLE_ANIM_MS,
        );
      } finally {
        setCurl(null);
      }
    },
    [turnProgress, turnPageSlide, spreadMode, captureCard, beginTurn, captureBackOfSheet, readOrigin],
  );

  /**
   * M20 step 3's slide (decisions.md 2026-08-03): **the next page slides
   * over the departing one**, not the departing page sliding away. The
   * departing card is a still bitmap under the stage; the live stage — the
   * real DOM, already stepped to the next page — translates in over it.
   *
   * Same shape as `turnPageCurl` above, one exit included, and the same
   * capture. Two differences worth stating:
   *
   * - The order of the swap is the other way round *and* it is genuinely
   *   hidden. The fold paints nothing at progress 0, so the curl's step has
   *   to race the animation; the slide's snapshot covers the whole card at
   *   progress 0, so the rendition can step behind it with nothing on screen
   *   moving at all.
   * - Nothing repaints per frame. The motion is one composited transform,
   *   which is why this is the cheap renderer and the one the low-fps guard
   *   falls back to.
   */
  const turnPageCardSlide = useCallback(
    async (direction: "prev" | "next") => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      const card = await captureCardImage();
      if (!card) {
        await turnPageSlide(direction);
        return;
      }
      const cardWidth = card.cardRect.width;

      turnProgress.set(0);
      setSlide({ image: card.image, layout: card.layout, paper: card.paper });

      try {
        // One frame for the still card to paint *underneath* the live stage,
        // which is still sitting at rest on top of it. Only then is the stage
        // pushed off the card — the reader sees nothing change, because the
        // snapshot it uncovers is the page that was already there.
        await nextFrame();
        applyStageOffset(slideOffsetPx(direction, cardWidth, 0));

        await withDeadline(
          direction === "prev" ? renderer.prev() : renderer.next(),
          RENDITION_STEP_MS,
        );
        await nextFrame();

        await withDeadline(
          animate(turnProgress, 1, {
            duration: 0.38,
            ease: [0.4, 0, 0.2, 1],
            onUpdate: (v) => applyStageOffset(slideOffsetPx(direction, cardWidth, v)),
          }),
          SETTLE_ANIM_MS,
        );
      } finally {
        applyStageOffset(null);
        setSlide(null);
      }
    },
    [turnProgress, turnPageSlide, captureCardImage, applyStageOffset, rendererRef],
  );

  const turnPage = useCallback(
    async (direction: "prev" | "next") => {
      if (turnLockRef.current) return;
      turnLockRef.current = true;
      try {
        const renderer = resolveRenderer();
        if (renderer === "curl") await turnPageCurl(direction);
        else if (renderer === "slide") await turnPageCardSlide(direction);
        // "instant": reduced motion, which turnPageSlide renders as a bare
        // rendition step — no canvas, no snapshot, no transform.
        else await turnPageSlide(direction);
      } finally {
        turnLockRef.current = false;
      }
    },
    [resolveRenderer, turnPageSlide, turnPageCurl, turnPageCardSlide],
  );

  // M20 "grab anywhere in the outer band": the 18px edgeGrab strips are
  // retired — the caller now wires this to the same wider, M11-shaped
  // surface the turn-zone vignette already announces (ReaderView.tsx), and
  // the fold anchors to what the grab is actually holding: a corner near the
  // ends of the edge, the *edge itself* in its middle third (2026-08-02 —
  // grabbing mid-edge used to snap to the nearer corner and then track the
  // pointer's y, which tilts a crease that should stay parallel to the
  // spine). Shares turnProgress/curl/turnLockRef with the click-triggered
  // fold above — same visual, driven a different way.
  //
  // ⚠️ **M31 A5: this is the drag proper, and nothing here runs on the press.**
  // The direction is handed in by `handleGrabPointerDown` below, which will not
  // call this until the drag has declared a dominant horizontal axis — the grab
  // surface is now all paper, so which side was pressed can no longer say which
  // way the page goes (DESIGN.md, "The pointer contract"). `down` is where the
  // paper was pinched; `declared` is where the pointer was when the axis was
  // settled, so the sheet picks up mid-gesture rather than snapping.
  const beginGrabDrag = useCallback(
    (
      surface: HTMLDivElement,
      pointerId: number,
      direction: "prev" | "next",
      down: { x: number; y: number },
      declared: { x: number; y: number },
    ) => {
      const container = containerRef.current;
      const card = cardRef.current;
      const renderer = rendererRef.current;
      if (!container || !card || !renderer) return;

      turnLockRef.current = true;
      setGestureActive(true);
      const token = beginTurn();
      const cardRect = card.getBoundingClientRect();
      const contentWidth = container.getBoundingClientRect().width;
      const leaf = nearLeafRect(
        cardRect.width,
        cardRect.height,
        contentWidth,
        spreadMode,
        direction,
      );
      const far = farLeafRect(cardRect.width, cardRect.height, contentWidth, spreadMode, direction);
      const edge: "left" | "right" = direction === "prev" ? "left" : "right";
      const grabY = down.y - cardRect.top;
      // The pinch is where the paper was grabbed — no band, no snap to the
      // nearer corner, no separate anchor kind for a corner vs. an edge (M27:
      // `EdgePinch` subsumes both, and a mid-edge pinch fans conically exactly
      // as a corner does; see `anchorForPinch`'s own docs for why).
      //
      // ⚠️ M31 A5: only the *height* of the grab survives, not its x. The grab
      // can now be anywhere on the paper — the spine gutter, the foot of the
      // page, the far leaf's outer margin — while the sheet that peels is
      // always the near leaf for the declared direction, so a grab x taken in
      // this leaf's own coordinates is frequently outside it and sometimes
      // negative. The turning edge is the direction's edge; the grab only says
      // how high up that edge the paper was taken.
      const anchor = anchorForPinch(edge, grabY, leaf.height);
      const anchorPx = anchorPoint(anchor, leaf.width, leaf.height);
      const dragRange = Math.max(leaf.width * 0.9, 120);

      /** The fold pointer for a pointer position, in leaf coordinates.
       *
       * ⚠️ M31 A5 changed what this means, and the change is load-bearing. It
       * used to be the raw grab point: fine while the surface was an ellipse
       * hugging the turning edge, where the grab already sat on the anchor and
       * `dist` started near zero. Grabbing mid-page would now start the fold
       * half-turned. So the pinched corner starts *at rest on the anchor* and
       * moves by the pointer's own travel — "the sheet follows the finger",
       * literally, and `dist` below becomes distance travelled. For a grab on
       * the edge (the old case) the two are the same point.
       *
       * Raw and unconstrained, unlike the flat model's `constrainFoldPointer`:
       * `computeConeFold` (via `hingeRelease`/`PageFold3D`) does its own
       * constraining internally (`constrainToSpineHinge`), following a pointer
       * past the paper's reach as far as the binding allows rather than
       * pinning it to a line up front. */
      const foldPointerFor = (clientX: number, clientY: number) => ({
        x: anchorPx.x + (clientX - down.x),
        y: anchorPx.y + (clientY - down.y),
      });

      pointerRef.current = foldPointerFor(declared.x, declared.y);
      foldArcRef.current = hingeArcTarget(0, leaf.width, leaf.height);
      activeLeafXRef.current = leaf.x;
      readOrigin();
      turnProgress.set(0);
      // M20 step 3: which renderer this drag is wearing, decided once at
      // grab time so a settings save mid-gesture cannot change the thing
      // already on screen. Everything below this line — the capture, the
      // advance-at-grab, the 0.35 threshold, the watchdog, the one exit — is
      // shared; the renderer only decides what a frame *looks* like.
      const useSlide = resolveRenderer() !== "curl";
      const cardWidth = cardRect.width;
      /** The departing card is mounted and the gesture may paint. */
      let ready = false;
      let advanced = false;

      // M20 step 2, "the drag reveals the next page": until now the rendition
      // was only advanced on *commit*, so for the whole drag the live DOM
      // under the canvas was still the page being peeled and the opening
      // revealed a pixel-identical copy of it. Advance as soon as the card
      // bitmap is up — the same thing `turnPageCurl` has always done for a
      // click turn — and step back if the drag springs back.
      // Where to put the reader back if this drag springs back. Recorded
      // before advancing and restored by CFI rather than by a blind `prev()`
      // — at a section boundary epub.js's own step back does not always land
      // where the drag began (decisions.md 2026-08-03).
      const startCfi: string | null = renderer.currentLocation()?.cfi ?? null;

      /** Mounts whichever departing card this drag needs, and leaves the
       * screen looking exactly as it did — the snapshot is pixel-identical to
       * the page under it, so pushing the live stage off the card behind it
       * changes nothing the reader can see. Returns false on a failed
       * capture, which is not an error: the drag simply never paints and
       * the release turns the page as a click would. */
      const openRenderer = async (): Promise<boolean> => {
        if (useSlide) {
          const captured = await captureCardImage();
          if (!captured) return false;
          setSlide({ image: captured.image, layout: captured.layout, paper: captured.paper });
          // One frame for the departing card to paint *before* the live stage
          // moves off it, so the swap happens behind the snapshot rather than
          // in front of it — same rule as the fold's, one renderer along.
          await nextFrame();
          applyStageOffset(slideOffsetPx(direction, cardWidth, turnProgress.get()));
          return true;
        }
        const captured = await captureCard();
        if (!captured) return false;
        setCurl({
          image: captured.image,
          anchor,
          leafX: leaf.x,
          stageWidth: cardRect.width,
          leafWidth: leaf.width,
          leafHeight: leaf.height,
          farX: far.x,
        });
        await nextFrame();
        return true;
      };

      const opened = openRenderer().then(async (mounted) => {
        if (!mounted) return;
        ready = true;
        if (direction === "prev") await renderer.prev();
        else await renderer.next();
        advanced = true;
        // The stage now shows the destination spread; the sheet the reader
        // is holding has its real other side on it. The slide has no back
        // face to print, so it does not pay for this.
        if (!useSlide) captureBackOfSheet(token, direction, cardRect, contentWidth);
      });

      const onMove = (moveEvent: PointerEvent) => {
        const { x: px, y: py } = foldPointerFor(moveEvent.clientX, moveEvent.clientY);
        pointerRef.current = { x: px, y: py };
        // Progress follows the *pointer*, not any constrained fold point: an
        // edge peel that refuses to tilt should still commit when you drag
        // far enough, however you got there. (This is the slide's own
        // pixel-linear progress, `turnProgress` — the curl's commit decision
        // below reads the hinge's own angular one, `HingeRelease.progress`,
        // which is a different coordinate; see `HINGE_COMMIT_AT`.)
        const dist = Math.hypot(px - anchorPx.x, py - anchorPx.y);
        const progress = clamp01(dist / dragRange);
        turnProgress.set(progress);
        // Tracked from the first move, painted only once there is something
        // to paint: a reader who flicks and then holds still through the
        // capture used to get a gesture stuck at progress 0, because the only
        // writer of `turnProgress` was gated on the bitmap that had not
        // landed yet.
        if (ready && useSlide) {
          applyStageOffset(slideOffsetPx(direction, cardWidth, progress));
        }
        // The roll's live target — read off the *current* pointer, live,
        // exactly as `getArc` needs it. `hingeRelease` needs no `arcTarget`
        // to compute `.progress` (it only reads the cone's apex), so this has
        // no circularity even though it feeds the very arc it will be handed.
        if (!useSlide) {
          const release = hingeRelease(anchor, pointerRef.current, leaf.width, leaf.height);
          if (release) foldArcRef.current = hingeArcTarget(release.progress, leaf.width, leaf.height);
        }
      };

      let finished = false;
      let poll = 0;
      let deadman = 0;

      const detach = () => {
        window.clearTimeout(poll);
        window.clearTimeout(deadman);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        surface.removeEventListener("lostpointercapture", onUp);
      };

      /**
       * The gesture's **one exit**. Every path out of a drag comes through
       * here — release, cancel, a lost pointer capture, the watchdog — and it
       * always ends with the fold unmounted and the turn lock clear, whatever
       * happened on the way. Before 2026-08-03 the unmount and the unlock
       * were this function's last two statements after a run of unguarded
       * awaits, so anything that rejected or hung stranded both: a curl
       * frozen mid-peel and a reader that had stopped responding to page
       * turns (PAGE_CURL.md §9).
       */
      const onUp = async () => {
        if (finished) return;
        finished = true;
        detach();
        try {
          // A release can beat the capture (a fast tap) or land mid-advance;
          // settle that first so the branches below know what is on screen.
          await withDeadline(opened, RENDITION_STEP_MS + COMPOSE_TIMEOUT_MS);

          const releasePointer = pointerRef.current;
          const startProgress = turnProgress.get();
          const shouldCommit = ready && startProgress > 0.35;
          // Shared by both renderers' spring-backs. By CFI, not by a blind
          // step: at a section boundary epub.js's own step back does not
          // always land where the drag began (decisions.md 2026-08-03).
          const stepBack = () =>
            startCfi
              ? renderer.goTo({ sectionIndex: 0, offset: 0, length: 0, cfi: startCfi })
              : direction === "prev"
                ? renderer.next()
                : renderer.prev();

          if (shouldCommit && useSlide) {
            await withDeadline(
              animate(turnProgress, 1, {
                duration: 0.16,
                ease: "easeOut",
                onUpdate: (v) => applyStageOffset(slideOffsetPx(direction, cardWidth, v)),
              }),
              SETTLE_ANIM_MS,
            );
          } else if (ready && useSlide) {
            // The slide steps back *after* its animation, which is the
            // opposite of the fold below — and for the same reason, stated
            // the other way round. The fold paints nothing once the pointer
            // is back on its anchor, so its step has to beat the animation or
            // the un-turned-to page shows full-screen. The slide's snapshot
            // covers the entire card at progress 0, so there is nothing to
            // see through: the page can fall closed first and epub.js can
            // take as long as it likes behind it.
            await withDeadline(
              animate(turnProgress, 0, {
                duration: 0.18,
                ease: "easeOut",
                onUpdate: (v) => applyStageOffset(slideOffsetPx(direction, cardWidth, v)),
              }),
              SETTLE_ANIM_MS,
            );
            if (advanced) await withDeadline(stepBack(), RENDITION_STEP_MS);
          } else if (ready) {
            // M27: the curl is now the hinge, and a bound sheet finishes its
            // own turn rather than being lerped toward one — a drag can never
            // reach the end (`constrainToSpineHinge`'s lens is where the
            // paper runs out first), so what happens on release is the sheet
            // swinging on the apex the release froze (`hingeRelease`), not a
            // pointer chasing a target. Commit-or-spring-back is decided in
            // the hinge's own angular coordinate — `HingeRelease.progress` —
            // not `startProgress`, which is pixel-based and tuned for the
            // slide; see `HINGE_COMMIT_AT`'s comment for why the two must not
            // be conflated.
            const release = hingeRelease(anchor, releasePointer, leaf.width, leaf.height);
            if (release) {
              const hingeCommit = release.progress > HINGE_COMMIT_AT;
              const sweep = hingeCommit ? release.toTurned : release.toRest;
              // Captured once at release, not read live off the curve for the
              // rest of the settle: a mid-settle arc change would jump the
              // curl (the same rule the harness's `arcAtRelease` follows).
              const arcAtRelease = hingeArcTarget(release.progress, leaf.width, leaf.height);
              // Same ordering rule as the flat model's, restated for the same
              // reason: the fold paints nothing once the pointer is back on
              // its own anchor (`computeConeFold`'s `travel < 0.01` branch),
              // so a spring-back's step back has to land *before* that frame
              // or the un-turned-to page shows full-screen while epub.js
              // works. A commit needs no step here — it already happened at
              // grab time.
              if (!hingeCommit && advanced) await withDeadline(stepBack(), RENDITION_STEP_MS);
              await withDeadline(
                animate(0, 1, {
                  duration: hingeCommit ? HINGE_COMMIT_SECONDS : HINGE_SPRING_BACK_SECONDS,
                  ease: "easeOut",
                  onUpdate: (t) => {
                    pointerRef.current = hingeSettlePointer(release, sweep * t);
                    // Only a landing relaxes the curl; a sheet falling back
                    // keeps its roll and simply un-peels — same rule as the
                    // harness's release, `settleArc`'s own docs.
                    foldArcRef.current = hingeCommit ? settleArc(arcAtRelease, t) : arcAtRelease;
                  },
                }),
                SETTLE_ANIM_MS,
              );
            }
          } else {
            // Snapshot never resolved before release (a very fast flick) — no
            // fold was ever visible, so run the turn as an animated one rather
            // than silently doing nothing. ⚠️ This is *not* a click: since M31
            // A5 nothing reaches here without a declared horizontal drag, so
            // the reader did ask for a page turn and is owed one; it just
            // outran the capture.
            turnLockRef.current = false;
            await withDeadline(turnPage(direction), RENDITION_STEP_MS + SETTLE_ANIM_MS);
          }
        } finally {
          // The one exit, and it is unconditional: the departing card is
          // unmounted and the live stage is put back on its own card whatever
          // happened above. A transform left behind here would park the
          // reading pane off the side of the page with no gesture running to
          // put it back — the slide's version of the stuck curl.
          applyStageOffset(null);
          setSlide(null);
          setCurl(null);
          setGestureActive(false);
          turnLockRef.current = false;
        }
      };

      // The watchdog. A gesture cannot rely on being *told* it has ended: if
      // the grab surface is unmounted mid-drag (a re-pagination flips
      // ReaderView's `status` to loading), pointer capture is released to the
      // sandboxed epub.js iframe and no release event ever arrives — the
      // reproduced cause of the frozen curl. Polling the capture itself is
      // what distinguishes that from a reader legitimately holding a peel
      // still for a while, which must not be interrupted. The exit is the
      // ordinary one, so the page falls closed through the same animation
      // rather than blinking out.
      const tick = () => {
        if (finished) return;
        if (!surface.isConnected || !surface.hasPointerCapture(pointerId)) {
          void onUp();
          return;
        }
        poll = window.setTimeout(tick, CAPTURE_POLL_MS);
      };
      poll = window.setTimeout(tick, CAPTURE_POLL_MS);
      // Belt to the finally's braces: the turn lock gets a maximum lifetime,
      // so even a failure nobody predicted costs one stuck turn and not a
      // reader that needs reloading.
      deadman = window.setTimeout(() => void onUp(), MAX_GESTURE_MS);

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      surface.addEventListener("lostpointercapture", onUp);
    },
    [
      turnProgress,
      spreadMode,
      turnPage,
      captureCard,
      captureCardImage,
      resolveRenderer,
      applyStageOffset,
      beginTurn,
      captureBackOfSheet,
      containerRef,
      cardRef,
      rendererRef,
      readOrigin,
    ],
  );

  /**
   * M31 A5, "direction from the drag, not the grab point" (DESIGN.md, "The
   * pointer contract"). The press only *arms*: it takes pointer capture and
   * then watches. Nothing is snapshotted, nothing is advanced and nothing is
   * painted until the pointer has travelled `DECLARE_DRAG_PX` along a dominant
   * horizontal axis — dragging **left** turns forward, **right** turns back,
   * and the sheet follows the finger from there.
   *
   * A press that never declares — a plain click, a vertical drag — releases
   * the capture and does nothing at all. That is the whole of "a click never
   * turns a page", and it also retires the advance-and-step-back a stray press
   * on the old edge strip used to cost.
   *
   * ⚠️ The axis stays under review for the life of the press rather than being
   * judged once: a reader who starts a peel with a small downward wobble is
   * still starting a peel, and the gesture should find them.
   */
  const handleGrabPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (turnLockRef.current) return;
      const surface = event.currentTarget;
      const pointerId = event.pointerId;
      const down = { x: event.clientX, y: event.clientY };

      // Taken at pointerdown, before the drag has declared, and it has to be:
      // capture needs a real parent-document `pointerdown` (the pointer
      // contract's invariant 2), and by the time 6px have been travelled the
      // pointer may already be over the sandboxed epub.js iframe, where there
      // is no second chance to ask for it. See `beginGrabDrag` for what an
      // uncaptured drag across that iframe did (NOTES.md M10 — a tab crash).
      surface.setPointerCapture(pointerId);

      const detach = () => {
        window.removeEventListener("pointermove", onArmMove);
        window.removeEventListener("pointerup", onArmEnd);
        window.removeEventListener("pointercancel", onArmEnd);
        surface.removeEventListener("lostpointercapture", onArmEnd);
      };

      function onArmMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        const direction = declaredTurnDirection(
          moveEvent.clientX - down.x,
          moveEvent.clientY - down.y,
        );
        if (!direction) return;
        detach();
        // ⚠️ Reduced motion still turns the page. Before M31 A1 a reader with
        // `prefers-reduced-motion` set turned pages by *clicking* the turn
        // zone — the grab surface was suppressed entirely, since there is no
        // peel to drag. Retiring the click without this branch would have left
        // them the `‹ ›` buttons and the arrow keys and nothing else on the
        // page itself, which is the contract quietly not applying to them. The
        // gesture is the same; only the animation is dropped, which is what
        // `resolveRenderer`'s "instant" already means everywhere else.
        if (stageReducedMotion) {
          if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
          void turnPage(direction);
          return;
        }
        beginGrabDrag(surface, pointerId, direction, down, {
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
      }

      function onArmEnd() {
        detach();
        // Handing the capture back matters: the surface is a live element the
        // reader keeps pointing at, and a capture left on it would swallow
        // hovers over the page underneath until the next press.
        if (surface.hasPointerCapture(pointerId)) surface.releasePointerCapture(pointerId);
      }

      window.addEventListener("pointermove", onArmMove);
      window.addEventListener("pointerup", onArmEnd);
      window.addEventListener("pointercancel", onArmEnd);
      surface.addEventListener("lostpointercapture", onArmEnd);
    },
    [beginGrabDrag, stageReducedMotion, turnPage],
  );

  return {
    stageControls,
    stageReducedMotion,
    curl,
    slide,
    gestureActive,
    getFoldPointer,
    getFoldArc,
    getFoldOrigin,
    getFoldBack,
    handleDrawCost,
    turnPage,
    turnPageSlide,
    turnPageSlideGuarded,
    turnPageSlideToSectionGuarded,
    handleGrabPointerDown,
  };
}
