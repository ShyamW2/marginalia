import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import { FlyPanel } from "../controls/FlyPanel.js";
import type { OverlayOrigin } from "../controls/overlayOrigin.js";
import { BookCover } from "../library/BookCover.js";
import {
  useScene3DAvailable,
  useScene3DFade,
  useScene3DHold,
  useScene3DLayer,
  useScene3DLayerFade,
} from "../scene3d/Scene3D.js";
import { setDepartedBook } from "../scene3d/departedBook.js";
import type { OpeningPose } from "../scene3d/openingPose.js";
import { BookOpening3D } from "./BookOpening3D.js";
import { capturePageSnapshot, snapshotInset } from "./pageSnapshot.js";
import {
  HANDOFF_DELAY_MS,
  HANDOFF_MS,
  LANDING_EASE,
  LANDING_MS,
  ROOM_FADE_DELAY_MS,
  ROOM_FADE_MS,
  openSequenceMs,
  type Rect,
} from "./openingGeometry.js";
import styles from "./BookOpening.module.css";

// The 2D presentation's own beats. Slowed alongside the 3D one (TASKS.md M23
// §E, "the whole sequence slows down", and again on 2026-08-14) so a lost
// context changes what the opening *is*, never how long the room takes to
// arrive.
const FLY_MS = 800;
const OPEN_MS = 750;

/** How long the printed spread is held before the landing pulls it onto the
 * pane. Short — it is a beat, not a pause: long enough to register that the
 * book in your hands is the page you are about to read, not long enough to
 * feel like waiting.
 *
 * Exported for `BookClosing.tsx` (M33 §C), which runs this same settle beat
 * in reverse — the book relaxing back to its own proportions once it leaves
 * the pane, right before it starts closing. */
export const PAGE_SETTLE_MS = 260;

// Anticlockwise about the spine (left) edge, "toward the viewer"
// (decisions.md 2026-08-04): empirically, with `transformOrigin: "0% 50%"`,
// a negative rotateY swings the cover's free (right) edge out of the screen
// toward the camera rather than away into it — verify live if this ever
// looks like it opens backwards. A full -180° now, not the old -110°: the
// cover ends *flat*, as the spread's left page, which is what makes the
// two-page spread underneath it the right width (M23 §E). `backface-visibility:
// hidden` retires the cover art past 90°, revealing that page beneath it.
const OPEN_ROTATE_DEG = -180;

const OPEN_TRANSITION = { duration: OPEN_MS / 1000, ease: [0.4, 0, 0.2, 1] } as const;
const LANDING_SPRING = { type: "spring", duration: LANDING_MS / 1000, bounce: 0.1 } as const;

interface BookOpeningProps {
  origin: OverlayOrigin | null;
  /** M23 §E: where the book actually *was*, as a 3D object — set by the Desk
   * and the shelf alongside the origin rect. Null from the list view, a deep
   * link, or any surface with no 3D presentation, which take the 2D
   * presentation below. */
  pose: OpeningPose | null;
  resourceId: string;
  title: string;
  reducedMotion: boolean;
  /** True once the real reader has either landed on its page or failed to —
   * either way, there's something underneath worth revealing. */
  contentReady: boolean;
  /** The live reader's `.stage` node (ReaderView) — the reading pane the
   * revealed spread lands on before the crossfade. Read once, when the landing
   * starts; by then `contentReady` guarantees ReaderView has mounted it. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** The landing has started: the spread is on its way onto the pane, and the
   * room underneath — hidden until now behind the surface this book came off
   * (see `useScene3DHold`) — should come up with it. */
  onRevealRoom?: () => void;
  /** The overlay has finished its exit fade; safe to unmount. */
  onDone: () => void;
  /** Escape was pressed at any point during the sequence. */
  onCancel: () => void;
}

/**
 * DESIGN.md's "the opening": the book you clicked opens into the reader.
 *
 * ## Two presentations, one sequence
 *
 * With 3D available and a pose handed over, this is `BookOpening3D` — the
 * *same book object* the Desk or the shelf was drawing, continuing through the
 * same camera: it travels to centre, its front board swings flat to reveal a
 * spread twice the cover's width creased at the hinge, and that spread lands on
 * the live reading pane's own rect (M23 §E; the geometry and the reasoning are
 * in `openingGeometry.ts`).
 *
 * Without one — reduced motion, a lost WebGL context, or an entry point with no
 * 3D presentation to continue (the list view, a deep link) — it is the CSS
 * presentation below, which flies the cover from its click-time rect and opens
 * it about its spine. Same phases, same timings, same `contentReady` gate.
 *
 * ## What both are bound by
 *
 * `pointer-events: none` throughout: this is a decorative lid, never a blocking
 * spinner (CLAUDE.md), which is also what licenses it to be slower than
 * DESIGN.md's ~400ms bound (decisions.md 2026-08-12 ruling 8 — that bound
 * governs *input blocking*).
 *
 * The reveal waits on `contentReady`, never before, so it can never flash the
 * plain "Loading book…" text or an unstyled page.
 *
 * Escape cancels at any point by unmounting immediately rather than reversing —
 * a *reverse* animation back to the desk would need the desk still mounted
 * behind the reader room, which it isn't (App.tsx renders one room at a time),
 * so "coherent, never half-transitioned" here means: nothing lingers once the
 * route changes back.
 */
export function BookOpening({
  origin,
  pose,
  resourceId,
  title,
  reducedMotion,
  contentReady,
  stageRef,
  onRevealRoom,
  onDone,
  onCancel,
}: BookOpeningProps) {
  const scene3DAvailable = useScene3DAvailable();
  const use3D = Boolean(pose) && scene3DAvailable && !reducedMotion;

  const [phase, setPhase] = useState<"running" | "revealed" | "leaving" | "handoff">("running");
  // The 2D presentation's cover angle — a second beat inside "running", which
  // the 3D one expresses as a range of its own clock instead.
  const [coverOpen, setCoverOpen] = useState(false);
  // The reading pane's rect, measured once when the landing starts.
  const [stage, setStage] = useState<Rect | null>(null);
  // A still of that pane, printed on the held-open spread — see the hold below.
  const [spreadImage, setSpreadImage] = useState<string | null>(null);
  // The pane's margin band, as a fraction of its own box: the part of the pane
  // the snapshot does *not* depict, and so the margin the printed leaf leaves
  // around itself (`pageSnapshot.ts`'s `snapshotInset`).
  const [spreadInset, setSpreadInset] = useState<{ x: number; y: number } | null>(null);
  // The pane's aspect, measured with the capture rather than with the landing's
  // target — the settle below needs it a beat earlier than the exact rect, and
  // an aspect survives a resize that a rect does not.
  const [paneAspect, setPaneAspect] = useState<number | null>(null);

  // The 3D layer reads these every frame; the DOM owns the sequence and the
  // object owns how it looks — the same split the Desk and the shelf use for
  // hover lift (`DeskScene3D.tsx`).
  const progress = useMotionValue(0);
  const landing = useMotionValue(0);
  // 0 → 1 across the settle beat: the book relaxing toward the pane's
  // proportions once the page is printed on it (`flattenTowardPane`).
  const settle = useMotionValue(0);

  const sceneRef = useRef<HTMLDivElement>(null);
  // The 2D landing, driven the same way FlyPanel drives its own entrance:
  // motion values written directly, so the one measurement happens exactly
  // once, right before the animation starts.
  const landX = useMotionValue(0);
  const landY = useMotionValue(0);
  const landScaleX = useMotionValue(1);
  const landScaleY = useMotionValue(1);
  // The scene recentring the crease, kept off `.scene` itself so that node's
  // rect stays untransformed for the landing to measure against.
  const recentreX = useMotionValue(0);

  const sceneNode = useMemo(
    () =>
      use3D && pose ? (
        <BookOpening3D
          pose={pose}
          resourceId={resourceId}
          title={title}
          progress={progress}
          landing={landing}
          settle={settle}
          stage={stage}
          paneAspect={paneAspect}
          spreadImage={spreadImage}
          spreadInset={spreadInset}
        />
      ) : null,
    [
      use3D,
      pose,
      resourceId,
      title,
      progress,
      landing,
      settle,
      stage,
      paneAspect,
      spreadImage,
      spreadInset,
    ],
  );
  useScene3DLayer("book-opening", sceneNode);

  // ⚠️ **The room the book came from stays on the canvas until this overlay is
  // done with it** (2026-08-14). Without the hold, clicking a book unmounted
  // the Desk on the first frame and the whole sequence — a book climbing off a
  // surface, turning, opening — played over the *reader*, which is the room it
  // has not arrived in yet. The reader still mounts and loads immediately,
  // underneath; it is simply not what you are looking at until the spread has
  // landed on it. `useScene3DHold` documents why this is a held layer rather
  // than a second mounted room.
  useScene3DHold(use3D && pose ? pose.surface : null);

  // And the held room must not go on drawing the book that has left it — this
  // layer is drawing it now. Cleared on unmount, including the Escape path,
  // which is what puts the book back on the desk you land on.
  useEffect(() => {
    if (!use3D) return;
    setDepartedBook(resourceId);
    return () => setDepartedBook(null);
  }, [use3D, resourceId]);

  // The 3D sequence: one linear clock, because every term's own easing lives in
  // `openingGeometry.ts` where the overlapping ranges can share it.
  useEffect(() => {
    if (!use3D) return;
    const duration = openSequenceMs(pose?.surface ?? "desk") / 1000;
    const controls = animate(progress, 1, { duration, ease: "linear" });
    controls.then(() => setPhase((prev) => (prev === "running" ? "revealed" : prev)));
    return () => controls.stop();
  }, [use3D, progress, pose?.surface]);

  // The 2D sequence: fly, then open.
  useEffect(() => {
    if (use3D) return;
    const open = setTimeout(() => setCoverOpen(true), reducedMotion ? 0 : FLY_MS);
    const revealed = setTimeout(
      () => setPhase((prev) => (prev === "running" ? "revealed" : prev)),
      reducedMotion ? 0 : FLY_MS + OPEN_MS,
    );
    return () => {
      clearTimeout(open);
      clearTimeout(revealed);
    };
  }, [use3D, reducedMotion]);

  // The hold: the book sits open until there is something underneath worth
  // revealing, however long that takes — and then, in 3D, until that something
  // is *printed on its pages*.
  //
  // The capture is `pageSnapshot`'s, the page curl's own (PAGE_CURL.md §5): one
  // still of the live reading pane, cut down the middle onto the two halves of
  // the spread. It is why the landing is a book growing into a page rather than
  // two blank sheets swapping for a page at the last moment — and it costs one
  // rasterization, at a moment when nothing is animating, behind its own 700ms
  // deadline. A null result (a book whose markup defeats the capture, or a
  // timeout) simply lands blank paper, exactly as before.
  //
  // ⚠️ The rect is measured **after** the capture, not before: the settle below
  // is time the pane could have been resized in.
  useEffect(() => {
    if (phase !== "revealed" || !contentReady) return;
    let cancelled = false;
    const target = stageRef.current;

    async function land() {
      if (use3D && target) {
        const image = await capturePageSnapshot(target);
        if (cancelled) return;
        if (image) {
          // Measured with the picture, and both for the same reason: what the
          // snapshot leaves out is the pane's margin band, and what it is
          // stretched across is a book, not a screen. The leaf is inset by the
          // one and the book relaxes toward the other — see `snapshotInset` and
          // `flattenTowardPane`. The exact landing rect is still taken after the
          // settle, below, because the settle is time the pane could have been
          // resized in.
          const shape = target.getBoundingClientRect();
          setSpreadInset(snapshotInset(target));
          setPaneAspect(shape.height > 0 ? shape.width / shape.height : null);
          setSpreadImage(image);
          animate(settle, 1, { duration: PAGE_SETTLE_MS / 1000, ease: "easeOut" });
          await new Promise((resolve) => setTimeout(resolve, PAGE_SETTLE_MS));
          if (cancelled) return;
        }
      }
      const rect = target?.getBoundingClientRect();
      setStage(rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null);
      setPhase("leaving");
    }

    void land();
    return () => {
      cancelled = true;
    };
    // `stageRef` is a ref and `phase` only moves forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, contentReady, use3D]);

  // The spread is on its way onto the pane, or already there: one flag across
  // the landing *and* the handoff that overlaps its tail.
  const landed = phase === "leaving" || phase === "handoff";

  // The 3D landing. Gated on `stage` having committed, so the layer is already
  // rendering with a target by the time the clock starts moving toward it.
  //
  // ⚠️ Keyed on `landed`, not on `phase`. The handoff below begins
  // `HANDOFF_LEAD_MS` *before* the landing ends (deliberately — see
  // `HANDOFF_LEAD_MS`), so an effect that re-ran on the phase change would run
  // its own cleanup and stop this animation 90ms short of the pane.
  useEffect(() => {
    if (!landed || !use3D || !stage) return;
    const controls = animate(landing, 1, { duration: LANDING_MS / 1000, ease: LANDING_EASE });
    return () => controls.stop();
  }, [landed, use3D, stage, landing]);

  // The handoff: the spread is on the pane, so the room underneath — hidden
  // until now behind the surface this book came off (`useScene3DHold`) — comes
  // up as the canvas holding the book and that surface goes down. Both halves of
  // one crossfade; `HANDOFF_MS` documents why it is here rather than at the top
  // of the landing, which is where it used to be.
  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = setTimeout(
      () => {
        onRevealRoom?.();
        setPhase("handoff");
      },
      reducedMotion ? 0 : HANDOFF_DELAY_MS,
    );
    return () => clearTimeout(timer);
    // `onRevealRoom` is an inline callback from ReaderPage, so listing it would
    // restart this timer on any parent render. `phase` only moves forward, so
    // the timer is armed exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reducedMotion]);

  // The room the book came from leaves *during* the landing, on its own clock —
  // `ROOM_FADE_MS` for the reasoning, `useScene3DLayerFade` for why the
  // canvas-wide fade below cannot be the thing that does it.
  // Memoized because the hook's effect keys on it: a fresh object every render
  // would restart the fade from full opacity on any parent render.
  const roomFade = useMemo(
    () => (landed ? { to: 0, ms: ROOM_FADE_MS, delayMs: ROOM_FADE_DELAY_MS } : null),
    [landed],
  );
  useScene3DLayerFade(use3D && pose ? pose.surface : null, roomFade);

  useScene3DFade(use3D && phase === "handoff" ? HANDOFF_MS : null);

  // The 2D landing: the spread (twice the scene's width, creased at its left
  // edge) onto the reading pane. Measured against `.scene` — the cover's own
  // box, untransformed — rather than against the spread, so one rect answers
  // both axes: the spread's left edge sits half a cover width left of the
  // scene's origin once `recentreX` has run, and it is twice as wide.
  useEffect(() => {
    if (!landed || use3D || reducedMotion) return;
    const scene = sceneRef.current;
    const target = stageRef.current;
    if (!scene || !target) return;
    const sceneRect = scene.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    if (sceneRect.width === 0 || sceneRect.height === 0) return;
    const scaleX = targetRect.width / (sceneRect.width * 2);
    const scaleY = targetRect.height / sceneRect.height;
    animate(landX, targetRect.left - sceneRect.left + (scaleX * sceneRect.width) / 2, LANDING_SPRING);
    animate(landY, targetRect.top - sceneRect.top, LANDING_SPRING);
    animate(landScaleX, scaleX, LANDING_SPRING);
    animate(landScaleY, scaleY, LANDING_SPRING);
    // Fires once, when `landed` first goes true — the phase only moves forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed, use3D, reducedMotion]);

  // The 2D recentring: the crease is the scene's left edge once the cover is
  // flat, so the scene slides half a cover width right to put it on the axis
  // the book arrived on. Its own term, never folded into the landing —
  // decisions.md 2026-08-12 ruling 7.
  useEffect(() => {
    if (use3D || reducedMotion || !coverOpen) return;
    const scene = sceneRef.current;
    if (!scene) return;
    const controls = animate(recentreX, scene.getBoundingClientRect().width / 2, OPEN_TRANSITION);
    return () => controls.stop();
  }, [use3D, reducedMotion, coverOpen, recentreX]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCancel();
    }
    // Capture phase, ahead of the reader's own shortcut registry — this
    // overlay's Escape (abandon the opening) always wins over whatever the
    // reader underneath would otherwise do with it.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  return (
    <motion.div
      // ⚠️ In 3D this carries no tint and only the exit fade — see
      // `.backdropIs3D` for why, and for the layering rule it is obeying. The
      // fade still gates `onDone`, so the sequence's end is the same in both
      // presentations.
      className={`${styles.backdrop} ${use3D ? styles.backdropIs3D : ""}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: landed ? 0 : 1 }}
      // ⚠️ This animation's completion is what unmounts the overlay, and with it
      // the 3D layer the book is drawn in — so it has to outlast the handoff,
      // not just the landing. Ending at `LANDING_MS` (which it did) would now
      // cut the book away on the first frame of the crossfade it is half of.
      transition={{
        duration: reducedMotion ? 0.001 : landed ? (HANDOFF_DELAY_MS + HANDOFF_MS) / 1000 : 0.12,
        ease: "easeOut",
      }}
      onAnimationComplete={() => {
        if (landed) onDone();
      }}
      aria-hidden="true"
    >
      {!use3D && (
        <FlyPanel
          origin={origin}
          className={styles.stage}
          transition={reducedMotion ? { duration: 0.001 } : undefined}
        >
          {/* The 3D open and the landing move live on this child, never on the
              node FlyPanel itself is flying in — `motion` already writes
              `transform` there for the entrance, and a 3D rotation stacked on
              the same node fights it (found live: the cover jumps instead of
              opening). Reduced motion skips this whole scene — a plain
              crossfade with zero 3D, same as the backdrop's own fade. */}
          {!reducedMotion && (
            <motion.div
              ref={sceneRef}
              className={styles.scene}
              style={{ x: landX, y: landY, scaleX: landScaleX, scaleY: landScaleY }}
              aria-hidden="true"
            >
              <motion.div className={styles.book} style={{ x: recentreX }}>
                <div className={styles.spread}>
                  <div className={styles.spreadPage} />
                  <div className={styles.spreadPage} />
                </div>
                <motion.div
                  className={styles.cover}
                  initial={false}
                  animate={{ rotateY: coverOpen ? OPEN_ROTATE_DEG : 0 }}
                  transition={OPEN_TRANSITION}
                >
                  <BookCover resourceId={resourceId} title={title} />
                </motion.div>
              </motion.div>
            </motion.div>
          )}
          {reducedMotion && (
            <div className={styles.cover}>
              <BookCover resourceId={resourceId} title={title} />
            </div>
          )}
        </FlyPanel>
      )}
    </motion.div>
  );
}
