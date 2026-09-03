import type Database from "better-sqlite3";

/** M39 §D2 (PDF.md §5): the fields a `document`-kind chapter/book digest
 * produces that a `prose` one doesn't. Null on every `prose` row (the
 * overwhelming majority, and every row that predates this column) — see
 * migration 40's own comment on why this is one JSON column rather than
 * four/two new ones. */
export interface ChapterDocumentFields {
  contributions: string[];
  methods: string;
  findings: string[];
  limitations: string;
}
export interface BookDocumentFields {
  keyClaims: string[];
  methods: string;
}

export interface ChapterDigest {
  resourceId: string;
  spineIndex: number;
  summary: string;
  themes: string[];
  characters: string[];
  /** M18: a short descriptive title from the digest's map step. Null for
   * chapters digested before this column existed — there is no backfill,
   * they just show the positional fallback until re-digested. */
  title: string | null;
  documentFields?: ChapterDocumentFields | null;
  sourceHash: string;
  generatedAt: string;
}

/** M22 (AUDIO.md "Casting"): the digest reduce's cast entry, enriched enough
 * to drive voice assignment — see `CastSchema` in AUDIO.md. */
export interface BookDigestCastMember {
  name: string;
  aliases: string[];
  gender: "female" | "male" | "unknown";
  ageHint: "child" | "young" | "adult" | "old" | "unknown";
  description: string;
  lineCountHint: "many" | "few";
}

export interface BookDigest {
  resourceId: string;
  synopsis: string;
  cast: BookDigestCastMember[];
  narratorGender: "female" | "male" | "unknown";
  themes: string[];
  documentFields?: BookDocumentFields | null;
  generatedAt: string;
}

export type DigestRunStatus = "running" | "paused_rate_limit" | "completed" | "failed";

export interface DigestRun {
  resourceId: string;
  spineStart: number;
  spineEnd: number;
  status: DigestRunStatus;
  failedSpineIndices: number[];
  resumesAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChapterDigestRow {
  resource_id: string;
  spine_index: number;
  summary: string;
  themes: string;
  characters: string;
  title: string | null;
  document_fields: string | null;
  source_hash: string;
  generated_at: string;
}

function rowToChapterDigest(row: ChapterDigestRow): ChapterDigest {
  return {
    resourceId: row.resource_id,
    spineIndex: row.spine_index,
    summary: row.summary,
    themes: JSON.parse(row.themes),
    characters: JSON.parse(row.characters),
    title: row.title,
    documentFields: row.document_fields ? JSON.parse(row.document_fields) : null,
    sourceHash: row.source_hash,
    generatedAt: row.generated_at,
  };
}

/** All digested chapters for a resource, in spine order — this list *is*
 * the coverage map (decisions.md 2026-07-28 later: "coverage is queryable").*/
export function listChapterDigests(
  db: Database.Database,
  resourceId: string,
): ChapterDigest[] {
  const rows = db
    .prepare(
      "SELECT * FROM chapter_digests WHERE resource_id = ? ORDER BY spine_index",
    )
    .all(resourceId) as ChapterDigestRow[];
  return rows.map(rowToChapterDigest);
}

export function getChapterDigest(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
): ChapterDigest | undefined {
  const row = db
    .prepare("SELECT * FROM chapter_digests WHERE resource_id = ? AND spine_index = ?")
    .get(resourceId, spineIndex) as ChapterDigestRow | undefined;
  return row ? rowToChapterDigest(row) : undefined;
}

/** Replaces (or inserts) exactly one chapter's row — re-digesting a chapter
 * is idempotent by construction, never appends a duplicate. */
export function putChapterDigest(
  db: Database.Database,
  digest: Omit<ChapterDigest, "generatedAt">,
): ChapterDigest {
  const generatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO chapter_digests
       (resource_id, spine_index, summary, themes, characters, title, document_fields, source_hash, generated_at)
     VALUES (@resourceId, @spineIndex, @summary, @themes, @characters, @title, @documentFields, @sourceHash, @generatedAt)
     ON CONFLICT(resource_id, spine_index) DO UPDATE SET
       summary = @summary, themes = @themes, characters = @characters, title = @title,
       document_fields = @documentFields, source_hash = @sourceHash, generated_at = @generatedAt`,
  ).run({
    resourceId: digest.resourceId,
    spineIndex: digest.spineIndex,
    summary: digest.summary,
    themes: JSON.stringify(digest.themes),
    characters: JSON.stringify(digest.characters),
    title: digest.title,
    documentFields: digest.documentFields ? JSON.stringify(digest.documentFields) : null,
    sourceHash: digest.sourceHash,
    generatedAt,
  });
  return { ...digest, generatedAt };
}

interface BookDigestRow {
  resource_id: string;
  synopsis: string;
  cast: string;
  narrator_gender: string;
  themes: string;
  document_fields: string | null;
  generated_at: string;
}

function rowToBookDigest(row: BookDigestRow): BookDigest {
  return {
    resourceId: row.resource_id,
    synopsis: row.synopsis,
    cast: JSON.parse(row.cast),
    narratorGender: row.narrator_gender as BookDigest["narratorGender"],
    themes: JSON.parse(row.themes),
    documentFields: row.document_fields ? JSON.parse(row.document_fields) : null,
    generatedAt: row.generated_at,
  };
}

export function getBookDigest(
  db: Database.Database,
  resourceId: string,
): BookDigest | undefined {
  const row = db
    .prepare("SELECT * FROM book_digests WHERE resource_id = ?")
    .get(resourceId) as BookDigestRow | undefined;
  return row ? rowToBookDigest(row) : undefined;
}

export function putBookDigest(
  db: Database.Database,
  digest: Omit<BookDigest, "generatedAt">,
): BookDigest {
  const generatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO book_digests (resource_id, synopsis, cast, narrator_gender, themes, document_fields, generated_at)
     VALUES (@resourceId, @synopsis, @cast, @narratorGender, @themes, @documentFields, @generatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET
       synopsis = @synopsis, cast = @cast, narrator_gender = @narratorGender,
       themes = @themes, document_fields = @documentFields, generated_at = @generatedAt`,
  ).run({
    resourceId: digest.resourceId,
    synopsis: digest.synopsis,
    cast: JSON.stringify(digest.cast),
    narratorGender: digest.narratorGender,
    themes: JSON.stringify(digest.themes),
    documentFields: digest.documentFields ? JSON.stringify(digest.documentFields) : null,
    generatedAt,
  });
  return { ...digest, generatedAt };
}

export interface BookDigestSnapshot {
  resourceId: string;
  upToSpineIndex: number;
  synopsis: string;
  cast: BookDigestCastMember[];
  narratorGender: "female" | "male" | "unknown";
  themes: string[];
  generatedAt: string;
}

interface BookDigestSnapshotRow {
  resource_id: string;
  up_to_spine_index: number;
  synopsis: string;
  cast: string;
  narrator_gender: string;
  themes: string;
  generated_at: string;
}

function rowToBookDigestSnapshot(row: BookDigestSnapshotRow): BookDigestSnapshot {
  return {
    resourceId: row.resource_id,
    upToSpineIndex: row.up_to_spine_index,
    synopsis: row.synopsis,
    cast: JSON.parse(row.cast),
    narratorGender: row.narrator_gender as BookDigestSnapshot["narratorGender"],
    themes: JSON.parse(row.themes),
    generatedAt: row.generated_at,
  };
}

/** M19.5 spoiler-safe book digest: the one cached bookmark-bounded reduce
 * for this resource (see routes/digest.ts for the lazy-regen trigger). */
export function getBookDigestSnapshot(
  db: Database.Database,
  resourceId: string,
): BookDigestSnapshot | undefined {
  const row = db
    .prepare("SELECT * FROM book_digest_snapshots WHERE resource_id = ?")
    .get(resourceId) as BookDigestSnapshotRow | undefined;
  return row ? rowToBookDigestSnapshot(row) : undefined;
}

export function putBookDigestSnapshot(
  db: Database.Database,
  snapshot: Omit<BookDigestSnapshot, "generatedAt">,
): BookDigestSnapshot {
  const generatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO book_digest_snapshots
       (resource_id, up_to_spine_index, synopsis, cast, narrator_gender, themes, generated_at)
     VALUES (@resourceId, @upToSpineIndex, @synopsis, @cast, @narratorGender, @themes, @generatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET
       up_to_spine_index = @upToSpineIndex, synopsis = @synopsis, cast = @cast,
       narrator_gender = @narratorGender, themes = @themes, generated_at = @generatedAt`,
  ).run({
    resourceId: snapshot.resourceId,
    upToSpineIndex: snapshot.upToSpineIndex,
    synopsis: snapshot.synopsis,
    narratorGender: snapshot.narratorGender,
    cast: JSON.stringify(snapshot.cast),
    themes: JSON.stringify(snapshot.themes),
    generatedAt,
  });
  return { ...snapshot, generatedAt };
}

interface DigestRunRow {
  resource_id: string;
  spine_start: number;
  spine_end: number;
  status: string;
  failed_spine_indices: string;
  resumes_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDigestRun(row: DigestRunRow): DigestRun {
  return {
    resourceId: row.resource_id,
    spineStart: row.spine_start,
    spineEnd: row.spine_end,
    status: row.status as DigestRunStatus,
    failedSpineIndices: JSON.parse(row.failed_spine_indices),
    resumesAt: row.resumes_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getDigestRun(
  db: Database.Database,
  resourceId: string,
): DigestRun | undefined {
  const row = db
    .prepare("SELECT * FROM digest_runs WHERE resource_id = ?")
    .get(resourceId) as DigestRunRow | undefined;
  return row ? rowToDigestRun(row) : undefined;
}

export function putDigestRun(
  db: Database.Database,
  run: Omit<DigestRun, "createdAt" | "updatedAt">,
): DigestRun {
  const existing = getDigestRun(db, run.resourceId);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO digest_runs
       (resource_id, spine_start, spine_end, status, failed_spine_indices,
        resumes_at, last_error, created_at, updated_at)
     VALUES (@resourceId, @spineStart, @spineEnd, @status, @failedSpineIndices,
             @resumesAt, @lastError, @createdAt, @updatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET
       spine_start = @spineStart, spine_end = @spineEnd, status = @status,
       failed_spine_indices = @failedSpineIndices, resumes_at = @resumesAt,
       last_error = @lastError, updated_at = @updatedAt`,
  ).run({
    resourceId: run.resourceId,
    spineStart: run.spineStart,
    spineEnd: run.spineEnd,
    status: run.status,
    failedSpineIndices: JSON.stringify(run.failedSpineIndices),
    resumesAt: run.resumesAt,
    lastError: run.lastError,
    createdAt,
    updatedAt,
  });
  return { ...run, createdAt, updatedAt };
}
