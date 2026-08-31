import type Database from "better-sqlite3";

/**
 * M35 §C7: the show/hide toggle for thematic quotes, per book — same shape
 * as §B5's `lookahead.ts` (a column on this same `resource_ai_settings`
 * table, off by default). Gates whether `origin: 'thematic'` highlights
 * (§C5) are *painted* in the reading surfaces (the book text, the Scan's
 * Mine layer) — a separate question from §C6's predicate, which keeps them
 * out of the highlight count, the Annotations list, and the vault publish
 * unconditionally, regardless of this toggle.
 */
export function getShowThematicQuotes(db: Database.Database, resourceId: string): boolean {
  const row = db
    .prepare("SELECT show_thematic_quotes FROM resource_ai_settings WHERE resource_id = ?")
    .get(resourceId) as { show_thematic_quotes: number } | undefined;
  return row?.show_thematic_quotes === 1;
}

export function setShowThematicQuotes(
  db: Database.Database,
  resourceId: string,
  enabled: boolean,
): void {
  db.prepare(
    `INSERT INTO resource_ai_settings (resource_id, show_thematic_quotes, updated_at)
     VALUES (@resourceId, @showThematicQuotes, @updatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET
       show_thematic_quotes = @showThematicQuotes, updated_at = @updatedAt`,
  ).run({
    resourceId,
    showThematicQuotes: enabled ? 1 : 0,
    updatedAt: new Date().toISOString(),
  });
}
