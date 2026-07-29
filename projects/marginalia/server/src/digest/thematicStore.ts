import crypto from "node:crypto";
import type Database from "better-sqlite3";

/** sha256 of the brief text — the cache key's brief-identity component. An
 * unset brief hashes the empty string, same as any other brief value; there
 * is nothing special about "no brief" at the storage layer. */
export function hashBrief(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export interface ResourceBrief {
  resourceId: string;
  text: string;
  updatedAt: string;
}

interface ResourceBriefRow {
  resource_id: string;
  text: string;
  updated_at: string;
}

/** The reader's standing angle for this book, or the empty brief if they've
 * never set one — callers treat "" as "no brief" rather than a special case. */
export function getBrief(db: Database.Database, resourceId: string): ResourceBrief {
  const row = db
    .prepare("SELECT * FROM resource_briefs WHERE resource_id = ?")
    .get(resourceId) as ResourceBriefRow | undefined;
  return row
    ? { resourceId: row.resource_id, text: row.text, updatedAt: row.updated_at }
    : { resourceId, text: "", updatedAt: "" };
}

export function putBrief(db: Database.Database, resourceId: string, text: string): ResourceBrief {
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO resource_briefs (resource_id, text, updated_at)
     VALUES (@resourceId, @text, @updatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET text = @text, updated_at = @updatedAt`,
  ).run({ resourceId, text, updatedAt });
  return { resourceId, text, updatedAt };
}

export interface ThematicQuestion {
  text: string;
  /** Verbatim excerpt from the chapter the question is about — decision 11:
   * the model returns text, code locates it (see routes/digest.ts's
   * chapter-anchor endpoint). */
  quote: string;
}

export interface ThematicDigest {
  resourceId: string;
  spineIndex: number;
  briefHash: string;
  briefText: string;
  analysis: string;
  themes: string[];
  questions: ThematicQuestion[];
  generatedAt: string;
}

interface ThematicDigestRow {
  resource_id: string;
  spine_index: number;
  brief_hash: string;
  brief_text: string;
  analysis: string;
  themes: string;
  questions: string;
  generated_at: string;
}

function rowToThematicDigest(row: ThematicDigestRow): ThematicDigest {
  return {
    resourceId: row.resource_id,
    spineIndex: row.spine_index,
    briefHash: row.brief_hash,
    briefText: row.brief_text,
    analysis: row.analysis,
    themes: JSON.parse(row.themes),
    questions: JSON.parse(row.questions),
    generatedAt: row.generated_at,
  };
}

/** All thematic rows for a resource, whatever brief produced them — callers
 * compare `briefHash` against the resource's *current* brief to decide
 * staleness (see `isThematicStale`); this list is not filtered by that. */
export function listThematicDigests(db: Database.Database, resourceId: string): ThematicDigest[] {
  const rows = db
    .prepare("SELECT * FROM thematic_digests WHERE resource_id = ? ORDER BY spine_index")
    .all(resourceId) as ThematicDigestRow[];
  return rows.map(rowToThematicDigest);
}

export function getThematicDigest(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
): ThematicDigest | undefined {
  const row = db
    .prepare("SELECT * FROM thematic_digests WHERE resource_id = ? AND spine_index = ?")
    .get(resourceId, spineIndex) as ThematicDigestRow | undefined;
  return row ? rowToThematicDigest(row) : undefined;
}

/** Replaces (or inserts) exactly one chapter's thematic row — re-running
 * under the same or a new brief overwrites, never appends. No history of
 * prior briefs' analysis is kept (decisions.md: briefs are edited in place). */
export function putThematicDigest(
  db: Database.Database,
  digest: Omit<ThematicDigest, "generatedAt">,
): ThematicDigest {
  const generatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO thematic_digests
       (resource_id, spine_index, brief_hash, brief_text, analysis, themes, questions, generated_at)
     VALUES (@resourceId, @spineIndex, @briefHash, @briefText, @analysis, @themes, @questions, @generatedAt)
     ON CONFLICT(resource_id, spine_index) DO UPDATE SET
       brief_hash = @briefHash, brief_text = @briefText, analysis = @analysis,
       themes = @themes, questions = @questions, generated_at = @generatedAt`,
  ).run({
    resourceId: digest.resourceId,
    spineIndex: digest.spineIndex,
    briefHash: digest.briefHash,
    briefText: digest.briefText,
    analysis: digest.analysis,
    themes: JSON.stringify(digest.themes),
    questions: JSON.stringify(digest.questions),
    generatedAt,
  });
  return { ...digest, generatedAt };
}

/** A thematic row is stale once the resource's *current* brief no longer
 * matches the one it was generated under — the only signal the UI needs to
 * show "stale, re-run?" rather than silently serving old analysis. */
export function isThematicStale(digest: Pick<ThematicDigest, "briefHash">, currentBriefHash: string): boolean {
  return digest.briefHash !== currentBriefHash;
}

export type ThematicRunStatus = "running" | "paused_rate_limit" | "completed" | "failed";

export interface ThematicRun {
  resourceId: string;
  spineStart: number;
  spineEnd: number;
  briefHash: string;
  status: ThematicRunStatus;
  failedSpineIndices: number[];
  resumesAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ThematicRunRow {
  resource_id: string;
  spine_start: number;
  spine_end: number;
  brief_hash: string;
  status: string;
  failed_spine_indices: string;
  resumes_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function rowToThematicRun(row: ThematicRunRow): ThematicRun {
  return {
    resourceId: row.resource_id,
    spineStart: row.spine_start,
    spineEnd: row.spine_end,
    briefHash: row.brief_hash,
    status: row.status as ThematicRunStatus,
    failedSpineIndices: JSON.parse(row.failed_spine_indices),
    resumesAt: row.resumes_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getThematicRun(db: Database.Database, resourceId: string): ThematicRun | undefined {
  const row = db
    .prepare("SELECT * FROM thematic_runs WHERE resource_id = ?")
    .get(resourceId) as ThematicRunRow | undefined;
  return row ? rowToThematicRun(row) : undefined;
}

export function putThematicRun(
  db: Database.Database,
  run: Omit<ThematicRun, "createdAt" | "updatedAt">,
): ThematicRun {
  const existing = getThematicRun(db, run.resourceId);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const updatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO thematic_runs
       (resource_id, spine_start, spine_end, brief_hash, status, failed_spine_indices,
        resumes_at, last_error, created_at, updated_at)
     VALUES (@resourceId, @spineStart, @spineEnd, @briefHash, @status, @failedSpineIndices,
             @resumesAt, @lastError, @createdAt, @updatedAt)
     ON CONFLICT(resource_id) DO UPDATE SET
       spine_start = @spineStart, spine_end = @spineEnd, brief_hash = @briefHash,
       status = @status, failed_spine_indices = @failedSpineIndices,
       resumes_at = @resumesAt, last_error = @lastError, updated_at = @updatedAt`,
  ).run({
    resourceId: run.resourceId,
    spineStart: run.spineStart,
    spineEnd: run.spineEnd,
    briefHash: run.briefHash,
    status: run.status,
    failedSpineIndices: JSON.stringify(run.failedSpineIndices),
    resumesAt: run.resumesAt,
    lastError: run.lastError,
    createdAt,
    updatedAt,
  });
  return { ...run, createdAt, updatedAt };
}
