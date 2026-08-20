import { useEffect, useRef, type RefObject } from "react";

/**
 * M24.7 D (borrowed early by §A's `ExpandingCluster`): no outside-click
 * primitive existed anywhere in the tree before this — every existing
 * popover either closes on a timer (`ProviderPickerPopover`) or is a routed
 * overlay with its own backdrop (Scan/Digest/Settings). `handler` is read
 * through a ref so callers can pass a fresh closure every render without
 * this effect re-subscribing.
 */
export function useOutsideClick(ref: RefObject<HTMLElement>, handler: () => void, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    function onPointerDown(event: PointerEvent) {
      const el = ref.current;
      if (!el || el.contains(event.target as Node)) return;
      handlerRef.current();
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [ref, enabled]);
}
