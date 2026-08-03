import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { FlyPanel } from "../controls/FlyPanel.js";
import type { OverlayOrigin } from "../controls/overlayOrigin.js";
import { BookCover } from "../library/BookCover.js";
import styles from "./BookOpening.module.css";

// Fanned page-plane offsets, hinged at the cover's left edge (spine side) —
// a 2D flutter (rotate + x) rather than a true 3D page turn: PAGE_CURL.md's
// own lesson is that 3D paper motion is expensive to get right and easy to
// get plausibly wrong, and this is a decorative aside, not the reader's own
// turn. Kept short so the whole sequence lands near DESIGN.md's 150–200ms
// "system-initiated" motion window rather than becoming its own spectacle.
const PAGE_OFFSETS = [
  { rotate: -12, x: -8 },
  { rotate: -6, x: -4 },
  { rotate: 6, x: 4 },
  { rotate: 12, x: 8 },
];

const FLY_MS = 240;
const FLUTTER_MS = 220;

interface BookOpeningProps {
  origin: OverlayOrigin | null;
  resourceId: string;
  title: string;
  reducedMotion: boolean;
  /** True once the real reader has either landed on its page or failed to —
   * either way, there's something underneath worth revealing. */
  contentReady: boolean;
  /** The overlay has finished its exit fade; safe to unmount. */
  onDone: () => void;
  /** Escape was pressed at any point during the sequence. */
  onCancel: () => void;
}

/**
 * DESIGN.md's "the opening": the clicked book flies from its desk position
 * to centre, a short page flutter plays, and once the real reader
 * (ReaderView, mounted underneath the whole time) reports it has landed on
 * the saved position, this fades out to reveal it — never before, so the
 * reveal never shows a flash of the plain "Loading book…" text or an
 * unstyled page. `pointer-events: none` throughout: this is a decorative
 * lid, never a blocking spinner (CLAUDE.md), and Escape cancels at any
 * point by unmounting immediately rather than reversing the flight — a
 * *reverse* animation back to the shelf would need the shelf still mounted
 * behind the reader room, which it isn't (App.tsx renders one room at a
 * time), so "coherent, never half-transitioned" here just means: nothing
 * lingers once the route changes back.
 */
export function BookOpening({
  origin,
  resourceId,
  title,
  reducedMotion,
  contentReady,
  onDone,
  onCancel,
}: BookOpeningProps) {
  const [phase, setPhase] = useState<"flying" | "settled" | "leaving">("flying");

  useEffect(() => {
    const timer = setTimeout(() => setPhase("settled"), reducedMotion ? 0 : FLY_MS);
    return () => clearTimeout(timer);
  }, [reducedMotion]);

  useEffect(() => {
    if (phase !== "settled" || !contentReady) return;
    const timer = setTimeout(() => setPhase("leaving"), reducedMotion ? 0 : FLUTTER_MS);
    return () => clearTimeout(timer);
  }, [phase, contentReady, reducedMotion]);

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

  return (
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: reducedMotion ? 0.001 : leaving ? 0.18 : 0.12, ease: "easeOut" }}
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
        {!reducedMotion && phase !== "flying" && (
          <div className={styles.flutter} aria-hidden="true">
            {PAGE_OFFSETS.map((offset, index) => (
              <motion.div
                key={index}
                className={styles.page}
                initial={{ rotate: offset.rotate, x: offset.x, opacity: 0.85 }}
                animate={{ rotate: 0, x: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: "easeOut", delay: index * 0.02 }}
              />
            ))}
          </div>
        )}
        <div className={styles.cover}>
          <BookCover resourceId={resourceId} title={title} />
        </div>
      </FlyPanel>
    </motion.div>
  );
}
