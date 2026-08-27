import { useEffect, useState } from "react";

/**
 * M31 C8: whether the *primary* pointer on this device is a finger rather
 * than a mouse/trackpad — `any-pointer` (not `pointer`) on purpose, since a
 * touchscreen laptop with a mouse plugged in should still count as
 * touch-capable for "does the pinch-to-resize instrument exist on this
 * device", which is what this gates in Settings (DESIGN.md, "Pinch to
 * resize is an instrument, not a setting": "Discoverable from Settings...
 * only on a touch device"). Live, not read once: a query result that never
 * updates would be wrong the moment a tablet is un-docked from a mouse
 * mid-session.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof matchMedia === "function" && matchMedia("(any-pointer: coarse)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mql = matchMedia("(any-pointer: coarse)");
    const update = () => setCoarse(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return coarse;
}
