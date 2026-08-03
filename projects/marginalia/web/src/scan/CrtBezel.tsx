import type { ReactNode } from "react";
import styles from "./CrtBezel.module.css";

interface CrtBezelProps {
  children: ReactNode;
}

/**
 * The Scan's television chassis (M20.5, decisions.md 2026-07-30 "Scan and
 * Digest stop being rooms"). `.screen` clips and hosts the instrument's own
 * warped content; this frame itself is never inside the warp filter's
 * ancestor chain, so it stays razor-straight at every CRT intensity — see
 * `.screen`'s sibling relationship to `ScanPage`'s `warpWrapper` for why that
 * matters (PAGE_CURL.md-style "what it cannot do" note lives in ScanPage.tsx
 * instead, since this component owns none of the warp math).
 */
export function CrtBezel({ children }: CrtBezelProps) {
  return (
    <div className={styles.chassis} aria-hidden={false}>
      <div className={styles.ledRow} aria-hidden="true">
        <span className={styles.led} />
        <span className={styles.chassisLabel}>Scan</span>
      </div>
      <div className={styles.screen}>{children}</div>
    </div>
  );
}
