import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FlyPanel } from "../controls/FlyPanel.js";
import { IconButton } from "../controls/IconButton.js";
import { readPendingOverlayOrigin, type OverlayOrigin } from "../controls/overlayOrigin.js";
import { useDialogA11y } from "../controls/useDialogA11y.js";
import { CrtBezel } from "./CrtBezel.js";
import { ScanPage } from "./ScanPage.js";
import styles from "./ScanOverlay.module.css";

interface ScanOverlayProps {
  resourceId: string;
  onClose: () => void;
}

/**
 * The Scan as an instrument (M20.5, decisions.md 2026-07-30 "Scan and Digest
 * stop being rooms"): a popup framed as a CRT television, over whatever room
 * was already showing — the same `FlyPanel`/dialog shell `SettingsModal`
 * established, not a second one (useDialogA11y). `CrtBezel` is the one part
 * that's new: a frame that must never enter the warp filter's ancestor
 * chain, so it sits here, outside `ScanPage`'s own warped wrapper.
 */
export function ScanOverlay({ resourceId, onClose }: ScanOverlayProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
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
      <FlyPanel
        ref={panelRef}
        origin={origin}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Scan"
        tabIndex={-1}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        <CrtBezel>
          <IconButton
            icon="×"
            label="Close scan"
            className={styles.closeButton}
            onClick={onClose}
          />
          <ScanPage resourceId={resourceId} onClose={onClose} />
        </CrtBezel>
      </FlyPanel>
    </motion.div>
  );
}
