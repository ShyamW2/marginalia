import type Database from "better-sqlite3";

/** Replaces a highlight's full theme set — the tagging pass sends the whole
 * list per highlight, not a delta (same convention as tags.ts's
 * setTagsForHighlight). */
export function setThemesForHighlight(
  db: Database.Database,
  highlightId: string,
  themes: string[],
): void {
  const unique = [...new Set(themes.map((t) => t.trim()).filter((t) => t.length > 0))];
  const replace = db.transaction(() => {
    db.prepare("DELETE FROM highlight_themes WHERE highlight_id = ?").run(highlightId);
    const insert = db.prepare(
      "INSERT INTO highlight_themes (highlight_id, theme) VALUES (?, ?)",
    );
    for (const theme of unique) insert.run(highlightId, theme);
  });
  replace();
}

export function listThemesForHighlight(db: Database.Database, highlightId: string): string[] {
  const rows = db
    .prepare("SELECT theme FROM highlight_themes WHERE highlight_id = ? ORDER BY theme")
    .all(highlightId) as { theme: string }[];
  return rows.map((r) => r.theme);
}

/** Bulk theme lookup for a resource's highlights (the scan's one-query build). */
export function listThemesByHighlightId(
  db: Database.Database,
  resourceId: string,
): Map<string, string[]> {
  const rows = db
    .prepare(
      `SELECT ht.highlight_id, ht.theme FROM highlight_themes ht
       JOIN highlights h ON h.id = ht.highlight_id
       WHERE h.resource_id = ?
       ORDER BY ht.theme`,
    )
    .all(resourceId) as { highlight_id: string; theme: string }[];

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.highlight_id);
    if (existing) existing.push(row.theme);
    else map.set(row.highlight_id, [row.theme]);
  }
  return map;
}

/** Highlight ids in this resource that have never been tagged at all —
 * the tagging pass's scope (see themeTagging.ts): first-time tagging only,
 * not a re-run-on-every-vocabulary-change pass (documented scope cut,
 * NOTES.md "M19.5"). */
export function listUntaggedHighlightIds(db: Database.Database, resourceId: string): string[] {
  const rows = db
    .prepare(
      `SELECT h.id FROM highlights h
       WHERE h.resource_id = ?
         AND h.id NOT IN (SELECT highlight_id FROM highlight_themes)`,
    )
    .all(resourceId) as { id: string }[];
  return rows.map((r) => r.id);
}
