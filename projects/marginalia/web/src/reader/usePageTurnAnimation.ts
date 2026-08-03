import { useCallback, useRef, useState, type RefObject } from "react";
import type { Rendition } from "epubjs";
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
  anchorForGrab,
  anchorPoint,
  constrainFoldPointer,
  defaultCornerForDirection,
  lerpPoint,
  syntheticFoldPointer,
  type FoldAnchor,
  type Point,
} from "./pageFold.js";
import { nearLeafRect } from "./readerGeometry.js";

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
 * whole frame at 30fps spent drawing the fold and nothing else. */
const MAX_DRAW_MS = 33;
/** …and never on fewer than this many drawn frames. A click turn draws ~25;
 * a two-frame flick must not be able to latch a downgrade for the session. */
const MIN_DRAW_SAMPLES = 12;
/** Absolute ceiling on the turn lock. Nothing legitimate holds it this long;
 * a lock older than this is a bug, not a state, and the reader must not have
 * to reload to turn a page again. */
const MAX_GESTURE_MS = 60_000;

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
  renditionRef: RefObject<Rendition | null>;
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
  renditionRef,
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
  handleDrawCost: (medianDrawMs: number, samples: number) => void;
  turnPage: (direction: "prev" | "next") => Promise<void>;
  handleGrabPointerDown: (
    direction: "prev" | "next",
    event: React.PointerEvent<HTMLDivElement>,
  ) => void;
} {
  const stageControls = useAnimationControls();
  const stageReducedMotion = useReducedMotion();
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
  const [curl, setCurl] = useState<PageCurlState | null>(null);
  const [slide, setSlide] = useState<PageSlideState | null>(null);
  // True from pointer-down to the gesture's one exit. The caller keeps the
  // grab surface mounted while it is true: unmounting the element that holds
  // the pointer capture hands the rest of the drag to the sandboxed epub.js
  // iframe, after which no release event ever arrives (PAGE_CURL.md §9).
  const [gestureActive, setGestureActive] = useState(false);

  const getFoldPointer = useCallback(() => pointerRef.current, []);

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

  /** The ladder, in one place. See `TurnRenderer`. */
  const resolveRenderer = useCallback((): TurnRenderer => {
    if (stageReducedMotion) return "instant";
    if (pageTransition === "slide") return "slide";
    if (lowFpsRef.current) return "slide";
    return "curl";
  }, [stageReducedMotion, pageTransition]);

  const handleDrawCost = useCallback((medianDrawMs: number, samples: number) => {
    // One `drawPageFold` eating a whole 30fps frame, at the *median* over a
    // turn — this machine cannot keep the fold at a real frame rate, so stop
    // paying for it and use the slide. The unit is the one PAGE_CURL.md §7
    // quotes (tuned rolled sheet: 15ms median in a software rasterizer).
    //
    // Rewritten 2026-08-03 from an operator bug — "Curl curls the first page,
    // then slides forever". The old test was the mean *frame interval* over
    // the canvas's whole mount, which is not the fold's cost: the canvas
    // mounts before `turnPageCurl` awaits its rendition step, so a single
    // slow section layout (with the fold drawing nothing throughout) pushed
    // the mean past the line and latched a downgrade that never clears. This
    // is a one-way switch and it decides whether the reader ever sees the
    // effect they chose, so it has to measure the fold and nothing else.
    if (samples < MIN_DRAW_SAMPLES) return;
    if (import.meta.env.DEV) {
      console.debug(
        `[marginalia] fold draw cost: median ${medianDrawMs.toFixed(1)}ms over ${samples} frames` +
          `${medianDrawMs > MAX_DRAW_MS ? " — downgrading to the slide from here on" : ""}`,
      );
    }
    if (medianDrawMs > MAX_DRAW_MS) lowFpsRef.current = true;
  }, []);

  // M7's dip-and-recover slide — kept as the fallback under reduced motion,
  // when a snapshot capture fails, and (via lowFpsRef below) once the fold
  // has proven itself too slow on this device.
  const turnPageSlide = useCallback(
    async (direction: "prev" | "next") => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      if (stageReducedMotion) {
        if (direction === "prev") rendition.prev();
        else rendition.next();
        return;
      }
      const dx = direction === "next" ? -6 : 6;
      await stageControls.start({
        opacity: 0.55,
        x: dx,
        transition: { duration: 0.09, ease: "easeOut" },
      });
      if (direction === "prev") rendition.prev();
      else rendition.next();
      await stageControls.start({
        opacity: 1,
        x: 0,
        transition: { duration: 0.13, ease: "easeOut" },
      });
    },
    [stageControls, stageReducedMotion],
  );

  // M20's paper fold (decisions.md 2026-07-20): the departing page is
  // rasterized to a bitmap (pageSnapshot.ts, which includes the marks-pane
  // SVG overlay for free — a DOM sibling of the iframe inside the captured
  // container, not inside the iframe — see NOTES.md M2/M3 friction) that
  // folds about the perpendicular bisector of a corner and a (synthetic, for
  // a programmatic turn) pointer sweeping across the leaf. The live DOM
  // underneath is swapped to the new page *before* the fold plays, hidden
  // behind the snapshot, so "swap to live DOM on settle" falls out of the
  // canvas unmounting when the fold completes.
  const turnPageCurl = useCallback(
    async (direction: "prev" | "next") => {
      const rendition = renditionRef.current;
      if (!rendition) return;

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
      const anchor = defaultCornerForDirection(direction);

      turnProgress.set(0);
      pointerRef.current = anchorPoint(anchor, leaf.width, leaf.height);
      setCurl({
        image: card.image,
        anchor,
        leafX: leaf.x,
        stageWidth: cardRect.width,
        leafWidth: leaf.width,
        leafHeight: leaf.height,
      });

      // Same one-exit rule as the drag gesture (decisions.md 2026-08-03): a
      // rendition step that rejects or an animation that never settles must
      // not leave the snapshot mounted over a page the reader can no longer
      // turn.
      try {
        await withDeadline(
          direction === "prev" ? rendition.prev() : rendition.next(),
          RENDITION_STEP_MS,
        );
        // Let epub.js actually paint the new section before revealing it —
        // the snapshot is still covering the stage at full opacity.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        await withDeadline(
          animate(turnProgress, 1, {
            duration: 0.42,
            ease: [0.4, 0, 0.2, 1],
            onUpdate: (v) => {
              pointerRef.current = syntheticFoldPointer(anchor, leaf.width, leaf.height, v);
            },
          }),
          SETTLE_ANIM_MS,
        );
      } finally {
        setCurl(null);
      }
    },
    [turnProgress, turnPageSlide, spreadMode, captureCard],
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
      const rendition = renditionRef.current;
      if (!rendition) return;

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
          direction === "prev" ? rendition.prev() : rendition.next(),
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
    [turnProgress, turnPageSlide, captureCardImage, applyStageOffset, renditionRef],
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
  const handleGrabPointerDown = useCallback(
    (direction: "prev" | "next", event: React.PointerEvent<HTMLDivElement>) => {
      if (turnLockRef.current || stageReducedMotion) return;
      const container = containerRef.current;
      const card = cardRef.current;
      const activeRendition = renditionRef.current;
      if (!container || !card || !activeRendition) return;

      // Without this, the drag's pointermove/up events are only guaranteed
      // to reach this handler while the pointer stays over the grab
      // surface — the moment the drag crosses into the epub.js iframe next
      // to it (the whole point of a page-edge drag gesture), the browser
      // hands raw pointer events to that iframe's own document instead.
      // Found live (NOTES.md M10): with a real Chromium pointer drag, that
      // leaked into epub.js's sandboxed (`allow-scripts` intentionally
      // absent — `allowScriptedContent: false`) content in a way that
      // crashed the tab outright, not just misbehaved. Capturing the
      // pointer keeps every event routed to this element regardless of
      // where the cursor physically travels, same as native drag/resize
      // handles.
      event.currentTarget.setPointerCapture(event.pointerId);

      turnLockRef.current = true;
      setGestureActive(true);
      const cardRect = card.getBoundingClientRect();
      const contentWidth = container.getBoundingClientRect().width;
      const leaf = nearLeafRect(
        cardRect.width,
        cardRect.height,
        contentWidth,
        spreadMode,
        direction,
      );
      const edge: "left" | "right" = direction === "prev" ? "left" : "right";
      const grabX = event.clientX - cardRect.left - leaf.x;
      const grabY = event.clientY - cardRect.top;
      // Grab a corner region and the sheet is pinched there; grab the middle
      // of the edge and the whole edge lifts, crease parallel to the spine.
      const anchor = anchorForGrab(edge, grabY, leaf.height);
      const anchorPx = anchorPoint(anchor, leaf.width, leaf.height);
      const dragRange = Math.max(leaf.width * 0.9, 120);
      const foldPointer = (px: number, py: number) =>
        constrainFoldPointer(anchor, { x: px, y: py }, leaf.width, leaf.height);

      pointerRef.current = foldPointer(grabX, grabY);
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
      let startCfi: string | null = null;
      try {
        startCfi =
          (activeRendition.currentLocation() as { start?: { cfi?: string } } | undefined)?.start
            ?.cfi ?? null;
      } catch {
        startCfi = null;
      }

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
        });
        await nextFrame();
        return true;
      };

      const opened = openRenderer().then(async (mounted) => {
        if (!mounted) return;
        ready = true;
        if (direction === "prev") await activeRendition.prev();
        else await activeRendition.next();
        advanced = true;
      });

      const onMove = (moveEvent: PointerEvent) => {
        const px = moveEvent.clientX - cardRect.left - leaf.x;
        const py = moveEvent.clientY - cardRect.top;
        pointerRef.current = foldPointer(px, py);
        // Progress follows the *pointer*, not the constrained fold pointer:
        // an edge peel that refuses to tilt should still commit when you drag
        // far enough, however you got there.
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
      };

      const surface = event.currentTarget;
      const pointerId = event.pointerId;
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
              ? activeRendition.display(startCfi)
              : direction === "prev"
                ? activeRendition.next()
                : activeRendition.prev();

          if (shouldCommit && useSlide) {
            await withDeadline(
              animate(turnProgress, 1, {
                duration: 0.16,
                ease: "easeOut",
                onUpdate: (v) => applyStageOffset(slideOffsetPx(direction, cardWidth, v)),
              }),
              SETTLE_ANIM_MS,
            );
          } else if (shouldCommit) {
            const target = syntheticFoldPointer(anchor, leaf.width, leaf.height, 1);
            await withDeadline(
              animate(turnProgress, 1, {
                duration: 0.16,
                ease: "easeOut",
                onUpdate: (v) => {
                  const t = startProgress < 1 ? (v - startProgress) / (1 - startProgress) : 1;
                  pointerRef.current = lerpPoint(releasePointer, target, clamp01(t));
                },
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
            // Put the page back *before* the sheet lands, not after. The fold
            // paints nothing once the pointer reaches the anchor, so a step
            // back that outlives the animation shows the un-turned-to page
            // full-screen for however long epub.js takes. Stepping back first
            // costs only the shrinking opening briefly showing the page it is
            // returning to, under the roll's own shadow.
            if (advanced) await withDeadline(stepBack(), RENDITION_STEP_MS);
            await withDeadline(
              animate(turnProgress, 0, {
                duration: 0.18,
                ease: "easeOut",
                onUpdate: (v) => {
                  const t = startProgress > 0 ? (startProgress - v) / startProgress : 1;
                  pointerRef.current = lerpPoint(releasePointer, anchorPx, clamp01(t));
                },
              }),
              SETTLE_ANIM_MS,
            );
          } else {
            // Snapshot never resolved before release (a very fast tap) — no
            // fold was ever visible, so treat it as a plain click-to-turn
            // rather than silently doing nothing.
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
      stageReducedMotion,
      spreadMode,
      turnPage,
      captureCard,
      captureCardImage,
      resolveRenderer,
      applyStageOffset,
      containerRef,
      cardRef,
      renditionRef,
    ],
  );

  return {
    stageControls,
    stageReducedMotion,
    curl,
    slide,
    gestureActive,
    getFoldPointer,
    handleDrawCost,
    turnPage,
    handleGrabPointerDown,
  };
}
