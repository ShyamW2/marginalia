import { useRef, useState } from "react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { SettingsPage } from "./SettingsPage.js";
import { IconButton } from "../controls/IconButton.js";
import { FlyPanel } from "../controls/FlyPanel.js";
import { readPendingOverlayOrigin, type OverlayOrigin } from "../controls/overlayOrigin.js";
import { useDialogA11y } from "../controls/useDialogA11y.js";
import styles from "./SettingsModal.module.css";

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
  // Read once, on mount — M19.7 "overlay motion: fly from the caller". Every
  // settings entry point stashes its trigger's rect the instant it's
  // clicked (setPendingOverlayOrigin); a direct/deep link leaves this null,
  // which FlyPanel renders as a plain crossfade.
  const [origin] = useState<OverlayOrigin | null>(() => readPendingOverlayOrigin());

  useDialogA11y(panelRef, onClose);

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
