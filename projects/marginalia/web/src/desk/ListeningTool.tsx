import type { RefObject } from "react";
import styles from "./ListeningTool.module.css";

interface ListeningToolProps {
  engaged: boolean;
  onToggle: () => void;
  /** M23 §C: the desk's 3D layer is drawing this as a real deck
   * (`Turntable3D.tsx`), so the flat SVG stands down — the button keeps its
   * box, its hit target, its focus ring and its label. */
  show3D?: boolean;
  /** A book is being dragged over it right now. Presentation-independent: the
   * drop gesture is a DOM gesture and works whether or not 3D is running. */
  dropActive?: boolean;
  toolRef?: RefObject<HTMLButtonElement>;
}

/**
 * M22 "the desk tool" (DESIGN.md "Listening": "a tactile object (deck,
 * gramophone) that lights when engaged, after which opening any book opens
 * it listening"). A real button, not a div with a click handler — its
 * pressed state and accessible name are what a keyboard/screen-reader user
 * gets in place of the glow. It is the charm, never the gate: BookObject's
 * plain click and the list view's "Listen" action both already work without
 * this ever being touched.
 *
 * M23 §C made it a 3D deck, and this is still the whole control. The 3D
 * object is drawn from *this element's rect* and driven by *these props*; it
 * has no input of its own, so nothing below changes when the canvas goes away
 * under reduced motion or a lost context.
 */
export function ListeningTool({ engaged, onToggle, show3D = false, dropActive = false, toolRef }: ListeningToolProps) {
  const label = engaged ? "Listening" : "Listen";
  return (
    <button
      ref={toolRef}
      type="button"
      className={[styles.tool, engaged ? styles.engaged : "", show3D ? styles.is3D : "", dropActive ? styles.dropTarget : ""]
        .filter(Boolean)
        .join(" ")}
      aria-pressed={engaged}
      aria-label={engaged ? "Listening mode on — opening a book will start it listening. Click to turn off." : "Turn on listening mode"}
      title={engaged ? "Listening mode on" : "Listening mode"}
      onClick={onToggle}
    >
      {!show3D && (
        <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true" className={styles.icon}>
          <circle cx="15" cy="17" r="10.5" fill="var(--tool-plate, #2b2620)" stroke="var(--tool-rim, #6b5c45)" strokeWidth="1.4" />
          <circle cx="15" cy="17" r="3.4" fill="none" stroke="var(--tool-rim, #6b5c45)" strokeWidth="1.2" />
          <circle cx="15" cy="17" r="0.9" fill="var(--tool-rim, #6b5c45)" />
          <path d="M20.5 10.5 L26 5.5" stroke="var(--tool-arm, #8a7a5f)" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="26" cy="5.5" r="1.6" fill="var(--tool-glow, #d8c48a)" className={styles.needle} />
        </svg>
      )}
      <span className={styles.label}>{label}</span>
    </button>
  );
}
