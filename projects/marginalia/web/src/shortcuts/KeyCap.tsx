import type { ReactNode } from "react";
import styles from "./KeyCap.module.css";

interface KeyCapAnchorProps {
  /** The key label to show, e.g. SHORTCUT_KEYS.settings — always pass the
   * constant from keys.ts, never a re-typed literal (that's the "derived,
   * not written" acceptance bar). */
  shortcutKey: string;
  /** A modifier glyph (e.g. "⇧") prefixed onto the rendered keycap, for a
   * binding registered with `shift: true` alongside `shortcutKey` — M24.7
   * §G's "the binding tells the truth": a shift-only binding shown as a bare
   * letter would advertise a key that does nothing. */
  modifier?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps an icon control with a proximity-revealed keycap hint. `aria-hidden`
 * on the keycap itself — it's decoration layered over a control that already
 * carries its own accessible name (`aria-label`/`title`), never the only way
 * to discover what the key does.
 */
export function KeyCapAnchor({ shortcutKey, modifier, children, className }: KeyCapAnchorProps) {
  const label = shortcutKey.length === 1 ? shortcutKey.toUpperCase() : shortcutKey;
  return (
    <span className={[styles.anchor, className].filter(Boolean).join(" ")}>
      {children}
      <span aria-hidden="true" className={styles.keycap}>
        {modifier ? `${modifier}${label}` : label}
      </span>
    </span>
  );
}
