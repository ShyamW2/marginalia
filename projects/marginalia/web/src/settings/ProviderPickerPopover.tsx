import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ProviderRole } from "@marginalia/shared";
import { ProviderPicker } from "./ProviderPicker.js";
import { IconButton } from "../controls/IconButton.js";
import styles from "./ProviderPickerPopover.module.css";

interface ProviderPickerPopoverProps {
  role: ProviderRole;
  /** aria-label for the trigger icon — callers name the surface it lives in
   * ("Query provider", not just "Provider") since a screen reader user has
   * no visual context for which icon this is. */
  label: string;
  onNavigateToSettings: (event: import("react").MouseEvent<HTMLButtonElement>) => void;
}

/**
 * "A small icon... that opens the same slider on hover — or click, for
 * touch — with a click-through into settings" (TASKS.md M19). Hover opens it
 * eagerly for a mouse; click is the reliable trigger for everyone else
 * (touch, keyboard) — nothing here assumes hover exists, it's just a
 * convenience on top of click.
 */
export function ProviderPickerPopover({ role, label, onNavigateToSettings }: ProviderPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const closeTimer = useRef<number | null>(null);

  function cancelClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 250);
  }

  return (
    <div
      className={styles.wrap}
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <IconButton
        variant="outline"
        size="sm"
        className={styles.trigger}
        aria-haspopup="true"
        aria-expanded={open}
        pressed={open}
        label={label}
        onClick={() => setOpen((prev) => !prev)}
        icon={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 5.5v3l2 1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        }
      />
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.popover}
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -4 }}
            transition={{ duration: reducedMotion ? 0.001 : 0.14, ease: "easeOut" }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <ProviderPicker
              role={role}
              variant="compact"
              onNavigateToSettings={(event) => {
                setOpen(false);
                onNavigateToSettings(event);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
