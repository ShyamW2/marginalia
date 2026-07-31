import { useEffect, useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { SettingsPage } from "./SettingsPage.js";
import { IconButton } from "../controls/IconButton.js";
import { FlyPanel } from "../controls/FlyPanel.js";
import { readPendingOverlayOrigin, type OverlayOrigin } from "../controls/overlayOrigin.js";
import styles from "./SettingsModal.module.css";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface SettingsModalProps {
  onClose: () => void;
}

/**
 * M11 (DESIGN.md 2026-07-20 entry): settings is an overlay above whatever
 * room the user was already in, not a fourth room — see App.tsx for how the
 * background route stays mounted underneath via the react-router
 * "background location" pattern. This component owns only the dialog shell
 * (backdrop, focus trap, Escape, aria-modal); the form itself is the
 * unchanged SettingsPage.
 */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  // Read once, on mount — M19.7 "overlay motion: fly from the caller". Every
  // settings entry point stashes its trigger's rect the instant it's
  // clicked (setPendingOverlayOrigin); a direct/deep link leaves this null,
  // which FlyPanel renders as a plain crossfade.
  const [origin] = useState<OverlayOrigin | null>(() => readPendingOverlayOrigin());

  useEffect(() => {
    triggerRef.current = document.activeElement;
    // Move focus into the dialog itself first — a specific field grabbing
    // focus (e.g. the first text input) would be more polished, but the
    // panel is the boring, always-correct target regardless of which
    // provider's fields happen to be showing.
    panelRef.current?.focus();

    return () => {
      // Escape "returns focus to the control that opened it" (acceptance) —
      // works the same way for a click, since click always leaves the
      // trigger focused right before this effect captured it.
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!panel.contains(active)) {
        // Focus escaped the panel entirely (e.g. programmatic blur) — pull
        // it back in rather than letting Tab continue into the page behind.
        event.preventDefault();
        first.focus();
      }
    }
    // Capture phase: this must win over ReaderView's own window-level
    // Escape handler (closes the thread panel / clears a selection), since
    // the modal is visually on top and should absorb the keypress first.
    window.addEventListener("keydown", handleKeydown, true);
    return () => window.removeEventListener("keydown", handleKeydown, true);
  }, [onClose]);

  return (
    <motion.div
      className={styles.backdrop}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0.001 : 0.15, ease: "easeOut" }}
      onClick={onClose}
    >
      <LayoutGroup>
        <FlyPanel
          ref={panelRef}
          origin={origin}
          className={`${styles.panel} register-paper`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          tabIndex={-1}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => event.stopPropagation()}
        >
          <IconButton icon="×" label="Close settings" className={styles.closeButton} onClick={onClose} />
          <SettingsPage titleId="settings-modal-title" />
        </FlyPanel>
      </LayoutGroup>
    </motion.div>
  );
}
