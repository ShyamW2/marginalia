import type Database from "better-sqlite3";

export function listTagsForHighlight(db: Database.Database, highlightId: string): string[] {
  const rows = db
    .prepare("SELECT tag FROM highlight_tags WHERE highlight_id = ? ORDER BY tag")
    .all(highlightId) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/** Replaces a highlight's full tag set — the editor sends the whole list, not a delta. */
export function setTagsForHighlight(
  db: Database.Database,
  highlightId: string,
  tags: string[],
): void {
  const unique = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))];
  const replace = db.transaction(() => {
    db.prepare("DELETE FROM highlight_tags WHERE highlight_id = ?").run(highlightId);
    const insert = db.prepare(
      "INSERT INTO highlight_tags (highlight_id, tag) VALUES (?, ?)",
    );
    for (const tag of unique) insert.run(highlightId, tag);
  });
  replace();
}

/** Every distinct tag used anywhere in a resource's highlights, for the scan's filter UI. */
export function listDistinctTagsForResource(db: Database.Database, resourceId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT ht.tag FROM highlight_tags ht
       JOIN highlights h ON h.id = ht.highlight_id
       WHERE h.resource_id = ?
       ORDER BY ht.tag`,
    )
    .all(resourceId) as { tag: string }[];
  return rows.map((r) => r.tag);
}

/** Bulk tag lookup for a set of highlights (the scan's one-query-not-N build). */
export function listTagsByHighlightId(
  db: Database.Database,
  resourceId: string,
): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT ht.highlight_id, ht.tag FROM highlight_tags ht
       JOIN highlights h ON h.id = ht.highlight_id
       WHERE h.resource_id = ?
       ORDER BY ht.tag`,
    )
    .all(resourceId) as { highlight_id: string; tag: string }[];

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.highlight_id);
    if (existing) existing.push(row.tag);
    else map.set(row.highlight_id, [row.tag]);
  }
  return map;
}
