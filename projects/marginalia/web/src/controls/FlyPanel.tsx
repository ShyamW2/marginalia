import { forwardRef, useLayoutEffect, useRef, type ComponentPropsWithoutRef, type Ref } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import type { OverlayOrigin } from "./overlayOrigin.js";

const FLY_SPRING = { type: "spring", duration: 0.24, bounce: 0.15 } as const;

export interface FlyPanelProps extends Omit<ComponentPropsWithoutRef<typeof motion.div>, "style"> {
  /** The invoking control's rect, captured at click time (overlayOrigin.ts).
   * Null renders a plain crossfade with no movement — there's no control to
   * fly from a direct/deep link, and reduced motion always takes this path
   * regardless of what's passed. */
  origin: OverlayOrigin | null;
  style?: React.CSSProperties;
}

/**
 * A panel that grows from the control that opened it rather than fading in
 * at a fixed position (decisions.md 2026-07-30, "Popups slide from where
 * they were called"). `layout` stays on so a later resize of this same
 * panel (a settings tab change) morphs its box instead of jumping — both
 * halves of that decision share one ~240ms spring, passed as `transition`
 * and applied to `layout` the same way it drives `animate`/`exit`.
 *
 * Position/scale are driven by motion values set directly inside
 * `useLayoutEffect`, which React guarantees runs before the browser's first
 * paint — the panel never visibly appears at its resting pose before the
 * flight starts. Opacity and enter/exit stay fully declarative (`initial`/
 * `animate`/`exit`, passed through via `...rest`) since only position/scale
 * depend on the runtime-measured origin.
 */
export const FlyPanel = forwardRef(function FlyPanel(
  { origin, className, style, transition, ...rest }: FlyPanelProps,
  forwardedRef: Ref<HTMLDivElement>,
) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scaleX = useMotionValue(1);
  const scaleY = useMotionValue(1);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !origin || reducedMotion) return;

    const rect = panel.getBoundingClientRect();
    x.set(origin.left - rect.left);
    y.set(origin.top - rect.top);
    scaleX.set(rect.width > 0 ? origin.width / rect.width : 1);
    scaleY.set(rect.height > 0 ? origin.height / rect.height : 1);

    animate(x, 0, FLY_SPRING);
    animate(y, 0, FLY_SPRING);
    animate(scaleX, 1, FLY_SPRING);
    animate(scaleY, 1, FLY_SPRING);
    // Fires once per mount — a fresh flight only happens on a fresh mount
    // (callers key the panel per open), not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      ref={(node) => {
        panelRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) (forwardedRef as { current: HTMLDivElement | null }).current = node;
      }}
      layout={!reducedMotion}
      className={className}
      style={{ ...style, x, y, scaleX, scaleY, transformOrigin: "0 0" }}
      transition={transition ?? (reducedMotion ? { duration: 0.001 } : FLY_SPRING)}
      {...rest}
    />
  );
});
