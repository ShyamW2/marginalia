/**
 * Dev CLI: M35 §A3 "offsets, stored" — backfill.
 *
 *   pnpm --filter server backfill-offsets
 *
 * Migration 32 added `highlights.offset`/`length`, nullable, so every
 * highlight created before it landed reads as NULL — the same "unanchored"
 * state a highlight whose text genuinely can't be found already has. This
 * walks every resource's highlights, re-locates each one against its
 * section's text via `buildSectionOffsetIndex` + `locateAnchor` (the same
 * pair the Scan and search already use), and records what it finds.
 *
 * Safe to re-run: it only ever touches rows where `offset IS NULL`, so a
 * highlight that already has one is never re-located, and a highlight that
 * still doesn't locate is left exactly as before — never an error, just
 * still unanchored.
 */
import { getDb } from "../db.js";
import { getResourceTextSections, listResourceSummaries } from "../library/store.js";
import { listHighlightsMissingOffset, setHighlightOffset } from "../annotations/highlights.js";
import { buildSectionOffsetIndex, locateAnchor } from "../annotations/sectionOffsets.js";

function main(): void {
  const db = getDb();
  const resources = listResourceSummaries(db);

  let totalMissing = 0;
  let totalLocated = 0;

  for (const resource of resources) {
    const missing = listHighlightsMissingOffset(db, resource.id);
    if (missing.length === 0) continue;

    const sections = getResourceTextSections(db, resource.id);
    const index = buildSectionOffsetIndex(sections);

    let located = 0;
    for (const row of missing) {
      const hit = locateAnchor(index, row.spineIndex, {
        exact: row.exact,
        prefix: row.prefix,
        suffix: row.suffix,
      });
      if (hit) {
        setHighlightOffset(db, row.id, hit.offset, hit.length);
        located++;
      }
    }

    totalMissing += missing.length;
    totalLocated += located;
    console.log(`${resource.title}: ${located}/${missing.length} located`);
  }

  console.log();
  console.log(`Total: ${totalLocated}/${totalMissing} located across ${resources.length} book(s).`);
  if (totalLocated < totalMissing) {
    console.log(
      `${totalMissing - totalLocated} highlight(s) remain unanchored — same designed state as any` +
        " highlight whose text isn't findable, not an error.",
    );
  }
}

main();
