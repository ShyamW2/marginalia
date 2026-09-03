/**
 * Dev CLI: M39 §C7 "the migration path is cheap" (PDF.md §2).
 *
 *   pnpm --filter server reanchor <oldId> <newId>
 *
 * A PDF resource's id folds in `EXTRACTOR_VERSION` (PDF.md §2) — upgrading
 * the extractor produces a new, separate resource beside the old one rather
 * than rewriting text under live highlights (settled decision 5). This
 * moves every highlight that still locates in the new resource's text —
 * quote + prefix/suffix, the same anchor `sectionOffsets.ts`'s
 * `locateAnchor` already uses for `backfillOffsets.ts` above — by
 * repointing its resource id, spine index and offset in place. Threads,
 * tags, notes and panel position all live on the highlight row itself (or
 * key off `highlight_id`, unchanged), so moving the row moves all of them
 * for free.
 *
 * A highlight that doesn't locate in the new resource's text stays on the
 * old resource, untouched — reported by count, never guessed at. No UI ever
 * calls this; a reader must never trigger a silent re-extraction.
 */
import { getDb } from "../db.js";
import { getResourceById, getResourceTextSections } from "../library/store.js";
import { listHighlightsForResource, reanchorHighlightToResource } from "../annotations/highlights.js";
import { buildSectionOffsetIndex, locateAnchor } from "../annotations/sectionOffsets.js";

function main(): void {
  const [oldId, newId] = process.argv.slice(2);
  if (!oldId || !newId) {
    console.error("usage: reanchor <oldId> <newId>");
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const oldResource = getResourceById(db, oldId);
  const newResource = getResourceById(db, newId);
  if (!oldResource) {
    console.error(`no such resource: ${oldId}`);
    process.exitCode = 1;
    return;
  }
  if (!newResource) {
    console.error(`no such resource: ${newId}`);
    process.exitCode = 1;
    return;
  }

  const highlights = listHighlightsForResource(db, oldId);
  if (highlights.length === 0) {
    console.log(`${oldResource.title}: no highlights to move.`);
    return;
  }

  const index = buildSectionOffsetIndex(getResourceTextSections(db, newId));

  let resolved = 0;
  for (const highlight of highlights) {
    const hit = locateAnchor(index, highlight.spineIndex, {
      exact: highlight.exact,
      prefix: highlight.prefix,
      suffix: highlight.suffix,
    });
    if (!hit) continue;
    reanchorHighlightToResource(db, highlight.id, {
      resourceId: newId,
      spineIndex: hit.spineIndex,
      offset: hit.offset,
      length: hit.length,
    });
    resolved++;
  }

  console.log(`${oldResource.title} -> ${newResource.title}: ${resolved}/${highlights.length} highlight(s) moved.`);
  if (resolved < highlights.length) {
    console.log(
      `${highlights.length - resolved} highlight(s) did not locate in the new resource and remain on ${oldId}.`,
    );
  }
}

main();
