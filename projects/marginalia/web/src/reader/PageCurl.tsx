import { motion, useTransform, type MotionValue } from "motion/react";
import styles from "./PageCurl.module.css";

const MAX_ANGLE = 108;

interface PageCurlProps {
  src: string;
  direction: "prev" | "next";
  /** 0 = flat against the stage, 1 = fully turned away. Driven either by an
   * imperative `animate()` call (click/keyboard turn) or a pointer drag
   * (peel gesture) — this component only renders the current value. */
  progress: MotionValue<number>;
}

/**
 * The M10 snapshot page-turn (DESIGN.md "the epub.js constraint"): a bitmap
 * of the departing page (captured by pageSnapshot.ts, which includes the
 * marks-pane SVG since it's a DOM sibling of the iframe inside the captured
 * container) curls away on its own 3D plane, revealing the live DOM
 * underneath — which the caller has already swapped to the new page before
 * this mounts, so "swap to live DOM on settle" is just this overlay's own
 * fade-out.
 */
export function PageCurl({ src, direction, progress }: PageCurlProps) {
  const sign = direction === "next" ? -1 : 1;
  const originX = direction === "next" ? "100%" : "0%";
  const rotateY = useTransform(progress, [0, 1], [0, sign * MAX_ANGLE]);
  const opacity = useTransform(progress, [0, 0.82, 1], [1, 1, 0]);
  const shadeOpacity = useTransform(progress, [0, 0.45, 1], [0, 0.4, 0]);

  return (
    <div className={styles.wrap} aria-hidden="true">
      <motion.img
        src={src}
        alt=""
        draggable={false}
        className={styles.leaf}
        style={{ transformOrigin: `${originX} 50%`, rotateY, opacity }}
      />
      <motion.div
        className={`${styles.shade} ${direction === "next" ? styles.shadeNext : styles.shadePrev}`}
        style={{ transformOrigin: `${originX} 50%`, rotateY, opacity: shadeOpacity }}
      />
    </div>
  );
}
