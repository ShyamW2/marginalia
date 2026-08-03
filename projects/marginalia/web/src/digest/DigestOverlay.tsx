import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FlyPanel } from "../controls/FlyPanel.js";
import { IconButton } from "../controls/IconButton.js";
import { readPendingOverlayOrigin, type OverlayOrigin } from "../controls/overlayOrigin.js";
import { useDialogA11y } from "../controls/useDialogA11y.js";
import { DigestPage } from "./DigestPage.js";
import styles from "./DigestOverlay.module.css";

interface DigestOverlayProps {
  resourceId: string;
  onClose: () => void;
}

/**
 * The Digest as an instrument (M20.5, decisions.md 2026-07-30 "Scan and
 * Digest stop being rooms"): a popup over whatever room was already
 * showing, the same `FlyPanel`/dialog shell the Scan and Settings already
 * use (useDialogA11y) — with one addition the Scan didn't need: an expand
 * control, since a book's full digest is a lot more reading than the
 * Scan's instrument-panel readouts. `FlyPanel`'s `layout` animation is what
 * morphs the box on expand/shrink — the same mechanism a Settings tab
 * change already relies on, not a second resize animation.
 */
export function DigestOverlay({ resourceId, onClose }: DigestOverlayProps) {
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [origin] = useState<OverlayOrigin | null>(() => readPendingOverlayOrigin());
  const [expanded, setExpanded] = useState(false);

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
        className={`${styles.panel} ${expanded ? styles.expanded : ""} register-paper`}
        role="dialog"
        aria-modal="true"
        aria-label="Digest"
        tabIndex={-1}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.chrome}>
          <IconButton
            icon={expanded ? "⤡" : "⤢"}
            label={expanded ? "Shrink the digest" : "Expand the digest to fullscreen"}
            pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
          />
          <IconButton icon="×" label="Close digest" onClick={onClose} />
        </div>
        <DigestPage resourceId={resourceId} />
      </FlyPanel>
    </motion.div>
  );
}
