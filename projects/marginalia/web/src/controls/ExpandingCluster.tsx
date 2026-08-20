import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence } from "motion/react";
import { IconButton } from "./IconButton.js";
import { FlyPanel } from "./FlyPanel.js";
import { useDialogA11y } from "./useDialogA11y.js";
import { useOutsideClick } from "./useOutsideClick.js";
import { captureOverlayOrigin, type OverlayOrigin } from "./overlayOrigin.js";
import styles from "./ExpandingCluster.module.css";

/** READER_REDESIGN.md §1's shared expand timing. */
const HOVER_OPEN_DELAY_MS = 120;
const HOVER_CLOSE_DELAY_MS = 140;
const LONG_PRESS_DELAY_MS = 380;

interface ExpandingClusterPanelProps {
  origin: OverlayOrigin | null;
  label: string;
  panelWidth?: number;
  /** True once the panel is *pinned* (click or long-press) rather than a
   * bare hover peek — see `useDialogA11y`'s `active` doc. */
  interactive: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Split out so `useDialogA11y` only ever runs while the panel actually
 * exists — it's mounted exclusively inside `{open && <...>}`, the same
 * shape `CastingModal`/`SettingsModal` already use for the same hook. */
function ExpandingClusterPanel({ origin, label, panelWidth, interactive, onClose, children }: ExpandingClusterPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(panelRef, onClose, { active: interactive });

  return (
    <FlyPanel
      ref={panelRef}
      origin={origin}
      role={interactive ? "dialog" : undefined}
      aria-label={interactive ? label : undefined}
      tabIndex={interactive ? -1 : undefined}
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
 * consumers. Two independent ways to be open, both driving one `open` flag
 * (`pinned || hovering`), so the panel never remounts (and never re-flies)
 * moving from one to the other:
 *
 * - **Hovering** — a mouse/pen lingering over the trigger *or the panel
 *   itself* (both live inside `wrapRef`, so crossing between them fires no
 *   enter/leave) opens after `HOVER_OPEN_DELAY_MS`, closes
 *   `HOVER_CLOSE_DELAY_MS` after the pointer actually leaves — the grace
 *   period READER_REDESIGN.md §1 asks for so travelling to an adjacent
 *   cluster's icon doesn't flicker the one you're leaving. It is a peek:
 *   `useDialogA11y` stays inert (`interactive={false}` below), because
 *   stealing keyboard focus or trapping Tab off a bare hover would yank the
 *   user out of whatever they were actually doing.
 * - **Pinned** — a click, or a touch long-press (`LONG_PRESS_DELAY_MS`),
 *   makes it a real dialog: focus moves in, Tab loops, Esc and an outside
 *   click close it. This is also every keyboard/touch user's *only* path
 *   in, which is the point — the brief warns hover-only functions aren't
 *   reachable without it (READER_REDESIGN.md §1).
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
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [origin, setOrigin] = useState<OverlayOrigin | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const internalTriggerRef = useRef<HTMLButtonElement>(null);
  const resolvedTriggerRef = triggerRef ?? internalTriggerRef;

  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const open = pinned || hovering;

  function clearTimer(ref: MutableRefObject<number | null>) {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  }

  function captureOrigin() {
    if (resolvedTriggerRef.current) {
      setOrigin(captureOverlayOrigin(resolvedTriggerRef.current));
    }
  }

  function closeAll() {
    clearTimer(openTimerRef);
    clearTimer(closeTimerRef);
    clearTimer(longPressTimerRef);
    setPinned(false);
    setHovering(false);
  }

  function pin() {
    clearTimer(openTimerRef);
    clearTimer(closeTimerRef);
    captureOrigin();
    setHovering(false);
    setPinned(true);
  }

  function handleTriggerClick() {
    if (longPressFiredRef.current) {
      // The synthetic click Safari/Android fire after a touchend that
      // already long-pressed — the pin already happened, this would toggle
      // it straight back off.
      longPressFiredRef.current = false;
      return;
    }
    if (pinned) {
      closeAll();
    } else {
      pin();
    }
  }

  function handleWrapPointerEnter(event: ReactPointerEvent) {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    clearTimer(closeTimerRef);
    if (pinned || hovering) return;
    clearTimer(openTimerRef);
    openTimerRef.current = window.setTimeout(() => {
      captureOrigin();
      setHovering(true);
    }, HOVER_OPEN_DELAY_MS);
  }

  function handleWrapPointerLeave(event: ReactPointerEvent) {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    clearTimer(openTimerRef);
    if (!hovering) return;
    clearTimer(closeTimerRef);
    closeTimerRef.current = window.setTimeout(() => setHovering(false), HOVER_CLOSE_DELAY_MS);
  }

  function handleTriggerPointerDown(event: ReactPointerEvent) {
    if (event.pointerType !== "touch") return;
    clearTimer(longPressTimerRef);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      pin();
    }, LONG_PRESS_DELAY_MS);
  }

  function handleTriggerPointerUp(event: ReactPointerEvent) {
    if (event.pointerType !== "touch") return;
    clearTimer(longPressTimerRef);
  }

  useOutsideClick(wrapRef, closeAll, open);

  useEffect(() => {
    return () => {
      clearTimer(openTimerRef);
      clearTimer(closeTimerRef);
      clearTimer(longPressTimerRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(" ")}
      ref={wrapRef}
      onPointerEnter={handleWrapPointerEnter}
      onPointerLeave={handleWrapPointerLeave}
    >
      <IconButton
        ref={resolvedTriggerRef}
        icon={icon}
        label={label}
        pressed={pressed || open}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={handleTriggerClick}
        onPointerDown={handleTriggerPointerDown}
        onPointerUp={handleTriggerPointerUp}
        onPointerCancel={handleTriggerPointerUp}
      />
      <AnimatePresence>
        {open && (
          <ExpandingClusterPanel
            key="panel"
            origin={origin}
            label={label}
            panelWidth={panelWidth}
            interactive={pinned}
            onClose={closeAll}
          >
            {children}
          </ExpandingClusterPanel>
        )}
      </AnimatePresence>
    </div>
  );
}
