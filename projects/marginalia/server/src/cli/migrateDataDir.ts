/**
 * Operator CLI: M44 "the migration — copy, verify, mark. Never move."
 * (DESKTOP.md §3.1, TASKS.md M44).
 *
 *   pnpm --filter server migrate-data-dir
 *
 * Deliberately **not** run automatically at server startup — a failed
 * migration is only recoverable by inspecting the partial copy, and that
 * should happen before anything trusts the new location. Safe to run
 * against a *copy* of `data/` first: point `MARGINALIA_DATA_DIR` at a
 * scratch directory to migrate into that instead of the real OS location.
 */
import { LEGACY_DATA_DIR, resolveOsDataDir } from "../paths.js";
import { migrateLegacyDataDir } from "../dataMigration.js";

function main(): void {
  const override = process.env.MARGINALIA_DATA_DIR?.trim();
  const target = override ? override : resolveOsDataDir();
  if (!target) {
    console.error(
      "No OS per-user data directory is known for this platform — set MARGINALIA_DATA_DIR to migrate anyway.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Legacy data: ${LEGACY_DATA_DIR}`);
  console.log(`Target:      ${target}`);

  const result = migrateLegacyDataDir(LEGACY_DATA_DIR, target);

  switch (result.status) {
    case "already-migrated":
      console.log("Already migrated — nothing to do. Delete the target directory to re-run.");
      return;
    case "no-legacy-data":
      console.log("No legacy data/ directory found — nothing to migrate.");
      return;
    case "target-not-empty":
      console.error(`Target directory is non-empty and has no migration marker: ${target}`);
      console.error("Refusing to write into it. Move it aside, then re-run.");
      process.exitCode = 1;
      return;
    case "verification-failed":
      console.error("Copy finished but row counts did not match — NOT marked complete.");
      for (const mismatch of result.mismatches ?? []) {
        console.error(`  ${mismatch.table}: legacy=${mismatch.legacy} migrated=${mismatch.migrated}`);
      }
      console.error(`Inspect ${target}, then delete it and re-run.`);
      process.exitCode = 1;
      return;
    case "migrated":
      console.log(
        "Migrated and verified — every table's row count matched. The app reads from the new location starting next launch.",
      );
      return;
  }
}

main();
