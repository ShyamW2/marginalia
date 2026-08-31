import type Database from "better-sqlite3";
import { listChapterDigests, type ChapterDigest } from "./store.js";
import { listThematicDigests, type ThematicDigest } from "./thematicStore.js";

/**
 * M34 §B1 ("the mask, made structural"): the one shared gate every
 * reader-facing consumer routes through. The rule (§B's own heading): the
 * mask belongs at the point of *reading*, not the point of *generating* —
 * this never touches how a chapter's digest/thematic row is produced, only
 * whether a given reader-facing call gets to see it.
 */
export interface ChapterVisibilityOptions {
  /** The reader's furthest saved position. No bookmark at all is the
   * caller's `-1` — the conservative "nothing revealed yet" default, same
   * convention `routes/digest.ts`'s existing masking used. */
  bookmarkSpineIndex: number;
  /** Chapters explicitly revealed this session despite sitting past the
   * bookmark — client-tracked, never persisted (decisions.md 2026-07-29
   * later: "revealing is per-item and does not unlock the rest"). */
  revealedSpineIndices?: ReadonlySet<number>;
  /** §B5's lookahead toggle: true bypasses the mask entirely. */
  noMask?: boolean;
}

export function isChapterVisible(spineIndex: number, opts: ChapterVisibilityOptions): boolean {
  if (opts.noMask) return true;
  if (spineIndex <= opts.bookmarkSpineIndex) return true;
  return opts.revealedSpineIndices?.has(spineIndex) ?? false;
}

/** `listChapterDigests`, filtered to what the reader is allowed to see. */
export function visibleChapterDigests(
  db: Database.Database,
  resourceId: string,
  opts: ChapterVisibilityOptions,
): ChapterDigest[] {
  return listChapterDigests(db, resourceId).filter((c) => isChapterVisible(c.spineIndex, opts));
}

/** `listThematicDigests`' sibling — same gate, same options shape. */
export function visibleThematicDigests(
  db: Database.Database,
  resourceId: string,
  opts: ChapterVisibilityOptions,
): ThematicDigest[] {
  return listThematicDigests(db, resourceId).filter((t) => isChapterVisible(t.spineIndex, opts));
}
