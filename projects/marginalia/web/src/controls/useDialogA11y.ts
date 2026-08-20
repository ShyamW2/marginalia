import { useEffect, useRef, type RefObject } from "react";
import { SHORTCUT_KEYS } from "../shortcuts/keys.js";
import { useShortcuts } from "../shortcuts/useShortcuts.js";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The dialog mechanics every popup instrument shares (M11's `SettingsModal`,
 * generalised for M20.5's Scan/Digest overlays rather than copied a third
 * time): move focus into the panel on mount, restore it to whatever
 * triggered the open on unmount, Escape closes via the shared shortcut
 * registry, and Tab loops inside the panel instead of leaking into the room
 * behind it. Callers own the backdrop/FlyPanel/content — this hook only
 * owns focus and Escape.
 *
 * `active` (default true) lets a caller mount the panel without any of this
 * running — `ExpandingCluster`'s hover-revealed peek (READER_REDESIGN.md
 * §1/M24.7 §D) is visible the moment the pointer lingers, and grabbing
 * keyboard focus or trapping Tab off a bare mouse hover would steal focus
 * from wherever the user actually was. The click/long-press *pin* is what
 * turns it into a real dialog, flipping `active` on.
 */
export function useDialogA11y(panelRef: RefObject<HTMLElement>, onClose: () => void, options?: { active?: boolean }): void {
  const active = options?.active ?? true;
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    triggerRef.current = document.activeElement;
    panelRef.current?.focus();

    return () => {
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useShortcuts(active ? [{ key: SHORTCUT_KEYS.escape, handler: onClose, allowWhileTyping: true }] : []);

  useEffect(() => {
    if (!active) return undefined;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
