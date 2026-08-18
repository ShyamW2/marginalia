import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { matchConcept, slugify, type ExistingConcept } from "../vault/concepts.js";

/** Distinct from the four highlight-kind hues (`--kind-*`) — see
 * `web/src/theme.css`'s `--theme-ramp-*` block, which this index selects
 * into. Sized to the distillation pass's own cap (TASKS.md M24.5 §1: "~6-8
 * book-level themes"), so one book's own set is guaranteed distinct colours. */
export const THEME_RAMP_SIZE = 8;

export interface CanonicalTheme {
  id: string;
  name: string;
  slug: string;
  colorIndex: number;
  createdAt: string;
}

interface CanonicalThemeRow {
  id: string;
  name: string;
  slug: string;
  color_index: number;
  created_at: string;
}

function rowToCanonicalTheme(row: CanonicalThemeRow): CanonicalTheme {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    colorIndex: row.color_index,
    createdAt: row.created_at,
  };
}

/** Every canonical (book-level) theme in the library, oldest first — the
 * one shared vocabulary TASKS.md M24.5 §3 asks for, discovered from reading
 * rather than authored up front. */
export function listCanonicalThemes(db: Database.Database): CanonicalTheme[] {
  const rows = db
    .prepare("SELECT * FROM canonical_themes ORDER BY created_at ASC")
    .all() as CanonicalThemeRow[];
  return rows.map(rowToCanonicalTheme);
}

function createCanonicalTheme(db: Database.Database, name: string, colorIndex: number): CanonicalTheme {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const slug = slugify(name);
  db.prepare(
    `INSERT INTO canonical_themes (id, name, slug, color_index, created_at) VALUES (@id, @name, @slug, @colorIndex, @createdAt)`,
  ).run({ id, name, slug, colorIndex, createdAt });
  return { id, name, slug, colorIndex, createdAt };
}

/**
 * Resolves a book's own distilled theme names against the library-wide
 * canonical vocabulary (TASKS.md M24.5 §3). Reuses `matchConcept` — the same
 * slug/alias/Levenshtein rule `vault/concepts.ts` already uses to decide
 * whether a proposed concept is one the vault has already seen — rather than
 * inventing a second heuristic for theme names, which are the same kind of
 * object (a short name discovered from reading, matched fuzzily across
 * documents). A match reuses the existing row (and its already-assigned
 * colour, which is what keeps a rebuild's colours from reshuffling); a miss
 * creates a new one, coloured by its 0-based position in *this* distilled
 * list — the position is only ever consulted at creation, never again, so
 * it needs no independent stability guarantee of its own.
 *
 * Matches within the same call too: `existingAsConcepts` grows as new themes
 * are created, so two near-duplicate names distilled from the *same* book
 * (an LLM slip, not a cross-book coincidence) still collapse onto one row.
 */
export function resolveCanonicalThemes(db: Database.Database, distilledNames: string[]): CanonicalTheme[] {
  const existing = listCanonicalThemes(db);
  const existingAsConcepts: ExistingConcept[] = existing.map((t) => ({
    name: t.name,
    aliases: [],
    relPath: "",
  }));
  const byName = new Map(existing.map((t) => [t.name, t]));

  return distilledNames.map((name, index) => {
    const match = matchConcept(existingAsConcepts, { name, aliases: [] });
    if (match) return byName.get(match.name)!;

    const created = createCanonicalTheme(db, name, index % THEME_RAMP_SIZE);
    existingAsConcepts.push({ name: created.name, aliases: [], relPath: "" });
    byName.set(created.name, created);
    return created;
  });
}

/** One book-level theme as this resource sees it: the canonical identity
 * (name, colour) plus which of this book's own chapter-level theme strings
 * it's the distilled parent of — TASKS.md M24.5 §4's "specific themes
 * reachable underneath". */
export interface BookTheme {
  id: string;
  name: string;
  colorIndex: number;
  children: string[];
}

/**
 * Replaces (wholesale) this resource's book-level themes and their
 * chapter-theme children. A full delete-then-insert per resource, matching
 * every other regenerate-on-rerun table in this file's neighbourhood
 * (`thematic_digests`'s ON CONFLICT overwrite, `book_digest_snapshots`'s
 * single-row-per-resource) — the distillation pass has no notion of a
 * *stale* book theme, only a current set, so a rerun simply replaces it.
 * `canonical_themes` rows themselves are never deleted here: they are
 * library-wide memory, not this resource's to own.
 */
export function replaceBookThemes(
  db: Database.Database,
  resourceId: string,
  parents: CanonicalTheme[],
  childrenByParentId: Map<string, string[]>,
): void {
  const generatedAt = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM book_themes WHERE resource_id = ?").run(resourceId);
    db.prepare("DELETE FROM theme_parents WHERE resource_id = ?").run(resourceId);
    for (const parent of parents) {
      db.prepare(
        `INSERT OR IGNORE INTO book_themes (resource_id, canonical_theme_id, generated_at) VALUES (@resourceId, @canonicalThemeId, @generatedAt)`,
      ).run({ resourceId, canonicalThemeId: parent.id, generatedAt });
      for (const chapterTheme of childrenByParentId.get(parent.id) ?? []) {
        db.prepare(
          `INSERT OR REPLACE INTO theme_parents (resource_id, chapter_theme, canonical_theme_id) VALUES (@resourceId, @chapterTheme, @canonicalThemeId)`,
        ).run({ resourceId, chapterTheme, canonicalThemeId: parent.id });
      }
    }
  });
  tx();
}

/** This resource's book-level themes, each with its specific/chapter-level
 * children — empty when no distillation has run yet, which is the signal
 * the Scan's filter UI falls back to today's flat theme dropdown on
 * (TASKS.md M24.5 §4's "a book with no digest still shows a coherent Scan"
 * acceptance, extended to "no distillation yet"). */
export function listBookThemes(db: Database.Database, resourceId: string): BookTheme[] {
  const themeRows = db
    .prepare(
      `SELECT ct.id AS id, ct.name AS name, ct.color_index AS color_index
       FROM book_themes bt JOIN canonical_themes ct ON ct.id = bt.canonical_theme_id
       WHERE bt.resource_id = ?
       ORDER BY bt.generated_at ASC, ct.name ASC`,
    )
    .all(resourceId) as { id: string; name: string; color_index: number }[];

  const parentRows = db
    .prepare(`SELECT chapter_theme, canonical_theme_id FROM theme_parents WHERE resource_id = ?`)
    .all(resourceId) as { chapter_theme: string; canonical_theme_id: string }[];

  const childrenByParentId = new Map<string, string[]>();
  for (const row of parentRows) {
    const list = childrenByParentId.get(row.canonical_theme_id) ?? [];
    list.push(row.chapter_theme);
    childrenByParentId.set(row.canonical_theme_id, list);
  }

  return themeRows.map((row) => ({
    id: row.id,
    name: row.name,
    colorIndex: row.color_index,
    children: (childrenByParentId.get(row.id) ?? []).sort(),
  }));
}
