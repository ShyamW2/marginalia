import type Database from "better-sqlite3";
import { UNRESOLVABLE_CHAPTER_ANCHOR_CFI } from "@marginalia/shared";
import { createHighlight, findHighlightByExact } from "../annotations/highlights.js";
import { addThreadAnchor, getOrCreateThread, isHighlightAnchored } from "../annotations/threads.js";
import { locateQuoteAnchor } from "./chapterAnchor.js";
import type { ThematicTheme } from "./thematicStore.js";

/**
 * M35 §C5/§D6: turns a chapter's evidenced themes into real, anchored
 * highlight rows — "one theme -> one annotation -> N anchors", the
 * multi-anchor infrastructure §D built existing for exactly this. Runs
 * after a chapter's thematic row is already persisted (`runThematicDigest`),
 * on the same section text the themes' quotes were evidence-filtered
 * against, so every `locateQuoteAnchor` call here is expected to succeed —
 * it's re-run anyway (never trusting an earlier location result blindly)
 * because decision 11 has no exception for "code already checked this once".
 *
 * `kind: "honey"` ("Key quote", the label M30 A already gave that slot) —
 * settled decision 16 forbids inventing a fifth kind, and this is exactly
 * what that slot was named for. `origin: "thematic"` is the separate axis
 * §C6's predicate filters on.
 *
 * Idempotent the same way `findHighlightByExact` already makes the posed-
 * question route idempotent: re-running a thematic pass under an unchanged
 * brief never creates a duplicate highlight for a quote that already has
 * one at this exact text. A theme that starts producing a *different* set
 * of quotes on a later run (a reworded name, a changed brief) simply adds
 * new highlights/anchors alongside whatever's still there — nothing here
 * deletes a highlight a reader may since have annotated further.
 */
export function persistThematicHighlights(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
  sectionText: string,
  themes: ThematicTheme[],
): void {
  for (const theme of themes) {
    const highlightIds: string[] = [];
    for (const quote of theme.quotes) {
      const anchor = locateQuoteAnchor(sectionText, quote);
      if (!anchor) continue;
      const existing = findHighlightByExact(db, resourceId, spineIndex, anchor.exact);
      const highlight =
        existing ??
        createHighlight(db, {
          resourceId,
          exact: anchor.exact,
          prefix: anchor.prefix,
          suffix: anchor.suffix,
          // Same deliberately-unresolvable CFI the chapter-anchor route uses
          // for the same reason: never rendered from a live epub.js
          // selection, so there's no real one to give it — the reader's
          // existing CFI-fails-> search-prefix+exact+suffix fallback is what
          // actually locates it on render.
          cfi: UNRESOLVABLE_CHAPTER_ANCHOR_CFI,
          spineIndex,
          kind: "honey",
          anchorSource: "quote",
          offset: anchor.offset,
          length: anchor.length,
          origin: "thematic",
        });
      highlightIds.push(highlight.id);
    }
    if (highlightIds.length === 0) continue;

    // A highlight already anchoring some other annotation can't become part
    // of this one too — `thread_anchors` has no notion of shared membership
    // (its primary key would throw on a re-add, and letting a highlight
    // belong to two threads at once breaks §D3's primary-resolution join).
    // A re-run reusing the same passage as a different theme's evidence
    // (a changed brief, an overlapping quote) is a normal case, not an
    // error — just nothing new to do for this theme.
    const unclaimed = highlightIds.filter((id) => !isHighlightAnchored(db, id));
    if (unclaimed.length === 0) continue;

    const [primaryId, ...secondaryIds] = unclaimed;
    const thread = getOrCreateThread(db, primaryId);
    for (const highlightId of secondaryIds) {
      addThreadAnchor(db, thread.id, highlightId);
    }
  }
}
