import { useEffect } from "react";
import styles from "./Toast.module.css";

interface ToastProps {
  message: string;
  tone?: "success" | "error";
  /** "bottom" (default) collides with the reader's footer pagination bar — use "top" there. */
  position?: "bottom" | "top";
  onDismiss: () => void;
}

/** A single auto-dismissing status toast (publish results, etc.). */
export function Toast({ message, tone = "success", position = "bottom", onDismiss }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4500);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  const classes = [styles.toast, tone === "error" && styles.error, position === "top" && styles.top]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="status">
      <span>{message}</span>
      <button type="button" className={styles.close} aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
