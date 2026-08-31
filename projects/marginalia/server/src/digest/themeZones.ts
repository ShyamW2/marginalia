import { locateQuoteAnchor } from "./chapterAnchor.js";
import type { ThematicTheme } from "./thematicStore.js";

// M35 §E2: "a zone covering 95% is the model shrugging" — TASKS.md's own
// example of what the fourth check exists to reject. 0.6 is a designed
// cutoff, not a measured one (no live provider was run building this): a
// zone past 60% of its own chapter is close enough to the whole chapter
// that the existing quantised chapter-wide band already tells the same
// story, so there's nothing a "precise" span would add worth the false
// confidence — see decisions.md's M35 §E entry for the same reasoning
// stated once, alongside the other constants this milestone had no
// real-provider run to measure against.
const MAX_ZONE_FRACTION = 0.6;

export interface ThemeZoneSpan {
  /** Char offset local to the chapter's own section text. */
  startOffset: number;
  /** Exclusive end offset, same domain as `startOffset`. */
  endOffset: number;
  /** The *located* substring, not the model's raw `zoneStart` text — always
   * a literal match against `sectionText`, safe to hand the reader's find
   * bar for a substring jump (M35 §E6). */
  startQuote: string;
}

/**
 * M35 §E2: "Four sanity checks, all required." Drops (returns null) unless
 * both endpoints locate, the start precedes the end, the span lies inside
 * the chapter, and it doesn't exceed `MAX_ZONE_FRACTION` of the chapter —
 * any failure means "keep the theme at chapter resolution" (today's
 * behaviour), never a wrong or half-checked span. Locates against the
 * chapter's own full section text, exactly like `persistThematicHighlights`
 * already does for quotes — a zone is never located against a single split
 * part's own (shorter) text.
 */
export function computeThemeZone(sectionText: string, theme: Pick<ThematicTheme, "zoneStart" | "zoneEnd">): ThemeZoneSpan | null {
  if (!theme.zoneStart || !theme.zoneEnd) return null;

  const startAnchor = locateQuoteAnchor(sectionText, theme.zoneStart);
  const endAnchor = locateQuoteAnchor(sectionText, theme.zoneEnd);
  if (!startAnchor || !endAnchor) return null; // check 1: both endpoints locate

  const startOffset = startAnchor.offset;
  const endOffset = endAnchor.offset + endAnchor.length;
  if (endOffset <= startOffset) return null; // check 2: start precedes end

  // check 3: span lies inside the chapter — structurally guaranteed by
  // locateQuoteAnchor's own bounds, kept explicit because TASKS.md names it
  // as one of the four rather than a consequence of the other three.
  if (startOffset < 0 || endOffset > sectionText.length) return null;

  const fraction = (endOffset - startOffset) / sectionText.length;
  if (fraction > MAX_ZONE_FRACTION) return null; // check 4: not "the whole chapter"

  return { startOffset, endOffset, startQuote: startAnchor.exact };
}
