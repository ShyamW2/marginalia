import { useRef, useState, type ReactNode, type RefObject } from "react";
import { AnimatePresence } from "motion/react";
import { IconButton } from "./IconButton.js";
import { FlyPanel } from "./FlyPanel.js";
import { useDialogA11y } from "./useDialogA11y.js";
import { useOutsideClick } from "./useOutsideClick.js";
import { captureOverlayOrigin, type OverlayOrigin } from "./overlayOrigin.js";
import styles from "./ExpandingCluster.module.css";

interface ExpandingClusterPanelProps {
  origin: OverlayOrigin | null;
  label: string;
  panelWidth?: number;
  onClose: () => void;
  children: ReactNode;
}

/** Split out so `useDialogA11y` only ever runs while the panel actually
 * exists — it's mounted exclusively inside `{open && <...>}`, the same
 * shape `CastingModal`/`SettingsModal` already use for the same hook. */
function ExpandingClusterPanel({ origin, label, panelWidth, onClose, children }: ExpandingClusterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(panelRef, onClose);

  return (
    <FlyPanel
      ref={panelRef}
      origin={origin}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={styles.panel}
      style={panelWidth ? { width: panelWidth } : undefined}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
    >
      {children}
    </FlyPanel>
  );
}

export interface ExpandingClusterProps {
  icon: ReactNode;
  label: string;
  /** Visual resting state independent of `open` — e.g. listening's
   * play/pause icon should look "on" while playing even with the panel
   * closed. */
  pressed?: boolean;
  /** Lets a caller keep an external ref to the trigger (keyboard-shortcut
   * focus targets, e.g. `digestButtonRef`/`scanButtonRef`) instead of only
   * an internal one. */
  triggerRef?: RefObject<HTMLButtonElement>;
  panelWidth?: number;
  className?: string;
  children: ReactNode;
}

/**
 * M24.7 §A/§D: the shared "grouped functions live behind one icon, not a
 * row of buttons" wrapper — digest and listening are the first two
 * consumers. Scope for this pass is deliberately the minimal one: click
 * opens/pins, Esc or an outside click closes, focus traps while open. The
 * fuller hover-open (120ms)/hover-close (140ms)/long-press (380ms) timing
 * from READER_REDESIGN.md §1 is left for a later §D pass — not built here.
 */
export function ExpandingCluster({
  icon,
  label,
  pressed,
  triggerRef,
  panelWidth,
  className,
  children,
}: ExpandingClusterProps) {
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<OverlayOrigin | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const resolvedTriggerRef = triggerRef ?? internalTriggerRef;

  function close() {
    setOpen(false);
  }

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next && resolvedTriggerRef.current) {
        setOrigin(captureOverlayOrigin(resolvedTriggerRef.current));
      }
      return next;
    });
  }

  useOutsideClick(wrapRef, close, open);

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(" ")} ref={wrapRef}>
      <IconButton
        ref={resolvedTriggerRef}
        icon={icon}
        label={label}
        pressed={pressed || open}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggle}
      />
      <AnimatePresence>
        {open && (
          <ExpandingClusterPanel key="panel" origin={origin} label={label} panelWidth={panelWidth} onClose={close}>
            {children}
          </ExpandingClusterPanel>
        )}
      </AnimatePresence>
    </div>
  );
}
