import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ChromeSlotContext = createContext<{
  slot: HTMLDivElement | null;
  setSlot: (el: HTMLDivElement | null) => void;
} | null>(null);

export function ChromeSlotProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return <ChromeSlotContext.Provider value={{ slot, setSlot }}>{children}</ChromeSlotContext.Provider>;
}

function useChromeSlotContext() {
  const ctx = useContext(ChromeSlotContext);
  if (!ctx) throw new Error("chromeSlot used outside ChromeSlotProvider");
  return ctx;
}

/** `NavCluster` calls this with a ref to its own leading slot — the DOM
 * node a room's actions portal into. */
export function useRegisterChromeSlot(): (el: HTMLDivElement | null) => void {
  return useChromeSlotContext().setSlot;
}

/**
 * M22.5 (decisions.md 2026-08-04 "nothing else may occupy the top-right
 * corner"): `NavCluster` owns the one fixed chrome row; a room contributes
 * its own global actions into a leading slot in that row through this
 * portal instead of laying out its own fixed-position cluster that ends up
 * underneath it. Renders nothing until `NavCluster` has mounted its slot.
 */
export function ChromeSlotPortal({ children }: { children: ReactNode }) {
  const { slot } = useChromeSlotContext();
  if (!slot) return null;
  return createPortal(children, slot);
}
