/**
 * Anchoring rule (M40 §B, PDF.md §7.3 — amends the CFI-primary rule SPEC.md
 * used to state, since a format with no CFI can't follow it): `Locator` —
 * `(sectionIndex, offset, length)` — is the primary anchor. Resolution
 * order: (1) the CFI, if present — EPUB's fast path, unchanged speed and
 * unchanged behaviour; (2) a prefix+exact+suffix text search against the
 * section; (3) the stored `(offset, length)` against the section's current
 * length, trusted without re-searching; (4) unanchored, but never dropped.
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
  | { status: "offset"; start: number; end: number }
  | { status: "unanchored" };

/**
 * Orchestrates the anchoring rule: try the CFI first, fall back to text
 * search, then to the stored offset/length, and flag as unanchored if none
 * work. `tryCfi` should return null (or throw) if the CFI can't be resolved
 * against the current document — both are treated as "CFI broken".
 *
 * `offset`/`length` are optional — omitted (or null) entirely by any caller
 * that has no `Locator` to offer, which is every EPUB call site until a
 * highlight actually carries one server-side (M35 §A1's columns, exposed to
 * the client as of this milestone).
 */
export function resolveAnchor<T extends RangeLike>(params: {
  tryCfi: () => T | null;
  sectionText: string;
  anchor: AnchorText;
  offset?: number | null;
  length?: number | null;
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

  if (params.offset != null && params.length != null) {
    const start = params.offset;
    const end = start + params.length;
    if (start >= 0 && end <= params.sectionText.length) {
      return { status: "offset", start, end };
    }
  }

  return { status: "unanchored" };
}
