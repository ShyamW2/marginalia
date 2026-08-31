import type Database from "better-sqlite3";
import { listBookThemes } from "./canonicalThemes.js";

export interface ThematicCandidate {
  spineIndex: number;
  analysis: string;
  themes: string[];
}

// M34 §C2: essays are capped, not the chapter summaries above them (§C1
// leaves those whole) — this is the number decisions.md measured against
// (~34K of the Digest rung's 61K was thematic prose on a 55-chapter book).
const THEMATIC_ESSAY_CAP = 9;

/**
 * M34 §C: narrows the Digest rung's thematic block from "every visible,
 * briefed chapter" to the highlight's own chapter, the one before it, and a
 * ranked few more — the two unconditional entries are the recency floor
 * (§C4: no separate recency weighting on top of them).
 *
 * Ranking (§C0a) compares each candidate chapter's *weighted* parent-theme
 * vector — how many of its raw chapter themes land under each of the book's
 * distilled parent themes (`listBookThemes` / `theme_parents`) — against the
 * highlight chapter's own vector, never against raw chapter-theme overlap
 * (§C3: raw theme strings essentially never repeat across chapters, so set
 * overlap on them ranks nothing). A book with no distillation yet, or a
 * highlight chapter with no thematic vector of its own to rank from, has no
 * ranking signal and falls back to the two unconditional chapters only —
 * never to "everything" (§C3's explicit fallback).
 *
 * Deterministic (§C5) for a given (book, highlight chapter, candidate set,
 * brief): ties in score break on spine index, ascending.
 */
export function selectThematicChapters(
  db: Database.Database,
  resourceId: string,
  candidates: ThematicCandidate[],
  highlightSpineIndex: number,
): ThematicCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.spineIndex - b.spineIndex);
  const byIndex = new Map(sorted.map((c) => [c.spineIndex, c]));

  const current = byIndex.get(highlightSpineIndex) ?? null;
  const previousIndex = sorted
    .map((c) => c.spineIndex)
    .filter((i) => i < highlightSpineIndex)
    .sort((a, b) => b - a)[0];

  const unconditionalIndices = new Set<number>();
  if (current) unconditionalIndices.add(highlightSpineIndex);
  if (previousIndex !== undefined) unconditionalIndices.add(previousIndex);
  const unconditional = sorted.filter((c) => unconditionalIndices.has(c.spineIndex));

  const bookThemes = listBookThemes(db, resourceId);
  if (bookThemes.length === 0 || !current) {
    return unconditional;
  }

  const parentOf = new Map<string, string>();
  for (const theme of bookThemes) {
    for (const child of theme.children) parentOf.set(child, theme.id);
  }
  const parentIds = bookThemes.map((t) => t.id);

  function vector(chapter: ThematicCandidate): number[] {
    const counts = new Map<string, number>();
    for (const theme of chapter.themes) {
      const parentId = parentOf.get(theme);
      if (!parentId) continue;
      counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
    }
    return parentIds.map((id) => counts.get(id) ?? 0);
  }

  const budget = THEMATIC_ESSAY_CAP - unconditional.length;
  if (budget <= 0) return unconditional;

  const referenceVector = vector(current);
  const remaining = sorted.filter((c) => !unconditionalIndices.has(c.spineIndex));
  const ranked = remaining
    .map((chapter) => {
      const v = vector(chapter);
      const score = v.reduce((sum, count, i) => sum + count * referenceVector[i], 0);
      return { chapter, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.chapter.spineIndex - b.chapter.spineIndex)
    .slice(0, budget)
    .map((r) => r.chapter);

  return [...unconditional, ...ranked].sort((a, b) => a.spineIndex - b.spineIndex);
}
