/**
 * Anchoring rule (SPEC): the CFI range is the primary anchor. If CFI
 * resolution fails at render time, fall back to searching the section's
 * text for prefix+exact+suffix, then exact alone; if that also fails, the
 * highlight is "unanchored" but not dropped.
 */

import { findAnchorInText } from "@marginalia/shared";
import type { AnchorText, TextMatch } from "@marginalia/shared";

export { findAnchorInText };
export type { AnchorText, TextMatch };

/** Minimal structural shape a resolved CFI range must satisfy — matches the
 * DOM Range interface without requiring one in tests. */
export interface RangeLike {
  collapsed: boolean;
}

export type AnchorResolution<T extends RangeLike> =
  | { status: "cfi"; range: T }
  | { status: "fallback"; match: TextMatch }
  | { status: "unanchored" };

/**
 * Orchestrates the three-tier anchoring rule: try the CFI first, fall back
 * to text search, and flag as unanchored if neither works. `tryCfi` should
 * return null (or throw) if the CFI can't be resolved against the current
 * document — both are treated as "CFI broken".
 */
export function resolveAnchor<T extends RangeLike>(params: {
  tryCfi: () => T | null;
  sectionText: string;
  anchor: AnchorText;
}): AnchorResolution<T> {
  let range: T | null = null;
  try {
    range = params.tryCfi();
  } catch {
    range = null;
  }

  if (range && !range.collapsed) {
    return { status: "cfi", range };
  }

  const match = findAnchorInText(params.sectionText, params.anchor);
  if (match) {
    return { status: "fallback", match };
  }

  return { status: "unanchored" };
}
