import type Database from "better-sqlite3";

/**
 * M34 §B5: the lookahead/spoilers toggle, per book — independent of the
 * context-ladder depth (`ladder.ts`) even though both live on
 * `resource_ai_settings`. Off by default: a book with no row, or no
 * explicit choice yet, reads as masked.
 */
export function getLookahead(db: Database.Database, resourceId: string): boolean {
  const row = db
    .prepare("SELECT lookahead FROM resource_ai_settings WHERE resource_id = ?")
    .get(resourceId) as { lookahead: number } | undefined;
  return row?.lookahead === 1;
}

export function setLookahead(db: Database.Database, resourceId: string, enabled: boolean): void {
  db.prepare(
    `INSERT INTO resource_ai_settings (resource_id, lookahead, updated_at)
     VALUES (@resourceId, @lookahead, @updatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET
       lookahead = @lookahead, updated_at = @updatedAt`,
  ).run({ resourceId, lookahead: enabled ? 1 : 0, updatedAt: new Date().toISOString() });
}
