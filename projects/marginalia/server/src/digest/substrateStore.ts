import type Database from "better-sqlite3";

/** M37 §A1: a verbatim passage plus "a line of context each" — the same
 * prefix/suffix shape `chapterAnchor.ts`'s `QuoteAnchor` locates, minus the
 * offset/length: those are section-text-relative and cheap to recompute
 * wherever a passage actually becomes something (a highlight, a prompt),
 * the same rule `ThematicTheme.zoneStart/zoneEnd` already follows for the
 * same reason. */
export interface SubstratePassage {
  quote: string;
  prefix: string;
  suffix: string;
  /** M37 §C2's eviction signal: which briefs' thematic passes have drawn
   * this passage's quote as theme evidence, by `hashBrief` value. A §A1
   * passage starts with none — it's a candidate the brief-blind pass kept,
   * not yet something a reader has cared about. Eviction keeps passages two
   * or more briefs independently selected over ones no brief ever drew on;
   * see `substrateBuild.ts`'s `mergeQuotesIntoSubstrate`. */
  drawnByBriefHashes: string[];
}

/** M37 §A1: "the chapter's claims and tensions, who holds which position."
 * Paraphrased, not verbatim — unlike a passage, a claim is the pass's own
 * synthesis, so there is nothing to locate against the chapter text. */
export interface SubstrateClaim {
  claim: string;
  holder: string | null;
}

export interface ChapterSubstrate {
  resourceId: string;
  spineIndex: number;
  passages: SubstratePassage[];
  claims: SubstrateClaim[];
  /** sha256 of the section's raw text — M37 §A1: keyed the way the plot
   * layer's `chapter_digests.source_hash` is (never on the brief). */
  sourceHash: string;
  generatedAt: string;
}

interface ChapterSubstrateRow {
  resource_id: string;
  spine_index: number;
  passages: string;
  claims: string;
  source_hash: string;
  generated_at: string;
}

function rowToChapterSubstrate(row: ChapterSubstrateRow): ChapterSubstrate {
  const passages = JSON.parse(row.passages) as SubstratePassage[];
  return {
    resourceId: row.resource_id,
    spineIndex: row.spine_index,
    // A row written before M37 §C's draw tracking has no `drawnByBriefHashes`
    // in its stored JSON — normalized here rather than migrated, the same
    // "old rows just read as the empty case" treatment `getBrief` gives "".
    passages: passages.map((p) => ({ ...p, drawnByBriefHashes: p.drawnByBriefHashes ?? [] })),
    claims: JSON.parse(row.claims),
    sourceHash: row.source_hash,
    generatedAt: row.generated_at,
  };
}

/** All substrated chapters for a resource, in spine order — same "this list
 * is the coverage map" shape `listChapterDigests` uses. */
export function listChapterSubstrates(db: Database.Database, resourceId: string): ChapterSubstrate[] {
  const rows = db
    .prepare("SELECT * FROM chapter_substrate WHERE resource_id = ? ORDER BY spine_index")
    .all(resourceId) as ChapterSubstrateRow[];
  return rows.map(rowToChapterSubstrate);
}

export function getChapterSubstrate(
  db: Database.Database,
  resourceId: string,
  spineIndex: number,
): ChapterSubstrate | undefined {
  const row = db
    .prepare("SELECT * FROM chapter_substrate WHERE resource_id = ? AND spine_index = ?")
    .get(resourceId, spineIndex) as ChapterSubstrateRow | undefined;
  return row ? rowToChapterSubstrate(row) : undefined;
}

/** Replaces (or inserts) exactly one chapter's substrate row. A brief-blind
 * pass is never re-run once a row exists (see `ensureChapterSubstrate`), so
 * in practice this only ever inserts — the ON CONFLICT branch exists for
 * parity with every other per-chapter store in this file's siblings, and
 * for §C's future append/evict, which does need to overwrite in place. */
export function putChapterSubstrate(
  db: Database.Database,
  substrate: Omit<ChapterSubstrate, "generatedAt">,
): ChapterSubstrate {
  const generatedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO chapter_substrate
       (resource_id, spine_index, passages, claims, source_hash, generated_at)
     VALUES (@resourceId, @spineIndex, @passages, @claims, @sourceHash, @generatedAt)
     ON CONFLICT(resource_id, spine_index) DO UPDATE SET
       passages = @passages, claims = @claims, source_hash = @sourceHash, generated_at = @generatedAt`,
  ).run({
    resourceId: substrate.resourceId,
    spineIndex: substrate.spineIndex,
    passages: JSON.stringify(substrate.passages),
    claims: JSON.stringify(substrate.claims),
    sourceHash: substrate.sourceHash,
    generatedAt,
  });
  return { ...substrate, generatedAt };
}
