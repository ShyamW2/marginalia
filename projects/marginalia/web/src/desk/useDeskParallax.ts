import { useCallback } from "react";
import { useMotionValue, useSpring, useTransform } from "motion/react";

const MAX_TILT_DEG = 1.6;

/**
 * The desk's "suspended jellyfish" ambient tilt (DESIGN.md: "1-2deg of
 * parallax, objects with a touch of inertia"). Returns spring-smoothed
 * rotateX/rotateY motion values to apply to the whole freeform surface, plus
 * pointer handlers that drive them — disabled entirely (values pinned to 0)
 * when `enabled` is false, so callers don't need to conditionally render.
 */
export function useDeskParallax(enabled: boolean) {
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const springX = useSpring(px, { stiffness: 55, damping: 18 });
  const springY = useSpring(py, { stiffness: 55, damping: 18 });
  const rotateX = useTransform(springY, [0, 1], [MAX_TILT_DEG, -MAX_TILT_DEG]);
  const rotateY = useTransform(springX, [0, 1], [-MAX_TILT_DEG, MAX_TILT_DEG]);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      px.set((event.clientX - rect.left) / rect.width);
      py.set((event.clientY - rect.top) / rect.height);
    },
    [enabled, px, py],
  );

  const onPointerLeave = useCallback(() => {
    px.set(0.5);
    py.set(0.5);
  }, [px, py]);

  return { rotateX, rotateY, onPointerMove, onPointerLeave };
}
