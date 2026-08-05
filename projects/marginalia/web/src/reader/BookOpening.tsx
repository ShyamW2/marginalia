import { useEffect, useRef, useState, type RefObject } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import { FlyPanel } from "../controls/FlyPanel.js";
import type { OverlayOrigin } from "../controls/overlayOrigin.js";
import { BookCover } from "../library/BookCover.js";
import styles from "./BookOpening.module.css";

const FLY_MS = 240;
// How long the cover's own rotation takes, and how long the revealed
// spread's landing move (scale + translate onto the reading pane's rect)
// takes — both fixed, unlike the "revealed" hold between them, which waits
// on `contentReady` and has no animation duration of its own.
const OPEN_MS = 140;
const LANDING_MS = 160;

// Anticlockwise about the spine (left) edge, "toward the viewer"
// (decisions.md 2026-08-04): empirically, with `transformOrigin: "0% 50%"`,
// a negative rotateY swings the cover's free (right) edge out of the screen
// toward the camera rather than away into it — verify live if this ever
// looks like it opens backwards. Past 90° the cover is edge-on; the last
// stretch to -110° buys perspective foreshortening on the way there rather
// than a dead stop at perpendicular.
const OPEN_ROTATE_DEG = -110;

const OPEN_TRANSITION = { duration: OPEN_MS / 1000, ease: [0.4, 0, 0.2, 1] } as const;
const LANDING_SPRING = { type: "spring", duration: LANDING_MS / 1000, bounce: 0.1 } as const;

interface BookOpeningProps {
  origin: OverlayOrigin | null;
  resourceId: string;
  title: string;
  reducedMotion: boolean;
  /** True once the real reader has either landed on its page or failed to —
   * either way, there's something underneath worth revealing. */
  contentReady: boolean;
  /** The live reader's `.stage` node (ReaderView) — the reading pane the
   * revealed spread scales and translates onto before the crossfade. Read
   * once, when the landing move starts; by then `contentReady` guarantees
   * ReaderView has mounted it. */
  stageRef: RefObject<HTMLDivElement | null>;
  /** The overlay has finished its exit fade; safe to unmount. */
  onDone: () => void;
  /** Escape was pressed at any point during the sequence. */
  onCancel: () => void;
}

/**
 * DESIGN.md's "the opening": the clicked book flies from its desk position
 * to centre (unchanged since M20.7), then — M22.5's fix for the part that
 * didn't actually open — the front cover rotates about its spine toward the
 * viewer, revealing a blank two-page spread that scales and translates onto
 * the live reader's own reading pane before crossfading to it. The reveal
 * itself still waits on `contentReady`, never before, so it can never flash
 * the plain "Loading book…" text or an unstyled page. `pointer-events: none`
 * throughout: this is a decorative lid, never a blocking spinner (CLAUDE.md),
 * and Escape cancels at any point by unmounting immediately rather than
 * reversing the flight — a *reverse* animation back to the shelf would need
 * the shelf still mounted behind the reader room, which it isn't (App.tsx
 * renders one room at a time), so "coherent, never half-transitioned" here
 * just means: nothing lingers once the route changes back.
 */
export function BookOpening({
  origin,
  resourceId,
  title,
  reducedMotion,
  contentReady,
  stageRef,
  onDone,
  onCancel,
}: BookOpeningProps) {
  const [phase, setPhase] = useState<"flying" | "opening" | "revealed" | "leaving">("flying");
  const sceneRef = useRef<HTMLDivElement>(null);
  // The landing move (scene → reading-pane rect), driven the same way
  // FlyPanel drives its own entrance: motion values written directly, so the
  // one measurement happens exactly once, right before the animation starts.
  const landX = useMotionValue(0);
  const landY = useMotionValue(0);
  const landScaleX = useMotionValue(1);
  const landScaleY = useMotionValue(1);

  useEffect(() => {
    const timer = setTimeout(() => setPhase("opening"), reducedMotion ? 0 : FLY_MS);
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  useEffect(() => {
    if (phase !== "opening") return;
    const timer = setTimeout(() => setPhase("revealed"), reducedMotion ? 0 : OPEN_MS);
    return () => clearTimeout(timer);
  }, [phase, reducedMotion]);

  useEffect(() => {
    if (phase !== "revealed" || !contentReady) return;
    setPhase("leaving");
  }, [phase, contentReady]);

  useEffect(() => {
    if (phase !== "leaving" || reducedMotion) return;
    const scene = sceneRef.current;
    const target = stageRef.current;
    if (!scene || !target) return;
    const sceneRect = scene.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    animate(landX, targetRect.left - sceneRect.left, LANDING_SPRING);
    animate(landY, targetRect.top - sceneRect.top, LANDING_SPRING);
    animate(landScaleX, sceneRect.width > 0 ? targetRect.width / sceneRect.width : 1, LANDING_SPRING);
    animate(landScaleY, sceneRect.height > 0 ? targetRect.height / sceneRect.height : 1, LANDING_SPRING);
    // Fires once per entry into "leaving" — the phase only moves forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reducedMotion]);

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

  const leaving = phase === "leaving";
  const open = phase !== "flying";

  return (
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: reducedMotion ? 0.001 : leaving ? LANDING_MS / 1000 : 0.12, ease: "easeOut" }}
      onAnimationComplete={() => {
        if (leaving) onDone();
      }}
      aria-hidden="true"
    >
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
            <div className={styles.spread}>
              <div className={styles.spreadPage} />
              <div className={styles.spreadPage} />
            </div>
            <motion.div
              className={styles.cover}
              initial={false}
              animate={{ rotateY: open ? OPEN_ROTATE_DEG : 0 }}
              transition={OPEN_TRANSITION}
            >
              <BookCover resourceId={resourceId} title={title} />
            </motion.div>
          </motion.div>
        )}
        {reducedMotion && (
          <div className={styles.cover}>
            <BookCover resourceId={resourceId} title={title} />
          </div>
        )}
      </FlyPanel>
    </motion.div>
  );
}
